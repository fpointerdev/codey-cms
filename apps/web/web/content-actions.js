import {
  api,
  elements,
  moduleEnabled,
  sectionFromTemplate,
  setStatus,
  slugFromTitle,
  state
} from "./core.js";
import { renderMenuItems, renderPage } from "./public-renderer.js";
import { currentLocale } from "./routes.js";
import { editablePromptValue, getModalFormHandler, parseEditableValue } from "./modal.js";
import {
  galleryItems,
  galleryModalFields,
  galleryValueFromModal,
  isGalleryValue,
  sliderModalFields,
  sliderSlides,
  sliderValueFromModal
} from "./slider-config.js";
import { structuredContentEditor } from "./structured-content-editor.js";
import { setFormDisabled, setFormMessage } from "./ui.js";
import {
  advancedSettingsFromValues,
  animationEffectOptions
} from "./custom-css.js";

export function optionalFormValue(formData, key) {
  const value = String(formData.get(key) || "").trim();
  return value || undefined;
}

export async function loadMenu() {
  try {
    const { menu } = await api(`/cms/menus/main?locale=${encodeURIComponent(currentLocale())}`);
    state.menu = menu;
    elements.menu.innerHTML = `
      ${renderMenuItems(menu.items || [], Boolean(state.user))}
      ${state.user ? '<button type="button" class="front-edit-button" data-add-menu-item>+ Menu</button>' : ""}
    `;
  } catch {
    state.menu = null;
    elements.menu.innerHTML = "";
  }
}

function localeQuery() {
  return `locale=${encodeURIComponent(currentLocale())}`;
}

export function selectedFile(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.arrayBuffer !== "function" || !value.size) return null;
  return value;
}

export function selectedFiles(value) {
  return (Array.isArray(value) ? value : [value]).map(selectedFile).filter(Boolean);
}

async function loadPageOptions() {
  const { pages } = await api("/cms/pages");

  return (pages || []).map((page) => ({
    value: page.id,
    label: `${page.title || page.slug} /${page.slug}${page.status ? ` (${page.status})` : ""}`
  }));
}

function normalizeMenuUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("/") || url.startsWith("#") || url.startsWith("mailto:") || url.startsWith("tel:")) {
    return url;
  }

  return `/${url.replace(/^\/+/, "")}`;
}

function menuItemPayload(values, sortOrder) {
  const pageId = values.pageId || null;
  const url = pageId ? null : normalizeMenuUrl(values.url);

  if (!pageId && !url) {
    throw new Error("Choose a page or enter a custom URL.");
  }

  return {
    label: values.label,
    pageId,
    url,
    sortOrder,
    openInNewTab: Boolean(values.openInNewTab)
  };
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";

  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }

  return btoa(binary);
}

export async function uploadMediaFile(file, altText = "") {
  const { asset } = await api("/cms/media/upload", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name || `upload-${Date.now()}`,
      mimeType: file.type || "application/octet-stream",
      dataBase64: await fileToBase64(file),
      kind: file.type?.startsWith("image/") ? "IMAGE" : "OTHER",
      altText
    })
  });

  return asset;
}

export async function uploadedGalleryItems(files = [], fallbackAlt = "Slider image") {
  const uploadedItems = [];

  for (const file of selectedFiles(files)) {
    const asset = await uploadMediaFile(file, file.name || fallbackAlt);
    uploadedItems.push({ url: asset.url, alt: asset.altText || file.name || "" });
  }

  return uploadedItems;
}

export async function loadMediaImageAssets() {
  try {
    const { assets } = await api("/cms/media");

    return (assets || [])
      .filter((asset) => asset?.kind === "IMAGE" && asset.url)
      .map((asset) => ({
        id: asset.id,
        url: asset.url,
        altText: asset.altText || asset.filename || "Media image"
      }));
  } catch {
    return [];
  }
}

function findBlock(page, blockKey) {
  return page?.sections
    ?.flatMap((section) => section.blocks || [])
    .find((block) => block.key === blockKey);
}

