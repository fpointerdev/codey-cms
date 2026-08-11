import {
  api,
  availableComponentTemplates,
  buildSectionPattern,
  normalizePageLayout,
  setStatus,
  slugFromTitle,
  state
} from "./core.js";
import { adminHref, currentLocale } from "./routes.js";
import { renderCreatePagePage, renderPageBuilderPage, renderPostEditorPage, richTextSnippetForTemplate } from "./builder-views.js";
import { getModalFormHandler } from "./modal.js";
import { setFormDisabled, setFormMessage } from "./ui.js";
import { syncRichEditors } from "./rich-editor.js";
import {
  editContentBlock,
  loadMediaImageAssets,
  optionalFormValue,
  productListModalFields,
  productListValueFromValues,
  uploadedGalleryItemFiles,
  uploadedGalleryItems
} from "./content-actions.js";
import {
  galleryItems,
  galleryModalFields,
  galleryValueFromModal,
  isGalleryValue,
  sliderModalFields,
  sliderSlides,
  sliderValueFromModal
} from "./slider-config.js";
import {
  advancedSettingsFromValues,
  animationEffectOptions,
  sanitizeAnimationSettings
} from "./custom-css.js";
import {
  copyBuilderSections,
  duplicateBuilderBlockInSections,
  duplicateBuilderSectionInSections,
  instantiateBuilderSectionTemplate,
  moveBuilderBlockInSections,
  moveBuilderSectionInSections,
  normalizeBuilderSectionsForSave,
  sectionToBuilderInput
} from "./builder-operations.js";

const builderHistoryLimit = 30;

const containerLayoutOptions = [
  { value: "one-column", label: "1 column", description: "Stacked content and long-form sections." },
  { value: "two-column", label: "2 columns", description: "Image/text, forms, FAQs, and balanced content." },
  { value: "three-column", label: "3 columns", description: "Service cards, proof points, and compact grids." },
  { value: "four-column", label: "4 columns", description: "Dense cards, stats, logos, and team sections." },
  { value: "asymmetric", label: "Asymmetric", description: "Editorial split with one dominant side." },
  { value: "full-bleed", label: "Full width", description: "Wide media, hero, or immersive sections." }
];

const sectionContainerOptions = [
  { value: "default", label: "Default" },
  { value: "narrow", label: "Narrow" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Edge to edge" }
];

const sectionSpacingOptions = [
  { value: "none", label: "None" },
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "Extra large" }
];

const sectionGapOptions = [
  { value: "sm", label: "Tight", description: "Compact editorial rhythm." },
  { value: "md", label: "Standard", description: "Balanced default spacing." },
  { value: "lg", label: "Wide", description: "Premium section breathing room." },
  { value: "xl", label: "Extra wide", description: "Hero and gallery scale." }
];

const inheritedSectionSpacingOptions = [
  { value: "inherit", label: "Inherit desktop spacing" },
  ...sectionSpacingOptions
];

const tabletLayoutOptions = [
  { value: "inherit", label: "Inherit", description: "Use the desktop grid." },
  { value: "one-column", label: "1 column", description: "Stack for readability." },
  { value: "two-column", label: "2 columns", description: "Keep paired content together." },
  { value: "three-column", label: "3 columns", description: "Useful for card grids." }
];

const mobileLayoutOptions = [
  { value: "inherit", label: "Inherit", description: "Use tablet/default behavior." },
  { value: "one-column", label: "1 column", description: "Best for content and forms." },
  { value: "two-column", label: "2 columns", description: "Use only for short cards." }
];

const sectionAlignOptions = [
  { value: "start", label: "Left" },
  { value: "center", label: "Center" },
  { value: "end", label: "Right" }
];

const sectionVerticalAlignOptions = [
  { value: "start", label: "Top" },
  { value: "center", label: "Center" },
  { value: "end", label: "Bottom" }
];

const sectionStylePresetOptions = [
  { value: "default", label: "Default" },
  { value: "editorial-light", label: "Editorial light" },
  { value: "quiet", label: "Quiet" },
  { value: "carded", label: "Carded" },
  { value: "framed-card", label: "Framed card" },
  { value: "contrast", label: "Contrast" },
  { value: "industrial-grid", label: "Industrial grid" },
  { value: "premium-dark", label: "Premium dark" }
];

const sectionDecorationOptions = [
  { value: "none", label: "None" },
  { value: "spotlight", label: "Soft spotlight" },
  { value: "grid", label: "Grid layer" },
  { value: "frame", label: "Frame" },
  { value: "texture", label: "Texture" },
  { value: "split", label: "Split background" },
  { value: "glow", label: "Glow" },
  { value: "pattern", label: "Pattern" }
];

const sectionDecorationPositionOptions = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "center-left", label: "Center left" },
  { value: "center-right", label: "Center right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" }
];

function activeRouteLocale() {
  const activeQueryLocale = new URLSearchParams(window.location.search || "").get("locale");
  if (activeQueryLocale) return currentLocale();

  return state.config?.localization?.defaultLocale || currentLocale();
}

function activePageLocale() {
  return state.builderPage?.locale || activeRouteLocale();
}

function activePostLocale() {
  return state.builderPost?.locale || activeRouteLocale();
}

function shouldIncludeLocale(locale) {
  const localeCode = String(locale || "").trim().toLowerCase();
  if (!localeCode) return false;

  const activeQueryLocale = new URLSearchParams(window.location.search || "").get("locale");
  const defaultLocale = String(state.config?.localization?.defaultLocale || "en").toLowerCase();

  return Boolean(activeQueryLocale) || localeCode !== defaultLocale;
}

function withLocale(path, locale, extra = {}) {
  const params = new URLSearchParams(extra);
  if (shouldIncludeLocale(locale)) params.set("locale", locale);
  const query = params.toString();

  return query ? `${path}?${query}` : path;
}

function adminHrefWithLocale(view, slug, locale) {
  return withLocale(adminHref(view, slug), locale);
}

function configuredLocaleOptions(sourceLocale = "") {
  const source = String(sourceLocale || "").toLowerCase();
  const configured = state.config?.localization?.locales;
  const locales = Array.isArray(configured) ? configured : [];

  return locales
    .filter((locale) => locale?.enabled !== false && locale?.code)
    .map((locale) => ({
      value: String(locale.code).toLowerCase(),
      label: locale.label || String(locale.code).toUpperCase()
    }))
    .filter((locale) => locale.value !== source);
}

