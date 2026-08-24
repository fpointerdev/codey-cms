import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const id = String(process.argv[2] || "").trim().toLowerCase();
if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id)) {
  throw new Error("Usage: pnpm extension:create vendor.extension-name");
}

const directoryName = id.replaceAll(".", "-");
const directory = path.resolve("extensions", directoryName);
try {
  await access(directory);
  throw new Error(`Extension directory already exists: ${directory}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const name = id
  .split(/[.-]/)
  .slice(1)
  .join(" ")
  .replace(/\b\w/g, (character) => character.toUpperCase());
const manifest = {
  $schema: "https://raw.githubusercontent.com/fpointerdev/codey-cms/main/docs/schemas/codey-extension-1.0.schema.json",
  schemaVersion: "1.0",
  id,
  name,
  version: "0.1.0",
  description: `${name} content model pack.`,
  license: "GPL-2.0-or-later",
  author: { name: "Your name" },
  requires: { cms: ">=1.1.0 <2.0.0" },
  contentModels: [{
    name: "Items",
    slug: `${directoryName}-items`.slice(0, 80),
    description: "Content managed by this extension.",
    titleField: "title",
    publicRead: true,
    fields: [{
      key: "title",
      label: "Title",
      type: "text",
      required: true,
      multiple: false,
      maxLength: 160
    }]
  }]
};

await mkdir(directory, { recursive: true });
await writeFile(
  path.join(directory, "codey-extension.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);
console.log(`Created ${path.relative(process.cwd(), directory)}.`);
console.log("Run pnpm extension:validate before opening a pull request.");
