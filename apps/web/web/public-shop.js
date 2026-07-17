import { elements, setStatus, state, translateString } from "./core.js";
import { currentLocale } from "./routes.js";
import { normalizeShopSettings } from "./shop-config.js";
import { renderProductDetailContent, renderShopListingContent } from "./public-renderer.js";

function renderOptions(settings) {
  return {
    locale: currentLocale(),
    defaultLocale: state.config?.localization?.defaultLocale || "en",
    shopSettings: normalizeShopSettings(settings)
  };
}

export function renderShopListing({ products = [], categories = [], attributes = [], route = {}, settings = {}, pagination = {} }) {
  const shopSettings = normalizeShopSettings(settings);
  const title = route.category
    ? categories.find((category) => category.slug === route.category)?.name || translateString("shop.category", "Category")
    : route.attributeValue
      ? `${route.attributeName}: ${route.attributeValue}`.replaceAll("-", " ")
      : shopSettings.catalogTitle;

  document.title = route.page > 1 ? `${title} - Page ${route.page}` : title;
  elements.brand.textContent = shopSettings.catalogTitle;
  elements.brand.href = "/";
  elements.page.innerHTML = renderShopListingContent(
    { products, categories, attributes, route, pagination },
    renderOptions(shopSettings)
  );
  elements.footer.innerHTML = "";
  document.body.classList.remove("auth-enabled", "dashboard-enabled", "editor-enabled");
  setStatus(`${pagination.total ?? products.length} ${translateString("shop.productsLoaded", "products loaded.")}`);
}

export function renderProductDetail(product, settings = {}) {
  document.title = product.name;
  elements.brand.textContent = product.name;
  elements.brand.href = "/";
  elements.page.innerHTML = renderProductDetailContent(product, renderOptions(settings));
  elements.footer.innerHTML = "";
  document.body.classList.remove("auth-enabled", "dashboard-enabled", "editor-enabled");
  setStatus(translateString("shop.productLoaded", "Product loaded."));
}