async function updatePageBlock(pageSlugValue, block, payload) {
  const { page } = await api(`/cms/pages/${encodeURIComponent(pageSlugValue)}/blocks/${encodeURIComponent(block.key)}?${localeQuery()}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });

  return page;
}

function cssSettingsPayload(block, values) {
  return {
    ...(block.settings || {}),
    ...advancedSettingsFromValues(values, block.settings || {}),
    customCss: String(values.customCss || "").trim()
  };
}

function withCustomCssField(block, fields) {
  return [
    ...fields,
    {
      name: "htmlId",
      label: "HTML ID",
      value: block.settings?.htmlId || "",
      required: false,
      group: "Style",
      help: "Optional anchor ID for this element."
    },
    {
      name: "cssClasses",
      label: "CSS classes",
      value: block.settings?.cssClasses || "",
      required: false,
      group: "Style",
      help: "Optional safe class names separated by spaces."
    },
    {
      name: "animationEffect",
      label: "Animation",
      type: "select",
      value: block.settings?.animation?.effect || "none",
      options: animationEffectOptions,
      group: "Configuration"
    },
    {
      name: "animationDuration",
      label: "Duration ms",
      type: "number",
      value: block.settings?.animation?.durationMs ?? 700,
      min: 120,
      max: 3000,
      step: 50,
      required: false,
      group: "Configuration"
    },
    {
      name: "animationDelay",
      label: "Delay ms",
      type: "number",
      value: block.settings?.animation?.delayMs ?? 0,
      min: 0,
      max: 5000,
      step: 50,
      required: false,
      group: "Configuration"
    },
    {
      name: "customCss",
      label: "Inline CSS",
      type: "textarea",
      rows: 3,
      value: block.settings?.customCss || "",
      required: false,
      group: "Style",
      help: "Optional CSS declarations for this element, for example: margin-top: 40px; max-width: 760px;"
    }
  ];
}

export async function editContentBlock(page, blockKey) {
  const block = findBlock(page, blockKey);
  if (!block) return null;

  if (block.type === "IMAGE") {
    const values = await getModalFormHandler()({
      label: "Content block",
      title: block.label || block.key,
      description: "Upload an image through the media library or keep an external image URL.",
      fields: withCustomCssField(block, [
        { name: "url", label: "Image URL", value: block.value?.url || "", required: false },
        { name: "alt", label: "Alt text", value: block.value?.alt || "", required: false },
        { name: "file", label: "Upload image", type: "file", accept: "image/*", required: false }
      ])
    });
    if (!values) return null;

    const file = selectedFile(values.file);
    const mediaAsset = file ? await uploadMediaFile(file, values.alt || block.value?.alt || "") : null;
    const imageUrl = mediaAsset?.url || values.url;

    if (!imageUrl) {
      setStatus("Choose an image file or enter an image URL.");
      return null;
    }

    return updatePageBlock(page.slug, block, {
      value: {
        url: imageUrl,
        alt: values.alt || mediaAsset?.altText || block.value?.alt || ""
      },
      settings: cssSettingsPayload(block, values),
      mediaAssetId: mediaAsset?.id || block.mediaAssetId || undefined
    });
  }

  if (block.type === "GALLERY") {
    const mediaAssets = await loadMediaImageAssets();

    if (isGalleryValue(block.value)) {
      const values = await getModalFormHandler()({
        label: "Gallery media",
        title: block.label || "Edit gallery",
        description: "Choose images, captions, layout, spacing, and preview behavior.",
        fields: withCustomCssField(block, galleryModalFields(block.value, { mediaAssets })),
        submitLabel: "Save gallery"
      });
      if (!values) return null;

      const uploadedItems = await uploadedGalleryItems(values.items?.files, block.label || "Gallery image");
      const galleryValue = galleryValueFromModal(values, block.value, uploadedItems);
      if (!galleryItems(galleryValue).length) {
        setStatus("Keep or upload at least one gallery image.", true);
        return null;
      }

      return updatePageBlock(page.slug, block, {
        value: galleryValue,
        settings: cssSettingsPayload(block, values)
      });
    }

    const values = await getModalFormHandler()({
      label: "Slider media",
      title: block.label || "Edit slider",
      description: "Choose images, visible count, overlay, caption, and loop behavior.",
      fields: withCustomCssField(block, sliderModalFields(block.value, { mediaAssets })),
      submitLabel: "Save slider"
    });
    if (!values) return null;

    const uploadedItems = await uploadedGalleryItems(values.slides?.files, block.label || "Slider image");
    const sliderValue = sliderValueFromModal(values, block.value, uploadedItems);
    if (!sliderSlides(sliderValue).length) {
      setStatus("Keep or upload at least one slider image.", true);
      return null;
    }

    return updatePageBlock(page.slug, block, {
      value: sliderValue,
      settings: cssSettingsPayload(block, values)
    });
  }

  if (block.type === "BUTTON" || block.type === "CTA") {
    const values = await getModalFormHandler()({
      label: "Content block",
      title: block.label || "Edit button",
      fields: withCustomCssField(block, [
        { name: "label", label: "Button label", value: block.value?.label || "" },
        { name: "url", label: "URL", value: block.value?.url || "/" }
      ])
    });
    if (!values) return null;

    return updatePageBlock(page.slug, block, {
      value: {
        label: values.label,
        url: values.url
      },
      settings: cssSettingsPayload(block, values)
    });
  }

  if (block.type === "PRODUCT_LIST") {
    const values = await getModalFormHandler()({
      label: "Shop",
      title: block.label || "Edit product list",
      description: "Use comma-separated product slugs.",
      fields: withCustomCssField(block, [
        { name: "productSlugs", label: "Product slugs", value: (block.value?.productSlugs || []).join(", "), required: false }
      ])
    });
    if (!values) return null;

    return updatePageBlock(page.slug, block, {
      value: {
        productSlugs: values.productSlugs.split(",").map((slug) => slug.trim()).filter(Boolean)
      },
      settings: cssSettingsPayload(block, values)
    });
  }

  if (block.type === "CONTACT_FORM") {
    const values = await getModalFormHandler()({
      label: "Form",
      title: block.label || "Edit contact form",
      description: "Set the public form key, email subject, and submit button text.",
      fields: withCustomCssField(block, [
        { name: "formKey", label: "Form key", value: block.value?.formKey || "contact" },
        { name: "subject", label: "Default subject", value: block.value?.subject || "", required: false },
        { name: "buttonLabel", label: "Button label", value: block.value?.buttonLabel || "Send inquiry" }
      ])
    });
    if (!values) return null;

    return updatePageBlock(page.slug, block, {
      value: {
        formKey: values.formKey || "contact",
        subject: values.subject || "",
        buttonLabel: values.buttonLabel || "Send inquiry"
      },
      settings: cssSettingsPayload(block, values)
    });
  }

  const structuredEditor = structuredContentEditor(block);
  if (structuredEditor) {
    const values = await getModalFormHandler()({
      label: "Content block",
      title: block.label || block.key,
      description: "Edit the visible content fields for this section.",
      fields: withCustomCssField(block, structuredEditor.fields),
      submitLabel: "Save content"
    });
    if (!values) return null;

    const file = selectedFile(values.structuredImageFile);
    const mediaAsset = file ? await uploadMediaFile(file, values.structuredImageAlt || block.label || "") : null;

    return updatePageBlock(page.slug, block, {
      value: structuredEditor.valueFrom(values, mediaAsset),
      settings: cssSettingsPayload(block, values),
      mediaAssetId: mediaAsset?.id || block.mediaAssetId || undefined
    });
  }

  const values = await getModalFormHandler()({
    label: "Content block",
    title: block.label || block.key,
    description: `Developer fallback for unsupported ${block.type.toLowerCase().replace("_", " ")} content. Prefer a registered builder element for normal editing.`,
    fields: withCustomCssField(block, [
      {
        name: "value",
        label: block.label || "Structured value",
        type: block.type === "RICH_TEXT" ? "richtext" : block.type === "TEXT" ? "text" : "code",
        value: editablePromptValue(block),
        rows: 10,
        help: "Advanced fallback only. Standard Codey elements open visual fields instead of structured content."
      }
    ])
  });
  if (!values) return null;

  return updatePageBlock(page.slug, block, {
    value: parseEditableValue(block, values.value),
    settings: cssSettingsPayload(block, values)
  });
}

export async function editBlock(blockKey) {
  if (!state.page) return;

  try {
    const page = await editContentBlock(state.page, blockKey);
    if (!page) return;

    state.page = page;
    renderPage(page);
  } catch (error) {
    setStatus(error.message || "Unable to update block.", true);
  }
}

export async function editPageSettings() {
  if (!state.page) return;

  const values = await getModalFormHandler()({
    label: "Page settings",
    title: "Edit page details",
    description: "Update the visible title and SEO metadata.",
    fields: [
      { name: "title", label: "Title", value: state.page.title || "" },
      { name: "excerpt", label: "Excerpt", type: "textarea", rows: 3, value: state.page.excerpt || "", required: false },
      { name: "metaTitle", label: "Meta title", value: state.page.metaTitle || "", required: false },
      { name: "metaDescription", label: "Meta description", type: "textarea", rows: 3, value: state.page.metaDescription || "", required: false }
    ]
  });
  if (!values) return;

  const { page } = await api(`/cms/pages/${state.page.slug}?${localeQuery()}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: values.title,
      excerpt: values.excerpt,
      metaTitle: values.metaTitle,
      metaDescription: values.metaDescription
    })
  });

  state.page = page;
  renderPage(page);
}

