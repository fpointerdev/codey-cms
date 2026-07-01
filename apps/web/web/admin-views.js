import {
  escapeHtml,
  formatDate,
  formatMoney,
  formatRoles,
  hasPermission,
  modulesEnabled,
  setStatus,
  state
} from "./core.js";
import { adminHref, publicPageHref, publicPostHref, publicProductHref } from "./routes.js";
import { renderComponentPalette } from "./public-renderer.js";
import { renderAdminShell, renderFormMessage } from "./ui.js";

function renderInstalledModuleSummary(config = {}) {
  const installedModules = new Map((config.installedModules || []).map((module) => [module.moduleId, module]));
  const modules = Object.values(config.modules || {});

  if (!modules.length) return '<p class="dashboard-copy">Module catalog is not available yet.</p>';

  return `
    <div class="module-grid">
      ${modules
        .map((module) => {
          const installed = installedModules.get(module.id);
          const enabled = installed?.status === "ENABLED" || module.required;

          return `
            <article class="admin-card module-card">
              <div>
                <strong>${escapeHtml(module.label)}</strong>
                <span>${escapeHtml(module.description)}</span>
              </div>
              <small>${enabled ? "Enabled" : "Disabled"} · ${escapeHtml(module.category || "module")}</small>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function activeLocaleFilter() {
  if (typeof window === "undefined") return "";

  return new URLSearchParams(window.location.search || "").get("locale") || "";
}

function enabledLocales(records = []) {
  const configured = state.config?.localization?.locales;
  const locales = Array.isArray(configured) && configured.length
    ? configured
    : [...new Set(records.map((item) => item.locale).filter(Boolean))]
        .map((code) => ({ code, label: String(code).toUpperCase(), enabled: true }));

  return locales.filter((locale) => locale.enabled !== false && locale.code);
}

function renderLocaleFilterBar(baseHref, records = []) {
  const locales = enabledLocales(records);
  if (locales.length <= 1) return "";

  const active = activeLocaleFilter();

  return `
    <div class="filter-bar" aria-label="Language filter">
      <a class="${active ? "" : "active"}" href="${escapeHtml(baseHref)}" data-dashboard-link>All languages</a>
      ${locales
        .map((locale) => {
          const code = String(locale.code || "").toLowerCase();
          return `<a class="${active === code ? "active" : ""}" href="${escapeHtml(`${baseHref}?locale=${encodeURIComponent(code)}`)}" data-dashboard-link>${escapeHtml(locale.label || code.toUpperCase())}</a>`;
        })
        .join("")}
    </div>
  `;
}

function localeBadge(item) {
  const locale = item.locale || "en";
  const group = item.translationGroupId || item.slug || "";

  return `
    <span class="status-pill">${escapeHtml(locale.toUpperCase())}</span>
    ${group ? `<small class="muted-text">Group: ${escapeHtml(group)}</small>` : ""}
  `;
}

function translationStatusBadges(item, records = []) {
  const locales = enabledLocales(records);
  if (locales.length <= 1) return '<span class="muted-text">Default language</span>';

  const group = item.translationGroupId || item.slug;
  const translationsByLocale = new Map(
    records
      .filter((record) => (record.translationGroupId || record.slug) === group)
      .map((record) => [String(record.locale || "en").toLowerCase(), record])
  );

  return `
    <div class="translation-status-list">
      ${locales
        .map((locale) => {
          const code = String(locale.code || "").toLowerCase();
          const translation = translationsByLocale.get(code);
          return translation
            ? `<span class="status-pill translation-status">${escapeHtml(code.toUpperCase())}: ${escapeHtml(translation.status || "DRAFT")}</span>`
            : `<span class="status-pill translation-status missing">${escapeHtml(code.toUpperCase())}: missing</span>`;
        })
        .join("")}
    </div>
  `;
}

function hrefWithLocale(href, locale) {
  const localeCode = String(locale || "").trim().toLowerCase();
  if (!localeCode) return href;

  const defaultLocale = String(state.config?.localization?.defaultLocale || "en").toLowerCase();
  if (localeCode === defaultLocale && !activeLocaleFilter()) return href;

  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}locale=${encodeURIComponent(localeCode)}`;
}

function localizedPublicHref(path, locale) {
  const localeCode = String(locale || "").toLowerCase();
  const defaultLocale = String(state.config?.localization?.defaultLocale || "en").toLowerCase();

  if (!localeCode || localeCode === defaultLocale) return path;
  if (path === "/") return `/${encodeURIComponent(localeCode)}`;

  return `/${encodeURIComponent(localeCode)}${path}`;
}

function publicHrefForPage(page) {
  return localizedPublicHref(publicPageHref(page.slug), page.locale);
}

function publicHrefForPost(post) {
  return localizedPublicHref(publicPostHref(post.slug), post.locale);
}

function publicHrefForProduct(product) {
  return localizedPublicHref(publicProductHref(product.slug), product.locale);
}

function currentLocaleSuffix() {
  const active = activeLocaleFilter();
  return active ? `?locale=${encodeURIComponent(active)}` : "";
}

function renderDashboardActions() {
  const actions = [
    {
      title: "Pages",
      body: "Create pages, open live previews, and edit page sections.",
      action: "Manage pages",
      href: "/dashboard/pages",
      modules: ["cms"]
    },
    {
      title: "Posts",
      body: "Prepare articles, updates, and content connected to site pages.",
      action: "Manage posts",
      href: "/dashboard/posts",
      modules: ["cms"]
    },
    {
      title: "Shop",
      body: "Review products, orders, and shop module configuration.",
      action: "Open shop",
      href: "/dashboard/shop",
      modules: ["products", "orders"]
    },
    {
      title: "Users",
      body: "Invite editors and review access for this client project.",
      action: "Manage users",
      href: "/dashboard/users",
      modules: ["users", "roles"]
    }
  ].filter((action) => modulesEnabled(action.modules));

  if (!actions.length) {
    return `
      <div class="dashboard-command-grid single">
        <div class="dashboard-command dashboard-command-muted">
          <span>Setup</span>
          <strong>No optional workflows are enabled for this project yet.</strong>
          <em>Review installed modules below</em>
        </div>
      </div>
    `;
  }

  return `
    <div class="dashboard-command-grid">
      ${actions
        .map(
          ({ title, body, action, href }) => `
            <a class="dashboard-command" href="${escapeHtml(href)}" data-dashboard-link>
              <span>${escapeHtml(title)}</span>
              <strong>${escapeHtml(body)}</strong>
              <em>${escapeHtml(action)}</em>
            </a>
          `
        )
        .join("")}
    </div>
  `;
}

function renderTableEmptyState(title, body, action = "") {
  return `
    <div class="table-empty-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(body)}</span>
      ${action}
    </div>
  `;
}

function renderEmptyTableRow(colspan, title, body, action = "") {
  return `<tr><td colspan="${colspan}">${renderTableEmptyState(title, body, action)}</td></tr>`;
}

function renderModuleStatusList(config = {}) {
  const installedModules = new Map((config.installedModules || []).map((module) => [module.moduleId, module]));
  const modules = Object.values(config.modules || {});

  if (!modules.length) return '<p class="dashboard-copy">Module catalog is not available yet.</p>';

  return `
    <div class="module-status-list">
      ${modules
        .map((module) => {
          const installed = installedModules.get(module.id);
          const enabled = installed?.status === "ENABLED" || module.required;

          return `
            <div class="module-status-row">
              <div>
                <strong>${escapeHtml(module.label)}</strong>
                <span>${escapeHtml(module.category || "module")}</span>
              </div>
              <span class="status-pill ${enabled ? "success" : ""}">${enabled ? "Enabled" : "Disabled"}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderDashboardHome(data = {}) {
  const config = data.config || data;

  renderAdminShell(
    { view: "dashboard" },
    `
      <section class="admin-page-header">
        <div>
          <p class="section-label">Dashboard</p>
          <h1 class="dashboard-title">Project Console</h1>
          <p class="dashboard-copy">
            Manage the website structure, content, users, shop modules, and publishing setup from one focused workspace.
          </p>
        </div>
        <a class="admin-primary-link" href="/">View Site</a>
      </section>
      <section class="admin-section admin-panel">
        <div class="section-heading-row"><div><p class="section-label">Workflows</p><h2>Build and operate this site</h2></div></div>
        ${renderDashboardActions()}
      </section>
      <section class="dashboard-two-column">
        <div class="admin-section admin-panel">
          <div class="section-heading-row"><div><p class="section-label">Module state</p><h2>Installed capabilities</h2></div></div>
          ${renderModuleStatusList(config)}
        </div>
        <div class="admin-section admin-panel">
          <div class="section-heading-row"><div><p class="section-label">Builder library</p><h2>Default elements</h2></div></div>
          ${renderComponentPalette()}
        </div>
      </section>
    `
  );
  setStatus("Dashboard loaded.");
}

export function renderProfilePage(profile) {
  renderAdminShell(
    { view: "profile" },
    `
      <section class="admin-section narrow">
        <p class="section-label">Profile</p>
        <h1 class="dashboard-title">${escapeHtml(profile.name || profile.email)}</h1>
        <div class="admin-card detail-list">
          <div><span>Email</span><strong>${escapeHtml(profile.email)}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(profile.status || "ACTIVE")}</strong></div>
          <div><span>Roles</span><strong>${escapeHtml(formatRoles(profile))}</strong></div>
          <div><span>User ID</span><strong>${escapeHtml(profile.id)}</strong></div>
        </div>
      </section>
    `
  );
  setStatus("Profile loaded.");
}

export function renderPagesPage(pages, errorMessage = "", allPages = pages) {
  renderAdminShell(
    { view: "pages" },
    `
      <section class="admin-section">
        <div class="section-heading-row">
          <div><p class="section-label">Pages</p><h1 class="dashboard-title">Pages</h1><p class="dashboard-copy">Create and review the site pages available to this project.</p></div>
          <div class="button-row">
            <a class="secondary-button" href="/dashboard/posts${currentLocaleSuffix()}" data-dashboard-link>Posts</a>
            ${hasPermission("create", "cms") ? `<a class="admin-primary-link" href="/dashboard/pages/new${currentLocaleSuffix()}" data-dashboard-link>Create Page</a>` : ""}
          </div>
        </div>
        ${errorMessage ? `<p class="form-message error">Pages are not available yet: ${escapeHtml(errorMessage)}</p>` : ""}
        ${renderLocaleFilterBar("/dashboard/pages", allPages)}
        <div class="admin-card table-card">
          <table class="admin-table">
            <thead><tr><th>Title</th><th>Slug</th><th>Language</th><th>Status</th><th>Translations</th><th>Updated</th><th>Editors</th></tr></thead>
            <tbody>
              ${
                pages.length
                  ? pages
                      .map(
                        (page) => `
                          <tr>
                            <td><a href="${escapeHtml(hrefWithLocale(adminHref("page-builder", page.slug), page.locale))}" data-dashboard-link><strong>${escapeHtml(page.title)}</strong></a></td>
                            <td>${escapeHtml(page.slug)}</td>
                            <td>${localeBadge(page)}</td>
                            <td><span class="status-pill">${escapeHtml(page.status)}</span></td>
                            <td>${translationStatusBadges(page, allPages)}</td>
                            <td>${escapeHtml(formatDate(page.updatedAt))}</td>
                            <td>
                              <a href="${escapeHtml(publicHrefForPage(page))}">View it</a>
                              <span class="table-separator">/</span>
                              <a href="${escapeHtml(publicHrefForPage(page))}">Frontend editor</a>
                              <span class="table-separator">/</span>
                              <a href="${escapeHtml(hrefWithLocale(adminHref("page-builder", page.slug), page.locale))}" data-dashboard-link>Backend builder</a>
                              ${enabledLocales(allPages).length > 1 && hasPermission("create", "cms") ? `
                                <span class="table-separator">/</span>
                                <button type="button" class="link-button" data-create-page-translation="${escapeHtml(page.slug)}" data-source-locale="${escapeHtml(page.locale || "en")}" data-source-title="${escapeHtml(page.title)}">Translate</button>
                              ` : ""}
                            </td>
                          </tr>
                        `
                      )
                      .join("")
                  : renderEmptyTableRow(
                      7,
                      "No pages yet",
                      "Create the first page, then open the builder to add sections and navigation.",
                      hasPermission("create", "cms")
                        ? `<a class="admin-primary-link" href="/dashboard/pages/new${currentLocaleSuffix()}" data-dashboard-link>Create Page</a>`
                        : ""
                    )
              }
            </tbody>
          </table>
        </div>
      </section>
    `
  );
  setStatus(errorMessage ? "Pages could not be loaded." : `${pages.length} pages loaded.`);
}

export function renderPostsPage(posts, errorMessage = "", allPosts = posts) {
  renderPostsShell(
    "posts",
    renderPostsTable(posts, errorMessage, allPosts)
  );
  setStatus(errorMessage ? "Posts could not be loaded." : `${posts.length} posts loaded.`);
}

function renderPostsShell(activeView, content) {
  renderAdminShell(
    { view: activeView },
    `
      <section class="admin-page-header">
        <div><p class="section-label">CMS</p><h1 class="dashboard-title">Posts</h1><p class="dashboard-copy">Manage articles, categories, and content that can be linked from pages.</p></div>
      </section>
      <nav class="admin-tabs" aria-label="Post sections">
        ${[
          { view: "posts", href: "/dashboard/posts", label: "All Posts" },
          { view: "post-create", href: `/dashboard/posts/new${currentLocaleSuffix()}`, label: "New Post" },
          { view: "post-categories", href: "/dashboard/posts/categories", label: "Post Categories" }
        ]
          .map((tab) => `<a href="${escapeHtml(tab.href)}" data-dashboard-link class="${tab.view === activeView ? "active" : ""}">${escapeHtml(tab.label)}</a>`)
          .join("")}
      </nav>
      ${content}
    `
  );
}

function renderPostsTable(posts, errorMessage = "", allPosts = posts) {
  return `
      <section class="admin-section">
        <div class="section-heading-row">
          <div><p class="section-label">All posts</p><h2>Posts</h2><p class="dashboard-copy">Create and review articles that can be linked from pages and menus.</p></div>
          <div class="button-row">
            <a class="secondary-button" href="/dashboard/pages${currentLocaleSuffix()}" data-dashboard-link>Pages</a>
            ${hasPermission("create", "cms") ? `<a class="admin-primary-link" href="/dashboard/posts/new${currentLocaleSuffix()}" data-dashboard-link>Create Post</a>` : ""}
          </div>
        </div>
        ${errorMessage ? `<p class="form-message error">Posts are not available yet: ${escapeHtml(errorMessage)}</p>` : ""}
        ${renderLocaleFilterBar("/dashboard/posts", allPosts)}
        <div class="admin-card table-card">
          <table class="admin-table">
            <thead><tr><th>Title</th><th>Slug</th><th>Language</th><th>Status</th><th>Translations</th><th>Categories</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              ${
                posts.length
                  ? posts
                      .map(
                        (post) => `
                          <tr>
                            <td><a href="${escapeHtml(hrefWithLocale(adminHref("post-builder", post.slug), post.locale))}" data-dashboard-link><strong>${escapeHtml(post.title)}</strong></a></td>
                            <td>${escapeHtml(post.slug)}</td>
                            <td>${localeBadge(post)}</td>
                            <td><span class="status-pill">${escapeHtml(post.status)}</span></td>
                            <td>${translationStatusBadges(post, allPosts)}</td>
                            <td>${escapeHtml((post.categories || []).map((item) => item.name || item.category?.name).filter(Boolean).join(", ") || "Uncategorized")}</td>
                            <td>${escapeHtml(formatDate(post.updatedAt))}</td>
                            <td>
                              <a href="${escapeHtml(publicHrefForPost(post))}">View it</a>
                              <span class="table-separator">/</span>
                              <a href="${escapeHtml(hrefWithLocale(adminHref("post-builder", post.slug), post.locale))}" data-dashboard-link>Backend builder</a>
                              ${enabledLocales(allPosts).length > 1 && hasPermission("create", "cms") ? `
                                <span class="table-separator">/</span>
                                <button type="button" class="link-button" data-create-post-translation="${escapeHtml(post.slug)}" data-source-locale="${escapeHtml(post.locale || "en")}" data-source-title="${escapeHtml(post.title)}">Translate</button>
                              ` : ""}
                            </td>
                          </tr>
                        `
                      )
                      .join("")
                  : renderEmptyTableRow(
                      8,
                      "No posts yet",
                      "Use posts for articles, updates, and reusable content linked from pages.",
                      hasPermission("create", "cms")
                        ? `<a class="admin-primary-link" href="/dashboard/posts/new${currentLocaleSuffix()}" data-dashboard-link>Create Post</a>`
                        : ""
                    )
              }
            </tbody>
          </table>
        </div>
      </section>
    `;
}

export function renderPostCategoriesPage(categories, errorMessage = "") {
  renderPostsShell(
    "post-categories",
    `
      <section class="admin-section">
        <div class="section-heading-row">
          <div><p class="section-label">Taxonomy</p><h2>Post Categories</h2><p class="dashboard-copy">Organize posts for archives, menus, and filtered content lists.</p></div>
          ${hasPermission("create", "cms") ? '<button type="button" data-create-post-category>Create Category</button>' : ""}
        </div>
        ${errorMessage ? `<p class="form-message error">Post categories are not available yet: ${escapeHtml(errorMessage)}</p>` : ""}
        <div class="admin-card table-card">
          <table class="admin-table">
            <thead><tr><th>Name</th><th>Slug</th><th>Description</th><th>Actions</th></tr></thead>
            <tbody>
              ${
                categories.length
                  ? categories
                      .map(
                        (category) => `
                          <tr>
                            <td><strong>${escapeHtml(category.name)}</strong></td>
                            <td>${escapeHtml(category.slug)}</td>
                            <td>${escapeHtml(category.description || "")}</td>
                            <td>
                              <button type="button" class="link-button" data-edit-post-category="${escapeHtml(category.slug)}">Edit</button>
                              <button type="button" class="link-button danger" data-delete-post-category="${escapeHtml(category.slug)}">Delete</button>
                            </td>
                          </tr>
                        `
                      )
                      .join("")
                  : renderEmptyTableRow(4, "No post categories yet", "Create categories before publishing posts into editorial archives.")
              }
            </tbody>
          </table>
        </div>
      </section>
    `
  );
  setStatus(errorMessage ? "Post categories could not be loaded." : `${categories.length} post categories loaded.`);
}

export function renderShopShell(activeView, content) {
  const activeTab = activeView === "product-create" || activeView === "product-editor" ? "shop-products" : activeView;
  const tabs = [
    { view: "shop", href: "/dashboard/shop", label: "Overview", modules: ["products", "orders"] },
    { view: "shop-products", href: "/dashboard/shop/products", label: "Products", modules: ["products"] },
    { view: "shop-categories", href: "/dashboard/shop/categories", label: "Categories", modules: ["products"] },
    { view: "shop-attributes", href: "/dashboard/shop/attributes", label: "Attributes", modules: ["products"] },
    { view: "shop-orders", href: "/dashboard/shop/orders", label: "Orders", modules: ["orders"] },
    { view: "shop-configuration", href: "/dashboard/shop/configuration", label: "Shop Configuration", modules: ["products", "orders"] }
  ].filter((tab) => modulesEnabled(tab.modules));

  renderAdminShell(
    { view: activeView },
    `
      <section class="admin-page-header">
        <div><p class="section-label">Shop</p><h1 class="dashboard-title">Shop</h1><p class="dashboard-copy">Manage products, orders, and commerce settings for this project.</p></div>
      </section>
      <nav class="admin-tabs" aria-label="Shop sections">
        ${tabs
          .map((tab) => `<a href="${escapeHtml(tab.href)}" data-dashboard-link class="${tab.view === activeTab ? "active" : ""}">${escapeHtml(tab.label)}</a>`)
          .join("")}
      </nav>
      ${content}
    `
  );
}

function orderNeedsAttention(order = {}) {
  return ["PENDING", "CONFIRMED", "PAID"].includes(order.status) || order.checkoutStatus === "PAYMENT_PENDING";
}

export function renderShopPage({ products = [], orders = [], categories = [], attributes = [], errorMessage = "" } = {}) {
  const activeProducts = products.filter((product) => product.status === "ACTIVE");
  const draftProducts = products.filter((product) => product.status === "DRAFT");
  const lowStockProducts = products.filter((product) => Number(product.stockQuantity || 0) <= 3);
  const openOrders = orders.filter(orderNeedsAttention);
  const revenueCents = orders
    .filter((order) => ["PAID", "FULFILLED"].includes(order.status))
    .reduce((total, order) => total + Number(order.totalCents || 0), 0);
  const actions = [
    {
      href: "/dashboard/shop/products",
      title: "Products",
      body: "Create draft products, update stock, and publish catalog items.",
      modules: ["products"]
    },
    {
      href: "/dashboard/shop/orders",
      title: "Orders",
      body: "Review customer orders, checkout state, and queued notifications.",
      modules: ["orders"]
    },
    {
      href: "/dashboard/shop/categories",
      title: "Categories",
      body: "Manage catalog taxonomy and product archive pages.",
      modules: ["products"]
    },
    {
      href: "/dashboard/shop/attributes",
      title: "Attributes",
      body: "Define reusable technical attributes and filter values.",
      modules: ["products"]
    },
    {
      href: "/dashboard/shop/configuration",
      title: "Configuration",
      body: "Review shop module state and operational requirements.",
      modules: ["products", "orders"]
    }
  ].filter((action) => modulesEnabled(action.modules));

  renderShopShell(
    "shop",
    `
      ${errorMessage ? `<p class="form-message error">${escapeHtml(errorMessage)}</p>` : ""}
      <section class="admin-section admin-panel">
        <div class="section-heading-row"><div><p class="section-label">Overview</p><h2>Shop metrics</h2></div></div>
        <div class="shop-overview-grid">
          <article><span>Active products</span><strong>${escapeHtml(activeProducts.length)}</strong><small>${escapeHtml(draftProducts.length)} drafts</small></article>
          <article><span>Open orders</span><strong>${escapeHtml(openOrders.length)}</strong><small>${escapeHtml(orders.length)} total orders</small></article>
          <article><span>Paid revenue</span><strong>${escapeHtml(formatMoney(revenueCents, orders[0]?.currency || "EUR"))}</strong><small>Paid and fulfilled orders</small></article>
          <article><span>Taxonomy</span><strong>${escapeHtml(categories.length + attributes.length)}</strong><small>${escapeHtml(categories.length)} categories · ${escapeHtml(attributes.length)} attributes</small></article>
        </div>
      </section>
      ${openOrders.length ? `
        <section class="admin-section admin-panel">
          <div class="section-heading-row"><div><p class="section-label">Attention</p><h2>New or active orders</h2></div><a class="secondary-button" href="/dashboard/shop/orders" data-dashboard-link>Review orders</a></div>
          <div class="admin-action-list">
            ${openOrders.slice(0, 5).map((order) => `
              <a href="/dashboard/shop/orders" data-dashboard-link>
                <strong>${escapeHtml(order.orderNumber || order.id)}</strong>
                <span>${escapeHtml(order.customerEmail || "No customer email")} · ${escapeHtml(order.status)} · ${escapeHtml(formatMoney(order.totalCents || 0, order.currency || "EUR"))}</span>
              </a>
            `).join("")}
          </div>
        </section>
      ` : ""}
      ${lowStockProducts.length ? `
        <section class="admin-section admin-panel">
          <div class="section-heading-row"><div><p class="section-label">Stock</p><h2>Low stock products</h2></div></div>
          <div class="module-status-list">
            ${lowStockProducts.slice(0, 6).map((product) => `
              <div class="module-status-row">
                <div><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.sku || product.slug)}</span></div>
                <span class="status-pill">${escapeHtml(product.stockQuantity)} left</span>
              </div>
            `).join("")}
          </div>
        </section>
      ` : ""}
      <section class="admin-section admin-panel">
        <div class="section-heading-row"><div><p class="section-label">Shortcuts</p><h2>Operate catalog</h2></div></div>
        <div class="admin-action-list">
          ${
            actions.length
              ? actions
                  .map(
                    (action) => `
                      <a href="${escapeHtml(action.href)}" data-dashboard-link>
                        <strong>${escapeHtml(action.title)}</strong>
                        <span>${escapeHtml(action.body)}</span>
                      </a>
                    `
                  )
                  .join("")
              : renderTableEmptyState("Shop modules are disabled", "Enable products and orders before operating the shop workspace.")
          }
        </div>
      </section>
    `
  );
  setStatus("Shop overview loaded.");
}

export function renderShopProductsPage(products, errorMessage = "") {
  renderShopShell(
    "shop-products",
    `
      <section class="admin-section">
        <div class="section-heading-row"><div><p class="section-label">Catalog</p><h2>Products</h2></div>${hasPermission("create", "products") ? '<a class="admin-primary-link" href="/dashboard/shop/products/new" data-dashboard-link>Create Product</a>' : ""}</div>
        ${errorMessage ? `<p class="form-message error">Products are not available yet: ${escapeHtml(errorMessage)}</p>` : ""}
        <div class="admin-card table-card">
          <table class="admin-table">
            <thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Price</th><th>Stock</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              ${
                products.length
                  ? products
                      .map(
                        (product) => `
                          <tr>
                            <td><a href="${escapeHtml(adminHref("product-editor", product.slug))}" data-dashboard-link><strong>${escapeHtml(product.name)}</strong></a></td>
                            <td>${escapeHtml(product.slug)}</td>
                            <td><span class="status-pill">${escapeHtml(product.status)}</span></td>
                            <td>${escapeHtml(formatMoney(product.priceCents, product.currency || "EUR"))}</td>
                            <td>${escapeHtml(product.stockQuantity)}</td>
                            <td>${escapeHtml(formatDate(product.updatedAt))}</td>
                            <td>
                              <a href="${escapeHtml(publicHrefForProduct(product))}">View it</a>
                              <span class="table-separator">/</span>
                              <a href="${escapeHtml(adminHref("product-editor", product.slug))}" data-dashboard-link>Edit</a>
                            </td>
                          </tr>
                        `
                      )
                      .join("")
                  : renderEmptyTableRow(
                      7,
                      "No products yet",
                      "Create the first product as a draft, then publish it when pricing and stock are ready.",
                      hasPermission("create", "products") ? '<a class="admin-primary-link" href="/dashboard/shop/products/new" data-dashboard-link>Create Product</a>' : ""
                    )
              }
            </tbody>
          </table>
        </div>
      </section>
    `
  );
  setStatus(errorMessage ? "Products could not be loaded." : `${products.length} products loaded.`);
}

export function renderProductCategoriesPage(categories, errorMessage = "") {
  renderShopShell(
    "shop-categories",
    `
      <section class="admin-section">
        <div class="section-heading-row">
          <div><p class="section-label">Catalog taxonomy</p><h2>Product Categories</h2><p class="dashboard-copy">Categories power catalog organization, public category pages, and product filters.</p></div>
          ${hasPermission("create", "products") ? '<button type="button" data-create-product-category>Create Category</button>' : ""}
        </div>
        ${errorMessage ? `<p class="form-message error">Product categories are not available yet: ${escapeHtml(errorMessage)}</p>` : ""}
        <div class="admin-card table-card">
          <table class="admin-table">
            <thead><tr><th>Name</th><th>Slug</th><th>Description</th><th>Sort</th><th>Actions</th></tr></thead>
            <tbody>
              ${
                categories.length
                  ? categories
                      .map(
                        (category) => `
                          <tr>
                            <td><strong>${escapeHtml(category.name)}</strong></td>
                            <td><a href="/shop/category/${escapeHtml(category.slug)}">${escapeHtml(category.slug)}</a></td>
                            <td>${escapeHtml(category.description || "")}</td>
                            <td>${escapeHtml(category.sortOrder || 0)}</td>
                            <td>
                              <button type="button" class="link-button" data-edit-product-category="${escapeHtml(category.slug)}">Edit</button>
                              <button type="button" class="link-button danger" data-delete-product-category="${escapeHtml(category.slug)}">Delete</button>
                            </td>
                          </tr>
                        `
                      )
                      .join("")
                  : renderEmptyTableRow(5, "No product categories yet", "Create categories before publishing larger catalogs.")
              }
            </tbody>
          </table>
        </div>
      </section>
    `
  );
  setStatus(errorMessage ? "Product categories could not be loaded." : `${categories.length} product categories loaded.`);
}

export function renderProductAttributesPage(attributes, errorMessage = "") {
  renderShopShell(
    "shop-attributes",
    `
      <section class="admin-section">
        <div class="section-heading-row">
          <div><p class="section-label">Product filters</p><h2>Product Attributes</h2><p class="dashboard-copy">Define reusable specs such as material, finish, size, industry, or compatibility.</p></div>
          ${hasPermission("create", "products") ? '<button type="button" data-create-product-attribute>Create Attribute</button>' : ""}
        </div>
        ${errorMessage ? `<p class="form-message error">Product attributes are not available yet: ${escapeHtml(errorMessage)}</p>` : ""}
        <div class="admin-card table-card">
          <table class="admin-table">
            <thead><tr><th>Name</th><th>Slug</th><th>Values</th><th>Sort</th><th>Actions</th></tr></thead>
            <tbody>
              ${
                attributes.length
                  ? attributes
                      .map(
                        (attribute) => `
                          <tr>
                            <td><strong>${escapeHtml(attribute.name)}</strong></td>
                            <td>${escapeHtml(attribute.slug)}</td>
                            <td>${escapeHtml((attribute.values || []).join(", "))}</td>
                            <td>${escapeHtml(attribute.sortOrder || 0)}</td>
                            <td>
                              <button type="button" class="link-button" data-edit-product-attribute="${escapeHtml(attribute.slug)}">Edit</button>
                              <button type="button" class="link-button danger" data-delete-product-attribute="${escapeHtml(attribute.slug)}">Delete</button>
                            </td>
                          </tr>
                        `
                      )
                      .join("")
                  : renderEmptyTableRow(5, "No product attributes yet", "Create attributes to make technical products easier to filter.")
              }
            </tbody>
          </table>
        </div>
      </section>
    `
  );
  setStatus(errorMessage ? "Product attributes could not be loaded." : `${attributes.length} product attributes loaded.`);
}

export function renderShopOrdersPage(orders, errorMessage = "") {
  renderShopShell(
    "shop-orders",
    `
      <section class="admin-section">
        <div class="section-heading-row"><div><p class="section-label">Fulfillment</p><h2>Orders</h2></div></div>
        ${errorMessage ? `<p class="form-message error">Orders are not available yet: ${escapeHtml(errorMessage)}</p>` : ""}
        <div class="admin-card table-card">
          <table class="admin-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Checkout</th><th>Total</th><th>Created</th></tr></thead>
            <tbody>
              ${
                orders.length
                  ? orders
                      .map(
                        (order) => `
                          <tr>
                            <td><strong>${escapeHtml(order.orderNumber || order.id)}</strong></td>
                            <td>${escapeHtml(order.customerName || order.customerEmail)}</td>
                            <td><span class="status-pill">${escapeHtml(order.status)}</span></td>
                            <td>${escapeHtml(order.checkoutStatus)}</td>
                            <td>${escapeHtml(formatMoney(order.totalCents, order.currency || "EUR"))}</td>
                            <td>${escapeHtml(formatDate(order.createdAt))}</td>
                          </tr>
                        `
                      )
                      .join("")
                  : renderEmptyTableRow(
                      6,
                      "No orders yet",
                      "Orders will appear here after customers complete checkout or the API creates them."
                    )
              }
            </tbody>
          </table>
        </div>
      </section>
    `
  );
  setStatus(errorMessage ? "Orders could not be loaded." : `${orders.length} orders loaded.`);
}

export function renderShopConfigurationPage(config) {
  renderShopShell(
    "shop-configuration",
    `
      <section class="admin-section">
        <div class="section-heading-row"><div><p class="section-label">Configuration</p><h2>Shop module state</h2></div></div>
        ${renderInstalledModuleSummary({
          ...config,
          modules: Object.fromEntries(
            Object.entries(config.modules || {}).filter(([moduleId]) =>
              ["products", "orders", "payments", "notifications"].includes(moduleId)
            )
          )
        })}
      </section>
    `
  );
  setStatus("Shop configuration loaded.");
}

export function renderUsersPage(users) {
  renderAdminShell(
    { view: "users" },
    `
      <section class="admin-section">
        <div class="section-heading-row"><div><p class="section-label">Users</p><h1 class="dashboard-title">Users</h1></div>${hasPermission("invite", "users") ? '<button type="button" data-invite-user>Invite User</button>' : ""}</div>
        <div class="admin-card table-card">
          <table class="admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Roles</th></tr></thead>
            <tbody>
              ${
                users.length
                  ? users
                      .map(
                        (user) => `
                          <tr>
                            <td><a href="${escapeHtml(adminHref("user", user.id))}" data-dashboard-link>${escapeHtml(user.name || "No name")}</a></td>
                            <td>${escapeHtml(user.email)}</td>
                            <td>${escapeHtml(user.status)}</td>
                            <td>${escapeHtml(formatRoles(user))}</td>
                          </tr>
                        `
                      )
                      .join("")
                  : renderEmptyTableRow(
                      4,
                      "No users yet",
                      "Invite editors, managers, or operators when this project needs more people.",
                      hasPermission("invite", "users") ? '<button type="button" data-invite-user>Invite User</button>' : ""
                    )
              }
            </tbody>
          </table>
        </div>
      </section>
    `
  );
  setStatus(`${users.length} users loaded.`);
}

export function renderUserDetailPage(user) {
  renderAdminShell(
    { view: "user" },
    `
      <section class="admin-section narrow">
        <p class="section-label">User</p>
        <h1 class="dashboard-title">${escapeHtml(user.name || user.email)}</h1>
        <div class="admin-card detail-list">
          <div><span>Email</span><strong>${escapeHtml(user.email)}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(user.status)}</strong></div>
          <div><span>Roles</span><strong>${escapeHtml(formatRoles(user))}</strong></div>
          <div><span>Created</span><strong>${escapeHtml(user.createdAt || "")}</strong></div>
        </div>
      </section>
    `
  );
  setStatus("User loaded.");
}

function renderLocaleSettingsRows(locales = [], selectedDefaultLocale = "") {
  const defaultLocale = String(selectedDefaultLocale || locales[0]?.code || "en").toLowerCase();

  return locales
    .map(
      (locale) => `
        <div class="locale-row" data-locale-row>
          <label><span>Language</span><input name="localeLabel" value="${escapeHtml(locale.label || locale.code || "Language")}" list="locale-language-options" data-locale-language-input placeholder="Search language" /></label>
          <label><span>Code</span><input name="localeCode" value="${escapeHtml(locale.code || "en")}" data-locale-code-input placeholder="en" /></label>
          <label class="inline-check locale-default">
            <input type="radio" name="localeDefault" ${String(locale.code || "").toLowerCase() === defaultLocale ? "checked" : ""} />
            <span><strong aria-hidden="true">★</strong> Default</span>
          </label>
          <label class="inline-check locale-enabled">
            <input type="checkbox" name="localeEnabled" ${locale.enabled === false ? "" : "checked"} />
            <span>Enabled</span>
          </label>
          <button type="button" class="secondary-button" data-remove-locale-row>Remove</button>
        </div>
      `
    )
    .join("");
}

function renderLocaleLanguageOptions() {
  const languages = [
    ["English", "en"],
    ["Albanian", "sq"],
    ["German", "de"],
    ["French", "fr"],
    ["Italian", "it"],
    ["Spanish", "es"],
    ["Portuguese", "pt"],
    ["Dutch", "nl"],
    ["Turkish", "tr"],
    ["Croatian", "hr"],
    ["Serbian", "sr"],
    ["Bosnian", "bs"],
    ["Macedonian", "mk"],
    ["Greek", "el"],
    ["Polish", "pl"],
    ["Romanian", "ro"],
    ["Bulgarian", "bg"],
    ["Arabic", "ar"],
    ["Chinese", "zh"],
    ["Japanese", "ja"]
  ];

  return `
    <datalist id="locale-language-options">
      ${languages.map(([label, code]) => `<option value="${escapeHtml(label)}" label="${escapeHtml(code)}"></option>`).join("")}
    </datalist>
  `;
}

export function renderSettingsPage(config) {
  const settings = config.siteSettings || {};
  const storage = config.theme?.cms?.media || {};
  const storageDriver = config.storage?.driver || storage.productionDriver || "s3";
  const storageBucket = config.storage?.bucket || "Configured by deployment";
  const storagePrefix = config.storage?.keyPrefix || "sites/{website-slug}";
  const installedModules = new Map((config.installedModules || []).map((module) => [module.moduleId, module]));
  const localizationModule = installedModules.get("localization");
  const localizationEnabled = localizationModule?.status === "ENABLED";
  const localization = config.localization || localizationModule?.settings?.settings || {};
  const locales = Array.isArray(localization.locales) && localization.locales.length
    ? localization.locales
    : [{ code: localization.defaultLocale || "en", label: "English", enabled: true }];
  const stringRows = Object.entries(localization.strings || {})
    .flatMap(([key, translations]) =>
      Object.entries(translations || {}).map(([locale, text]) => `${key} | ${locale} | ${text}`)
    )
    .join("\n");

  renderAdminShell(
    { view: "settings" },
    `
      <section class="admin-section settings-workspace">
        <div class="section-heading-row">
          <div>
            <p class="section-label">Settings</p>
            <h1 class="dashboard-title">Site Settings</h1>
            <p class="dashboard-copy">Manage identity, style, media storage, and multilingual CMS behavior for this copied client project.</p>
          </div>
        </div>
        <div class="settings-tab-shell">
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-general" checked />
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-style" />
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-multilingual" />
          <nav class="admin-tabs settings-tabs" aria-label="Settings sections">
            <label for="settings-tab-general">General settings</label>
            <label for="settings-tab-style">Style</label>
            <label for="settings-tab-multilingual">Multilingual</label>
          </nav>
          <section class="settings-tab-panel settings-tab-panel-general" data-settings-panel="general">
            <form class="admin-card settings-form" data-site-settings-form>
              <label><span>Site title</span><input name="title" value="${escapeHtml(settings.title || config.app?.name || "Code Epsylon")}" required /></label>
              <label><span>Site description</span><textarea name="description" rows="3">${escapeHtml(settings.description || "")}</textarea></label>
              <label><span>Default meta title</span><input name="metaTitle" value="${escapeHtml(settings.metaTitle || settings.title || config.app?.name || "")}" /></label>
              <label><span>Default meta description</span><textarea name="metaDescription" rows="3">${escapeHtml(settings.metaDescription || "")}</textarea></label>
              <label>
                <span>Canonical site URL</span>
                <input name="siteUrl" type="url" value="${escapeHtml(settings.siteUrl || "")}" placeholder="https://www.example.com" />
                <small class="field-help">Used for sitemap, robots.txt, canonical URLs, and share metadata. Leave empty on local/dev.</small>
              </label>
              <div class="builder-form-grid">
                <label>
                  <span>Search indexing</span>
                  <select name="searchIndexing">
                    <option value="true"${settings.searchIndexing === false ? "" : " selected"}>Allow search engines</option>
                    <option value="false"${settings.searchIndexing === false ? " selected" : ""}>Hide from search engines</option>
                  </select>
                </label>
                <label>
                  <span>XML sitemap</span>
                  <select name="sitemapEnabled">
                    <option value="true"${settings.sitemapEnabled === false ? "" : " selected"}>Generate sitemap.xml</option>
                    <option value="false"${settings.sitemapEnabled === false ? " selected" : ""}>Disable sitemap.xml</option>
                  </select>
                </label>
              </div>
              <input type="hidden" name="customCss" value="${escapeHtml(settings.customCss || "")}" />
              ${renderFormMessage()}
              <div class="form-actions"><button type="submit">Save general settings</button></div>
            </form>
          </section>
          <section class="settings-tab-panel settings-tab-panel-style" data-settings-panel="style">
            <form class="admin-card settings-form" data-site-settings-form>
              <input type="hidden" name="title" value="${escapeHtml(settings.title || config.app?.name || "Code Epsylon")}" />
              <input type="hidden" name="description" value="${escapeHtml(settings.description || "")}" />
              <input type="hidden" name="metaTitle" value="${escapeHtml(settings.metaTitle || settings.title || config.app?.name || "")}" />
              <input type="hidden" name="metaDescription" value="${escapeHtml(settings.metaDescription || "")}" />
              <input type="hidden" name="siteUrl" value="${escapeHtml(settings.siteUrl || "")}" />
              <input type="hidden" name="searchIndexing" value="${settings.searchIndexing === false ? "false" : "true"}" />
              <input type="hidden" name="sitemapEnabled" value="${settings.sitemapEnabled === false ? "false" : "true"}" />
              <label>
                <span>Global CSS</span>
                <textarea name="customCss" rows="12" spellcheck="false" placeholder=".page-section { scroll-margin-top: 96px; }">${escapeHtml(settings.customCss || "")}</textarea>
                <small class="field-help">Applies to the public website. Use this for theme-level CSS, not one-off content edits.</small>
              </label>
              ${renderFormMessage()}
              <div class="form-actions"><button type="submit">Save style</button></div>
            </form>
            <div class="admin-card settings-info-card">
              <div>
                <p class="section-label">Media Storage</p>
                <h2>Website media folder</h2>
                <p class="dashboard-copy compact">This website can share the main Codey S3 bucket with other websites, but every website must use its own folder prefix.</p>
              </div>
              <div class="translation-help">
                <strong>How Codey keeps media separated</strong>
                <span>Uploads go through Codey media APIs. Codey writes files only under this website prefix, so AI-generated themes and editors should never upload directly to random S3 paths.</span>
              </div>
              <div class="module-status-row">
                <div>
                  <strong>Storage driver</strong>
                  <span>${escapeHtml(storageDriver)}</span>
                </div>
              </div>
              <div class="module-status-row">
                <div>
                  <strong>Shared bucket</strong>
                  <span>${escapeHtml(storageBucket)}</span>
                </div>
              </div>
              <div class="module-status-row">
                <div>
                  <strong>This website prefix</strong>
                  <span>${escapeHtml(storagePrefix)}</span>
                </div>
              </div>
              <div class="translation-help">
                <strong>Deployment rule</strong>
                <span>The platform may reuse the same S3 endpoint, bucket, and connection for many websites. It must generate a different <code>STORAGE_KEY_PREFIX</code> for every copied runtime, such as <code>sites/paiqi-metal</code>.</span>
              </div>
            </div>
          </section>
          <section class="settings-tab-panel settings-tab-panel-multilingual" data-settings-panel="multilingual">
            <div class="admin-card settings-form">
              ${renderLocaleLanguageOptions()}
              <div class="module-status-row">
                <div>
                  <strong>${localizationEnabled ? "Localization enabled" : "Localization disabled"}</strong>
                  <span>${localizationEnabled ? "Editors can manage translated CMS content." : "The site resolves content in the default language only."}</span>
                </div>
                <button type="button" data-localization-toggle="${localizationEnabled ? "disable" : "enable"}">
                  ${localizationEnabled ? "Disable" : "Enable"}
                </button>
              </div>
              <form data-localization-settings-form>
                <div class="locale-editor">
                  <div class="locale-editor-heading">
                    <div>
                      <span>Locales</span>
                      <small class="field-help">Search a language, confirm its code, and mark one row as default. The default language is also used as fallback.</small>
                    </div>
                    <button type="button" class="secondary-button" data-add-locale-row>Add locale</button>
                  </div>
                  <div class="locale-list" data-locale-list>
                    ${renderLocaleSettingsRows(locales, localization.defaultLocale || "en")}
                  </div>
                </div>
                <div class="translation-help">
                  <strong>Translation workflow</strong>
                  <span>Pages and posts show language filters, translation status, and create-translation actions. Global strings below handle shared labels that do not belong to one page.</span>
                </div>
                <label>
                  <span>Global strings</span>
                  <textarea name="strings" rows="10" spellcheck="false" placeholder="form.contact.submit | sq | Dërgo kërkesën">${escapeHtml(stringRows)}</textarea>
                  <small class="field-help">
                    One string per line: key | locale | text. Common keys: form.contact.name, form.contact.email, form.contact.submit, footer.copyright, shop.allProducts, shop.backToShop, shop.inStock.
                  </small>
                </label>
                <label class="inline-check">
                  <input type="checkbox" name="showLanguageSwitcher" ${localization.showLanguageSwitcher ? "checked" : ""} />
                  <span>Show language switcher on the public website</span>
                </label>
                <div class="settings-two-column">
                  <label>
                    <span>Header display</span>
                    <select name="languageSwitcherDisplay">
                      <option value="buttons"${localization.languageSwitcherDisplay === "dropdown" ? "" : " selected"}>Buttons</option>
                      <option value="dropdown"${localization.languageSwitcherDisplay === "dropdown" ? " selected" : ""}>Dropdown</option>
                    </select>
                  </label>
                  <label>
                    <span>Label style</span>
                    <select name="languageSwitcherLabelStyle">
                      <option value="full"${localization.languageSwitcherLabelStyle === "code" || localization.languageSwitcherLabelStyle === "icon" ? "" : " selected"}>Full name</option>
                      <option value="code"${localization.languageSwitcherLabelStyle === "code" ? " selected" : ""}>Short code</option>
                      <option value="icon"${localization.languageSwitcherLabelStyle === "icon" ? " selected" : ""}>Icon + code</option>
                    </select>
                  </label>
                </div>
                ${renderFormMessage()}
                <div class="form-actions"><button type="submit" ${localizationEnabled ? "" : "disabled"}>Save multilingual settings</button></div>
              </form>
            </div>
          </section>
        </div>
      </section>
    `
  );
  setStatus("Settings loaded.");
}
