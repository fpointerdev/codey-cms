function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function originFromContext(context = {}) {
  const configured = text(context.origin || context.publicUrl);
  const browserOrigin = typeof window !== "undefined" ? window.location?.origin : "";
  const value = configured || browserOrigin || "http://localhost";

  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/g, "");
  }
}

function encodeSlug(slug = "") {
  return String(slug)
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function localePrefix(locale, defaultLocale) {
  const localeCode = text(locale, "en").toLowerCase();
  return localeCode === text(defaultLocale, "en").toLowerCase() ? "" : `/${encodeURIComponent(localeCode)}`;
}

export function localizedPagePath(slug = "home", locale = "en", defaultLocale = "en") {
  const normalizedSlug = encodeSlug(slug);
  const suffix = !normalizedSlug || normalizedSlug === "home" ? "" : `/${normalizedSlug}`;
  return `${localePrefix(locale, defaultLocale)}${suffix}` || "/";
}

export function localizedResourcePath(prefix, slug, locale = "en", defaultLocale = "en") {
  return `${localePrefix(locale, defaultLocale)}/${encodeURIComponent(prefix)}/${encodeSlug(slug)}`;
}

export function localizedShopPath(route = {}, locale = "en", defaultLocale = "en") {
  const suffix = route.category
    ? `/category/${encodeURIComponent(route.category)}`
    : route.attributeName
      ? `/attribute/${encodeURIComponent(route.attributeName)}/${encodeURIComponent(route.attributeValue || "")}`
      : "";
  const path = `${localePrefix(locale, defaultLocale)}/shop${suffix}`;
  return Number(route.page) > 1 ? `${path}?page=${Math.floor(Number(route.page))}` : path;
}

function absoluteUrl(value, context = {}) {
  const url = text(value);
  if (!url) return "";

  try {
    return new URL(url, `${originFromContext(context)}/`).toString();
  } catch {
    return "";
  }
}

function uploadPathForStorageKey(storageKey = "") {
  const cleanKey = String(storageKey).replace(/^\/+/, "");
  if (!cleanKey || cleanKey.split("/").includes("..")) return "";

  return `/uploads/${cleanKey.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function publicMediaUrl(value, context = {}) {
  const source = text(value);
  if (!source) return "";

  if (/^s3:\/\//i.test(source)) {
    const bucketAndKey = source.replace(/^s3:\/\//i, "");
    const slashIndex = bucketAndKey.indexOf("/");
    const key = slashIndex >= 0 ? bucketAndKey.slice(slashIndex + 1) : "";
    return absoluteUrl(uploadPathForStorageKey(decodeURIComponent(key)), context);
  }

  const publicBaseUrl = text(context.storagePublicBaseUrl).replace(/\/+$/g, "");
  if (publicBaseUrl && source.startsWith(`${publicBaseUrl}/`)) {
    return absoluteUrl(uploadPathForStorageKey(decodeURIComponent(source.slice(publicBaseUrl.length + 1))), context);
  }

  return absoluteUrl(source, context);
}

function mediaCandidate(value, fallbackAlt = "") {
  if (typeof value === "string") return { url: value, alt: fallbackAlt };
  if (!isRecord(value)) return null;

  const asset = isRecord(value.mediaAsset) ? value.mediaAsset : {};
  const url = text(value.url || value.src || asset.url);
  if (!url) return null;

  return {
    url,
    alt: text(value.alt || value.altText || asset.altText, fallbackAlt),
    width: positiveInteger(value.width || asset.width),
    height: positiveInteger(value.height || asset.height)
  };
}

function firstPageImage(page) {
  for (const section of Array.isArray(page?.sections) ? page.sections : []) {
    for (const block of Array.isArray(section?.blocks) ? section.blocks : []) {
      const value = block?.value;
      if (block?.type === "IMAGE") {
        const candidate = mediaCandidate(isRecord(value) ? { ...block.mediaAsset, ...value } : block.mediaAsset || value, block.label);
        if (candidate) return candidate;
      }

      if (block?.type === "GALLERY") {
        const items = Array.isArray(value)
          ? value
          : Array.isArray(value?.items)
            ? value.items
            : Array.isArray(value?.slides)
              ? value.slides
              : [];
        const candidate = mediaCandidate(items[0], block.label);
        if (candidate) return candidate;
      }

      if (isRecord(value)) {
        const candidate = mediaCandidate(value.image || value.media, block.label);
        if (candidate) return candidate;
      }
    }
  }

  return null;
}

function imageFrom(content, fallback, context) {
  const seo = isRecord(content?.seo) ? content.seo : {};
  const candidate = mediaCandidate(seo.image || fallback, content?.title || content?.name || "");
  if (!candidate) return undefined;

  const url = publicMediaUrl(candidate.url, context);
  if (!url) return undefined;

  return {
    url,
    ...(candidate.alt ? { alt: candidate.alt } : {}),
    ...(candidate.width ? { width: candidate.width } : {}),
    ...(candidate.height ? { height: candidate.height } : {})
  };
}

function hrefForTranslation(translation, kind, context) {
  if (translation.href) return absoluteUrl(translation.href, context);
  const defaultLocale = context.defaultLocale || "en";
  const locale = translation.locale || context.locale || defaultLocale;

  if (kind === "post" || kind === "product") {
    return absoluteUrl(localizedResourcePath(kind === "post" ? "posts" : "product", translation.slug, locale, defaultLocale), context);
  }
  if (kind === "shop") {
    return absoluteUrl(localizedShopPath(translation.route || context.route, locale, defaultLocale), context);
  }

  return absoluteUrl(localizedPagePath(translation.slug, locale, defaultLocale), context);
}

export function translationAlternates(translations = [], kind = "page", context = {}) {
  const records = Array.isArray(translations) ? [...translations] : [];
  if (!records.some((translation) => translation?.locale === context.locale)) {
    records.push({
      locale: context.locale || context.defaultLocale || "en",
      slug: context.slug || "home",
      route: context.route,
      href: context.canonicalUrl
    });
  }

  const byLocale = new Map();
  for (const translation of records) {
    const hreflang = text(translation?.locale).toLowerCase();
    const href = translation && hrefForTranslation(translation, kind, context);
    if (hreflang && href) byLocale.set(hreflang, { hreflang, href });
  }

  const alternates = [...byLocale.values()].sort((left, right) => left.hreflang.localeCompare(right.hreflang));
  const defaultLocale = text(context.defaultLocale, "en").toLowerCase();
  const defaultAlternate = byLocale.get(defaultLocale) || alternates[0];
  if (defaultAlternate) alternates.push({ hreflang: "x-default", href: defaultAlternate.href });

  return alternates;
}

function organizationGraph(context, origin) {
  const logoUrl = publicMediaUrl(context.organizationLogo, context);

  return {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: text(context.siteName, "Website"),
    url: `${origin}/`,
    ...(logoUrl ? { logo: { "@type": "ImageObject", url: logoUrl } } : {})
  };
}

function websiteGraph(context, origin, locale) {
  return {
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    url: `${origin}/`,
    name: text(context.siteName, "Website"),
    ...(text(context.siteDescription) ? { description: text(context.siteDescription) } : {}),
    inLanguage: locale,
    publisher: { "@id": `${origin}/#organization` }
  };
}

