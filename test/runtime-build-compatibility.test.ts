import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preparePreviousRuntimeBuild } from "../scripts/runtime-build-compatibility.mjs";

const previousPackages = {
  openssl: "3.5.7-r0",
  "postgresql16-client": "16.14-r0"
};
const candidatePackages = {
  openssl: "3.5.7-r0",
  "postgresql16-client": "16.15-r0"
};

test("previous runtime compatibility refreshes one verified legacy package pin", async () => {
  await withRuntime(
    "RUN apk add --no-cache openssl=3.5.7-r0 postgresql16-client=16.14-r0\n",
    "services:\n  backend:\n    build: .\n",
    async (runtimeRoot) => {
      const result = await preparePreviousRuntimeBuild(runtimeRoot, candidatePackages);
      const dockerfile = await readFile(path.join(runtimeRoot, "Dockerfile"), "utf8");

      assert.match(dockerfile, /postgresql16-client=16\.15-r0/);
      assert.equal(result.environment.CODEY_APK_POSTGRESQL16_CLIENT_VERSION, "16.15-r0");
      assert.deepEqual(result.report.refreshedPackages, [{
        name: "postgresql16-client",
        fromVersion: "16.14-r0",
        toVersion: "16.15-r0",
        method: "verified-legacy-pin-refresh"
      }]);
    }
  );
});

test("previous runtime compatibility uses declared build arguments without rewriting", async () => {
  const dockerfile = [
    "ARG CODEY_APK_OPENSSL_VERSION=3.5.7-r0",
    "ARG CODEY_APK_POSTGRESQL16_CLIENT_VERSION=16.14-r0",
    'RUN apk add --no-cache "openssl=${CODEY_APK_OPENSSL_VERSION}" "postgresql16-client=${CODEY_APK_POSTGRESQL16_CLIENT_VERSION}"',
    ""
  ].join("\n");
  const compose = [
    "services:",
    "  backend:",
    "    build:",
    "      args:",
    "        CODEY_APK_OPENSSL_VERSION: ${CODEY_APK_OPENSSL_VERSION:-3.5.7-r0}",
    "        CODEY_APK_POSTGRESQL16_CLIENT_VERSION: ${CODEY_APK_POSTGRESQL16_CLIENT_VERSION:-16.14-r0}",
    ""
  ].join("\n");

  await withRuntime(dockerfile, compose, async (runtimeRoot) => {
    const result = await preparePreviousRuntimeBuild(runtimeRoot, candidatePackages);

    assert.equal(await readFile(path.join(runtimeRoot, "Dockerfile"), "utf8"), dockerfile);
    assert.deepEqual(result.report.refreshedPackages, [{
      name: "postgresql16-client",
      fromVersion: "16.14-r0",
      toVersion: "16.15-r0",
      method: "docker-build-argument"
    }]);
  });
});

test("previous runtime compatibility fails closed for an unexpected Dockerfile", async () => {
  await withRuntime(
    "RUN apk add --no-cache openssl postgresql16-client\n",
    "services:\n  backend:\n    build: .\n",
    async (runtimeRoot) => {
      await assert.rejects(
        preparePreviousRuntimeBuild(runtimeRoot, candidatePackages),
        /not an approved legacy Dockerfile shape/
      );
    }
  );
});

test("previous runtime compatibility fails closed when a package is omitted", async () => {
  await withRuntime(
    "RUN apk add --no-cache openssl=3.5.7-r0 postgresql16-client=16.14-r0\n",
    "services:\n  backend:\n    build: .\n",
    async (runtimeRoot) => {
      await assert.rejects(
        preparePreviousRuntimeBuild(runtimeRoot, { openssl: "3.5.7-r0" }),
        /different Alpine package sets/
      );
    }
  );
});

async function withRuntime(
  dockerfile: string,
  compose: string,
  callback: (runtimeRoot: string) => Promise<void>
) {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "codey-runtime-build-"));
  try {
    await mkdir(path.join(runtimeRoot, "runtime-meta"), { recursive: true });
    await writeFile(
      path.join(runtimeRoot, "runtime-meta", "container-images.json"),
      `${JSON.stringify({ apkPackages: previousPackages }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(path.join(runtimeRoot, "Dockerfile"), dockerfile, "utf8");
    await writeFile(path.join(runtimeRoot, "docker-compose.selfhost.yml"), compose, "utf8");
    await callback(runtimeRoot);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
}
