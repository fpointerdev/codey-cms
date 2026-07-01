import { availableAdminNavItems, elements, escapeHtml, setStatus, state } from "./core.js";

function renderAdminNav(activeView) {
  return availableAdminNavItems()
    .map(
      (item) => {
        const shortLabel = item.label
          .split(/\s+/)
          .map((part) => part[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();

        return `
        <a href="${escapeHtml(item.href)}" data-dashboard-link class="admin-nav-link ${item.view === activeView ? "active" : ""}" aria-label="${escapeHtml(item.label)}">
          <span class="admin-nav-initial" aria-hidden="true">${escapeHtml(shortLabel)}</span>
          <span class="admin-nav-label">${escapeHtml(item.label)}</span>
        </a>
      `
      }
    )
    .join("");
}

function isEditorRoute(route) {
  return route.view === "page-builder" || route.view === "post-builder";
}

function adminRouteKey(route) {
  return `${route.view}:${route.slug || route.userId || ""}`;
}

export function setShellMode(mode) {
  document.body.classList.toggle("auth-enabled", mode === "auth");
  document.body.classList.toggle("dashboard-enabled", mode === "admin");
  document.body.classList.toggle("editor-enabled", mode === "editor");
}

export function renderAuthShell(content) {
  document.title = "Code Epsylon Admin";
  elements.brand.textContent = "Code Epsylon";
  elements.brand.href = "/cy-admin";
  elements.menu.innerHTML = "";
  elements.footer.innerHTML = "";
  elements.page.innerHTML = `
    <section class="auth-screen">
      <div class="auth-brand-mark">CE</div>
      ${content}
    </section>
  `;
  setShellMode("auth");
}

export function renderAdminShell(route, content) {
  const routeKey = adminRouteKey(route);
  if (state.adminSidebarRoute !== routeKey) {
    state.adminSidebarCollapsed = isEditorRoute(route);
    state.adminSidebarRoute = routeKey;
  }

  const sidebarCollapsed = state.adminSidebarCollapsed;

  document.title = "Code Epsylon Admin";
  elements.brand.textContent = "Code Epsylon";
  elements.brand.href = "/cy-admin";
  elements.menu.innerHTML = "";
  elements.footer.innerHTML = "";
  elements.page.innerHTML = `
    <div class="admin-layout${sidebarCollapsed ? " admin-layout-sidebar-collapsed" : ""}" data-admin-layout>
      <aside class="admin-sidebar${sidebarCollapsed ? " collapsed" : ""}" aria-label="Admin navigation" data-admin-sidebar>
        <div class="admin-sidebar-top">
          <a class="admin-sidebar-brand" href="/dashboard" data-dashboard-link>
            <span class="admin-brand-mark">CE</span>
            <span class="admin-sidebar-brand-text">
              <strong>Code Epsylon</strong>
              <small>Project console</small>
            </span>
          </a>
          <button
            type="button"
            class="admin-sidebar-toggle"
            data-toggle-admin-sidebar
            aria-label="${sidebarCollapsed ? "Expand admin navigation" : "Collapse admin navigation"}"
            aria-expanded="${sidebarCollapsed ? "false" : "true"}"
          >
            <span class="admin-sidebar-toggle-icon" aria-hidden="true">
              <span class="admin-sidebar-toggle-rail"></span>
              <span class="admin-sidebar-toggle-chevron"></span>
            </span>
          </button>
        </div>
        <nav class="admin-nav">
          ${renderAdminNav(route.view === "user" ? "users" : route.view)}
        </nav>
        <div class="admin-sidebar-footer">
          <span>Signed in</span>
          <strong>${escapeHtml(state.user?.email || "Admin")}</strong>
          <button type="button" class="admin-logout-button" data-admin-logout>Sign out</button>
        </div>
      </aside>
      <main class="admin-workspace">
        ${content}
      </main>
    </div>
  `;
  setShellMode("admin");
}

export function renderFormMessage(message = "", isError = false) {
  return `
    <p class="form-message${isError ? " error" : ""}" data-form-message role="${isError ? "alert" : "status"}" aria-live="polite"${message ? "" : " hidden"}>
      ${escapeHtml(message)}
    </p>
  `;
}

export function setFormDisabled(form, disabled) {
  Array.from(form.elements || []).forEach((control) => {
    control.disabled = disabled;
  });
}

export function setFormMessage(form, message, isError = false) {
  const messageElement = form.querySelector?.("[data-form-message]");

  if (!messageElement) {
    setStatus(message, isError);
    return;
  }

  messageElement.textContent = message;
  messageElement.hidden = !message;
  messageElement.classList.toggle("error", isError);
}

export function renderAdminLogin(statusMessage = "Use the admin account created during setup.", isError = false) {
  renderAuthShell(
    `
      <section class="dashboard-auth">
        <div>
          <p class="section-label">Admin</p>
          <h1 class="dashboard-title">Welcome to Code Epsylon</h1>
          <p class="dashboard-copy">
            Sign in to manage pages, users, profile settings, modules, and project configuration.
          </p>
        </div>
        <form class="admin-card login-card" data-admin-login-form>
          <label>
            <span>Email</span>
            <input name="email" type="email" autocomplete="username" required />
          </label>
          <label>
            <span>Password</span>
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          ${renderFormMessage(statusMessage, isError)}
          <button type="submit">Sign in</button>
          <div class="login-card-actions">
            <button type="button" class="link-button" data-forgot-password>Forgot password?</button>
          </div>
        </form>
      </section>
    `
  );
  setStatus("");
}

export function renderPasswordReset(token = "") {
  renderAuthShell(
    `
      <section class="dashboard-auth">
        <div>
          <p class="section-label">Password Reset</p>
          <h1 class="dashboard-title">Create a new password</h1>
          <p class="dashboard-copy">
            Use the reset token from your email, then sign in with the new password.
          </p>
        </div>
        <form class="admin-card login-card" data-password-reset-form>
          <label>
            <span>Reset token</span>
            <input name="token" type="text" autocomplete="one-time-code" value="${escapeHtml(token)}" required />
          </label>
          <label>
            <span>New password</span>
            <input name="password" type="password" autocomplete="new-password" minlength="8" required />
          </label>
          <label>
            <span>Confirm password</span>
            <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required />
          </label>
          ${renderFormMessage("Enter your reset token and new password.")}
          <button type="submit">Reset password</button>
          <div class="login-card-actions">
            <a href="/cy-admin">Back to sign in</a>
          </div>
        </form>
      </section>
    `
  );
  setStatus("");
}
