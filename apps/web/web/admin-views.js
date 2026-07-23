import {
  escapeHtml,
  formatDate,
  formatMoney,
  formatRoles,
  hasAnyPermission,
  hasPermission,
  modulesEnabled,
  setStatus,
  state
} from "./core.js";
import { adminHref, publicPageHref, publicPostHref, publicProductHref } from "./routes.js";
import { renderComponentPalette } from "./public-renderer.js";
import { renderAdminShell, renderFormMessage } from "./ui.js";
import {
  cardStyleOptions,
  detailLayoutOptions,
  detailStyleOptions,
  normalizeShopSettings,
  shopLayoutOptions
} from "./shop-config.js";
import {
  designSystemDeclarations,
  designSystemPresets,
  normalizeDesignSystem
} from "./design-system.js";

function moduleAvailableInRuntime(config, moduleId) {
  if (moduleId === "localization") return config.features?.cms !== false;
  return config.features?.[moduleId] !== false;
}

function renderInstalledModuleSummary(config = {}) {
  const installedModules = new Map((config.installedModules || []).map((module) => [module.moduleId, module]));
  const modules = Object.values(config.modules || {});

  if (!modules.length) return '<p class="dashboard-copy">Module catalog is not available yet.</p>';

  return `
    <div class="module-grid">
      ${modules
        .map((module) => {
          const installed = installedModules.get(module.id);
          const enabled = moduleAvailableInRuntime(config, module.id) &&
            (installed?.status === "ENABLED" || module.required);

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
      modules: ["cms"],
      permissions: [["read", "cms"]]
    },
    {
      title: "Posts",
      body: "Prepare articles, updates, and content connected to site pages.",
      action: "Manage posts",
      href: "/dashboard/posts",
      modules: ["cms"],
      permissions: [["read", "cms"]]
    },
    {
      title: "Shop",
      body: "Review products, orders, and shop module configuration.",
      action: "Open shop",
      href: "/dashboard/shop",
      modules: ["products", "orders"],
      permissions: [["read", "products"], ["read", "orders"]]
    },
    {
      title: "Users",
      body: "Invite editors and review access for this client project.",
      action: "Manage users",
      href: "/dashboard/users",
      modules: ["users", "roles"],
      permissions: [["read", "users"]]
    }
  ].filter((action) =>
    modulesEnabled(action.modules) &&
    hasAnyPermission(action.permissions || [])
  );

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
          const enabled = moduleAvailableInRuntime(config, module.id) &&
            (installed?.status === "ENABLED" || module.required);

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
        <div class="section-heading-row profile-security-heading">
          <div><p class="section-label">Security</p><h2>Password</h2></div>
        </div>
        <form class="admin-card settings-form" data-change-password-form>
          <label>
            <span>Current password</span>
            <input name="currentPassword" type="password" autocomplete="current-password" maxlength="128" required />
          </label>
          <label>
            <span>New password</span>
            <input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required />
          </label>
          <label>
            <span>Confirm new password</span>
            <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required />
          </label>
          ${renderFormMessage()}
          <div class="form-actions"><button type="submit">Update password</button></div>
        </form>
        <div class="user-danger-zone" data-session-actions>
          <div><strong>Active sessions</strong><span>Revoke access for this browser and every other signed-in device.</span>${renderFormMessage()}</div>
          <button type="button" class="secondary-button danger" data-revoke-all-sessions>Sign out all sessions</button>
        </div>
      </section>
    `
  );
  setStatus("Profile loaded.");
}

export function renderPagesPage(pages, errorMessage = "", allPages = pages) {
  const canUpdatePages = hasPermission("update", "cms");
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
                            <td><a href="${escapeHtml(canUpdatePages ? hrefWithLocale(adminHref("page-builder", page.slug), page.locale) : publicHrefForPage(page))}" ${canUpdatePages ? "data-dashboard-link" : ""}><strong>${escapeHtml(page.title)}</strong></a></td>
                            <td>${escapeHtml(page.slug)}</td>
                            <td>${localeBadge(page)}</td>
                            <td><span class="status-pill">${escapeHtml(page.status)}</span></td>
                            <td>${translationStatusBadges(page, allPages)}</td>
                            <td>${escapeHtml(formatDate(page.updatedAt))}</td>
                            <td>
                              <a href="${escapeHtml(publicHrefForPage(page))}">View it</a>
                              ${canUpdatePages ? `
                                <span class="table-separator">/</span>
                                <a href="${escapeHtml(publicHrefForPage(page))}">Frontend editor</a>
                                <span class="table-separator">/</span>
                                <a href="${escapeHtml(hrefWithLocale(adminHref("page-builder", page.slug), page.locale))}" data-dashboard-link>Backend builder</a>
                              ` : ""}
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
  const tabs = [
    { view: "posts", href: "/dashboard/posts", label: "All Posts", permissions: [["read", "cms"]] },
    { view: "post-create", href: `/dashboard/posts/new${currentLocaleSuffix()}`, label: "New Post", permissions: [["create", "cms"]] },
    { view: "post-categories", href: "/dashboard/posts/categories", label: "Post Categories", permissions: [["read", "cms"]] }
  ].filter((tab) => hasAnyPermission(tab.permissions));

  renderAdminShell(
    { view: activeView },
    `
      <section class="admin-page-header">
        <div><p class="section-label">CMS</p><h1 class="dashboard-title">Posts</h1><p class="dashboard-copy">Manage articles, categories, and content that can be linked from pages.</p></div>
      </section>
      <nav class="admin-tabs" aria-label="Post sections">
        ${tabs
          .map((tab) => `<a href="${escapeHtml(tab.href)}" data-dashboard-link class="${tab.view === activeView ? "active" : ""}">${escapeHtml(tab.label)}</a>`)
          .join("")}
      </nav>
      ${content}
    `
  );
}

