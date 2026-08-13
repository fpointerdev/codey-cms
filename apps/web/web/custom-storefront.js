import { state } from "./core.js";

function safePublicPath(value, fallback) {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return fallback;

  return path;
}

function withStorefrontParams(href, values) {
  const url = new URL(href, window.location.origin);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && String(value)) url.searchParams.set(key, String(value));
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function localizedStorefrontPath(href, page) {
  const localization = state.config?.localization;
  const locale = String(page?.locale || localization?.defaultLocale || "en").toLowerCase();
  const defaultLocale = String(localization?.defaultLocale || "en").toLowerCase();
  if (!localization?.enabled || locale === defaultLocale) return href;

  const url = new URL(href, window.location.origin);
  const prefix = `/${encodeURIComponent(locale)}`;
  if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) return href;

  url.pathname = `${prefix}${url.pathname === "/" ? "" : url.pathname}`;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function usesCustomStorefront() {
  return Boolean(state.config?.app?.customStorefrontDir);
}

export function customStorefrontPageHref(page, fallback) {
  if (!usesCustomStorefront()) return fallback;

  return localizedStorefrontPath(safePublicPath(page?.content?.publicPath, fallback), page);
}

export function customStorefrontPreviewHref(page, fallback) {
  const href = customStorefrontPageHref(page, fallback);
  if (!usesCustomStorefront()) return href;

  return withStorefrontParams(href, {
    "codey-block": page?.content?.editorBlock,
    "codey-page": page?.slug,
    "codey-preview": "1",
    locale: page?.locale
  });
}

export function customStorefrontEditorHref(page, fallback) {
  const href = customStorefrontPageHref(page, fallback);
  if (!usesCustomStorefront()) return withStorefrontParams(href, { edit: "1" });

  return withStorefrontParams(href, {
    "codey-block": page?.content?.editorBlock,
    "codey-page": page?.slug,
    edit: "1",
    locale: page?.locale
  });
}