async function createContentTranslation(kind, sourceSlug, sourceLocale, sourceTitle, preferredTargetLocale = "") {
  const localeOptions = configuredLocaleOptions(sourceLocale);
  if (!localeOptions.length) {
    setStatus("Enable another language before creating a translation.", true);
    return;
  }
  const selectedLocale = String(preferredTargetLocale || "").toLowerCase();

  const values = await getModalFormHandler()({
    label: "Translation",
    title: `Create ${kind} translation`,
    description: "Copy this content into another language as a draft linked to the same translation group.",
    fields: [
      {
        name: "targetLocale",
        label: "Target language",
        type: "select",
        value: localeOptions.some((locale) => locale.value === selectedLocale) ? selectedLocale : localeOptions[0].value,
        options: localeOptions
      },
      {
        name: "title",
        label: "Translated title",
        value: sourceTitle || "",
        required: false
      },
      {
        name: "slug",
        label: "Translated slug",
        value: sourceSlug || "",
        required: false
      }
    ],
    submitLabel: "Create translation"
  });
  if (!values) return;

  const targetLocale = String(values.targetLocale || "").toLowerCase();
  const title = String(values.title || "").trim();
  const slug = slugFromTitle(String(values.slug || sourceSlug));
  const endpoint = kind === "page" ? "pages" : "posts";
  const responseKey = kind === "page" ? "page" : "post";
  const builderView = kind === "page" ? "page-builder" : "post-builder";

  try {
    setStatus("Creating translation...");
    const response = await api(withLocale(`/cms/${endpoint}/${encodeURIComponent(sourceSlug)}/translations`, sourceLocale), {
      method: "POST",
      body: JSON.stringify({
        targetLocale,
        ...(title ? { title } : {}),
        ...(slug ? { slug } : {})
      })
    });
    const content = response[responseKey];
    window.history.pushState({}, "", adminHrefWithLocale(builderView, content.slug, content.locale || targetLocale));
    setStatus("Translation created as draft.");

    if (kind === "page") {
      renderPageBuilderPage(content, "Translation created. Replace the copied content before publishing.");
    } else {
      renderPostEditorPage(content, "Translation created. Replace the copied content before publishing.");
    }
  } catch (error) {
    setStatus(error.message || "Unable to create translation.", true);
  }
}

export function createPageTranslation(sourceSlug, sourceLocale, sourceTitle, preferredTargetLocale = "") {
  return createContentTranslation("page", sourceSlug, sourceLocale, sourceTitle, preferredTargetLocale);
}

export function createPostTranslation(sourceSlug, sourceLocale, sourceTitle, preferredTargetLocale = "") {
  return createContentTranslation("post", sourceSlug, sourceLocale, sourceTitle, preferredTargetLocale);
}

async function openOrCreateContentTranslation(kind, sourceSlug, sourceLocale, sourceTitle, targetLocale, translationGroupId) {
  const endpoint = kind === "page" ? "pages" : "posts";
  const responseKey = kind === "page" ? "page" : "post";
  const builderView = kind === "page" ? "page-builder" : "post-builder";
  const groupId = translationGroupId || sourceSlug;

  try {
    setStatus("Checking translation...");
    const response = await api(withLocale(`/cms/${endpoint}`, targetLocale));
    const items = Array.isArray(response[endpoint]) ? response[endpoint] : [];
    const existing = items.find((item) => item?.translationGroupId === groupId);

    if (existing?.slug) {
      const detail = await api(withLocale(`/cms/${endpoint}/${encodeURIComponent(existing.slug)}`, targetLocale));
      const content = detail[responseKey];
      window.history.pushState({}, "", adminHrefWithLocale(builderView, content.slug, content.locale || targetLocale));
      setStatus("Translation opened.");

      if (kind === "page") {
        renderPageBuilderPage(content, "Translation opened.");
      } else {
        renderPostEditorPage(content, "Translation opened.");
      }
      return;
    }
  } catch (error) {
    setStatus(error.message || "Unable to check existing translation.", true);
    return;
  }

  return createContentTranslation(kind, sourceSlug, sourceLocale, sourceTitle, targetLocale);
}

export function openOrCreatePageTranslation(sourceSlug, sourceLocale, sourceTitle, targetLocale, translationGroupId) {
  return openOrCreateContentTranslation("page", sourceSlug, sourceLocale, sourceTitle, targetLocale, translationGroupId);
}

export function openOrCreatePostTranslation(sourceSlug, sourceLocale, sourceTitle, targetLocale, translationGroupId) {
  return openOrCreateContentTranslation("post", sourceSlug, sourceLocale, sourceTitle, targetLocale, translationGroupId);
}

async function linkExistingContentTranslation(kind, sourceSlug, sourceLocale, sourceTitle, translationGroupId) {
  const localeOptions = configuredLocaleOptions(sourceLocale);
  if (!localeOptions.length) {
    setStatus("Enable another language before linking a translation.", true);
    return;
  }

  const values = await getModalFormHandler()({
    label: "Translation",
    title: `Link existing ${kind} translation`,
    description: `Connect an existing translated ${kind} to "${sourceTitle || sourceSlug}" so all languages share one translation group.`,
    fields: [
      {
        name: "targetLocale",
        label: "Existing content language",
        type: "select",
        value: localeOptions[0].value,
        options: localeOptions
      },
      {
        name: "slug",
        label: `Existing ${kind} slug`,
        value: "",
        required: true
      }
    ],
    submitLabel: "Link translation"
  });
  if (!values) return;

  const targetLocale = String(values.targetLocale || "").toLowerCase();
  const targetSlug = slugFromTitle(String(values.slug || ""));
  const endpoint = kind === "page" ? "pages" : "posts";
  const responseKey = kind === "page" ? "page" : "post";
  const builderView = kind === "page" ? "page-builder" : "post-builder";
  const groupId = translationGroupId || sourceSlug;

  if (!targetSlug) {
    setStatus("Enter the existing translated slug.", true);
    return;
  }

  try {
    setStatus("Linking translation...");
    if (!translationGroupId || translationGroupId === sourceSlug) {
      await api(withLocale(`/cms/${endpoint}/${encodeURIComponent(sourceSlug)}`, sourceLocale), {
        method: "PATCH",
        body: JSON.stringify({ translationGroupId: groupId })
      });
    }

    const response = await api(withLocale(`/cms/${endpoint}/${encodeURIComponent(targetSlug)}`, targetLocale), {
      method: "PATCH",
      body: JSON.stringify({ translationGroupId: groupId })
    });
    const content = response[responseKey];

    window.history.pushState({}, "", adminHrefWithLocale(builderView, content.slug, content.locale || targetLocale));
    setStatus("Translation linked.");

    if (kind === "page") {
      renderPageBuilderPage(content, "Translation linked.");
    } else {
      renderPostEditorPage(content, "Translation linked.");
    }
  } catch (error) {
    setStatus(error.message || "Unable to link translation.", true);
  }
}

export function linkExistingPageTranslation(sourceSlug, sourceLocale, sourceTitle, translationGroupId) {
  return linkExistingContentTranslation("page", sourceSlug, sourceLocale, sourceTitle, translationGroupId);
}

export function linkExistingPostTranslation(sourceSlug, sourceLocale, sourceTitle, translationGroupId) {
  return linkExistingContentTranslation("post", sourceSlug, sourceLocale, sourceTitle, translationGroupId);
}