function renderPostsTable(posts, errorMessage = "", allPosts = posts) {
  const canUpdatePosts = hasPermission("update", "cms");
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
                            <td><a href="${escapeHtml(canUpdatePosts ? hrefWithLocale(adminHref("post-builder", post.slug), post.locale) : publicHrefForPost(post))}" ${canUpdatePosts ? "data-dashboard-link" : ""}><strong>${escapeHtml(post.title)}</strong></a></td>
                            <td>${escapeHtml(post.slug)}</td>
                            <td>${localeBadge(post)}</td>
                            <td><span class="status-pill">${escapeHtml(post.status)}</span></td>
                            <td>${translationStatusBadges(post, allPosts)}</td>
                            <td>${escapeHtml((post.categories || []).map((item) => item.name || item.category?.name).filter(Boolean).join(", ") || "Uncategorized")}</td>
                            <td>${escapeHtml(formatDate(post.updatedAt))}</td>
                            <td>
                              <a href="${escapeHtml(publicHrefForPost(post))}">View it</a>
                              ${canUpdatePosts ? `
                                <span class="table-separator">/</span>
                                <a href="${escapeHtml(hrefWithLocale(adminHref("post-builder", post.slug), post.locale))}" data-dashboard-link>Backend builder</a>
                              ` : ""}
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
                            <td>${hasPermission("update", "cms") ? `
                              <button type="button" class="link-button" data-edit-post-category="${escapeHtml(category.slug)}">Edit</button>
                              <button type="button" class="link-button danger" data-delete-post-category="${escapeHtml(category.slug)}">Delete</button>
                            ` : ""}</td>
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
    { view: "shop", href: "/dashboard/shop", label: "Overview", modules: ["products", "orders"], permissions: [["read", "products"], ["read", "orders"]] },
    { view: "shop-products", href: "/dashboard/shop/products", label: "Products", modules: ["products"], permissions: [["read", "products"]] },
    { view: "shop-categories", href: "/dashboard/shop/categories", label: "Categories", modules: ["products"], permissions: [["read", "products"]] },
    { view: "shop-attributes", href: "/dashboard/shop/attributes", label: "Attributes", modules: ["products"], permissions: [["read", "products"]] },
    { view: "shop-orders", href: "/dashboard/shop/orders", label: "Orders", modules: ["orders"], permissions: [["read", "orders"]] },
    { view: "shop-configuration", href: "/dashboard/shop/configuration", label: "Customize", modules: ["products"], permissions: [["read", "products"], ["read", "payments"], ["read", "modules"]] }
  ].filter((tab) => modulesEnabled(tab.modules) && hasAnyPermission(tab.permissions));

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
      modules: ["products"],
      permissions: [["read", "products"]]
    },
    {
      href: "/dashboard/shop/orders",
      title: "Orders",
      body: "Review customer orders, checkout state, and queued notifications.",
      modules: ["orders"],
      permissions: [["read", "orders"]]
    },
    {
      href: "/dashboard/shop/categories",
      title: "Categories",
      body: "Manage catalog taxonomy and product archive pages.",
      modules: ["products"],
      permissions: [["read", "products"]]
    },
    {
      href: "/dashboard/shop/attributes",
      title: "Attributes",
      body: "Define reusable technical attributes and filter values.",
      modules: ["products"],
      permissions: [["read", "products"]]
    },
    {
      href: "/dashboard/shop/configuration",
      title: "Customize storefront",
      body: "Choose catalog layouts, product card styles, and visible details.",
      modules: ["products"],
      permissions: [["read", "products"], ["read", "payments"], ["read", "modules"]]
    }
  ].filter((action) => modulesEnabled(action.modules) && hasAnyPermission(action.permissions));

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
  const canUpdateProducts = hasPermission("update", "products");
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
                            <td><a href="${escapeHtml(canUpdateProducts ? adminHref("product-editor", product.slug) : publicHrefForProduct(product))}" ${canUpdateProducts ? "data-dashboard-link" : ""}><strong>${escapeHtml(product.name)}</strong></a></td>
                            <td>${escapeHtml(product.slug)}</td>
                            <td><span class="status-pill">${escapeHtml(product.status)}</span></td>
                            <td>${escapeHtml(formatMoney(product.priceCents, product.currency || "EUR"))}</td>
                            <td>${escapeHtml(product.stockQuantity)}</td>
                            <td>${escapeHtml(formatDate(product.updatedAt))}</td>
                            <td>
                              <a href="${escapeHtml(publicHrefForProduct(product))}">View it</a>
                              ${canUpdateProducts ? `
                                <span class="table-separator">/</span>
                                <a href="${escapeHtml(adminHref("product-editor", product.slug))}" data-dashboard-link>Edit</a>
                              ` : ""}
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
                            <td>${hasPermission("update", "products") ? `
                              <button type="button" class="link-button" data-edit-product-category="${escapeHtml(category.slug)}">Edit</button>
                              <button type="button" class="link-button danger" data-delete-product-category="${escapeHtml(category.slug)}">Delete</button>
                            ` : ""}</td>
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
                            <td>${hasPermission("update", "products") ? `
                              <button type="button" class="link-button" data-edit-product-attribute="${escapeHtml(attribute.slug)}">Edit</button>
                              <button type="button" class="link-button danger" data-delete-product-attribute="${escapeHtml(attribute.slug)}">Delete</button>
                            ` : ""}</td>
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

function paymentForOrder(payments, orderId) {
  return payments.find((payment) => payment.orderId === orderId) || null;
}

function manualPaymentActions(payment) {
  if (!payment || payment.provider !== "MANUAL" || !hasPermission("update", "payments")) return "";

  if (["PENDING", "REQUIRES_ACTION"].includes(payment.status)) {
    return `
      <div class="payment-order-actions">
        <button type="button" class="link-button" data-manual-payment-action="SUCCEED" data-payment-id="${escapeHtml(payment.id)}">Mark paid</button>
        <button type="button" class="link-button danger" data-manual-payment-action="FAIL" data-payment-id="${escapeHtml(payment.id)}">Mark failed</button>
      </div>
    `;
  }

  if (payment.status === "SUCCEEDED") {
    return `<button type="button" class="link-button danger" data-manual-payment-action="REFUND" data-payment-id="${escapeHtml(payment.id)}">Mark refunded</button>`;
  }

  return "";
}

