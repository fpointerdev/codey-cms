import { api, state, translateString } from "./core.js";
import { pageSlug } from "./routes.js";
import { getModalFormHandler } from "./modal.js";
import { renderAdminLogin } from "./ui.js";
import { optionalFormValue } from "./content-actions.js";
import { setFormDisabled, setFormMessage } from "./ui.js";

export async function loadUser() {
  if (!state.token) return null;

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

  setFormDisabled(form, true);
  setFormMessage(form, "Signing in...");

  try {
    const { user, tokens } = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });

    state.token = tokens.accessToken;
    state.refreshToken = tokens.refreshToken;
    state.user = user;
    localStorage.setItem("cms_access_token", state.token);
    localStorage.setItem("cms_refresh_token", state.refreshToken);
    window.history.pushState({}, "", "/dashboard");
    const { bootstrap } = await import("./controller.js");
    await bootstrap();
  } catch (error) {
    setFormMessage(form, error.message || "Unable to sign in.", true);
    setFormDisabled(form, false);
  }
}

export async function logoutAdmin() {
  const refreshToken = state.refreshToken;

  if (refreshToken) {
    try {
      await api("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken })
      });
    } catch {
      // Local sign-out must still work if the token is already expired.
    }
  }

  state.token = "";
  state.refreshToken = "";
  state.user = null;
  localStorage.removeItem("cms_access_token");
  localStorage.removeItem("cms_refresh_token");
  window.history.pushState({}, "", "/cy-admin");
  renderAdminLogin("You have signed out.");
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
    window.history.pushState({}, "", "/cy-admin");
    renderAdminLogin("Password reset. Sign in with your new password.");
  } catch (error) {
    setFormMessage(form, error.message || "Unable to reset password.", true);
    setFormDisabled(form, false);
  }
}
