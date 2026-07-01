import {
  escapeHtml,
  formatMoney,
  setStatus,
  slugFromTitle,
  state
} from "./core.js";
import { adminHref } from "./routes.js";
import { renderShopShell } from "./admin-views.js";
import { renderFormMessage } from "./ui.js";

const productStatuses = ["DRAFT", "ACTIVE", "ARCHIVED"];
const currencies = ["EUR", "USD", "GBP", "CHF"];

const shopLayoutOptions = [
  { value: "grid", label: "Clean grid", body: "Balanced catalog cards for most shops." },
  { value: "editorial", label: "Editorial", body: "Larger imagery and richer product storytelling." },
  { value: "compact", label: "Compact", body: "Dense product rows for bigger catalogs." }
];

const cardStyleOptions = [
  { value: "minimal", label: "Minimal", body: "Quiet B2B catalog presentation." },
  { value: "image-led", label: "Image led", body: "Strong visual cards for premium products." },
  { value: "technical", label: "Technical", body: "SKU, stock, and specs are easier to scan." }
];

const detailLayoutOptions = [
  { value: "classic", label: "Classic detail", body: "Gallery left, product details right." },
  { value: "immersive", label: "Immersive", body: "Large media area with content sections below." },
  { value: "spec-sheet", label: "Spec sheet", body: "Optimized for attributes and technical buyers." }
];

const detailStyleOptions = [
  { value: "standard", label: "Standard", body: "Clean product page with flexible sections." },
  { value: "premium", label: "Premium", body: "More whitespace and stronger image hierarchy." },
  { value: "industrial", label: "Industrial", body: "Structured, technical, and direct." }
];

