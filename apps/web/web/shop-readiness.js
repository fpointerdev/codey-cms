export function productPurchaseMode(product = {}) {
  return product.metadata?.purchaseMode === "quote" ? "quote" : "buy";
}

export function productAvailableStock(product = {}) {
  const variants = Array.isArray(product.variants) ? product.variants.filter((variant) => variant.active !== false) : [];
  const available = (item) => Math.max(0, Number(item.availableStock ??
    Number(item.stockQuantity || 0) - Number(item.reservedQuantity || 0)) || 0);
  return variants.length ? variants.reduce((total, variant) => total + available(variant), 0) : available(product);
}

export function commerceReadiness(products = [], commerce = {}, errorMessage = "") {
  const active = products.filter((product) => product.status === "ACTIVE");
  const buy = active.filter((product) => productPurchaseMode(product) === "buy");
  const incomplete = active.filter((product) => !product.name || !product.images?.length ||
    productPurchaseMode(product) === "buy" && (Number(product.priceCents || 0) <= 0 || productAvailableStock(product) <= 0));
  const providers = (commerce.providers || []).filter((provider) => provider.enabled !== false);
  const online = providers.filter((provider) => ["STRIPE", "PAYPAL"].includes(provider.provider));
  const live = online.some((provider) => provider.mode === "LIVE");
  const test = online.some((provider) => provider.mode === "SANDBOX");
  const manual = providers.some((provider) => provider.provider === "MANUAL");
  const unknown = providers.some((provider) => provider.provider !== "MANUAL" &&
    (!["STRIPE", "PAYPAL"].includes(provider.provider) || !["LIVE", "SANDBOX"].includes(provider.mode)));
  const mode = errorMessage || unknown ? "unknown"
    : !active.length ? "empty"
    : !buy.length ? "quote"
    : test && (live || manual) ? "mixed"
    : live ? "live" : test ? "test" : manual ? "manual" : "catalog";
  const titles = {
    unknown: "Shop status unavailable", empty: "Add your first product", quote: "Quote catalog",
    mixed: "Test and real payment methods are enabled", live: "Live checkout configured",
    test: "Test checkout only", manual: "Manual payment configured", catalog: "Catalog only"
  };
  const messages = {
    unknown: "Payment or catalog data could not be verified. Refresh before relying on this status.",
    empty: "No active products are available.",
    quote: "Customers can request a quote. No online payment is required.",
    mixed: "Disable test methods before accepting real orders. Test payments do not collect money.",
    live: "Live credentials are enabled. Complete a real order and verify payment, email, and fulfillment before launch.",
    test: "Sandbox payments do not collect money. Switch to tested live credentials before selling.",
    manual: "Payments are collected outside the website and must be confirmed by the store owner.",
    catalog: "Products are visible, but no usable payment method is enabled."
  };
  const checks = [
    { complete: active.length > 0, label: "Visible products", detail: `${active.length} active products checked`, href: "/dashboard/shop/products" },
    { complete: active.length > 0 && !incomplete.length, label: "Product details", detail: incomplete.length ? `${incomplete.length} checked products need an image, price, or available stock` : "Checked products have their required catalog details", href: "/dashboard/shop/products" },
    { complete: ["live", "manual", "quote"].includes(mode), label: "Payment mode", detail: messages[mode], href: "/dashboard/shop/configuration" }
  ];
  return {
    version: "1.0", scope: "loaded-catalog", mode, title: titles[mode], message: messages[mode],
    paymentJourneyVerified: false,
    status: mode === "unknown" ? "unknown" : checks.every((check) => check.complete) ? "configured" : "attention",
    checks, complete: checks.filter((check) => check.complete).length,
    shippingZones: (commerce.shippingZones || []).filter((zone) => zone.active !== false).length
  };
}
