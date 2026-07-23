import { api, escapeHtml, restoreSession, setStatus, state, translateString } from "./core.js";
import { pageSlug } from "./routes.js";
import { getModalFormHandler } from "./modal.js";
import { renderAdminLogin } from "./ui.js";
import { optionalFormValue } from "./content-actions.js";
import { setFormDisabled, setFormMessage } from "./ui.js";

function storeSession(user, tokens) {
  state.token = tokens.accessToken;
  state.hasSession = true;
  state.user = user;
  localStorage.setItem("cms_session_hint", "1");
  localStorage.removeItem("cms_access_token");
  localStorage.removeItem("cms_refresh_token");
}

function clearBrowserSession() {
  state.token = "";
  state.hasSession = false;
  state.user = null;
  state.cmsTemplates = [];
  state.visualEditorActive = false;
  state.visualEditorSelection = null;
  state.visualEditorEditingBlockKey = "";
  state.visualEditorHistoryKey = "";
  state.visualEditorUndoStack = [];
  state.visualEditorRedoStack = [];
  state.visualEditorDevice = "desktop";
  state.visualEditorLibraryOpen = false;
  localStorage.removeItem("cms_session_hint");
  localStorage.removeItem("cms_access_token");
  localStorage.removeItem("cms_refresh_token");
}

export async function loadUser() {
  if (!state.token && !state.hasSession) return null;

  if (!state.token) {
    if (!await restoreSession()) return null;
    if (state.user) return state.user;
  }

  try {
    const { user } = await api("/auth/me");
    return user;
  } catch {
    return null;
  }
}

export async function submitContactForm(form) {
  const formData = new FormData(form);
  const payload = {
    formKey: String(formData.get("formKey") || "contact").trim(),
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    phone: optionalFormValue(formData, "phone"),
    subject: optionalFormValue(formData, "subject"),
    message: String(formData.get("message") || "").trim(),
    website: optionalFormValue(formData, "website"),
    startedAt: optionalFormValue(formData, "startedAt"),
    metadata: {
      pageSlug: state.page?.slug || pageSlug()
    }
  };

  setFormDisabled(form, true);
  setFormMessage(form, translateString("form.contact.sending", "Sending inquiry..."));

  try {
    await api("/cms/forms/contact", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    form.reset();
    const startedAtInput = form.querySelector?.('input[name="startedAt"]');
    if (startedAtInput) startedAtInput.value = new Date().toISOString();
    setFormMessage(form, translateString("form.contact.success", "Your inquiry has been received. We will contact you soon."));
  } catch (error) {
    setFormMessage(form, error.message || translateString("form.contact.error", "Unable to send inquiry."), true);
  } finally {
    setFormDisabled(form, false);
  }
}

export async function loginAdmin(form) {
  const formData = new FormData(form);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const mfaCode = String(formData.get("mfaCode") || "").trim();

  setFormDisabled(form, true);
  setFormMessage(form, "Signing in...");

  try {
    const { user, tokens } = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, ...(mfaCode ? { mfaCode } : {}) })
    });

    storeSession(user, tokens);
    window.history.pushState({}, "", "/dashboard");
    const { bootstrap } = await import("./controller.js");
    await bootstrap();
  } catch (error) {
    setFormDisabled(form, false);
    if (error.code === "mfa_required" || error.code === "invalid_mfa_code") {
      const mfaField = form.querySelector("[data-mfa-login-field]");
      if (mfaField) mfaField.hidden = false;
      const mfaInput = form.querySelector('input[name="mfaCode"]');
      if (mfaInput) {
        mfaInput.required = true;
        mfaInput.focus();
      }
    }
    setFormMessage(form, error.message || "Unable to sign in.", true);
  }
}

export async function beginMfaSetup(form) {
  const currentPassword = String(new FormData(form).get("currentPassword") || "");
  setFormDisabled(form, true);
  setFormMessage(form, "Preparing two-step verification...");

  try {
    const { setup } = await api("/auth/mfa/setup", {
      method: "POST",
      body: JSON.stringify({ currentPassword })
    });
    const panel = form.closest("[data-mfa-panel]");
    panel.innerHTML = `
      <div class="section-heading-row"><div><strong>Connect authenticator</strong><span>Setup expires in 10 minutes.</span></div><span class="status-pill">Pending</span></div>
      <div class="mfa-setup-key"><span>Setup key</span><code>${escapeHtml(setup.secret)}</code></div>
      <a class="secondary-button" href="${escapeHtml(setup.otpauthUri)}">Open authenticator app</a>
      <form data-mfa-confirm-form>
        <label><span>6-digit verification code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="6" required autofocus /></label>
        ${renderInlineFormMessage()}
        <div class="form-actions"><button type="submit">Verify and enable</button></div>
      </form>
    `;
    panel.querySelector('input[name="code"]')?.focus();
  } catch (error) {
    setFormMessage(form, error.message || "Unable to start two-step verification.", true);
    setFormDisabled(form, false);
  }
}