export function renderShopOrdersPage(orders, payments = [], errorMessage = "") {
  renderShopShell(
    "shop-orders",
    `
      <section class="admin-section">
        <div class="section-heading-row"><div><p class="section-label">Fulfillment</p><h2>Orders</h2></div></div>
        ${errorMessage ? `<p class="form-message error">Orders are not available yet: ${escapeHtml(errorMessage)}</p>` : ""}
        <div class="admin-card table-card">
          <table class="admin-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Payment</th><th>Total</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              ${
                orders.length
                  ? orders
                      .map((order) => {
                        const payment = paymentForOrder(payments, order.id);
                        return `
                          <tr>
                            <td><strong>${escapeHtml(order.orderNumber || order.id)}</strong></td>
                            <td>${escapeHtml(order.customerName || order.customerEmail)}</td>
                            <td><span class="status-pill">${escapeHtml(order.status)}</span></td>
                            <td>${payment
                              ? `<strong>${escapeHtml(payment.provider)}</strong><small class="payment-order-status">${escapeHtml(payment.status)}</small>`
                              : escapeHtml(order.checkoutStatus)}</td>
                            <td>${escapeHtml(formatMoney(order.totalCents, order.currency || "EUR"))}</td>
                            <td>${escapeHtml(formatDate(order.createdAt))}</td>
                            <td>${manualPaymentActions(payment)}</td>
                          </tr>
                        `;
                      })
                      .join("")
                  : renderEmptyTableRow(
                      7,
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

function paymentProviderConfig(providers, provider) {
  return providers.find((item) => item.provider === provider) || {
    provider,
    mode: "SANDBOX",
    enabled: false,
    ready: false,
    canEnable: false,
    missingFields: []
  };
}

function providerStatus(config) {
  if (config.enabled) return '<span class="status-pill success">Enabled</span>';
  if (config.lastTestSucceeded === false) return '<span class="status-pill error">Test failed</span>';
  if (config.lastTestSucceeded === true) return '<span class="status-pill">Ready</span>';
  return '<span class="status-pill">Disabled</span>';
}

function secretField({ name, label, configured, placeholder, clearName }, disabled = false) {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <input type="password" name="${escapeHtml(name)}" autocomplete="new-password" spellcheck="false" placeholder="${escapeHtml(configured ? "Configured - leave blank to keep" : placeholder)}" ${disabled ? "disabled" : ""} />
    </label>
    ${configured
      ? `<label class="payment-clear-secret"><input type="checkbox" name="${escapeHtml(clearName)}" ${disabled ? "disabled" : ""} /> <span>Remove saved ${escapeHtml(label.toLowerCase())}</span></label>`
      : ""}
  `;
}

function providerModeControl(config, disabled = false) {
  return `
    <fieldset class="payment-mode-control" ${disabled ? "disabled" : ""}>
      <legend>Environment</legend>
      <label><input type="radio" name="mode" value="SANDBOX" ${config.mode !== "LIVE" ? "checked" : ""} /><span>Sandbox</span></label>
      <label><input type="radio" name="mode" value="LIVE" ${config.mode === "LIVE" ? "checked" : ""} /><span>Live</span></label>
    </fieldset>
  `;
}

function webhookEndpoint(url, events) {
  return `
    <div class="payment-webhook-box">
      <div><span>Webhook endpoint</span><small>${escapeHtml(events)}</small></div>
      <div class="payment-webhook-copy">
        <input type="text" readonly value="${escapeHtml(url || "")}" aria-label="Webhook endpoint" />
        <button type="button" class="secondary-button" data-copy-payment-webhook="${escapeHtml(url || "")}">Copy</button>
      </div>
    </div>
  `;
}

function providerHealth(config) {
  const tested = config.lastTestedAt
    ? `${config.lastTestSucceeded ? "Connection passed" : "Connection failed"} ${formatDate(config.lastTestedAt)}`
    : "Connection not tested";
  const webhook = config.lastWebhookAt
    ? `Last verified webhook ${formatDate(config.lastWebhookAt)}`
    : "No verified webhook received";

  return `
    <div class="payment-provider-health">
      <span>${escapeHtml(tested)}</span>
      <span>${escapeHtml(webhook)}</span>
      ${config.lastTestMessage ? `<small>${escapeHtml(config.lastTestMessage)}</small>` : ""}
    </div>
  `;
}

function renderStripeProvider(config, webhookUrl, canUpdate) {
  return `
    <article class="admin-card payment-provider-card">
      <header><div><p class="section-label">Card payments</p><h3>Stripe</h3></div>${providerStatus(config)}</header>
      <form class="settings-form payment-provider-form" data-payment-provider-form="STRIPE"
        data-current-mode="${escapeHtml(config.mode || "SANDBOX")}" data-current-public-key="${escapeHtml(config.publishableKey || "")}">
        ${providerModeControl(config, !canUpdate)}
        <label><span>Publishable key</span><input name="publishableKey" spellcheck="false" autocomplete="off" value="${escapeHtml(config.publishableKey || "")}" placeholder="pk_test_..." ${canUpdate ? "" : "disabled"} /></label>
        ${secretField({ name: "secretKey", label: "Secret key", configured: config.secretKeyConfigured, placeholder: "sk_test_...", clearName: "clearSecretKey" }, !canUpdate)}
        ${secretField({ name: "webhookSecret", label: "Webhook signing secret", configured: config.webhookSecretConfigured, placeholder: "whsec_...", clearName: "clearWebhookSecret" }, !canUpdate)}
        ${webhookEndpoint(webhookUrl, "payment_intent.succeeded, payment_intent.payment_failed, payment_intent.canceled, charge.refunded")}
        ${providerHealth(config)}
        <label class="payment-enable-toggle"><input type="checkbox" name="enabled" ${config.enabled ? "checked" : ""} ${!canUpdate || (!config.enabled && !config.canEnable) ? "disabled" : ""} /><span>Accept new Stripe payments</span></label>
        <p class="form-message" data-form-message>${config.canEnable || config.enabled ? "Configuration is ready." : "Save credentials and run a successful connection test before enabling."}</p>
        ${canUpdate ? `<div class="payment-provider-actions"><button type="button" class="secondary-button" data-test-payment-provider="STRIPE" ${!config.ready ? "disabled" : ""}>Test connection</button><button type="submit">Save Stripe</button></div>` : ""}
      </form>
    </article>
  `;
}

function renderPayPalProvider(config, webhookUrl, canUpdate) {
  return `
    <article class="admin-card payment-provider-card">
      <header><div><p class="section-label">Wallet payments</p><h3>PayPal</h3></div>${providerStatus(config)}</header>
      <form class="settings-form payment-provider-form" data-payment-provider-form="PAYPAL"
        data-current-mode="${escapeHtml(config.mode || "SANDBOX")}" data-current-client-id="${escapeHtml(config.clientId || "")}" data-current-webhook-id="${escapeHtml(config.webhookId || "")}">
        ${providerModeControl(config, !canUpdate)}
        <label><span>Client ID</span><input name="clientId" spellcheck="false" autocomplete="off" value="${escapeHtml(config.clientId || "")}" ${canUpdate ? "" : "disabled"} /></label>
        ${secretField({ name: "clientSecret", label: "Client secret", configured: config.clientSecretConfigured, placeholder: "PayPal client secret", clearName: "clearClientSecret" }, !canUpdate)}
        <label><span>Webhook ID</span><input name="webhookId" spellcheck="false" autocomplete="off" value="${escapeHtml(config.webhookId || "")}" placeholder="Webhook ID from PayPal" ${canUpdate ? "" : "disabled"} /></label>
        ${webhookEndpoint(webhookUrl, "PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.DENIED, CHECKOUT.ORDER.VOIDED, PAYMENT.CAPTURE.REFUNDED")}
        ${providerHealth(config)}
        <label class="payment-enable-toggle"><input type="checkbox" name="enabled" ${config.enabled ? "checked" : ""} ${!canUpdate || (!config.enabled && !config.canEnable) ? "disabled" : ""} /><span>Accept new PayPal payments</span></label>
        <p class="form-message" data-form-message>${config.canEnable || config.enabled ? "Configuration is ready." : "Save credentials and run a successful connection test before enabling."}</p>
        ${canUpdate ? `<div class="payment-provider-actions"><button type="button" class="secondary-button" data-test-payment-provider="PAYPAL" ${!config.ready ? "disabled" : ""}>Test connection</button><button type="submit">Save PayPal</button></div>` : ""}
      </form>
    </article>
  `;
}

function renderManualProvider(config, canUpdate) {
  return `
    <article class="admin-card payment-provider-card payment-provider-card-manual">
      <header><div><p class="section-label">Offline payments</p><h3>Manual</h3></div>${providerStatus(config)}</header>
      <form class="settings-form payment-provider-form" data-payment-provider-form="MANUAL">
        <label><span>Customer instructions</span><textarea name="instructions" rows="4" placeholder="Bank transfer or payment-on-delivery instructions" ${canUpdate ? "" : "disabled"}>${escapeHtml(config.instructions || "Contact us to arrange payment.")}</textarea></label>
        <label class="payment-enable-toggle"><input type="checkbox" name="enabled" ${config.enabled ? "checked" : ""} ${canUpdate ? "" : "disabled"} /><span>Offer manual payment at checkout</span></label>
        <p class="form-message" data-form-message>Manual payments remain pending until an authorized user marks the order paid.</p>
        ${canUpdate ? '<div class="payment-provider-actions"><button type="submit">Save manual payment</button></div>' : ""}
      </form>
    </article>
  `;
}

function renderShopSettingsChoices(label, name, options, selectedValue, disabled = false) {
  return `
    <fieldset class="shop-settings-fieldset">
      <legend>${escapeHtml(label)}</legend>
      <div class="shop-settings-choice-grid">
        ${options.map((option) => `
          <label class="shop-settings-choice">
            <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}"${option.value === selectedValue ? " checked" : ""}${disabled ? " disabled" : ""} />
            <span>
              <i class="shop-choice-visual shop-choice-${escapeHtml(option.value)}" aria-hidden="true"><i></i><i></i><i></i></i>
              <strong>${escapeHtml(option.label)}</strong>
              <small>${escapeHtml(option.body)}</small>
            </span>
          </label>
        `).join("")}
      </div>
    </fieldset>
  `;
}