function sectionControlFields(section = {}) {
  const settings = section.settings || {};
  const style = settings.style || {};
  const decoration = settings.decoration || {};
  const responsive = settings.responsive || {};
  const tablet = responsive.tablet || {};
  const mobile = responsive.mobile || {};
  const animation = sanitizeAnimationSettings(settings.animation || {});

  return [
    { name: "label", label: "Container label", value: section.label || section.key || "", group: "Layout" },
    {
      name: "layout",
      label: "Grid",
      type: "choice",
      value: settings.layout || "one-column",
      options: containerLayoutOptions,
      help: "Choose the desktop structure. Tablet and mobile can override it.",
      group: "Layout"
    },
    {
      name: "container",
      label: "Width",
      type: "select",
      value: settings.container || "default",
      options: sectionContainerOptions,
      group: "Layout"
    },
    {
      name: "spacing",
      label: "Vertical spacing",
      type: "select",
      value: settings.spacing || "md",
      options: sectionSpacingOptions,
      group: "Layout"
    },
    {
      name: "gap",
      label: "Column gap",
      type: "choice",
      value: settings.gap || "md",
      options: sectionGapOptions,
      compact: true,
      group: "Layout"
    },
    {
      name: "align",
      label: "Content alignment",
      type: "select",
      value: settings.align || "start",
      options: sectionAlignOptions,
      group: "Layout"
    },
    {
      name: "verticalAlign",
      label: "Vertical alignment",
      type: "select",
      value: settings.verticalAlign || "start",
      options: sectionVerticalAlignOptions,
      group: "Layout"
    },
    {
      name: "minHeight",
      label: "Minimum height",
      type: "number",
      value: settings.minHeight ?? "",
      min: 0,
      max: 1200,
      step: 20,
      required: false,
      group: "Layout"
    },
    {
      name: "tabletLayout",
      label: "Tablet grid",
      type: "choice",
      value: tablet.layout || "inherit",
      options: tabletLayoutOptions,
      compact: true,
      group: "Tablet"
    },
    {
      name: "tabletSpacing",
      label: "Tablet spacing",
      type: "select",
      value: tablet.spacing || "inherit",
      options: inheritedSectionSpacingOptions,
      group: "Tablet"
    },
    {
      name: "mobileLayout",
      label: "Mobile grid",
      type: "choice",
      value: mobile.layout || "one-column",
      options: mobileLayoutOptions,
      compact: true,
      group: "Mobile"
    },
    {
      name: "mobileSpacing",
      label: "Mobile spacing",
      type: "select",
      value: mobile.spacing || "sm",
      options: inheritedSectionSpacingOptions,
      group: "Mobile"
    },
    {
      name: "stylePreset",
      label: "Style preset",
      type: "select",
      value: style.preset || "default",
      options: sectionStylePresetOptions,
      group: "Style"
    },
    { name: "backgroundColor", label: "Background", type: "color", value: style.backgroundColor || "", required: false, group: "Style" },
    { name: "textColor", label: "Text color", type: "color", value: style.textColor || "", required: false, group: "Style" },
    { name: "accentColor", label: "Accent color", type: "color", value: style.accentColor || "", required: false, group: "Style" },
    {
      name: "radius",
      label: "Corner radius",
      type: "number",
      value: style.radius ?? "",
      min: 0,
      max: 48,
      step: 1,
      required: false,
      group: "Style"
    },
    {
      name: "shadow",
      label: "Shadow",
      type: "select",
      value: style.shadow || "none",
      options: [
        { value: "none", label: "None" },
        { value: "soft", label: "Soft" },
        { value: "strong", label: "Strong" },
        { value: "glow", label: "Glow" }
      ],
      group: "Style"
    },
    {
      name: "decorationType",
      label: "Decoration",
      type: "select",
      value: decoration.type || "none",
      options: sectionDecorationOptions,
      group: "Decoration"
    },
    {
      name: "decorationPosition",
      label: "Decoration position",
      type: "select",
      value: decoration.position || "bottom-right",
      options: sectionDecorationPositionOptions,
      group: "Decoration"
    },
    { name: "decorationColor", label: "Decoration color", type: "color", value: decoration.color || "#5b5cff", required: false, group: "Decoration" },
    {
      name: "decorationOpacity",
      label: "Decoration opacity",
      type: "range",
      value: decoration.opacity ?? 0.35,
      min: 0,
      max: 0.9,
      step: 0.05,
      required: false,
      group: "Decoration"
    },
    {
      name: "htmlId",
      label: "HTML ID",
      value: settings.htmlId || "",
      required: false,
      help: "Optional anchor ID, for example services or contact-cta.",
      group: "Advanced"
    },
    {
      name: "cssClasses",
      label: "CSS classes",
      value: settings.cssClasses || "",
      required: false,
      help: "Optional safe class names separated by spaces.",
      group: "Advanced"
    },
    {
      name: "animationEffect",
      label: "Animation",
      type: "select",
      value: animation.effect,
      options: animationEffectOptions,
      required: false,
      group: "Motion"
    },
    {
      name: "animationDuration",
      label: "Duration ms",
      type: "number",
      value: animation.durationMs,
      min: 120,
      max: 3000,
      step: 10,
      required: false,
      group: "Motion"
    },
    {
      name: "animationDelay",
      label: "Delay ms",
      type: "number",
      value: animation.delayMs,
      min: 0,
      max: 5000,
      step: 50,
      required: false,
      group: "Motion"
    },
    {
      name: "customCss",
      label: "Advanced CSS",
      type: "textarea",
      rows: 3,
      value: settings.customCss || "",
      required: false,
      help: "Optional CSS declarations for this section. Use only when controls are not enough.",
      group: "Advanced"
    }
  ];
}

function optionalNumber(value, min, max) {
  if (value === "" || value === null || value === undefined) return undefined;

  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;

  return Math.min(max, Math.max(min, Math.round(number)));
}

function optionalColor(value) {
  const color = String(value || "").trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : undefined;
}

function responsiveSettings(values, currentSettings = {}) {
  return {
    ...(currentSettings.responsive || {}),
    tablet: {
      ...(currentSettings.responsive?.tablet || {}),
      layout: values.tabletLayout || "inherit",
      spacing: values.tabletSpacing || "inherit"
    },
    mobile: {
      ...(currentSettings.responsive?.mobile || {}),
      layout: values.mobileLayout || "one-column",
      spacing: values.mobileSpacing || "sm"
    }
  };
}

function settingsFromSectionControls(values, currentSettings = {}) {
  return {
    ...currentSettings,
    ...advancedSettingsFromValues(values, currentSettings),
    layout: values.layout || "one-column",
    container: values.container || "default",
    spacing: values.spacing || "md",
    gap: values.gap || "md",
    align: values.align || "start",
    verticalAlign: values.verticalAlign || "start",
    minHeight: optionalNumber(values.minHeight, 0, 1200),
    responsive: responsiveSettings(values, currentSettings),
    style: {
      ...(currentSettings.style || {}),
      preset: values.stylePreset || "default",
      backgroundColor: optionalColor(values.backgroundColor),
      textColor: optionalColor(values.textColor),
      accentColor: optionalColor(values.accentColor),
      radius: optionalNumber(values.radius, 0, 48),
      shadow: values.shadow || "none"
    },
    decoration: {
      ...(currentSettings.decoration || {}),
      type: values.decorationType || "none",
      position: values.decorationPosition || "bottom-right",
      color: optionalColor(values.decorationColor) || "#5b5cff",
      opacity: Number.isFinite(Number(values.decorationOpacity)) ? Math.min(0.9, Math.max(0, Number(values.decorationOpacity))) : 0.35
    },
    customCss: String(values.customCss || "").trim()
  };
}