export async function editFooter() {
  if (!state.page) return;

  const values = await getModalFormHandler()({
    label: "Footer",
    title: "Edit footer text",
    fields: [
      { name: "footerText", label: "Footer text", value: state.page.content?.footerText || "" }
    ]
  });
  if (!values) return;

  const { page } = await api(`/cms/pages/${state.page.slug}?${localeQuery()}`, {
    method: "PATCH",
    body: JSON.stringify({
      content: {
        ...(state.page.content || {}),
        footerText: values.footerText
      }
    })
  });

  state.page = page;
  renderPage(page);
}

export async function addMenuItem() {
  if (!state.menu) return;
  const pageOptions = await loadPageOptions();

  const values = await getModalFormHandler()({
    label: "Navigation",
    title: "Add menu item",
    description: "Link to an existing CMS page when possible. Use a custom URL only for external pages, anchors, email, or phone links.",
    fields: [
      { name: "label", label: "Label", value: "New page" },
      {
        name: "pageId",
        label: "Linked page",
        type: "select",
        value: "",
        required: false,
        options: [
          { value: "", label: "Custom URL" },
          ...pageOptions
        ]
      },
      { name: "url", label: "Custom URL", value: "/new-page", required: false },
      { name: "openInNewTab", label: "Open in new tab", type: "checkbox", checked: false, required: false }
    ],
    submitLabel: "Add item"
  });
  if (!values) return;

  try {
    await api(`/cms/menus/main/items?${localeQuery()}`, {
      method: "POST",
      body: JSON.stringify(menuItemPayload(values, state.menu.items?.length || 0))
    });
    await loadMenu();
  } catch (error) {
    setStatus(error.message || "Unable to add menu item.", true);
  }
}