function renderShopSettingsPreview(settings) {
  const products = ["Studio Chair", "Task Lamp", "Storage Unit"];

  return `
    <aside class="shop-preview-column">
      <div class="shop-preview-heading">
        <div><p class="section-label">Live preview</p><h3>Catalog</h3></div>
        <a href="/shop" target="_blank" rel="noopener">Open shop</a>
      </div>
      <div class="shop-settings-preview" data-shop-preview data-catalog-layout="${escapeHtml(settings.catalogLayout)}" data-card-style="${escapeHtml(settings.cardStyle)}">
        <header>
          <span>Catalog</span>
          <strong data-shop-preview-title>${escapeHtml(settings.catalogTitle)}</strong>
          <p data-shop-preview-description>${escapeHtml(settings.catalogDescription)}</p>
        </header>
        <div class="shop-preview-filters" data-shop-preview-filters${!settings.showCategories && !settings.showAttributes ? " hidden" : ""}>
          <span>All</span><span>Featured</span><span>New</span>
        </div>
        <div class="shop-preview-products">
          ${products.map((name, index) => `
            <article>
              <div class="shop-preview-image"><span>${index + 1}</span></div>
              <small>Collection</small>
              <strong>${escapeHtml(name)}</strong>
              <p data-shop-preview-sku${settings.showSku ? "" : " hidden"}>SKU-00${index + 1}</p>
              <footer><b>${escapeHtml(formatMoney((index + 1) * 2500, "EUR"))}</b><span data-shop-preview-stock${settings.showStock ? "" : " hidden"}>In stock</span></footer>
            </article>
          `).join("")}
        </div>
      </div>
    </aside>
  `;
}

function renderStorefrontSettings(settings, canUpdate) {
  return `
    <form class="settings-form shop-customization-form" data-shop-settings-form>
      <div class="shop-customization-grid">
        <div class="shop-customization-controls">
          <section class="shop-customization-section">
            <div><p class="section-label">Header</p><h3>Shop introduction</h3></div>
            <label><span>Shop title</span><input name="catalogTitle" value="${escapeHtml(settings.catalogTitle)}" maxlength="120" required ${canUpdate ? "" : "disabled"} /></label>
            <label><span>Description</span><textarea name="catalogDescription" rows="3" maxlength="500" ${canUpdate ? "" : "disabled"}>${escapeHtml(settings.catalogDescription)}</textarea></label>
          </section>

          <section class="shop-customization-section">
            <div><p class="section-label">Catalog</p><h3>Product listing</h3></div>
            ${renderShopSettingsChoices("Layout", "catalogLayout", shopLayoutOptions, settings.catalogLayout, !canUpdate)}
            ${renderShopSettingsChoices("Card style", "cardStyle", cardStyleOptions, settings.cardStyle, !canUpdate)}
            <label class="shop-products-per-page"><span>Products per page</span><input name="productsPerPage" type="number" min="8" max="48" step="1" value="${escapeHtml(settings.productsPerPage)}" ${canUpdate ? "" : "disabled"} /></label>
          </section>

          <section class="shop-customization-section">
            <div><p class="section-label">Product page</p><h3>Product details</h3></div>
            ${renderShopSettingsChoices("Layout", "detailLayout", detailLayoutOptions, settings.detailLayout, !canUpdate)}
            ${renderShopSettingsChoices("Visual style", "detailStyle", detailStyleOptions, settings.detailStyle, !canUpdate)}
          </section>

          <section class="shop-customization-section">
            <div><p class="section-label">Visibility</p><h3>Customer information</h3></div>
            <div class="shop-visibility-grid">
              <label class="checkbox-field"><input type="checkbox" name="showCategories" ${settings.showCategories ? "checked" : ""} ${canUpdate ? "" : "disabled"} /><span>Category filters</span></label>
              <label class="checkbox-field"><input type="checkbox" name="showAttributes" ${settings.showAttributes ? "checked" : ""} ${canUpdate ? "" : "disabled"} /><span>Attribute filters</span></label>
              <label class="checkbox-field"><input type="checkbox" name="showSku" ${settings.showSku ? "checked" : ""} ${canUpdate ? "" : "disabled"} /><span>Product SKU</span></label>
              <label class="checkbox-field"><input type="checkbox" name="showStock" ${settings.showStock ? "checked" : ""} ${canUpdate ? "" : "disabled"} /><span>Stock status</span></label>
            </div>
          </section>

          ${canUpdate ? '<div class="shop-customization-actions"><button type="submit">Save storefront</button></div>' : '<p class="form-message error">You do not have permission to update product settings.</p>'}
          ${renderFormMessage()}
        </div>
        ${renderShopSettingsPreview(settings)}
      </div>
    </form>
  `;
}

export function renderShopConfigurationPage(config, shopSettings = {}, paymentConfig = {}, errorMessage = "") {
  const providers = paymentConfig.providers || [];
  const urls = paymentConfig.webhookUrls || {};
  const stripe = paymentProviderConfig(providers, "STRIPE");
  const paypal = paymentProviderConfig(providers, "PAYPAL");
  const manual = paymentProviderConfig(providers, "MANUAL");
  const settings = normalizeShopSettings(shopSettings);
  const canUpdateShop = hasPermission("update", "products");
  const canReadPayments = hasPermission("read", "payments");
  const canUpdatePayments = hasPermission("update", "payments");

  renderShopShell(
    "shop-configuration",
    `
      <section class="admin-section shop-settings-workspace">
        <div class="section-heading-row"><div><p class="section-label">Customize</p><h2>Shop experience</h2><p class="dashboard-copy">Set the storefront once. Individual products only contain product-specific information.</p></div></div>
        <div class="shop-settings-tab-shell">
          <input class="settings-tab-input shop-settings-tab-input" type="radio" name="shop-settings-tab" id="shop-tab-storefront" checked />
          <input class="settings-tab-input shop-settings-tab-input" type="radio" name="shop-settings-tab" id="shop-tab-payments" />
          <input class="settings-tab-input shop-settings-tab-input" type="radio" name="shop-settings-tab" id="shop-tab-system" />
          <nav class="admin-tabs shop-settings-tabs" aria-label="Shop settings sections">
            <label for="shop-tab-storefront">Storefront</label>
            <label for="shop-tab-payments">Payments</label>
            <label for="shop-tab-system">System</label>
          </nav>

          <section class="shop-settings-tab-panel shop-settings-tab-panel-storefront">
            ${renderStorefrontSettings(settings, canUpdateShop)}
          </section>

          <section class="shop-settings-tab-panel shop-settings-tab-panel-payments payment-configuration-section">
            <div class="section-heading-row"><div><p class="section-label">Checkout</p><h2>Payment providers</h2><p class="dashboard-copy">Credentials are encrypted and stored for this site. Saved secrets are never displayed again.</p></div></div>
            ${errorMessage ? `<p class="form-message error">Payment settings are not available: ${escapeHtml(errorMessage)}</p>` : ""}
            ${canReadPayments && !errorMessage
              ? `<div class="payment-provider-grid">
                  ${renderStripeProvider(stripe, urls.stripe, canUpdatePayments)}
                  ${renderPayPalProvider(paypal, urls.paypal, canUpdatePayments)}
                  ${renderManualProvider(manual, canUpdatePayments)}
                </div>`
              : !errorMessage ? '<p class="form-message error">You do not have permission to view payment settings.</p>' : ""}
          </section>

          <section class="shop-settings-tab-panel shop-settings-tab-panel-system">
            <div class="section-heading-row"><div><p class="section-label">System</p><h2>Shop module state</h2></div></div>
            ${renderInstalledModuleSummary({
              ...config,
              modules: Object.fromEntries(
                Object.entries(config.modules || {}).filter(([moduleId]) =>
                  ["products", "orders", "payments", "notifications"].includes(moduleId)
                )
              )
            })}
          </section>
        </div>
      </section>
    `
  );
  setStatus("Shop configuration loaded.");
}