export async function createPageFromDashboard() {
  window.history.pushState({}, "", "/dashboard/pages/new");
  try {
    const { templates } = await api("/cms/templates");
    state.cmsTemplates = templates || [];
  } catch {
    state.cmsTemplates = [];
  }
  renderCreatePagePage();
}

export function createPostFromDashboard() {
  window.history.pushState({}, "", "/dashboard/posts/new");
  renderPostEditorPage();
}

export async function createPageFromBuilder(form) {
  const formData = new FormData(form);
  const title = String(formData.get("title") || "").trim();
  const slug = slugFromTitle(title);
  const locale = activePageLocale();
  const selectedTemplate = (state.cmsTemplates || []).find((template) =>
    template.id === String(formData.get("templateId") || "") && template.type === "PAGE"
  );
  const templateContent = selectedTemplate?.content || {};
  const excerpt = optionalFormValue(formData, "excerpt");

  setFormDisabled(form, true);
  setFormMessage(form, "Creating page...");

  try {
    const { page } = await api("/cms/pages", {
      method: "POST",
      body: JSON.stringify({
        title,
        slug,
        locale,
        excerpt,
        content: {
          ...(templateContent.content || {}),
          layout: normalizePageLayout(formData.get("layout"))
        },
        status: String(formData.get("status") || "DRAFT"),
        sections: normalizeBuilderSectionsForSave(templateContent.sections || [])
      })
    });
    let message = selectedTemplate
      ? `Page created from ${selectedTemplate.name}.`
      : "Page created. Add a container, then add elements.";

    if (formData.get("addToMenu") === "on") {
      try {
        const { menu } = await api("/cms/menus/main");
        await api("/cms/menus/main/items", {
          method: "POST",
          body: JSON.stringify({
            label: String(formData.get("menuLabel") || page.title || title).trim(),
            pageId: page.id,
            url: null,
            sortOrder: menu.items?.length || 0,
            openInNewTab: false
          })
        });
      } catch (error) {
        message = `Page created, but the menu item was not added: ${error.message || "menu unavailable"}`;
      }
    }

    window.history.pushState({}, "", adminHrefWithLocale("page-builder", page.slug, page.locale || locale));
    renderPageBuilderPage(page, message);
  } catch (error) {
    setFormMessage(form, error.message || "Unable to create page.", true);
    setStatus(error.message || "Unable to create page.", true);
    setFormDisabled(form, false);
  }
}

async function reusableTemplateDetails(type, fallbackName, content) {
  const values = await getModalFormHandler()({
    label: type === "PAGE" ? "Reusable page" : "Reusable section",
    title: type === "PAGE" ? "Save page as template" : "Save section to library",
    description: type === "PAGE"
      ? "Keep this page structure available when creating future pages."
      : "Keep this container and its elements available across pages.",
    fields: [
      { name: "name", label: "Template name", value: fallbackName },
      { name: "description", label: "Description", type: "textarea", rows: 2, value: "", required: false }
    ],
    submitLabel: "Save template"
  });
  if (!values) return null;

  const { template } = await api("/cms/templates", {
    method: "POST",
    body: JSON.stringify({
      name: values.name,
      description: values.description || undefined,
      type,
      content
    })
  });
  state.cmsTemplates = [template, ...(state.cmsTemplates || []).filter((item) => item.id !== template.id)];
  return template;
}

export async function saveBuilderSectionTemplate(sectionId) {
  if (!state.builderPage || !sectionId) return;
  const section = (state.builderPage.sections || []).find((item) => item.id === sectionId);
  if (!section) return;

  try {
    const template = await reusableTemplateDetails(
      "SECTION",
      section.label || "Reusable section",
      { section: sectionToBuilderInput(section) }
    );
    if (template) renderPageBuilderPage(state.builderPage, `Saved ${template.name} to reusable sections.`);
  } catch (error) {
    setStatus(error.message || "Unable to save reusable section.", true);
  }
}

export async function saveBuilderPageTemplate() {
  if (!state.builderPage) return;

  try {
    const template = await reusableTemplateDetails(
      "PAGE",
      `${state.builderPage.title || "Page"} template`,
      {
        excerpt: state.builderPage.excerpt || undefined,
        content: state.builderPage.content || {},
        sections: normalizeBuilderSectionsForSave(state.builderPage.sections || [])
      }
    );
    if (template) renderPageBuilderPage(state.builderPage, `Saved ${template.name} as a page template.`);
  } catch (error) {
    setStatus(error.message || "Unable to save page template.", true);
  }
}

export async function addReusableTemplateToBuilder(templateId) {
  if (!state.builderPage) return;
  const template = (state.cmsTemplates || []).find((item) => item.id === templateId && item.type === "SECTION");
  const section = instantiateBuilderSectionTemplate(template?.content?.section, state.builderPage.sections || []);
  if (!template || !section) return;

  try {
    await saveBuilderSections(
      [...(state.builderPage.sections || []), section],
      `${template.name} added from reusable sections.`,
      section.key
    );
  } catch (error) {
    setStatus(error.message || "Unable to insert reusable section.", true);
  }
}

