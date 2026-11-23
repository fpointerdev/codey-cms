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

test("Dependabot groups coupled actions without hiding major security updates", () => {
  const config = readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8");

  assert.match(config, /github-actions[\s\S]*groups:[\s\S]*patterns:[\s\S]*- "\*"/);
  assert.doesNotMatch(config, /version-update:semver-major/);
});

test("release publication requires the shipped-image vulnerability gate", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const scanner = readFileSync(new URL("../scripts/audit-container-images.mjs", import.meta.url), "utf8");
  const release = readFileSync(new URL("../scripts/build-release.mjs", import.meta.url), "utf8");
  assert.match(workflow.split("  publish-release:")[1], /needs: \[[^\]]*container-security\]/);
  assert.match(scanner, /aquasec\/trivy:[^"\s]+@sha256:[a-f0-9]{64}/);
  assert.match(scanner, /"--severity", "HIGH,CRITICAL", "--exit-code", "1"/);
  assert.doesNotMatch(scanner, /--ignore-unfixed|--skip-db-update/);
  assert.match(scanner, /if \(result.status !== 0\) failed = true/);
  assert.match(scanner, /postgres: "codey-cms-postgres:security"/);
  assert.match(release, /"Dockerfile.postgres"/);
});

test("container pins cover hardened PostgreSQL and both Node runtimes", async () => {
  const result = await execFileAsync(process.execPath, ["scripts/validate-container-pins.mjs"]);
  assert.match(result.stdout, /Container image pins match/);
  const database = readFileSync(new URL("../Dockerfile.postgres", import.meta.url), "utf8");
  assert.match(database, /FROM postgres:16-alpine@sha256:/);
  assert.match(database, /su-exec postgres true/);
  assert.doesNotMatch(database, /PGDATA|ENTRYPOINT|force-reset/);
});

test("Caddy keeps standard modules with locked patched upstream dependencies", () => {
  const module = readFileSync(new URL("../integrations/caddy/go.mod", import.meta.url), "utf8");
  const entrypoint = readFileSync(new URL("../integrations/caddy/main.go", import.meta.url), "utf8");
  const dockerfile = readFileSync(new URL("../Dockerfile.caddy", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../.github/workflows/container-security.yml", import.meta.url), "utf8");
  const qualifier = readFileSync(new URL("../scripts/qualify-caddy.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(module, /go-jose\/go-jose\/v3/);
  assert.match(module, /certificates v0\.30\.3-0\.20261105213751-6d5a251fbe01/);
  assert.match(module, /golang.org\/x\/net v0\.62\.0/);
  assert.match(entrypoint, /caddy\/v2\/modules\/standard/);
  assert.match(dockerfile, /go mod verify/);
  assert.match(dockerfile, /go build -mod=readonly/);
  assert.match(workflow, /qualify-caddy\.mjs --image codey-cms-caddy:security/);
  assert.doesNotMatch(qualifier, /rejectUnauthorized:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/);
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
