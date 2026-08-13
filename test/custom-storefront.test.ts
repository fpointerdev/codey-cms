import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  customStorefrontAssetCacheControl,
  resolveCustomStorefrontRoot
} from "../src/core/custom-storefront.js";

test("custom storefront requires a compiled index document", async () => {
  const root = await mkdtemp(join(tmpdir(), "codey-storefront-"));

  try {
    await assert.rejects(resolveCustomStorefrontRoot(root), /must contain an index\.html/);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Theme</title>");
    assert.equal(await resolveCustomStorefrontRoot(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("custom storefront assets revalidate after a deployment", () => {
  assert.equal(customStorefrontAssetCacheControl(true), "public, max-age=3600, must-revalidate");
  assert.equal(customStorefrontAssetCacheControl(false), "no-store");
});