export async function editMenuItem(itemId) {
  const item = state.menu?.items?.find((currentItem) => currentItem.id === itemId);
  if (!item) return;
  const pageOptions = await loadPageOptions();

  const values = await getModalFormHandler()({
    label: "Navigation",
    title: "Edit menu item",
    description: "Keep this item linked to a CMS page, or switch it to a custom URL.",
    fields: [
      { name: "label", label: "Label", value: item.label || "" },
      {
        name: "pageId",
        label: "Linked page",
        type: "select",
        value: item.pageId || "",
        required: false,
        options: [
          { value: "", label: "Custom URL" },
          ...pageOptions
        ]
      },
      { name: "url", label: "Custom URL", value: item.pageId ? "" : item.url || "", required: false },
      { name: "openInNewTab", label: "Open in new tab", type: "checkbox", checked: Boolean(item.openInNewTab), required: false }
    ]
  });
  if (!values) return;

  try {
    await api(`/cms/menus/main/items/${encodeURIComponent(item.id)}?${localeQuery()}`, {
      method: "PATCH",
      body: JSON.stringify(menuItemPayload(values, item.sortOrder || 0))
    });
    await loadMenu();
  } catch (error) {
    setStatus(error.message || "Unable to update menu item.", true);
  }
}

export async function addArticle() {
  if (!moduleEnabled("cms")) {
    setStatus("CMS module is not enabled for this project.", true);
    return;
  }

  const values = await getModalFormHandler()({
    label: "CMS",
    title: "Create draft article",
    fields: [
      { name: "title", label: "Title", value: "New article" },
      { name: "slug", label: "Slug", value: "new-article", required: false },
      { name: "excerpt", label: "Excerpt", type: "textarea", rows: 3, value: "Short summary", required: false }
    ],
    submitLabel: "Create draft"
  });
  if (!values) return;

  const slug = slugFromTitle(values.slug || values.title);
  await api("/cms/posts", {
    method: "POST",
    body: JSON.stringify({
      title: values.title,
      slug,
      excerpt: values.excerpt,
      content: {
        source: "front-editor"
      },
      status: "DRAFT",
      tags: [],
      categorySlugs: []
    })
  });
  setStatus(`Draft article created: ${slug}`);
}

