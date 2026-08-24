import {
  availableComponentTemplates,
  defaultPage,
  elements,
  escapeHtml,
  formatMoney,
  hasPermission,
  moduleEnabled,
  normalizePageLayout,
  setStatus,
  state,
  translateString
} from "./core.js";
import { currentLocale, pageHref } from "./routes.js";
import { renderFormMessage } from "./ui.js";
import { galleryItems, gallerySettings, isGalleryValue, sliderSettings, sliderSlides } from "./slider-config.js";
import { normalizeShopSettings } from "./shop-config.js";
import { enhanceStructuredTabs } from "./structured-tabs.js";
import {
  advancedClassList,
  advancedIdAttribute,
  advancedStyleAttribute,
  animationCssVariables,
  sanitizeInlineCss,
  sanitizeStylesheet
} from "./custom-css.js";
import { applyDesignSystem } from "./design-system.js";
import { sectionDesignSettings } from "./section-design.js";
import {
  applySeoDocument,
  createPageSeoDocument,
  createPostSeoDocument
} from "./seo-document.js";

export { defaultPage };

export function withPublicRenderContext(context = {}, render) {
  const previousConfig = state.config;
  const previousLocale = state.publicRenderLocale;
  const previousPath = state.publicRenderPath;
  state.config = context.config || previousConfig;
  state.publicRenderLocale = context.locale || "";
  state.publicRenderPath = context.path || "";

  try {
    return render();
  } finally {
    state.config = previousConfig;
    state.publicRenderLocale = previousLocale;
    state.publicRenderPath = previousPath;
  }
}

function applySiteCustomCss() {
  if (!document.head || !document.createElement) return;

  applySiteStylesheet(
    "[data-codey-generated-theme]",
    "data-codey-generated-theme",
    sanitizeStylesheet(state.config?.siteSettings?.generatedCss || "", 60000)
  );
  applySiteStylesheet(
    "[data-site-custom-css]",
    "data-site-custom-css",
    sanitizeStylesheet(state.config?.siteSettings?.customCss || "")
  );
}

function applySiteStylesheet(selector, attribute, css) {
  let element = document.querySelector(selector);
  if (!css) {
    element?.remove?.();
    return;
  }

  if (!element) {
    element = document.createElement("style");
    element.setAttribute(attribute, "");
    document.head.append(element);
  }

  element.textContent = css;
}

function enabledLocalizationLocales() {
  const localization = state.config?.localization || {};
  const locales = Array.isArray(localization.locales) ? localization.locales : [];

  if (!localization.enabled) return [];

  return locales
    .filter((locale) => locale?.enabled !== false && locale?.code)
    .map((locale) => ({
      code: String(locale.code).toLowerCase(),
      label: locale.label || String(locale.code).toUpperCase()
    }));
}

function localizedPublicPath(slug = "home", locale = currentLocale()) {
  const defaultLocale = state.config?.localization?.defaultLocale || "en";
  const localeCode = String(locale || defaultLocale).toLowerCase();
  const normalizedSlug = String(slug || "home").replace(/^\/+|\/+$/g, "");
  const path = !normalizedSlug || normalizedSlug === "home" ? "/" : `/${normalizedSlug}`;

  if (localeCode === defaultLocale) return path;
  return path === "/" ? `/${localeCode}` : `/${localeCode}${path}`;
}

export function runtimeSeoContext(overrides = {}) {
  const siteSettings = state.config?.siteSettings || {};

  return {
    origin: state.config?.app?.publicUrl || window.location.origin || "http://localhost",
    siteName: siteSettings.title || state.config?.app?.name || "Website",
    siteDescription: siteSettings.metaDescription || siteSettings.description || "",
    noindex: siteSettings.searchIndexing === false,
    defaultLocale: state.config?.localization?.defaultLocale || "en",
    storagePublicBaseUrl: state.config?.storage?.publicBaseUrl || "",
    organizationLogo: siteSettings.logoUrl || "",
    faviconUrl: siteSettings.faviconUrl || "",
    defaultImage: siteSettings.socialImageUrl
      ? {
          url: siteSettings.socialImageUrl,
          alt: siteSettings.socialImageAlt || siteSettings.title || "Website"
        }
      : undefined,
    ...overrides
  };
}

function renderLanguageSwitcher(page) {
  const localization = state.config?.localization || {};
  const locales = enabledLocalizationLocales();
  if (!localization.showLanguageSwitcher || locales.length < 2) return "";

  const activeLocale = page.locale || currentLocale();
  const translations = Array.isArray(page.translations) ? page.translations : [];
  const translationByLocale = new Map(translations.map((translation) => [translation.locale, translation]));
  if (!translationByLocale.has(activeLocale)) {
    translationByLocale.set(activeLocale, {
      slug: page.slug,
      locale: activeLocale,
      title: page.title
    });
  }

  const display = localization.languageSwitcherDisplay === "dropdown" ? "dropdown" : "buttons";
  const labelStyle = ["full", "code", "icon"].includes(localization.languageSwitcherLabelStyle)
    ? localization.languageSwitcherLabelStyle
    : "full";
  const switcherLabel = translateString("language.switcher", "Language switcher");
  const itemLabel = (locale) => {
    if (labelStyle === "code") return locale.code.toUpperCase();
    if (labelStyle === "icon") return locale.code.toUpperCase();

    return locale.label;
  };
  const itemContent = (locale) => {
    const label = itemLabel(locale);
    if (labelStyle !== "icon") return escapeHtml(label);

    return `<span class="language-switcher-icon" aria-hidden="true"></span>${escapeHtml(label)}`;
  };

  if (display === "dropdown") {
    return `
      <span class="language-switcher language-switcher-dropdown" data-language-switcher-shell>
        <label class="visually-hidden" for="language-switcher-select">${escapeHtml(switcherLabel)}</label>
        <select id="language-switcher-select" class="language-switcher-select" data-language-select aria-label="${escapeHtml(switcherLabel)}">
          ${locales
            .map((locale) => {
              const translation = translationByLocale.get(locale.code);
              const label = itemLabel(locale);
              if (!translation) {
                return `<option value="" disabled>${escapeHtml(label)}</option>`;
              }

              return `<option value="${escapeHtml(localizedPublicPath(translation.slug, locale.code))}"${locale.code === activeLocale ? " selected" : ""}>${escapeHtml(label)}</option>`;
            })
            .join("")}
        </select>
      </span>
    `;
  }

  return `
    <nav class="language-switcher language-switcher-buttons" aria-label="${escapeHtml(switcherLabel)}" data-language-switcher-shell>
      ${locales
        .map((locale) => {
          const translation = translationByLocale.get(locale.code);
          if (!translation) {
            return `<span class="language-switcher-item disabled" title="${escapeHtml(locale.label)}">${itemContent(locale)}</span>`;
          }

          return `<a class="language-switcher-item ${locale.code === activeLocale ? "active" : ""}" href="${escapeHtml(localizedPublicPath(translation.slug, locale.code))}" hreflang="${escapeHtml(locale.code)}" title="${escapeHtml(locale.label)}">${itemContent(locale)}</a>`;
        })
        .join("")}
    </nav>
  `;
}

function updateHeaderLanguageSwitcher(page) {
  const switcher = renderLanguageSwitcher(page);
  elements.menu.querySelector?.("[data-language-switcher-shell]")?.remove?.();
  if (!switcher) return;

  if (typeof elements.menu.insertAdjacentHTML === "function") {
    elements.menu.insertAdjacentHTML("beforeend", switcher);
  } else {
    elements.menu.innerHTML = `${elements.menu.innerHTML}${switcher}`;
  }
}

export function renderEditorButton(label, attribute, value = "") {
  return `<button type="button" class="front-edit-button" ${attribute}${value ? `="${escapeHtml(value)}"` : ""}>${escapeHtml(label)}</button>`;
}

function visualIconButton(icon, label, attribute, disabled = false, className = "") {
  return `<button type="button" class="visual-icon-button${className ? ` ${className}` : ""}" ${attribute} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"${disabled ? " disabled" : ""}><span aria-hidden="true">${icon}</span></button>`;
}

function renderVisualSectionControls(section, index, sections) {
  const label = section.label || section.key || `Section ${index + 1}`;

  return `
    <div class="visual-item-toolbar visual-section-toolbar" role="toolbar" aria-label="Edit ${escapeHtml(label)}" data-editor-ui>
      <span class="visual-toolbar-label">${escapeHtml(label)}</span>
      ${visualIconButton("&uarr;", `Move ${label} up`, 'data-visual-move-section="up"', index === 0)}
      ${visualIconButton("&darr;", `Move ${label} down`, 'data-visual-move-section="down"', index === sections.length - 1)}
      ${visualIconButton("&#9638;", `Duplicate ${label}`, "data-visual-duplicate-section")}
      ${hasPermission("create", "cms") ? visualIconButton("+", `Save ${label} as reusable`, "data-visual-save-section") : ""}
      ${visualIconButton("&#9881;", `Settings for ${label}`, "data-visual-edit-section")}
      ${visualIconButton("&times;", `Delete ${label}`, "data-visual-delete-section", false, "danger")}
    </div>
  `;
}

function renderVisualBlockControls(block, index, blocks) {
  const label = block.label || block.key || `Element ${index + 1}`;
  const editable = block.editable !== false;
  const directTextEdit = editable && ["TEXT", "RICH_TEXT"].includes(block.type);

  return `
    <div class="visual-item-toolbar visual-block-toolbar" role="toolbar" aria-label="Edit ${escapeHtml(label)}" data-editor-ui>
      <span class="visual-toolbar-label">${escapeHtml(label)}</span>
      <span data-visual-inline-default>
        ${directTextEdit ? visualIconButton("&#9998;", `Edit ${label} directly`, "data-visual-start-inline") : ""}
        ${editable ? visualIconButton("&hellip;", `More options for ${label}`, "data-edit-block") : ""}
        ${visualIconButton("&uarr;", `Move ${label} up`, 'data-visual-move-block="up"', index === 0)}
        ${visualIconButton("&darr;", `Move ${label} down`, 'data-visual-move-block="down"', index === blocks.length - 1)}
        ${visualIconButton("&#9638;", `Duplicate ${label}`, "data-visual-duplicate-block")}
        ${visualIconButton("&times;", `Delete ${label}`, "data-visual-delete-block", false, "danger")}
      </span>
      <span class="visual-inline-actions" data-visual-inline-actions hidden>
        <button type="button" class="visual-inline-save" data-visual-save-inline>Save</button>
        <button type="button" class="visual-inline-cancel" data-visual-cancel-inline>Cancel</button>
      </span>
    </div>
  `;
}

function renderVisualEditorToolbar(page) {
  const reusableSections = (state.cmsTemplates || []).filter((template) => template.type === "SECTION");
  const availableElements = availableComponentTemplates();
  const canCreateTemplates = hasPermission("create", "cms");
  const canDeleteTemplates = hasPermission("delete", "cms");
  const isPublished = String(page.status || "").toUpperCase() === "PUBLISHED";
  const locale = page.locale && page.locale !== state.config?.localization?.defaultLocale
    ? `?locale=${encodeURIComponent(page.locale)}`
    : "";
  const builderHref = `/dashboard/pages/${encodeURIComponent(page.slug)}/builder${locale}`;

  return `
    <div class="visual-editor-bar" role="toolbar" aria-label="Visual page editor" data-editor-ui>
      <div class="visual-editor-summary">
        <span class="visual-editor-mark" aria-hidden="true">&#9998;</span>
        <span><strong>${escapeHtml(page.title)}</strong><small>${escapeHtml(page.status || "DRAFT")}</small></span>
      </div>
      <div class="visual-editor-actions">
        <span class="visual-editor-history" role="group" aria-label="Edit history">
          ${visualIconButton("&#8630;", "Undo visual change", "data-visual-undo", !(state.visualEditorUndoStack || []).length)}
          ${visualIconButton("&#8631;", "Redo visual change", "data-visual-redo", !(state.visualEditorRedoStack || []).length)}
        </span>
        <details class="visual-command-menu visual-library-menu"${state.visualEditorLibraryOpen ? " open" : ""}>
          <summary class="visual-command-button" aria-label="Add page content">+ Add${reusableSections.length ? ` (${reusableSections.length})` : ""}</summary>
          <div class="visual-command-panel visual-library-panel">
            <div class="visual-add-options">
              <button type="button" class="visual-add-option" data-add-section-inline><strong>Section</strong></button>
              <button type="button" class="visual-add-option" data-add-element-inline${availableElements.length ? "" : ' disabled title="No elements are available"'}><strong>Element</strong></button>
            </div>
            <div class="visual-library-heading"><strong>Reusable sections</strong></div>
            ${reusableSections.length
              ? reusableSections.map((template) => `
                  <div class="visual-library-item">
                    <button type="button" data-visual-insert-template="${escapeHtml(template.id)}"><strong>${escapeHtml(template.name)}</strong><span>${escapeHtml(template.description || "Reusable section")}</span></button>
                    ${canDeleteTemplates ? visualIconButton("&times;", `Delete ${template.name}`, `data-visual-delete-template="${escapeHtml(template.id)}"`, false, "danger") : ""}
                  </div>
                `).join("")
              : '<p class="visual-library-empty">No reusable sections saved.</p>'}
          </div>
        </details>
        ${isPublished
          ? '<span class="visual-publish-status" role="status" aria-label="Page is published"><span aria-hidden="true">&#10003;</span> Live</span>'
          : '<button type="button" class="visual-command-button visual-publish-button" data-publish-inline>Publish</button>'}
        <details class="visual-command-menu visual-more-menu">
          <summary class="visual-command-button" aria-label="More page editing options">More</summary>
          <div class="visual-command-panel visual-more-panel">
            <div class="visual-more-preview">
              <span>Preview</span>
              <span class="visual-device-switch" role="group" aria-label="Preview device">
                ${[["desktop", "Desktop"], ["tablet", "Tablet"], ["mobile", "Mobile"]].map(([device, label]) => `<button type="button" class="visual-device-button${state.visualEditorDevice === device ? " active" : ""}" data-visual-device="${device}" aria-label="${label}" title="${label}" aria-pressed="${state.visualEditorDevice === device ? "true" : "false"}">${label.slice(0, 1)}</button>`).join("")}
              </span>
            </div>
            <button type="button" class="visual-more-action" data-edit-page-inline>Page settings</button>
            ${canCreateTemplates ? '<button type="button" class="visual-more-action" data-visual-save-page-template>Save as page template</button>' : ""}
            <a class="visual-more-action" href="${escapeHtml(builderHref)}">Advanced builder</a>
          </div>
        </details>
        <button type="button" class="visual-command-button visual-editor-done" data-exit-visual-editor>Done</button>
      </div>
    </div>
  `;
}

