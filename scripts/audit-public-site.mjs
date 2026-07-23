import { chromium } from "@playwright/test";

const baseUrl = new URL(process.argv[2] || process.env.PUBLIC_AUDIT_URL || "http://127.0.0.1:4173");
const maxUrls = Math.max(1, Number(process.env.PUBLIC_AUDIT_MAX_URLS || 500));
const errors = [];

function normalizedUrl(value) {
  const url = new URL(value, baseUrl);
  url.hash = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/g, "");
  return url.toString();
}

async function fetchDocument(url) {
  const response = await fetch(url, {
    redirect: "manual",
    headers: { accept: "text/html,application/xhtml+xml" }
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    body: await response.text()
  };
}

const browser = await chromium.launch({ headless: true });
const parserPage = await browser.newPage();

try {
  const sitemapUrl = new URL("/sitemap.xml", baseUrl).toString();
  const sitemap = await fetchDocument(sitemapUrl);
  if (sitemap.status !== 200) throw new Error(`Sitemap returned HTTP ${sitemap.status}: ${sitemapUrl}`);

  const sitemapUrls = await parserPage.evaluate((xml) => {
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) return [];
    return [...document.querySelectorAll("url > loc")].map((element) => element.textContent?.trim()).filter(Boolean);
  }, sitemap.body);
  const urls = [...new Set(sitemapUrls.map(normalizedUrl))].slice(0, maxUrls);
  if (!urls.length) throw new Error("Sitemap does not contain any public URLs.");

  const pages = new Map();
  const internalLinks = new Set();

  for (const url of urls) {
    const response = await fetchDocument(url);
    if (response.status !== 200) {
      errors.push(`${url}: expected HTTP 200, received ${response.status}${response.location ? ` -> ${response.location}` : ""}`);
      continue;
    }

    const result = await parserPage.evaluate(({ html, documentUrl, expectedOrigin }) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
      const alternates = [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((element) => ({
        hreflang: element.getAttribute("hreflang") || "",
        href: element.getAttribute("href") || ""
      }));
      const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')].map((element) => {
        try {
          JSON.parse(element.textContent || "");
          return true;
        } catch {
          return false;
        }
      });
      const images = [...document.querySelectorAll("img")].map((image) => ({
        src: image.getAttribute("src") || "",
        hasAlt: image.hasAttribute("alt"),
        width: Number(image.getAttribute("width")),
        height: Number(image.getAttribute("height"))
      }));
      const links = [...document.querySelectorAll("a[href]")].flatMap((anchor) => {
        const href = anchor.getAttribute("href") || "";
        if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) return [];
        try {
          const resolved = new URL(href, documentUrl);
          return resolved.origin === expectedOrigin ? [resolved.toString()] : [];
        } catch {
          return [];
        }
      });

      return {
        canonical,
        h1Count: document.querySelectorAll("h1").length,
        alternates,
        schemas,
        images,
        links
      };
    }, { html: response.body, documentUrl: url, expectedOrigin: baseUrl.origin });

    const canonical = result.canonical ? normalizedUrl(result.canonical) : "";
    if (canonical !== normalizedUrl(url)) errors.push(`${url}: canonical is not self-referencing (${result.canonical || "missing"}).`);
    if (result.h1Count !== 1) errors.push(`${url}: expected one H1, found ${result.h1Count}.`);
    if (!result.alternates.some((alternate) => alternate.hreflang === "x-default")) {
      errors.push(`${url}: missing x-default hreflang.`);
    }
    if (!result.alternates.some((alternate) => alternate.hreflang !== "x-default")) {
      errors.push(`${url}: missing locale hreflang.`);
    }
    if (!result.schemas.length || result.schemas.some((valid) => !valid)) {
      errors.push(`${url}: missing or invalid JSON-LD.`);
    }

    result.images.forEach((image) => {
      if (!image.hasAlt) errors.push(`${url}: image is missing alt (${image.src || "unknown source"}).`);
      if (!image.width || !image.height) errors.push(`${url}: image is missing intrinsic dimensions (${image.src || "unknown source"}).`);
    });
    result.links.forEach((link) => internalLinks.add(normalizedUrl(link)));
    pages.set(normalizedUrl(url), result);
  }

  for (const [url, result] of pages) {
    for (const alternate of result.alternates.filter((item) => item.hreflang !== "x-default")) {
      const targetUrl = normalizedUrl(alternate.href);
      const target = pages.get(targetUrl);
      if (!target) {
        errors.push(`${url}: hreflang target is not present in the sitemap (${targetUrl}).`);
        continue;
      }
      if (!target.alternates.some((item) => normalizedUrl(item.href) === url)) {
        errors.push(`${url}: hreflang target does not link back (${targetUrl}).`);
      }
    }
  }

  for (const link of internalLinks) {
    const response = await fetch(link, { redirect: "manual" });
    if (response.status >= 400 || response.status === 0) errors.push(`${link}: broken internal link returned HTTP ${response.status}.`);
  }

  if (errors.length) {
    console.error(`Public audit failed with ${errors.length} issue${errors.length === 1 ? "" : "s"}:`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
  } else {
    console.log(`Public audit passed: ${pages.size} sitemap URLs and ${internalLinks.size} internal links checked.`);
  }
} finally {
  await browser.close();
}
