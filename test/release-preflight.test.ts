import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const privateKey = generateKeyPairSync("ed25519").privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

test("release preflight accepts matching notes, version, and signing key", async () => {
  const result = await execFileAsync(process.execPath, ["scripts/release-preflight.mjs"], {
    env: {
      ...process.env,
      GITHUB_REF_NAME: "v0.9.0",
      CODEY_RELEASE_PRIVATE_KEY: privateKey
    }
  });

  assert.match(result.stdout, /Release preflight passed for v0\.9\.0\./);
  assert.match(result.stdout, /Signing key: [a-f0-9]{16}/);
});

test("release preflight rejects a tag that differs from the package version", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/release-preflight.mjs"], {
      env: {
        ...process.env,
        GITHUB_REF_NAME: "v0.9.1",
        CODEY_RELEASE_PRIVATE_KEY: privateKey
      }
    }),
    /does not match package version 0\.9\.0/
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
