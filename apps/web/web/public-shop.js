import { elements, escapeHtml, formatMoney, setStatus, state, translateString } from "./core.js";
import { currentLocale } from "./routes.js";

function primaryImage(product = {}) {
  return product.images?.find((image) => image.isPrimary) || product.images?.[0] || null;
}

function productAttributes(product = {}) {
  const metadata = product.metadata && typeof product.metadata === "object" ? product.metadata : {};
  return Array.isArray(metadata.attributes) ? metadata.attributes : [];
}

function attributeSlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function localizedShopPath(path) {
  const locale = currentLocale();
  const defaultLocale = state.config?.localization?.defaultLocale || "en";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return locale === defaultLocale ? normalizedPath : `/${locale}${normalizedPath}`;
}

function encodePathSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function uploadPathForStorageKey(key = "") {
  const cleanKey = String(key || "").replace(/^\/+/, "");
  if (!cleanKey || cleanKey.split("/").includes("..")) return "";

  return `/uploads/${cleanKey.split("/").map(encodePathSegment).join("/")}`;
}

function uploadPathForS3Url(src = "") {
  const value = String(src || "").trim();
  if (!/^s3:\/\//i.test(value)) return "";

  const bucketAndKey = value.replace(/^s3:\/\//i, "");
  const slashIndex = bucketAndKey.indexOf("/");
  const key = slashIndex >= 0 ? bucketAndKey.slice(slashIndex + 1) : "";

  try {
    return uploadPathForStorageKey(decodeURIComponent(key));
  } catch {
    return uploadPathForStorageKey(key);
  }
}

function uploadPathForConfiguredStorageUrl(src = "") {
  const publicBaseUrl = String(state.config?.storage?.publicBaseUrl || "").replace(/\/+$/g, "");
  if (!publicBaseUrl || !src.startsWith(`${publicBaseUrl}/`)) return "";

  const key = src.slice(publicBaseUrl.length + 1);

  try {
    return uploadPathForStorageKey(decodeURIComponent(key));
  } catch {
    return uploadPathForStorageKey(key);
  }
}

function safeMediaSrc(value = "") {
  const src = String(value || "").trim();
  if (!src) return "";

  const s3Src = uploadPathForS3Url(src);
  if (s3Src) return s3Src;

  const configuredStorageSrc = uploadPathForConfiguredStorageUrl(src);
  if (configuredStorageSrc) return configuredStorageSrc;

  if (/^(https?:\/\/|\/|\.\/)/i.test(src)) return src;

  return "";
}

function responsiveImageWidths() {
  const configuredWidths = state.config?.storage?.imageVariantWidths;

  if (!Array.isArray(configuredWidths)) return [320, 640, 1200];

  const widths = configuredWidths
    .map(Number)
    .filter((width) => Number.isInteger(width) && width >= 160 && width <= 2400);

  return widths.length ? [...new Set(widths)].sort((left, right) => left - right) : [320, 640, 1200];
}

function isUploadedImageSrc(src = "") {
  const cleanSrc = String(src || "").split("?")[0] || "";

  return /\/uploads\//.test(cleanSrc) && /\.(png|jpe?g|webp)$/i.test(cleanSrc);
}

function imageVariantSrc(src, width) {
  return `${src}${src.includes("?") ? "&" : "?"}w=${width}`;
}

function renderProductImage(image, fallbackAlt = "", className = "", priority = false) {
  const src = safeMediaSrc(image?.url);
  if (!src) return "";

  const widths = responsiveImageWidths();
  const srcset = isUploadedImageSrc(src)
    ? ` srcset="${escapeHtml(widths.map((width) => `${imageVariantSrc(src, width)} ${width}w`).join(", "))}" sizes="(max-width: 760px) 92vw, 34vw"`
    : "";
  const loadingAttrs = priority
    ? 'loading="eager" decoding="async" fetchpriority="high"'
    : 'loading="lazy" decoding="async"';

  return `<img${className ? ` class="${escapeHtml(className)}"` : ""} src="${escapeHtml(src)}" alt="${escapeHtml(image?.alt || fallbackAlt)}"${srcset} ${loadingAttrs} />`;
}

function productCard(product) {
  const image = primaryImage(product);
  const imageHtml = renderProductImage(image, product.name);

  return `
    <article class="shop-product-card">
      <a href="${escapeHtml(localizedShopPath(`/product/${product.slug}`))}">
        ${imageHtml || `<div class="shop-product-image-placeholder">${escapeHtml(translateString("shop.noImage", "No image"))}</div>`}
        <span>${escapeHtml(product.category?.name || translateString("shop.product", "Product"))}</span>
        <strong>${escapeHtml(product.name)}</strong>
      </a>
      <p>${escapeHtml(product.description || "")}</p>
      <div>
        <small>${escapeHtml(product.sku || translateString("shop.noSku", "No SKU"))}</small>
        <b>${escapeHtml(formatMoney(product.priceCents, product.currency || "EUR"))}</b>
      </div>
    </article>
  `;
}

function categoryLinks(categories = [], activeSlug = "") {
  return `
    <div class="shop-filter-row">
      <a href="${escapeHtml(localizedShopPath("/shop"))}" class="${activeSlug ? "" : "active"}">${escapeHtml(translateString("shop.allProducts", "All products"))}</a>
      ${categories
        .map(
          (category) => `<a href="${escapeHtml(localizedShopPath(`/shop/category/${category.slug}`))}" class="${category.slug === activeSlug ? "active" : ""}">${escapeHtml(category.name)}</a>`
        )
        .join("")}
    </div>
  `;
}

function attributeLinks(attributes = [], route = {}) {
  return `
    <div class="shop-filter-groups">
      ${attributes
        .map((attribute) => {
          const values = Array.isArray(attribute.values) ? attribute.values : [];
          if (!values.length) return "";

          return `
            <div class="shop-filter-group">
              <strong>${escapeHtml(attribute.name)}</strong>
              <div class="shop-filter-row compact">
                ${values
                  .map((value) => {
                    const slug = attributeSlug(value);
                    const active = route.attributeName === attribute.slug && route.attributeValue === slug;
                    return `<a href="${escapeHtml(localizedShopPath(`/shop/attribute/${attribute.slug}/${slug}`))}" class="${active ? "active" : ""}">${escapeHtml(value)}</a>`;
                  })
                  .join("")}
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderShopListing({ products = [], categories = [], attributes = [], route = {} }) {
  const title = route.category
    ? categories.find((category) => category.slug === route.category)?.name || translateString("shop.category", "Category")
    : route.attributeValue
      ? `${route.attributeName}: ${route.attributeValue}`.replaceAll("-", " ")
      : translateString("shop.title", "Shop");

  document.title = title;
  elements.brand.textContent = translateString("shop.title", "Shop");
  elements.brand.href = "/";
  elements.page.innerHTML = `
    <section class="shop-public-page">
      <header class="shop-public-header">
        <p class="section-label">${escapeHtml(translateString("shop.catalog", "Catalog"))}</p>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(translateString("shop.browseCopy", "Browse products by category or technical attributes."))}</p>
      </header>
      <aside class="shop-public-filters">
        ${categoryLinks(categories, route.category || "")}
        ${attributeLinks(attributes, route)}
      </aside>
      <div class="shop-product-grid">
        ${products.length ? products.map(productCard).join("") : `<div class="fallback-content">${escapeHtml(translateString("shop.empty", "No products match this filter yet."))}</div>`}
      </div>
    </section>
  `;
  elements.footer.innerHTML = "";
  document.body.classList.remove("auth-enabled", "dashboard-enabled", "editor-enabled");
  setStatus(`${products.length} ${translateString("shop.productsLoaded", "products loaded.")}`);
}

export function renderProductDetail(product) {
  const image = primaryImage(product);
  const imageHtml = renderProductImage(image, product.name, "", true);
  const attributes = productAttributes(product);

  document.title = product.name;
  elements.brand.textContent = product.name;
  elements.brand.href = "/";
  elements.page.innerHTML = `
    <article class="shop-product-detail">
      <a class="secondary-button" href="${escapeHtml(localizedShopPath("/shop"))}">${escapeHtml(translateString("shop.backToShop", "Back to shop"))}</a>
      <section class="shop-product-detail-hero">
        <div>
          ${imageHtml || `<div class="shop-product-image-placeholder large">${escapeHtml(translateString("shop.noImage", "No image"))}</div>`}
        </div>
        <div>
          <p class="section-label">${escapeHtml(product.category?.name || translateString("shop.product", "Product"))}</p>
          <h1>${escapeHtml(product.name)}</h1>
          <p>${escapeHtml(product.description || "")}</p>
          <strong>${escapeHtml(formatMoney(product.priceCents, product.currency || "EUR"))}</strong>
          <span>${escapeHtml(product.stockQuantity)} ${escapeHtml(translateString("shop.inStock", "in stock"))}</span>
        </div>
      </section>
      <section class="shop-product-specs">
        <h2>${escapeHtml(translateString("shop.productAttributes", "Product attributes"))}</h2>
        ${attributes.length
          ? `<dl>${attributes.map((item) => `<div><dt>${escapeHtml(item.name || "")}</dt><dd>${escapeHtml(item.value || "")}</dd></div>`).join("")}</dl>`
          : `<p class="dashboard-copy">${escapeHtml(translateString("shop.noAttributes", "No attributes have been added yet."))}</p>`}
      </section>
    </article>
  `;
  elements.footer.innerHTML = "";
  document.body.classList.remove("auth-enabled", "dashboard-enabled", "editor-enabled");
  setStatus(translateString("shop.productLoaded", "Product loaded."));
}