function plainText(value) {
  return text(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function faqPageEntity(page, canonicalUrl) {
  const questions = [];

  for (const section of Array.isArray(page?.sections) ? page.sections : []) {
    for (const block of Array.isArray(section?.blocks) ? section.blocks : []) {
      const value = isRecord(block?.value) ? block.value : {};
      const elementId = text(block?.settings?.elementId || section?.settings?.elementId).toLowerCase();
      const variant = text(value.variant || value.type).toLowerCase();
      if (elementId !== "faq-accordion" && variant !== "faq-accordion") continue;

      const items = Array.isArray(value.items)
        ? value.items
        : Array.isArray(value.questions)
          ? value.questions
          : [];

      for (const item of items) {
        if (!isRecord(item)) continue;
        const name = plainText(item.title || item.name || item.label);
        const answer = plainText(item.body || item.text || item.copy || item.description || item.content);
        if (!name || !answer) continue;

        questions.push({
          "@type": "Question",
          name,
          acceptedAnswer: {
            "@type": "Answer",
            text: answer
          }
        });
      }
    }
  }

  if (!questions.length) return null;

  return {
    "@type": "FAQPage",
    "@id": `${canonicalUrl}#faq`,
    mainEntity: questions.slice(0, 20)
  };
}

function structuredGraph(entity, context, locale, related = []) {
  const origin = originFromContext(context);
  return {
    "@context": "https://schema.org",
    "@graph": [organizationGraph(context, origin), websiteGraph(context, origin, locale), entity, ...related]
  };
}

export function createSeoDocument(input = {}) {
  const title = text(input.title, "Website");
  const description = text(input.description);
  const canonicalUrl = absoluteUrl(input.canonicalUrl, input);
  const imageSource = input.image?.url ? input.image : input.defaultImage;
  const imageUrl = imageSource?.url ? publicMediaUrl(imageSource.url, input) : "";
  const image = imageUrl
    ? {
        ...imageSource,
        url: imageUrl
      }
    : undefined;
  const faviconUrl = publicMediaUrl(input.faviconUrl, input);
  const type = text(input.type, "website");

  return {
    title,
    description,
    htmlLang: text(input.htmlLang, "en").toLowerCase(),
    noindex: input.noindex === true,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(faviconUrl ? { faviconUrl } : {}),
    alternates: Array.isArray(input.alternates) ? input.alternates : [],
    openGraph: {
      type,
      title,
      description,
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      ...(text(input.siteName) ? { siteName: text(input.siteName) } : {}),
      ...(image ? { image } : {})
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { image } : {})
    },
    structuredData: Array.isArray(input.structuredData) ? input.structuredData : []
  };
}

function contentContext(content, context = {}) {
  return {
    ...context,
    locale: content?.locale || context.locale || context.defaultLocale || "en",
    slug: content?.slug || context.slug || "home"
  };
}

export function createPageSeoDocument(page = {}, context = {}) {
  const resolved = contentContext(page, context);
  const canonicalUrl = absoluteUrl(
    context.canonicalUrl || localizedPagePath(page.slug, resolved.locale, resolved.defaultLocale),
    resolved
  );
  const image = imageFrom(page, firstPageImage(page), resolved);
  const title = text(page.metaTitle || page.title, resolved.siteName || "Website");
  const description = text(page.metaDescription || page.excerpt, resolved.siteDescription || "");
  const faq = faqPageEntity(page, canonicalUrl);
  const entity = {
    "@type": "WebPage",
    "@id": `${canonicalUrl}#webpage`,
    url: canonicalUrl,
    name: title,
    description,
    inLanguage: resolved.locale,
    isPartOf: { "@id": `${originFromContext(resolved)}/#website` },
    ...(image ? { primaryImageOfPage: { "@type": "ImageObject", url: image.url } } : {}),
    ...(faq ? { mainEntity: { "@id": faq["@id"] } } : {})
  };

  return createSeoDocument({
    ...resolved,
    title,
    description,
    htmlLang: resolved.locale,
    canonicalUrl,
    image,
    type: "website",
    alternates: translationAlternates(page.translations, "page", { ...resolved, canonicalUrl }),
    structuredData: [structuredGraph(entity, resolved, resolved.locale, faq ? [faq] : [])]
  });
}

export function createPostSeoDocument(post = {}, context = {}) {
  const resolved = contentContext(post, context);
  const canonicalUrl = absoluteUrl(
    context.canonicalUrl || localizedResourcePath("posts", post.slug, resolved.locale, resolved.defaultLocale),
    resolved
  );
  const image = imageFrom(post, null, resolved);
  const title = text(post.metaTitle || post.title, resolved.siteName || "Website");
  const description = text(post.metaDescription || post.excerpt, resolved.siteDescription || "");
  const entity = {
    "@type": "BlogPosting",
    "@id": `${canonicalUrl}#article`,
    url: canonicalUrl,
    headline: title,
    description,
    inLanguage: resolved.locale,
    mainEntityOfPage: { "@id": `${canonicalUrl}#webpage` },
    publisher: { "@id": `${originFromContext(resolved)}/#organization` },
    ...(post.publishedAt ? { datePublished: new Date(post.publishedAt).toISOString() } : {}),
    ...(post.updatedAt ? { dateModified: new Date(post.updatedAt).toISOString() } : {}),
    ...(image ? { image: image.url } : {})
  };

  return createSeoDocument({
    ...resolved,
    title,
    description,
    htmlLang: resolved.locale,
    canonicalUrl,
    image,
    type: "article",
    alternates: translationAlternates(post.translations, "post", { ...resolved, canonicalUrl }),
    structuredData: [structuredGraph(entity, resolved, resolved.locale)]
  });
}

export function createProductSeoDocument(product = {}, context = {}) {
  const resolved = contentContext(product, context);
  const canonicalUrl = absoluteUrl(
    context.canonicalUrl || localizedResourcePath("product", product.slug, resolved.locale, resolved.defaultLocale),
    resolved
  );
  const primaryImage = product.images?.find?.((item) => item?.isPrimary) || product.images?.[0];
  const image = imageFrom(product, primaryImage, resolved);
  const title = text(product.metaTitle || product.name, resolved.siteName || "Website");
  const description = text(product.metaDescription || product.description, resolved.siteDescription || "");
  const price = Number.isInteger(product.priceCents) ? (product.priceCents / 100).toFixed(2) : undefined;
  const entity = {
    "@type": "Product",
    "@id": `${canonicalUrl}#product`,
    url: canonicalUrl,
    name: title,
    description,
    ...(text(product.sku) ? { sku: text(product.sku) } : {}),
    ...(image ? { image: [image.url] } : {}),
    ...(price
      ? {
          offers: {
            "@type": "Offer",
            url: canonicalUrl,
            price,
            priceCurrency: text(product.currency, "USD").toUpperCase(),
            availability: Number(product.stockQuantity) > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock"
          }
        }
      : {})
  };

  return createSeoDocument({
    ...resolved,
    title,
    description,
    htmlLang: resolved.locale,
    canonicalUrl,
    image,
    type: "product",
    alternates: translationAlternates(product.translations, "product", { ...resolved, canonicalUrl }),
    structuredData: [structuredGraph(entity, resolved, resolved.locale)]
  });
}

export function createShopSeoDocument(shop = {}, context = {}) {
  const resolved = contentContext({ locale: shop.locale }, context);
  const route = shop.route || context.route || {};
  const canonicalUrl = absoluteUrl(context.canonicalUrl || localizedShopPath(route, resolved.locale, resolved.defaultLocale), resolved);
  const pageTitle = text(shop.title, "Shop");
  const title = Number(route.page) > 1 ? `${pageTitle} - Page ${Math.floor(Number(route.page))}` : pageTitle;
  const description = text(shop.description, resolved.siteDescription || "");
  const entity = {
    "@type": "CollectionPage",
    "@id": `${canonicalUrl}#collection`,
    url: canonicalUrl,
    name: title,
    description,
    inLanguage: resolved.locale,
    isPartOf: { "@id": `${originFromContext(resolved)}/#website` }
  };

  return createSeoDocument({
    ...resolved,
    title: resolved.siteName ? `${title} | ${resolved.siteName}` : title,
    description,
    htmlLang: resolved.locale,
    canonicalUrl,
    type: "website",
    alternates: translationAlternates(shop.translations, "shop", { ...resolved, route, canonicalUrl }),
    structuredData: [structuredGraph(entity, resolved, resolved.locale)]
  });
}

export function createGenericSeoDocument(input = {}) {
  const context = contentContext({}, input);
  const canonicalUrl = absoluteUrl(input.canonicalUrl, context);
  const entity = canonicalUrl
    ? {
        "@type": "WebPage",
        "@id": `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: text(input.title, context.siteName || "Website"),
        description: text(input.description),
        inLanguage: context.locale,
        isPartOf: { "@id": `${originFromContext(context)}/#website` }
      }
    : null;

  return createSeoDocument({
    ...context,
    ...input,
    htmlLang: input.htmlLang || context.locale,
    structuredData: entity && !input.noindex ? [structuredGraph(entity, context, context.locale)] : []
  });
}

function imageMetaTags(prefix, image) {
  if (!image?.url) return [];
  const attribute = prefix === "og" ? "property" : "name";
  const name = (suffix) => prefix === "og" ? `og:${suffix}` : `twitter:${suffix}`;

  return [
    `<meta ${attribute}="${name("image")}" content="${escapeHtml(image.url)}" data-codey-seo />`,
    image.alt ? `<meta ${attribute}="${name("image:alt")}" content="${escapeHtml(image.alt)}" data-codey-seo />` : "",
    prefix === "og" && image.width ? `<meta property="og:image:width" content="${image.width}" data-codey-seo />` : "",
    prefix === "og" && image.height ? `<meta property="og:image:height" content="${image.height}" data-codey-seo />` : ""
  ].filter(Boolean);
}

export function renderSeoHead(document) {
  const tags = [
    `<title data-codey-seo>${escapeHtml(document.title)}</title>`,
    `<meta name="description" content="${escapeHtml(document.description)}" data-codey-seo />`,
    `<meta name="robots" content="${document.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large"}" data-codey-seo />`,
    document.canonicalUrl ? `<link rel="canonical" href="${escapeHtml(document.canonicalUrl)}" data-codey-seo />` : "",
    document.faviconUrl ? `<link rel="icon" href="${escapeHtml(document.faviconUrl)}" data-codey-seo />` : "",
    ...document.alternates.map((alternate) => `<link rel="alternate" hreflang="${escapeHtml(alternate.hreflang)}" href="${escapeHtml(alternate.href)}" data-codey-seo />`),
    `<meta property="og:type" content="${escapeHtml(document.openGraph.type)}" data-codey-seo />`,
    `<meta property="og:title" content="${escapeHtml(document.openGraph.title)}" data-codey-seo />`,
    `<meta property="og:description" content="${escapeHtml(document.openGraph.description)}" data-codey-seo />`,
    document.openGraph.url ? `<meta property="og:url" content="${escapeHtml(document.openGraph.url)}" data-codey-seo />` : "",
    document.openGraph.siteName ? `<meta property="og:site_name" content="${escapeHtml(document.openGraph.siteName)}" data-codey-seo />` : "",
    ...imageMetaTags("og", document.openGraph.image),
    `<meta name="twitter:card" content="${escapeHtml(document.twitter.card)}" data-codey-seo />`,
    `<meta name="twitter:title" content="${escapeHtml(document.twitter.title)}" data-codey-seo />`,
    `<meta name="twitter:description" content="${escapeHtml(document.twitter.description)}" data-codey-seo />`,
    ...imageMetaTags("twitter", document.twitter.image),
    ...document.structuredData.map((schema) => `<script type="application/ld+json" data-codey-seo>${safeJson(schema)}</script>`),
    `<script id="codey-seo-document" type="application/json" data-codey-seo>${safeJson(document)}</script>`
  ];

  return tags.filter(Boolean).join("\n    ");
}

export function renderLanguageSwitcher(document, localization = {}) {
  const locales = Array.isArray(localization.locales)
    ? localization.locales.filter((locale) => locale?.enabled !== false && locale?.code)
    : [];
  if (!localization.showLanguageSwitcher || locales.length < 2) return "";

  const links = new Map(
    (document.alternates || [])
      .filter((alternate) => alternate.hreflang !== "x-default")
      .map((alternate) => [alternate.hreflang.toLowerCase(), alternate.href])
  );
  const activeLocale = text(document.htmlLang, localization.defaultLocale || "en").toLowerCase();
  const labelStyle = ["full", "code", "icon"].includes(localization.languageSwitcherLabelStyle)
    ? localization.languageSwitcherLabelStyle
    : "full";
  const label = text(localization.strings?.["language.switcher"]?.[activeLocale], "Language switcher");
  const localeLabel = (locale) => labelStyle === "full" ? text(locale.label, locale.code.toUpperCase()) : locale.code.toUpperCase();

  if (localization.languageSwitcherDisplay === "dropdown") {
    return `
      <span class="language-switcher language-switcher-dropdown" data-language-switcher-shell>
        <label class="visually-hidden" for="language-switcher-select">${escapeHtml(label)}</label>
        <select id="language-switcher-select" class="language-switcher-select" data-language-select aria-label="${escapeHtml(label)}">
          ${locales.map((locale) => {
            const code = String(locale.code).toLowerCase();
            const href = links.get(code);
            return `<option value="${escapeHtml(href || "")}"${code === activeLocale ? " selected" : ""}${href ? "" : " disabled"}>${escapeHtml(localeLabel(locale))}</option>`;
          }).join("")}
        </select>
      </span>
    `;
  }

  return `
    <span class="language-switcher language-switcher-buttons" role="group" aria-label="${escapeHtml(label)}" data-language-switcher-shell>
      ${locales.map((locale) => {
        const code = String(locale.code).toLowerCase();
        const href = links.get(code);
        const content = `${labelStyle === "icon" ? '<span class="language-switcher-icon" aria-hidden="true"></span>' : ""}${escapeHtml(localeLabel(locale))}`;
        return href
          ? `<a class="language-switcher-item ${code === activeLocale ? "active" : ""}" href="${escapeHtml(href)}" hreflang="${escapeHtml(code)}" title="${escapeHtml(locale.label || code)}">${content}</a>`
          : `<span class="language-switcher-item disabled" title="${escapeHtml(locale.label || code)}">${content}</span>`;
      }).join("")}
    </span>
  `;
}

export function injectSeoDocument(html, document) {
  const htmlLang = escapeHtml(document.htmlLang || "en");
  const cleanHtml = html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/\s*<meta\s+name=(["'])description\1[^>]*\/?\s*>/gi, "")
    .replace(/\s*<(?:meta|link)\b[^>]*data-codey-seo[^>]*\/?\s*>/gi, "")
    .replace(/\s*<script\b[^>]*data-codey-seo[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(document.faviconUrl ? /\s*<link\b(?=[^>]*\brel=(["'])[^"']*\bicon\b[^"']*\1)[^>]*\/?\s*>/gi : /$^/, "")
    .replace(/<html\b[^>]*>/i, (tag) => {
      if (/\slang=(["']).*?\1/i.test(tag)) return tag.replace(/\slang=(["']).*?\1/i, ` lang="${htmlLang}"`);
      return tag.replace(/<html\b/i, `<html lang="${htmlLang}"`);
    });

  return cleanHtml.replace(/<\/head>/i, `    ${renderSeoHead(document)}\n  </head>`);
}

export function applySeoDocument(document) {
  if (typeof window === "undefined" || !window.document?.head) return;

  const head = window.document.head;
  head.querySelectorAll("[data-codey-seo]").forEach((element) => element.remove());
  head.querySelectorAll("title, meta[name='description']").forEach((element) => element.remove());
  if (document.faviconUrl) {
    head.querySelectorAll("link[rel~='icon']").forEach((element) => element.remove());
  }
  head.insertAdjacentHTML("beforeend", renderSeoHead(document));
  if (window.document.documentElement) window.document.documentElement.lang = document.htmlLang || "en";
}

export function readServerSeoDocument() {
  if (typeof window === "undefined") return null;
  const element = window.document?.getElementById("codey-seo-document");
  if (!element?.textContent) return null;

  try {
    return JSON.parse(element.textContent);
  } catch {
    return null;
  }
}
