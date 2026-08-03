import { api, apiWithMeta, defaultPage, elements, hasAnyPermission, hasPermission, moduleEnabled, modulesEnabled, setRuntimeConfig, setStatus, state } from "./core.js";
import { currentAdminRoute, currentLocale, pageSlug, publicPostRoute, publicShopRoute } from "./routes.js";
import { loadMenu } from "./content-actions.js";
import { renderPage, renderPost } from "./public-renderer.js";
import { loadUser } from "./session-actions.js";
import { renderAdminLogin, renderEmailVerification, renderInviteAcceptance, renderPasswordReset } from "./ui.js";
import { pageChangeStorageKey, pageChangeToken } from "./editor-sync.js";

let pageBuilderRefreshPromise = null;

async function adminViews() {
  return import("./admin-views.js");
}

async function builderViews() {
  return import("./builder-views.js");
}

async function shopViews() {
  return import("./shop-views.js");
}

async function publicShopViews() {
  return import("./public-shop.js");
}

function activeAdminLocale() {
  const activeQueryLocale = new URLSearchParams(window.location.search || "").get("locale");
  if (activeQueryLocale) return currentLocale();

  return state.config?.localization?.defaultLocale || currentLocale();
}

function adminLocaleUrl(path, extra = {}) {
  const params = new URLSearchParams(extra);
  const locale = String(activeAdminLocale() || "").toLowerCase();
  const activeQueryLocale = new URLSearchParams(window.location.search || "").get("locale");
  const defaultLocale = String(state.config?.localization?.defaultLocale || "en").toLowerCase();

  if (locale && (activeQueryLocale || locale !== defaultLocale)) params.set("locale", locale);

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function publicLocaleUrl(path, extra = {}) {
  const params = new URLSearchParams(extra);
  params.set("locale", currentLocale());
  const query = params.toString();

  return `${path}?${query}`;
}

async function loadCmsTemplates() {
  try {
    const { templates } = await api("/cms/templates");
    state.cmsTemplates = templates || [];
  } catch {
    state.cmsTemplates = [];
  }

  return state.cmsTemplates;
}

export async function loadAdminRoute(route) {
  if (route.view === "password-reset") {
    renderPasswordReset(route.token);
    return;
  }

  if (route.view === "invite-acceptance") {
    renderInviteAcceptance(route.token);
    return;
  }

  if (route.view === "email-verification") {
    renderEmailVerification(route.token);
    return;
  }

  state.user = await loadUser();
  if (!state.user) {
    renderAdminLogin();
    return;
  }

  await loadRuntimeConfig();

  if (!routeModulesEnabled(route)) {
    const { renderDashboardHome } = await adminViews();
    renderDashboardHome(state.config || {});
    setStatus("This dashboard section is not enabled for this project.", true);
    return;
  }

  const requiredPermissions = adminRoutePermissions(route);
  if (!hasAnyPermission(requiredPermissions)) {
    const { renderDashboardHome } = await adminViews();
    renderDashboardHome(state.config || {});
    setStatus("You do not have permission to access this dashboard section.", true);
    return;
  }

  if (route.view === "profile") {
    const { renderProfilePage } = await adminViews();
    const [{ user }, { mfa }] = await Promise.all([
      api("/users/me"),
      api("/auth/mfa")
    ]);
    renderProfilePage(user, mfa);
    return;
  }

  if (route.view === "shop") {
    const { renderShopPage } = await adminViews();
    try {
      const canReadProducts = hasPermission("read", "products");
      const canReadOrders = hasPermission("read", "orders");
      const [config, draftProducts, activeProducts, archivedProducts, orders, categories, attributes, providers, shippingZones] = await Promise.all([
        api("/config"),
        canReadProducts ? api(adminLocaleUrl("/products", { status: "DRAFT" })) : Promise.resolve({ products: [] }),
        canReadProducts ? api(adminLocaleUrl("/products", { status: "ACTIVE" })) : Promise.resolve({ products: [] }),
        canReadProducts ? api(adminLocaleUrl("/products", { status: "ARCHIVED" })) : Promise.resolve({ products: [] }),
        canReadOrders ? api("/orders") : Promise.resolve({ orders: [] }),
        canReadProducts ? api(adminLocaleUrl("/products/categories")) : Promise.resolve({ categories: [] }),
        canReadProducts ? api(adminLocaleUrl("/products/attributes")) : Promise.resolve({ attributes: [] }),
        moduleEnabled("payments") ? api("/payments/providers/public") : Promise.resolve({ providers: [] }),
        canReadOrders ? api("/orders/shipping/zones") : Promise.resolve({ zones: [] })
      ]);
      renderShopPage({
        config,
        products: [
          ...(draftProducts.products || []),
          ...(activeProducts.products || []),
          ...(archivedProducts.products || [])
        ],
        orders: orders.orders || [],
        categories: categories.categories || [],
        attributes: attributes.attributes || [],
        commerce: {
          providers: providers.providers || [],
          shippingZones: shippingZones.zones || []
        }
      });
    } catch (error) {
      renderShopPage({ errorMessage: error.message || "Unable to load shop overview." });
    }
    return;
  }

  if (route.view === "shop-products") {
    const { renderShopProductsPage } = await adminViews();
    try {
      const { products } = await api(adminLocaleUrl("/products", { status: "DRAFT" }));
      const activeProducts = await api(adminLocaleUrl("/products", { status: "ACTIVE" }));
      const archivedProducts = await api(adminLocaleUrl("/products", { status: "ARCHIVED" }));
      renderShopProductsPage([
        ...products,
        ...(activeProducts.products || []),
        ...(archivedProducts.products || [])
      ]);
    } catch (error) {
      renderShopProductsPage([], error.message || "Unable to load products.");
    }
    return;
  }

  if (route.view === "product-create") {
    const { renderProductEditorPage } = await shopViews();
    try {
      const { categories } = await api(adminLocaleUrl("/products/categories"));
      renderProductEditorPage({ categories });
    } catch (error) {
      const { renderShopProductsPage } = await adminViews();
      renderShopProductsPage([], error.message || "Unable to load product editor.");
    }
    return;
  }

  if (route.view === "product-editor" && route.slug) {
    const [{ renderProductEditorPage }, { renderShopProductsPage }] = await Promise.all([shopViews(), adminViews()]);
    try {
      const [{ product }, { categories }] = await Promise.all([
        api(adminLocaleUrl(`/products/${encodeURIComponent(route.slug)}`)),
        api(adminLocaleUrl("/products/categories"))
      ]);
      renderProductEditorPage({ product, categories });
    } catch (error) {
      renderShopProductsPage([], error.message || "Unable to load product editor.");
    }
    return;
  }

  if (route.view === "shop-orders") {
    const { renderShopOrdersPage } = await adminViews();
    try {
      const [{ orders }, paymentResponse] = await Promise.all([
        api("/orders"),
        moduleEnabled("payments") && hasPermission("read", "payments")
          ? api("/payments")
          : Promise.resolve({ payments: [] })
      ]);
      renderShopOrdersPage(orders, paymentResponse.payments || []);
    } catch (error) {
      renderShopOrdersPage([], [], error.message || "Unable to load orders.");
    }
    return;
  }

  if (route.view === "shop-categories") {
    const { renderProductCategoriesPage } = await adminViews();
    try {
      const { categories } = await api(adminLocaleUrl("/products/categories"));
      renderProductCategoriesPage(categories);
    } catch (error) {
      renderProductCategoriesPage([], error.message || "Unable to load product categories.");
    }
    return;
  }

  if (route.view === "shop-attributes") {
    const { renderProductAttributesPage } = await adminViews();
    try {
      const { attributes } = await api(adminLocaleUrl("/products/attributes"));
      renderProductAttributesPage(attributes);
    } catch (error) {
      renderProductAttributesPage([], error.message || "Unable to load product attributes.");
    }
    return;
  }

  if (route.view === "shop-configuration") {
    const { renderShopConfigurationPage } = await adminViews();
    const canReadOrders = hasPermission("read", "orders");
    const [config, shopResponse, shippingResponse, taxResponse, couponResponse] = await Promise.all([
      api("/config"),
      api("/products/settings"),
      canReadOrders ? api("/orders/shipping/zones") : Promise.resolve({ zones: [] }),
      canReadOrders ? api("/orders/tax-rules") : Promise.resolve({ taxRules: [] }),
      canReadOrders ? api("/orders/coupons") : Promise.resolve({ coupons: [] })
    ]);
    const shopSettings = shopResponse.settings || {};
    const commerce = {
      shippingZones: shippingResponse.zones || [],
      taxRules: taxResponse.taxRules || [],
      coupons: couponResponse.coupons || []
    };
    if (!moduleEnabled("payments")) {
      renderShopConfigurationPage(config, shopSettings, {}, "Payments module is disabled for this project.", commerce);
      return;
    }
    if (!hasPermission("read", "payments")) {
      renderShopConfigurationPage(config, shopSettings, {}, "", commerce);
      return;
    }

    try {
      renderShopConfigurationPage(config, shopSettings, await api("/payments/providers"), "", commerce);
    } catch (error) {
      renderShopConfigurationPage(config, shopSettings, {}, error.message || "Unable to load payment settings.", commerce);
    }
    return;
  }

  if (route.view === "pages") {
    const { renderPagesPage } = await adminViews();
    try {
      const locale = new URLSearchParams(window.location.search || "").get("locale");
      const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
      const [{ pages }, allPagesResponse] = await Promise.all([
        api(`/cms/pages${query}`),
        locale ? api("/cms/pages") : Promise.resolve({ pages: null })
      ]);
      renderPagesPage(pages, "", allPagesResponse.pages || pages);
    } catch (error) {
      renderPagesPage([], error.message || "Unable to load pages.");
    }
    return;
  }

  if (route.view === "page-create") {
    const { renderCreatePagePage } = await builderViews();
    await loadCmsTemplates();
    renderCreatePagePage();
    return;
  }

  if (route.view === "page-builder" && route.slug) {
    const [{ renderPageBuilderPage }, { renderPagesPage }] = await Promise.all([builderViews(), adminViews()]);
    try {
      const [{ page }, menuResponse] = await Promise.all([
        api(adminLocaleUrl(`/cms/pages/${encodeURIComponent(route.slug)}`, { preview: "true" })),
        api(adminLocaleUrl("/cms/menus/main")).catch(() => ({ menu: null })),
        loadCmsTemplates()
      ]);
      state.menu = menuResponse.menu;
      renderPageBuilderPage(page);
    } catch (error) {
      renderPagesPage([], error.message || "Unable to load page builder.");
    }
    return;
  }

  if (route.view === "posts") {
    const { renderPostsPage } = await adminViews();
    try {
      const params = new URLSearchParams({ includeDrafts: "true" });
      const locale = new URLSearchParams(window.location.search || "").get("locale");
      if (locale) params.set("locale", locale);
      const [{ posts }, allPostsResponse] = await Promise.all([
        api(`/cms/posts?${params.toString()}`),
        locale ? api("/cms/posts?includeDrafts=true") : Promise.resolve({ posts: null })
      ]);
      renderPostsPage(posts, "", allPostsResponse.posts || posts);
    } catch (error) {
      renderPostsPage([], error.message || "Unable to load posts.");
    }
    return;
  }

  if (route.view === "post-categories") {
    const { renderPostCategoriesPage } = await adminViews();
    try {
      const { categories } = await api(adminLocaleUrl("/cms/categories"));
      renderPostCategoriesPage(categories);
    } catch (error) {
      renderPostCategoriesPage([], error.message || "Unable to load post categories.");
    }
    return;
  }

  if (route.view === "post-create") {
    const { renderPostEditorPage } = await builderViews();
    renderPostEditorPage();
    return;
  }

  if (route.view === "post-builder" && route.slug) {
    const [{ renderPostEditorPage }, { renderPostsPage }] = await Promise.all([builderViews(), adminViews()]);
    try {
      const locale = activeAdminLocale();
      const { posts } = await api(adminLocaleUrl("/cms/posts", { includeDrafts: "true" }));
      const post = posts.find((item) => item.slug === route.slug && item.locale === locale) ||
        posts.find((item) => item.slug === route.slug);
      if (!post) throw new Error("Post not found.");
      renderPostEditorPage(post);
    } catch (error) {
      renderPostsPage([], error.message || "Unable to load post editor.");
    }
    return;
  }

  if (route.view === "users") {
    const { renderUsersPage } = await adminViews();
    const filters = new URLSearchParams();
    const currentParams = new URLSearchParams(window.location.search || "");
    const search = String(currentParams.get("search") || "").trim();
    const status = String(currentParams.get("status") || "").trim();
    const page = Math.max(1, Number.parseInt(currentParams.get("page") || "1", 10) || 1);
    if (search) filters.set("search", search);
    if (status) filters.set("status", status);
    filters.set("page", String(page));

    try {
      const usersResponse = await api(`/users?${filters.toString()}`);
      let invitesResponse = { invites: [] };
      let inviteError = "";
      if (hasPermission("invite", "users")) {
        try {
          invitesResponse = await api("/auth/invites?status=PENDING&limit=100");
        } catch (error) {
          inviteError = error.message || "Unable to load pending invitations.";
        }
      }
      renderUsersPage(usersResponse.users || [], {
        pagination: usersResponse.pagination,
        invites: invitesResponse.invites || [],
        filters: { search, status },
        inviteError
      });
    } catch (error) {
      renderUsersPage([], {
        filters: { search, status },
        errorMessage: error.message || "Unable to load users."
      });
    }
    return;
  }

  if (route.view === "user-edit" && route.userId) {
    const { renderUserDetailPage, renderUserEditPage } = await adminViews();
    const { user } = await api(`/users/${encodeURIComponent(route.userId)}`);
    if (!hasPermission("update", "users")) {
      renderUserDetailPage(user);
      setStatus("You do not have permission to edit users.", true);
      return;
    }

    let roles = [];
    let rolesError = "";
    if (hasPermission("read", "roles")) {
      try {
        const roleResponse = await api("/roles");
        roles = roleResponse.roles || [];
      } catch (error) {
        rolesError = error.message || "Unable to load role options.";
      }
    }
    renderUserEditPage(user, roles, { rolesError });
    return;
  }

  if (route.view === "user" && route.userId) {
    const { renderUserDetailPage } = await adminViews();
    const { user } = await api(`/users/${encodeURIComponent(route.userId)}`);
    renderUserDetailPage(user);
    return;
  }

  if (route.view === "settings") {
    const { renderSettingsPage } = await adminViews();
    const config = await api("/config");
    const [emailResult, updateResult, auditResult, diagnosticsResult, readinessResult] = await Promise.allSettled([
      api("/config/email"),
      api("/config/runtime-update"),
      hasPermission("read", "audit")
        ? api("/config/audit-logs?limit=20")
        : Promise.resolve({ auditLogs: [] }),
      hasPermission("manage", "modules")
        ? api("/health/diagnostics")
        : Promise.resolve(null),
      api("/config/launch-readiness")
    ]);
    config.email = emailResult.status === "fulfilled"
      ? emailResult.value.email
      : { error: emailResult.reason?.message || "Unable to load email settings." };
    config.runtimeUpdate = updateResult.status === "fulfilled"
      ? updateResult.value.update
      : { enabled: false, error: updateResult.reason?.message || "Unable to load update status." };
    config.auditLogs = auditResult.status === "fulfilled" ? auditResult.value.auditLogs || [] : [];
    config.auditError = auditResult.status === "rejected"
      ? auditResult.reason?.message || "Unable to load security activity."
      : "";
    config.operationsDiagnostics = diagnosticsResult.status === "fulfilled"
      ? diagnosticsResult.value
      : { error: diagnosticsResult.reason?.message || "Unable to load operational diagnostics." };
    config.launchReadiness = readinessResult.status === "fulfilled"
      ? readinessResult.value.readiness
      : { status: "blocked", error: readinessResult.reason?.message || "Unable to check launch readiness.", checks: [] };
    renderSettingsPage(config);
    return;
  }

  const { renderDashboardHome } = await adminViews();
  try {
    renderDashboardHome(await api("/config"));
  } catch {
    renderDashboardHome();
  }
}

export async function refreshPageBuilderIfStale(changedStorageKey = "") {
  const route = currentAdminRoute();
  const activePage = state.builderPage;
  if (route?.view !== "page-builder" || !route.slug || !activePage || activePage.slug !== route.slug) return;

  const storageKey = pageChangeStorageKey(activePage);
  if (changedStorageKey && changedStorageKey !== storageKey) return;

  const latestToken = pageChangeToken(activePage);
  if (!latestToken || latestToken === state.builderPageChangeToken) return;
  if (pageBuilderRefreshPromise) return pageBuilderRefreshPromise;

  const previousToken = state.builderPageChangeToken;
  state.builderPageChangeToken = latestToken;
  pageBuilderRefreshPromise = (async () => {
    try {
      const { renderPageBuilderPage } = await builderViews();
      const { page } = await api(
        adminLocaleUrl(`/cms/pages/${encodeURIComponent(route.slug)}`, { preview: "true" }),
        { cache: "no-store" }
      );
      renderPageBuilderPage(page, "Updated with changes from the visual editor.");
    } catch (error) {
      state.builderPageChangeToken = previousToken;
      setStatus(error.message || "Unable to refresh the page builder.", true);
    }
  })();

  try {
    await pageBuilderRefreshPromise;
  } finally {
    pageBuilderRefreshPromise = null;
  }
}

async function loadRuntimeConfig() {
  try {
    return setRuntimeConfig(await api("/config"));
  } catch {
    return setRuntimeConfig(null);
  }
}

function routeModulesEnabled(route) {
  const requiredModulesByView = {
    shop: ["products", "orders"],
    "shop-products": ["products"],
    "product-create": ["products"],
    "product-editor": ["products"],
    "shop-categories": ["products"],
    "shop-attributes": ["products"],
    "shop-orders": ["orders"],
    "shop-configuration": ["products"],
    pages: ["cms"],
    "page-create": ["cms"],
    "page-builder": ["cms"],
    posts: ["cms"],
    "post-create": ["cms"],
    "post-builder": ["cms"],
    "post-categories": ["cms"],
    users: ["users", "roles"],
    user: ["users", "roles"],
    "user-edit": ["users", "roles"],
    settings: ["config"]
  };
  const requiredModules = requiredModulesByView[route.view] || [];

  return modulesEnabled(requiredModules);
}

export function adminRoutePermissions(route) {
  const requirements = {
    shop: [["read", "products"], ["read", "orders"]],
    "shop-products": [["read", "products"]],
    "product-create": [["create", "products"]],
    "product-editor": [["update", "products"]],
    "shop-categories": [["read", "products"]],
    "shop-attributes": [["read", "products"]],
    "shop-orders": [["read", "orders"]],
    "shop-configuration": [["read", "products"], ["read", "payments"], ["read", "modules"]],
    pages: [["read", "cms"]],
    "page-create": [["create", "cms"]],
    "page-builder": [["update", "cms"]],
    posts: [["read", "cms"]],
    "post-create": [["create", "cms"]],
    "post-builder": [["update", "cms"]],
    "post-categories": [["read", "cms"]],
    users: [["read", "users"]],
    user: [["read", "users"]],
    "user-edit": [["read", "users"]],
    settings: [["manage", "modules"]]
  };

  return requirements[route.view] || [];
}

async function loadPage() {
  const shopRoute = publicShopRoute();
  if (shopRoute) {
    const { renderShopListing, renderProductDetail } = await publicShopViews();

    if (shopRoute.view === "product") {
      const [{ product }, { settings }] = await Promise.all([
        api(publicLocaleUrl(`/products/${encodeURIComponent(shopRoute.slug)}`)),
        api("/products/settings")
      ]);
      renderProductDetail(product, settings);
      return;
    }

    const params = new URLSearchParams();
    if (shopRoute.category) params.set("category", shopRoute.category);
    if (shopRoute.attributeName) params.set("attributeName", shopRoute.attributeName);
    if (shopRoute.attributeValue) params.set("attributeValue", shopRoute.attributeValue);
    params.set("page", String(shopRoute.page || 1));

    const [{ settings }, { categories }, { attributes }] = await Promise.all([
      api("/products/settings"),
      api(publicLocaleUrl("/products/categories")),
      api(publicLocaleUrl("/products/attributes"))
    ]);
    params.set("limit", String(settings.productsPerPage || 20));
    const productsResponse = await apiWithMeta(publicLocaleUrl("/products", Object.fromEntries(params.entries())));
    renderShopListing({
      products: productsResponse.data.products,
      categories,
      attributes,
      route: shopRoute,
      settings,
      pagination: productsResponse.meta
    });
    return;
  }

  const postRoute = publicPostRoute();
  if (postRoute) {
    const params = new URLSearchParams();
    if (state.token) params.set("preview", "true");
    params.set("locale", currentLocale());
    const query = `?${params.toString()}`;
    const { post } = await api(`/cms/posts/${encodeURIComponent(postRoute.slug)}${query}`);
    renderPost(post);
    return;
  }

  const params = new URLSearchParams();
  if (state.token) params.set("preview", "true");
  params.set("locale", currentLocale());
  const query = `?${params.toString()}`;
  try {
    const { page } = await api(`/cms/pages/${encodeURIComponent(pageSlug())}${query}`);
    state.page = page;
    renderPage(page);
  } catch (error) {
    if (pageSlug() === "home") {
      state.page = defaultPage;
      renderPage(defaultPage);
      setStatus(
        state.user
          ? "Static preview. Enable CMS pages to edit live content."
          : "Static preview. CMS content is not available yet."
      );
      return;
    }

    throw error;
  }
}

export async function bootstrap() {
  const adminRoute = currentAdminRoute();

  if (adminRoute) {
    try {
      await loadAdminRoute(adminRoute);
    } catch (error) {
      renderAdminLogin();
      setStatus(error.message, true);
    }
    return;
  }

  const hasServerRenderedContent = elements.page?.dataset.serverRendered === "true";

  try {
    document.body.classList.remove("auth-enabled", "dashboard-enabled");
    state.user = await loadUser();
    await loadRuntimeConfig();
    state.visualEditorActive = Boolean(
      state.user &&
      moduleEnabled("cms") &&
      hasPermission("update", "cms") &&
      new URLSearchParams(window.location.search || "").get("edit") === "1"
    );
    if (state.visualEditorActive) await loadCmsTemplates();
    else {
      state.visualEditorSelection = null;
      state.visualEditorEditingBlockKey = "";
    }
    await loadMenu();
    await loadPage();
  } catch (error) {
    if (!hasServerRenderedContent) elements.page.innerHTML = "";
    setStatus(error.message, true);
  }
}
