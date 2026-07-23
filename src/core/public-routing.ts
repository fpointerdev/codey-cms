export function canonicalPublicRedirectTarget(originalUrl: string, path: string) {
  if (path === "/" || !path.endsWith("/")) return null;

  const parsed = new URL(originalUrl, "https://codey.local");
  parsed.pathname = parsed.pathname.replace(/\/+$/g, "") || "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