export async function replaceReusableTemplateFromBuilder(templateId) {
  if (!state.builderPage) return;
  const template = (state.cmsTemplates || []).find((item) => item.id === templateId && item.type === "SECTION");
  const section = (state.builderPage.sections || []).find((item) => item.id === state.activeBuilderSectionId);
  if (!template || !section) {
    setStatus("Select a container before replacing a reusable section.", true);
    return;
  }

  const confirmation = await getModalFormHandler()({
    label: "Reusable section",
    title: `Replace ${template.name}?`,
    description: `Update this reusable section from ${section.label || section.key}. Pages that already used it will not change.`,
    fields: [],
    submitLabel: "Replace template"
  });
  if (!confirmation) return;

  try {
    const { template: updated } = await api(`/cms/templates/${encodeURIComponent(template.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ content: { section: sectionToBuilderInput(section) } })
    });
    state.cmsTemplates = (state.cmsTemplates || []).map((item) => item.id === updated.id ? updated : item);
    renderPageBuilderPage(state.builderPage, `${updated.name} updated from the selected container.`);
  } catch (error) {
    setStatus(error.message || "Unable to replace reusable section.", true);
  }
}

function updatePageTemplateManager(template, remove = false) {
  const form = document.querySelector?.("[data-page-create-form]");
  if (!form) return false;

  const option = Array.from(form.querySelectorAll?.("[data-page-template-select] option") || [])
    .find((item) => item.value === template.id);
  const row = Array.from(form.querySelectorAll?.("[data-page-template-row]") || [])
    .find((item) => item.dataset.pageTemplateRow === template.id);

  if (remove) {
    option?.remove();
    row?.remove();
    if (!form.querySelector?.("[data-page-template-row]")) {
      form.querySelector?.("[data-page-template-manager]")?.remove();
    }
    return true;
  }

  if (option) option.textContent = template.name;
  const name = row?.querySelector?.("[data-page-template-name]");
  const description = row?.querySelector?.("[data-page-template-description]");
  const renameButton = row?.querySelector?.("[data-edit-reusable-template]");
  const deleteButton = row?.querySelector?.("[data-delete-reusable-template]");
  if (name) name.textContent = template.name;
  if (description) description.textContent = template.description || "Reusable page structure";
  if (renameButton) renameButton.setAttribute("aria-label", `Rename ${template.name}`);
  if (deleteButton) deleteButton.setAttribute("aria-label", `Delete ${template.name}`);
  return true;
}

export async function editReusableTemplate(templateId) {
  const template = (state.cmsTemplates || []).find((item) => item.id === templateId);
  if (!template) return;

  const values = await getModalFormHandler()({
    label: "Reusable template",
    title: `Rename ${template.name}`,
    fields: [
      { name: "name", label: "Template name", value: template.name },
      { name: "description", label: "Description", type: "textarea", rows: 2, value: template.description || "", required: false }
    ],
    submitLabel: "Save template"
  });
  if (!values) return;

  try {
    const { template: updated } = await api(`/cms/templates/${encodeURIComponent(template.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: values.name,
        description: values.description || null
      })
    });
    state.cmsTemplates = (state.cmsTemplates || []).map((item) => item.id === updated.id ? updated : item);
    if (state.builderPage) renderPageBuilderPage(state.builderPage, `${updated.name} template saved.`);
    else {
      if (!updatePageTemplateManager(updated)) renderCreatePagePage();
      setStatus(`${updated.name} template saved.`);
    }
  } catch (error) {
    setStatus(error.message || "Unable to update reusable template.", true);
  }
}

export async function deleteReusableTemplate(templateId) {
  const template = (state.cmsTemplates || []).find((item) => item.id === templateId);
  if (!template) return;
  const confirmation = await getModalFormHandler()({
    label: "Reusable template",
    title: `Delete ${template.name}?`,
    description: "Existing pages will keep their content. This removes the template from the library.",
    fields: [],
    submitLabel: "Delete template",
    destructive: true
  });
  if (!confirmation) return;

  try {
    await api(`/cms/templates/${encodeURIComponent(template.id)}`, { method: "DELETE" });
    state.cmsTemplates = (state.cmsTemplates || []).filter((item) => item.id !== template.id);
    if (state.builderPage) renderPageBuilderPage(state.builderPage, `${template.name} deleted from the library.`);
    else {
      if (!updatePageTemplateManager(template, true)) renderCreatePagePage();
      setStatus(`${template.name} deleted from the library.`);
    }
  } catch (error) {
    setStatus(error.message || "Unable to delete reusable template.", true);
  }
}

export async function savePageBuilderSettings(form) {
  const formData = new FormData(form);
  const currentSlug = form.dataset.pageSlug || state.builderPage?.slug;
  const locale = activePageLocale();
  if (!currentSlug) return;
  const slugInput = form.querySelector?.("[data-editable-slug]");
  const slugUnlocked = slugInput?.dataset?.slugUnlocked === "true";
  const payload = {
    title: String(formData.get("title") || "").trim(),
    status: String(formData.get("status") || "DRAFT"),
    excerpt: optionalFormValue(formData, "excerpt"),
    content: {
      ...(state.builderPage?.content || {}),
      layout: normalizePageLayout(formData.get("layout"))
    }
  };
  if (slugUnlocked) {
    payload.slug = slugFromTitle(String(formData.get("slug") || formData.get("title") || currentSlug));
  }

  setFormDisabled(form, true);
  setFormMessage(form, "Saving page...");

  try {
    const { page } = await api(withLocale(`/cms/pages/${encodeURIComponent(currentSlug)}`, locale), {
      method: "PATCH",
      body: JSON.stringify(payload)
    });

    if (page.slug !== currentSlug) window.history.pushState({}, "", adminHrefWithLocale("page-builder", page.slug, page.locale || locale));
    renderPageBuilderPage(page, "Page settings saved.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to save page.", true);
    setFormDisabled(form, false);
  }
}

async function createBuilderContainer(input = {}) {
  if (!state.builderPage) return null;

  const key = `container-${Date.now()}`;
  const section = {
    key,
    label: input.label || "Container",
    sortOrder: state.builderPage.sections?.length || 0,
    settings: {
      template: "content",
      ...settingsFromSectionControls(input)
    },
    blocks: []
  };
  await saveBuilderSections(
    [...(state.builderPage.sections || []), section],
    "Container added. Add elements from the left library.",
    key
  );

  return state.builderPage.sections?.find((item) => item.key === key) || null;
}

export async function addBuilderContainer() {
  if (!state.builderPage) return;

  try {
    const values = await getModalFormHandler()({
      label: "Page builder",
      title: "Choose container layout",
      description: "Pick the grid, width, style, and optional decorative layer. After it appears on the canvas, add elements into it.",
      fields: sectionControlFields({ label: `Section ${(state.builderPage.sections?.length || 0) + 1}` }),
      submitLabel: "Add container"
    });
    if (!values) return;

    setStatus("Adding container...");
    await createBuilderContainer(values);
  } catch (error) {
    setStatus(error.message || "Unable to add container.", true);
  }
}

export async function addSectionPatternToBuilder(patternId) {
  if (!state.builderPage) return;

  try {
    const section = buildSectionPattern(patternId, state.builderPage, state.builderPage.sections?.length || 0);
    for (const block of section.blocks || []) {
      if (block.type !== "PRODUCT_LIST") continue;

      const value = await configureProductListValue(block.value, block.label || "products", "Add section");
      if (!value) return;
      block.value = value;
    }
    setStatus(`Adding ${section.label || "section"}...`);
    await saveBuilderSections(
      [...(state.builderPage.sections || []), section],
      `${section.label || "Section"} added. Edit each block or adjust container settings.`,
      section.key
    );
  } catch (error) {
    setStatus(error.message || "Unable to add section pattern.", true);
  }
}

async function configureProductListValue(value, label, submitLabel) {
  const fields = await productListModalFields(value, { preserveUnavailable: false });
  const productField = fields.find((field) => field.name === "productSlugs");
  if (!productField?.options?.length) {
    setStatus("Publish an active product before adding this shop element.", true);
    return null;
  }

  const values = await getModalFormHandler()({
    label: "Shop",
    title: `Configure ${label}`,
    description: "Choose active products and a simple presentation.",
    fields,
    submitLabel
  });
  if (!values) return null;
  if (!Array.isArray(values.productSlugs) || !values.productSlugs.length) {
    setStatus("Choose at least one active product.", true);
    return null;
  }

  return productListValueFromValues(values);
}