export async function addProduct() {
  if (!moduleEnabled("products")) {
    setStatus("Products module is not enabled for this project.", true);
    return;
  }

  const values = await getModalFormHandler()({
    label: "Shop",
    title: "Create draft product",
    fields: [
      { name: "name", label: "Product name", value: "New product" },
      { name: "slug", label: "Slug", value: "new-product", required: false },
      { name: "price", label: "Price EUR", type: "number", value: "10.00" },
      { name: "stock", label: "Stock", type: "number", value: "10" }
    ],
    submitLabel: "Create product"
  });
  if (!values) return;

  const slug = values.slug || slugFromTitle(values.name);
  const priceCents = Math.round(Number(values.price.replace(",", ".")) * 100);
  const stockQuantity = Number.parseInt(values.stock, 10);
  const { product } = await api("/products", {
    method: "POST",
    body: JSON.stringify({
      name: values.name,
      slug,
      priceCents: Number.isFinite(priceCents) ? priceCents : 0,
      currency: "EUR",
      stockQuantity: Number.isFinite(stockQuantity) ? stockQuantity : 0,
      status: "DRAFT"
    })
  });
  setStatus(`Draft product created: ${product.slug}`);
}

export async function createUserInvite() {
  const values = await getModalFormHandler()({
    label: "Users",
    title: "Invite user",
    description: "Use comma-separated role names for advanced access.",
    fields: [
      { name: "email", label: "Email", type: "email", value: "editor@example.com" },
      { name: "roles", label: "Roles", value: "client_editor" }
    ],
    submitLabel: "Create invite"
  });
  if (!values) return;

  await api("/auth/invites", {
    method: "POST",
    body: JSON.stringify({
      email: values.email,
      roleNames: values.roles.split(",").map((role) => role.trim()).filter(Boolean)
    })
  });
  setStatus(`Invite created for ${values.email}.`);
}

const containerLayoutOptions = [
  { value: "one-column", label: "1 column", description: "Stacked content and long-form sections." },
  { value: "two-column", label: "2 columns", description: "Image/text, forms, FAQs, and balanced content." },
  { value: "three-column", label: "3 columns", description: "Service cards, proof points, and compact grids." },
  { value: "four-column", label: "4 columns", description: "Dense cards, stats, logos, and team sections." },
  { value: "asymmetric", label: "Asymmetric", description: "Editorial split with one dominant side." },
  { value: "full-bleed", label: "Full width", description: "Wide media, hero, or immersive sections." }
];

const sectionGapOptions = [
  { value: "sm", label: "Tight", description: "Compact editorial rhythm." },
  { value: "md", label: "Standard", description: "Balanced default spacing." },
  { value: "lg", label: "Wide", description: "Premium section breathing room." },
  { value: "xl", label: "Extra wide", description: "Hero and gallery scale." }
];

const mobileLayoutOptions = [
  { value: "one-column", label: "1 column", description: "Best for content and forms." },
  { value: "two-column", label: "2 columns", description: "Use only for short cards." }
];