function userStatusBadge(status) {
  const className = status === "ACTIVE" ? "success" : status === "SUSPENDED" ? "error" : "";
  return `<span class="status-pill ${className}">${escapeHtml(status || "UNKNOWN")}</span>`;
}

function userListHref(page, filters = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();

  return query ? `/dashboard/users?${query}` : "/dashboard/users";
}

function renderUserPagination(pagination, filters) {
  if (!pagination || pagination.pages <= 1) return "";

  return `
    <nav class="admin-pagination" aria-label="User list pages">
      <a class="secondary-button${pagination.page <= 1 ? " disabled" : ""}" href="${escapeHtml(userListHref(Math.max(1, pagination.page - 1), filters))}" data-dashboard-link aria-disabled="${pagination.page <= 1 ? "true" : "false"}">Previous</a>
      <span>Page ${escapeHtml(pagination.page)} of ${escapeHtml(pagination.pages)}</span>
      <a class="secondary-button${pagination.page >= pagination.pages ? " disabled" : ""}" href="${escapeHtml(userListHref(Math.min(pagination.pages, pagination.page + 1), filters))}" data-dashboard-link aria-disabled="${pagination.page >= pagination.pages ? "true" : "false"}">Next</a>
    </nav>
  `;
}

function renderPendingInvites(invites, errorMessage = "") {
  if (!hasPermission("invite", "users")) return "";

  return `
    <section class="admin-section">
      <div class="section-heading-row">
        <div><p class="section-label">Onboarding</p><h2>Pending invitations</h2></div>
      </div>
      ${errorMessage ? `<p class="form-message error" role="alert">${escapeHtml(errorMessage)}</p>` : ""}
      <div class="admin-card table-card">
        <table class="admin-table">
          <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th>Invited by</th><th>Actions</th></tr></thead>
          <tbody>
            ${invites.length
              ? invites.map((invite) => `
                  <tr>
                    <td><strong>${escapeHtml(invite.email)}</strong></td>
                    <td>${escapeHtml((invite.roleNames || []).join(", ") || "No role")}</td>
                    <td>${escapeHtml(formatDate(invite.expiresAt))}</td>
                    <td>${escapeHtml(invite.invitedBy?.name || invite.invitedBy?.email || "System")}</td>
                    <td>
                      <div class="table-actions">
                        <button type="button" class="link-button" data-resend-user-invite="${escapeHtml(invite.id)}" data-invite-email="${escapeHtml(invite.email)}">Resend</button>
                        <button type="button" class="link-button danger" data-revoke-user-invite="${escapeHtml(invite.id)}" data-invite-email="${escapeHtml(invite.email)}">Revoke</button>
                      </div>
                    </td>
                  </tr>
                `).join("")
              : renderEmptyTableRow(5, "No pending invitations", "New invitations will appear here until they are accepted or revoked.")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function canCreateUserInvites() {
  return hasPermission("invite", "users") && hasPermission("read", "roles");
}

export function renderUsersPage(users, options = {}) {
  const filters = options.filters || {};
  const pagination = options.pagination;
  const invites = options.invites || [];
  renderAdminShell(
    { view: "users" },
    `
      <section class="admin-section">
        <div class="section-heading-row"><div><p class="section-label">Users</p><h1 class="dashboard-title">Users</h1></div>${canCreateUserInvites() ? '<button type="button" data-invite-user>Invite User</button>' : ""}</div>
        <form class="user-filter-form" data-user-filter-form>
          <label>
            <span class="visually-hidden">Search users</span>
            <input name="search" type="search" value="${escapeHtml(filters.search || "")}" placeholder="Search name or email" />
          </label>
          <label>
            <span class="visually-hidden">Filter by status</span>
            <select name="status">
              <option value="">All statuses</option>
              ${["ACTIVE", "INVITED", "SUSPENDED"].map((status) => `<option value="${status}"${filters.status === status ? " selected" : ""}>${status}</option>`).join("")}
            </select>
          </label>
          <button type="submit">Apply filters</button>
          ${(filters.search || filters.status) ? '<a class="secondary-button" href="/dashboard/users" data-dashboard-link>Clear</a>' : ""}
        </form>
        ${options.errorMessage ? `<p class="form-message error" role="alert">${escapeHtml(options.errorMessage)}</p>` : ""}
        <div class="admin-card table-card">
          <table class="admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Roles</th><th>Last login</th><th>Actions</th></tr></thead>
            <tbody>
              ${
                users.length
                  ? users
                      .map(
                        (user) => `
                          <tr>
                            <td><a href="${escapeHtml(adminHref("user", user.id))}" data-dashboard-link>${escapeHtml(user.name || "No name")}</a></td>
                            <td>${escapeHtml(user.email)}</td>
                            <td>${userStatusBadge(user.status)}</td>
                            <td>${escapeHtml(formatRoles(user))}</td>
                            <td>${escapeHtml(formatDate(user.lastLoginAt))}</td>
                            <td><div class="table-actions"><a href="${escapeHtml(adminHref("user", user.id))}" data-dashboard-link>View</a>${hasPermission("update", "users") ? `<a href="${escapeHtml(adminHref("user-edit", user.id))}" data-dashboard-link>Edit</a>` : ""}</div></td>
                          </tr>
                        `
                      )
                      .join("")
                  : renderEmptyTableRow(
                      6,
                      "No users yet",
                      filters.search || filters.status ? "No users match the current filters." : "Invite editors, managers, or operators when this project needs more people.",
                      canCreateUserInvites() ? '<button type="button" data-invite-user>Invite User</button>' : ""
                    )
              }
            </tbody>
          </table>
        </div>
        ${renderUserPagination(pagination, filters)}
      </section>
      ${renderPendingInvites(invites, options.inviteError)}
    `
  );
  setStatus(options.errorMessage ? options.errorMessage : `${pagination?.total ?? users.length} users loaded.`, Boolean(options.errorMessage));
}

export function renderUserDetailPage(user) {
  const canEdit = hasPermission("update", "users");
  const canDelete = hasPermission("delete", "users") && user.id !== state.user?.id;
  renderAdminShell(
    { view: "user" },
    `
      <section class="admin-section narrow">
        <div class="section-heading-row">
          <div><p class="section-label">User</p><h1 class="dashboard-title">${escapeHtml(user.name || user.email)}</h1></div>
          <div class="button-row">
            <a class="secondary-button" href="/dashboard/users" data-dashboard-link>Back</a>
            ${canEdit ? `<a class="admin-primary-link" href="${escapeHtml(adminHref("user-edit", user.id))}" data-dashboard-link>Edit user</a>` : ""}
          </div>
        </div>
        <div class="admin-card detail-list">
          <div><span>Email</span><strong>${escapeHtml(user.email)}</strong></div>
          <div><span>Status</span><strong>${userStatusBadge(user.status)}</strong></div>
          <div><span>Roles</span><strong>${escapeHtml(formatRoles(user))}</strong></div>
          <div><span>Email verified</span><strong>${escapeHtml(formatDate(user.emailVerifiedAt))}</strong></div>
          <div><span>Last login</span><strong>${escapeHtml(formatDate(user.lastLoginAt))}</strong></div>
          <div><span>Created</span><strong>${escapeHtml(formatDate(user.createdAt))}</strong></div>
          <div><span>Updated</span><strong>${escapeHtml(formatDate(user.updatedAt))}</strong></div>
        </div>
        ${canDelete ? `<div class="user-danger-zone"><div><strong>Delete user</strong><span>Removes the account and invalidates all active sessions.</span></div><button type="button" class="secondary-button danger" data-delete-user="${escapeHtml(user.id)}" data-user-email="${escapeHtml(user.email)}">Delete user</button></div>` : ""}
      </section>
    `
  );
  setStatus("User loaded.");
}

export function renderUserEditPage(user, roles = [], options = {}) {
  const currentRoleIds = new Set((user.roles || []).map((item) => item.role?.id).filter(Boolean));
  const isCurrentUser = user.id === state.user?.id;
  const canEditRoles = !isCurrentUser && roles.length > 0;
  const canDelete = hasPermission("delete", "users") && !isCurrentUser;

  renderAdminShell(
    { view: "user-edit", userId: user.id },
    `
      <section class="admin-section narrow">
        <div class="section-heading-row">
          <div><p class="section-label">Users</p><h1 class="dashboard-title">Edit ${escapeHtml(user.name || user.email)}</h1></div>
          <a class="secondary-button" href="${escapeHtml(adminHref("user", user.id))}" data-dashboard-link>Cancel</a>
        </div>
        <form class="admin-card settings-form user-edit-form" data-user-edit-form data-user-id="${escapeHtml(user.id)}" data-user-status-editable="${isCurrentUser ? "false" : "true"}" data-user-roles-editable="${canEditRoles ? "true" : "false"}">
          <label>
            <span>Name</span>
            <input name="name" value="${escapeHtml(user.name || "")}" maxlength="120" required />
          </label>
          <label>
            <span>Email</span>
            <input value="${escapeHtml(user.email)}" type="email" readonly />
            <small class="field-help">Email addresses are fixed after account creation. Re-invite the user to change ownership of an address.</small>
          </label>
          <label>
            <span>Status</span>
            <select name="status" ${isCurrentUser ? "disabled" : ""}>
              <option value="ACTIVE"${user.status === "ACTIVE" || user.status === "INVITED" ? " selected" : ""}>Active</option>
              <option value="SUSPENDED"${user.status === "SUSPENDED" ? " selected" : ""}>Suspended</option>
            </select>
            ${isCurrentUser ? '<small class="field-help">Another administrator must change your account status.</small>' : '<small class="field-help">Suspending a user immediately revokes active sessions.</small>'}
          </label>
          <fieldset class="user-role-fieldset" ${canEditRoles ? "" : "disabled"}>
            <legend>Roles</legend>
            <div class="user-role-options">
              ${(roles.length ? roles : user.roles.map((item) => item.role).filter(Boolean)).map((role) => `
                <label class="user-role-option">
                  <input name="roleIds" type="checkbox" value="${escapeHtml(role.id)}" ${currentRoleIds.has(role.id) ? "checked" : ""} />
                  <span><strong>${escapeHtml(role.name)}</strong>${role.description ? `<small>${escapeHtml(role.description)}</small>` : ""}</span>
                </label>
              `).join("")}
            </div>
            ${isCurrentUser ? '<small class="field-help">Another administrator must change your roles.</small>' : options.rolesError ? `<small class="field-help error">${escapeHtml(options.rolesError)}</small>` : !roles.length ? '<small class="field-help">Role options are unavailable for this account.</small>' : ""}
          </fieldset>
          ${renderFormMessage("Update the account details, status, or access roles.")}
          <div class="form-actions"><button type="submit">Save user</button></div>
        </form>
        ${canDelete ? `<div class="user-danger-zone"><div><strong>Delete user</strong><span>This action permanently removes the account.</span></div><button type="button" class="secondary-button danger" data-delete-user="${escapeHtml(user.id)}" data-user-email="${escapeHtml(user.email)}">Delete user</button></div>` : ""}
      </section>
    `
  );
  setStatus("User editor loaded.");
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

function designSelectOptions(options, selected) {
  return options
    .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
}

function renderDesignColor(name, label, value) {
  const inputId = `design-color-${name.replace(/[^a-z0-9]+/gi, "-")}`;

  return `
    <div class="design-color-control">
      <label for="${escapeHtml(inputId)}"><span>${escapeHtml(label)}</span></label>
      <span class="design-color-input">
        <input id="${escapeHtml(inputId)}" type="color" name="${escapeHtml(name)}" value="${escapeHtml(value)}" aria-label="${escapeHtml(label)} color picker" />
        <input type="text" value="${escapeHtml(value.toUpperCase())}" data-design-color-text-for="${escapeHtml(name)}" aria-label="${escapeHtml(label)} hex value" pattern="#?[0-9A-Fa-f]{6}" maxlength="7" autocomplete="off" spellcheck="false" />
      </span>
    </div>
  `;
}

function renderDesignRange(name, label, value, min, max, step, unit) {
  return `
    <label class="design-range-control">
      <span>${escapeHtml(label)} <output data-design-value-for="${escapeHtml(name)}" data-design-unit="${escapeHtml(unit)}">${escapeHtml(value)}${escapeHtml(unit)}</output></span>
      <input type="range" name="${escapeHtml(name)}" value="${escapeHtml(value)}" min="${min}" max="${max}" step="${step}" />
    </label>
  `;
}

function renderDesignSystemEditor(settings) {
  const design = normalizeDesignSystem(settings.design);
  const fonts = ["Inter", "Arial", "Georgia", "Verdana", "Trebuchet MS"].map((font) => [font, font]);
  const presetLabels = { clean: "Clean", editorial: "Editorial", bold: "Bold", soft: "Soft" };
  const customCssStatus = String(settings.customCss || "").trim() ? "Custom styles" : "Not set";

  return `
    <div class="design-system-workspace" data-design-workspace>
      <form class="admin-card settings-form design-system-form" data-site-settings-form data-design-system-form>
        <input type="hidden" name="design.preset" value="${escapeHtml(design.preset)}" />

        <fieldset class="design-control-group design-preset-group">
          <legend>Starting style</legend>
          <div class="design-preset-list" role="group" aria-label="Design presets">
            ${Object.keys(designSystemPresets)
              .map((preset) => `
                <button type="button" class="design-preset${design.preset === preset ? " active" : ""}" data-design-preset="${escapeHtml(preset)}" aria-pressed="${design.preset === preset ? "true" : "false"}">
                  <span class="design-preset-swatch design-preset-${escapeHtml(preset)}" aria-hidden="true"><i></i><i></i><i></i></span>
                  <strong>${escapeHtml(presetLabels[preset])}</strong>
                </button>
              `)
              .join("")}
          </div>
        </fieldset>

        <fieldset class="design-control-group">
          <legend>Color roles</legend>
          <div class="design-color-grid">
            ${renderDesignColor("design.colors.primary", "Primary", design.colors.primary)}
            ${renderDesignColor("design.colors.primaryContrast", "On primary", design.colors.primaryContrast)}
            ${renderDesignColor("design.colors.background", "Page", design.colors.background)}
            ${renderDesignColor("design.colors.surface", "Surface", design.colors.surface)}
            ${renderDesignColor("design.colors.text", "Text", design.colors.text)}
            ${renderDesignColor("design.colors.muted", "Muted text", design.colors.muted)}
            ${renderDesignColor("design.colors.border", "Borders", design.colors.border)}
          </div>
        </fieldset>

        <details class="design-disclosure" data-design-summary="typography">
          <summary><span>Typography</span><small data-design-summary-value>${escapeHtml(design.typography.headingFont)} + ${escapeHtml(design.typography.bodyFont)}</small></summary>
          <fieldset class="design-control-group">
            <legend class="visually-hidden">Typography</legend>
            <div class="builder-form-grid">
              <label><span>Heading font</span><select name="design.typography.headingFont">${designSelectOptions(fonts, design.typography.headingFont)}</select></label>
              <label><span>Body font</span><select name="design.typography.bodyFont">${designSelectOptions(fonts, design.typography.bodyFont)}</select></label>
              <label><span>Heading weight</span><select name="design.typography.headingWeight">${designSelectOptions([["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"]], design.typography.headingWeight)}</select></label>
              <label><span>Type scale</span><select name="design.typography.scale">${designSelectOptions([["compact", "Compact"], ["standard", "Standard"], ["expressive", "Expressive"]], design.typography.scale)}</select></label>
            </div>
            ${renderDesignRange("design.typography.baseSize", "Base text size", design.typography.baseSize, 14, 20, 1, "px")}
          </fieldset>
        </details>

        <details class="design-disclosure" data-design-summary="layout">
          <summary><span>Layout and shape</span><small data-design-summary-value>${escapeHtml(design.layout.contentWidth)}px</small></summary>
          <fieldset class="design-control-group">
            <legend class="visually-hidden">Layout and shape</legend>
            ${renderDesignRange("design.layout.contentWidth", "Content width", design.layout.contentWidth, 880, 1440, 20, "px")}
            ${renderDesignRange("design.layout.sectionSpacing", "Section spacing", design.layout.sectionSpacing, 24, 128, 4, "px")}
            ${renderDesignRange("design.layout.radius", "Surface radius", design.layout.radius, 0, 24, 1, "px")}
            <div class="builder-form-grid">
              <label><span>Surface shadow</span><select name="design.layout.shadow">${designSelectOptions([["none", "None"], ["soft", "Soft"], ["strong", "Strong"]], design.layout.shadow)}</select></label>
              <label><span>Button style</span><select name="design.buttons.style">${designSelectOptions([["solid", "Solid"], ["outline", "Outline"]], design.buttons.style)}</select></label>
            </div>
            ${renderDesignRange("design.buttons.radius", "Button radius", design.buttons.radius, 0, 32, 1, "px")}
          </fieldset>
        </details>

        <details class="design-disclosure" data-design-summary="header">
          <summary><span>Header and footer</span><small data-design-summary-value>${design.header.sticky ? "Sticky header" : "Static header"}</small></summary>
          <fieldset class="design-control-group">
            <legend class="visually-hidden">Header and footer</legend>
            <div class="design-color-grid compact">
              ${renderDesignColor("design.header.background", "Header", design.header.background)}
              ${renderDesignColor("design.header.text", "Header text", design.header.text)}
              ${renderDesignColor("design.footer.background", "Footer", design.footer.background)}
              ${renderDesignColor("design.footer.text", "Footer text", design.footer.text)}
            </div>
            <label class="inline-check"><input type="checkbox" name="design.header.sticky"${design.header.sticky ? " checked" : ""} /><span>Sticky public header</span></label>
          </fieldset>
        </details>

        <details class="design-disclosure design-advanced-css" data-design-summary="css">
          <summary><span>Advanced CSS</span><small data-design-summary-value>${escapeHtml(customCssStatus)}</small></summary>
          <fieldset class="design-control-group">
            <legend class="visually-hidden">Advanced CSS</legend>
            <label>
              <span>Global CSS</span>
              <textarea name="customCss" rows="10" spellcheck="false" placeholder=".page-section { scroll-margin-top: 96px; }">${escapeHtml(settings.customCss || "")}</textarea>
            </label>
          </fieldset>
        </details>
        ${renderFormMessage()}
        <div class="form-actions"><button type="submit">Save design system</button></div>
      </form>

      <aside class="design-preview-panel" aria-label="Live design preview">
        <div class="design-preview-heading"><span>Live preview</span><strong>Public site</strong></div>
        <div class="design-preview" data-design-preview data-button-style="${escapeHtml(design.buttons.style)}" style="${escapeHtml(designSystemDeclarations(design))}">
          <header><strong>Northstar</strong><nav><span>Work</span><span>About</span><span>Contact</span></nav></header>
          <main>
            <p>Independent studio</p>
            <h2>Clear ideas, carefully made.</h2>
            <span class="design-preview-copy">Selected work across identity, digital products, and editorial systems.</span>
            <button type="button" tabindex="-1">View projects</button>
            <div class="design-preview-cards"><article><i></i><strong>Field Notes</strong><span>Editorial</span></article><article><i></i><strong>Common Ground</strong><span>Identity</span></article></div>
          </main>
          <footer><strong>Northstar Studio</strong><span>2026</span></footer>
        </div>
      </aside>
    </div>
  `;
}

export function renderSettingsPage(config) {
  const settings = config.siteSettings || {};
  const email = config.email || {};
  const storage = config.theme?.cms?.media || {};
  const storageDriver = config.storage?.driver || storage.productionDriver || "s3";
  const storageBucket = config.storage?.bucket || "Configured by deployment";
  const storagePrefix = config.storage?.keyPrefix || "sites/{website-slug}";
  const installedModules = new Map((config.installedModules || []).map((module) => [module.moduleId, module]));
  const localizationModule = installedModules.get("localization");
  const localizationEnabled = localizationModule?.status === "ENABLED";
  const localization = config.localization || localizationModule?.settings?.settings || {};
  const runtimeUpdate = config.runtimeUpdate || {};
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
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-email" />
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-multilingual" />
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-updates" />
          <nav class="admin-tabs settings-tabs" aria-label="Settings sections">
            <label for="settings-tab-general">General settings</label>
            <label for="settings-tab-style">Style</label>
            <label for="settings-tab-email">Email</label>
            <label for="settings-tab-multilingual">Multilingual</label>
            <label for="settings-tab-updates">Updates</label>
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
              ${renderFormMessage()}
              <div class="form-actions"><button type="submit">Save general settings</button></div>
            </form>
          </section>
          <section class="settings-tab-panel settings-tab-panel-style" data-settings-panel="style">
            ${renderDesignSystemEditor({ ...settings, title: settings.title || config.app?.name || "Code Epsylon" })}
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
                <span>The platform may reuse the same S3 endpoint, bucket, and connection for many websites. It must generate a different <code>STORAGE_KEY_PREFIX</code> for every copied runtime, such as <code>sites/client-site</code>.</span>
              </div>
            </div>
          </section>
          <section class="settings-tab-panel settings-tab-panel-email" data-settings-panel="email">
            <form class="admin-card settings-form" data-email-settings-form>
              <div class="module-status-row">
                <div>
                  <strong>${email.configured ? "Transactional email configured" : "Transactional email not configured"}</strong>
                  <span>${email.source === "environment" ? "Loaded from the deployment environment" : "Managed by this site"}</span>
                </div>
                <span class="status-pill ${email.lastTestSucceeded === true ? "success" : ""}">${email.lastTestSucceeded === true ? "Tested" : email.lastTestSucceeded === false ? "Test failed" : "Not tested"}</span>
              </div>
              ${email.error ? `<p class="form-message error">${escapeHtml(email.error)}</p>` : ""}
              <label class="inline-check">
                <input type="checkbox" name="enabled" ${email.enabled ? "checked" : ""} />
                <span>Enable transactional email</span>
              </label>
              <label>
                <span>Sender address</span>
                <input name="from" type="email" value="${escapeHtml(email.from || "")}" placeholder="notifications@example.com" autocomplete="email" />
              </label>
              <label>
                <span>HTTP email endpoint</span>
                <input name="httpEndpoint" type="url" value="${escapeHtml(email.httpEndpoint || "")}" placeholder="https://email-provider.example/send" />
              </label>
              <label>
                <span>Bearer token</span>
                <input name="bearerToken" type="password" value="" placeholder="${email.bearerTokenConfigured ? "Saved credential" : "Optional provider credential"}" autocomplete="new-password" />
              </label>
              ${email.bearerTokenConfigured ? `
                <label class="inline-check">
                  <input type="checkbox" name="clearBearerToken" />
                  <span>Remove saved bearer token</span>
                </label>
              ` : ""}
              <label>
                <span>Test recipient</span>
                <input name="testRecipient" type="email" value="${escapeHtml(state.user?.email || "")}" placeholder="owner@example.com" />
              </label>
              ${email.lastTestMessage ? `<p class="field-help">Last test: ${escapeHtml(email.lastTestMessage)}${email.lastTestedAt ? ` · ${escapeHtml(formatDate(email.lastTestedAt))}` : ""}</p>` : ""}
              ${renderFormMessage()}
              <div class="form-actions">
                <button type="button" class="secondary-button" data-test-email-settings ${email.configured ? "" : "disabled"}>Send test</button>
                <button type="submit">Save email settings</button>
              </div>
            </form>
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
          <section class="settings-tab-panel settings-tab-panel-updates" data-settings-panel="updates">
            <div data-runtime-update-panel>
              ${renderRuntimeUpdatePanel(runtimeUpdate)}
            </div>
          </section>
        </div>
      </section>
    `
  );
  setStatus("Settings loaded.");
}