function ensureBuilderHistory() {
  const slug = state.builderPage?.slug || "";
  if (state.builderHistorySlug === slug) return;

  state.builderHistorySlug = slug;
  state.builderUndoStack = [];
  state.builderRedoStack = [];
}

function pushBuilderHistory(stack, sections) {
  stack.push(copyBuilderSections(sections));
  if (stack.length > builderHistoryLimit) stack.splice(0, stack.length - builderHistoryLimit);
}

function recordBuilderHistory(sections) {
  ensureBuilderHistory();
  pushBuilderHistory(state.builderUndoStack, sections);
  state.builderRedoStack = [];
}

function activeBuilderSectionKey() {
  return state.builderPage?.sections?.find((section) => section.id === state.activeBuilderSectionId)?.key ||
    state.builderPage?.sections?.[0]?.key ||
    "";
}

function focusBuilderControl(kind, key, controlSelector) {
  if (typeof document === "undefined") return;

  requestAnimationFrame(() => {
    const selector = kind === "section" ? "[data-builder-section-key]" : "[data-builder-block-key]";
    const dataKey = kind === "section" ? "builderSectionKey" : "builderBlockKey";
    const item = Array.from(document.querySelectorAll(selector)).find((element) => element.dataset?.[dataKey] === key);
    item?.querySelector?.(controlSelector)?.focus?.();
  });
}

async function saveBuilderSections(sections, message, activeSectionKey = "", options = {}) {
  const previousSections = options.recordHistory === false
    ? null
    : copyBuilderSections(state.builderPage?.sections || []);
  const { page } = await api(withLocale(`/cms/pages/${encodeURIComponent(state.builderPage.slug)}`, activePageLocale()), {
    method: "PATCH",
    body: JSON.stringify({ sections: normalizeBuilderSectionsForSave(sections) })
  });

  if (previousSections) recordBuilderHistory(previousSections);
  state.builderPage = page;
  if (activeSectionKey) {
    state.activeBuilderSectionId = page.sections?.find((section) => section.key === activeSectionKey)?.id || null;
  }
  renderPageBuilderPage(page, message);
}

export async function undoBuilderChange() {
  if (!state.builderPage) return;
  ensureBuilderHistory();
  const previousSections = state.builderUndoStack.pop();
  if (!previousSections) return;

  const currentSections = copyBuilderSections(state.builderPage.sections || []);
  const activeSectionKey = activeBuilderSectionKey();
  pushBuilderHistory(state.builderRedoStack, currentSections);

  try {
    await saveBuilderSections(previousSections, "Last canvas change undone.", activeSectionKey, { recordHistory: false });
  } catch (error) {
    state.builderRedoStack.pop();
    pushBuilderHistory(state.builderUndoStack, previousSections);
    setStatus(error.message || "Unable to undo the last change.", true);
  }
}

export async function redoBuilderChange() {
  if (!state.builderPage) return;
  ensureBuilderHistory();
  const nextSections = state.builderRedoStack.pop();
  if (!nextSections) return;

  const currentSections = copyBuilderSections(state.builderPage.sections || []);
  const activeSectionKey = activeBuilderSectionKey();
  pushBuilderHistory(state.builderUndoStack, currentSections);

  try {
    await saveBuilderSections(nextSections, "Canvas change redone.", activeSectionKey, { recordHistory: false });
  } catch (error) {
    state.builderUndoStack.pop();
    pushBuilderHistory(state.builderRedoStack, nextSections);
    setStatus(error.message || "Unable to redo the last change.", true);
  }
}

export async function duplicateBuilderSection(sectionId) {
  if (!state.builderPage || !sectionId) return;
  const result = duplicateBuilderSectionInSections(state.builderPage.sections || [], sectionId);
  if (!result) return;

  try {
    await saveBuilderSections(result.sections, "Container duplicated.", result.activeSectionKey);
    focusBuilderControl("section", result.activeSectionKey, "[data-edit-builder-section]");
  } catch (error) {
    setStatus(error.message || "Unable to duplicate container.", true);
  }
}

export async function duplicateBuilderBlock(blockKey) {
  if (!state.builderPage || !blockKey) return;
  const result = duplicateBuilderBlockInSections(state.builderPage.sections || [], blockKey);
  if (!result) return;

  try {
    await saveBuilderSections(result.sections, "Element duplicated.", result.activeSectionKey);
    focusBuilderControl("block", result.blockKey, "[data-builder-edit-block], [data-duplicate-builder-block]");
  } catch (error) {
    setStatus(error.message || "Unable to duplicate element.", true);
  }
}

export async function moveBuilderSection(sectionId, direction) {
  if (!state.builderPage || !sectionId) return;
  const result = moveBuilderSectionInSections(state.builderPage.sections || [], sectionId, direction);
  if (!result) return;

  try {
    await saveBuilderSections(result.sections, "Container order saved.", result.activeSectionKey);
    focusBuilderControl("section", result.activeSectionKey, `[data-move-builder-section="${direction}"]`);
  } catch (error) {
    setStatus(error.message || "Unable to reorder containers.", true);
  }
}

export async function moveBuilderBlock(blockKey, direction) {
  if (!state.builderPage || !blockKey) return;
  const result = moveBuilderBlockInSections(state.builderPage.sections || [], blockKey, direction);
  if (!result) return;

  try {
    await saveBuilderSections(result.sections, "Element order saved.", result.activeSectionKey);
    focusBuilderControl("block", blockKey, `[data-move-builder-block="${direction}"]`);
  } catch (error) {
    setStatus(error.message || "Unable to reorder elements.", true);
  }
}

export async function reorderBuilderSection(sectionId, beforeSectionId = "") {
  if (!state.builderPage || !sectionId || sectionId === beforeSectionId) return;

  const sections = [...(state.builderPage.sections || [])];
  const sectionIndex = sections.findIndex((section) => section.id === sectionId);
  if (sectionIndex < 0) return;

  const [movedSection] = sections.splice(sectionIndex, 1);
  const beforeIndex = beforeSectionId ? sections.findIndex((section) => section.id === beforeSectionId) : -1;

  if (beforeIndex >= 0) sections.splice(beforeIndex, 0, movedSection);
  else sections.push(movedSection);

  try {
    await saveBuilderSections(sections, "Container order saved.", movedSection.key);
  } catch (error) {
    setStatus(error.message || "Unable to reorder containers.", true);
  }
}

export async function reorderBuilderBlock(blockKey, targetSectionId, beforeBlockKey = "") {
  if (!state.builderPage || !blockKey || !targetSectionId || blockKey === beforeBlockKey) return;

  const sections = (state.builderPage.sections || []).map((section) => ({
    ...section,
    blocks: [...(section.blocks || [])]
  }));
  let movedBlock = null;
  let targetSection = null;

  for (const section of sections) {
    const blockIndex = section.blocks.findIndex((block) => block.key === blockKey);
    if (blockIndex >= 0) {
      [movedBlock] = section.blocks.splice(blockIndex, 1);
    }

    if (section.id === targetSectionId) targetSection = section;
  }

  if (!movedBlock || !targetSection) return;

  const beforeIndex = beforeBlockKey ? targetSection.blocks.findIndex((block) => block.key === beforeBlockKey) : -1;
  if (beforeIndex >= 0) targetSection.blocks.splice(beforeIndex, 0, movedBlock);
  else targetSection.blocks.push(movedBlock);

  try {
    await saveBuilderSections(sections, "Element order saved.", targetSection.key);
  } catch (error) {
    setStatus(error.message || "Unable to reorder elements.", true);
  }
}

