import {
  availableComponentTemplates,
  defaultPage,
  elements,
  escapeHtml,
  moduleEnabled,
  normalizePageLayout,
  setStatus,
  state,
  translateString
} from "./core.js";
import { currentLocale, pageHref } from "./routes.js";
import { renderFormMessage } from "./ui.js";
import { galleryItems, gallerySettings, isGalleryValue, sliderSettings, sliderSlides } from "./slider-config.js";
import {
  advancedClassList,
  advancedIdAttribute,
  advancedStyleAttribute,
  animationCssVariables,
  sanitizeInlineCss,
  sanitizeStylesheet
} from "./custom-css.js";

export { defaultPage };

function applySiteCustomCss() {
  if (!document.head || !document.createElement) return;

  const css = sanitizeStylesheet(state.config?.siteSettings?.customCss || "");
  let element = document.querySelector("[data-site-custom-css]");
  if (!css) {
    element?.remove?.();
    return;
  }

  if (!element) {
    element = document.createElement("style");
    element.setAttribute("data-site-custom-css", "");
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

function absolutePublicUrl(path) {
  const base = state.config?.app?.publicUrl || window.location.origin || "http://localhost";

  return new URL(path, base).toString();
}

function setManagedLink(rel, attributes = {}) {
  if (!document.head || !document.createElement) return;

  const link = document.createElement("link");
  link.setAttribute("rel", rel);
  link.setAttribute("data-codey-seo-link", "");
  for (const [key, value] of Object.entries(attributes)) {
    if (value) link.setAttribute(key, value);
  }
  document.head.append(link);
}

function updatePageSeoLinks(page) {
  if (!document.head) return;

  document.querySelectorAll?.("[data-codey-seo-link]")?.forEach((element) => element.remove?.());
  const pageLocale = page.locale || currentLocale();
  const canonicalPath = localizedPublicPath(page.slug, pageLocale);
  setManagedLink("canonical", { href: absolutePublicUrl(canonicalPath) });

  const translations = Array.isArray(page.translations) ? page.translations : [];
  const translationByLocale = new Map(translations.map((translation) => [translation.locale, translation]));
  if (!translationByLocale.has(pageLocale)) {
    translationByLocale.set(pageLocale, {
      slug: page.slug,
      locale: pageLocale,
      title: page.title
    });
  }

  for (const translation of translationByLocale.values()) {
    setManagedLink("alternate", {
      hreflang: translation.locale,
      href: absolutePublicUrl(localizedPublicPath(translation.slug, translation.locale))
    });
  }

  const defaultLocale = state.config?.localization?.defaultLocale || "en";
  const defaultTranslation = translationByLocale.get(defaultLocale);
  if (defaultTranslation) {
    setManagedLink("alternate", {
      hreflang: "x-default",
      href: absolutePublicUrl(localizedPublicPath(defaultTranslation.slug, defaultTranslation.locale))
    });
  }
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

export function renderMenuItems(items, canEdit = false) {
  return items
    .map((item) => {
      const url = item.url?.startsWith("/") ? pageHref(item.url.slice(1)) : safePublicHref(item.url);
      const link = `<a href="${escapeHtml(url || "#")}"${item.openInNewTab ? ' target="_blank" rel="noreferrer"' : ""}>${escapeHtml(item.label)}</a>`;
      const editButton = canEdit ? renderEditorButton("Edit", "data-edit-menu-item", item.id) : "";

      return `<span class="menu-item">${link}${editButton}</span>`;
    })
    .join("");
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
  if (/^(https?:\/\/|mailto:|tel:|#|\/)/i.test(href)) return href;

  return "#";
}

function safePublicHref(value = "") {
  return safeRichHref(value);
}

function safeMediaSrc(value = "") {
  const src = String(value || "").trim();
  if (/^(https?:\/\/|\/|\.\/)/i.test(src)) return src;
  if (/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(src)) return src;

  return "";
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

function renderStructuredImage(image, fallbackAlt = "") {
  if (!image) return "";

  const imageData = typeof image === "string" ? { url: image } : image;
  if (!isRecord(imageData)) return "";

  const src = safeMediaSrc(imageData.url || imageData.src);
  if (!src) return "";

  const alt = firstText(imageData, ["alt", "title", "caption"]) || fallbackAlt;
  const caption = firstText(imageData, ["caption", "credit"]);

  return `
    <figure class="structured-media">
      <img class="block-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />
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

function renderStructuredItems(items, variant = "cards") {
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
      const imageHtml = renderStructuredImage(item.image || item.media, title || label || `Item ${index + 1}`);
      const featured = item.featured === true || item.highlighted === true;
      const indexLabel = String(index + 1).padStart(2, "0");

      if (!title && !body && !label && !value && !imageHtml) return "";

      const cardClass = `structured-card structured-card-${escapeHtml(token)}${featured ? " structured-card-featured" : ""}${imageHtml ? " structured-card-has-media" : ""}`;
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
      `;

      return wrapCardWithLink
        ? `<a class="${cardClass}" href="${escapeHtml(url)}">${content}</a>`
        : `<article class="${cardClass}">${content}</article>`;
    })
    .join("");

  return html ? `<div class="structured-items structured-items-${escapeHtml(token)}">${html}</div>` : "";
}

function normalizePanelItems(items) {
  if (!Array.isArray(items)) return [];

  return items.flatMap((item, index) => {
    if (!isRecord(item)) return [];

    const title = firstText(item, ["title", "name", "label"]) || `Item ${index + 1}`;
    const body = firstText(item, ["body", "text", "copy", "description", "content"]);
    const note = firstText(item, ["note", "kicker", "eyebrow", "meta"]);
    const imageHtml = renderStructuredImage(item.image || item.media, title);
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

function renderStructuredTabs(items, variant, blockKey = "tabs") {
  const panels = normalizePanelItems(items);
  if (!panels.length) return "";

  const group = cssToken(`${blockKey}-${variant}`, "tabs");

  return `
    <div class="structured-tabs structured-tabs-${escapeHtml(cssToken(variant, "tabs"))}">
      ${panels
        .map((_, index) => `
          <input
            class="structured-tab-input"
            type="radio"
            id="${escapeHtml(`${group}-${index + 1}`)}"
            name="${escapeHtml(group)}"
            ${index === 0 ? "checked" : ""}
          />
        `)
        .join("")}
      <div class="structured-tab-list" role="tablist">
        ${panels
          .map((panel, index) => `
            <label
              class="structured-tab-label"
              role="tab"
              id="${escapeHtml(`${group}-${index + 1}-label`)}"
              for="${escapeHtml(`${group}-${index + 1}`)}"
            >
              <span class="structured-tab-count">${escapeHtml(String(index + 1).padStart(2, "0"))}</span>
              <span>${escapeHtml(panel.title)}</span>
            </label>
          `)
          .join("")}
      </div>
      <div class="structured-tab-panels">
        ${panels
          .map((panel, index) => `
            <article class="structured-tab-panel" role="tabpanel" aria-labelledby="${escapeHtml(`${group}-${index + 1}-label`)}">
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

function renderStructuredAccordion(items, variant) {
  const panels = normalizePanelItems(items);
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

function renderStructuredCollection(items, variant, blockKey) {
  const token = cssToken(variant, "cards");

  if (token === "tabs") return renderStructuredTabs(items, token, blockKey);
  if (token === "accordion" || token === "faq-accordion") return renderStructuredAccordion(items, token);

  return renderStructuredItems(items, token);
}

function renderStructuredBlock(block) {
  const value = block.value;
  if (!isRecord(value)) return "";

  const title = firstText(value, ["title", "heading", "headline", "name"]);
  const body = firstText(value, ["body", "text", "copy", "description", "content"]);
  const note = firstText(value, ["note", "kicker", "eyebrow", "summary"]);
  const variant = firstText(value, ["variant", "type"]) || block.settings?.elementId || block.label || "content";
  const imageHtml = renderStructuredImage(value.image || value.media, title || block.label || "");
  const statsHtml = renderStructuredStats(value.stats || value.metrics);
  const itemsHtml = renderStructuredCollection(value.items || value.cards || value.people || value.logos || value.questions, variant, block.key);
  const cta = isRecord(value.cta) ? value.cta : null;
  const ctaHtml = cta?.label && cta?.url
    ? `<a class="action-link" href="${escapeHtml(safePublicHref(cta.url))}">${escapeHtml(cta.label)}</a>`
    : "";

  if (!title && !body && !note && !imageHtml && !statsHtml && !itemsHtml && !ctaHtml) return "";

  return `
    <article class="structured-block structured-block-${escapeHtml(cssToken(variant))}">
      <div class="structured-block-copy">
        ${note ? `<p class="structured-note">${escapeHtml(note)}</p>` : ""}
        ${title ? `<h3>${escapeHtml(title)}</h3>` : ""}
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

function safeNumber(value, min, max) {
  if (value === "" || value === null || value === undefined) return "";

  const number = Number(value);
  if (!Number.isFinite(number)) return "";

  return String(Math.min(max, Math.max(min, Math.round(number))));
}

function sectionClassName(section) {
  const settings = section.settings || {};
  const style = settings.style || {};
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
  const preset = oneOf(style.preset, ["default", "quiet", "carded", "contrast", "premium-dark", "editorial-light", "industrial-grid", "framed-card"], "default");
  const shadow = oneOf(style.shadow, ["none", "soft", "strong", "glow"], "none");
  const decorationType = oneOf(decoration.type, ["none", "glow", "orb", "pattern", "spotlight", "grid", "frame", "texture", "split"], "none");
  const decorationPosition = oneOf(decoration.position, ["top-left", "top-right", "center-left", "center-right", "bottom-left", "bottom-right"], "bottom-right");
  const tabletLayout = oneOf(tablet.layout, ["inherit", "one-column", "two-column", "three-column"], "inherit");
  const tabletSpacing = oneOf(tablet.spacing, ["inherit", "none", "sm", "md", "lg", "xl"], "inherit");
  const mobileLayout = oneOf(mobile.layout, ["inherit", "one-column", "two-column"], "one-column");
  const mobileSpacing = oneOf(mobile.spacing, ["inherit", "none", "sm", "md", "lg", "xl"], "sm");

  return [
    "page-section",
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
    `section-mobile-spacing-${mobileSpacing}`,
    advancedClassList(settings)
  ].join(" ");
}

function sectionStyleAttribute(section) {
  const settings = section.settings || {};
  const style = settings.style || {};
  const decoration = settings.decoration || {};
  const declarations = [
    safeHex(style.backgroundColor) ? `--section-bg:${safeHex(style.backgroundColor)}` : "",
    safeHex(style.textColor) ? `--section-text:${safeHex(style.textColor)}` : "",
    safeHex(style.accentColor) ? `--section-accent:${safeHex(style.accentColor)}` : "",
    safeNumber(style.radius, 0, 48) ? `--section-radius:${safeNumber(style.radius, 0, 48)}px` : "",
    safeNumber(settings.minHeight, 0, 1200) ? `--section-min-height:${safeNumber(settings.minHeight, 0, 1200)}px` : "",
    safeHex(decoration.color) ? `--section-decoration-color:${safeHex(decoration.color)}` : "",
    Number.isFinite(Number(decoration.opacity)) ? `--section-decoration-opacity:${Math.min(0.9, Math.max(0, Number(decoration.opacity)))}` : "",
    animationCssVariables(settings),
    sanitizeInlineCss(settings.customCss || "")
  ].filter(Boolean).join("; ");

  return declarations ? ` style="${escapeHtml(declarations)}"` : "";
}

function blockClassName(block) {
  return ["content-block", advancedClassList(block.settings || {})].filter(Boolean).join(" ");
}

function renderSectionDecoration(section) {
  const decoration = section.settings?.decoration || {};
  const type = oneOf(decoration.type, ["none", "glow", "orb", "pattern", "spotlight", "grid", "frame", "texture", "split"], "none");
  if (type === "none") return "";

  return `<span class="section-decoration-layer" aria-hidden="true"></span>`;
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

export function renderBlock(block) {
  const value = block.value;
  const knownObjectTypes = new Set(["IMAGE", "GALLERY", "BUTTON", "CTA", "CONTACT_FORM", "PRODUCT_LIST"]);

  if (isRecord(value) && !knownObjectTypes.has(block.type)) {
    const structuredHtml = renderStructuredBlock(block);
    if (structuredHtml) return structuredHtml;
  }

  if (block.type === "TEXT") {
    return `<p>${escapeHtml(value)}</p>`;
  }

  if (block.type === "RICH_TEXT") {
    return `<div class="block-rich">${renderRichText(value)}</div>`;
  }

  if (block.type === "IMAGE") {
    const image = isRecord(value) ? value : { url: value };
    const src = safeMediaSrc(image.url || image.src);
    if (!src) return '<div class="fallback-content">Image source is not available.</div>';

    return `<img class="block-image" src="${escapeHtml(src)}" alt="${escapeHtml(image.alt || block.label || "")}" />`;
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
          class="gallery-block gallery-layout-${escapeHtml(settings.layoutMode)}${settings.showCaptions ? " gallery-show-captions" : ""}"
          style="${escapeHtml(style)}"
        >
          ${items
            .map((item, index) => {
              const src = safeMediaSrc(item.url);
              if (!src) return "";
              const image = `<img class="block-image" src="${escapeHtml(src)}" alt="${escapeHtml(item.alt || `Gallery image ${index + 1}`)}" />`;
              const href = item.link ? safePublicHref(item.link) : settings.lightbox ? src : "";

              return `
                <figure class="gallery-item">
                  ${href ? `<a href="${escapeHtml(href)}"${href === src ? ' target="_blank" rel="noreferrer"' : ""}>${image}</a>` : image}
                  ${settings.showCaptions && item.caption ? `<figcaption>${renderRichText(item.caption)}</figcaption>` : ""}
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
                      <img class="block-image" src="${escapeHtml(src)}" alt="${escapeHtml(item.alt || `Slide ${index + 1}`)}" />
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
    const slugs = Array.isArray(value?.productSlugs) ? value.productSlugs : [];
    return `
      <div class="product-list-slot">
        ${slugs
          .map(
            (slug) => `
              <div class="product-list-item">
                <a href="${pageHref(`product/${slug}`)}">${escapeHtml(slug)}</a>
                ${state.user && moduleEnabled("products") ? renderEditorButton("Edit Product", "data-edit-product", slug) : ""}
              </div>
            `
          )
          .join("")}
        ${state.user && moduleEnabled("products") ? renderEditorButton("+ Product", "data-add-product-inline") : ""}
      </div>
    `;
  }

  return '<div class="fallback-content">This content block is not available in the public renderer.</div>';
}

export function renderSections(page) {
  const layout = normalizePageLayout(page.content?.layout);

  if (!page.sections?.length) {
    return '<div class="fallback-content">This page does not have visible sections yet.</div>';
  }

  return `
    <div class="page-sections page-layout-${escapeHtml(layout)}">
      ${page.sections
        .map(
          (section) => `
            <section class="${escapeHtml(sectionClassName(section))}" data-section-id="${escapeHtml(section.id)}"${advancedIdAttribute(section.settings || {})}${sectionStyleAttribute(section)}>
              ${renderSectionDecoration(section)}
              ${section.label ? `<h2 class="section-label">${escapeHtml(section.label)}</h2>` : ""}
              ${section.blocks
                .map(
                  (block) => `
                    <div class="${escapeHtml(blockClassName(block))}" data-block-key="${escapeHtml(block.key)}" data-editable="${block.editable}"${advancedIdAttribute(block.settings || {})}${advancedStyleAttribute(block.settings || {})}>
                      ${block.editable ? '<button type="button" class="block-edit" data-edit-block>Edit</button>' : ""}
                      ${renderBlock(block)}
                    </div>
                  `
                )
                .join("")}
            </section>
          `
        )
        .join("")}
    </div>
  `;
}

export function renderFooter(page, canEdit = false) {
  const fallbackText = `© ${new Date().getFullYear()} ${page.title || "Website"}`;
  const footerText = page.content?.footerText || translateString("footer.copyright", fallbackText);
  const editButton = canEdit ? renderEditorButton("Edit Footer", "data-edit-footer") : "";

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
  const canEditCms = Boolean(state.user) && moduleEnabled("cms");
  const canEditProducts = Boolean(state.user) && moduleEnabled("products");

  applySiteCustomCss();
  updatePageSeoLinks(page);
  document.title = page.metaTitle || page.title;
  if (document.documentElement) document.documentElement.lang = page.locale || currentLocale();
  elements.brand.textContent = page.title || "CMS Site";
  elements.brand.href = "/";
  updateHeaderLanguageSwitcher(page);
  elements.page.innerHTML = `
    ${canEditCms || canEditProducts
      ? `<div class="front-editor-panel">
          ${canEditCms ? renderEditorButton("Edit Page", "data-edit-page-inline") : ""}
          ${canEditCms ? renderEditorButton("+ Text Section", "data-add-section-inline") : ""}
          ${canEditCms ? renderEditorButton("+ Element", "data-add-element-inline") : ""}
          ${canEditCms ? renderEditorButton("+ Article", "data-add-article-inline") : ""}
          ${canEditProducts ? renderEditorButton("+ Product", "data-add-product-inline") : ""}
          ${canEditCms ? renderEditorButton("Publish", "data-publish-inline") : ""}
        </div>`
      : ""}
    <h1 class="page-title">${escapeHtml(page.title)}</h1>
    ${page.excerpt ? `<p class="page-excerpt">${escapeHtml(page.excerpt)}</p>` : ""}
    ${renderSections(page)}
  `;
  elements.footer.innerHTML = renderFooter(page, Boolean(state.user));

  document.body.classList.remove("auth-enabled", "dashboard-enabled");
  document.body.classList.toggle("editor-enabled", Boolean(state.user));
  setStatus(state.user ? `${page.status} preview as ${state.user.email}` : "");
}

export function renderPost(post) {
  applySiteCustomCss();
  document.title = post.metaTitle || post.title;
  if (document.documentElement) document.documentElement.lang = post.locale || currentLocale();
  elements.brand.textContent = state.config?.siteSettings?.title || "CMS Site";
  elements.brand.href = "/";
  elements.page.innerHTML = `
    <article class="public-post">
      <p class="section-label">${escapeHtml(post.publishedAt ? formatPostDate(post.publishedAt) : post.status || "Post")}</p>
      <h1 class="page-title">${escapeHtml(post.title)}</h1>
      ${post.excerpt ? `<p class="page-excerpt">${escapeHtml(post.excerpt)}</p>` : ""}
      <div class="public-post-body">${renderRichText(post.content?.body || "")}</div>
    </article>
  `;
  elements.footer.innerHTML = renderFooter({ title: post.title }, Boolean(state.user));

  document.body.classList.remove("auth-enabled", "dashboard-enabled");
  document.body.classList.toggle("editor-enabled", Boolean(state.user));
  setStatus(state.user ? `${post.status} post preview as ${state.user.email}` : "");
}

function formatPostDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return "Post";
  }
}