export function renderMenuItems(items, canEdit = false) {
  const currentPath = normalizePublicPath(
    typeof window === "undefined" ? state.publicRenderPath : window.location.pathname
  );

  return items
    .map((item) => {
      const url = item.url?.startsWith("/") ? pageHref(item.url.slice(1)) : safePublicHref(item.url);
      const isCurrent = Boolean(url && url.startsWith("/") && normalizePublicPath(url) === currentPath);
      const link = `<a href="${escapeHtml(url || "#")}"${isCurrent ? ' aria-current="page"' : ""}${item.openInNewTab ? ' target="_blank" rel="noreferrer"' : ""}>${escapeHtml(item.label)}</a>`;
      const editButton = canEdit ? renderEditorButton("Edit", "data-edit-menu-item", item.id) : "";

      return `<span class="menu-item">${link}${editButton}</span>`;
    })
    .join("");
}

function normalizePublicPath(value = "/") {
  const path = String(value || "/").split(/[?#]/, 1)[0].replace(/\/+$/g, "");
  return path || "/";
}

function renderInlineRichText(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)/g,
      '<a href="$2">$1</a>'
    );
}

function safeRichHref(value = "") {
  const href = String(value || "").trim();
  if (href.startsWith("//") || href.includes("\\")) return "#";
  if (/^(https?:\/\/|mailto:|tel:|#|\/)/i.test(href)) return href;

  return "#";
}

function safePublicHref(value = "") {
  return safeRichHref(value);
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

function decodedStorageKey(key = "") {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

function uploadPathForS3Url(src = "") {
  const value = String(src || "").trim();
  if (!/^s3:\/\//i.test(value)) return "";

  const bucketAndKey = value.replace(/^s3:\/\//i, "");
  const slashIndex = bucketAndKey.indexOf("/");
  const key = slashIndex >= 0 ? bucketAndKey.slice(slashIndex + 1) : "";

  return uploadPathForStorageKey(decodedStorageKey(key));
}

function uploadPathForConfiguredStorageUrl(src = "") {
  const publicBaseUrl = String(state.config?.storage?.publicBaseUrl || "").replace(/\/+$/g, "");
  if (!publicBaseUrl || !src.startsWith(`${publicBaseUrl}/`)) return "";

  return uploadPathForStorageKey(decodedStorageKey(src.slice(publicBaseUrl.length + 1)));
}

function safeMediaSrc(value = "") {
  const src = String(value || "").trim();
  if (!src) return "";
  if (src.startsWith("//") || src.includes("\\")) return "";

  const s3Src = uploadPathForS3Url(src);
  if (s3Src) return s3Src;

  const configuredStorageSrc = uploadPathForConfiguredStorageUrl(src);
  if (configuredStorageSrc) return configuredStorageSrc;

  if (/^(https?:\/\/|\/|\.\/)/i.test(src)) return src;
  if (/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(src)) return src;

  return "";
}

function updatePublicBrand() {
  const settings = state.config?.siteSettings || {};
  const title = settings.title || state.config?.app?.name || "Website";
  const logoUrl = safeMediaSrc(settings.logoUrl || "");
  const logoMode = ["text", "image", "image-and-name"].includes(settings.logoMode)
    ? settings.logoMode
    : "text";
  const showLogo = Boolean(logoUrl && logoMode !== "text");
  const showName = logoMode !== "image" || !showLogo;
  const showGeneratedFallback = settings.generatedFrom === "websiteSpec" && !showLogo;
  const logoHeight = Number.isFinite(Number(settings.logoHeight))
    ? Math.min(120, Math.max(20, Math.round(Number(settings.logoHeight))))
    : 42;

  elements.brand.href = "/";
  elements.brand.innerHTML = [
    showLogo
      ? `<img class="brand-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(settings.logoAltText || title)}" style="--brand-logo-height:${logoHeight}px" />`
      : showGeneratedFallback ? `<span>${escapeHtml(brandInitials(title))}</span>` : "",
    showName ? `<strong>${escapeHtml(title)}</strong>` : ""
  ].join("");
}

function brandInitials(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "CY";
}

const generatedBodyDatasetKeys = [
  "codeyPreview",
  "codeyCmsRenderedPreview",
  "codeyRuntimeTheme",
  "designFamily",
  "designRecipe",
  "heroComposition",
  "navigationSystem",
  "sectionRhythm",
  "gridSystem",
  "imageTreatment",
  "typographySystem",
  "signatureInteraction",
  "shapeLanguage",
  "motionSystem",
  "motionLevel"
];

let generatedMotionObserver = null;

function applyGeneratedPageMotion(enabled) {
  generatedMotionObserver?.disconnect();
  generatedMotionObserver = null;
  delete document.body.dataset.motionReady;
  document.querySelectorAll(".website-spec-page .section").forEach((section) => {
    delete section.dataset.motionState;
  });

  if (
    !enabled ||
    document.body.dataset.motionLevel === "none" ||
    !("IntersectionObserver" in window) ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  const sections = [...document.querySelectorAll(".website-spec-page .section")];
  if (!sections.length) return;

  document.body.dataset.motionReady = "true";
  sections.forEach((section) => {
    section.dataset.motionState = "pending";
  });
  generatedMotionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.dataset.motionState = "visible";
      generatedMotionObserver?.unobserve(entry.target);
    });
  }, {
    rootMargin: "0px 0px -12% 0px",
    threshold: 0.12
  });
  sections.slice(1).forEach((section) => generatedMotionObserver?.observe(section));
  requestAnimationFrame(() => {
    if (sections[0]) sections[0].dataset.motionState = "visible";
  });
}

function applyGeneratedPageContext(page) {
  for (const key of generatedBodyDatasetKeys) delete document.body.dataset[key];

  const content = isRecord(page?.content) ? page.content : {};
  if (content.source !== "websiteSpec") return;
  const style = isRecord(content.style) ? content.style : {};
  const experience = isRecord(style.experience) ? style.experience : {};
  const value = (key, fallback = "") => firstText(experience, [key]) || fallback;
  const context = {
    codeyPreview: "cms",
    codeyCmsRenderedPreview: "true",
    codeyRuntimeTheme: typeof style.runtimeCss === "string" && style.runtimeCss.trim() ? "true" : "",
    designFamily: value("family", "generated"),
    designRecipe: value("recipeId", firstText(style, ["theme"]) || "generated-site"),
    heroComposition: value("heroComposition"),
    navigationSystem: value("navigationSystem"),
    sectionRhythm: value("sectionRhythm"),
    gridSystem: value("gridSystem"),
    imageTreatment: value("imageTreatment"),
    typographySystem: value("typographySystem"),
    signatureInteraction: value("signatureInteraction"),
    shapeLanguage: value("shapeLanguage"),
    motionSystem: value("motionSystem"),
    motionLevel: value("motionLevel", "light")
  };

  for (const [key, value] of Object.entries(context)) {
    if (value) document.body.dataset[key] = String(value).slice(0, 80);
  }
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

function imageSizesForContext(context = "") {
  if (/gallery|card|structured/.test(context)) return "(max-width: 760px) 92vw, 34vw";

  return "(max-width: 760px) 92vw, 50vw";
}

function positiveImageDimension(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function dataSvgDimensions(src = "") {
  const match = /^data:image\/svg\+xml;base64,([a-z0-9+/=]+)$/i.exec(src);
  if (!match || typeof globalThis.atob !== "function") return { width: 0, height: 0 };

  try {
    const svg = globalThis.atob(match[1]);
    const width = svg.match(/\bwidth=["'](\d+)["']/i)?.[1];
    const height = svg.match(/\bheight=["'](\d+)["']/i)?.[1];

    return {
      width: positiveImageDimension(width),
      height: positiveImageDimension(height)
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

function normalizedImage(image, fallbackAlt = "") {
  const source = isRecord(image) ? image : { url: image };
  const mediaAsset = isRecord(source.mediaAsset) ? source.mediaAsset : {};
  const src = safeMediaSrc(source.url || source.src || mediaAsset.url);
  if (!src) return null;
  const dataDimensions = dataSvgDimensions(src);

  return {
    src,
    alt: source.alt || source.altText || mediaAsset.altText || fallbackAlt,
    width: positiveImageDimension(source.width || mediaAsset.width) || dataDimensions.width,
    height: positiveImageDimension(source.height || mediaAsset.height) || dataDimensions.height,
    variants: Array.isArray(source.variants)
      ? source.variants
      : Array.isArray(mediaAsset.variants)
        ? mediaAsset.variants
        : []
  };
}

function responsiveImageCandidates(image) {
  const candidates = new Map();
  for (const variant of image.variants) {
    if (!isRecord(variant) || variant.status && variant.status !== "READY") continue;
    const width = positiveImageDimension(variant.width);
    const src = safeMediaSrc(variant.url);
    if (!width || !src || image.width && width > image.width) continue;
    candidates.set(width, src);
  }

  if (isUploadedImageSrc(image.src) && image.width) {
    for (const width of responsiveImageWidths().filter((candidate) => candidate <= image.width)) {
      if (!candidates.has(width)) candidates.set(width, imageVariantSrc(image.src, width));
    }
  }

  return [...candidates.entries()].sort(([left], [right]) => left - right);
}

function renderImageTag(imageValue, fallbackAlt = "", context = "section-image", className = "", renderContext = {}) {
  const image = normalizedImage(imageValue, fallbackAlt);
  if (!image) return "";

  const candidates = responsiveImageCandidates(image);
  const responsiveAttrs = candidates.length
    ? ` srcset="${escapeHtml(candidates.map(([width, src]) => `${src} ${width}w`).join(", "))}" sizes="${escapeHtml(imageSizesForContext(context))}"`
    : "";
  const dimensions = `${image.width ? ` width="${image.width}"` : ""}${image.height ? ` height="${image.height}"` : ""}`;
  const priority = renderContext.highPriorityImageUsed !== true;
  if (priority) renderContext.highPriorityImageUsed = true;
  const loading = priority
    ? ' loading="eager" decoding="async" fetchpriority="high"'
    : ' loading="lazy" decoding="async"';

  return `<img${className ? ` class="${escapeHtml(className)}"` : ""} src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}"${dimensions}${responsiveAttrs}${loading} />`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cssToken(value, fallback = "content") {
  const token = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return token || fallback;
}

function firstText(source, keys) {
  if (!isRecord(source)) return "";

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number") return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function renderStructuredImage(image, fallbackAlt = "", renderContext = {}, className = "structured-media") {
  if (!image) return "";

  const imageData = typeof image === "string" ? { url: image } : image;
  if (!isRecord(imageData)) return "";

  const normalized = normalizedImage(imageData, fallbackAlt);
  if (!normalized) return "";

  const alt = firstText(imageData, ["alt", "title", "caption"]) || fallbackAlt;
  const caption = firstText(imageData, ["caption", "credit"]);

  return `
    <figure class="${escapeHtml(className)}">
      ${renderImageTag(imageData, alt, className, "block-image", renderContext)}
      ${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}
    </figure>
  `;
}

function renderStructuredStats(stats) {
  if (!Array.isArray(stats)) return "";

  const items = stats
    .map((item) => {
      if (!isRecord(item)) return "";

      const value = firstText(item, ["value", "number", "metric"]);
      const label = firstText(item, ["label", "name", "title"]);
      if (!value && !label) return "";

      return `
        <div class="structured-stat">
          ${value ? `<dt>${escapeHtml(value)}</dt>` : ""}
          ${label ? `<dd>${escapeHtml(label)}</dd>` : ""}
        </div>
      `;
    })
    .join("");

  return items ? `<dl class="structured-stats">${items}</dl>` : "";
}

function structuredDisplay(value, fallbackVariant = "") {
  const display = isRecord(value?.display) ? value.display : {};
  const columns = [2, 3, 4].includes(Number(display.columns)) ? Number(display.columns) : 3;
  const variant = cssToken(firstText(value, ["variant", "type"]) || fallbackVariant);
  const defaultPresentation = {
    "team-section": "portrait",
    "logo-grid": "grid",
    timeline: "line",
    "resource-list": "rows",
    "location-cards": "cards",
    "quote-highlight": "editorial",
    "bento-grid": "spotlight",
    "navigation-cards": "cards",
    video: "inline"
  }[variant] || "cards";

  return {
    alignment: oneOf(display.alignment, ["left", "center"], "left"),
    density: oneOf(display.density, ["comfortable", "compact"], "comfortable"),
    surface: oneOf(display.surface, ["plain", "outline", "soft", "elevated", "liquid"], "outline"),
    shape: oneOf(display.shape, ["site", "square", "soft", "rounded"], "site"),
    interaction: oneOf(display.interaction, ["none", "lift", "glow"], "lift"),
    presentation: oneOf(display.presentation, ["cards", "bento", "editorial", "spotlight", "comparison", "line", "alternating", "rows", "centered", "boxed", "balanced", "mosaic", "compact", "inline", "hero", "split", "stacked", "showcase", "quote-wall", "focus", "portrait", "grid", "ribbon"], defaultPresentation),
    columns,
    showNumbers: display.showNumbers !== false,
    striped: display.striped !== false,
    ratio: oneOf(display.ratio, ["16 / 10", "16 / 9", "4 / 3", "1 / 1"], variant === "image-hotspots" ? "16 / 10" : "16 / 9"),
    preload: oneOf(display.preload, ["metadata", "none"], "metadata"),
    loop: display.loop === true,
    playback: oneOf(display.playback, ["controls", "hover-focus"], "controls")
  };
}

function structuredDisplayClasses(display) {
  return [
    `structured-align-${display.alignment}`,
    `structured-density-${display.density}`,
    `structured-surface-${display.surface}`,
    `structured-presentation-${display.presentation}`,
    `structured-shape-${display.shape}`,
    `structured-interaction-${display.interaction}`
  ].join(" ");
}

function renderStructuredItems(items, variant = "cards", renderContext = {}, display = structuredDisplay({})) {
  if (!Array.isArray(items)) return "";

  const token = cssToken(variant, "cards");
  const html = items
    .map((item, index) => {
      if (!isRecord(item)) return "";

      const title = firstText(item, ["title", "name", "label"]);
      const body = firstText(item, ["body", "text", "copy", "description", "content"]);
      const label = firstText(item, ["label", "role", "kicker", "eyebrow", "meta"]);
      const value = firstText(item, ["value", "price", "metric"]);
      const url = item.url ? safePublicHref(item.url) : "";
      const imageHtml = renderStructuredImage(item.image || item.media, title || label || `Item ${index + 1}`, renderContext);
      const featured = item.featured === true || item.highlighted === true;
      const indexLabel = String(index + 1).padStart(2, "0");

      if (!title && !body && !label && !value && !imageHtml) return "";

      const cardClass = `structured-card content-card structured-card-${escapeHtml(token)}${featured ? " structured-card-featured" : ""}${imageHtml ? " structured-card-has-media" : ""}`;
      const wrapCardWithLink = Boolean(url && !["feature-cards", "pricing-cards"].includes(token));
      const action = url ? `<a class="action-link" href="${escapeHtml(url)}">${escapeHtml(firstText(item, ["buttonLabel", "actionLabel"]) || "Learn more")}</a>` : "";

      if (token === "testimonials") {
        return `
          <figure class="${cardClass}">
            <span class="structured-quote-mark" aria-hidden="true">"</span>
            <blockquote>${body ? renderRichText(body) : ""}</blockquote>
            <figcaption>
              ${title ? `<strong>${escapeHtml(title)}</strong>` : ""}
              ${label && label !== title ? `<span>${escapeHtml(label)}</span>` : ""}
            </figcaption>
          </figure>
        `;
      }

      if (token === "pricing-cards") {
        return `
          <article class="${cardClass}">
            ${featured ? `<span class="structured-badge">${escapeHtml(firstText(item, ["badge", "tag"]) || "Featured")}</span>` : ""}
            <div class="structured-card-copy">
              ${label && label !== title ? `<p class="structured-note">${escapeHtml(label)}</p>` : ""}
              ${title ? `<h4>${escapeHtml(title)}</h4>` : ""}
              ${value ? `<strong class="structured-value">${escapeHtml(value)}</strong>` : ""}
              ${body ? `<div class="block-rich">${renderRichText(body)}</div>` : ""}
            </div>
            ${action}
          </article>
        `;
      }

      const hasCopy = label || title || value || body || (!wrapCardWithLink && token !== "logo-grid" && action);
      const content = `
        ${token === "feature-cards" ? `<span class="structured-card-index" aria-hidden="true">${escapeHtml(indexLabel)}</span>` : ""}
        ${imageHtml}
        ${hasCopy
          ? `<div class="structured-card-copy">
              ${label && label !== title ? `<p class="structured-note">${escapeHtml(label)}</p>` : ""}
              ${title ? `<h4>${escapeHtml(title)}</h4>` : ""}
              ${value ? `<strong class="structured-value">${escapeHtml(value)}</strong>` : ""}
              ${body ? `<div class="block-rich">${renderRichText(body)}</div>` : ""}
              ${!wrapCardWithLink && token !== "logo-grid" ? action : ""}
            </div>`
          : ""}
        ${token === "navigation-cards" ? '<span class="structured-navigation-arrow" aria-hidden="true">&#8594;</span>' : ""}
      `;

      return wrapCardWithLink
        ? `<a class="${cardClass}" href="${escapeHtml(url)}">${content}</a>`
        : `<article class="${cardClass}">${content}</article>`;
    })
    .join("");

  return html
    ? `<div class="structured-items card-grid structured-items-${escapeHtml(token)}" style="--structured-columns:${escapeHtml(display.columns)}">${html}</div>`
    : "";
}

function renderStructuredProcess(items, display) {
  if (!Array.isArray(items)) return "";

  const steps = items
    .map((item, index) => {
      if (!isRecord(item)) return "";
      const title = firstText(item, ["title", "name", "label"]);
      const body = firstText(item, ["body", "text", "copy", "description", "content"]);
      const label = firstText(item, ["label", "kicker", "eyebrow", "meta"]);
      const url = item.url ? safePublicHref(item.url) : "";
      if (!title && !body) return "";

      return `
        <li class="structured-process-step">
          <span class="structured-process-number" aria-hidden="true">${escapeHtml(String(index + 1).padStart(2, "0"))}</span>
          <div class="structured-card-copy">
            ${label && label !== title ? `<p class="structured-note">${escapeHtml(label)}</p>` : ""}
            ${title ? `<h4>${escapeHtml(title)}</h4>` : ""}
            ${body ? `<div class="block-rich">${renderRichText(body)}</div>` : ""}
            ${url ? `<a class="action-link" href="${escapeHtml(url)}">Learn more</a>` : ""}
          </div>
        </li>
      `;
    })
    .join("");

  if (!steps) return "";

  return `<ol class="structured-process${display.showNumbers ? "" : " structured-process-hide-numbers"}" style="--structured-columns:${escapeHtml(display.columns)}">${steps}</ol>`;
}

function renderStructuredTimeline(items) {
  if (!Array.isArray(items)) return "";

  const milestones = items
    .map((item) => {
      if (!isRecord(item)) return "";
      const title = firstText(item, ["title", "name"]);
      const body = firstText(item, ["body", "text", "copy", "description", "content"]);
      const label = firstText(item, ["label", "date", "period", "meta"]);
      const url = item.url ? safePublicHref(item.url) : "";
      if (!title && !body) return "";

      return `
        <li class="structured-timeline-item">
          <span class="structured-timeline-marker" aria-hidden="true"></span>
          <div class="structured-timeline-copy">
            ${label ? `<p class="structured-note">${escapeHtml(label)}</p>` : ""}
            ${title ? `<h4>${escapeHtml(title)}</h4>` : ""}
            ${body ? `<div class="block-rich">${renderRichText(body)}</div>` : ""}
            ${url ? `<a class="action-link" href="${escapeHtml(url)}">Learn more</a>` : ""}
          </div>
        </li>
      `;
    })
    .join("");

  return milestones ? `<ol class="structured-timeline">${milestones}</ol>` : "";
}

function renderStructuredChecklist(items, display) {
  if (!Array.isArray(items)) return "";

  const points = items
    .map((item) => {
      if (!isRecord(item)) return "";
      const title = firstText(item, ["title", "name", "label"]);
      const body = firstText(item, ["body", "text", "copy", "description", "content"]);
      if (!title && !body) return "";

      return `
        <li class="structured-checklist-item">
          <span class="structured-checklist-mark" aria-hidden="true">&#10003;</span>
          <div class="structured-card-copy">
            ${title ? `<h4>${escapeHtml(title)}</h4>` : ""}
            ${body ? `<div class="block-rich">${renderRichText(body)}</div>` : ""}
          </div>
        </li>
      `;
    })
    .join("");

  return points
    ? `<ul class="structured-checklist" style="--structured-columns:${escapeHtml(display.columns)}">${points}</ul>`
    : "";
}

function renderStructuredResources(items) {
  if (!Array.isArray(items)) return "";

  const resources = items
    .map((item) => {
      if (!isRecord(item)) return "";
      const title = firstText(item, ["title", "name"]);
      const body = firstText(item, ["body", "text", "copy", "description", "content"]);
      const label = firstText(item, ["label", "type", "format", "meta"]);
      const url = item.url ? safePublicHref(item.url) : "";
      if (!title || !url) return "";

      return `
        <li>
          <a class="structured-resource-link" href="${escapeHtml(url)}">
            <div class="structured-resource-copy">
              ${label ? `<span class="structured-note">${escapeHtml(label)}</span>` : ""}
              <strong>${escapeHtml(title)}</strong>
              ${body ? `<div class="block-rich">${renderRichText(body)}</div>` : ""}
            </div>
            <span class="structured-resource-arrow" aria-hidden="true">&#8599;</span>
          </a>
        </li>
      `;
    })
    .join("");

  return resources ? `<ul class="structured-resource-list">${resources}</ul>` : "";
}

function renderStructuredLocations(items, display) {
  if (!Array.isArray(items)) return "";

  const locations = items
    .map((item) => {
      if (!isRecord(item)) return "";
      const title = firstText(item, ["title", "name"]);
      const body = firstText(item, ["body", "text", "copy", "description", "content"]);
      const label = firstText(item, ["label", "hours", "area", "meta"]);
      const url = item.url ? safePublicHref(item.url) : "";
      if (!title && !body) return "";

      return `
        <address class="structured-location">
          <span class="structured-location-marker" aria-hidden="true"></span>
          ${title ? `<h4>${escapeHtml(title)}</h4>` : ""}
          ${body ? `<div class="block-rich">${renderRichText(body)}</div>` : ""}
          ${label ? `<p class="structured-note">${escapeHtml(label)}</p>` : ""}
          ${url ? `<a class="action-link" href="${escapeHtml(url)}">View details</a>` : ""}
        </address>
      `;
    })
    .join("");

  return locations
    ? `<div class="structured-locations" style="--structured-columns:${escapeHtml(display.columns)}">${locations}</div>`
    : "";
}

function renderStructuredComparison(items, value, display) {
  if (!Array.isArray(items)) return "";

  const rows = items
    .map((item) => {
      if (!isRecord(item)) return "";
      const title = firstText(item, ["title", "name", "label"]);
      const firstValue = firstText(item, ["firstValue", "first", "optionA"]);
      const secondValue = firstText(item, ["secondValue", "second", "optionB"]);
      if (!title && !firstValue && !secondValue) return "";

      return `<tr><th scope="row">${escapeHtml(title)}</th><td>${escapeHtml(firstValue)}</td><td>${escapeHtml(secondValue)}</td></tr>`;
    })
    .join("");
  if (!rows) return "";

  const title = firstText(value, ["title", "heading", "headline", "name"]) || "Comparison";
  const firstHeading = firstText(value, ["firstColumnTitle"]) || "Option A";
  const secondHeading = firstText(value, ["secondColumnTitle"]) || "Option B";

  return `
    <div class="structured-comparison${display.striped ? " structured-comparison-striped" : ""}" tabindex="0">
      <table>
        <caption class="visually-hidden">${escapeHtml(title)}</caption>
        <thead><tr><th scope="col">Feature</th><th scope="col">${escapeHtml(firstHeading)}</th><th scope="col">${escapeHtml(secondHeading)}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderVideoElement(value, display, className = "") {
  const src = safeMediaSrc(value.url || value.src);
  if (!src) return '<div class="fallback-content">Video is not available.</div>';

  const title = firstText(value, ["title", "heading", "headline", "name"]) || "Video";
  const posterValue = isRecord(value.poster) ? value.poster.url || value.poster.src : value.posterUrl;
  const poster = safeMediaSrc(posterValue);
  const hoverPlayback = display.playback === "hover-focus";

  return `<video${className ? ` class="${escapeHtml(className)}"` : ""} src="${escapeHtml(src)}" controls playsinline preload="${escapeHtml(display.preload)}" aria-label="${escapeHtml(title)}" data-video-playback="${escapeHtml(display.playback)}"${poster ? ` poster="${escapeHtml(poster)}"` : ""}${hoverPlayback ? " muted" : ""}${display.loop ? " loop" : ""}>
    <a href="${escapeHtml(src)}">Download ${escapeHtml(title)}</a>
  </video>`;
}

function renderStructuredVideo(value, display) {
  return `
    <figure class="structured-video" data-video-frame style="--structured-video-ratio:${escapeHtml(display.ratio)}">
      ${renderVideoElement(value, display)}
    </figure>
  `;
}

function boundedPercent(value, fallback, min = 0, max = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function hotspotHref(hotspot) {
  const productSlug = firstText(hotspot, ["productSlug"]);
  if (productSlug) {
    const defaultLocale = state.config?.localization?.defaultLocale || "en";
    return localizedShopPath(`/product/${encodePathSegment(productSlug)}`, {
      locale: state.publicRenderLocale || defaultLocale,
      defaultLocale
    });
  }

  const requested = firstText(hotspot, ["url"]);
  if (!requested) return "";
  const href = safePublicHref(requested);
  return href === "#" && requested !== "#" ? "" : href;
}

function renderStructuredHotspotScene(value, display, renderContext) {
  const sceneImage = value.image || value.media;
  if (!normalizedImage(sceneImage)) {
    return '<div class="fallback-content">Interactive image is not available.</div>';
  }

  const hotspots = Array.isArray(value.hotspots) ? value.hotspots.slice(0, 20) : [];
  const placements = hotspots
    .map((hotspot, index) => {
      if (!isRecord(hotspot)) return "";
      const title = firstText(hotspot, ["title", "name", "label"]);
      const body = firstText(hotspot, ["body", "text", "description"]);
      const href = hotspotHref(hotspot);
      if (!title || !href) return "";

      const x = boundedPercent(hotspot.x, 50);
      const y = boundedPercent(hotspot.y, 50);
      const width = boundedPercent(hotspot.width, 8, 1, 50);
      const overlay = hotspot.image || hotspot.media;
      const overlayHtml = normalizedImage(overlay)
        ? renderImageTag(overlay, title, "hotspot-overlay", "hotspot-overlay-image", renderContext)
        : "";
      const description = body ? `<span class="hotspot-description">${escapeHtml(body)}</span>` : "";
      const edgeClass = x < 18 ? " hotspot-left-edge" : x > 82 ? " hotspot-right-edge" : "";

      return `
        <li class="hotspot-placement${overlayHtml ? " has-overlay-image" : ""}${edgeClass}" style="--hotspot-x:${escapeHtml(x)}%;--hotspot-y:${escapeHtml(y)}%;--hotspot-width:${escapeHtml(width)}%">
          <a href="${escapeHtml(href)}" aria-label="${escapeHtml(title)}">
            ${overlayHtml}
            <span class="hotspot-marker" aria-hidden="true"><span>${escapeHtml(String(index + 1).padStart(2, "0"))}</span></span>
            <span class="hotspot-label"><strong>${escapeHtml(title)}</strong>${description}</span>
          </a>
        </li>
      `;
    })
    .join("");

  return `
    <figure class="structured-hotspot-scene" style="--hotspot-scene-ratio:${escapeHtml(display.ratio)}">
      ${renderImageTag(sceneImage, firstText(sceneImage, ["alt", "altText"]) || firstText(value, ["title"]) || "Interactive scene", "hotspot-scene", "hotspot-scene-image", renderContext)}
      ${placements ? `<ol class="hotspot-placements" aria-label="Interactive image points">${placements}</ol>` : ""}
    </figure>
  `;
}

function renderStructuredQuote(value, display) {
  const title = firstText(value, ["title", "heading", "headline", "name"]);
  const body = firstText(value, ["body", "text", "copy", "content"]);
  const attribution = firstText(value, ["attribution", "source", "author"]);
  if (!body) return "";

  return `
    <figure class="structured-block structured-quote-highlight ${escapeHtml(structuredDisplayClasses(display))}">
      <span class="structured-quote-mark" aria-hidden="true">"</span>
      ${title ? `<h3>${escapeHtml(title)}</h3>` : ""}
      <blockquote>${renderRichText(body)}</blockquote>
      ${attribution ? `<figcaption>${escapeHtml(attribution)}</figcaption>` : ""}
    </figure>
  `;
}

function renderHeroPoints(items) {
  if (!Array.isArray(items)) return "";

  const html = items
    .map((item) => {
      if (!isRecord(item)) return "";
      const title = firstText(item, ["title", "name", "label"]);
      const value = firstText(item, ["value", "number", "metric"]);
      const body = firstText(item, ["body", "text", "copy", "description"]);
      if (!title && !value && !body) return "";

      return `<span>${value ? `<strong>${escapeHtml(value)}</strong>` : ""}${title ? escapeHtml(title) : ""}${body ? `<small>${escapeHtml(body)}</small>` : ""}</span>`;
    })
    .join("");

  return html ? `<div class="hero-points">${html}</div>` : "";
}

function normalizePanelItems(items, renderContext = {}) {
  if (!Array.isArray(items)) return [];

  return items.flatMap((item, index) => {
    if (!isRecord(item)) return [];

    const title = firstText(item, ["title", "name", "label"]) || `Item ${index + 1}`;
    const body = firstText(item, ["body", "text", "copy", "description", "content"]);
    const note = firstText(item, ["note", "kicker", "eyebrow", "meta"]);
    const imageHtml = renderStructuredImage(item.image || item.media, title, renderContext);
    const cta = isRecord(item.cta) ? item.cta : null;
    const url = item.url ? safePublicHref(item.url) : "";
    const ctaHtml = cta?.label && cta?.url
      ? `<a class="action-link" href="${escapeHtml(safePublicHref(cta.url))}">${escapeHtml(cta.label)}</a>`
      : url
        ? `<a class="action-link" href="${escapeHtml(url)}">${escapeHtml(firstText(item, ["buttonLabel", "actionLabel"]) || "Learn more")}</a>`
        : "";

    if (!title && !body && !note && !imageHtml && !ctaHtml) return [];

    return [{
      title,
      body,
      note,
      imageHtml,
      ctaHtml,
      open: item.open === true || item.defaultOpen === true
    }];
  });
}

function renderStructuredTabs(items, variant, blockKey = "tabs", renderContext = {}) {
  const panels = normalizePanelItems(items, renderContext);
  if (!panels.length) return "";

  const group = cssToken(`${blockKey}-${variant}`, "tabs");

  return `
    <div class="structured-tabs structured-tabs-${escapeHtml(cssToken(variant, "tabs"))}" data-structured-tabs>
      <div class="structured-tab-list" role="tablist">
        ${panels
          .map((panel, index) => `
            <button
              type="button"
              class="structured-tab-label"
              role="tab"
              id="${escapeHtml(`${group}-${index + 1}-label`)}"
              aria-controls="${escapeHtml(`${group}-${index + 1}-panel`)}"
              aria-selected="${index === 0 ? "true" : "false"}"
              tabindex="${index === 0 ? "0" : "-1"}"
              data-structured-tab
            >
              <span class="structured-tab-count">${escapeHtml(String(index + 1).padStart(2, "0"))}</span>
              <span>${escapeHtml(panel.title)}</span>
            </button>
          `)
          .join("")}
      </div>
      <div class="structured-tab-panels">
        ${panels
          .map((panel, index) => `
            <article
              class="structured-tab-panel"
              id="${escapeHtml(`${group}-${index + 1}-panel`)}"
              role="tabpanel"
              aria-labelledby="${escapeHtml(`${group}-${index + 1}-label`)}"
              data-structured-tab-panel
            >
              <div class="structured-card-copy">
                ${panel.note ? `<p class="structured-note">${escapeHtml(panel.note)}</p>` : ""}
                <h4>${escapeHtml(panel.title)}</h4>
                ${panel.body ? `<div class="block-rich">${renderRichText(panel.body)}</div>` : ""}
                ${panel.ctaHtml}
              </div>
              ${panel.imageHtml}
            </article>
          `)
          .join("")}
      </div>
    </div>
  `;
}

function renderStructuredAccordion(items, variant, renderContext = {}) {
  const panels = normalizePanelItems(items, renderContext);
  if (!panels.length) return "";

  return `
    <div class="structured-accordion structured-accordion-${escapeHtml(cssToken(variant, "accordion"))}">
      ${panels
        .map((panel, index) => `
          <details class="structured-accordion-item" ${panel.open || index === 0 ? "open" : ""}>
            <summary>
              <span class="structured-accordion-count">${escapeHtml(String(index + 1).padStart(2, "0"))}</span>
              <span class="structured-accordion-title">${escapeHtml(panel.title)}</span>
            </summary>
            <div class="structured-accordion-panel">
              ${panel.note ? `<p class="structured-note">${escapeHtml(panel.note)}</p>` : ""}
              ${panel.body ? `<div class="block-rich">${renderRichText(panel.body)}</div>` : ""}
              ${panel.imageHtml}
              ${panel.ctaHtml}
            </div>
          </details>
        `)
        .join("")}
    </div>
  `;
}

function renderStructuredCollection(items, variant, blockKey, renderContext = {}, value = {}) {
  const token = cssToken(variant, "cards");
  const display = structuredDisplay(value, token);

  if (token === "hero-points") return renderHeroPoints(items);
  if (token === "tabs") return renderStructuredTabs(items, token, blockKey, renderContext);
  if (token === "accordion" || token === "faq-accordion") return renderStructuredAccordion(items, token, renderContext);
  if (token === "process-steps") return renderStructuredProcess(items, display);
  if (token === "comparison-table") return renderStructuredComparison(items, value, display);
  if (token === "timeline") return renderStructuredTimeline(items);
  if (token === "checklist") return renderStructuredChecklist(items, display);
  if (token === "resource-list") return renderStructuredResources(items);
  if (token === "location-cards") return renderStructuredLocations(items, display);
  if (token === "image-comparison") {
    const comparisonItems = Array.isArray(items) ? items.slice(0, 2) : [];
    const html = comparisonItems.map((item, index) => {
      if (!isRecord(item)) return "";
      const title = firstText(item, ["title", "label", "name"]) || `View ${index + 1}`;
      const body = firstText(item, ["body", "description", "copy"]);
      const media = renderStructuredImage(item.image || item.media, title, renderContext, "image-comparison-media");
      if (!media) return "";

      return `<article class="image-comparison-item">${media}<div class="image-comparison-caption"><strong>${escapeHtml(title)}</strong>${body ? `<div class="block-rich">${renderRichText(body)}</div>` : ""}</div></article>`;
    }).join("");

    return html ? `<div class="image-comparison image-comparison-${escapeHtml(display.presentation)}">${html}</div>` : "";
  }

  return renderStructuredItems(items, token, renderContext, display);
}

function structuredCollectionItems(value, variant) {
  const aliases = {
    "process-steps": ["items", "steps"],
    "comparison-table": ["items", "rows"],
    timeline: ["items", "milestones"],
    checklist: ["items", "points"],
    "resource-list": ["items", "resources"],
    "location-cards": ["items", "locations"],
    "bento-grid": ["items", "cards"],
    "navigation-cards": ["items", "cards"],
    "image-comparison": ["items", "images"]
  }[cssToken(variant)] || ["items", "cards", "people", "logos", "questions"];

  for (const key of aliases) {
    if (Array.isArray(value[key])) return value[key];
  }

  return undefined;
}

function renderStructuredBlock(block, renderContext = {}) {
  const value = block.value;
  if (!isRecord(value)) return "";

  const title = firstText(value, ["title", "heading", "headline", "name"]);
  const body = firstText(value, ["body", "text", "copy", "description", "content"]);
  const note = firstText(value, ["note", "kicker", "eyebrow", "summary"]);
  const variant = firstText(value, ["variant", "type"]) || block.settings?.elementId || block.label || "content";
  const variantToken = cssToken(variant);
  const display = structuredDisplay(value, variantToken);
  if (variantToken === "quote-highlight") return renderStructuredQuote(value, display);
  const imageHtml = variantToken === "video"
    ? renderStructuredVideo(value, display)
    : variantToken === "image-hotspots"
      ? renderStructuredHotspotScene(value, display, renderContext)
      : renderStructuredImage(value.image || value.media || block.mediaAsset, title || block.label || "", renderContext);
  const statsHtml = renderStructuredStats(value.stats || value.metrics);
  const itemsHtml = renderStructuredCollection(
    structuredCollectionItems(value, variantToken),
    variant,
    block.key,
    renderContext,
    value
  );
  const cta = isRecord(value.cta) ? value.cta : null;
  const ctaHtml = cta?.label && cta?.url
    ? `<a class="action-link" href="${escapeHtml(safePublicHref(cta.url))}">${escapeHtml(cta.label)}</a>`
    : "";
  const headingTag = ["featureGrid", "pricing", "faq", "custom"].includes(value.type) ? "h2" : "h3";

  if (!title && !body && !note && !imageHtml && !statsHtml && !itemsHtml && !ctaHtml) return "";

  return `
    <article class="structured-block structured-block-${escapeHtml(variantToken)} ${escapeHtml(structuredDisplayClasses(display))}"${variantToken === "video" ? " data-video-frame" : ""}>
      <div class="structured-block-copy">
        ${note ? `<p class="structured-note">${escapeHtml(note)}</p>` : ""}
        ${title ? `<${headingTag}>${escapeHtml(title)}</${headingTag}>` : ""}
        ${body ? `<div class="block-rich">${renderRichText(body)}</div>` : ""}
        ${statsHtml}
        ${ctaHtml}
      </div>
      ${imageHtml}
      ${itemsHtml}
    </article>
  `;
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function safeHex(value) {
  const color = String(value || "").trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : "";
}

function readableForeground(background, preferred) {
  const preferredColor = safeHex(preferred);
  if (preferredColor && contrastRatio(background, preferredColor) >= 4.5) {
    return preferredColor;
  }

  return contrastRatio(background, "#111827") >= contrastRatio(background, "#ffffff")
    ? "#111827"
    : "#ffffff";
}

function contrastRatio(left, right) {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
}

function relativeLuminance(color) {
  const normalized = color.slice(1);
  const hex = normalized.length === 3
    ? normalized.replace(/./g, (value) => value.repeat(2))
    : normalized;
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function safeNumber(value, min, max) {
  if (value === "" || value === null || value === undefined) return "";

  const number = Number(value);
  if (!Number.isFinite(number)) return "";

  return String(Math.min(max, Math.max(min, Math.round(number))));
}

function sectionClassName(section, includeBuilderClasses = true) {
  const settings = section.settings || {};
  const websiteSpec = isRecord(settings.websiteSpec) ? settings.websiteSpec : null;
  const design = sectionDesignSettings(settings);
  const style = design.style;
  const background = design.background;
  const visibility = design.visibility;
  const decoration = settings.decoration || {};
  const responsive = settings.responsive || {};
  const tablet = responsive.tablet || {};
  const mobile = responsive.mobile || {};
  const layout = oneOf(settings.layout, ["one-column", "two-column", "three-column", "four-column", "sidebar-left", "sidebar-right", "full-bleed", "asymmetric"], "one-column");
  const container = oneOf(settings.container, ["narrow", "default", "wide", "full"], "default");
  const spacing = oneOf(settings.spacing, ["none", "sm", "md", "lg", "xl"], "md");
  const gap = oneOf(settings.gap, ["sm", "md", "lg", "xl"], "md");
  const align = oneOf(settings.align, ["start", "center", "end"], "start");
  const verticalAlign = oneOf(settings.verticalAlign, ["start", "center", "end"], "start");
  const preset = oneOf(style.preset, ["default", "quiet", "carded", "contrast", "premium-dark", "editorial-light", "industrial-grid", "framed-card", "liquid"], "default");
  const shadow = oneOf(style.shadow, ["none", "soft", "strong", "glow"], "none");
  const decorationType = oneOf(decoration.type, ["none", "glow", "orb", "pattern", "spotlight", "grid", "frame", "texture", "split"], "none");
  const websiteSpecPreset = websiteSpec ? cssToken(style.preset, preset) : preset;
  const websiteSpecDecoration = websiteSpec ? cssToken(decoration.type, decorationType) : decorationType;
  const decorationPosition = oneOf(decoration.position, ["top-left", "top-right", "center-left", "center-right", "bottom-left", "bottom-right"], "bottom-right");
  const tabletLayout = oneOf(tablet.layout, ["inherit", "one-column", "two-column", "three-column"], "inherit");
  const tabletSpacing = oneOf(tablet.spacing, ["inherit", "none", "sm", "md", "lg", "xl"], "inherit");
  const mobileLayout = oneOf(mobile.layout, ["inherit", "one-column", "two-column"], "one-column");
  const mobileSpacing = oneOf(mobile.spacing, ["inherit", "none", "sm", "md", "lg", "xl"], "sm");

  return [
    "page-section",
    websiteSpec ? "section website-spec-section" : "",
    websiteSpec?.type ? `section-${cssToken(websiteSpec.type)}` : "",
    websiteSpec?.collection === true ? "is-collection" : "",
    websiteSpec?.type === "hero" && settings.mediaMode === "background"
      ? "section-media-background has-background-media"
      : "",
    background.mode === "image" && background.imageUrl ? "has-section-background-image" : "",
    style.borderWidth > 0 ? "section-has-border" : "",
    visibility.desktop ? "" : "section-hidden-desktop",
    visibility.tablet ? "" : "section-hidden-tablet",
    visibility.mobile ? "" : "section-hidden-mobile",
    websiteSpec ? `layout-${layout}` : "",
    websiteSpec ? `container-${container}` : "",
    websiteSpec ? `spacing-${spacing}` : "",
    websiteSpec ? `gap-${gap}` : "",
    websiteSpec ? `align-${align}` : "",
    websiteSpec ? `valign-${verticalAlign}` : "",
    websiteSpec ? `preset-${websiteSpecPreset}` : "",
    websiteSpec ? `shadow-${shadow}` : "",
    websiteSpec ? `decoration-${websiteSpecDecoration}` : "",
    ...(!websiteSpec || includeBuilderClasses ? [
      `section-layout-${layout}`,
      `section-container-${container}`,
      `section-spacing-${spacing}`,
      `section-gap-${gap}`,
      `section-align-${align}`,
      `section-valign-${verticalAlign}`,
      `section-style-${preset}`,
      `section-shadow-${shadow}`,
      `section-decoration-${decorationType}`,
      `section-decoration-${decorationPosition}`,
      `section-tablet-layout-${tabletLayout}`,
      `section-tablet-spacing-${tabletSpacing}`,
      `section-mobile-layout-${mobileLayout}`,
      `section-mobile-spacing-${mobileSpacing}`
    ] : []),
    advancedClassList(settings)
  ].join(" ");
}

function sectionStyleAttribute(section) {
  const settings = section.settings || {};
  const design = sectionDesignSettings(settings);
  const style = design.style;
  const sectionBackground = design.background;
  const decoration = settings.decoration || {};
  const background = sectionBackground.mode === "none"
    ? ""
    : safeHex(sectionBackground.color || style.backgroundColor || style.background);
  const configuredText = safeHex(style.textColor ?? style.foreground);
  const preferredText = safeHex(state.config?.siteSettings?.design?.colors?.primary);
  const overlayColor = safeHex(sectionBackground.overlayColor) || "#000000";
  const imageText = sectionBackground.mode === "image" && sectionBackground.overlayOpacity >= 0.2
    ? readableForeground(overlayColor, preferredText)
    : "";
  const text = configuredText || imageText || (background ? readableForeground(background, preferredText) : "");
  const declarations = [
    background ? `--section-bg:${background}` : "",
    text ? `--section-text:${text}` : "",
    safeHex(style.accentColor ?? style.accent)
      ? `--section-accent:${safeHex(style.accentColor ?? style.accent)}`
      : "",
    safeNumber(style.radius, 0, 48) ? `--section-radius:${safeNumber(style.radius, 0, 48)}px` : "",
    style.borderWidth > 0 ? `--section-border-width:${safeNumber(style.borderWidth, 0, 8)}px` : "",
    style.borderWidth > 0 && safeHex(style.borderColor) ? `--section-border-color:${safeHex(style.borderColor)}` : "",
    safeNumber(settings.minHeight, 0, 1200) ? `--section-min-height:${safeNumber(settings.minHeight, 0, 1200)}px` : "",
    sectionBackground.mode === "image" ? `--section-background-fit:${sectionBackground.style === "contain" ? "contain" : "cover"}` : "",
    sectionBackground.mode === "image" ? `--section-background-position:${safeMediaPosition(sectionBackground.position)}` : "",
    sectionBackground.mode === "image" ? `--section-background-overlay-color:${overlayColor}` : "",
    sectionBackground.mode === "image" ? `--section-background-overlay-opacity:${safeRatio(sectionBackground.overlayOpacity) || "0"}` : "",
    settings.mediaMode === "background" && safeHex(settings.overlayColor)
      ? `--section-overlay-color:${safeHex(settings.overlayColor)}`
      : "",
    settings.mediaMode === "background" && safeRatio(settings.overlayOpacity)
      ? `--section-overlay-opacity:${safeRatio(settings.overlayOpacity)}`
      : "",
    settings.mediaMode === "background"
      ? `--section-media-position:${safeMediaPosition(settings.mediaPosition)}`
      : "",
    safeHex(decoration.color) ? `--section-decoration-color:${safeHex(decoration.color)}` : "",
    Number.isFinite(Number(decoration.opacity)) ? `--section-decoration-opacity:${Math.min(0.9, Math.max(0, Number(decoration.opacity)))}` : "",
    animationCssVariables(settings),
    sanitizeInlineCss(settings.customCss || "")
  ].filter(Boolean).join("; ");

  return declarations ? ` style="${escapeHtml(declarations)}"` : "";
}

function safeMediaPosition(value) {
  return ({
    center: "center center",
    top: "center top",
    bottom: "center bottom",
    left: "left center",
    right: "right center",
    "top-left": "left top",
    "top-right": "right top",
    "bottom-left": "left bottom",
    "bottom-right": "right bottom"
  })[value] || "center center";
}

function safeRatio(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.min(0.9, Math.max(0, number))) : "";
}

function blockClassName(block) {
  const key = String(block.key || "");
  const role = key.endsWith("-eyebrow")
    ? "website-spec-eyebrow"
    : key.endsWith("-heading")
      ? "website-spec-heading"
      : key.endsWith("-body")
        ? "website-spec-body"
        : key.endsWith("-cta")
          ? "website-spec-cta"
          : key.endsWith("-points")
            ? "website-spec-points"
            : "";

  return [
    "content-block",
    `content-type-${cssToken(block.type || "content")}`,
    block.type === "IMAGE" ? "section-media" : "",
    block.type === "GALLERY" ? "gallery-content-block" : "",
    role,
    advancedClassList(block.settings || {})
  ].filter(Boolean).join(" ");
}

function renderSectionDecoration(section) {
  const decoration = section.settings?.decoration || {};
  const type = oneOf(decoration.type, ["none", "glow", "orb", "pattern", "spotlight", "grid", "frame", "texture", "split"], "none");
  if (type === "none") return "";

  return `<span class="section-decoration-layer" aria-hidden="true"></span>`;
}

function renderSectionDesignBackground(section, renderContext) {
  const design = sectionDesignSettings(section.settings || {});
  const background = design.background;
  if (background.mode !== "image") return "";
  if (isRecord(section.settings?.websiteSpec) && section.settings?.mediaMode === "background") return "";

  const src = safeMediaSrc(background.imageUrl);
  if (!src) return "";

  const overlay = background.overlayOpacity > 0
    ? '<span class="section-design-overlay" aria-hidden="true"></span>'
    : "";
  const width = positiveImageDimension(background.width);
  const height = positiveImageDimension(background.height);
  if (background.style === "tile" || !width || !height) {
    const declaration = `background-image:url(${JSON.stringify(src)})`;
    const className = background.style === "tile"
      ? "section-design-background section-design-background-tile"
      : "section-design-background section-design-background-css";
    return `<span class="${className}" aria-hidden="true" style="${escapeHtml(declaration)}"></span>${overlay}`;
  }

  const highPriority = design.visibility.desktop && renderContext.highPriorityImageUsed !== true;
  if (highPriority) renderContext.highPriorityImageUsed = true;

  return `<span class="section-design-background" aria-hidden="true"><img src="${escapeHtml(src)}" alt="" width="${width}" height="${height}" loading="${highPriority ? "eager" : "lazy"}" decoding="async"${highPriority ? ' fetchpriority="high"' : ""} /></span>${overlay}`;
}

function sanitizeRichHtml(value) {
  const allowedTags = new Set([
    "a",
    "blockquote",
    "br",
    "code",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strong",
    "u",
    "ul"
  ]);

  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<([/]?)([a-z0-9-]+)([^>]*)>/gi, (match, closing, tagName, attrs) => {
      const tag = String(tagName).toLowerCase();
      if (!allowedTags.has(tag)) return "";
      if (closing) return `</${tag}>`;
      if (tag === "br") return "<br>";

      const safeAttrs = [];
      if (tag === "a") {
        const href = attrs.match(/\shref=(["'])(.*?)\1/i)?.[2];
        safeAttrs.push(`href="${escapeHtml(safeRichHref(href))}"`);
      }

      return `<${tag}${safeAttrs.length ? ` ${safeAttrs.join(" ")}` : ""}>`;
    });
}

export function renderRichText(value) {
  if (/<\/?(p|h[1-6]|ul|ol|li|strong|em|u|s|blockquote|pre|code|br|span|a)\b/i.test(String(value))) {
    return sanitizeRichHtml(value);
  }

  return String(value)
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trimEnd()).filter(Boolean);
      if (!lines.length) return "";

      if (lines.every((line) => line.trimStart().startsWith("- "))) {
        return `<ul>${lines
          .map((line) => `<li>${renderInlineRichText(line.trimStart().slice(2))}</li>`)
          .join("")}</ul>`;
      }

      if (lines[0].startsWith("## ")) {
        return `<h3>${renderInlineRichText(lines[0].slice(3))}</h3>`;
      }

      return `<p>${lines.map(renderInlineRichText).join("<br>")}</p>`;
    })
    .join("");
}

function normalizeCustomCode(value) {
  if (typeof value === "string") {
    return { html: value, css: "", javascript: "", libraries: [], height: 320 };
  }

  if (!isRecord(value)) return null;

  return {
    html: typeof value.html === "string" ? value.html : "",
    css: typeof value.css === "string" ? value.css : "",
    javascript: typeof value.javascript === "string" ? value.javascript : "",
    libraries: Array.isArray(value.libraries) ? value.libraries : [],
    height: Number.isInteger(value.height) ? Math.min(1200, Math.max(120, value.height)) : 320
  };
}

function renderCustomCodeBlock(block, renderContext) {
  const value = normalizeCustomCode(block.value);
  const hasCode = value && (
    value.html.trim() ||
    value.css.trim() ||
    value.javascript.trim() ||
    value.libraries.length
  );
  if (!hasCode) return '<div class="custom-code-placeholder">Custom code is empty.</div>';

  if (renderContext.allowCustomCode !== true) {
    return '<div class="custom-code-placeholder">Custom code preview paused.</div>';
  }

  if (!block.id) {
    return '<div class="custom-code-placeholder">Custom code is not published yet.</div>';
  }

  const apiPrefix = state.config?.api?.prefix || "/api/v1";
  const source = `${apiPrefix}/cms/custom-code/${encodeURIComponent(block.id)}`;
  return `
    <iframe
      class="custom-code-frame"
      data-custom-code-frame
      title="${escapeHtml(block.label || "Custom code")}"
      src="${escapeHtml(source)}"
      sandbox="allow-scripts allow-forms"
      referrerpolicy="no-referrer"
      loading="lazy"
      style="--custom-code-height:${escapeHtml(value.height)}px"
    ></iframe>
  `;
}

export function renderBlock(block, renderContext = {}) {
  const value = block.value;
  const knownObjectTypes = new Set(["IMAGE", "GALLERY", "BUTTON", "CTA", "CONTACT_FORM", "PRODUCT_LIST"]);

  if (isRecord(value) && !knownObjectTypes.has(block.type)) {
    const structuredHtml = renderStructuredBlock(block, renderContext);
    if (structuredHtml) return structuredHtml;
  }

  if (block.type === "TEXT") {
    return `<p>${escapeHtml(value)}</p>`;
  }

  if (block.type === "RICH_TEXT") {
    return `<div class="block-rich">${renderRichText(value)}</div>`;
  }

  if (block.type === "IMAGE") {
    const image = isRecord(value)
      ? { ...(isRecord(block.mediaAsset) ? block.mediaAsset : {}), ...value }
      : { ...(isRecord(block.mediaAsset) ? block.mediaAsset : {}), url: value };
    if (!normalizedImage(image)) return '<div class="fallback-content">Image source is not available.</div>';

    return renderImageTag(image, image.alt || block.label || "", "section-image", "block-image", renderContext);
  }

  if (block.type === "GALLERY") {
    if (isGalleryValue(value)) {
      const items = galleryItems(value);
      const settings = gallerySettings(value);
      if (!items.length) return '<div class="fallback-content">Gallery images are not available.</div>';

      const style = [
        `--gallery-columns-desktop:${settings.columnsDesktop}`,
        `--gallery-columns-tablet:${settings.columnsTablet}`,
        `--gallery-columns-mobile:${settings.columnsMobile}`,
        `--gallery-gap:${settings.gap}px`,
        `--gallery-ratio:${settings.imageRatio}`,
        `--gallery-fit:${settings.objectFit}`
      ].join(";");

      return `
        <div
          class="gallery-block gallery-grid gallery-layout-${escapeHtml(settings.layoutMode)}${settings.showCaptions ? " gallery-show-captions" : ""}"
          style="${escapeHtml(style)}"
        >
          ${items
            .map((item, index) => {
              const src = safeMediaSrc(item.url);
              if (!src) return "";
              const image = renderImageTag(item, item.alt || `Gallery image ${index + 1}`, "gallery-block", "block-image", renderContext);
              const href = item.link ? safePublicHref(item.link) : settings.lightbox ? src : "";
              const linkLabel = item.link
                ? `View ${item.alt || `gallery item ${index + 1}`}`
                : `Open ${item.alt || `gallery image ${index + 1}`}`;

              return `
                <figure class="gallery-item">
                  ${image}
                  ${settings.showCaptions && item.caption ? `<figcaption>${renderRichText(item.caption)}</figcaption>` : ""}
                  ${href ? `<a class="gallery-item-stretched-link" href="${escapeHtml(href)}" aria-label="${escapeHtml(linkLabel)}"${href === src ? ' target="_blank" rel="noreferrer"' : ""}><span class="visually-hidden">${escapeHtml(linkLabel)}</span></a>` : ""}
                </figure>
              `;
            })
            .join("")}
        </div>
      `;
    }

    const slides = sliderSlides(value);
    const settings = sliderSettings(value);
    if (!slides.length) return '<div class="fallback-content">Slider images are not available.</div>';
    const captions = slides.map((slide) => slide.caption || settings.caption).map((caption) => caption || "");
    const hasCaption = captions.some(Boolean);
    const singleStep = settings.effect === "fade" || settings.effect === "zoom" || settings.focusMode === "peek";
    const stepCount = Math.max(1, slides.length - (singleStep ? 1 : settings.slidesPerView) + 1);

    return `
      <div
        class="gallery-block slider-block slider-mode-${escapeHtml(settings.displayMode)} slider-effect-${escapeHtml(settings.effect)} slider-direction-${escapeHtml(settings.direction)} slider-focus-${escapeHtml(settings.focusMode)} slider-container-fade-${escapeHtml(settings.containerFade)} slider-text-${escapeHtml(settings.textPosition)} slider-nav-${escapeHtml(settings.navigationPosition)} slider-nav-style-${escapeHtml(settings.navigationStyle)}"
        data-slider
        data-slider-index="0"
        data-slider-loop="${settings.loop ? "true" : "false"}"
        data-slider-per-view="${escapeHtml(settings.slidesPerView)}"
        data-slider-effect="${escapeHtml(settings.effect)}"
        data-slider-direction="${escapeHtml(settings.direction)}"
        data-slider-focus="${escapeHtml(settings.focusMode)}"
        style="--slider-visible:${escapeHtml(settings.slidesPerView)};--slider-overlay-color:${escapeHtml(settings.overlayColor)};--slider-overlay-opacity:${escapeHtml(settings.overlayOpacity)};--slider-caption-width:${escapeHtml(settings.textWidth)}%;"
      >
        <div class="slider-stage">
          <div class="slider-track" data-slider-track>
            ${slides
              .map((item, index) => {
                const src = safeMediaSrc(item.url);
                return src
                  ? `<figure class="slider-slide ${index === 0 ? "active" : ""}">
                      ${renderImageTag(item, item.alt || `Slide ${index + 1}`, "gallery-block", "block-image", renderContext)}
                    </figure>`
                  : "";
              })
              .join("")}
          </div>
          <div class="slider-overlay" aria-hidden="${hasCaption ? "false" : "true"}">
            ${captions
              .map((caption, index) =>
                caption
                  ? `<div class="slider-caption ${index === 0 ? "active" : ""}" data-slider-caption="${index}">${renderRichText(caption)}</div>`
                  : ""
              )
              .join("")}
          </div>
        </div>
        ${settings.showNavigation ? `<div class="slider-controls">
          <button type="button" class="secondary-button" data-slider-prev${stepCount <= 1 || !settings.loop ? " disabled" : ""}>${escapeHtml(translateString("slider.previous", "Previous"))}</button>
          <span data-slider-count>1 / ${stepCount}</span>
          <button type="button" class="secondary-button" data-slider-next${stepCount <= 1 ? " disabled" : ""}>${escapeHtml(translateString("slider.next", "Next"))}</button>
        </div>` : ""}
      </div>
    `;
  }

  if (block.type === "EMBED") {
    return renderCustomCodeBlock(block, renderContext);
  }

  if (block.type === "BUTTON" || block.type === "CTA") {
    const action = isRecord(value) ? value : { label: value || block.label, url: "#" };
    return `<a class="action-link" href="${escapeHtml(safePublicHref(action.url))}">${escapeHtml(action.label || "Learn more")}</a>`;
  }

  if (block.type === "CONTACT_FORM") {
    const formKey = value?.formKey || block.key || "contact";
    const subject = value?.subject || "";
    const buttonLabel = value?.buttonLabel || translateString("form.contact.submit", "Send inquiry");

    return `
      <form class="contact-form" data-contact-form>
        <input type="hidden" name="formKey" value="${escapeHtml(formKey)}" />
        <input type="hidden" name="startedAt" value="${new Date().toISOString()}" />
        <label><span>${escapeHtml(translateString("form.contact.name", "Name"))}</span><input name="name" type="text" autocomplete="name" required /></label>
        <label><span>${escapeHtml(translateString("form.contact.email", "Email"))}</span><input name="email" type="email" autocomplete="email" required /></label>
        <label><span>${escapeHtml(translateString("form.contact.phone", "Phone"))}</span><input name="phone" type="tel" autocomplete="tel" /></label>
        <label><span>${escapeHtml(translateString("form.contact.subject", "Subject"))}</span><input name="subject" type="text" value="${escapeHtml(subject)}" /></label>
        <label><span>${escapeHtml(translateString("form.contact.message", "Message"))}</span><textarea name="message" required></textarea></label>
        <label class="contact-form-trap" aria-hidden="true">
          <span>${escapeHtml(translateString("form.contact.website", "Website"))}</span>
          <input name="website" type="text" tabindex="-1" autocomplete="off" />
        </label>
        ${renderFormMessage("")}
        <button type="submit">${escapeHtml(buttonLabel)}</button>
      </form>
    `;
  }

  if (block.type === "PRODUCT_LIST") {
    if (renderContext.commerceEnabled === false) {
      return '<div class="fallback-content">The shop is not enabled for this site.</div>';
    }

    const slugs = Array.isArray(value?.productSlugs) ? value.productSlugs : [];
    const products = Array.isArray(value?.products) ? value.products : [];
    const layout = oneOf(value?.layout, ["grid", "spotlight", "compact"], "grid");
    const columns = [2, 3, 4].includes(Number(value?.columns)) ? Number(value.columns) : 3;
    const title = firstText(value, ["title", "heading"]);
    const body = firstText(value, ["body", "description", "copy"]);
    const shopOptions = {
      locale: renderContext.locale || state.publicRenderLocale || state.config?.localization?.defaultLocale || "en",
      defaultLocale: state.config?.localization?.defaultLocale || "en",
      shopSettings: renderContext.shopSettings,
      showDescription: value?.showDescription !== false
    };

    return `
      <section class="product-list-slot product-list-layout-${escapeHtml(layout)}" data-commerce-root style="--product-list-columns:${escapeHtml(columns)}">
        ${title || body ? `<header class="product-list-heading">${title ? `<h3>${escapeHtml(title)}</h3>` : ""}${body ? `<div class="block-rich">${renderRichText(body)}</div>` : ""}</header>` : ""}
        <div class="product-list-grid">
          ${products.length
            ? products.map((product) => renderShopProductCard(product, shopOptions)).join("")
            : slugs.map((slug) => `<a class="product-list-fallback" href="${escapeHtml(localizedShopPath(`/product/${encodePathSegment(slug)}`, shopOptions))}">${escapeHtml(slug)}</a>`).join("") || '<div class="fallback-content">Choose products to display.</div>'}
        </div>
        ${state.visualEditorActive && state.user && moduleEnabled("products") && hasPermission("create", "products") ? renderEditorButton("+ Product", "data-add-product-inline") : ""}
      </section>
    `;
  }

  return '<div class="fallback-content">This content block is not available in the public renderer.</div>';
}

function websiteSpecBlock(section, role) {
  return section.blocks.find((block) => String(block.key || "").endsWith(`-${role}`));
}

function websiteSpecStructuredValue(section) {
  const block = section.blocks.find((candidate) => candidate.type === "CUSTOM" && isRecord(candidate.value));
  return isRecord(block?.value) ? block.value : {};
}

function renderWebsiteSpecIntro(section, headingLevel = "h2") {
  const structured = websiteSpecStructuredValue(section);
  const eyebrow = websiteSpecBlock(section, "eyebrow");
  const heading = websiteSpecBlock(section, "heading");
  const body = websiteSpecBlock(section, "body");
  const eyebrowText = typeof eyebrow?.value === "string"
    ? eyebrow.value
    : firstText(structured, ["eyebrow", "note", "kicker"]);
  const headingText = firstText(structured, ["heading", "title", "headline"]);
  const bodyText = firstText(structured, ["body", "text", "copy", "description"]);

  return [
    eyebrowText ? `<p class="eyebrow">${escapeHtml(eyebrowText)}</p>` : "",
    heading?.value
      ? renderRichText(heading.value)
      : headingText
        ? `<${headingLevel}>${escapeHtml(headingText)}</${headingLevel}>`
        : "",
    body?.value
      ? body.type === "TEXT" ? `<p>${escapeHtml(body.value)}</p>` : renderRichText(body.value)
      : bodyText ? `<p>${escapeHtml(bodyText)}</p>` : ""
  ].join("");
}

function renderWebsiteSpecCta(section) {
  const structured = websiteSpecStructuredValue(section);
  const block = websiteSpecBlock(section, "cta");
  const action = isRecord(block?.value)
    ? block.value
    : isRecord(structured.cta)
      ? structured.cta
      : null;
  if (!action?.label || !action?.url) return "";

  const style = oneOf(action.style, ["primary", "secondary", "link"], "primary");
  return `<a class="button action-link ${escapeHtml(style)}" href="${escapeHtml(safePublicHref(action.url))}">${escapeHtml(action.label)}</a>`;
}

function renderWebsiteSpecCards(section, type, renderContext) {
  const structured = websiteSpecStructuredValue(section);
  const items = Array.isArray(structured.items) ? structured.items : [];
  const cards = items
    .map((item) => {
      if (!isRecord(item)) return "";

      const title = firstText(item, ["title", "name", "label"]);
      const body = firstText(item, ["body", "text", "copy", "description", "content"]);
      const label = firstText(item, ["label", "role", "kicker", "eyebrow", "meta"]);
      const value = firstText(item, ["value", "price", "metric"]);
      const media = renderStructuredImage(
        item.image || item.media,
        title || label,
        renderContext,
        "card-media"
      );
      const url = item.url ? safePublicHref(item.url) : "";
      if (!title && !body && !label && !value && !media) return "";

      return [
        '<article class="content-card structured-card">',
        media,
        label && label !== title ? `<small>${escapeHtml(label)}</small>` : "",
        title ? `<h3>${escapeHtml(title)}</h3>` : "",
        value ? `<strong>${escapeHtml(value)}</strong>` : "",
        body ? `<p>${escapeHtml(body)}</p>` : "",
        url ? `<a href="${escapeHtml(url)}">Learn more</a>` : "",
        "</article>"
      ].join("");
    })
    .join("");

  if (!cards) return "";

  return `<div class="card-grid structured-items${type === "pricing" ? " pricing-grid" : ""}">${cards}</div>`;
}

function renderWebsiteSpecFaq(section) {
  const structured = websiteSpecStructuredValue(section);
  const items = Array.isArray(structured.items) ? structured.items : [];
  const entries = items
    .map((item, index) => {
      if (!isRecord(item)) return "";
      const title = firstText(item, ["title", "name", "label"]);
      const body = firstText(item, ["body", "text", "copy", "description", "content"]);
      if (!title && !body) return "";

      return [
        `<details ${index === 0 ? "open" : ""}>`,
        `<summary>${escapeHtml(title || `Question ${index + 1}`)}</summary>`,
        body ? `<p>${escapeHtml(body)}</p>` : "",
        "</details>"
      ].join("");
    })
    .join("");

  return entries ? `<div class="faq-list">${entries}</div>` : "";
}

function renderWebsiteSpecMedia(section, className, renderContext) {
  const block = section.blocks.find((candidate) => candidate.type === "IMAGE");
  if (!block) return "";

  return `<figure class="${escapeHtml(className)}">${renderBlock(block, renderContext)}</figure>`;
}

function renderWebsiteSpecBackgroundMedia(section, renderContext) {
  if (section.settings?.websiteSpec?.type !== "hero" || section.settings?.mediaMode !== "background") {
    return "";
  }

  const media = renderWebsiteSpecMedia(section, "section-background-media", renderContext);
  return media ? `${media}<span class="section-background-overlay" aria-hidden="true"></span>` : "";
}

function renderWebsiteSpecSection(section, renderContext) {
  const websiteSpec = section.settings?.websiteSpec;
  const type = websiteSpec?.type || "text";
  const intro = renderWebsiteSpecIntro(section, type === "hero" ? "h1" : "h2");
  const cta = renderWebsiteSpecCta(section);

  if (type === "hero") {
    const points = websiteSpecBlock(section, "points");
    const items = isRecord(points?.value) && Array.isArray(points.value.items) ? points.value.items : [];
    const backgroundMedia = section.settings?.mediaMode === "background";
    return [
      `<div class="section-copy content-block hero-copy">${intro}${cta}${renderHeroPoints(items)}</div>`,
      backgroundMedia ? "" : renderWebsiteSpecMedia(section, "section-media hero-media", renderContext)
    ].join("");
  }

  if (["featureGrid", "pricing", "faq"].includes(type)) {
    const collection = type === "faq"
      ? renderWebsiteSpecFaq(section)
      : renderWebsiteSpecCards(section, type, renderContext);
    return `<div class="section-copy content-block">${intro}${cta}</div>${collection}`;
  }

  if (type === "custom") {
    const custom = section.blocks.find((candidate) => candidate.type === "CUSTOM" || candidate.settings?.elementId);
    return custom ? renderBlock(custom, renderContext) : `<div class="section-copy content-block">${intro}${cta}</div>`;
  }

  if (type === "gallery") {
    const gallery = section.blocks.find((candidate) => candidate.type === "GALLERY");
    return `<div class="section-copy content-block">${intro}${cta}</div>${gallery ? renderBlock(gallery, renderContext) : ""}`;
  }

  if (type === "contactForm") {
    const form = section.blocks.find((candidate) => candidate.type === "CONTACT_FORM");
    return `<div class="section-copy content-block">${intro}</div>${form ? renderBlock(form, renderContext) : ""}`;
  }

  if (type === "productList") {
    const products = section.blocks.find((candidate) => candidate.type === "PRODUCT_LIST");
    return `<div class="section-copy content-block">${intro}${cta}</div>${products ? renderBlock(products, renderContext) : ""}`;
  }

  if (type === "cta") {
    return `<div class="section-copy content-block cta-copy">${intro}${cta}</div>`;
  }

  return [
    `<div class="section-copy content-block">${intro}${cta}</div>`,
    renderWebsiteSpecMedia(section, "section-media", renderContext)
  ].join("");
}

function renderStandardSectionBlocks(section, canEdit, renderContext) {
  return section.blocks
    .map(
      (block, blockIndex, blocks) => `
        <div class="${escapeHtml(blockClassName(block))}${canEdit && state.visualEditorSelection?.type === "block" && state.visualEditorSelection.key === block.key ? " visual-selected" : ""}" data-block-key="${escapeHtml(block.key)}" data-editable="${block.editable}"${canEdit ? ` data-visual-block tabindex="0" role="group" aria-label="${escapeHtml(block.label || block.key || `Element ${blockIndex + 1}`)}" aria-selected="${state.visualEditorSelection?.type === "block" && state.visualEditorSelection.key === block.key ? "true" : "false"}"` : ""}${advancedIdAttribute(block.settings || {})}${advancedStyleAttribute(block.settings || {})}>
          ${canEdit ? renderVisualBlockControls(block, blockIndex, blocks) : ""}
          ${canEdit ? `<div data-visual-edit-surface>${renderBlock(block, renderContext)}</div>` : renderBlock(block, renderContext)}
        </div>
      `
    )
    .join("");
}

export function renderSections(page, options = {}) {
  const layout = normalizePageLayout(page.content?.layout);
  const canEdit = options.canEdit === true;
  const renderContext = {
    ...(options.imageContext || { highPriorityImageUsed: false }),
    allowCustomCode: options.allowCustomCode !== false && !canEdit,
    commerceEnabled: options.commerceEnabled,
    locale: options.locale,
    shopSettings: options.shopSettings
  };

  if (!page.sections?.length) {
    return '<div class="fallback-content">This page does not have visible sections yet.</div>';
  }

  return `
    <div class="page-sections page-layout-${escapeHtml(layout)}">
      ${page.sections
        .map(
          (section, sectionIndex, sections) => `
            <section class="${escapeHtml(sectionClassName(section, canEdit))}${isRecord(section.settings?.websiteSpec) && sectionIndex === 0 ? " is-first" : ""}${canEdit && state.visualEditorSelection?.type === "section" && state.visualEditorSelection.key === (section.key || section.id) ? " visual-selected" : ""}" data-section-id="${escapeHtml(section.id)}" data-section-key="${escapeHtml(section.key || section.id)}"${canEdit ? ` data-visual-section tabindex="0" role="group" aria-label="${escapeHtml(section.label || section.key || `Section ${sectionIndex + 1}`)}" aria-selected="${state.visualEditorSelection?.type === "section" && state.visualEditorSelection.key === (section.key || section.id) ? "true" : "false"}"` : ""}${advancedIdAttribute(section.settings || {})}${sectionStyleAttribute(section)}>
              ${canEdit ? renderVisualSectionControls(section, sectionIndex, sections) : ""}
              ${renderSectionDesignBackground(section, renderContext)}
              ${isRecord(section.settings?.websiteSpec) && !canEdit
                ? renderWebsiteSpecBackgroundMedia(section, renderContext)
                : ""}
              ${renderSectionDecoration(section)}
              ${section.label ? `<h2 class="section-label">${escapeHtml(section.label)}</h2>` : ""}
              ${isRecord(section.settings?.websiteSpec) ? '<div class="section-inner">' : ""}
              ${isRecord(section.settings?.websiteSpec) && !canEdit
                ? renderWebsiteSpecSection(section, renderContext)
                : renderStandardSectionBlocks(section, canEdit, renderContext)}
              ${isRecord(section.settings?.websiteSpec) ? "</div>" : ""}
            </section>
          `
        )
        .join("")}
    </div>
  `;
}

function shopPrimaryImage(product = {}) {
  return product.images?.find((image) => image.isPrimary) || product.images?.[0] || null;
}

function shopProductAttributes(product = {}) {
  const metadata = isRecord(product.metadata) ? product.metadata : {};
  return Array.isArray(metadata.attributes) ? metadata.attributes : [];
}

function shopPurchaseMode(product = {}) {
  const metadata = isRecord(product.metadata) ? product.metadata : {};
  return metadata.purchaseMode === "quote" ? "quote" : "buy";
}

function activeShopVariants(product = {}) {
  return Array.isArray(product.variants)
    ? product.variants.filter((variant) => variant?.active !== false)
    : [];
}

function shopAttributeSlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function localizedShopPath(path, options = {}) {
  const defaultLocale = options.defaultLocale || state.config?.localization?.defaultLocale || "en";
  const locale = options.locale || currentLocale();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return locale === defaultLocale ? normalizedPath : `/${encodePathSegment(locale)}${normalizedPath}`;
}

function renderShopProductImage(image, fallbackAlt = "", priority = false) {
  return renderImageTag(
    image,
    image?.alt || fallbackAlt,
    "shop-card",
    "",
    { highPriorityImageUsed: !priority }
  );
}

function renderShopProductCard(product, options) {
  const image = shopPrimaryImage(product);
  const imageHtml = renderShopProductImage(image, product.name);
  const href = localizedShopPath(`/product/${encodePathSegment(product.slug)}`, options);
  const settings = normalizeShopSettings(options.shopSettings);
  const variants = activeShopVariants(product);
  const availableStock = variants.length
    ? variants.reduce((total, variant) => total + Math.max(0, Number(variant.availableStock ?? variant.stockQuantity) || 0), 0)
    : Math.max(0, Number(product.availableStock ?? product.stockQuantity) || 0);
  const purchaseMode = shopPurchaseMode(product);

  return `
    <article class="shop-product-card">
      <a href="${escapeHtml(href)}">
        ${imageHtml || `<div class="shop-product-image-placeholder">${escapeHtml(translateString("shop.noImage", "No image"))}</div>`}
        <span class="shop-product-category">${escapeHtml(product.category?.name || translateString("shop.product", "Product"))}</span>
        <strong>${escapeHtml(product.name)}</strong>
      </a>
      ${settings.showDescriptions && options.showDescription !== false && product.description ? `<p>${escapeHtml(product.description)}</p>` : ""}
      <div class="shop-product-card-meta">
        ${settings.showSku && product.sku ? `<small>${escapeHtml(product.sku)}</small>` : ""}
        ${settings.showStock && purchaseMode === "buy" ? `<span>${escapeHtml(availableStock)} ${escapeHtml(translateString("shop.inStock", "in stock"))}</span>` : ""}
        <b>${escapeHtml(purchaseMode === "quote" ? translateString("shop.tailoredPricing", "Tailored pricing") : formatMoney(product.priceCents, product.currency || "EUR"))}</b>
      </div>
      <div class="shop-product-card-actions">
        ${purchaseMode === "quote"
          ? `<button type="button" class="secondary-button" data-commerce-quote data-product-id="${escapeHtml(product.id || "")}" data-product-name="${escapeHtml(product.name)}">${escapeHtml(translateString("shop.requestQuote", "Request a quote"))}</button>`
          : variants.length
            ? `<a class="secondary-button" href="${escapeHtml(href)}">${escapeHtml(translateString("shop.chooseOptions", "Choose options"))}</a>`
            : `<button type="button" data-commerce-add data-product-id="${escapeHtml(product.id || "")}" data-product-name="${escapeHtml(product.name)}" ${availableStock > 0 ? "" : "disabled"}>${escapeHtml(availableStock > 0 ? translateString("shop.addToCart", "Add to cart") : translateString("shop.soldOut", "Sold out"))}</button>`}
      </div>
    </article>
  `;
}

function renderShopCategoryLinks(categories = [], activeSlug = "", options = {}) {
  return `
    <div class="shop-filter-row">
      <a href="${escapeHtml(localizedShopPath("/shop", options))}" class="${activeSlug ? "" : "active"}">${escapeHtml(translateString("shop.allProducts", "All products"))}</a>
      ${categories
        .map((category) => {
          const href = localizedShopPath(`/shop/category/${encodePathSegment(category.slug)}`, options);
          return `<a href="${escapeHtml(href)}" class="${category.slug === activeSlug ? "active" : ""}">${escapeHtml(category.name)}</a>`;
        })
        .join("")}
    </div>
  `;
}

function renderShopAttributeLinks(attributes = [], route = {}, options = {}) {
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
                    const slug = shopAttributeSlug(value);
                    const active = route.attributeName === attribute.slug && route.attributeValue === slug;
                    const href = localizedShopPath(
                      `/shop/attribute/${encodePathSegment(attribute.slug)}/${encodePathSegment(slug)}`,
                      options
                    );
                    return `<a href="${escapeHtml(href)}" class="${active ? "active" : ""}">${escapeHtml(value)}</a>`;
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

function shopListingPath(route = {}, options = {}) {
  if (route.category) {
    return localizedShopPath(`/shop/category/${encodePathSegment(route.category)}`, options);
  }
  if (route.attributeName) {
    return localizedShopPath(
      `/shop/attribute/${encodePathSegment(route.attributeName)}/${encodePathSegment(route.attributeValue || "")}`,
      options
    );
  }

  return localizedShopPath("/shop", options);
}

function renderShopPagination(pagination = {}, route = {}, options = {}) {
  const page = Math.max(1, Number(pagination.page || route.page || 1));
  const limit = Math.max(1, Number(pagination.limit || 20));
  const total = Math.max(0, Number(pagination.total || 0));
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1 && page <= 1) return "";

  const pageHref = (targetPage) => {
    const path = shopListingPath(route, options);
    return targetPage > 1 ? `${path}?page=${targetPage}` : path;
  };
  const previousPage = page > pages ? pages : page - 1;
  const previous = page > 1
    ? `<a class="secondary-button" href="${escapeHtml(pageHref(previousPage))}" rel="prev">${escapeHtml(translateString("pagination.previous", "Previous"))}</a>`
    : `<span class="secondary-button disabled" aria-disabled="true">${escapeHtml(translateString("pagination.previous", "Previous"))}</span>`;
  const next = page < pages
    ? `<a class="secondary-button" href="${escapeHtml(pageHref(page + 1))}" rel="next">${escapeHtml(translateString("pagination.next", "Next"))}</a>`
    : `<span class="secondary-button disabled" aria-disabled="true">${escapeHtml(translateString("pagination.next", "Next"))}</span>`;

  return `
    <nav class="shop-pagination" aria-label="${escapeHtml(translateString("pagination.label", "Product pages"))}">
      ${previous}
      <span>${escapeHtml(translateString("pagination.page", "Page"))} ${escapeHtml(page)} ${escapeHtml(translateString("pagination.of", "of"))} ${escapeHtml(pages)}</span>
      ${next}
    </nav>
  `;
}

function renderShopCatalogHero(settings, route = {}, catalogHeroMedia = null) {
  const hero = settings.catalogHero;
  const isMainListing = !route.category && !route.attributeName && Number(route.page || 1) === 1;
  const src = safeMediaSrc(hero.mediaUrl);
  if (!hero.enabled || !isMainListing || !src) return "";

  const media = hero.mediaType === "VIDEO"
    ? renderVideoElement({
        title: settings.catalogTitle,
        url: src,
        posterUrl: hero.posterUrl
      }, {
        ratio: "16 / 9",
        preload: "metadata",
        loop: hero.loop,
        playback: hero.playback
      }, "shop-catalog-hero-media")
    : renderImageTag({
        ...(isRecord(catalogHeroMedia) ? catalogHeroMedia : {}),
        url: src,
        alt: hero.altText || settings.catalogTitle
      }, hero.altText || settings.catalogTitle, "shop-hero", "shop-catalog-hero-media");

  return `
    <section class="shop-catalog-hero"${hero.mediaType === "VIDEO" ? " data-video-frame" : ""}>
      ${media}
      <span class="shop-catalog-hero-overlay" aria-hidden="true"></span>
      <div class="shop-catalog-hero-copy">
        <p class="section-label">${escapeHtml(translateString("shop.catalog", "Catalog"))}</p>
        <h1>${escapeHtml(settings.catalogTitle)}</h1>
        ${settings.catalogDescription ? `<p>${escapeHtml(settings.catalogDescription)}</p>` : ""}
        ${hero.ctaLabel && hero.ctaUrl ? `<a class="action-link" href="${escapeHtml(safePublicHref(hero.ctaUrl))}">${escapeHtml(hero.ctaLabel)}</a>` : ""}
      </div>
    </section>
  `;
}

export function renderShopListingContent(
  { products = [], categories = [], attributes = [], route = {}, pagination = {} },
  options = {}
) {
  const settings = normalizeShopSettings(options.shopSettings);
  const title = route.category
    ? categories.find((category) => category.slug === route.category)?.name || translateString("shop.category", "Category")
    : route.attributeValue
      ? `${route.attributeName}: ${route.attributeValue}`.replaceAll("-", " ")
      : settings.catalogTitle;
  const categoriesHtml = settings.showCategories
    ? renderShopCategoryLinks(categories, route.category || "", options)
    : "";
  const attributesHtml = settings.showAttributes
    ? renderShopAttributeLinks(attributes, route, options)
    : "";
  const hero = renderShopCatalogHero(settings, route, options.catalogHeroMedia);

  return `
    <section class="shop-public-page shop-layout-${escapeHtml(settings.catalogLayout)} shop-card-${escapeHtml(settings.cardStyle)}" data-commerce-root>
      ${hero}
      <header class="shop-public-header${hero ? " shop-public-header-compact" : ""}">
        ${hero
          ? `<div><p class="section-label">${escapeHtml(translateString("shop.allProducts", "All products"))}</p></div>`
          : `<div>
              <p class="section-label">${escapeHtml(translateString("shop.catalog", "Catalog"))}</p>
              <h1>${escapeHtml(title)}</h1>
              ${settings.catalogDescription ? `<p>${escapeHtml(settings.catalogDescription)}</p>` : ""}
            </div>`}
        <div class="shop-public-actions">
          <a class="secondary-button" href="${escapeHtml(localizedShopPath("/account/orders", options))}">Your orders</a>
          <button type="button" class="secondary-button commerce-cart-trigger" data-commerce-cart-toggle>
            ${escapeHtml(translateString("shop.cart", "Cart"))} <span data-commerce-cart-count>0</span>
          </button>
        </div>
      </header>
      ${categoriesHtml || attributesHtml ? `<aside class="shop-public-filters">${categoriesHtml}${attributesHtml}</aside>` : ""}
      <div class="shop-product-grid">
        ${products.length
          ? products.map((product) => renderShopProductCard(product, options)).join("")
          : `<div class="fallback-content">${escapeHtml(translateString("shop.empty", "No products match this filter yet."))}</div>`}
      </div>
      ${renderShopPagination(pagination, route, options)}
    </section>
  `;
}

export function renderBuyerAccountContent(options = {}) {
  return `
    <section class="buyer-account" data-commerce-account-root>
      <header class="buyer-account-header">
        <div>
          <p class="section-label">Your account</p>
          <h1>Your orders</h1>
          <p>Follow delivery progress, review previous purchases, or contact the shop about an order.</p>
        </div>
        <a class="secondary-button" href="${escapeHtml(localizedShopPath("/shop", options))}">Continue shopping</a>
      </header>
      <div class="buyer-account-layout">
        <section class="buyer-order-history" aria-labelledby="buyer-order-history-title">
          <div class="buyer-account-section-heading">
            <div><p class="section-label">Order history</p><h2 id="buyer-order-history-title">Purchases on this device</h2></div>
            <div class="buyer-account-actions">
              <button type="button" class="secondary-button" data-buyer-refresh>Refresh</button>
              <button type="button" class="secondary-button danger" data-buyer-forget>Forget this device</button>
            </div>
          </div>
          <div class="buyer-order-list" data-buyer-orders aria-live="polite">
            <p class="commerce-loading">Loading your orders...</p>
          </div>
        </section>
        <aside class="buyer-order-claim">
          <p class="section-label">Another device?</p>
          <h2>Add an order</h2>
          <p>Use the order number and private lookup token from your receipt email.</p>
          <form data-buyer-claim-form>
            <label><span>Order number</span><input name="orderNumber" autocomplete="off" required maxlength="80" /></label>
            <label><span>Private lookup token</span><input name="lookupToken" type="password" autocomplete="one-time-code" required minlength="40" maxlength="100" /></label>
            <p class="commerce-message" data-commerce-message aria-live="polite"></p>
            <button type="submit">Add order</button>
          </form>
          <p class="buyer-account-privacy">Orders are added only after the private credential is verified. An email address alone cannot open order history.</p>
        </aside>
      </div>
    </section>
  `;
}

export function renderProductDetailContent(product, options = {}) {
  const images = Array.isArray(product.images) ? product.images : [];
  const image = shopPrimaryImage(product);
  const imageHtml = renderShopProductImage(image, product.name, true);
  const attributes = shopProductAttributes(product);
  const settings = normalizeShopSettings(options.shopSettings);
  const variants = activeShopVariants(product);
  const purchaseMode = shopPurchaseMode(product);
  const availableStock = variants.length
    ? variants.reduce((total, variant) => total + Math.max(0, Number(variant.availableStock ?? variant.stockQuantity) || 0), 0)
    : Math.max(0, Number(product.availableStock ?? product.stockQuantity) || 0);
  const variantOptions = variants.map((variant) => {
    const price = variant.priceCents ?? product.priceCents;
    const variantAvailableStock = Math.max(0, Number(variant.availableStock ?? variant.stockQuantity) || 0);
    const label = `${variant.name} · ${formatMoney(price, product.currency || "EUR")}${variantAvailableStock > 0 ? "" : ` · ${translateString("shop.soldOut", "Sold out")}`}`;
    return `<option value="${escapeHtml(variant.id)}" data-price-cents="${escapeHtml(price)}" data-stock="${escapeHtml(variantAvailableStock)}" ${variantAvailableStock > 0 ? "" : "disabled"}>${escapeHtml(label)}</option>`;
  }).join("");

  return `
    <article class="shop-product-detail shop-detail-layout-${escapeHtml(settings.detailLayout)} shop-detail-style-${escapeHtml(settings.detailStyle)}" data-commerce-root>
      <div class="shop-detail-navigation">
        <a class="secondary-button" href="${escapeHtml(localizedShopPath("/shop", options))}">${escapeHtml(translateString("shop.backToShop", "Back to shop"))}</a>
        <div class="shop-public-actions">
          <a class="secondary-button" href="${escapeHtml(localizedShopPath("/account/orders", options))}">Your orders</a>
          <button type="button" class="secondary-button commerce-cart-trigger" data-commerce-cart-toggle>${escapeHtml(translateString("shop.cart", "Cart"))} <span data-commerce-cart-count>0</span></button>
        </div>
      </div>
      <section class="shop-product-detail-hero">
        <div class="shop-product-gallery">
          ${imageHtml || `<div class="shop-product-image-placeholder large">${escapeHtml(translateString("shop.noImage", "No image"))}</div>`}
          ${images.length > 1 ? `<div class="shop-product-gallery-rail">${images.slice(1).map((item) => renderShopProductImage(item, product.name)).join("")}</div>` : ""}
        </div>
        <div>
          <p class="section-label">${escapeHtml(product.category?.name || translateString("shop.product", "Product"))}</p>
          <h1>${escapeHtml(product.name)}</h1>
          <p>${escapeHtml(product.description || "")}</p>
          <strong data-commerce-product-price>${escapeHtml(purchaseMode === "quote" ? translateString("shop.tailoredPricing", "Tailored pricing") : formatMoney(product.priceCents, product.currency || "EUR"))}</strong>
          ${settings.showSku && product.sku ? `<span class="shop-product-detail-sku">${escapeHtml(product.sku)}</span>` : ""}
          ${settings.showStock && purchaseMode === "buy" ? `<span>${escapeHtml(availableStock)} ${escapeHtml(translateString("shop.inStock", "in stock"))}</span>` : ""}
          <form class="shop-product-purchase" data-commerce-product-form data-product-id="${escapeHtml(product.id || "")}" data-product-name="${escapeHtml(product.name)}" data-product-currency="${escapeHtml(product.currency || "EUR")}" data-purchase-mode="${escapeHtml(purchaseMode)}">
            ${variants.length ? `<label><span>${escapeHtml(translateString("shop.variant", "Option"))}</span><select name="variantId" aria-label="${escapeHtml(translateString("shop.variant", "Option"))}" required>${variantOptions}</select></label>` : ""}
            ${purchaseMode === "buy" ? `<label class="shop-quantity-field"><span>${escapeHtml(translateString("shop.quantity", "Quantity"))}</span><input name="quantity" type="number" min="1" max="${escapeHtml(Math.max(1, availableStock))}" value="1" inputmode="numeric" /></label>` : ""}
            <button type="submit" ${purchaseMode === "buy" && availableStock <= 0 ? "disabled" : ""}>${escapeHtml(
              purchaseMode === "quote"
                ? translateString("shop.requestQuote", "Request a quote")
                : availableStock > 0
                  ? translateString("shop.addToCart", "Add to cart")
                  : translateString("shop.soldOut", "Sold out")
            )}</button>
            <p class="commerce-inline-message" data-commerce-inline-message aria-live="polite"></p>
          </form>
        </div>
      </section>
      ${settings.showAttributes ? `<section class="shop-product-specs">
        <h2>${escapeHtml(translateString("shop.productAttributes", "Product attributes"))}</h2>
        ${attributes.length
          ? `<dl>${attributes.map((item) => `<div><dt>${escapeHtml(item.name || "")}</dt><dd>${escapeHtml(item.value || "")}</dd></div>`).join("")}</dl>`
          : `<p class="dashboard-copy">${escapeHtml(translateString("shop.noAttributes", "No attributes have been added yet."))}</p>`}
      </section>` : ""}
    </article>
  `;
}

export function renderPageContent(page, options = {}) {
  const content = `
    ${page.content?.hideTitle === true ? "" : `<h1 class="page-title">${escapeHtml(page.title)}</h1>`}
    ${page.excerpt ? `<p class="page-excerpt">${escapeHtml(page.excerpt)}</p>` : ""}
    ${renderSections(page, options)}
  `;
  if (page.content?.source !== "websiteSpec") return content;

  const theme = isRecord(page.content.style) ? page.content.style.theme : "generated-site";
  return `<div class="website-spec-page" data-design-theme="${escapeHtml(cssToken(theme, "generated-site"))}">${content}</div>`;
}

export function renderFooter(page, canEdit = false, options = {}) {
  const siteTitle = state.config?.siteSettings?.title || state.config?.app?.name || page.title || "Website";
  const fallbackText = `© ${new Date().getFullYear()} ${siteTitle}`;
  const footerText = page.content?.footerText || translateString("footer.copyright", fallbackText);
  const editButton = canEdit ? renderEditorButton("Edit Footer", "data-edit-footer") : "";

  if (page.content?.source === "websiteSpec") {
    const description = state.config?.siteSettings?.description || page.content?.project?.summary || "";
    return `
      <strong>${escapeHtml(siteTitle)}</strong>
      ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      ${options.menu ? `<nav aria-label="Footer navigation">${options.menu}</nav>` : ""}
      ${editButton}
    `;
  }

  return `<span>${escapeHtml(footerText)}</span>${editButton}`;
}

export function renderComponentPalette() {
  return `
    <div class="component-palette">
      ${availableComponentTemplates()
        .map(
          (template) => `
            <button type="button" class="component-template" data-add-template="${escapeHtml(template.id)}">
              <strong>${escapeHtml(template.label)}</strong>
              <span>${escapeHtml(template.description)}</span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

export function renderPage(page) {
  const visualEditorActive = Boolean(state.visualEditorActive && state.user && hasPermission("update", "cms"));
  const canEditCms = visualEditorActive && moduleEnabled("cms");
  const canEditProducts = visualEditorActive && moduleEnabled("products") && hasPermission("update", "products");
  const currentLibrary = elements.page?.querySelector?.(".visual-library-menu");
  const historyKey = `${page.locale || currentLocale()}:${page.slug || ""}`;

  if (currentLibrary && state.visualEditorHistoryKey === historyKey) {
    state.visualEditorLibraryOpen = currentLibrary.open;
  }

  if (state.visualEditorHistoryKey !== historyKey) {
    state.visualEditorHistoryKey = historyKey;
    state.visualEditorUndoStack = [];
    state.visualEditorRedoStack = [];
    state.visualEditorSelection = null;
    state.visualEditorEditingBlockKey = "";
    state.visualEditorLibraryOpen = false;
  }
  if (!visualEditorActive) state.visualEditorLibraryOpen = false;

  applyDesignSystem(state.config?.siteSettings?.design);
  applySiteCustomCss();
  applyGeneratedPageContext(page);
  applySeoDocument(createPageSeoDocument(page, runtimeSeoContext({ locale: page.locale || currentLocale() })));
  updatePublicBrand();
  updateHeaderLanguageSwitcher(page);
  elements.page.innerHTML = `
    ${canEditCms || canEditProducts ? renderVisualEditorToolbar(page) : ""}
    ${state.user && moduleEnabled("cms") && hasPermission("update", "cms") && !visualEditorActive ? '<button type="button" class="visual-editor-entry" data-enter-visual-editor><span aria-hidden="true">&#9998;</span> Edit page</button>' : ""}
    ${renderPageContent(page, {
      canEdit: canEditCms,
      commerceEnabled: moduleEnabled("products"),
      locale: page.locale || currentLocale(),
      shopSettings: state.config?.shopSettings
    })}
  `;
  elements.page.removeAttribute("data-server-rendered");
  enhanceStructuredTabs(elements.page);
  elements.footer.innerHTML = renderFooter(page, canEditCms);

  document.body.classList.remove("auth-enabled", "dashboard-enabled");
  document.body.classList.toggle("editor-enabled", visualEditorActive);
  document.body.dataset.visualDevice = visualEditorActive ? state.visualEditorDevice : "desktop";
  setStatus(visualEditorActive ? `Editing ${page.title}` : "");
  applyGeneratedPageMotion(page.content?.source === "websiteSpec" && !visualEditorActive);
}

export function renderPostContent(post) {
  return `
    <article class="public-post">
      <p class="section-label">${escapeHtml(post.publishedAt ? formatPostDate(post.publishedAt) : post.status || "Post")}</p>
      <h1 class="page-title">${escapeHtml(post.title)}</h1>
      ${post.excerpt ? `<p class="page-excerpt">${escapeHtml(post.excerpt)}</p>` : ""}
      <div class="public-post-body">${renderRichText(post.content?.body || "")}</div>
    </article>
  `;
}

export function renderPost(post) {
  applyDesignSystem(state.config?.siteSettings?.design);
  applySiteCustomCss();
  applyGeneratedPageContext({});
  applySeoDocument(createPostSeoDocument(post, runtimeSeoContext({ locale: post.locale || currentLocale() })));
  updatePublicBrand();
  elements.page.innerHTML = renderPostContent(post);
  elements.page.removeAttribute("data-server-rendered");
  elements.footer.innerHTML = renderFooter({ title: post.title }, false);

  document.body.classList.remove("auth-enabled", "dashboard-enabled");
  document.body.classList.remove("editor-enabled");
  applyGeneratedPageMotion(false);
  setStatus(state.user ? `${post.status} post preview as ${state.user.email}` : "");
}

function formatPostDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return "Post";
  }
}
