export type SitemapEntry = {
  loc: string;
  lastmod: Date;
  locale: string;
  groupKey: string;
};

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function emptySitemapXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    "</urlset>"
  ].join("\n");
}

export function buildSitemapXml(entries: SitemapEntry[], defaultLocale = "en") {
  const groups = new Map<string, SitemapEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.groupKey) ?? [];
    group.push(entry);
    groups.set(entry.groupKey, group);
  }

  const urls = entries.map((entry) => {
    const translations = groups.get(entry.groupKey) ?? [entry];
    const byLocale = new Map(translations.map((translation) => [translation.locale.toLowerCase(), translation]));
    const alternates = [...byLocale.entries()].sort(([left], [right]) => left.localeCompare(right));
    const defaultEntry = byLocale.get(defaultLocale.toLowerCase()) || alternates[0]?.[1];
    const links = [
      ...alternates.map(([locale, translation]) =>
        `    <xhtml:link rel="alternate" hreflang="${xmlEscape(locale)}" href="${xmlEscape(translation.loc)}" />`
      ),
      ...(defaultEntry
        ? [`    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(defaultEntry.loc)}" />`]
        : [])
    ];

    return [
      "  <url>",
      `    <loc>${xmlEscape(entry.loc)}</loc>`,
      `    <lastmod>${entry.lastmod.toISOString()}</lastmod>`,
      ...links,
      "  </url>"
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    "</urlset>"
  ].join("\n");
}
