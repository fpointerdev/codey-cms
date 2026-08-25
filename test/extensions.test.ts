import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { extensionCatalogSchema } from "../src/extensions/extension-catalog.js";
import { extensionManifestSha256 } from "../src/extensions/extension-integrity.js";
import { extensionManifestSchema } from "../src/extensions/extension-manifest.js";
import {
  compareSemanticVersions,
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
  assert.equal(extensionManifestSchema.safeParse({ ...manifest, version: "1.2.0-beta..1" }).success, false);
  assert.equal(extensionManifestSchema.safeParse({ ...manifest, version: "01.2.0" }).success, false);
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
  assert.equal(compareSemanticVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareSemanticVersions("1.2.0", "1.2.0"), 0);
  assert.equal(Math.sign(compareSemanticVersions("1.2.0-beta.2", "1.2.0-beta.10")!), -1);
  assert.equal(Math.sign(compareSemanticVersions("1.2.0-rc.1", "1.2.0")!), -1);
  assert.equal(Math.sign(compareSemanticVersions("1.2.0", "1.2.0-rc.1")!), 1);
  assert.equal(satisfiesCmsVersion("1.2.0-rc.1", ">=1.2.0"), false);
  assert.equal(compareSemanticVersions("invalid", "1.2.0"), null);
});

test("catalog discovery fails closed when a bundled manifest checksum changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codey-catalog-"));
  try {
    await mkdir(path.join(root, "resources"));
    await writeFile(path.join(root, "resources", "codey-extension.json"), JSON.stringify(manifest), "utf8");
    const parsed = extensionManifestSchema.parse(manifest);
    const catalog = {
      schemaVersion: 1,
      catalogVersion: "1.0.0",
      extensions: [{
        id: parsed.id,
        version: parsed.version,
        directory: "resources",
        manifestSha256: extensionManifestSha256(parsed)
      }]
    };
    assert.equal(extensionCatalogSchema.safeParse(catalog).success, true);
    await writeFile(path.join(root, "catalog.json"), JSON.stringify(catalog), "utf8");

    const verified = await discoverExtensions(root);
    assert.equal(verified.failures.length, 0);
    assert.equal(verified.extensions[0]?.provenance.catalogVerified, true);

    catalog.extensions[0].manifestSha256 = "0".repeat(64);
    await writeFile(path.join(root, "catalog.json"), JSON.stringify(catalog), "utf8");
    const changed = await discoverExtensions(root);
    assert.equal(changed.extensions.length, 0);
    assert.match(changed.failures[0]?.message || "", /checksum/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extension discovery isolates invalid manifests without hiding valid packs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codey-extensions-"));
  try {
    await mkdir(path.join(root, "valid"));
    await mkdir(path.join(root, "invalid"));
    await writeFile(path.join(root, "valid", "codey-extension.json"), JSON.stringify(manifest), "utf8");
    await writeFile(path.join(root, "invalid", "codey-extension.json"), "{}", "utf8");

    const result = await discoverExtensions(root);
    assert.deepEqual(result.extensions.map((extension) => extension.manifest.id), ["example.resources"]);
    assert.equal(result.extensions[0]?.provenance.source, "operator");
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
  assert.ok(schema.properties.categories.items.enum.includes("directory"));
  assert.equal(schema.properties.support.$ref, "#/$defs/httpUrl");
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
