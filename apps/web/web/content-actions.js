import {
  api,
  elements,
  moduleEnabled,
  sectionFromTemplate,
  setRuntimeConfig,
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
  animationEffectOptions,
  sanitizeAnimationSettings
} from "./custom-css.js";
import { designSystemFromForm } from "./design-system.js";

export function optionalFormValue(formData, key) {
  const value = String(formData.get(key) || "").trim();
  return value || undefined;
}

export async function loadMenu() {
  try {
    const { menu } = await api(`/cms/menus/main?locale=${encodeURIComponent(currentLocale())}`);
    state.menu = menu;
    const canEditMenu = Boolean(state.user && state.visualEditorActive);
    elements.menu.innerHTML = `
      ${renderMenuItems(menu.items || [], canEditMenu)}
      ${canEditMenu ? '<button type="button" class="front-edit-button" data-add-menu-item>+ Menu</button>' : ""}
    `;
  } catch {
    state.menu = null;
    elements.menu.innerHTML = "";
  }
}

function localeQuery() {
  return `locale=${encodeURIComponent(currentLocale())}`;
}

export async function productListModalFields(value = {}, modalOptions = {}) {
  const { products = [] } = await api(`/products?status=ACTIVE&limit=100&${localeQuery()}`);
  const productsBySlug = new Map(products.map((product) => [product.slug, product]));
  const requestedSlugs = Array.isArray(value.productSlugs) ? value.productSlugs : [];
  const selectedSlugs = modalOptions.preserveUnavailable === false
    ? requestedSlugs.filter((slug) => productsBySlug.has(slug))
    : requestedSlugs;
  const productOptions = [
    ...products.map((product) => ({
      value: product.slug,
      label: product.name,
      description: `${product.category?.name || "Product"} · ${product.status || "ACTIVE"}`
    })),
    ...selectedSlugs
      .filter((slug) => !productsBySlug.has(slug))
      .map((slug) => ({ value: slug, label: slug, description: "Currently unavailable" }))
  ];

  return [
    { name: "title", label: "Heading", value: value.title || "Featured products", required: false, group: "Content" },
    { name: "body", label: "Introduction", type: "richtext", value: value.body || "", required: false, group: "Content" },
    {
      name: "productSlugs",
      label: "Products",
      type: "multiChoice",
      value: selectedSlugs,
      options: productOptions,
      multiple: true,
      required: false,
      help: products.length ? "Select one or more active products." : "Publish a product first, then return here.",
      group: "Content"
    },
    {
      name: "layout",
      label: "Layout",
      type: "choice",
      value: value.layout || "grid",
      options: [
        { value: "grid", label: "Product grid", description: "Balanced cards for several products.", preview: "three-column" },
        { value: "spotlight", label: "Spotlight", description: "One prominent product with more room.", preview: "asymmetric" },
        { value: "compact", label: "Compact", description: "Dense cards for larger selections.", preview: "four-column" }
      ],
      group: "Settings"
    },
    {
      name: "columns",
      label: "Products per row",
      type: "select",
      value: String(value.columns || 3),
      options: [2, 3, 4].map((columns) => ({ value: String(columns), label: `${columns} products` })),
      group: "Settings"
    },
    { name: "showDescription", label: "Show product descriptions", type: "checkbox", checked: value.showDescription !== false, group: "Settings" }
  ];
}

export function productListValueFromValues(values) {
  return {
    productSlugs: Array.isArray(values.productSlugs) ? values.productSlugs : [],
    title: values.title || "",
    body: values.body || "",
    layout: ["grid", "spotlight", "compact"].includes(values.layout) ? values.layout : "grid",
    columns: [2, 3, 4].includes(Number(values.columns)) ? Number(values.columns) : 3,
    showDescription: values.showDescription === true
  };
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

export function mediaKindForMimeType(mimeType = "") {
  return mimeType.startsWith("image/")
    ? "IMAGE"
    : mimeType.startsWith("video/")
      ? "VIDEO"
      : mimeType === "application/pdf"
        ? "DOCUMENT"
        : "OTHER";
}

export async function uploadMediaFile(file, altText = "") {
  const mimeType = file.type || (/\.glb$/i.test(file.name || "") ? "model/gltf-binary" : "application/octet-stream");
  const kind = mediaKindForMimeType(mimeType);
  const { asset } = await api("/cms/media/upload", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name || `upload-${Date.now()}`,
      mimeType,
      dataBase64: await fileToBase64(file),
      kind,
      altText
    })
  });

  return asset;
}

