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
import { renderAdminShell, renderFormMessage } from "./ui.js";
import {
  cardStyleOptions,
  catalogSortOptions,
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
import {
  customStorefrontEditorHref,
  customStorefrontPageHref
} from "./custom-storefront.js";

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
  const fallback = localizedPublicHref(publicPageHref(page.slug), page.locale);
  return customStorefrontPageHref(page, fallback);
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
      title: "Edit website",
      body: "Pages, navigation, and visual content.",
      action: "Open pages",
      href: "/dashboard/pages",
      modules: ["cms"],
      permissions: [["read", "cms"]]
    },
    {
      title: "Write a post",
      body: "Articles, news, and updates.",
      action: "Open posts",
      href: "/dashboard/posts",
      modules: ["cms"],
      permissions: [["read", "cms"]]
    },
    {
      title: "Run the shop",
      body: "Products, orders, and checkout.",
      action: "Open shop",
      href: "/dashboard/shop",
      modules: ["products", "orders"],
      permissions: [["read", "products"], ["read", "orders"]]
    },
    {
      title: "Manage the team",
      body: "People, roles, and access.",
      action: "Open users",
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
          <h1 class="dashboard-title">Your website</h1>
        </div>
        <a class="admin-primary-link" href="/">View website</a>
      </section>
      <section class="admin-section admin-panel">
        <div class="section-heading-row"><div><p class="section-label">Start here</p><h2>What do you want to do?</h2></div></div>
        ${renderDashboardActions()}
      </section>
      <details class="admin-section admin-panel dashboard-system-details">
        <summary>
          <span><strong>Site capabilities</strong><small>Installed modules and technical status</small></span>
        </summary>
        <div class="dashboard-system-details-body">
          ${renderModuleStatusList(config)}
        </div>
      </details>
    `
  );
  setStatus("Dashboard loaded.");
}

function renderMfaPanel(mfa = {}) {
  if (mfa.enabled) {
    return `
      <div class="admin-card settings-form profile-mfa-card" data-mfa-panel>
        <div class="section-heading-row">
          <div><strong>Two-step verification</strong><span>${escapeHtml(mfa.recoveryCodesRemaining || 0)} recovery codes remaining</span></div>
          <span class="status-pill success">Enabled</span>
        </div>
        <form data-mfa-disable-form>
          <label><span>Current password</span><input name="currentPassword" type="password" autocomplete="current-password" required /></label>
          <label><span>Verification or recovery code</span><input name="code" autocomplete="one-time-code" minlength="6" maxlength="32" required /></label>
          ${renderFormMessage()}
          <div class="form-actions"><button type="submit" class="secondary-button danger">Disable</button></div>
        </form>
      </div>
    `;
  }

  return `
    <div class="admin-card settings-form profile-mfa-card" data-mfa-panel>
      <div class="section-heading-row">
        <div><strong>Two-step verification</strong><span>Protect sign-in with an authenticator app.</span></div>
        <span class="status-pill">${mfa.recommended ? "Recommended" : "Optional"}</span>
      </div>
      <form data-mfa-setup-form>
        <label><span>Current password</span><input name="currentPassword" type="password" autocomplete="current-password" required /></label>
        ${renderFormMessage()}
        <div class="form-actions"><button type="submit">Set up</button></div>
      </form>
    </div>
  `;
}

function sessionDeviceName(userAgent = "") {
  const browser = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("Firefox/")
      ? "Firefox"
      : userAgent.includes("Chrome/")
        ? "Chrome"
        : userAgent.includes("Safari/")
          ? "Safari"
          : "Browser";
  const device = /iPhone|iPad/.test(userAgent)
    ? "iPhone or iPad"
    : /Android/.test(userAgent)
      ? "Android"
      : /Macintosh|Mac OS X/.test(userAgent)
        ? "Mac"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "device";

  return `${browser} on ${device}`;
}

function sessionIpAddress(ipAddress = "") {
  return ipAddress.startsWith("::ffff:") ? ipAddress.slice(7) : ipAddress;
}

function renderSessions(sessions = []) {
  return `
    <div class="admin-card profile-sessions" data-session-actions>
      <div class="section-heading-row">
        <div><strong>Signed-in devices</strong><span>Remove a device you do not recognize.</span></div>
        <span class="status-pill">${sessions.length} active</span>
      </div>
      ${renderFormMessage()}
      <div class="profile-session-list">
        ${sessions.length
          ? sessions.map((session) => `
              <div class="profile-session-row">
                <div>
                  <strong>${escapeHtml(sessionDeviceName(session.userAgent || ""))}${session.current ? ' <span class="status-pill success">This browser</span>' : ""}</strong>
                  <span>${session.ipAddress ? `IP ${escapeHtml(sessionIpAddress(session.ipAddress))} · ` : ""}Last active ${escapeHtml(formatDate(session.lastActiveAt))}</span>
                  <small>Signed in ${escapeHtml(formatDate(session.authenticatedAt))}${session.mfaVerifiedAt ? " with two-step verification" : ""}</small>
                </div>
                <button
                  type="button"
                  class="secondary-button danger"
                  data-revoke-session="${escapeHtml(session.id)}"
                  data-current-session="${session.current ? "true" : "false"}"
                  data-session-label="${escapeHtml(sessionDeviceName(session.userAgent || ""))}"
                >${session.current ? "Sign out" : "Remove"}</button>
              </div>
            `).join("")
          : '<p class="dashboard-copy">No refreshable sessions are active.</p>'}
      </div>
      <div class="user-danger-zone">
        <div><strong>Sign out everywhere</strong><span>Immediately invalidates access for this browser and every other signed-in device.</span></div>
        <button type="button" class="secondary-button danger" data-revoke-all-sessions>Sign out all</button>
      </div>
    </div>
  `;
}

export function renderProfilePage(profile, mfa = {}, sessions = []) {
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
        ${renderMfaPanel(mfa)}
        ${renderSessions(sessions)}
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
            <thead><tr><th>Title</th><th>Slug</th><th>Language</th><th>Status</th><th>Translations</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              ${
                pages.length
                  ? pages
                      .map(
                        (page) => `
                          <tr>
                            <td><a href="${escapeHtml(canUpdatePages ? customStorefrontEditorHref(page, publicHrefForPage(page)) : publicHrefForPage(page))}"><strong>${escapeHtml(page.title)}</strong></a></td>
                            <td>${escapeHtml(page.slug)}</td>
                            <td>${localeBadge(page)}</td>
                            <td><span class="status-pill">${escapeHtml(page.status)}</span></td>
                            <td>${translationStatusBadges(page, allPages)}</td>
                            <td>${escapeHtml(formatDate(page.updatedAt))}</td>
                            <td>
                              <div class="page-actions" aria-label="Actions for ${escapeHtml(page.title)}">
                                ${canUpdatePages ? `
                                  <a class="page-action-primary" href="${escapeHtml(customStorefrontEditorHref(page, publicHrefForPage(page)))}">Edit visually</a>
                                  <a href="${escapeHtml(hrefWithLocale(adminHref("page-builder", page.slug), page.locale))}" data-dashboard-link>Edit structure</a>
                                ` : ""}
                                <a href="${escapeHtml(publicHrefForPage(page))}">View</a>
                              ${enabledLocales(allPages).length > 1 && hasPermission("create", "cms") ? `
                                <button type="button" class="link-button" data-create-page-translation="${escapeHtml(page.slug)}" data-source-locale="${escapeHtml(page.locale || "en")}" data-source-title="${escapeHtml(page.title)}">Translate</button>
                              ` : ""}
                              </div>
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
                                <a href="${escapeHtml(hrefWithLocale(adminHref("post-builder", post.slug), post.locale))}" data-dashboard-link>Edit post</a>
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
  const activeTab = ["shop-products", "product-create", "product-editor", "shop-categories", "shop-attributes"].includes(activeView)
    ? "shop-products"
    : activeView;
  const tabs = [
    { view: "shop", href: "/dashboard/shop", label: "Overview", modules: ["products", "orders"], permissions: [["read", "products"], ["read", "orders"]] },
    { view: "shop-products", href: "/dashboard/shop/products", label: "Products", modules: ["products"], permissions: [["read", "products"]] },
    { view: "shop-orders", href: "/dashboard/shop/orders", label: "Orders", modules: ["orders"], permissions: [["read", "orders"]] },
    { view: "shop-configuration", href: "/dashboard/shop/configuration", label: "Settings", modules: ["products"], permissions: [["read", "products"], ["read", "payments"], ["read", "modules"]] }
  ].filter((tab) => modulesEnabled(tab.modules) && hasAnyPermission(tab.permissions));

  renderAdminShell(
    { view: "shop" },
    `
      <section class="admin-page-header">
        <div><p class="section-label">Shop</p><h1 class="dashboard-title">Shop</h1></div>
        <div class="button-row">
          <a class="secondary-button" href="/shop">View shop</a>
          ${hasPermission("create", "products") ? '<a class="admin-primary-link" href="/dashboard/shop/products/new" data-dashboard-link>Add product</a>' : ""}
        </div>
      </section>
      <nav class="admin-tabs" aria-label="Shop sections">
        ${tabs
          .map((tab) => `<a href="${escapeHtml(tab.href)}" data-dashboard-link class="${tab.view === activeTab ? "active" : ""}"${tab.view === activeTab ? ' aria-current="page"' : ""}>${escapeHtml(tab.label)}</a>`)
          .join("")}
      </nav>
      ${content}
    `
  );
}

