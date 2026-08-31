import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const execFileAsync = promisify(execFile);
const privateKey = generateKeyPairSync("ed25519").privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };
const releaseTag = `v${packageJson.version}`;

function localPreflightEnvironment(overrides: NodeJS.ProcessEnv = {}) {
  const environment = {
    ...process.env,
    ...overrides
  };

  delete environment.GITHUB_ACTIONS;
  delete environment.GITHUB_REF;
  delete environment.GITHUB_REPOSITORY;
  delete environment.GITHUB_SHA;

  return environment;
}

test("release preflight accepts matching notes, version, and signing key", async () => {
  const result = await execFileAsync(process.execPath, ["scripts/release-preflight.mjs"], {
    env: localPreflightEnvironment({
      GITHUB_REF_NAME: releaseTag,
      CODEY_RELEASE_PRIVATE_KEY: privateKey
    })
  });

  assert.match(result.stdout, new RegExp(`Release preflight passed for ${escapeRegex(releaseTag)}\\.`));
  assert.match(result.stdout, /Signing key: [a-f0-9]{16}/);
});

test("release preflight rejects a tag that differs from the package version", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/release-preflight.mjs"], {
      env: localPreflightEnvironment({
        GITHUB_REF_NAME: `${releaseTag}-mismatch`,
        CODEY_RELEASE_PRIVATE_KEY: privateKey
      })
    }),
    new RegExp(`does not match package version ${escapeRegex(packageJson.version)}`)
  );
});

test("release workflow pins actions and scopes the signing key to signing steps", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const actionReferences = [...workflow.matchAll(/uses: [^@\s]+@([^\s]+)/g)]
    .map((match) => match[1]);
  assert.ok(actionReferences.length > 0);
  assert.ok(actionReferences.every((reference) => /^[a-f0-9]{40}$/.test(reference)));

  const publishJob = workflow.split("  publish-release:")[1] ?? "";
  const jobConfiguration = publishJob.split("    steps:")[0] ?? "";
  assert.doesNotMatch(jobConfiguration, /CODEY_RELEASE_PRIVATE_KEY/);
  assert.equal(
    (publishJob.match(/CODEY_RELEASE_PRIVATE_KEY:/g) ?? []).length,
    2
  );
});

test("CodeQL initialization and analysis use one pinned action release", () => {
  const workflow = readFileSync(new URL("../.github/workflows/security.yml", import.meta.url), "utf8");
  const references = [...workflow.matchAll(
    /uses: github\/codeql-action\/(?:init|analyze)@([a-f0-9]{40})/g
  )].map((match) => match[1]);

  assert.equal(references.length, 2);
  assert.equal(new Set(references).size, 1);
});

test("Dependabot groups coupled actions and defers npm major migrations", () => {
  const config = readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8");

  assert.match(config, /github-actions[\s\S]*groups:[\s\S]*patterns:[\s\S]*- "\*"/);
  assert.match(config, /dependency-name: "\*"[\s\S]*version-update:semver-major/);
});

test("CodeQL excludes only reproducibly generated browser bundles", () => {
  const workflow = readFileSync(new URL("../.github/workflows/security.yml", import.meta.url), "utf8");
  const config = readFileSync(
    new URL("../.github/codeql/codeql-config.yml", import.meta.url),
    "utf8"
  );

  assert.match(workflow, /config-file: \.\/\.github\/codeql\/codeql-config\.yml/);
  assert.match(config, /paths-ignore:\s+\- apps\/web\/vendor\/\*\*/);
  assert.doesNotMatch(config, /apps\/web\/web|scripts\/|src\//);
});

test("release ancestry enforcement is limited to official tag jobs with full history", () => {
  const preflight = readFileSync(new URL("../scripts/release-preflight.mjs", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const publishJob = workflow.split("  publish-release:")[1] ?? "";

  assert.match(preflight, /GITHUB_REF\?\.startsWith\("refs\/tags\/v"\)/);
  assert.match(preflight, /if \(isGitHubRelease\)/);
  assert.match(publishJob, /fetch-depth: 0/);
});
