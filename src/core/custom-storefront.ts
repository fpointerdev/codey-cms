import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function resolveCustomStorefrontRoot(directory?: string) {
  if (!directory) return null;

  const root = resolve(process.cwd(), directory);
  try {
    await access(join(root, "index.html"));
    return root;
  } catch {
    throw new Error(`CUSTOM_STOREFRONT_DIR must contain an index.html file: ${root}`);
  }
}

export function customStorefrontAssetCacheControl(isProduction: boolean) {
  return isProduction
    ? "public, max-age=3600, must-revalidate"
    : "no-store";
}
