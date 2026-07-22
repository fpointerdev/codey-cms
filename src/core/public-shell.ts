export type PublicShellContent = {
  brand: string;
  body: string;
  footer: string;
  head?: string;
};

export function injectPublicShellContent(html: string, content: PublicShellContent) {
  return html
    .replace(
      /<\/head>/i,
      () => `${content.head ?? ""}</head>`
    )
    .replace(
      /(<a\b[^>]*\bdata-brand\b[^>]*>)[\s\S]*?(<\/a>)/i,
      (_match, openingTag: string, closingTag: string) => `${openingTag}${content.brand}${closingTag}`
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
