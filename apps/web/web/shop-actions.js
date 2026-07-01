import {
  api,
  moduleEnabled,
  setStatus,
  slugFromTitle,
  state
} from "./core.js";
import { adminHref } from "./routes.js";
import { optionalFormValue, selectedFiles, uploadMediaFile } from "./content-actions.js";
import { loadAdminRoute } from "./controller.js";
import { setFormDisabled, setFormMessage } from "./ui.js";

function normalizePriceCents(value) {
  const amount = Number(String(value || "0").replace(",", "."));
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function normalizeStock(value) {
  const stock = Number.parseInt(String(value || "0"), 10);
  return Number.isFinite(stock) ? Math.max(0, stock) : 0;
}

function repeaterRows(formData, prefix) {
  const names = formData.getAll(`${prefix}Name`);
  const values = formData.getAll(`${prefix}Value`);

  return names
    .map((name, index) => ({
      name: String(name || "").trim(),
      value: String(values[index] || "").trim()
    }))
    .filter((row) => row.name || row.value);
}

function attributeRows(formData) {
  return repeaterRows(formData, "attribute")
    .filter((row) => row.name && row.value)
    .map((row) => ({
      name: row.name,
      value: row.value
    }));
}

function optionRows(formData) {
  return repeaterRows(formData, "option")
    .filter((row) => row.name && row.value)
    .map((row, index) => ({
      name: row.name,
      values: row.value.split(",").map((value) => value.trim()).filter(Boolean),
      sortOrder: index
    }))
    .filter((row) => row.values.length);
}

async function uploadedProductImages(files, fallbackAlt = "") {
  const images = [];

  for (const [index, file] of selectedFiles(files).entries()) {
    const asset = await uploadMediaFile(file, fallbackAlt || file.name || "Product image");
    images.push({
      mediaAssetId: asset.id,
      url: asset.url,
      alt: fallbackAlt || asset.altText || file.name || "",
      sortOrder: index,
      isPrimary: index === 0
    });
  }

  return images;
}

async function selectedCategoryId(formData) {
  const categoryId = String(formData.get("categoryId") || "");
  if (categoryId !== "__new") return categoryId || undefined;

  const name = String(formData.get("newCategoryName") || "").trim();
  if (!name) throw new Error("Enter a name for the new category.");

  const { category } = await api("/products/categories", {
    method: "POST",
    body: JSON.stringify({
      name,
      slug: slugFromTitle(String(formData.get("newCategorySlug") || name)),
      description: "",
      sortOrder: state.shopCategories?.length || 0
    })
  });

  return category.id;
}

function productMetadataPayload(formData, existingProduct = null) {
  const existingMetadata =
    existingProduct?.metadata && typeof existingProduct.metadata === "object" ? existingProduct.metadata : {};

  return {
    ...existingMetadata,
    attributes: attributeRows(formData),
    presentation: {
      shopLayout: String(formData.get("shopLayout") || "grid"),
      cardStyle: String(formData.get("cardStyle") || "minimal"),
      detailLayout: String(formData.get("detailLayout") || "classic"),
      detailStyle: String(formData.get("detailStyle") || "standard")
    }
  };
}

async function productPayloadFromForm(form, existingProduct = null) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  const slug = slugFromTitle(String(formData.get("slug") || name));
  const imageAlt = String(formData.get("imageAlt") || name).trim();
  const images = await uploadedProductImages(formData.getAll("images"), imageAlt);

  return {
    payload: {
      categoryId: await selectedCategoryId(formData),
      name,
      slug,
      description: optionalFormValue(formData, "description"),
      sku: optionalFormValue(formData, "sku"),
      priceCents: normalizePriceCents(formData.get("price")),
      currency: String(formData.get("currency") || "EUR").toUpperCase(),
      stockQuantity: normalizeStock(formData.get("stockQuantity")),
      status: String(formData.get("status") || "DRAFT"),
      metaTitle: optionalFormValue(formData, "metaTitle"),
      metaDescription: optionalFormValue(formData, "metaDescription"),
      metadata: productMetadataPayload(formData, existingProduct),
      images,
      options: optionRows(formData)
    },
    images,
    options: optionRows(formData)
  };
}

async function addProductDetails(slug, images = [], options = []) {
  for (const image of images) {
    await api(`/products/${encodeURIComponent(slug)}/images`, {
      method: "POST",
      body: JSON.stringify(image)
    });
  }

  for (const option of options) {
    await api(`/products/${encodeURIComponent(slug)}/options`, {
      method: "POST",
      body: JSON.stringify(option)
    });
  }
}

export function createProductFromDashboard() {
  window.history.pushState({}, "", adminHref("product-create"));
  void loadAdminRoute({ view: "product-create" });
}

export function openProductEditor(productSlug) {
  if (!productSlug) {
    createProductFromDashboard();
    return;
  }

  window.history.pushState({}, "", adminHref("product-editor", productSlug));
  void loadAdminRoute({ view: "product-editor", slug: productSlug });
}

export async function saveProductEditor(form) {
  if (!moduleEnabled("products")) {
    setStatus("Products module is not enabled for this project.", true);
    return;
  }

  const existingProduct = state.shopProduct;
  const originalSlug = form.dataset.productSlug || existingProduct?.slug || "";

  setFormDisabled(form, true);
  setFormMessage(form, existingProduct ? "Saving product..." : "Creating product...");

  try {
    const { payload, images, options } = await productPayloadFromForm(form, existingProduct);
    const productData = existingProduct
      ? {
          categoryId: payload.categoryId,
          name: payload.name,
          slug: payload.slug,
          description: payload.description,
          sku: payload.sku,
          priceCents: payload.priceCents,
          currency: payload.currency,
          stockQuantity: payload.stockQuantity,
          status: payload.status,
          metadata: payload.metadata
        }
      : payload;

    const { product } = await api(existingProduct ? `/products/${encodeURIComponent(originalSlug)}` : "/products", {
      method: existingProduct ? "PATCH" : "POST",
      body: JSON.stringify(productData)
    });

    if (existingProduct) {
      await addProductDetails(product.slug, images, options);
    }

    window.history.pushState({}, "", adminHref("product-editor", product.slug));
    await loadAdminRoute({ view: "product-editor", slug: product.slug });
    setStatus(existingProduct ? "Product saved." : "Product created.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to save product.", true);
    setStatus(error.message || "Unable to save product.", true);
    setFormDisabled(form, false);
  }
}

export function addRepeaterRow(kind) {
  const list = document.querySelector(`[data-repeater-list="${kind}"]`);
  if (!list) return;

  const labels = kind === "attribute"
    ? { name: "Attribute", value: "Value", namePlaceholder: "Material", valuePlaceholder: "Stainless steel" }
    : { name: "Option", value: "Values", namePlaceholder: "Size", valuePlaceholder: "Small, Medium, Large" };
  const row = document.createElement("div");
  row.className = "repeater-row";
  row.dataset.repeaterRow = "";
  row.innerHTML = `
    <label><span>${labels.name}</span><input name="${kind}Name" placeholder="${labels.namePlaceholder}" /></label>
    <label><span>${labels.value}</span><input name="${kind}Value" placeholder="${labels.valuePlaceholder}" /></label>
    <button type="button" class="secondary-button" data-remove-repeater-row>Remove</button>
  `;
  list.append(row);
}

export function removeRepeaterRow(button) {
  const row = button?.closest?.("[data-repeater-row]");
  const list = row?.parentElement;
  if (!row || !list || list.querySelectorAll("[data-repeater-row]").length <= 1) return;

  row.remove();
}
