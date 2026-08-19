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

export function isCmsOwnedPublicPath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 2) return parts[0] === "account" && parts[1] === "orders";
  if (parts.length !== 3 || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(parts[0] ?? "")) {
    return false;
  }

  return parts[1] === "account" && parts[2] === "orders";
}
