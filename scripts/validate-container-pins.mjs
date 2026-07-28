import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const images = JSON.parse(await readFile(path.join(root, "runtime-meta", "container-images.json"), "utf8"));

for (const [name, reference] of Object.entries({ node: images.node, postgres: images.postgres })) {
  if (typeof reference !== "string" || !/@sha256:[a-f0-9]{64}$/.test(reference)) {
    throw new Error(`${name} container image must be pinned by SHA-256 digest.`);
  }
}

await assertContains("Dockerfile", images.node);
await assertContains("docker-compose.selfhost.yml", images.postgres);
await assertContains("docker-compose.prod.yml", images.postgres);
await assertContains(".github/workflows/ci.yml", images.postgres);

console.log("Container image pins match runtime-meta/container-images.json.");

async function assertContains(file, expected) {
  const content = await readFile(path.join(root, file), "utf8");
  if (!content.includes(expected)) {
    throw new Error(`${file} does not use the recorded immutable image ${expected}.`);
  }
}