export async function confirmMfaSetup(form) {
  const code = String(new FormData(form).get("code") || "").trim();
  setFormDisabled(form, true);
  setFormMessage(form, "Verifying code...");

  try {
    const result = await api("/auth/mfa/confirm", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    storeSession(result.user, result.tokens);
    const panel = form.closest("[data-mfa-panel]");
    panel.innerHTML = `
      <div class="section-heading-row"><div><strong>Two-step verification enabled</strong><span>Store these one-time recovery codes securely.</span></div><span class="status-pill success">Enabled</span></div>
      <pre class="mfa-recovery-codes" data-mfa-recovery-codes>${result.recoveryCodes.map(escapeHtml).join("\n")}</pre>
      <div class="form-actions"><button type="button" class="secondary-button" data-copy-mfa-recovery>Copy codes</button></div>
    `;
    setStatus("Two-step verification enabled.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to enable two-step verification.", true);
    setFormDisabled(form, false);
  }
}

export async function disableMfa(form) {
  const values = new FormData(form);
  const currentPassword = String(values.get("currentPassword") || "");
  const code = String(values.get("code") || "").trim();
  setFormDisabled(form, true);
  setFormMessage(form, "Disabling two-step verification...");

  try {
    const result = await api("/auth/mfa", {
      method: "DELETE",
      body: JSON.stringify({ currentPassword, code })
    });
    storeSession(result.user, result.tokens);
    const { bootstrap } = await import("./controller.js");
    await bootstrap();
    setStatus("Two-step verification disabled.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to disable two-step verification.", true);
    setFormDisabled(form, false);
  }
}

export async function copyMfaRecoveryCodes(button) {
  const codes = button.closest("[data-mfa-panel]")?.querySelector("[data-mfa-recovery-codes]")?.textContent?.trim();
  if (!codes) return;

  try {
    await navigator.clipboard.writeText(codes);
    button.textContent = "Copied";
  } catch {
    setStatus("Recovery codes could not be copied automatically.", true);
  }
}

function renderInlineFormMessage() {
  return '<p class="form-message" data-form-message hidden></p>';
}

export async function logoutAdmin() {
  if (state.hasSession || state.token) {
    try {
      await api("/auth/logout", {
        method: "POST",
        body: JSON.stringify({})
      });
    } catch {
      // Local sign-out must still work if the token is already expired.
    }
  }

  clearBrowserSession();
  window.history.pushState({}, "", "/cy-admin");
  renderAdminLogin("You have signed out.");
}

export async function changeOwnPassword(form) {
  const formData = new FormData(form);
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (newPassword !== confirmPassword) {
    setFormMessage(form, "New passwords do not match.", true);
    return;
  }

  setFormDisabled(form, true);
  setFormMessage(form, "Updating password...");

  try {
    const { user, tokens } = await api("/auth/password", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword, newPassword })
    });
    storeSession(user, tokens);
    form.reset();
    setFormMessage(form, "Password updated. Other sessions have been signed out.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to update password.", true);
  } finally {
    setFormDisabled(form, false);
  }
}

export async function revokeAllSessions() {
  const confirmed = await getModalFormHandler()({
    label: "Account security",
    title: "Sign out all sessions",
    description: "Sign out this browser and every other active session for your account?",
    fields: [],
    submitLabel: "Sign out all sessions",
    destructive: true
  });
  if (!confirmed) return;

  try {
    await api("/auth/sessions", { method: "DELETE" });
  } catch (error) {
    const sessionActions = document.querySelector?.("[data-session-actions]") || document;
    setFormMessage(sessionActions, error.message || "Unable to revoke active sessions.", true);
    return;
  }

  clearBrowserSession();
  window.history.pushState({}, "", "/cy-admin");
  renderAdminLogin("All sessions have been signed out.");
}

export async function requestPasswordResetFromLogin(form) {
  const emailInput = form?.querySelector?.('input[name="email"]') || document.querySelector?.('input[name="email"]');
  const currentEmail = typeof emailInput?.value === "string" ? emailInput.value : "";
  const values = await getModalFormHandler()({
    label: "Account recovery",
    title: "Reset password",
    description: "Enter the email address for the admin account.",
    fields: [
      { name: "email", label: "Email address", type: "email", value: currentEmail }
    ],
    submitLabel: "Send reset link"
  });
  const normalizedEmail = String(values?.email || "").trim();

  if (!normalizedEmail) return;

  setFormMessage(form || document, "Requesting password reset...");

  try {
    const result = await api("/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email: normalizedEmail })
    });
    const tokenMessage = result.token ? ` Development reset token: ${result.token}` : "";
    setFormMessage(form || document, `If that account exists, password reset instructions have been sent.${tokenMessage}`);
  } catch (error) {
    setFormMessage(form || document, error.message || "Unable to request password reset.", true);
  }
}

export async function confirmPasswordReset(form) {
  const formData = new FormData(form);
  const token = String(formData.get("token") || "").trim();
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (password !== confirmPassword) {
    setFormMessage(form, "Passwords do not match.", true);
    return;
  }

  setFormDisabled(form, true);
  setFormMessage(form, "Resetting password...");

  try {
    await api("/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, password })
    });
    clearBrowserSession();
    window.history.pushState({}, "", "/cy-admin");
    renderAdminLogin("Password reset. Sign in with your new password.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to reset password.", true);
    setFormDisabled(form, false);
  }
}

export async function acceptUserInvite(form) {
  const formData = new FormData(form);
  const token = String(formData.get("token") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (password !== confirmPassword) {
    setFormMessage(form, "Passwords do not match.", true);
    return;
  }

  setFormDisabled(form, true);
  setFormMessage(form, "Creating your account...");

  try {
    const { user, tokens } = await api("/auth/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token, name, password })
    });
    storeSession(user, tokens);
    window.history.pushState({}, "", "/dashboard");
    const { bootstrap } = await import("./controller.js");
    await bootstrap();
  } catch (error) {
    setFormMessage(form, error.message || "Unable to accept this invitation.", true);
    setFormDisabled(form, false);
  }
}

export async function confirmEmailVerification(form) {
  const token = String(new FormData(form).get("token") || "").trim();
  setFormDisabled(form, true);
  setFormMessage(form, "Verifying email...");

  try {
    await api("/auth/email-verification/confirm", {
      method: "POST",
      body: JSON.stringify({ token })
    });
    window.history.pushState({}, "", "/cy-admin");
    renderAdminLogin("Email verified. You can now sign in.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to verify this email.", true);
    setFormDisabled(form, false);
  }
}