function optionHtml(options, selectedValue = "") {
  return options
    .map((option) => {
      const value = typeof option === "string" ? option : option.value;
      const label = typeof option === "string" ? option : option.label;
      return `<option value="${escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function productMetadata(product = {}) {
  return product.metadata && typeof product.metadata === "object" ? product.metadata : {};
}

function productPresentation(product = {}) {
  const metadata = productMetadata(product);
  const presentation = metadata.presentation && typeof metadata.presentation === "object" ? metadata.presentation : {};

  return {
    shopLayout: presentation.shopLayout || "grid",
    cardStyle: presentation.cardStyle || "minimal",
    detailLayout: presentation.detailLayout || "classic",
    detailStyle: presentation.detailStyle || "standard"
  };
}

function productAttributes(product = {}) {
  const metadata = productMetadata(product);
  return Array.isArray(metadata.attributes) && metadata.attributes.length
    ? metadata.attributes
    : [
        { name: "Material", value: "" },
        { name: "Finish", value: "" },
        { name: "Dimensions", value: "" }
      ];
}

function editableProductOptionRows(product = {}) {
  return product.id
    ? [{ name: "", values: [] }]
    : [
        { name: "Size", values: [] },
        { name: "Color", values: [] }
      ];
}

function existingProductOptions(product = {}) {
  return product.options?.length
    ? product.options
    : [];
}

function renderChoiceCards(name, options, selectedValue) {
  return `
    <div class="choice-card-grid">
      ${options
        .map(
          (option) => `
            <label class="choice-card">
              <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}"${option.value === selectedValue ? " checked" : ""} />
              <span>
                <strong>${escapeHtml(option.label)}</strong>
                <small>${escapeHtml(option.body)}</small>
              </span>
            </label>
          `
        )
        .join("")}
    </div>
  `;
}

function renderImageList(product = {}) {
  if (!product.images?.length) {
    return '<p class="dashboard-copy compact">Upload product photos or technical visuals. The first uploaded image becomes the primary image.</p>';
  }

  return `
    <div class="product-image-list">
      ${product.images
        .map(
          (image) => `
            <figure>
              <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || product.name || "Product image")}" />
              <figcaption>${escapeHtml(image.alt || "No description")}${image.isPrimary ? " · Primary" : ""}</figcaption>
            </figure>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRepeaterRows(items, prefix, placeholders) {
  return `
    <div class="repeater-list" data-repeater-list="${escapeHtml(prefix)}">
      ${items
        .map(
          (item) => `
            <div class="repeater-row" data-repeater-row>
              <label><span>${escapeHtml(placeholders.nameLabel)}</span><input name="${escapeHtml(prefix)}Name" value="${escapeHtml(item.name || "")}" placeholder="${escapeHtml(placeholders.name)}" /></label>
              <label><span>${escapeHtml(placeholders.valueLabel)}</span><input name="${escapeHtml(prefix)}Value" value="${escapeHtml(Array.isArray(item.values) ? item.values.join(", ") : item.value || "")}" placeholder="${escapeHtml(placeholders.value)}" /></label>
              <button type="button" class="secondary-button" data-remove-repeater-row>Remove</button>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderExistingOptionList(product = {}) {
  const options = existingProductOptions(product);
  if (!options.length) return "";

  return `
    <div class="existing-option-list">
      ${options
        .map(
          (option) => `
            <div>
              <strong>${escapeHtml(option.name)}</strong>
              <span>${escapeHtml((option.values || []).join(", ") || "No values")}</span>
            </div>
          `
        )
        .join("")}
    </div>
    <p class="dashboard-copy compact">Existing options are shown for reference. Add new options below when needed.</p>
  `;
}

function categoryOptions(categories = [], selectedCategoryId = "") {
  return [
    '<option value="">No category</option>',
    ...categories.map(
      (category) => `<option value="${escapeHtml(category.id)}"${category.id === selectedCategoryId ? " selected" : ""}>${escapeHtml(category.name)}</option>`
    ),
    '<option value="__new">Create new category</option>'
  ].join("");
}

export function renderProductEditorPage({ product = null, categories = [], message = "" } = {}) {
  const isNew = !product;
  state.shopProduct = product;
  state.shopCategories = categories;
  const presentation = productPresentation(product || {});
  const title = isNew ? "Create Product" : product.name;
  const slug = product?.slug || slugFromTitle(product?.name || "new-product");

  renderShopShell(
    isNew ? "product-create" : "product-editor",
    `
      <form class="product-editor-shell" data-product-editor-form data-product-slug="${escapeHtml(product?.slug || "")}">
        <section class="builder-topbar product-editor-topbar">
          <div>
            <p class="section-label">${isNew ? "New product" : "Product editor"}</p>
            <h1 class="dashboard-title">${escapeHtml(title)}</h1>
            <p class="dashboard-copy">Create a product with media, category, attributes, and storefront presentation settings in one focused editor.</p>
          </div>
          <div class="button-row">
            <a class="secondary-button" href="${escapeHtml(adminHref("shop-products"))}" data-dashboard-link>Products</a>
            <button type="submit">${isNew ? "Create product" : "Save product"}</button>
          </div>
        </section>
        ${message ? `<p class="form-message">${escapeHtml(message)}</p>` : ""}
        <div class="product-editor-grid">
          <main class="product-editor-main">
            <section class="builder-card">
              <div class="builder-card-heading">
                <div><p class="section-label">Product</p><h2>Identity and pricing</h2></div>
                <span class="status-pill">${escapeHtml(product?.status || "DRAFT")}</span>
              </div>
              <div class="builder-form-grid">
                <label><span>Name</span><input name="name" value="${escapeHtml(product?.name || "New product")}" required /></label>
                <label><span>Slug</span><input name="slug" value="${escapeHtml(slug)}" required /></label>
                <label><span>SKU</span><input name="sku" value="${escapeHtml(product?.sku || "")}" placeholder="SKU-001" /></label>
                <label><span>Category</span><select name="categoryId">${categoryOptions(categories, product?.categoryId || "")}</select></label>
              </div>
              <div class="builder-form-grid">
                <label><span>New category name</span><input name="newCategoryName" placeholder="Railings" /></label>
                <label><span>New category slug</span><input name="newCategorySlug" placeholder="railings" /></label>
              </div>
              <label><span>Description</span><textarea name="description" rows="5">${escapeHtml(product?.description || "")}</textarea></label>
              <div class="builder-form-grid">
                <label><span>Price</span><input name="price" type="number" min="0" step="0.01" value="${escapeHtml(product ? (product.priceCents / 100).toFixed(2) : "10.00")}" required /></label>
                <label><span>Currency</span><select name="currency">${optionHtml(currencies, product?.currency || "EUR")}</select></label>
                <label><span>Stock</span><input name="stockQuantity" type="number" min="0" step="1" value="${escapeHtml(product?.stockQuantity ?? 10)}" required /></label>
                <label><span>Status</span><select name="status">${optionHtml(productStatuses, product?.status || "DRAFT")}</select></label>
              </div>
            </section>

            <section class="builder-card">
              <div class="builder-card-heading">
                <div><p class="section-label">SEO</p><h2>Search preview</h2></div>
              </div>
              <label><span>Meta title</span><input name="metaTitle" value="${escapeHtml(product?.metaTitle || product?.name || "")}" maxlength="180" /></label>
              <label><span>Meta description</span><textarea name="metaDescription" rows="3" maxlength="300">${escapeHtml(product?.metaDescription || product?.description || "")}</textarea></label>
            </section>

            <section class="builder-card">
              <div class="builder-card-heading">
                <div><p class="section-label">Media</p><h2>Product images</h2></div>
              </div>
              ${renderImageList(product || {})}
              <label class="product-upload-box">
                <span>${isNew ? "Upload images" : "Add more images"}</span>
                <input name="images" type="file" accept="image/*" multiple data-file-preview-input />
                <small class="field-help">Use clear product images, drawings, or detail photos. Keep files optimized for the web.</small>
                <div class="file-preview-list" data-file-preview></div>
              </label>
              <label><span>Default image description</span><input name="imageAlt" value="${escapeHtml(product?.images?.[0]?.alt || product?.name || "")}" placeholder="Describe what appears in the product images" /></label>
            </section>

            <section class="builder-card">
              <div class="builder-card-heading">
                <div><p class="section-label">Attributes</p><h2>Technical details</h2></div>
                <button type="button" class="secondary-button" data-add-repeater-row="attribute">Add attribute</button>
              </div>
              ${renderRepeaterRows(productAttributes(product || {}), "attribute", {
                nameLabel: "Attribute",
                valueLabel: "Value",
                name: "Material",
                value: "Stainless steel"
              })}
            </section>

            <section class="builder-card">
              <div class="builder-card-heading">
                <div><p class="section-label">Options</p><h2>Variation options</h2></div>
                <button type="button" class="secondary-button" data-add-repeater-row="option">Add option</button>
              </div>
              ${renderExistingOptionList(product || {})}
              ${renderRepeaterRows(editableProductOptionRows(product || {}), "option", {
                nameLabel: "Option",
                valueLabel: "Values",
                name: "Size",
                value: "Small, Medium, Large"
              })}
            </section>
          </main>

          <aside class="product-editor-side">
            <section class="builder-card">
              <div class="builder-card-heading">
                <div><p class="section-label">Catalog page</p><h2>Listing style</h2></div>
              </div>
              <label><span>Shop page layout</span>${renderChoiceCards("shopLayout", shopLayoutOptions, presentation.shopLayout)}</label>
              <label><span>Product card style</span>${renderChoiceCards("cardStyle", cardStyleOptions, presentation.cardStyle)}</label>
            </section>
            <section class="builder-card">
              <div class="builder-card-heading">
                <div><p class="section-label">Product page</p><h2>Detail style</h2></div>
              </div>
              <label><span>Detail layout</span>${renderChoiceCards("detailLayout", detailLayoutOptions, presentation.detailLayout)}</label>
              <label><span>Detail style</span>${renderChoiceCards("detailStyle", detailStyleOptions, presentation.detailStyle)}</label>
            </section>
            <section class="builder-card product-editor-summary">
              <p class="section-label">Current value</p>
              <strong>${escapeHtml(formatMoney(product?.priceCents ?? 1000, product?.currency || "EUR"))}</strong>
              <span>${escapeHtml(product?.stockQuantity ?? 10)} units in stock</span>
            </section>
          </aside>
        </div>
        ${renderFormMessage()}
      </form>
    `
  );
  setStatus(isNew ? "Product editor loaded." : `Editing ${product.name}.`);
}
