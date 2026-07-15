import { api, setStatus } from "./core.js";
import { adminHref } from "./routes.js";
import { getModalFormHandler } from "./modal.js";
import { setFormDisabled, setFormMessage } from "./ui.js";

async function reloadAdminRoute() {
  const { bootstrap } = await import("./controller.js");
  await bootstrap();
}

function absoluteInviteUrl(value) {
  if (!value) return "";

  return new URL(value, window.location.origin).toString();
}

async function showInviteDelivery(result, email) {
  if (result.delivery === "email") {
    setStatus(`Invitation sent to ${email}.`);
    return;
  }

  const inviteUrl = absoluteInviteUrl(result.inviteUrl);
  await getModalFormHandler()({
    label: "Users",
    title: "Invitation ready",
    description: `Share this private link with ${email}. It expires in seven days.`,
    fields: [
      {
        name: "inviteUrl",
        label: "Invitation link",
        value: inviteUrl,
        required: false,
        readOnly: true
      }
    ],
    submitLabel: "Done"
  });
  setStatus(`Invitation link created for ${email}.`);
}

export async function createUserInvite() {
  try {
    const { roles = [] } = await api("/roles");
    const availableRoles = roles.filter((role) => role?.name);
    if (!availableRoles.length) {
      setStatus("Create at least one role before inviting a user.", true);
      return;
    }

    const preferredRole = availableRoles.find((role) => role.name === "client_editor") ||
      availableRoles.find((role) => !["owner", "admin"].includes(role.name)) ||
      availableRoles[0];
    const values = await getModalFormHandler()({
      label: "Users",
      title: "Invite user",
      description: "Choose the access role this person should receive.",
      fields: [
        { name: "email", label: "Email", type: "email", value: "" },
        {
          name: "roleName",
          label: "Role",
          type: "select",
          value: preferredRole.name,
          options: availableRoles.map((role) => ({
            value: role.name,
            label: role.name
          }))
        }
      ],
      submitLabel: "Create invitation"
    });
    if (!values) return;

    const result = await api("/auth/invites", {
      method: "POST",
      body: JSON.stringify({
        email: values.email,
        roleNames: [values.roleName]
      })
    });
    await showInviteDelivery(result, values.email);
    await reloadAdminRoute();
  } catch (error) {
    setStatus(error.message || "Unable to create invitation.", true);
  }
}

export async function filterUsers(form) {
  const formData = new FormData(form);
  const search = String(formData.get("search") || "").trim();
  const status = String(formData.get("status") || "").trim();
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (status) params.set("status", status);

  const query = params.toString();
  window.history.pushState({}, "", query ? `/dashboard/users?${query}` : "/dashboard/users");
  await reloadAdminRoute();
}

export async function updateUser(form) {
  const formData = new FormData(form);
  const userId = String(form.dataset.userId || "");
  const payload = {
    name: String(formData.get("name") || "").trim()
  };

  if (form.dataset.userStatusEditable === "true") {
    payload.status = String(formData.get("status") || "ACTIVE");
  }

  if (form.dataset.userRolesEditable === "true") {
    const roleIds = formData.getAll("roleIds").map(String).filter(Boolean);
    if (!roleIds.length) {
      setFormMessage(form, "Select at least one role.", true);
      return;
    }
    payload.roleIds = roleIds;
  }

  setFormDisabled(form, true);
  setFormMessage(form, "Saving user...");

  try {
    const { user } = await api(`/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    setStatus(`User updated: ${user.email}`);
    window.history.pushState({}, "", adminHref("user", user.id));
    await reloadAdminRoute();
  } catch (error) {
    setFormMessage(form, error.message || "Unable to update user.", true);
    setFormDisabled(form, false);
  }
}

export async function deleteUser(userId, email = "this user") {
  const confirmed = await getModalFormHandler()({
    label: "Users",
    title: "Delete user",
    description: `Permanently delete ${email} and revoke all active sessions?`,
    fields: [],
    submitLabel: "Delete user",
    destructive: true
  });
  if (!confirmed) return;

  try {
    await api(`/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    setStatus(`User deleted: ${email}`);
    window.history.pushState({}, "", adminHref("users"));
    await reloadAdminRoute();
  } catch (error) {
    setStatus(error.message || "Unable to delete user.", true);
  }
}

export async function resendUserInvite(inviteId, email) {
  try {
    const result = await api(`/auth/invites/${encodeURIComponent(inviteId)}/resend`, {
      method: "POST"
    });
    await showInviteDelivery(result, email);
    await reloadAdminRoute();
  } catch (error) {
    setStatus(error.message || "Unable to resend invitation.", true);
  }
}

export async function revokeUserInvite(inviteId, email) {
  const confirmed = await getModalFormHandler()({
    label: "Users",
    title: "Revoke invitation",
    description: `Invalidate the pending invitation for ${email}?`,
    fields: [],
    submitLabel: "Revoke invitation",
    destructive: true
  });
  if (!confirmed) return;

  try {
    await api(`/auth/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
    setStatus(`Invitation revoked for ${email}.`);
    await reloadAdminRoute();
  } catch (error) {
    setStatus(error.message || "Unable to revoke invitation.", true);
  }
}
