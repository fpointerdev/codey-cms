import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { extensionManifestSchema } from "../src/extensions/extension-manifest.js";
import {
  discoverExtensions,
  satisfiesCmsVersion
} from "../src/extensions/extension-registry.js";

const manifest = {
  $schema: "https://raw.githubusercontent.com/fpointerdev/codey-cms/main/docs/schemas/codey-extension-1.0.schema.json",
  schemaVersion: "1.0",
  id: "example.resources",
  name: "Resources",
  version: "1.2.0",
  description: "Resource content models.",
  license: "GPL-2.0-or-later",
  author: { name: "Example" },
  requires: { cms: ">=1.0.0 <2.0.0" },
  contentModels: [{
    name: "Resources",
    slug: "resources",
    titleField: "title",
    publicRead: true,
    fields: [{
      key: "title",
      label: "Title",
      type: "text",
      required: true,
      multiple: false
    }]
  }]
} as const;

test("extension manifests allow declarative models but reject executable payloads", () => {
  assert.equal(extensionManifestSchema.parse(manifest).id, "example.resources");
  assert.equal(extensionManifestSchema.safeParse({ ...manifest, serverEntry: "index.js" }).success, false);
  assert.equal(extensionManifestSchema.safeParse({
    ...manifest,
    contentModels: [...manifest.contentModels, { ...manifest.contentModels[0] }]
  }).success, false);
});

test("extension compatibility supports bounded semantic version ranges", () => {
  assert.equal(satisfiesCmsVersion("1.0.0", ">=1.0.0 <2.0.0"), true);
  assert.equal(satisfiesCmsVersion("1.8.4", "^1.2.0"), true);
  assert.equal(satisfiesCmsVersion("0.9.9", "^0.9.0"), true);
  assert.equal(satisfiesCmsVersion("0.10.0", "^0.9.0"), false);
  assert.equal(satisfiesCmsVersion("0.0.4", "^0.0.3"), false);
  assert.equal(satisfiesCmsVersion("2.0.0", ">=1.0.0 <2.0.0"), false);
  assert.equal(satisfiesCmsVersion("1.0.0", "latest"), false);
});

test("extension discovery isolates invalid manifests without hiding valid packs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codey-extensions-"));
  try {
    await mkdir(path.join(root, "valid"));
    await mkdir(path.join(root, "invalid"));
    await writeFile(path.join(root, "valid", "codey-extension.json"), JSON.stringify(manifest), "utf8");
    await writeFile(path.join(root, "invalid", "codey-extension.json"), "{}", "utf8");

    const result = await discoverExtensions(root);
    assert.deepEqual(result.extensions.map((extension) => extension.id), ["example.resources"]);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.directory, "invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the published extension schema identifies every supported field type", async () => {
  const schema = JSON.parse(await readFile("docs/schemas/codey-extension-1.0.schema.json", "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.properties.schemaVersion.const, "1.0");
  assert.deepEqual(schema.$defs.contentField.properties.type.enum, [
    "text",
    "textarea",
    "richText",
    "email",
    "url",
    "number",
    "boolean",
    "date",
    "dateTime",
    "image",
    "file",
    "select",
    "relation"
  ]);
});