export async function deleteBuilderSection(sectionId) {
  if (!state.builderPage || !sectionId) return;

  const sections = [...(state.builderPage.sections || [])];
  const section = sections.find((item) => item.id === sectionId);
  if (!section) return;

  const blockCount = section.blocks?.length || 0;
  const message = blockCount
    ? `Delete "${section.label || "this container"}" and its ${blockCount} element${blockCount === 1 ? "" : "s"}?`
    : `Delete "${section.label || "this container"}"?`;
  const confirmation = await getModalFormHandler()({
    label: "Delete container",
    title: "Remove this container?",
    description: message,
    fields: [],
    submitLabel: "Delete container",
    destructive: true
  });
  if (!confirmation) return;

  const nextSections = sections.filter((item) => item.id !== sectionId);
  const nextActiveSection = nextSections.find((item) => item.id === state.activeBuilderSectionId) || nextSections[0];

  try {
    await saveBuilderSections(nextSections, "Container deleted.", nextActiveSection?.key || "");
  } catch (error) {
    setStatus(error.message || "Unable to delete container.", true);
  }
}

export async function deleteBuilderBlock(blockKey) {
  if (!state.builderPage || !blockKey) return;

  let deletedBlock = null;
  let activeSectionKey = "";
  const sections = (state.builderPage.sections || []).map((section) => {
    const blocks = [...(section.blocks || [])];
    const blockIndex = blocks.findIndex((block) => block.key === blockKey);

    if (blockIndex >= 0) {
      [deletedBlock] = blocks.splice(blockIndex, 1);
      activeSectionKey = section.key;
    }

    return { ...section, blocks };
  });
  if (!deletedBlock) return;

  const confirmation = await getModalFormHandler()({
    label: "Delete element",
    title: "Remove this element?",
    description: `Delete "${deletedBlock.label || "this element"}"?`,
    fields: [],
    submitLabel: "Delete element",
    destructive: true
  });
  if (!confirmation) return;

  try {
    await saveBuilderSections(sections, "Element deleted.", activeSectionKey);
  } catch (error) {
    setStatus(error.message || "Unable to delete element.", true);
  }
}

export async function editBuilderSection(sectionId) {
  if (!state.builderPage || !sectionId) return;

  const section = (state.builderPage.sections || []).find((item) => item.id === sectionId);
  if (!section) return;

  const values = await getModalFormHandler()({
    label: "Container settings",
    title: section.label || "Edit container",
    description: "Adjust layout, visual style, and decorative layer without touching CSS.",
    fields: sectionControlFields(section),
    submitLabel: "Save container"
  });
  if (!values) return;

  try {
    const sections = (state.builderPage.sections || []).map((item) => {
      if (item.id !== sectionId) return sectionToBuilderInput(item);

      return sectionToBuilderInput({
        ...item,
        label: values.label,
        settings: settingsFromSectionControls(values, item.settings || {})
      });
    });

    await saveBuilderSections(sections, "Container settings saved.", section.key);
  } catch (error) {
    setStatus(error.message || "Unable to save container settings.", true);
  }
}

async function activeBuilderSection(sectionId) {
  const sections = state.builderPage?.sections || [];
  let section = sections.find((item) => item.id === sectionId) ||
    sections.find((item) => item.id === state.activeBuilderSectionId) ||
    sections[0];

  if (!section) {
    section = await createBuilderContainer({ label: "Section 1", layout: "one-column" });
  }

  state.activeBuilderSectionId = section?.id || null;
  return section || null;
}

async function prepareTemplateBlock(templateBlock, section, index, elementId) {
  const key = `${section.key}-${templateBlock.type.toLowerCase()}-${Date.now()}-${index + 1}`;
  const settings = {
    ...(templateBlock.settings || {}),
    elementId
  };

  if (templateBlock.type !== "GALLERY") {
    if (templateBlock.type === "PRODUCT_LIST") {
      const value = await configureProductListValue(templateBlock.value, templateBlock.label || "products", "Add products");
      if (!value) return null;

      return {
        ...templateBlock,
        key,
        value,
        settings,
        sortOrder: (section.blocks?.length || 0) + index,
        editable: true
      };
    }

    return { ...templateBlock, key, settings, sortOrder: (section.blocks?.length || 0) + index, editable: true };
  }

  const mediaAssets = await loadMediaImageAssets();

  if (isGalleryValue(templateBlock.value)) {
    const values = await getModalFormHandler()({
      label: "Gallery",
      title: "Configure gallery",
      description: "Upload images and choose the gallery layout, captions, spacing, and preview behavior.",
      fields: galleryModalFields(templateBlock.value, { mediaAssets }),
      submitLabel: "Add gallery"
    });
    if (!values) return null;

    const galleryValue = galleryValueFromModal(values, templateBlock.value, await uploadedGalleryItems(values.items?.files, "Gallery image"));
    if (!galleryItems(galleryValue).length) {
      setStatus("Upload at least one image for the gallery.", true);
      return null;
    }

    return { ...templateBlock, key, value: galleryValue, settings, sortOrder: (section.blocks?.length || 0) + index, editable: true };
  }

  const values = await getModalFormHandler()({
    label: "Slider",
    title: "Configure slider",
    description: "Upload images and set visible count, overlay, caption, and loop behavior.",
    fields: sliderModalFields(templateBlock.value, { mediaAssets }),
    submitLabel: "Add slider"
  });
  if (!values) return null;

  const existingSlides = await uploadedGalleryItemFiles(values.slides?.existing, "Slider image");
  const sliderValue = sliderValueFromModal({
    ...values,
    slides: {
      ...(values.slides || {}),
      existing: existingSlides
    }
  }, templateBlock.value, await uploadedGalleryItems(values.slides?.files));
  if (!sliderSlides(sliderValue).length) {
    setStatus("Upload at least one image for the slider.", true);
    return null;
  }

  return { ...templateBlock, key, value: sliderValue, settings, sortOrder: (section.blocks?.length || 0) + index, editable: true };
}

export async function addTemplateToBuilder(templateId, sectionId = "") {
  if (!state.builderPage) return;

  try {
    const section = await activeBuilderSection(sectionId);
    const template = availableComponentTemplates().find((item) => item.id === templateId);
    if (!section || !template) return;

    setStatus(`Adding ${template.label || templateId}...`);
    const blocks = [];
    for (const [index, templateBlock] of template.blocks.entries()) {
      const block = await prepareTemplateBlock(templateBlock, section, index, template.id);
      if (!block) return;
      blocks.push(block);
    }

    const sections = (state.builderPage.sections || []).map((item) =>
      item.id === section.id
        ? { ...item, blocks: [...(item.blocks || []), ...blocks] }
        : item
    );

    await saveBuilderSections(
      sections,
      `${template.label || templateId} added to ${section.label || "container"}.`,
      section.key
    );
  } catch (error) {
    setStatus(error.message || "Unable to add element.", true);
  }
}

