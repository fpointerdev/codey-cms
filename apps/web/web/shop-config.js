export const defaultShopSettings = {
  catalogTitle: "Shop",
  catalogDescription: "Browse our products.",
  catalogLayout: "grid",
  cardStyle: "minimal",
  detailLayout: "classic",
  detailStyle: "standard",
  productsPerPage: 20,
  showCategories: true,
  showAttributes: true,
  showSku: true,
  showStock: true
};

export const shopLayoutOptions = [
  { value: "grid", label: "Grid", body: "Balanced cards for most catalogs." },
  { value: "editorial", label: "Editorial", body: "Larger images and more product story." },
  { value: "compact", label: "Compact", body: "Dense rows for bigger catalogs." }
];

export const cardStyleOptions = [
  { value: "minimal", label: "Minimal", body: "Simple cards with quiet details." },
  { value: "image-led", label: "Image led", body: "Prominent photos in framed cards." },
  { value: "technical", label: "Technical", body: "SKU and stock are easier to scan." }
];

export const detailLayoutOptions = [
  { value: "classic", label: "Classic", body: "Gallery left and product details right." },
  { value: "immersive", label: "Immersive", body: "Wide product media above the details." },
  { value: "spec-sheet", label: "Spec sheet", body: "More room for technical information." }
];

export const detailStyleOptions = [
  { value: "standard", label: "Standard", body: "Clean and flexible for any product." },
  { value: "premium", label: "Premium", body: "More whitespace and image emphasis." },
  { value: "industrial", label: "Industrial", body: "Structured and information dense." }
];

function allowed(value, options, fallback) {
  return options.some((option) => option.value === value) ? value : fallback;
}

export function normalizeShopSettings(value = {}) {
  const settings = value && typeof value === "object" ? value : {};
  const productsPerPage = Number.parseInt(String(settings.productsPerPage || defaultShopSettings.productsPerPage), 10);

  return {
    catalogTitle: String(settings.catalogTitle || defaultShopSettings.catalogTitle),
    catalogDescription: String(settings.catalogDescription ?? defaultShopSettings.catalogDescription),
    catalogLayout: allowed(settings.catalogLayout, shopLayoutOptions, defaultShopSettings.catalogLayout),
    cardStyle: allowed(settings.cardStyle, cardStyleOptions, defaultShopSettings.cardStyle),
    detailLayout: allowed(settings.detailLayout, detailLayoutOptions, defaultShopSettings.detailLayout),
    detailStyle: allowed(settings.detailStyle, detailStyleOptions, defaultShopSettings.detailStyle),
    productsPerPage: Number.isInteger(productsPerPage) ? Math.min(48, Math.max(8, productsPerPage)) : defaultShopSettings.productsPerPage,
    showCategories: settings.showCategories !== false,
    showAttributes: settings.showAttributes !== false,
    showSku: settings.showSku !== false,
    showStock: settings.showStock !== false
  };
}