export async function uploadedGalleryItems(files = [], fallbackAlt = "Slider image") {
  const uploadedItems = [];

  for (const file of selectedFiles(files)) {
    const asset = await uploadMediaFile(file, file.name || fallbackAlt);
    uploadedItems.push({
      url: asset.url,
      mediaAssetId: asset.id,
      alt: asset.altText || file.name || ""
    });
  }

  return uploadedItems;
}

export async function uploadedGalleryItemFiles(items = [], fallbackAlt = "Slider image") {
  const nextItems = [];

  for (const item of Array.isArray(items) ? items : []) {
    const { file: itemFile, ...cleanItem } = item || {};
    const file = selectedFile(itemFile);
    if (!file) {
      nextItems.push(cleanItem);
      continue;
    }

    const asset = await uploadMediaFile(file, cleanItem.alt || file.name || fallbackAlt);
    nextItems.push({
      ...cleanItem,
      url: asset.url,
      mediaAssetId: asset.id || cleanItem.mediaAssetId,
      alt: cleanItem.alt || asset.altText || file.name || fallbackAlt
    });
  }

  return nextItems;
}

export async function loadMediaImageAssets() {
  try {
    const { assets } = await api("/cms/media");

    return (assets || [])
      .filter((asset) => asset?.kind === "IMAGE" && asset.url)
      .map((asset) => ({
        id: asset.id,
        url: asset.url,
        altText: asset.altText || asset.filename || "Media image",
        width: asset.width,
        height: asset.height
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

function withCustomCssField(block, fields, options = {}) {
  const animationGroup = options.animationGroup || "Style";
  const animation = sanitizeAnimationSettings(block.settings?.animation || {});

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
      type: "section",
      label: "Motion",
      help: "Optional entrance effect. Reduced-motion preferences are always respected.",
      group: animationGroup
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
      value: animation.effect,
      options: animationEffectOptions,
      required: false,
      group: animationGroup
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
      group: animationGroup
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
      group: animationGroup
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

function customCodeValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      html: typeof value.html === "string" ? value.html : "",
      css: typeof value.css === "string" ? value.css : "",
      javascript: typeof value.javascript === "string" ? value.javascript : "",
      libraries: Array.isArray(value.libraries) ? value.libraries : [],
      height: Number.isInteger(value.height) ? value.height : 320
    };
  }

  return {
    html: typeof value === "string" ? value : "",
    css: "",
    javascript: "",
    libraries: [],
    height: 320
  };
}

function customCodeLibraries(value) {
  const libraries = [...new Set(String(value || "")
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean))];

  if (libraries.length > 12) {
    throw new Error("Custom code supports up to 12 external libraries.");
  }

  for (const library of libraries) {
    try {
      const url = new URL(library);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    } catch {
      throw new Error("External libraries must use HTTPS URLs without credentials.");
    }
  }

  return libraries;
}

export async function editContentBlock(page, blockKey) {
  const block = findBlock(page, blockKey);
  if (!block) return null;

  if (block.type === "EMBED") {
    const current = customCodeValue(block.value);
    const values = await getModalFormHandler()({
      label: "Advanced element",
      title: block.label || "Custom code",
      description: "Runs on public pages inside an isolated frame and stays paused while editing.",
      fields: withCustomCssField(block, [
        {
          name: "html",
          label: "HTML",
          type: "code",
          rows: 10,
          value: current.html,
          group: "Content"
        },
        {
          name: "javascript",
          label: "JavaScript",
          type: "code",
          rows: 9,
          value: current.javascript,
          required: false,
          group: "Settings"
        },
        {
          name: "libraries",
          label: "External library URLs",
          type: "textarea",
          rows: 4,
          value: current.libraries.join("\n"),
          required: false,
          group: "Settings",
          help: "One HTTPS script URL per line. Libraries load before the inline JavaScript."
        },
        {
          name: "height",
          label: "Frame height",
          type: "number",
          value: current.height,
          min: 120,
          max: 1200,
          step: 10,
          group: "Settings"
        },
        {
          name: "css",
          label: "Widget CSS",
          type: "code",
          rows: 9,
          value: current.css,
          required: false,
          group: "Style"
        }
      ]),
      submitLabel: "Save custom code"
    });
    if (!values) return null;
    return updatePageBlock(page.slug, block, {
      value: {
        html: values.html,
        css: values.css,
        javascript: values.javascript,
        libraries: customCodeLibraries(values.libraries),
        height: Number(values.height)
      },
      settings: cssSettingsPayload(block, values)
    });
  }

  if (block.type === "IMAGE") {
    const values = await getModalFormHandler()({
      label: "Content block",
      title: block.label || block.key,
      description: "Upload a replacement image and keep the existing image until it is changed.",
      fields: withCustomCssField(block, [
        {
          name: "file",
          label: "Image",
          type: "file",
          accept: "image/*",
          required: false,
          imagePicker: true,
          previewUrl: block.value?.url || "",
          previewAlt: block.value?.alt || block.label || "Image"
        },
        { name: "alt", label: "Alt text", value: block.value?.alt || "", required: false }
      ])
    });
    if (!values) return null;

    const file = selectedFile(values.file);
    const mediaAsset = file ? await uploadMediaFile(file, values.alt || block.value?.alt || "") : null;
    const imageUrl = mediaAsset?.url || block.value?.url;

    if (!imageUrl) {
      setStatus("Choose an image file.", true);
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

    const existingSlides = await uploadedGalleryItemFiles(values.slides?.existing, block.label || "Slider image");
    const uploadedItems = await uploadedGalleryItems(values.slides?.files, block.label || "Slider image");
    const sliderValue = sliderValueFromModal({
      ...values,
      slides: {
        ...(values.slides || {}),
        existing: existingSlides
      }
    }, block.value, uploadedItems);
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
      description: "Choose the products customers should see. Cards use live prices, stock, images, and purchase actions.",
      fields: withCustomCssField(block, await productListModalFields(block.value))
    });
    if (!values) return null;
    if (!Array.isArray(values.productSlugs) || !values.productSlugs.length) {
      setStatus("Choose at least one active product.", true);
      return null;
    }

    return updatePageBlock(page.slug, block, {
      value: productListValueFromValues(values),
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

    const file = selectedFile(values.structuredImageFile) || selectedFile(values.structuredVideoFile);
    const mediaAsset = file
      ? await uploadMediaFile(file, values.structuredImageAlt || values.structuredTitle || block.label || "")
      : null;
    const modelFile = selectedFile(values.structuredModelFile);
    const modelAsset = modelFile ? await uploadMediaFile(modelFile, values.structuredTitle || block.label || "3D model") : null;
    const itemMediaAssets = {};
    for (const mediaField of structuredEditor.mediaFields || []) {
      const itemFile = selectedFile(values[mediaField.name]);
      if (!itemFile) continue;
      itemMediaAssets[mediaField.name] = await uploadMediaFile(
        itemFile,
        values[mediaField.altName] || mediaField.fallbackAlt || block.label || ""
      );
    }

    return updatePageBlock(page.slug, block, {
      value: structuredEditor.valueFrom(values, mediaAsset, itemMediaAssets, { model: modelAsset }),
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
      locale: currentLocale(),
      priceCents: Number.isFinite(priceCents) ? priceCents : 0,
      currency: "EUR",
      stockQuantity: Number.isFinite(stockQuantity) ? stockQuantity : 0,
      status: "DRAFT"
    })
  });
  setStatus(`Draft product created: ${product.slug}`);
}

const containerLayoutOptions = [
  { value: "one-column", label: "1 column", description: "Stacked content and long-form sections." },
  { value: "two-column", label: "2 columns", description: "Image/text, forms, FAQs, and balanced content." },
  { value: "three-column", label: "3 columns", description: "Service cards, proof points, and compact grids." },
  { value: "four-column", label: "4 columns", description: "Dense cards, stats, logos, and team sections." },
  { value: "asymmetric", label: "Asymmetric", description: "Editorial split with one dominant side." },
  { value: "full-bleed", label: "Full width", description: "Wide media, hero, or immersive sections." }
];

async function siteSettingImage(formData, name, currentUrl, altText) {
  if (String(formData.get(`${name}Remove`) || "") === "true") return "";

  const file = selectedFile(formData.get(`${name}File`));
  if (!file) return String(currentUrl || "").trim();

  const asset = await uploadMediaFile(file, altText || file.name || name);
  return asset.url;
}

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
  const settingNumber = (key, fallback, minimum, maximum) => {
    const value = Number(formData.has(key) ? formData.get(key) : current[key]);
    return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.round(value))) : fallback;
  };

  setFormDisabled(form, true);
  setFormMessage(form, "Saving settings...");

  try {
    const logoAltText = settingValue("logoAltText") || settingValue("title");
    const socialImageAlt = settingValue("socialImageAlt") || settingValue("title");
    const [logoUrl, faviconUrl, socialImageUrl] = await Promise.all([
      siteSettingImage(formData, "logo", current.logoUrl, logoAltText),
      siteSettingImage(formData, "favicon", current.faviconUrl, "Browser icon"),
      siteSettingImage(formData, "socialImage", current.socialImageUrl, socialImageAlt)
    ]);
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
        logoUrl,
        logoMode: ["text", "image", "image-and-name"].includes(settingValue("logoMode"))
          ? settingValue("logoMode")
          : "text",
        logoAltText,
        logoHeight: settingNumber("logoHeight", 42, 20, 120),
        faviconUrl,
        socialImageUrl,
        socialImageAlt,
        design: designSystemFromForm(form, current.design),
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

export async function saveEmailSettings(form) {
  const formData = new FormData(form);
  const bearerToken = String(formData.get("bearerToken") || "").trim();
  const smtpPassword = String(formData.get("smtpPassword") || "").trim();
  const smtpPort = Number(formData.get("smtpPort") || 587);

  setFormDisabled(form, true);
  setFormMessage(form, "Saving email settings...");

  try {
    const response = await api("/config/email", {
      method: "PATCH",
      body: JSON.stringify({
        enabled: formData.get("enabled") === "on",
        provider: String(formData.get("provider") || "generic"),
        recoveryEnabled: formData.get("recoveryEnabled") === "on",
        from: String(formData.get("from") || "").trim(),
        httpEndpoint: String(formData.get("httpEndpoint") || "").trim(),
        ...(bearerToken ? { bearerToken } : {}),
        clearBearerToken: formData.get("clearBearerToken") === "on",
        smtpHost: String(formData.get("smtpHost") || "").trim(),
        smtpPort: Number.isInteger(smtpPort) ? smtpPort : 587,
        smtpSecurity: String(formData.get("smtpSecurity") || "starttls"),
        smtpUsername: String(formData.get("smtpUsername") || "").trim(),
        ...(smtpPassword ? { smtpPassword } : {}),
        clearSmtpPassword: formData.get("clearSmtpPassword") === "on"
      })
    });
    if (state.config && response.email) state.config.email = response.email;
    const secretInput = form.querySelector('[name="bearerToken"]');
    if (secretInput) secretInput.value = "";
    const smtpSecretInput = form.querySelector('[name="smtpPassword"]');
    if (smtpSecretInput) smtpSecretInput.value = "";
    setFormMessage(form, "Email settings saved. Test delivery before enabling recovery flows.");
    setStatus("Email settings saved.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to save email settings.", true);
  } finally {
    setFormDisabled(form, false);
    const testButton = form.querySelector("[data-test-email-settings]");
    if (testButton) testButton.disabled = state.config?.email?.configured !== true;
  }
}

export async function testEmailSettings(button) {
  const form = button.closest("[data-email-settings-form]");
  if (!form) return;

  const recipient = String(new FormData(form).get("testRecipient") || "").trim();
  setFormDisabled(form, true);
  setFormMessage(form, "Sending test email...");

  try {
    const response = await api("/config/email/test", {
      method: "POST",
      body: JSON.stringify(recipient ? { recipient } : {})
    });
    if (state.config && response.email) state.config.email = response.email;
    setFormMessage(form, response.result?.message || "Test email sent.");
    setStatus("Email delivery test passed.");
  } catch (error) {
    setFormMessage(form, error.message || "Email delivery test failed.", true);
    setStatus(error.message || "Email delivery test failed.", true);
  } finally {
    setFormDisabled(form, false);
  }
}

export async function saveStorageSettings(form) {
  const formData = new FormData(form);
  const provider = String(formData.get("provider") || "local");
  const secretAccessKey = provider === "r2"
    ? String(formData.get("r2SecretAccessKey") || "").trim()
    : String(formData.get("s3SecretAccessKey") || "").trim();
  const body = provider === "local"
    ? { provider }
    : provider === "r2"
      ? {
          provider,
          accountId: String(formData.get("r2AccountId") || "").trim(),
          bucket: String(formData.get("r2Bucket") || "").trim(),
          accessKeyId: String(formData.get("r2AccessKeyId") || "").trim(),
          ...(secretAccessKey ? { secretAccessKey } : {})
        }
      : {
          provider: "s3",
          region: String(formData.get("s3Region") || "us-east-1").trim(),
          bucket: String(formData.get("s3Bucket") || "").trim(),
          accessKeyId: String(formData.get("s3AccessKeyId") || "").trim(),
          ...(secretAccessKey ? { secretAccessKey } : {})
        };

  setFormDisabled(form, true);
  setFormMessage(form, provider === "local" ? "Checking local storage..." : "Testing storage connection...");

  try {
    const response = await api("/config/storage", {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    if (state.config && response.storage) state.config.storage = response.storage;
    form.querySelectorAll('input[type="password"]').forEach((input) => {
      input.value = "";
      input.placeholder = "Saved credential";
    });
    const copied = Number(response.migration?.copiedObjects || 0);
    setFormMessage(
      form,
      copied > 0
        ? `Storage connected. ${copied} existing media file${copied === 1 ? " was" : "s were"} copied safely.`
        : "Storage connected and saved."
    );
    setStatus("Media storage is ready.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to save storage settings.", true);
    setStatus(error.message || "Unable to save storage settings.", true);
  } finally {
    setFormDisabled(form, false);
  }
}

export async function checkRuntimeUpdate(button) {
  const panel = button.closest("[data-runtime-update-panel]");
  const message = panel?.querySelector("[data-runtime-update-message]");
  button.disabled = true;
  if (message) message.textContent = "Checking the stable release...";

  try {
    const [{ update: check }, { update: status }] = await Promise.all([
      api("/config/runtime-update/check", { method: "POST", body: JSON.stringify({}) }),
      api("/config/runtime-update")
    ]);
    const { renderRuntimeUpdatePanel } = await import("./admin-views.js");
    panel.innerHTML = renderRuntimeUpdatePanel({ ...status, check });
    setStatus(check.updateAvailable ? "A verified update is ready." : "CodeY CMS is up to date.");
  } catch (error) {
    if (message) {
      message.textContent = error.message || "Unable to check for updates.";
      message.classList.add("error");
    }
    button.disabled = false;
    setStatus(error.message || "Unable to check for updates.", true);
  }
}

export async function applyRuntimeUpdate(button) {
  const panel = button.closest("[data-runtime-update-panel]");
  const message = panel?.querySelector("[data-runtime-update-message]");
  button.disabled = true;
  if (message) message.textContent = "Verifying and staging the update...";

  try {
    const { update } = await api("/config/runtime-update/apply", {
      method: "POST",
      body: JSON.stringify({})
    });
    const { update: status } = await api("/config/runtime-update");
    const { renderRuntimeUpdatePanel } = await import("./admin-views.js");
    panel.innerHTML = renderRuntimeUpdatePanel({
      ...status,
      supervisor: update.staged
        ? { status: "staged" }
        : status.supervisor
    });
    setStatus(update.staged ? "Update staged. The protected installation is starting." : update.message);
  } catch (error) {
    if (message) {
      message.textContent = error.message || "Unable to install the update.";
      message.classList.add("error");
    }
    button.disabled = false;
    setStatus(error.message || "Unable to install the update.", true);
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
    if (state.config && response.localization) {
      setRuntimeConfig({
        ...state.config,
        localization: response.localization
      });
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
    renderSettingsPage(await api("/config/admin"));
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
      label: "Add section",
      title: "Choose a section layout",
      fields: [
        { name: "layout", label: "Layout", type: "choice", value: "one-column", options: containerLayoutOptions }
      ],
      submitLabel: "Add section"
    });
    if (!values) return;

    const key = `section-${Date.now()}`;
    const label = `Section ${state.page.sections.length + 1}`;

    const { page } = await api(`/cms/pages/${encodeURIComponent(state.page.slug)}/sections?${localeQuery()}`, {
      method: "POST",
      body: JSON.stringify({
        key,
        label,
        sortOrder: state.page.sections.length,
        settings: {
          layout: values.layout,
          gap: "md",
          responsive: {
            mobile: {
              layout: "one-column",
              spacing: "sm"
            }
          },
          template: "content"
        },
        blocks: []
      })
    });

    state.page = page;
    renderPage(page);
    setStatus("Section added.");
  } catch (error) {
    setStatus(error.message || "Unable to add section.", true);
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

      const existingSlides = await uploadedGalleryItemFiles(values.slides?.existing, "Slider image");
      block.value = sliderValueFromModal({
        ...values,
        slides: {
          ...(values.slides || {}),
          existing: existingSlides
        }
      }, block.value, await uploadedGalleryItems(values.slides?.files));
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

  try {
    setStatus("Publishing page...");
    const { page } = await api(`/cms/pages/${encodeURIComponent(state.page.slug)}/publish?${localeQuery()}`, {
      method: "POST",
      body: JSON.stringify({})
    });
    state.page = page;
    renderPage(page);
    setStatus("Page published.");
  } catch (error) {
    setStatus(error.message || "Unable to publish the page.", true);
  }
}
