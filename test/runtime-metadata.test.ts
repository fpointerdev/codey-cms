import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("runtime metadata uses the package version", async () => {
  process.env.DATABASE_URL ||= "postgresql://codey:codey@localhost:5432/codey_test";
  process.env.JWT_ACCESS_SECRET ||= "runtime-metadata-test-secret-with-at-least-32-characters";
  const [{ logger }, { runtimeVersion }] = await Promise.all([
    import("../src/infrastructure/logging/logger.js"),
    import("../src/runtime/release.js")
  ]);
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as { version: string };

  assert.equal(runtimeVersion, packageJson.version);
  assert.equal(logger.bindings().version, packageJson.version);
});
