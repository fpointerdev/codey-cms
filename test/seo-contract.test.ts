import assert from "node:assert/strict";
import test from "node:test";
import {
  localizedPath,
  normalizeLocalizationSettings,
  publicLocaleCodes
} from "../src/modules/localization/localization.service.js";
import { CmsService } from "../src/modules/cms/cms.service.js";
import { buildSitemapXml } from "../src/modules/cms/sitemap.js";

const {
  createPageSeoDocument,
  createProductSeoDocument,
  injectSeoDocument,
  renderLanguageSwitcher,
  renderSeoHead
} = await import("../apps/web/web/seo-document.js");

test("shared SEO documents cover canonical, social, hreflang, and schema metadata", () => {
  const document = createPageSeoDocument({
    title: "About",
    slug: "about",
    locale: "en",
    excerpt: "About the studio.",
    translations: [
      { title: "About", slug: "about", locale: "en" },
      { title: "Rreth nesh", slug: "rreth-nesh", locale: "sq" }
    ]
  }, {
    origin: "https://example.com",
    siteName: "Example",
    siteDescription: "Example website",
    defaultLocale: "en"
  });
  const head = renderSeoHead(document);

  assert.equal(document.canonicalUrl, "https://example.com/about");
  assert.deepEqual(document.alternates, [
    { hreflang: "en", href: "https://example.com/about" },
    { hreflang: "sq", href: "https://example.com/sq/rreth-nesh" },
    { hreflang: "x-default", href: "https://example.com/about" }
  ]);
  assert.match(head, /name="twitter:title" content="About"/);
  assert.match(head, /property="og:site_name" content="Example"/);
  assert.match(head, /application\/ld\+json/);
  assert.match(head, /"@type":"WebPage"/);

  const injected = injectSeoDocument(
    '<!doctype html><html lang="fr"><head><title>Stale</title><meta name="description" content="Stale"></head><body></body></html>',
    document
  );
  assert.equal((injected.match(/<title\b/g) || []).length, 1);
  assert.doesNotMatch(injected, /Stale/);
  assert.match(injected, /<html lang="en">/);
});

test("language switchers use published alternates instead of guessing translated slugs", () => {
  const document = createPageSeoDocument({
    title: "About",
    slug: "about",
    locale: "en",
    translations: [
      { slug: "about", locale: "en" },
      { slug: "rreth-nesh", locale: "sq" }
    ]
  }, { origin: "https://example.com", siteName: "Example", defaultLocale: "en" });
  const html = renderLanguageSwitcher(document, {
    showLanguageSwitcher: true,
    languageSwitcherDisplay: "buttons",
    languageSwitcherLabelStyle: "full",
    defaultLocale: "en",
    locales: [
      { code: "en", label: "English", enabled: true },
      { code: "sq", label: "Shqip", enabled: true }
    ]
  });

  assert.match(html, /href="https:\/\/example\.com\/sq\/rreth-nesh"/);
  assert.match(html, /hreflang="sq"/);
  assert.doesNotMatch(html, /\/sq\/about/);
});

test("product SEO uses real commerce data without hardcoded business schema", () => {
  const document = createProductSeoDocument({
    name: "Desk lamp",
    slug: "desk-lamp",
    locale: "en",
    description: "A focused task light.",
    sku: "LAMP-1",
    priceCents: 12900,
    currency: "EUR",
    stockQuantity: 3,
    images: [{ url: "/uploads/lamp.jpg", alt: "Desk lamp", width: 1200, height: 900 }],
    translations: [{ name: "Desk lamp", slug: "desk-lamp", locale: "en" }]
  }, {
    origin: "https://example.com",
    siteName: "Example",
    defaultLocale: "en"
  });
  const schema = JSON.stringify(document.structuredData);

  assert.equal(document.openGraph.type, "product");
  assert.equal(document.openGraph.image.width, 1200);
  assert.match(schema, /"price":"129\.00"/);
  assert.match(schema, /https:\/\/schema\.org\/InStock/);
  assert.doesNotMatch(schema, /telephone|streetAddress/);
});

test("sitemap translation groups emit reciprocal locale and x-default links", () => {
  const updatedAt = new Date("2026-07-22T10:00:00.000Z");
  const sitemap = buildSitemapXml([
    { loc: "https://example.com/about", lastmod: updatedAt, locale: "en", groupKey: "page:about" },
    { loc: "https://example.com/sq/rreth-nesh", lastmod: updatedAt, locale: "sq", groupKey: "page:about" }
  ], "en");

  assert.match(sitemap, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.equal((sitemap.match(/hreflang="sq"/g) || []).length, 2);
  assert.equal((sitemap.match(/hreflang="x-default"/g) || []).length, 2);
  assert.match(sitemap, /href="https:\/\/example\.com\/sq\/rreth-nesh"/);
});

test("public locales exclude disabled routes and page paths encode each slug segment", () => {
  const disabled = normalizeLocalizationSettings({
    enabled: true,
    defaultLocale: "en",
    locales: [
      { code: "en", enabled: true },
      { code: "sq", enabled: true }
    ]
  }, false);
  const enabled = normalizeLocalizationSettings({
    enabled: true,
    defaultLocale: "en",
    locales: [
      { code: "en", enabled: true },
      { code: "sq", enabled: true },
      { code: "de", enabled: false }
    ]
  }, true);

  assert.deepEqual(publicLocaleCodes(disabled), ["en"]);
  assert.deepEqual(publicLocaleCodes(enabled), ["en", "sq"]);
  assert.equal(localizedPath("team/Jane Doe", "sq", "en"), "/sq/team/Jane%20Doe");
});

test("CMS sitemap does not cross-link unrelated records that share a slug", async () => {
  const updatedAt = new Date("2026-07-22T10:00:00.000Z");
  const localizationValue = {
    enabled: true,
    defaultLocale: "en",
    locales: [
      { code: "en", label: "English", enabled: true },
      { code: "sq", label: "Shqip", enabled: true },
      { code: "de", label: "Deutsch", enabled: false }
    ]
  };
  const pages = [
    { slug: "shared", locale: "en", translationGroupId: null, updatedAt },
    { slug: "shared", locale: "sq", translationGroupId: null, updatedAt },
    { slug: "hidden", locale: "de", translationGroupId: null, updatedAt }
  ];
  const service = new CmsService({
    site: { findUnique: async () => ({ id: "site-1" }) },
    installedModule: { findUnique: async () => ({ status: "ENABLED" }) },
    moduleSetting: {
      findFirst: async () => ({ value: { siteUrl: "https://example.com" } }),
      findUnique: async () => ({ value: localizationValue })
    },
    cmsPage: {
      findMany: async (args: { where: { locale: { in: string[] } } }) =>
        pages.filter((page) => args.where.locale.in.includes(page.locale))
    },
    cmsPost: { findMany: async () => [] },
    product: { findMany: async () => [] },
    productCategory: { findMany: async () => [] }
  } as never);

  const sitemap = await service.buildSitemap("https://fallback.example.com");
  const englishEntry = sitemap.match(/<url>\s*<loc>https:\/\/example\.com\/shared<\/loc>[\s\S]*?<\/url>/)?.[0] || "";

  assert.ok(englishEntry);
  assert.doesNotMatch(englishEntry, /https:\/\/example\.com\/sq\/shared/);
  assert.doesNotMatch(sitemap, /\/de\/hidden/);
});