function renderCatalogTools(activeView) {
  const tools = [
    { view: "shop-products", href: "/dashboard/shop/products", label: "Products" },
    { view: "shop-categories", href: "/dashboard/shop/categories", label: "Categories" },
    { view: "shop-attributes", href: "/dashboard/shop/attributes", label: "Attributes" }
  ];

  return `
    <nav class="catalog-tools" aria-label="Catalog tools">
      ${tools.map((tool) => `<a href="${tool.href}" data-dashboard-link class="${tool.view === activeView ? "active" : ""}"${tool.view === activeView ? ' aria-current="page"' : ""}>${tool.label}</a>`).join("")}
    </nav>
  `;
}

function orderNeedsAttention(order = {}) {
  return ["PENDING", "CONFIRMED", "PAID"].includes(order.status)
    || order.checkoutStatus === "PAYMENT_PENDING"
    || order.supportCases?.some((supportCase) => ["OPEN", "IN_REVIEW", "APPROVED"].includes(supportCase.status));
}

function productPurchaseMode(product = {}) {
  return product.metadata?.purchaseMode === "quote" ? "quote" : "buy";
}

function productAvailableStock(product = {}) {
  const variants = Array.isArray(product.variants) ? product.variants.filter((variant) => variant.active !== false) : [];
  return variants.length
    ? variants.reduce((total, variant) => total + Math.max(0, Number(variant.availableStock ?? variant.stockQuantity) || 0), 0)
    : Math.max(0, Number(product.availableStock ?? product.stockQuantity) || 0);
}

function productOnHandStock(product = {}) {
  const variants = Array.isArray(product.variants) ? product.variants.filter((variant) => variant.active !== false) : [];
  return variants.length
    ? variants.reduce((total, variant) => total + Math.max(0, Number(variant.stockQuantity) || 0), 0)
    : Math.max(0, Number(product.stockQuantity) || 0);
}

function productReservedStock(product = {}) {
  const variants = Array.isArray(product.variants) ? product.variants.filter((variant) => variant.active !== false) : [];
  return variants.length
    ? variants.reduce((total, variant) => total + Math.max(0, Number(variant.reservedQuantity) || 0), 0)
    : Math.max(0, Number(product.reservedQuantity) || 0);
}

function commerceReadiness(products, commerce) {
  const activeProducts = products.filter((product) => product.status === "ACTIVE");
  const buyProducts = activeProducts.filter((product) => productPurchaseMode(product) === "buy");
  const incompleteProducts = activeProducts.filter((product) => (
    !product.name || !product.images?.length ||
    (productPurchaseMode(product) === "buy" && (Number(product.priceCents || 0) <= 0 || productAvailableStock(product) <= 0))
  ));
  const providers = commerce.providers || [];
  const shippingZones = commerce.shippingZones || [];
  const checks = [
    {
      complete: activeProducts.length > 0,
      label: "Publish a product",
      detail: activeProducts.length ? `${activeProducts.length} products are visible` : "Customers need at least one active product",
      href: activeProducts.length ? "/dashboard/shop/products" : "/dashboard/shop/products/new"
    },
    {
      complete: activeProducts.length > 0 && incompleteProducts.length === 0,
      label: "Complete sellable details",
      detail: incompleteProducts.length ? `${incompleteProducts.length} active products need an image, price, or stock` : "Active products are ready for customers",
      href: "/dashboard/shop/products"
    },
    {
      complete: buyProducts.length === 0 || providers.length > 0,
      label: "Enable checkout",
      detail: buyProducts.length === 0
        ? "Quote-only catalogs do not need online payment"
        : providers.length
          ? `${providers.length} payment method${providers.length === 1 ? "" : "s"} available`
          : "Connect card, PayPal, or manual payment",
      href: "/dashboard/shop/configuration"
    }
  ];

  return {
    checks,
    complete: checks.filter((check) => check.complete).length,
    shippingZones: shippingZones.length
  };
}

