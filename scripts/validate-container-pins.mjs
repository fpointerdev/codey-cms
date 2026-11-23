import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const images = JSON.parse(await readFile(path.join(root, "runtime-meta", "container-images.json"), "utf8"));
const apkBuildArguments = {
  openssl: "CODEY_APK_OPENSSL_VERSION",
  "postgresql16-client": "CODEY_APK_POSTGRESQL16_CLIENT_VERSION"
};

for (const [name, reference] of Object.entries({ node: images.node, postgres: images.postgres, caddy: images.caddy, golang: images.golang })) {
  if (typeof reference !== "string" || !/@sha256:[a-f0-9]{64}$/.test(reference)) {
    throw new Error(`${name} container image must be pinned by SHA-256 digest.`);
  }
}

for (const [name, version] of Object.entries(images.apkPackages || {})) {
  if (!/^[A-Za-z0-9+_.-]+$/.test(name) || !/^\d[0-9A-Za-z.+_-]*-r\d+$/.test(version)) {
    throw new Error(`Alpine package pin is invalid: ${name}=${version}.`);
  }
  const buildArgument = apkBuildArguments[name];
  if (!buildArgument) {
    throw new Error(`Alpine package ${name} does not have a controlled Docker build argument.`);
  }
  await assertContains("Dockerfile", `ARG ${buildArgument}=${version}`);
  await assertContains("Dockerfile", `${name}=\${${buildArgument}}`);
  await assertContains(
    "docker-compose.selfhost.yml",
    `${buildArgument}: \${${buildArgument}:-${version}}`
  );
}
if (!images.apkPackages?.openssl || !images.apkPackages?.["postgresql16-client"]) {
  throw new Error("OpenSSL and PostgreSQL client packages must be pinned.");
}

await assertContains("Dockerfile", images.node);
await assertContains("integrations/codey-cms-mcp/Dockerfile", images.node);
await assertContains("Dockerfile.postgres", images.postgres);
await assertContains("docker-compose.selfhost.yml", "dockerfile: Dockerfile.postgres");
await assertContains("docker-compose.prod.yml", "dockerfile: Dockerfile.postgres");
for (const name of ["libxml2", "su-exec"]) {
  const version = images.postgresApkPackages?.[name];
  if (!/^\d[0-9A-Za-z.+_-]*-r\d+$/.test(version || "")) throw new Error(`PostgreSQL package ${name} must be pinned.`);
  await assertContains("Dockerfile.postgres", `${name}=${version}`);
}
await assertContains(".github/workflows/ci.yml", images.postgres);
await assertContains("Dockerfile.caddy", images.caddy);
await assertContains("Dockerfile.caddy", images.golang);
await assertContains("docker-compose.public.yml", "dockerfile: Dockerfile.caddy");

console.log("Container image pins match runtime-meta/container-images.json.");

async function assertContains(file, expected) {
  const content = await readFile(path.join(root, file), "utf8");
  if (!content.includes(expected)) {
    throw new Error(`${file} does not use the recorded immutable image ${expected}.`);
  }
}
