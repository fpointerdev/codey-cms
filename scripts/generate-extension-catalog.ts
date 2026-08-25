import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extensionManifestSha256 } from "../src/extensions/extension-integrity.js";
import { readExtensionManifest } from "../src/extensions/extension-registry.js";

const root = path.resolve("extensions");
const catalogPath = path.join(root, "catalog.json");
const check = process.argv.includes("--check");
const directories = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name)
  .sort();
const extensions = [];

for (const directory of directories) {
  const manifest = await readExtensionManifest(path.join(root, directory, "codey-extension.json"));
  extensions.push({
    id: manifest.id,
    version: manifest.version,
    directory,
    manifestSha256: extensionManifestSha256(manifest)
  });
}

const output = `${JSON.stringify({
  schemaVersion: 1,
  catalogVersion: "1.0.0",
  extensions
}, null, 2)}\n`;

if (check) {
  const current = await readFile(catalogPath, "utf8").catch(() => "");
  if (current !== output) throw new Error("extensions/catalog.json is not current. Run pnpm extension:catalog.");
  console.log(`Extension catalog is current (${extensions.length} entries).`);
} else {
  await writeFile(catalogPath, output, "utf8");
  console.log(`Generated extensions/catalog.json with ${extensions.length} entries.`);
}