export function renderShopPage({ products = [], orders = [], commerce = {}, errorMessage = "" } = {}) {
  const activeProducts = products.filter((product) => product.status === "ACTIVE");
  const draftProducts = products.filter((product) => product.status === "DRAFT");
  const lowStockProducts = activeProducts.filter((product) => (
    productPurchaseMode(product) === "buy" && productAvailableStock(product) <= 3
  ));
  const openOrders = orders.filter(orderNeedsAttention);
  const revenueCents = orders
    .filter((order) => ["PAID", "FULFILLED"].includes(order.status))
    .reduce((total, order) => total + Number(order.totalCents || 0), 0);
  const readiness = commerceReadiness(products, commerce);

  renderShopShell(
    "shop",
    `
      ${errorMessage ? `<p class="form-message error">${escapeHtml(errorMessage)}</p>` : ""}
      <section class="admin-section shop-readiness${readiness.complete === readiness.checks.length ? " is-ready" : ""}">
        <div class="shop-readiness-heading">
          <div><p class="section-label">Sellability</p><h2>${readiness.complete === readiness.checks.length ? "Ready to sell" : "Finish store setup"}</h2><p class="dashboard-copy">${readiness.complete} of ${readiness.checks.length} essentials complete${readiness.shippingZones ? ` · ${readiness.shippingZones} delivery zone${readiness.shippingZones === 1 ? "" : "s"}` : " · Delivery is optional"}</p></div>
          <span class="shop-readiness-score" aria-label="${readiness.complete} of ${readiness.checks.length} complete">${readiness.complete}/${readiness.checks.length}</span>
        </div>
        <div class="shop-readiness-list">
          ${readiness.checks.map((check) => `
            <a href="${escapeHtml(check.href)}" data-dashboard-link class="${check.complete ? "complete" : ""}">
              <span class="shop-readiness-mark" aria-hidden="true">${check.complete ? "&#10003;" : ""}</span>
              <span><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.detail)}</small></span>
              <span aria-hidden="true">&#8594;</span>
            </a>
          `).join("")}
        </div>
      </section>
      <section class="admin-section admin-panel">
        <div class="section-heading-row"><div><p class="section-label">Overview</p><h2>Shop metrics</h2></div></div>
        <div class="shop-overview-grid">
          <article><span>Active products</span><strong>${escapeHtml(activeProducts.length)}</strong><small>${escapeHtml(draftProducts.length)} drafts</small></article>
          <article><span>Open orders</span><strong>${escapeHtml(openOrders.length)}</strong><small>${escapeHtml(orders.length)} total orders</small></article>
          <article><span>Paid revenue</span><strong>${escapeHtml(formatMoney(revenueCents, orders[0]?.currency || "EUR"))}</strong><small>Paid and fulfilled orders</small></article>
          <article><span>Low stock</span><strong>${escapeHtml(lowStockProducts.length)}</strong><small>3 or fewer available</small></article>
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
                <span class="status-pill">${escapeHtml(productAvailableStock(product))} available</span>
              </div>
            `).join("")}
          </div>
        </section>
      ` : ""}
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
        <div class="section-heading-row"><div><p class="section-label">Catalog</p><h2>Products</h2></div>${hasPermission("create", "products") ? '<a class="admin-primary-link" href="/dashboard/shop/products/new" data-dashboard-link>Add product</a>' : ""}</div>
        ${renderCatalogTools("shop-products")}
        ${errorMessage ? `<p class="form-message error">Products are not available yet: ${escapeHtml(errorMessage)}</p>` : ""}
        <div class="admin-card table-card">
          <table class="admin-table">
            <thead><tr><th>Name</th><th>Status</th><th>Price</th><th>Stock</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              ${
                products.length
                  ? products
                      .map(
                        (product) => `
                          <tr>
                            <td><a href="${escapeHtml(canUpdateProducts ? adminHref("product-editor", product.slug) : publicHrefForProduct(product))}" ${canUpdateProducts ? "data-dashboard-link" : ""}><strong>${escapeHtml(product.name)}</strong></a></td>
                            <td><span class="status-pill">${escapeHtml(product.status)}</span></td>
                            <td>${escapeHtml(formatMoney(product.priceCents, product.currency || "EUR"))}</td>
                            <td><strong>${escapeHtml(productAvailableStock(product))} available</strong><small class="product-stock-detail">${escapeHtml(productOnHandStock(product))} on hand${productReservedStock(product) ? ` · ${escapeHtml(productReservedStock(product))} reserved` : ""}</small></td>
                            <td>${escapeHtml(formatDate(product.updatedAt))}</td>
                            <td>
                              <div class="page-actions" aria-label="Actions for ${escapeHtml(product.name)}">
                                ${canUpdateProducts ? `<a class="page-action-primary" href="${escapeHtml(adminHref("product-editor", product.slug))}" data-dashboard-link>Edit</a>` : ""}
                                <a href="${escapeHtml(publicHrefForProduct(product))}">View</a>
                              </div>
                            </td>
                          </tr>
                        `
                      )
                      .join("")
                  : renderEmptyTableRow(
                      6,
                      "No products yet",
                      "Create the first product as a draft, then publish it when pricing and stock are ready.",
                      hasPermission("create", "products") ? '<a class="admin-primary-link" href="/dashboard/shop/products/new" data-dashboard-link>Add product</a>' : ""
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
          <div><p class="section-label">Catalog</p><h2>Categories</h2></div>
          ${hasPermission("create", "products") ? '<button type="button" data-create-product-category>Add category</button>' : ""}
        </div>
        ${renderCatalogTools("shop-categories")}
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
          <div><p class="section-label">Catalog</p><h2>Attributes</h2></div>
          ${hasPermission("create", "products") ? '<button type="button" data-create-product-attribute>Add attribute</button>' : ""}
        </div>
        ${renderCatalogTools("shop-attributes")}
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

function paymentRefundedCents(payment) {
  const value = payment?.metadata && typeof payment.metadata === "object"
    ? payment.metadata.refundedCents
    : 0;
  return Number.isInteger(value) ? Math.min(payment.amountCents, Math.max(0, value)) : 0;
}

function paymentStatusDetails(payment) {
  if (!payment) return "";
  const refundedCents = paymentRefundedCents(payment);
  const pending = payment.refunds?.find((refund) => refund.status === "PENDING");
  const failed = payment.refunds?.find((refund) => refund.status === "FAILED");

  return [
    refundedCents > 0
      ? `<small class="payment-order-status">Refunded ${escapeHtml(formatMoney(refundedCents, payment.currency))}</small>`
      : "",
    pending
      ? `<small class="payment-order-status">Refund pending: ${escapeHtml(formatMoney(pending.amountCents, pending.currency))}</small>`
      : failed
        ? '<small class="payment-order-status error">Last refund failed</small>'
        : ""
  ].join("");
}

function paymentActions(payment, order) {
  if (!payment || !hasPermission("update", "payments")) return "";

  if (payment.provider === "MANUAL" && ["PENDING", "REQUIRES_ACTION"].includes(payment.status)) {
    return `
      <div class="payment-order-actions">
        <button type="button" class="link-button" data-manual-payment-action="SUCCEED" data-payment-id="${escapeHtml(payment.id)}">Mark paid</button>
        <button type="button" class="link-button danger" data-manual-payment-action="FAIL" data-payment-id="${escapeHtml(payment.id)}">Mark failed</button>
      </div>
    `;
  }

  const refundedCents = paymentRefundedCents(payment);
  const remainingCents = payment.amountCents - refundedCents;
  const pending = payment.refunds?.find((refund) => refund.status === "PENDING");
  if (payment.status !== "SUCCEEDED" || remainingCents <= 0 || pending) return "";

  const failed = payment.refunds?.find((refund) => (
    refund.status === "FAILED" &&
    refund.initiatedByUserId &&
    refund.amountCents <= remainingCents &&
    (!refund.supportCaseId || order?.supportCases?.some((supportCase) => (
      supportCase.id === refund.supportCaseId && supportCase.status === "APPROVED"
    )))
  ));
  const approvedRequest = order?.supportCases?.find((supportCase) => (
    supportCase.type === "REFUND" &&
    supportCase.status === "APPROVED" &&
    supportCase.requestedRefundCents > 0 &&
    supportCase.requestedRefundCents <= remainingCents
  ));
  const linkedRequest = failed
    ? failed.supportCaseId
      ? order?.supportCases?.find((supportCase) => supportCase.id === failed.supportCaseId)
      : null
    : approvedRequest;
  const amountCents = failed?.amountCents || linkedRequest?.requestedRefundCents || remainingCents;
  return `
    <button
      type="button"
      class="link-button danger"
      data-payment-refund="${escapeHtml(payment.id)}"
      data-payment-provider="${escapeHtml(payment.provider)}"
      data-refund-currency="${escapeHtml(payment.currency)}"
      data-refund-max-cents="${escapeHtml(remainingCents)}"
      data-refund-amount-cents="${escapeHtml(amountCents)}"
      data-refund-reason="${escapeHtml(failed?.reason || "CUSTOMER_REQUEST")}"
      data-refund-note="${escapeHtml(failed?.note || "")}"
      ${failed ? `data-retry-refund-id="${escapeHtml(failed.id)}"` : ""}
      ${linkedRequest ? `data-refund-support-case-id="${escapeHtml(linkedRequest.id)}"` : ""}
    >${failed ? "Retry refund" : linkedRequest ? "Issue approved refund" : "Refund"}</button>
  `;
}

function merchantOrderAction(order) {
  if (!hasPermission("update", "orders")) return "";
  if (["PENDING", "CONFIRMED"].includes(order.status)) {
    return `<button type="button" class="link-button danger" data-order-status-action="CANCELLED" data-order-id="${escapeHtml(order.id)}">Cancel order</button>`;
  }
  if (order.status === "PAID") {
    return `<button type="button" class="link-button" data-order-status-action="FULFILLED" data-order-id="${escapeHtml(order.id)}">Mark fulfilled</button>`;
  }
  return "";
}

function trackingDateValue(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
}

function trackingStatusOptions(value = "PREPARING") {
  return ["PREPARING", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "DELAYED"]
    .map((status) => `<option value="${status}"${status === value ? " selected" : ""}>${escapeHtml(status.replaceAll("_", " ").toLowerCase())}</option>`)
    .join("");
}

function orderTrackingManagement(order) {
  const tracking = order.tracking || {};
  if (!hasPermission("update", "orders")) {
    return tracking.status
      ? `<div class="shop-order-tracking-summary"><strong>${escapeHtml(tracking.status.replaceAll("_", " "))}</strong><span>${escapeHtml([tracking.carrier, tracking.trackingNumber].filter(Boolean).join(" · ") || "No carrier details")}</span></div>`
      : "";
  }

  return `
    <section class="shop-order-management">
      <div><p class="section-label">Buyer tracking</p><h3>Delivery progress</h3></div>
      <form data-order-tracking-form data-order-id="${escapeHtml(order.id)}">
        <label><span>Status</span><select name="status">${trackingStatusOptions(tracking.status)}</select></label>
        <label><span>Carrier</span><input name="carrier" maxlength="120" value="${escapeHtml(tracking.carrier || "")}" /></label>
        <label><span>Tracking number</span><input name="trackingNumber" maxlength="160" value="${escapeHtml(tracking.trackingNumber || "")}" /></label>
        <label class="shop-order-management-wide"><span>Tracking link</span><input name="trackingUrl" type="url" maxlength="2048" value="${escapeHtml(tracking.trackingUrl || "")}" placeholder="https://carrier.example/track/..." /></label>
        <label><span>Estimated delivery</span><input name="estimatedDeliveryAt" type="datetime-local" value="${escapeHtml(trackingDateValue(tracking.estimatedDeliveryAt))}" /></label>
        <label class="shop-order-management-wide"><span>Buyer note</span><textarea name="note" rows="2" maxlength="1000">${escapeHtml(tracking.note || "")}</textarea></label>
        <p class="form-message" data-form-message></p>
        <button type="submit">Save tracking</button>
      </form>
    </section>
  `;
}

function orderSupportCases(order) {
  if (!order.supportCases?.length) return "";

  return `
    <section class="shop-order-management">
      <div><p class="section-label">Buyer support</p><h3>Requests</h3></div>
      <div class="shop-order-case-list">
        ${order.supportCases.map((supportCase) => `
          <article>
            <div><span><strong>${escapeHtml(supportCase.subject)}</strong><small>${escapeHtml(supportCase.type.replaceAll("_", " "))} · ${escapeHtml(formatDate(supportCase.createdAt))}</small></span><span class="status-pill">${escapeHtml(supportCase.status)}</span></div>
            <p>${escapeHtml(supportCase.message)}</p>
            ${supportCase.type === "REFUND" && supportCase.requestedRefundCents
              ? `<p><strong>Requested refund:</strong> ${escapeHtml(formatMoney(supportCase.requestedRefundCents, order.currency))}</p>`
              : ""}
            ${supportCase.merchantResponse ? `<blockquote><strong>Response</strong><p>${escapeHtml(supportCase.merchantResponse)}</p></blockquote>` : ""}
            ${hasPermission("update", "orders") ? `<button type="button" class="link-button" data-order-case-update="${escapeHtml(supportCase.id)}" data-order-case-type="${escapeHtml(supportCase.type)}" data-order-case-status="${escapeHtml(supportCase.status)}" data-order-case-response="${escapeHtml(supportCase.merchantResponse || "")}">${supportCase.type === "REFUND" ? "Review refund request" : "Update request"}</button>` : ""}
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function orderDetailRow(order) {
  const notification = order.notifications?.at?.(-1);
  const metadata = order.metadata && typeof order.metadata === "object" ? order.metadata : {};
  const address = metadata.shippingAddress && typeof metadata.shippingAddress === "object" ? metadata.shippingAddress : null;
  const delivery = address
    ? [address.line1, address.line2, address.city, address.region, address.postalCode, order.shippingCountry].filter(Boolean).join(", ")
    : order.shippingCountry || "Not required";
  return `
    <tr class="shop-order-detail-row" id="order-details-${escapeHtml(order.id)}" hidden>
      <td colspan="7">
        <div class="shop-order-detail">
          <div class="shop-order-detail-summary">
            <div><span>Email</span><strong>${escapeHtml(order.customerEmail)}</strong></div>
            <div><span>Delivery</span><strong>${escapeHtml(delivery)}</strong>${metadata.customerPhone ? `<small>${escapeHtml(metadata.customerPhone)}</small>` : ""}</div>
            <div><span>Subtotal</span><strong>${escapeHtml(formatMoney(order.subtotalCents, order.currency || "EUR"))}</strong></div>
            <div><span>Shipping / tax</span><strong>${escapeHtml(formatMoney(Number(order.shippingCents || 0) + Number(order.taxCents || 0), order.currency || "EUR"))}</strong></div>
          </div>
          <div class="shop-order-items">
            ${(order.items || []).map((item) => `
              <div><span><strong>${escapeHtml(item.productName)}</strong>${item.variantName ? `<small>${escapeHtml(item.variantName)}</small>` : ""}</span><span>${escapeHtml(item.quantity)} &times; ${escapeHtml(formatMoney(item.unitPriceCents, order.currency || "EUR"))}</span></div>
            `).join("")}
          </div>
          ${notification ? `
            <p class="dashboard-copy compact">Latest email: ${escapeHtml(notification.status.toLowerCase())}</p>
            ${notification.status === "FAILED" && hasPermission("update", "orders")
              ? `<button type="button" class="link-button" data-order-email-retry="${escapeHtml(notification.id)}">Retry email</button>`
              : ""}
          ` : ""}
          ${orderTrackingManagement(order)}
          ${orderSupportCases(order)}
        </div>
      </td>
    </tr>
  `;
}

export function renderShopOrdersPage(orders, payments = [], errorMessage = "") {
  const openCaseCount = orders.reduce((count, order) => count + (order.supportCases || [])
    .filter((supportCase) => ["OPEN", "IN_REVIEW", "APPROVED"].includes(supportCase.status)).length, 0);
  renderShopShell(
    "shop-orders",
    `
      <section class="admin-section">
        <div class="section-heading-row">
          <div><p class="section-label">Fulfillment</p><h2>Orders</h2><p class="dashboard-copy">${escapeHtml(openCaseCount)} open buyer request${openCaseCount === 1 ? "" : "s"}</p></div>
          <div class="table-action-row">
            ${hasPermission("read", "orders") ? '<button type="button" class="secondary-button" data-customer-data-action="export">Export customer data</button>' : ""}
            ${hasPermission("update", "orders") ? '<button type="button" class="secondary-button danger" data-customer-data-action="anonymize">Anonymize customer</button>' : ""}
          </div>
        </div>
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
                        const orderAction = merchantOrderAction(order);
                        return `
                          <tr>
                            <td><strong>${escapeHtml(order.orderNumber || order.id)}</strong></td>
                            <td>${escapeHtml(order.customerName || order.customerEmail)}</td>
                            <td><span class="status-pill">${escapeHtml(order.status)}</span>${order.supportCases?.some((supportCase) => ["OPEN", "IN_REVIEW", "APPROVED"].includes(supportCase.status)) ? '<small class="payment-order-status">Buyer request</small>' : ""}</td>
                            <td>${payment
                              ? `<strong>${escapeHtml(payment.provider)}</strong><small class="payment-order-status">${escapeHtml(payment.status)}</small>${paymentStatusDetails(payment)}`
                              : escapeHtml(order.checkoutStatus)}</td>
                            <td>${escapeHtml(formatMoney(order.totalCents, order.currency || "EUR"))}</td>
                            <td>${escapeHtml(formatDate(order.createdAt))}</td>
                            <td>
                              <div class="table-action-row">
                                <button type="button" class="link-button" data-order-details-toggle="${escapeHtml(order.id)}" aria-controls="order-details-${escapeHtml(order.id)}" aria-expanded="false">Details</button>
                                ${orderAction}
                                ${paymentActions(payment, order)}
                              </div>
                            </td>
                          </tr>
                          ${orderDetailRow(order)}
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
        <div class="shop-preview-hero" data-shop-preview-hero data-media-type="${escapeHtml(settings.catalogHero.mediaType)}"${settings.catalogHero.enabled ? "" : " hidden"}>
          <span data-shop-preview-hero-label>${escapeHtml(settings.catalogHero.mediaType === "VIDEO" ? "Video hero" : "Image hero")}</span>
          <strong data-shop-preview-hero-cta${settings.catalogHero.ctaLabel ? "" : " hidden"}>${escapeHtml(settings.catalogHero.ctaLabel)}</strong>
        </div>
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
              <p data-shop-preview-card-description${settings.showDescriptions ? "" : " hidden"}>A concise product description.</p>
              <p data-shop-preview-sku${settings.showSku ? "" : " hidden"}>SKU-00${index + 1}</p>
              <footer><b>${escapeHtml(formatMoney((index + 1) * 2500, "EUR"))}</b><span data-shop-preview-stock${settings.showStock ? "" : " hidden"}>In stock</span></footer>
            </article>
          `).join("")}
        </div>
      </div>
    </aside>
  `;
}

function renderShopMediaPicker({ name, label, url = "", alt = "", accept = "image/*", video = false, help = "", disabled = false }) {
  return `
    <div class="settings-media-picker" data-shop-media-picker data-saved-media-type="${video ? "VIDEO" : "IMAGE"}">
      <input name="${escapeHtml(name)}Url" type="hidden" value="${escapeHtml(url)}" data-shop-media-url />
      <label class="gallery-image-picker settings-image-picker">
        <span class="gallery-image-label">${escapeHtml(label)}</span>
        <span class="gallery-image-preview" data-shop-media-preview>
          ${url
            ? video
              ? `<video src="${escapeHtml(url)}" muted playsinline preload="metadata"></video>`
              : `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />`
            : '<span class="gallery-accordion-placeholder" aria-hidden="true">Upload media</span>'}
        </span>
        <span class="gallery-image-change">${url ? "&#9998;" : "Upload"}</span>
        <input name="${escapeHtml(name)}File" type="file" accept="${escapeHtml(accept)}" data-shop-media-input${disabled ? " disabled" : ""} />
      </label>
      <div class="settings-media-picker-footer">
        <small class="field-help">${escapeHtml(help)}</small>
        <button type="button" class="secondary-button" data-clear-shop-media${url ? "" : " hidden"}${disabled ? " disabled" : ""}>Remove</button>
      </div>
    </div>
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
            <div><p class="section-label">Hero media</p><h3>Campaign introduction</h3></div>
            <label class="checkbox-field"><input type="checkbox" name="catalogHeroEnabled" ${settings.catalogHero.enabled ? "checked" : ""} ${canUpdate ? "" : "disabled"} /><span>Show media hero on the main shop page</span></label>
            <label><span>Media type</span><select name="catalogHeroMediaType" ${canUpdate ? "" : "disabled"}><option value="VIDEO"${settings.catalogHero.mediaType === "VIDEO" ? " selected" : ""}>Video</option><option value="IMAGE"${settings.catalogHero.mediaType === "IMAGE" ? " selected" : ""}>Image</option></select></label>
            ${renderShopMediaPicker({
              name: "catalogHeroMedia",
              label: settings.catalogHero.mediaUrl ? "Replace hero media" : "Hero media",
              url: settings.catalogHero.mediaUrl,
              alt: settings.catalogHero.altText || settings.catalogTitle,
              accept: "image/*,video/mp4,video/webm",
              video: settings.catalogHero.mediaType === "VIDEO",
              help: "Upload an optimized image, MP4, or WebM file. The current media stays active until you save.",
              disabled: !canUpdate
            })}
            <label><span>Media description</span><input name="catalogHeroAltText" value="${escapeHtml(settings.catalogHero.altText)}" maxlength="240" placeholder="Required for images" ${canUpdate ? "" : "disabled"} /></label>
            <div class="builder-form-grid">
              <label><span>Button label</span><input name="catalogHeroCtaLabel" value="${escapeHtml(settings.catalogHero.ctaLabel)}" maxlength="80" placeholder="Explore collection" ${canUpdate ? "" : "disabled"} /></label>
              <label><span>Button link</span><input name="catalogHeroCtaUrl" value="${escapeHtml(settings.catalogHero.ctaUrl)}" maxlength="1000" placeholder="/shop/category/featured" ${canUpdate ? "" : "disabled"} /></label>
            </div>
            <details class="product-editor-disclosure">
              <summary><span><strong>Video options</strong><small>Poster, playback, and looping</small></span><span aria-hidden="true">+</span></summary>
              <div class="product-editor-disclosure-body">
                ${renderShopMediaPicker({
                  name: "catalogHeroPoster",
                  label: settings.catalogHero.posterUrl ? "Replace poster image" : "Poster image",
                  url: settings.catalogHero.posterUrl,
                  alt: `${settings.catalogTitle} video poster`,
                  help: "Optional still image displayed before the hero video plays.",
                  disabled: !canUpdate
                })}
                <label><span>Playback</span><select name="catalogHeroPlayback" ${canUpdate ? "" : "disabled"}><option value="hover-focus"${settings.catalogHero.playback === "hover-focus" ? " selected" : ""}>Play on hover or focus</option><option value="controls"${settings.catalogHero.playback === "controls" ? " selected" : ""}>Visitor controls</option></select></label>
                <label class="checkbox-field"><input type="checkbox" name="catalogHeroLoop" ${settings.catalogHero.loop ? "checked" : ""} ${canUpdate ? "" : "disabled"} /><span>Loop video</span></label>
              </div>
            </details>
          </section>

          <section class="shop-customization-section">
            <div><p class="section-label">Catalog</p><h3>Product listing</h3></div>
            ${renderShopSettingsChoices("Layout", "catalogLayout", shopLayoutOptions, settings.catalogLayout, !canUpdate)}
            ${renderShopSettingsChoices("Card style", "cardStyle", cardStyleOptions, settings.cardStyle, !canUpdate)}
            <div class="builder-form-grid">
              <label><span>Default order</span><select name="catalogSort" ${canUpdate ? "" : "disabled"}>${catalogSortOptions.map((option) => `<option value="${escapeHtml(option.value)}"${settings.catalogSort === option.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>
              <label class="shop-products-per-page"><span>Products per page</span><input name="productsPerPage" type="number" min="8" max="48" step="1" value="${escapeHtml(settings.productsPerPage)}" ${canUpdate ? "" : "disabled"} /></label>
            </div>
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
              <label class="checkbox-field"><input type="checkbox" name="showDescriptions" ${settings.showDescriptions ? "checked" : ""} ${canUpdate ? "" : "disabled"} /><span>Card descriptions</span></label>
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

function renderCommerceRules(commerce, canRead, canUpdate) {
  if (!canRead) return '<p class="form-message error">You do not have permission to view checkout rules.</p>';
  const zones = commerce.shippingZones || [];
  const taxRules = commerce.taxRules || [];
  const coupons = commerce.coupons || [];

  return `
    <div class="commerce-rules-grid">
      <section class="commerce-rule-section">
        <header><div><p class="section-label">Delivery</p><h3>Where and how you ship</h3><p class="dashboard-copy">Add a delivery area and its default rate in one step.</p></div></header>
        <div class="commerce-rule-list">
          ${zones.length ? zones.map((zone) => `
            <div><span><strong>${escapeHtml(zone.name)}</strong><small>${escapeHtml((zone.countries || []).join(", ") || "No countries")}${zone.rates?.length ? ` · ${zone.rates.map((rate) => `${rate.name}: ${formatMoney(rate.priceCents, "EUR")}`).join(", ")}` : " · No rate"}</small></span>${canUpdate ? `<button type="button" class="link-button danger" data-delete-commerce-rule="shipping" data-commerce-rule-id="${escapeHtml(zone.id)}">Remove</button>` : ""}</div>
          `).join("") : '<p class="dashboard-copy compact">No delivery areas. Checkout will not ask for shipping.</p>'}
        </div>
        ${canUpdate ? `
          <form class="commerce-rule-form" data-commerce-rule-form="shipping">
            <label><span>Area name</span><input name="name" maxlength="120" placeholder="Europe" required /></label>
            <label><span>Countries</span><input name="countries" placeholder="DE, FR, IT" required /><small>Two-letter country codes, separated by commas.</small></label>
            <label><span>Delivery method</span><input name="rateName" maxlength="120" placeholder="Standard delivery" required /></label>
            <label><span>Price</span><input name="price" type="number" min="0" step="0.01" value="0.00" required /></label>
            <button type="submit">Add delivery area</button>
            ${renderFormMessage()}
          </form>
        ` : ""}
      </section>

      <section class="commerce-rule-section">
        <header><div><p class="section-label">Tax</p><h3>Automatic order tax</h3><p class="dashboard-copy">Use a country code, or leave it empty for a default rule.</p></div></header>
        <div class="commerce-rule-list">
          ${taxRules.length ? taxRules.map((rule) => `
            <div><span><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(rule.country || "Default")} · ${escapeHtml((Number(rule.rateBps || 0) / 100).toFixed(2))}%</small></span>${canUpdate ? `<button type="button" class="link-button danger" data-delete-commerce-rule="tax" data-commerce-rule-id="${escapeHtml(rule.id)}">Remove</button>` : ""}</div>
          `).join("") : '<p class="dashboard-copy compact">No tax rules. Orders currently have no added tax.</p>'}
        </div>
        ${canUpdate ? `
          <form class="commerce-rule-form" data-commerce-rule-form="tax">
            <label><span>Rule name</span><input name="name" maxlength="120" placeholder="Germany VAT" required /></label>
            <label><span>Country</span><input name="country" minlength="2" maxlength="2" placeholder="DE" /></label>
            <label><span>Tax rate</span><input name="rate" type="number" min="0" max="100" step="0.01" placeholder="19" required /></label>
            <button type="submit">Add tax rule</button>
            ${renderFormMessage()}
          </form>
        ` : ""}
      </section>

      <section class="commerce-rule-section">
        <header><div><p class="section-label">Promotions</p><h3>Coupon codes</h3><p class="dashboard-copy">Create a simple percentage or fixed-amount discount.</p></div></header>
        <div class="commerce-rule-list">
          ${coupons.length ? coupons.map((coupon) => `
            <div><span><strong>${escapeHtml(coupon.code)}</strong><small>${escapeHtml(coupon.discountType === "PERCENTAGE" ? `${coupon.amount}% off` : `${formatMoney(coupon.amount, coupon.currency || "EUR")} off`)} · used ${escapeHtml(coupon.usageCount || 0)}${coupon.usageLimit ? `/${escapeHtml(coupon.usageLimit)}` : ""}</small></span>${canUpdate ? `<button type="button" class="link-button danger" data-delete-commerce-rule="coupon" data-commerce-rule-id="${escapeHtml(coupon.id)}">Remove</button>` : ""}</div>
          `).join("") : '<p class="dashboard-copy compact">No coupon codes yet.</p>'}
        </div>
        ${canUpdate ? `
          <form class="commerce-rule-form" data-commerce-rule-form="coupon">
            <label><span>Code</span><input name="code" maxlength="80" placeholder="WELCOME10" required /></label>
            <label><span>Discount</span><select name="discountType"><option value="PERCENTAGE">Percentage</option><option value="FIXED">Fixed amount</option></select></label>
            <label><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" placeholder="10" required /></label>
            <label><span>Currency</span><select name="currency">${["EUR", "USD", "GBP", "CHF"].map((currency) => `<option value="${currency}">${currency}</option>`).join("")}</select></label>
            <label><span>Minimum order</span><input name="minSubtotal" type="number" min="0" step="0.01" placeholder="0.00" /></label>
            <label><span>Usage limit</span><input name="usageLimit" type="number" min="1" step="1" placeholder="Unlimited" /></label>
            <button type="submit">Create coupon</button>
            ${renderFormMessage()}
          </form>
        ` : ""}
      </section>
    </div>
  `;
}

export function renderShopConfigurationPage(config, shopSettings = {}, paymentConfig = {}, errorMessage = "", commerce = {}) {
  const providers = paymentConfig.providers || [];
  const urls = paymentConfig.webhookUrls || {};
  const stripe = paymentProviderConfig(providers, "STRIPE");
  const paypal = paymentProviderConfig(providers, "PAYPAL");
  const manual = paymentProviderConfig(providers, "MANUAL");
  const settings = normalizeShopSettings(shopSettings);
  const canUpdateShop = hasPermission("update", "products");
  const canReadPayments = hasPermission("read", "payments");
  const canUpdatePayments = hasPermission("update", "payments");
  const canManagePaymentSecrets = canUpdatePayments && hasPermission("manage", "secrets");
  const canReadOrders = hasPermission("read", "orders");
  const canUpdateOrders = hasPermission("update", "orders");

  renderShopShell(
    "shop-configuration",
    `
      <section class="admin-section shop-settings-workspace">
        <div class="section-heading-row"><div><p class="section-label">Settings</p><h2>Store and checkout</h2></div></div>
        <div class="shop-settings-tab-shell">
          <input class="settings-tab-input shop-settings-tab-input" type="radio" name="shop-settings-tab" id="shop-tab-storefront" checked />
          <input class="settings-tab-input shop-settings-tab-input" type="radio" name="shop-settings-tab" id="shop-tab-rules" />
          <input class="settings-tab-input shop-settings-tab-input" type="radio" name="shop-settings-tab" id="shop-tab-payments" />
          <input class="settings-tab-input shop-settings-tab-input" type="radio" name="shop-settings-tab" id="shop-tab-system" />
          <nav class="admin-tabs shop-settings-tabs" aria-label="Shop settings sections">
            <label for="shop-tab-storefront">Design</label>
            <label for="shop-tab-rules">Commerce rules</label>
            <label for="shop-tab-payments">Payments</label>
            <label for="shop-tab-system">Advanced</label>
          </nav>

          <section class="shop-settings-tab-panel shop-settings-tab-panel-storefront">
            ${renderStorefrontSettings(settings, canUpdateShop)}
          </section>

          <section class="shop-settings-tab-panel shop-settings-tab-panel-rules">
            <div class="section-heading-row"><div><p class="section-label">Checkout</p><h2>Commerce rules</h2><p class="dashboard-copy">Configure delivery, tax, and promotions without leaving this page.</p></div></div>
            ${renderCommerceRules(commerce, canReadOrders, canUpdateOrders)}
          </section>

          <section class="shop-settings-tab-panel shop-settings-tab-panel-payments payment-configuration-section">
            <div class="section-heading-row"><div><p class="section-label">Checkout</p><h2>Payment providers</h2><p class="dashboard-copy">Credentials are encrypted and stored for this site. Saved secrets are never displayed again.</p></div></div>
            ${errorMessage ? `<p class="form-message error">Payment settings are not available: ${escapeHtml(errorMessage)}</p>` : ""}
            ${canReadPayments && !errorMessage
              ? `<div class="payment-provider-grid">
                  ${renderStripeProvider(stripe, urls.stripe, canManagePaymentSecrets)}
                  ${renderPayPalProvider(paypal, urls.paypal, canManagePaymentSecrets)}
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
  const presetLabels = { clean: "Clean", editorial: "Editorial", bold: "Bold", soft: "Soft", liquid: "Liquid" };
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
              <label><span>Surface style</span><select name="design.layout.surfaceStyle">${designSelectOptions([["solid", "Solid"], ["liquid", "Liquid glass"]], design.layout.surfaceStyle)}</select></label>
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
        <div class="design-preview" data-design-preview data-button-style="${escapeHtml(design.buttons.style)}" data-surface-style="${escapeHtml(design.layout.surfaceStyle)}" style="${escapeHtml(designSystemDeclarations(design))}">
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

function renderSecurityActivity(config) {
  const logs = Array.isArray(config.auditLogs) ? config.auditLogs : [];
  const integrityWarning = logs.some((event) => event.integrity === "invalid");
  const unavailableKeyWarning = logs.some((event) => event.integrity === "unknown-key");
  const rows = logs.map((event) => {
    const severityClass = event.outcome === "SUCCESS"
      ? "success"
      : ["HIGH", "CRITICAL"].includes(event.severity) ? "error" : "";
    const integrity = event.integrity === "valid"
      ? "Verified"
      : event.integrity === "invalid"
        ? "Changed"
        : event.integrity === "unknown-key" ? "Key unavailable" : "Legacy";

    return `
      <tr>
        <td><strong>${escapeHtml(String(event.action || "Activity").replaceAll(".", " "))}</strong><small>${escapeHtml(event.subject || "system")}</small></td>
        <td><span class="status-pill ${severityClass}">${escapeHtml(event.outcome || "SUCCESS")}</span></td>
        <td>${escapeHtml(event.ipAddress || "Local")}</td>
        <td><span class="status-pill ${["invalid", "unknown-key"].includes(event.integrity) ? "error" : ""}">${integrity}</span></td>
        <td>${escapeHtml(formatDate(event.createdAt))}</td>
      </tr>
    `;
  }).join("");

  return `
    <section class="settings-info-card security-activity">
      <div class="section-heading-row">
        <div><p class="section-label">Protection</p><h2>Security activity</h2></div>
        <a class="secondary-button" href="/dashboard/profile" data-dashboard-link>Account security</a>
      </div>
      ${config.auditError ? `<p class="form-message error">${escapeHtml(config.auditError)}</p>` : ""}
      ${integrityWarning ? '<p class="form-message error">Audit history failed its signature or chain check. Review retained server and database logs.</p>' : ""}
      ${unavailableKeyWarning ? '<p class="form-message error">Some audit history uses a previous key that is not configured. Restore the key in SECURITY_AUDIT_PREVIOUS_KEYS.</p>' : ""}
      ${rows ? `
        <div class="table-card">
          <table class="admin-table">
            <thead><tr><th>Event</th><th>Result</th><th>Source</th><th>Integrity</th><th>Time</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      ` : '<p class="dashboard-copy compact">No security activity has been recorded yet.</p>'}
    </section>
  `;
}

function renderLaunchReadiness(readiness = {}) {
  const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
  const status = readiness.status || "blocked";
  const title = status === "ready"
    ? "Ready to publish"
    : status === "attention"
      ? "Finish setup before publishing"
      : "Publishing is blocked";
  const statusLabel = status === "ready" ? "Ready" : status === "attention" ? "Needs attention" : "Blocked";

  return `
    <section class="admin-card settings-form launch-readiness" data-launch-readiness>
      <div class="section-heading-row">
        <div>
          <p class="section-label">Launch readiness</p>
          <h2>${title}</h2>
          <p class="dashboard-copy compact">${escapeHtml(readiness.target === "public" ? "Public website checks" : "Local installation checks")}</p>
        </div>
        <span class="status-pill ${status === "ready" ? "success" : status === "blocked" ? "error" : ""}">${statusLabel}</span>
      </div>
      ${readiness.error ? `<p class="form-message error">${escapeHtml(readiness.error)}</p>` : ""}
      <div class="module-status-list">
        ${checks.map((check) => `
          <div class="module-status-row">
            <div>
              <strong>${escapeHtml(check.label || check.id)}</strong>
              <span>${escapeHtml(check.message || "")}</span>
            </div>
            <div class="module-status-actions">
              <span class="status-pill ${check.status === "pass" ? "success" : check.status === "blocked" ? "error" : ""}">${check.status === "pass" ? "Complete" : check.status === "blocked" ? "Required" : "Review"}</span>
              ${check.settingsTab ? `<button type="button" class="secondary-button" data-open-settings-tab="${escapeHtml(check.settingsTab)}">Open</button>` : ""}
            </div>
          </div>
        `).join("") || '<p class="dashboard-copy compact">Readiness checks are unavailable.</p>'}
      </div>
    </section>
  `;
}

function renderSettingsImagePicker({ name, label, url = "", alt = "", help = "", square = false }) {
  return `
    <div class="settings-media-picker${square ? " is-square" : ""}" data-site-media-picker>
      <label class="gallery-image-picker settings-image-picker">
        <span class="gallery-image-label">${escapeHtml(label)}</span>
        <span class="gallery-image-preview" data-site-image-preview>
          ${url
            ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt || label)}" />`
            : '<span class="gallery-accordion-placeholder" aria-hidden="true">Upload image</span>'}
        </span>
        <span class="gallery-image-change" data-site-image-change>${url ? "&#9998;" : "Upload"}</span>
        <input name="${escapeHtml(name)}File" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" data-site-image-picker-input />
      </label>
      <input name="${escapeHtml(name)}Remove" type="hidden" value="false" data-site-media-remove />
      <div class="settings-media-picker-footer">
        <small class="field-help">${escapeHtml(help)}</small>
        <button type="button" class="secondary-button" data-clear-site-media${url ? "" : " hidden"}>Remove</button>
      </div>
    </div>
  `;
}

export function renderSettingsPage(config) {
  const settings = config.siteSettings || {};
  const email = config.email || {};
  const storage = config.storage || {};
  const storageProvider = ["local", "s3", "r2"].includes(storage.provider)
    ? storage.provider
    : "local";
  const installedModules = new Map((config.installedModules || []).map((module) => [module.moduleId, module]));
  const localizationModule = installedModules.get("localization");
  const localizationEnabled = localizationModule?.status === "ENABLED";
  const localization = config.localization || localizationModule?.settings?.settings || {};
  const runtimeUpdate = config.runtimeUpdate || {};
  const operationsDiagnostics = config.operationsDiagnostics || {};
  const launchReadiness = config.launchReadiness || {};
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
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-launch" checked />
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-general" />
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-style" />
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-storage" />
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-email" />
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-multilingual" />
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-updates" />
          <input class="settings-tab-input" type="radio" name="settings-tab" id="settings-tab-security" />
          <nav class="admin-tabs settings-tabs" aria-label="Settings sections">
            <label for="settings-tab-launch">Launch</label>
            <label for="settings-tab-general">General settings</label>
            <label for="settings-tab-style">Style</label>
            <label for="settings-tab-storage">Storage</label>
            <label for="settings-tab-email">Email</label>
            <label for="settings-tab-multilingual">Multilingual</label>
            <label for="settings-tab-updates">Updates</label>
            <label for="settings-tab-security">Security</label>
          </nav>
          <section class="settings-tab-panel settings-tab-panel-launch" data-settings-panel="launch">
            ${renderLaunchReadiness(launchReadiness)}
          </section>
          <section class="settings-tab-panel settings-tab-panel-general" data-settings-panel="general">
            <form class="admin-card settings-form" data-site-settings-form>
              <label><span>Site title</span><input name="title" value="${escapeHtml(settings.title || config.app?.name || "CodeY CMS")}" required /></label>
              <label><span>Site description</span><textarea name="description" rows="3">${escapeHtml(settings.description || "")}</textarea></label>
              <div class="settings-form-section">
                <div>
                  <p class="section-label">Branding &amp; sharing</p>
                  <h2>Website identity</h2>
                </div>
                <div class="settings-media-grid">
                  ${renderSettingsImagePicker({
                    name: "logo",
                    label: "Logo",
                    url: settings.logoUrl || "",
                    alt: settings.logoAltText || settings.title || "Logo",
                    help: "PNG or WebP with a transparent background works best."
                  })}
                  ${renderSettingsImagePicker({
                    name: "favicon",
                    label: "Browser icon",
                    url: settings.faviconUrl || "",
                    alt: "Browser icon",
                    help: "Use a square PNG or WebP, ideally 512 x 512.",
                    square: true
                  })}
                  ${renderSettingsImagePicker({
                    name: "socialImage",
                    label: "Social sharing image",
                    url: settings.socialImageUrl || "",
                    alt: settings.socialImageAlt || settings.title || "Social sharing image",
                    help: "Used when a page has no image. Recommended size: 1200 x 630."
                  })}
                </div>
                <div class="builder-form-grid settings-brand-fields">
                  <label>
                    <span>Logo display</span>
                    <select name="logoMode">
                      <option value="text"${settings.logoMode === "image" || settings.logoMode === "image-and-name" ? "" : " selected"}>Site name only</option>
                      <option value="image"${settings.logoMode === "image" ? " selected" : ""}>Logo only</option>
                      <option value="image-and-name"${settings.logoMode === "image-and-name" ? " selected" : ""}>Logo and site name</option>
                    </select>
                  </label>
                  <label><span>Logo height</span><input name="logoHeight" type="number" min="20" max="120" step="1" value="${escapeHtml(settings.logoHeight || 42)}" /></label>
                  <label><span>Logo description</span><input name="logoAltText" value="${escapeHtml(settings.logoAltText || settings.title || "")}" /></label>
                  <label><span>Social image description</span><input name="socialImageAlt" value="${escapeHtml(settings.socialImageAlt || settings.title || "")}" /></label>
                </div>
              </div>
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
            ${renderDesignSystemEditor({ ...settings, title: settings.title || config.app?.name || "CodeY CMS" })}
          </section>
          <section class="settings-tab-panel settings-tab-panel-storage" data-settings-panel="storage">
            <form class="admin-card settings-form storage-settings-form" data-storage-settings-form>
              <div class="module-status-row">
                <div>
                  <strong>${storage.configured ? "Media storage configured" : "Media storage needs configuration"}</strong>
                  <span>${storage.source === "dashboard" ? "Managed by this site" : "Loaded from the installation"}</span>
                </div>
                <span class="status-pill ${storage.configured ? "success" : ""}">${storage.configured ? "Configured" : "Not ready"}</span>
              </div>
              <label>
                <span>Storage provider</span>
                <select name="provider" data-storage-provider>
                  <option value="local"${storageProvider === "local" ? " selected" : ""}>Local storage</option>
                  <option value="s3"${storageProvider === "s3" ? " selected" : ""}>Amazon S3</option>
                  <option value="r2"${storageProvider === "r2" ? " selected" : ""}>Cloudflare R2</option>
                </select>
              </label>
              <div class="storage-provider-panel" data-storage-provider-panel="local" ${storageProvider === "local" ? "" : "hidden"}>
                <div class="translation-help">
                  <strong>Local storage</strong>
                  <span>Media stays in the persistent storage volume created during installation.</span>
                </div>
              </div>
              <div class="storage-provider-panel" data-storage-provider-panel="s3" ${storageProvider === "s3" ? "" : "hidden"}>
                <div class="settings-two-column">
                  <label>
                    <span>Bucket name</span>
                    <input name="s3Bucket" value="${escapeHtml(storageProvider === "s3" ? storage.bucket || "" : "")}" autocomplete="off" ${storageProvider === "s3" ? "" : "disabled"} />
                  </label>
                  <label>
                    <span>AWS region</span>
                    <input name="s3Region" value="${escapeHtml(storageProvider === "s3" ? storage.region || "us-east-1" : "us-east-1")}" placeholder="us-east-1" autocomplete="off" ${storageProvider === "s3" ? "" : "disabled"} />
                  </label>
                </div>
                <label>
                  <span>Access key ID</span>
                  <input name="s3AccessKeyId" value="${escapeHtml(storageProvider === "s3" ? storage.accessKeyId || "" : "")}" autocomplete="username" ${storageProvider === "s3" ? "" : "disabled"} />
                </label>
                <label>
                  <span>Secret access key</span>
                  <input name="s3SecretAccessKey" type="password" value="" placeholder="${storageProvider === "s3" && storage.secretAccessKeyConfigured ? "Saved credential" : "Secret access key"}" autocomplete="new-password" ${storageProvider === "s3" ? "" : "disabled"} />
                </label>
              </div>
              <div class="storage-provider-panel" data-storage-provider-panel="r2" ${storageProvider === "r2" ? "" : "hidden"}>
                <div class="settings-two-column">
                  <label>
                    <span>Cloudflare account ID</span>
                    <input name="r2AccountId" value="${escapeHtml(storageProvider === "r2" ? storage.accountId || "" : "")}" autocomplete="off" ${storageProvider === "r2" ? "" : "disabled"} />
                  </label>
                  <label>
                    <span>Bucket name</span>
                    <input name="r2Bucket" value="${escapeHtml(storageProvider === "r2" ? storage.bucket || "" : "")}" autocomplete="off" ${storageProvider === "r2" ? "" : "disabled"} />
                  </label>
                </div>
                <label>
                  <span>R2 access key ID</span>
                  <input name="r2AccessKeyId" value="${escapeHtml(storageProvider === "r2" ? storage.accessKeyId || "" : "")}" autocomplete="username" ${storageProvider === "r2" ? "" : "disabled"} />
                </label>
                <label>
                  <span>R2 secret access key</span>
                  <input name="r2SecretAccessKey" type="password" value="" placeholder="${storageProvider === "r2" && storage.secretAccessKeyConfigured ? "Saved credential" : "Secret access key"}" autocomplete="new-password" ${storageProvider === "r2" ? "" : "disabled"} />
                </label>
              </div>
              <div class="module-status-row storage-prefix-row">
                <div>
                  <strong>Website media folder</strong>
                  <span>${escapeHtml(storage.keyPrefix || "sites/default")}</span>
                </div>
                ${storage.lastTestedAt ? `<span class="status-pill success">Tested ${escapeHtml(formatDate(storage.lastTestedAt))}</span>` : ""}
              </div>
              ${renderFormMessage()}
              <div class="form-actions"><button type="submit">Test and save storage</button></div>
            </form>
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
                <span>Email provider</span>
                <select name="provider">
                  ${[
                    ["resend", "Resend"],
                    ["postmark", "Postmark"],
                    ["smtp", "SMTP server"],
                    ["generic", "Generic HTTP endpoint"]
                  ].map(([value, label]) => `<option value="${value}"${(email.provider || "generic") === value ? " selected" : ""}>${label}</option>`).join("")}
                </select>
              </label>
              <label>
                <span>Sender address</span>
                <input name="from" type="email" value="${escapeHtml(email.from || "")}" placeholder="notifications@example.com" autocomplete="email" />
              </label>
              <label data-email-generic-endpoint ${email.provider && email.provider !== "generic" ? "hidden" : ""}>
                <span>HTTP endpoint (generic provider only)</span>
                <input name="httpEndpoint" type="url" value="${escapeHtml(email.httpEndpoint || "")}" placeholder="https://email-provider.example/send" ${email.provider && email.provider !== "generic" ? "disabled" : ""} />
              </label>
              <div class="settings-form" data-email-smtp-settings ${email.provider !== "smtp" ? "hidden" : ""}>
                <label>
                  <span>SMTP host</span>
                  <input name="smtpHost" value="${escapeHtml(email.smtpHost || "")}" placeholder="smtp.example.com" autocomplete="off" ${email.provider !== "smtp" ? "disabled" : ""} />
                </label>
                <label>
                  <span>SMTP port</span>
                  <input name="smtpPort" type="number" min="1" max="65535" value="${escapeHtml(email.smtpPort || 587)}" ${email.provider !== "smtp" ? "disabled" : ""} />
                </label>
                <label>
                  <span>Connection security</span>
                  <select name="smtpSecurity" ${email.provider !== "smtp" ? "disabled" : ""}>
                    <option value="starttls"${(email.smtpSecurity || "starttls") === "starttls" ? " selected" : ""}>STARTTLS (usually port 587)</option>
                    <option value="tls"${email.smtpSecurity === "tls" ? " selected" : ""}>TLS from connection (usually port 465)</option>
                  </select>
                </label>
                <label>
                  <span>SMTP username</span>
                  <input name="smtpUsername" value="${escapeHtml(email.smtpUsername || "")}" placeholder="username@example.com" autocomplete="username" ${email.provider !== "smtp" ? "disabled" : ""} />
                </label>
                <label>
                  <span>SMTP password</span>
                  <input name="smtpPassword" type="password" value="" placeholder="${email.smtpPasswordConfigured ? "Saved credential" : "Password or app password"}" autocomplete="new-password" ${email.provider !== "smtp" ? "disabled" : ""} />
                </label>
                ${email.smtpPasswordConfigured ? `
                  <label class="inline-check">
                    <input type="checkbox" name="clearSmtpPassword" ${email.provider !== "smtp" ? "disabled" : ""} />
                    <span>Remove saved SMTP password</span>
                  </label>
                ` : ""}
              </div>
              <label data-email-api-key ${email.provider === "smtp" ? "hidden" : ""}>
                <span>Provider API key</span>
                <input name="bearerToken" type="password" value="" placeholder="${email.bearerTokenConfigured ? "Saved credential" : "Optional provider credential"}" autocomplete="new-password" ${email.provider === "smtp" ? "disabled" : ""} />
              </label>
              ${email.bearerTokenConfigured ? `
                <label class="inline-check" data-email-api-key-clear ${email.provider === "smtp" ? "hidden" : ""}>
                  <input type="checkbox" name="clearBearerToken" ${email.provider === "smtp" ? "disabled" : ""} />
                  <span>Remove saved bearer token</span>
                </label>
              ` : ""}
              <label class="inline-check">
                <input type="checkbox" name="recoveryEnabled" ${email.recoveryEnabled ? "checked" : ""} />
                <span>Use this provider for password recovery and invitations</span>
              </label>
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
            ${renderBackupProtection(operationsDiagnostics)}
            <div data-runtime-update-panel>
              ${renderRuntimeUpdatePanel(runtimeUpdate)}
            </div>
          </section>
          <section class="settings-tab-panel settings-tab-panel-security" data-settings-panel="security">
            ${renderSecurityActivity(config)}
          </section>
        </div>
      </section>
    `
  );
  setStatus("Settings loaded.");
}

