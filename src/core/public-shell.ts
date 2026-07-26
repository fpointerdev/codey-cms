export type PublicShellContent = {
  brand: string;
  body: string;
  bodyAttributes?: Record<string, string>;
  footer: string;
  head?: string;
  menu?: string;
};

export function injectPublicShellContent(html: string, content: PublicShellContent) {
  return html
    .replace(
      /<body([^>]*)>/i,
      (_match, attributes: string) => `<body${attributes}${renderBodyAttributes(content.bodyAttributes)}>`
    )
    .replace(
      /<\/head>/i,
      () => `${content.head ?? ""}</head>`
    )
    .replace(
      /(<a\b[^>]*\bdata-brand\b[^>]*>)[\s\S]*?(<\/a>)/i,
      (_match, openingTag: string, closingTag: string) => `${openingTag}${content.brand}${closingTag}`
    )
    .replace(
      /(<nav\b[^>]*\bdata-menu\b[^>]*>)[\s\S]*?(<\/nav>)/i,
      (_match, openingTag: string, closingTag: string) => `${openingTag}${content.menu ?? ""}${closingTag}`
    )
    .replace(
      /<article\s+data-page><\/article>/i,
      () => `<article data-page data-server-rendered="true">${content.body}</article>`
    )
    .replace(
      /<footer\b([^>]*)\bdata-footer\b([^>]*)>[\s\S]*?<\/footer>/i,
      (_match, beforeAttribute: string, afterAttribute: string) =>
        `<footer${beforeAttribute}data-footer${afterAttribute}>${content.footer}</footer>`
    );
}

function renderBodyAttributes(attributes: Record<string, string> | undefined) {
  if (!attributes) return "";

  return Object.entries(attributes)
    .filter(([name, value]) => /^data-[a-z0-9-]+$/.test(name) && Boolean(value))
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
}

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
