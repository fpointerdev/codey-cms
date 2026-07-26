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

test("release preflight accepts matching notes, version, and signing key", async () => {
  const result = await execFileAsync(process.execPath, ["scripts/release-preflight.mjs"], {
    env: {
      ...process.env,
      GITHUB_REF_NAME: releaseTag,
      CODEY_RELEASE_PRIVATE_KEY: privateKey
    }
  });

  assert.match(result.stdout, new RegExp(`Release preflight passed for ${escapeRegex(releaseTag)}\\.`));
  assert.match(result.stdout, /Signing key: [a-f0-9]{16}/);
});

test("release preflight rejects a tag that differs from the package version", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/release-preflight.mjs"], {
      env: {
        ...process.env,
        GITHUB_REF_NAME: `${releaseTag}-mismatch`,
        CODEY_RELEASE_PRIVATE_KEY: privateKey
      }
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
