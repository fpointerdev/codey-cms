import {
  escapeHtml,
  formatMoney,
  setStatus,
  state
} from "./core.js";
import { adminHref } from "./routes.js";
import { renderShopShell } from "./admin-views.js";
import { renderFormMessage } from "./ui.js";

const productStatuses = ["DRAFT", "ACTIVE", "ARCHIVED"];
const currencies = ["EUR", "USD", "GBP", "CHF"];

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

function productPurchaseMode(product = {}) {
  return productMetadata(product).purchaseMode === "quote" ? "quote" : "buy";
}

function productAttributes(product = {}) {
  const metadata = productMetadata(product);
  return Array.isArray(metadata.attributes) && metadata.attributes.length
    ? metadata.attributes
    : [{ name: "", value: "" }];
}

function editableProductOptionRows() {
  return [{ name: "", values: [] }];
}

function existingProductOptions(product = {}) {
  return product.options?.length
    ? product.options
    : [];
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
  const title = isNew ? "Create Product" : product.name;
  const slug = product?.slug || "";

  renderShopShell(
    isNew ? "product-create" : "product-editor",
    `
      <form class="product-editor-shell" data-product-editor-form data-product-slug="${escapeHtml(product?.slug || "")}" data-purchase-mode="${escapeHtml(productPurchaseMode(product || {}))}">
        <section class="builder-topbar product-editor-topbar">
          <div>
            <p class="section-label">${isNew ? "New product" : "Product editor"}</p>
            <h1 class="dashboard-title">${escapeHtml(title)}</h1>
            <p class="dashboard-copy">Add the product essentials first. Inventory, search, attributes, and options stay available when you need them.</p>
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
                <div><p class="section-label">Essentials</p><h2>Product details</h2></div>
                <span class="status-pill">${escapeHtml(product?.status || "DRAFT")}</span>
              </div>
              <label class="product-name-field"><span>Name</span><input name="name" value="${escapeHtml(product?.name || "")}" placeholder="Product name" data-title-source required /></label>
              <label><span>Description</span><textarea name="description" rows="5" placeholder="What should customers know about this product?">${escapeHtml(product?.description || "")}</textarea></label>
              <div class="builder-form-grid">
                <label data-product-buy-field><span>Price</span><input name="price" type="number" min="0" step="0.01" value="${escapeHtml(product ? (product.priceCents / 100).toFixed(2) : "0.00")}" required /></label>
                <label data-product-buy-field><span>Stock</span><input name="stockQuantity" type="number" min="0" step="1" value="${escapeHtml(product?.stockQuantity ?? 0)}" required /></label>
                <label><span>Category</span><select name="categoryId" data-product-category-select>${categoryOptions(categories, product?.categoryId || "")}</select></label>
              </div>
              <fieldset class="choice-card-grid product-purchase-mode">
                <legend>Customer action</legend>
                <label class="choice-card">
                  <input type="radio" name="purchaseMode" value="buy" ${productPurchaseMode(product || {}) === "buy" ? "checked" : ""} />
                  <span><strong>Buy online</strong><small>Add to cart and continue through checkout.</small></span>
                </label>
                <label class="choice-card">
                  <input type="radio" name="purchaseMode" value="quote" ${productPurchaseMode(product || {}) === "quote" ? "checked" : ""} />
                  <span><strong>Request a quote</strong><small>Collect a qualified inquiry for custom or high-value work.</small></span>
                </label>
              </fieldset>
              <div class="builder-form-grid product-new-category-fields" data-new-category-fields hidden>
                <label><span>New category name</span><input name="newCategoryName" placeholder="Railings" /></label>
                <label><span>New category slug</span><input name="newCategorySlug" placeholder="railings" /></label>
              </div>
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

            <details class="product-editor-disclosure">
              <summary><span><strong>Inventory and identifiers</strong><small>Currency, SKU, and product URL</small></span><span aria-hidden="true">+</span></summary>
              <div class="product-editor-disclosure-body builder-form-grid">
                <label><span>Currency</span><select name="currency">${optionHtml(currencies, product?.currency || "EUR")}</select></label>
                <label><span>SKU</span><input name="sku" value="${escapeHtml(product?.sku || "")}" placeholder="SKU-001" /></label>
                <label><span>Slug</span><input name="slug" value="${escapeHtml(slug)}" placeholder="Generated from product name" data-slug-target /></label>
              </div>
            </details>

            <details class="product-editor-disclosure">
              <summary><span><strong>Search and sharing</strong><small>Optional title and description for search engines</small></span><span aria-hidden="true">+</span></summary>
              <div class="product-editor-disclosure-body">
                <label><span>Meta title</span><input name="metaTitle" value="${escapeHtml(product?.metaTitle || "")}" maxlength="180" placeholder="Uses the product name when empty" /></label>
                <label><span>Meta description</span><textarea name="metaDescription" rows="3" maxlength="300" placeholder="Uses the product description when empty">${escapeHtml(product?.metaDescription || "")}</textarea></label>
              </div>
            </details>

            <details class="product-editor-disclosure">
              <summary><span><strong>Technical attributes</strong><small>Material, dimensions, finish, and other specifications</small></span><span aria-hidden="true">+</span></summary>
              <div class="product-editor-disclosure-body">
                <div class="builder-card-heading compact-heading"><span></span><button type="button" class="secondary-button" data-add-repeater-row="attribute">Add attribute</button></div>
                ${renderRepeaterRows(productAttributes(product || {}), "attribute", {
                  nameLabel: "Attribute",
                  valueLabel: "Value",
                  name: "Material",
                  value: "Stainless steel"
                })}
              </div>
            </details>

            <details class="product-editor-disclosure">
              <summary><span><strong>Product options</strong><small>Sizes, colors, and other customer choices</small></span><span aria-hidden="true">+</span></summary>
              <div class="product-editor-disclosure-body">
                <div class="builder-card-heading compact-heading"><span></span><button type="button" class="secondary-button" data-add-repeater-row="option">Add option</button></div>
                ${renderExistingOptionList(product || {})}
                ${renderRepeaterRows(editableProductOptionRows(), "option", {
                  nameLabel: "Option",
                  valueLabel: "Values",
                  name: "Size",
                  value: "Small, Medium, Large"
                })}
              </div>
            </details>
          </main>

          <aside class="product-editor-side">
            <section class="builder-card product-publish-card">
              <div class="builder-card-heading">
                <div><p class="section-label">Visibility</p><h2>Publish</h2></div>
              </div>
              <label><span>Status</span><select name="status">${optionHtml(productStatuses, product?.status || "DRAFT")}</select></label>
              <p class="dashboard-copy compact">Draft products stay private. Active products appear in the public shop.</p>
              <div class="product-editor-summary">
                <p class="section-label">Current value</p>
                <strong>${escapeHtml(formatMoney(product?.priceCents ?? 0, product?.currency || "EUR"))}</strong>
                <span>${escapeHtml(product?.stockQuantity ?? 0)} units in stock</span>
              </div>
              <button type="submit">${isNew ? "Create product" : "Save product"}</button>
            </section>
          </aside>
        </div>
        ${renderFormMessage()}
      </form>
    `
  );
  setStatus(isNew ? "Product editor loaded." : `Editing ${product.name}.`);
}
