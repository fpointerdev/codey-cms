import {
  api,
  moduleEnabled,
  setStatus,
  slugFromTitle,
  state
} from "./core.js";
import { adminHref, currentLocale } from "./routes.js";
import { optionalFormValue, selectedFiles, uploadMediaFile } from "./content-actions.js";
import { loadAdminRoute } from "./controller.js";
import { getModalFormHandler } from "./modal.js";
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

function activeRouteLocale() {
  const activeQueryLocale = new URLSearchParams(window.location.search || "").get("locale");
  if (activeQueryLocale) return currentLocale();

  return state.config?.localization?.defaultLocale || currentLocale();
}

function activeProductLocale() {
  return state.shopProduct?.locale || activeRouteLocale();
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
  const localeCode = String(locale || "").trim().toLowerCase();
  if (shouldIncludeLocale(localeCode)) params.set("locale", localeCode);
  const query = params.toString();

  return query ? `${path}?${query}` : path;
}

function adminHrefWithLocale(view, slug, locale) {
  return withLocale(adminHref(view, slug), locale);
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

async function selectedCategoryId(formData, locale) {
  const categoryId = String(formData.get("categoryId") || "");
  if (categoryId !== "__new") return categoryId || undefined;

  const name = String(formData.get("newCategoryName") || "").trim();
  if (!name) throw new Error("Enter a name for the new category.");

  const { category } = await api(withLocale("/products/categories", locale), {
    method: "POST",
    body: JSON.stringify({
      name,
      slug: slugFromTitle(String(formData.get("newCategorySlug") || name)),
      locale,
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
    purchaseMode: String(formData.get("purchaseMode") || "buy") === "quote" ? "quote" : "buy",
    attributes: attributeRows(formData)
  };
}

async function productPayloadFromForm(form, existingProduct = null, formData = new FormData(form)) {
  const name = String(formData.get("name") || "").trim();
  const slug = slugFromTitle(String(formData.get("slug") || name));
  const locale = activeProductLocale();
  const imageAlt = String(formData.get("imageAlt") || name).trim();
  const images = await uploadedProductImages(formData.getAll("images"), imageAlt);

  return {
    payload: {
      categoryId: await selectedCategoryId(formData, locale),
      name,
      slug,
      locale,
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

async function addProductDetails(slug, images = [], options = [], locale = activeProductLocale()) {
  for (const image of images) {
    await api(withLocale(`/products/${encodeURIComponent(slug)}/images`, locale), {
      method: "POST",
      body: JSON.stringify(image)
    });
  }

  for (const option of options) {
    await api(withLocale(`/products/${encodeURIComponent(slug)}/options`, locale), {
      method: "POST",
      body: JSON.stringify(option)
    });
  }
}

export function createProductFromDashboard() {
  window.history.pushState({}, "", adminHrefWithLocale("product-create", "", activeRouteLocale()));
  void loadAdminRoute({ view: "product-create" });
}

export function openProductEditor(productSlug) {
  if (!productSlug) {
    createProductFromDashboard();
    return;
  }

  window.history.pushState({}, "", adminHrefWithLocale("product-editor", productSlug, activeRouteLocale()));
  void loadAdminRoute({ view: "product-editor", slug: productSlug });
}

export async function saveProductEditor(form) {
  if (!moduleEnabled("products")) {
    setStatus("Products module is not enabled for this project.", true);
    return;
  }

  const existingProduct = state.shopProduct;
  const originalSlug = form.dataset.productSlug || existingProduct?.slug || "";
  const formData = new FormData(form);

  setFormDisabled(form, true);
  setFormMessage(form, existingProduct ? "Saving product..." : "Creating product...");

  try {
    const { payload, images, options } = await productPayloadFromForm(form, existingProduct, formData);
    const locale = payload.locale || activeProductLocale();
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
          metaTitle: payload.metaTitle,
          metaDescription: payload.metaDescription,
          metadata: payload.metadata
        }
      : payload;

    const { product } = await api(withLocale(existingProduct ? `/products/${encodeURIComponent(originalSlug)}` : "/products", locale), {
      method: existingProduct ? "PATCH" : "POST",
      body: JSON.stringify(productData)
    });

    if (existingProduct) {
      await addProductDetails(product.slug, images, options, product.locale || locale);
    }

    window.history.pushState({}, "", adminHrefWithLocale("product-editor", product.slug, product.locale || locale));
    await loadAdminRoute({ view: "product-editor", slug: product.slug });
    setStatus(existingProduct ? "Product saved." : "Product created.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to save product.", true);
    setStatus(error.message || "Unable to save product.", true);
    setFormDisabled(form, false);
  }
}

function shopSettingsPayload(form) {
  const formData = new FormData(form);

  return {
    catalogTitle: String(formData.get("catalogTitle") || "Shop").trim(),
    catalogDescription: String(formData.get("catalogDescription") || "").trim(),
    catalogLayout: String(formData.get("catalogLayout") || "grid"),
    cardStyle: String(formData.get("cardStyle") || "minimal"),
    detailLayout: String(formData.get("detailLayout") || "classic"),
    detailStyle: String(formData.get("detailStyle") || "standard"),
    productsPerPage: Math.min(48, Math.max(8, Number.parseInt(String(formData.get("productsPerPage") || "20"), 10) || 20)),
    showCategories: formData.has("showCategories"),
    showAttributes: formData.has("showAttributes"),
    showSku: formData.has("showSku"),
    showStock: formData.has("showStock")
  };
}

export function updateShopSettingsPreview(form) {
  const preview = form?.querySelector?.("[data-shop-preview]");
  if (!preview) return;

  const settings = shopSettingsPayload(form);
  preview.dataset.catalogLayout = settings.catalogLayout;
  preview.dataset.cardStyle = settings.cardStyle;
  preview.querySelector("[data-shop-preview-title]").textContent = settings.catalogTitle;
  preview.querySelector("[data-shop-preview-description]").textContent = settings.catalogDescription;
  preview.querySelectorAll("[data-shop-preview-sku]").forEach((element) => {
    element.hidden = !settings.showSku;
  });
  preview.querySelectorAll("[data-shop-preview-stock]").forEach((element) => {
    element.hidden = !settings.showStock;
  });
  const filters = preview.querySelector("[data-shop-preview-filters]");
  if (filters) filters.hidden = !settings.showCategories && !settings.showAttributes;
}

export async function saveShopSettings(form) {
  setFormDisabled(form, true);
  setFormMessage(form, "Saving storefront...");

  try {
    await api("/products/settings", {
      method: "PATCH",
      body: JSON.stringify(shopSettingsPayload(form))
    });
    setFormMessage(form, "Storefront saved.");
    setStatus("Storefront customization saved.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to save storefront.", true);
    setStatus(error.message || "Unable to save storefront.", true);
  } finally {
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

function paymentProviderPayload(form) {
  const formData = new FormData(form);
  const provider = form.dataset.paymentProviderForm;
  const payload = {
    enabled: formData.has("enabled")
  };

  if (provider !== "MANUAL") payload.mode = String(formData.get("mode") || "SANDBOX");

  for (const field of ["publishableKey", "clientId", "webhookId", "instructions"]) {
    if (form.querySelector(`[name="${field}"]`)) {
      payload[field] = String(formData.get(field) || "").trim();
    }
  }

  for (const field of ["secretKey", "webhookSecret", "clientSecret"]) {
    const value = String(formData.get(field) || "").trim();
    if (value) payload[field] = value;
  }

  for (const field of ["clearSecretKey", "clearWebhookSecret", "clearClientSecret"]) {
    if (formData.has(field)) payload[field] = true;
  }

  const credentialsChanged = provider !== "MANUAL" && (
    payload.mode !== form.dataset.currentMode ||
    payload.publishableKey !== undefined && payload.publishableKey !== form.dataset.currentPublicKey ||
    payload.clientId !== undefined && payload.clientId !== form.dataset.currentClientId ||
    payload.webhookId !== undefined && payload.webhookId !== form.dataset.currentWebhookId ||
    Boolean(payload.secretKey || payload.webhookSecret || payload.clientSecret) ||
    Boolean(payload.clearSecretKey || payload.clearWebhookSecret || payload.clearClientSecret)
  );

  if (credentialsChanged && payload.enabled) payload.enabled = false;

  return { provider, payload, credentialsChanged };
}

async function persistPaymentProvider({ provider, payload, credentialsChanged }) {
  if (!provider) throw new Error("Payment provider is missing.");

  await api(`/payments/providers/${provider.toLowerCase()}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });

  return { provider, credentialsChanged };
}

export async function savePaymentProvider(form) {
  const submission = paymentProviderPayload(form);
  setFormDisabled(form, true);
  setFormMessage(form, "Saving payment settings...");

  try {
    const { provider, credentialsChanged } = await persistPaymentProvider(submission);
    await loadAdminRoute({ view: "shop-configuration" });
    setStatus(
      credentialsChanged && provider !== "MANUAL"
        ? `${provider} credentials saved. The provider was disabled until it is tested again.`
        : `${provider} payment settings saved.`
    );
  } catch (error) {
    setFormMessage(form, error.message || "Unable to save payment settings.", true);
    setStatus(error.message || "Unable to save payment settings.", true);
    setFormDisabled(form, false);
  }
}

export async function testPaymentProvider(button) {
  const form = button?.closest?.("[data-payment-provider-form]");
  if (!form) return;
  const submission = paymentProviderPayload(form);

  setFormDisabled(form, true);
  setFormMessage(form, "Saving and testing provider connection...");

  try {
    const { provider } = await persistPaymentProvider(submission);
    const result = await api(`/payments/providers/${provider.toLowerCase()}/test`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await loadAdminRoute({ view: "shop-configuration" });
    setStatus(result.message || `${provider} connection test passed.`);
  } catch (error) {
    setFormMessage(form, error.message || "Provider connection test failed.", true);
    setStatus(error.message || "Provider connection test failed.", true);
    setFormDisabled(form, false);
  }
}

export async function copyPaymentWebhook(button) {
  const value = button?.dataset?.copyPaymentWebhook || "";
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
    setStatus("Webhook endpoint copied.");
  } catch {
    const input = button.closest(".payment-webhook-copy")?.querySelector("input");
    input?.select?.();
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    setStatus(copied ? "Webhook endpoint copied." : "Unable to copy the webhook endpoint.", !copied);
  }
}

export async function updateManualPayment(button) {
  const paymentId = button?.dataset?.paymentId;
  const action = button?.dataset?.manualPaymentAction;
  if (!paymentId || !["SUCCEED", "FAIL", "REFUND"].includes(action)) return;

  const labels = {
    SUCCEED: "mark this payment paid",
    FAIL: "mark this payment failed and release reserved inventory",
    REFUND: "mark this payment and order refunded"
  };
  const confirmation = await getModalFormHandler()({
    label: "Manual payment",
    title: "Confirm payment change",
    description: `Are you sure you want to ${labels[action]}?`,
    fields: [],
    submitLabel: "Confirm change",
    destructive: true
  });
  if (!confirmation) return;

  button.disabled = true;
  try {
    await api(`/payments/manual/${encodeURIComponent(paymentId)}/action`, {
      method: "POST",
      body: JSON.stringify({ action })
    });
    await loadAdminRoute({ view: "shop-orders" });
    setStatus("Manual payment updated.");
  } catch (error) {
    button.disabled = false;
    setStatus(error.message || "Unable to update manual payment.", true);
  }
}

export async function updateOrderStatus(button) {
  const orderId = button?.dataset?.orderId;
  const status = button?.dataset?.orderStatusAction;
  if (!orderId || !["CANCELLED", "FULFILLED"].includes(status)) return;

  const fulfilment = status === "FULFILLED";
  const confirmation = await getModalFormHandler()({
    label: fulfilment ? "Fulfillment" : "Order",
    title: fulfilment ? "Mark order fulfilled?" : "Cancel this order?",
    description: fulfilment
      ? "The customer will be notified that the order is fulfilled."
      : "Reserved stock will be returned and the customer will be notified.",
    fields: [],
    submitLabel: fulfilment ? "Mark fulfilled" : "Cancel order",
    destructive: !fulfilment
  });
  if (!confirmation) return;

  button.disabled = true;
  try {
    await api(`/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await loadAdminRoute({ view: "shop-orders" });
    setStatus(fulfilment ? "Order marked fulfilled." : "Order cancelled and stock restored.");
  } catch (error) {
    button.disabled = false;
    setStatus(error.message || "Unable to update order.", true);
  }
}

export async function retryOrderEmail(button) {
  const notificationId = button?.dataset?.orderEmailRetry;
  if (!notificationId) return;

  button.disabled = true;
  try {
    await api(`/orders/notifications/${encodeURIComponent(notificationId)}/retry`, {
      method: "POST"
    });
    await loadAdminRoute({ view: "shop-orders" });
    setStatus("Order email queued for delivery.");
  } catch (error) {
    button.disabled = false;
    setStatus(error.message || "Unable to retry the order email.", true);
  }
}

export async function handleCustomerDataAction(button) {
  const action = button?.dataset?.customerDataAction;
  if (!["export", "anonymize"].includes(action)) return;
  const destructive = action === "anonymize";
  const values = await getModalFormHandler()({
    label: "Customer data",
    title: destructive ? "Anonymize customer data?" : "Export customer data",
    description: destructive
      ? "Personal data will be removed permanently. Financial totals and order history will be preserved."
      : "Download the customer records stored by this shop.",
    fields: [
      {
        name: "email",
        label: "Customer email",
        type: "email",
        help: destructive ? "This action cannot be undone." : "Email matching is case-insensitive."
      }
    ],
    submitLabel: destructive ? "Anonymize data" : "Download export",
    destructive
  });
  if (!values?.email) return;

  button.disabled = true;
  try {
    const response = await api(`/orders/customers/${action}`, {
      method: "POST",
      body: JSON.stringify({
        email: String(values.email).trim(),
        ...(destructive ? { confirmation: "ANONYMIZE" } : {})
      })
    });
    if (destructive) {
      await loadAdminRoute({ view: "shop-orders" });
      setStatus(`${response.ordersAnonymized} orders anonymized.`);
      return;
    }

    const blob = new Blob([`${JSON.stringify(response.customerData, null, 2)}\n`], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `codey-customer-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Customer data export downloaded.");
  } catch (error) {
    setStatus(error.message || `Unable to ${action} customer data.`, true);
  } finally {
    button.disabled = false;
  }
}

function commaSeparatedCountries(value) {
  const countries = [...new Set(String(value || "").split(",").map((country) => country.trim().toUpperCase()).filter(Boolean))];
  if (!countries.length || countries.some((country) => !/^[A-Z]{2}$/.test(country))) {
    throw new Error("Use two-letter country codes separated by commas, for example DE, FR, IT.");
  }
  return countries;
}

export async function saveCommerceRule(form) {
  const type = form?.dataset?.commerceRuleForm;
  if (!type) return;
  const formData = new FormData(form);
  setFormDisabled(form, true);
  setFormMessage(form, "Saving...");

  try {
    if (type === "shipping") {
      const zoneResponse = await api("/orders/shipping/zones", {
        method: "POST",
        body: JSON.stringify({
          name: String(formData.get("name") || "").trim(),
          countries: commaSeparatedCountries(formData.get("countries")),
          active: true
        })
      });
      try {
        await api(`/orders/shipping/zones/${encodeURIComponent(zoneResponse.zone.id)}/rates`, {
          method: "POST",
          body: JSON.stringify({
            name: String(formData.get("rateName") || "").trim(),
            minSubtotalCents: 0,
            priceCents: normalizePriceCents(formData.get("price")),
            active: true,
            sortOrder: 0
          })
        });
      } catch (error) {
        await api(`/orders/shipping/zones/${encodeURIComponent(zoneResponse.zone.id)}`, { method: "DELETE" }).catch(() => undefined);
        throw error;
      }
    } else if (type === "tax") {
      const country = String(formData.get("country") || "").trim().toUpperCase();
      await api("/orders/tax-rules", {
        method: "POST",
        body: JSON.stringify({
          name: String(formData.get("name") || "").trim(),
          country: country || undefined,
          rateBps: Math.round(Number(formData.get("rate") || 0) * 100),
          active: true,
          priority: 0
        })
      });
    } else if (type === "coupon") {
      const discountType = String(formData.get("discountType") || "PERCENTAGE");
      const minimum = String(formData.get("minSubtotal") || "").trim();
      const usageLimit = String(formData.get("usageLimit") || "").trim();
      await api("/orders/coupons", {
        method: "POST",
        body: JSON.stringify({
          code: String(formData.get("code") || "").trim().toUpperCase(),
          discountType,
          amount: discountType === "FIXED"
            ? normalizePriceCents(formData.get("amount"))
            : Math.round(Number(formData.get("amount") || 0)),
          currency: discountType === "FIXED" ? String(formData.get("currency") || "EUR") : undefined,
          minSubtotalCents: minimum ? normalizePriceCents(minimum) : undefined,
          usageLimit: usageLimit ? Number.parseInt(usageLimit, 10) : undefined,
          active: true
        })
      });
    }

    await loadAdminRoute({ view: "shop-configuration" });
    setStatus("Commerce rule saved.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to save commerce rule.", true);
    setStatus(error.message || "Unable to save commerce rule.", true);
    setFormDisabled(form, false);
  }
}

export async function deleteCommerceRule(button) {
  const type = button?.dataset?.deleteCommerceRule;
  const id = button?.dataset?.commerceRuleId;
  const paths = {
    shipping: "/orders/shipping/zones",
    tax: "/orders/tax-rules",
    coupon: "/orders/coupons"
  };
  if (!id || !paths[type]) return;

  const confirmation = await getModalFormHandler()({
    label: "Commerce rule",
    title: "Remove this rule?",
    description: "New checkouts will stop using it immediately. Existing orders are unchanged.",
    fields: [],
    submitLabel: "Remove rule",
    destructive: true
  });
  if (!confirmation) return;

  button.disabled = true;
  try {
    await api(`${paths[type]}/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadAdminRoute({ view: "shop-configuration" });
    setStatus("Commerce rule removed.");
  } catch (error) {
    button.disabled = false;
    setStatus(error.message || "Unable to remove commerce rule.", true);
  }
}