function renderBackupProtection(diagnostics = {}) {
  if (!hasPermission("manage", "modules")) return "";

  const backup = diagnostics.operations?.backup || {};
  const details = backup.details || {};
  const protectedOffsite = details.offsiteProtected === true;
  const healthy = backup.status === "pass" && protectedOffsite;
  const title = diagnostics.error
    ? "Backup status unavailable"
    : healthy
      ? "Backups are protected off-site"
      : "Backups need off-site protection";
  const description = diagnostics.error
    ? diagnostics.error
    : healthy
      ? "The latest encrypted backup was verified and copied to the configured off-site mirror."
      : backup.message || "Encrypted local backups are enabled, but another machine or storage service has not been confirmed.";

  return `
    <div class="admin-card runtime-update-card">
      <div class="runtime-update-summary">
        <span class="runtime-update-indicator ${healthy ? "success" : "error"}" aria-hidden="true"></span>
        <div>
          <p class="section-label">Recovery</p>
          <h2>${escapeHtml(title)}</h2>
          <p class="dashboard-copy compact">${escapeHtml(description)}</p>
        </div>
      </div>
      <div class="module-status-row">
        <div>
          <strong>Off-site copy</strong>
          <span>${protectedOffsite ? "Confirmed by the deployment" : "Action required before production handoff"}</span>
        </div>
        <span class="status-pill ${healthy ? "success" : "error"}">${healthy ? "Protected" : "Local only"}</span>
      </div>
      ${details.completedAt ? `<p class="field-help">Latest verified backup: ${escapeHtml(formatDate(details.completedAt))}</p>` : ""}
      ${healthy ? "" : `
        <div class="translation-help">
          <strong>Complete disaster recovery</strong>
          <span>Sync the backup mirror to another machine or object-storage service, test a restore, then set <code>BACKUP_OFFSITE_PROTECTED=true</code>.</span>
        </div>
      `}
    </div>
  `;
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