export async function saveSiteSettings(form) {
  const formData = new FormData(form);
  const current = state.config?.siteSettings || {};
  const settingValue = (key) => (
    formData.has(key)
      ? String(formData.get(key) || "").trim()
      : String(current[key] || "").trim()
  );
  const settingBoolean = (key) => (
    formData.has(key)
      ? String(formData.get(key)) === "true"
      : current[key] !== false
  );

  setFormDisabled(form, true);
  setFormMessage(form, "Saving settings...");

  try {
    const response = await api("/config/site-settings", {
      method: "PATCH",
      body: JSON.stringify({
        title: settingValue("title"),
        description: settingValue("description"),
        metaTitle: settingValue("metaTitle"),
        metaDescription: settingValue("metaDescription"),
        siteUrl: settingValue("siteUrl"),
        searchIndexing: settingBoolean("searchIndexing"),
        sitemapEnabled: settingBoolean("sitemapEnabled"),
        customCss: settingValue("customCss")
      })
    });
    if (state.config && response.siteSettings) state.config.siteSettings = response.siteSettings;
    setFormMessage(form, "Settings saved.");
    setStatus("Settings saved.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to save settings.", true);
  } finally {
    setFormDisabled(form, false);
  }
}

function parseLocaleRows(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [code, label, status] = line.split("|").map((part) => part.trim());
      return {
        code,
        label: label || code.toUpperCase(),
        enabled: status?.toLowerCase() !== "disabled"
      };
    })
    .filter((locale) => locale.code);
}

const localeLanguageCodes = new Map([
  ["english", "en"],
  ["albanian", "sq"],
  ["german", "de"],
  ["french", "fr"],
  ["italian", "it"],
  ["spanish", "es"],
  ["portuguese", "pt"],
  ["dutch", "nl"],
  ["turkish", "tr"],
  ["croatian", "hr"],
  ["serbian", "sr"],
  ["bosnian", "bs"],
  ["macedonian", "mk"],
  ["greek", "el"],
  ["polish", "pl"],
  ["romanian", "ro"],
  ["bulgarian", "bg"],
  ["arabic", "ar"],
  ["chinese", "zh"],
  ["japanese", "ja"]
]);

function localeRowsFromForm(form, defaultLocale = "en") {
  const localeRows = Array.from(form.querySelectorAll?.("[data-locale-row]") || []);
  if (!localeRows.length) return null;

  const rows = localeRows
    .map((row) => {
      const code = String(row.querySelector?.('[name="localeCode"]')?.value || "").trim().toLowerCase();
      const label = String(row.querySelector?.('[name="localeLabel"]')?.value || "").trim();
      const enabled = Boolean(row.querySelector?.('[name="localeEnabled"]')?.checked);
      const isDefault = Boolean(row.querySelector?.('[name="localeDefault"]')?.checked);

      return {
        code,
        label: label || code.toUpperCase(),
        enabled,
        isDefault
      };
    })
    .filter((locale) => locale.code);

  if (!rows.length) {
    return {
      defaultLocale,
      locales: [{ code: defaultLocale, label: defaultLocale.toUpperCase(), enabled: true }]
    };
  }

  const selectedDefault = rows.find((locale) => locale.isDefault)?.code ||
    rows.find((locale) => locale.enabled)?.code ||
    rows[0].code ||
    defaultLocale;

  return {
    defaultLocale: selectedDefault,
    locales: rows.map((locale) => ({
      code: locale.code,
      label: locale.label,
      enabled: locale.enabled || locale.code === selectedDefault
    }))
  };
}

function languageSwitcherDisplayFromForm(value) {
  return value === "dropdown" ? "dropdown" : "buttons";
}

function languageSwitcherLabelStyleFromForm(value) {
  return value === "code" || value === "icon" ? value : "full";
}

function parseTranslationStringRows(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((strings, line) => {
      const [key, locale, ...textParts] = line.split("|").map((part) => part.trim());
      const text = textParts.join(" | ").trim();

      if (!key || !locale || !text) return strings;

      strings[key] = {
        ...(strings[key] || {}),
        [locale.toLowerCase()]: text
      };
      return strings;
    }, {});
}