export function renderRuntimeUpdatePanel(update = {}) {
  const latest = update.latestUpdate || {};
  const supervisor = update.supervisor || {};
  const check = update.check || {};
  const latestStatus = String(latest.status || "").toLowerCase();
  const supervisorStatus = String(supervisor.status || "").toLowerCase();
  const rawStatus = latestStatus && supervisor.updateId !== latest.id
    ? latestStatus
    : supervisorStatus || latestStatus;
  const applying = ["staged", "applying"].includes(rawStatus);
  const failed = ["failed", "rolled_back", "rolled-back"].includes(rawStatus);
  const rolledBack = ["rolled_back", "rolled-back"].includes(rawStatus);
  const updateAvailable = check.updateAvailable === true;
  const failedTitle = rolledBack ? "The previous release was restored" : "The update needs attention";
  const failedDescription = rolledBack
    ? "CodeY CMS restored the previous working release. Review diagnostics before retrying."
    : "CodeY CMS could not finish the update or recovery. Review the runtime logs before retrying.";
  const title = update.error
    ? "Update status unavailable"
    : applying
      ? rawStatus === "applying" ? "Installing the latest update" : "Update ready to install"
      : failed
      ? failedTitle
        : updateAvailable
          ? "A verified update is ready"
          : "CodeY CMS is up to date";
  const description = update.error
    ? update.error
    : applying
      ? "The site will return automatically after backup, migration, and health checks finish."
      : failed
        ? failedDescription
        : updateAvailable
          ? "The update is signed, compatible, and will be backed up before installation."
          : update.automatic
            ? "Verified stable updates install automatically after a protected backup."
            : "Check for a verified stable update at any time.";
  const statusClass = update.error || failed ? "error" : applying ? "pending" : "success";

  return `
    <div class="admin-card runtime-update-card" data-runtime-update-state>
      <div class="runtime-update-summary">
        <span class="runtime-update-indicator ${statusClass}" aria-hidden="true"></span>
        <div>
          <p class="section-label">System updates</p>
          <h2>${escapeHtml(title)}</h2>
          <p class="dashboard-copy compact">${escapeHtml(description)}</p>
        </div>
      </div>
      <div class="module-status-row">
        <div>
          <strong>Automatic stable updates</strong>
          <span>${update.automatic ? "On" : "Off"}</span>
        </div>
        <span class="status-pill ${update.automatic ? "success" : ""}">${update.automatic ? "Managed" : "Manual"}</span>
      </div>
      ${failed && (supervisor.error || latest.error) ? `<p class="form-message error">${escapeHtml(supervisor.error || latest.error)}</p>` : ""}
      <details class="runtime-update-details">
        <summary>Technical details</summary>
        <dl>
          <div><dt>Installed release</dt><dd>${escapeHtml(update.currentVersion || "Unknown")}</dd></div>
          ${check.latestVersion ? `<div><dt>Latest stable</dt><dd>${escapeHtml(check.latestVersion)}</dd></div>` : ""}
          ${latest.backupId ? `<div><dt>Recovery backup</dt><dd>${escapeHtml(latest.backupId)}</dd></div>` : ""}
        </dl>
      </details>
      <p class="form-message" data-runtime-update-message aria-live="polite"></p>
      <div class="form-actions">
        <button type="button" class="secondary-button" data-check-runtime-update ${update.enabled === false || applying ? "disabled" : ""}>Check now</button>
        ${updateAvailable ? `<button type="button" data-apply-runtime-update>Install update</button>` : ""}
      </div>
    </div>
  `;
}