export async function addTemplateToBuilderSection(sectionId) {
  if (!state.builderPage || !sectionId) return;

  const section = (state.builderPage.sections || []).find((item) => item.id === sectionId);
  if (!section) return;

  const templates = availableComponentTemplates();
  const values = await getModalFormHandler()({
    label: "Container element",
    title: `Add element to ${section.label || "container"}`,
    description: "Choose one reusable element and it will be inserted directly into this container.",
    fields: [
      {
        name: "templateId",
        label: "Element",
        type: "select",
        value: templates[0]?.id || "",
        options: templates.map((template) => ({
          value: template.id,
          label: template.label
        }))
      }
    ],
    submitLabel: "Add element"
  });
  if (!values?.templateId) return;

  await addTemplateToBuilder(values.templateId, sectionId);
}

export async function editBuilderBlock(blockKey) {
  if (!state.builderPage) return;

  try {
    const previousSections = copyBuilderSections(state.builderPage.sections || []);
    const page = await editContentBlock(state.builderPage, blockKey);
    if (page) {
      recordBuilderHistory(previousSections);
      renderPageBuilderPage(page, "Block updated.");
    }
  } catch (error) {
    setStatus(error.message || "Unable to update block.", true);
  }
}

export async function loadPageRevisions(message = "Revision history loaded.") {
  if (!state.builderPage) return;

  try {
    setStatus("Loading revision history...");
    const { revisions } = await api(withLocale(`/cms/pages/${encodeURIComponent(state.builderPage.slug)}/revisions`, activePageLocale()));
    state.builderPageRevisions = revisions || [];
    state.builderRevisionComparison = null;
    state.builderRevisionSlug = state.builderPage.slug;
    renderPageBuilderPage(state.builderPage, message);
  } catch (error) {
    setStatus(error.message || "Unable to load revision history.", true);
  }
}

export async function comparePageRevision(revisionId) {
  if (!state.builderPage || !revisionId) return;

  try {
    setStatus("Comparing revision...");
    const comparison = await api(withLocale(`/cms/pages/${encodeURIComponent(state.builderPage.slug)}/revisions/${encodeURIComponent(revisionId)}/compare`, activePageLocale()));
    state.builderRevisionComparison = {
      revisionId: comparison.revision?.id || revisionId,
      version: comparison.revision?.version,
      action: comparison.revision?.action,
      changedFields: comparison.changedFields || []
    };
    state.builderRevisionSlug = state.builderPage.slug;
    renderPageBuilderPage(state.builderPage, "Revision comparison loaded.");
  } catch (error) {
    setStatus(error.message || "Unable to compare revision.", true);
  }
}

export async function restorePageRevision(revisionId, version = "") {
  if (!state.builderPage || !revisionId) return;

  const confirmation = await getModalFormHandler()({
    label: "Version history",
    title: `Restore version ${version || ""}`.trim(),
    description: "This will replace the current page content with the selected revision and create a new restore revision.",
    fields: [
      {
        name: "confirmRestore",
        label: "I understand this will replace the current page content.",
        type: "checkbox",
        required: false
      }
    ],
    submitLabel: "Restore revision"
  });
  if (!confirmation) return;
  if (!confirmation.confirmRestore) {
    setStatus("Confirm the restore before continuing.", true);
    return;
  }

  try {
    setStatus("Restoring revision...");
    const currentSlug = state.builderPage.slug;
    const locale = activePageLocale();
    const { page } = await api(withLocale(`/cms/pages/${encodeURIComponent(currentSlug)}/revisions/${encodeURIComponent(revisionId)}/restore`, locale), {
      method: "POST"
    });

    state.builderPage = page;
    state.builderPageRevisions = [];
    state.builderRevisionComparison = null;
    state.builderRevisionSlug = "";
    state.builderHistorySlug = page.slug;
    state.builderUndoStack = [];
    state.builderRedoStack = [];
    if (page.slug !== currentSlug) window.history.pushState({}, "", adminHrefWithLocale("page-builder", page.slug, page.locale || locale));
    renderPageBuilderPage(page, "Revision restored. A new restore revision was saved.");
  } catch (error) {
    setStatus(error.message || "Unable to restore revision.", true);
  }
}

function postPayloadFromForm(form, existingPost = null) {
  syncRichEditors(form);
  const formData = new FormData(form);
  const title = String(formData.get("title") || "").trim();
  const tags = String(formData.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean);
  const slugInput = form.querySelector?.("[data-editable-slug]");
  const slugUnlocked = slugInput?.dataset?.slugUnlocked === "true";

  const payload = {
    title,
    excerpt: optionalFormValue(formData, "excerpt"),
    content: {
      ...(existingPost?.content || {}),
      layout: normalizePageLayout(formData.get("layout")),
      body: String(formData.get("body") || "").trim()
    },
    status: String(formData.get("status") || "DRAFT"),
    locale: activePostLocale(),
    tags,
    categorySlugs: (existingPost?.categories || []).map((item) => item.category?.slug || item.slug).filter(Boolean)
  };

  if (!existingPost || slugUnlocked) {
    payload.slug = slugFromTitle(String(formData.get("slug") || title));
  }

  return payload;
}

export async function savePostEditor(form) {
  const existingPost = state.builderPost;
  const currentSlug = form.dataset.postSlug || existingPost?.slug;
  const payload = postPayloadFromForm(form, existingPost);

  setFormDisabled(form, true);
  setFormMessage(form, currentSlug ? "Saving post..." : "Creating post...");

  try {
    const locale = activePostLocale();
    const path = currentSlug ? `/cms/posts/${encodeURIComponent(currentSlug)}` : "/cms/posts";
    const { post } = await api(currentSlug ? withLocale(path, locale) : path, {
      method: currentSlug ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });

    if (!currentSlug || post.slug !== currentSlug) {
      window.history.pushState({}, "", adminHrefWithLocale("post-builder", post.slug, post.locale || locale));
    }
    renderPostEditorPage(post, currentSlug ? "Post saved." : "Post created.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to save post.", true);
    setStatus(error.message || "Unable to save post.", true);
    setFormDisabled(form, false);
  }
}

export function insertTemplateIntoPost(templateId) {
  const editor = document.querySelector("[data-post-editor-form] [data-rich-editor]");
  const source = editor?.querySelector?.("[data-rich-source]");
  const surface = editor?.querySelector?.("[data-rich-surface]");
  const snippet = richTextSnippetForTemplate(templateId);
  if (!source || !surface || !snippet) return;

  const html = `${source.value.trim() ? source.value : ""}<p>${snippet.replace(/\n+/g, "<br>")}</p>`;
  source.value = html;
  surface.innerHTML = html;
}