export async function saveLocalizationSettings(form) {
  const formData = new FormData(form);
  const localeSettings = localeRowsFromForm(form, "en");
  const fallbackRows = parseLocaleRows(formData.get("locales"));
  const defaultLocale = localeSettings?.defaultLocale || fallbackRows.find((locale) => locale.enabled)?.code || fallbackRows[0]?.code || "en";
  const locales = localeSettings?.locales || fallbackRows;
  const strings = parseTranslationStringRows(formData.get("strings"));

  setFormDisabled(form, true);
  setFormMessage(form, "Saving localization...");

  try {
    const response = await api("/config/modules/localization/settings", {
      method: "PATCH",
      body: JSON.stringify({
        settings: {
          enabled: true,
          defaultLocale,
          fallbackLocale: defaultLocale,
          locales,
          urlMode: "prefix",
          showLanguageSwitcher: formData.get("showLanguageSwitcher") === "on",
          languageSwitcherDisplay: languageSwitcherDisplayFromForm(formData.get("languageSwitcherDisplay")),
          languageSwitcherLabelStyle: languageSwitcherLabelStyleFromForm(formData.get("languageSwitcherLabelStyle")),
          strings
        }
      })
    });
    if (state.config && response.installedModules) {
      state.config.installedModules = response.installedModules;
    }
    setFormMessage(form, "Localization saved.");
    setStatus("Localization saved.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to save localization.", true);
    setStatus(error.message || "Unable to save localization.", true);
  } finally {
    setFormDisabled(form, false);
  }
}

export function addLocaleRow() {
  const list = document.querySelector("[data-locale-list]");
  if (!list) return;

  const row = document.createElement("div");
  row.className = "locale-row";
  row.dataset.localeRow = "";
  row.innerHTML = `
    <label><span>Language</span><input name="localeLabel" list="locale-language-options" data-locale-language-input placeholder="Search language" /></label>
    <label><span>Code</span><input name="localeCode" data-locale-code-input placeholder="de" /></label>
    <label class="inline-check locale-default"><input type="radio" name="localeDefault" /><span><strong aria-hidden="true">★</strong> Default</span></label>
    <label class="inline-check locale-enabled"><input type="checkbox" name="localeEnabled" checked /><span>Enabled</span></label>
    <button type="button" class="secondary-button" data-remove-locale-row>Remove</button>
  `;
  list.append(row);
}

export function removeLocaleRow(button) {
  const row = button?.closest?.("[data-locale-row]");
  const list = row?.parentElement;
  if (!row || !list || list.querySelectorAll("[data-locale-row]").length <= 1) return;

  row.remove();
}

export function syncLocaleLanguageFields(input) {
  const row = input?.closest?.("[data-locale-row]");
  const codeInput = row?.querySelector?.('[name="localeCode"]');
  const code = localeLanguageCodes.get(String(input?.value || "").trim().toLowerCase());
  if (!codeInput || !code || codeInput.dataset.localeCodeEdited === "true") return;

  codeInput.value = code;
}

export async function toggleLocalizationModule(action) {
  const nextAction = action === "disable" ? "disable" : "enable";

  try {
    await api(`/config/modules/localization/${nextAction}`, {
      method: "POST"
    });
    const { renderSettingsPage } = await import("./admin-views.js");
    renderSettingsPage(await api("/config"));
    setStatus(`Localization ${nextAction === "enable" ? "enabled" : "disabled"}.`);
  } catch (error) {
    setStatus(error.message || "Unable to update localization module.", true);
  }
}

export async function editProductFromBlock(productSlug) {
  if (!moduleEnabled("products")) {
    setStatus("Products module is not enabled for this project.", true);
    return;
  }

  const product = productSlug ? (await api(`/products/${encodeURIComponent(productSlug)}`)).product : null;
  const values = await getModalFormHandler()({
    label: "Shop",
    title: product ? "Edit product" : "Create product",
    fields: [
      { name: "slug", label: "Slug", value: product?.slug || productSlug || "product-slug" },
      { name: "name", label: "Name", value: product?.name || "Product name" },
      { name: "price", label: "Price EUR", type: "number", value: product ? (product.priceCents / 100).toFixed(2) : "10.00" },
      { name: "stock", label: "Stock", type: "number", value: String(product?.stockQuantity ?? 10) },
      {
        name: "status",
        label: "Status",
        type: "select",
        value: product?.status || "DRAFT",
        options: [
          { value: "DRAFT", label: "Draft" },
          { value: "ACTIVE", label: "Active" },
          { value: "ARCHIVED", label: "Archived" }
        ]
      }
    ]
  });
  if (!values) return;

  const priceCents = Math.round(Number(values.price.replace(",", ".")) * 100);
  const stockQuantity = Number.parseInt(values.stock, 10);
  const originalSlug = product?.slug || productSlug || values.slug;
  const { product: updatedProduct } = await api(`/products/${encodeURIComponent(originalSlug)}`, {
    method: "PATCH",
    body: JSON.stringify({
      slug: values.slug || undefined,
      name: values.name,
      priceCents: Number.isFinite(priceCents) ? priceCents : undefined,
      stockQuantity: Number.isFinite(stockQuantity) ? stockQuantity : undefined,
      status: values.status || undefined
    })
  });
  setStatus(`Product updated: ${updatedProduct.slug}`);
}

