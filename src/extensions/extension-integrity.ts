import { createHash } from "node:crypto";
import type { ExtensionManifest } from "./extension-manifest.js";

export function canonicalExtensionJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalExtensionJson).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalExtensionJson(record[key])}`)
    .join(",")}}`;
}

export function extensionManifestSha256(manifest: ExtensionManifest) {
  return createHash("sha256").update(canonicalExtensionJson(manifest)).digest("hex");
}