export async function addSection() {
  if (!state.page) return;

  try {
    const values = await getModalFormHandler()({
      label: "Page builder",
      title: "Choose container layout",
      description: "Pick the grid first. After it appears on the page, add elements into it.",
      fields: [
        { name: "label", label: "Container label", value: `Section ${state.page.sections.length + 1}` },
        { name: "layout", label: "Desktop grid", type: "choice", value: "one-column", options: containerLayoutOptions },
        { name: "gap", label: "Column gap", type: "choice", value: "md", options: sectionGapOptions, compact: true },
        { name: "mobileLayout", label: "Mobile grid", type: "choice", value: "one-column", options: mobileLayoutOptions, compact: true },
        {
          name: "customCss",
          label: "Container CSS",
          type: "textarea",
          rows: 3,
          value: "",
          required: false,
          help: "Optional CSS declarations for this section."
        }
      ],
      submitLabel: "Add container"
    });
    if (!values) return;

    const key = `section-${Date.now()}`;

    const { page } = await api(`/cms/pages/${state.page.slug}/sections?${localeQuery()}`, {
      method: "POST",
      body: JSON.stringify({
        key,
        label: values.label,
        sortOrder: state.page.sections.length,
        settings: {
          layout: values.layout,
          gap: values.gap || "md",
          responsive: {
            mobile: {
              layout: values.mobileLayout || "one-column",
              spacing: "sm"
            }
          },
          template: "content",
          customCss: String(values.customCss || "").trim()
        },
        blocks: []
      })
    });

    state.page = page;
    renderPage(page);
    setStatus("Container added.");
  } catch (error) {
    setStatus(error.message || "Unable to add container.", true);
  }
}

export async function addElementTemplate(templateId) {
  if (!state.page) return;

  try {
    const section = sectionFromTemplate(templateId, state.page);
    for (const block of section.blocks) {
      if (block.type !== "GALLERY") continue;

      if (isGalleryValue(block.value)) {
        const values = await getModalFormHandler()({
          label: "Gallery",
          title: "Configure gallery",
          description: "Upload images and choose the gallery layout, captions, spacing, and preview behavior.",
          fields: galleryModalFields(block.value),
          submitLabel: "Add gallery"
        });
        if (!values) return;

        block.value = galleryValueFromModal(values, block.value, await uploadedGalleryItems(values.items?.files, "Gallery image"));
        if (!galleryItems(block.value).length) {
          setStatus("Upload at least one image for the gallery.", true);
          return;
        }
        continue;
      }

      const values = await getModalFormHandler()({
        label: "Slider",
        title: "Configure slider",
        description: "Upload images and set how the slider behaves.",
        fields: sliderModalFields(block.value),
        submitLabel: "Add slider"
      });
      if (!values) return;

      block.value = sliderValueFromModal(values, block.value, await uploadedGalleryItems(values.slides?.files));
      if (!sliderSlides(block.value).length) {
        setStatus("Upload at least one image for the slider.", true);
        return;
      }
    }

    setStatus(`Adding ${templateId}...`);
    const { page } = await api(`/cms/pages/${encodeURIComponent(state.page.slug)}/sections?${localeQuery()}`, {
      method: "POST",
      body: JSON.stringify(section)
    });

    state.page = page;
    renderPage(page);
    setStatus(`Added ${templateId}.`);
  } catch (error) {
    setStatus(error.message || "Unable to add element.", true);
  }
}

export async function publishPage() {
  if (!state.page) return;

  const { page } = await api(`/cms/pages/${state.page.slug}/publish?${localeQuery()}`, {
    method: "POST",
    body: JSON.stringify({})
  });
  state.page = page;
  renderPage(page);
}
