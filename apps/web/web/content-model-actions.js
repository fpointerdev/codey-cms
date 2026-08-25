import { api, setStatus, slugFromTitle, state } from "./core.js";
import { uploadMediaFile } from "./content-actions.js";
import { bootstrap } from "./controller.js";
import { getModalFormHandler } from "./modal.js";
import { renderContentFieldRow, syncContentFieldRows } from "./content-model-views.js";
import { setFormDisabled, setFormMessage } from "./ui.js";

function optional(value) {
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

function optionalNumber(value) {
  const normalized = String(value ?? "").trim();
  return normalized === "" ? undefined : Number(normalized);
}

function originalField(row) {
  try {
    return JSON.parse(row.dataset.fieldDefinition || "{}");
  } catch {
    return {};
  }
}

function fieldOptions(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf("=");
      const label = (separator >= 0 ? item.slice(0, separator) : item).trim();
      const configuredValue = separator >= 0 ? item.slice(separator + 1).trim() : "";
      return { label, value: configuredValue || slugFromTitle(label) };
    });
}

function fieldFromRow(row) {
  const type = row.querySelector('[name="fieldType"]').value;
  const field = {
    ...originalField(row),
    key: row.querySelector('[name="fieldKey"]').value.trim(),
    label: row.querySelector('[name="fieldLabel"]').value.trim(),
    type,
    required: row.querySelector('[name="fieldRequired"]').checked,
    multiple: ["select", "relation", "image", "file"].includes(type) && row.querySelector('[name="fieldMultiple"]').checked,
    helpText: optional(row.querySelector('[name="fieldHelp"]').value)
  };

  delete field.options;
  delete field.relationCollection;
  delete field.placeholder;
  delete field.minLength;
  delete field.maxLength;
  delete field.min;
  delete field.max;
  if (type === "select") field.options = fieldOptions(row.querySelector('[name="fieldOptions"]').value);
  if (type === "relation") field.relationCollection = row.querySelector('[name="fieldRelation"]').value;
  if (["text", "textarea", "richText", "email", "url"].includes(type)) {
    field.placeholder = optional(row.querySelector('[name="fieldPlaceholder"]').value);
    field.minLength = optionalNumber(row.querySelector('[name="fieldMinLength"]').value);
    field.maxLength = optionalNumber(row.querySelector('[name="fieldMaxLength"]').value);
  }
  if (type === "number") {
    field.min = optionalNumber(row.querySelector('[name="fieldMin"]').value);
    field.max = optionalNumber(row.querySelector('[name="fieldMax"]').value);
  }
  return field;
}

export function addContentField(button) {
  const list = button.closest("form")?.querySelector("[data-content-field-list]");
  if (!list) return;
  const index = list.querySelectorAll("[data-content-field-row]").length;
  list.insertAdjacentHTML("beforeend", renderContentFieldRow({}, state.contentCollections || [], index));
  const row = list.lastElementChild;
  row?.querySelector('[name="fieldLabel"]')?.focus();
  syncContentFieldRows();
}

export function removeContentField(button) {
  const list = button.closest("[data-content-field-list]");
  if (!list || list.querySelectorAll("[data-content-field-row]").length <= 1) {
    setStatus("A collection needs at least one field.", true);
    return;
  }
  button.closest("[data-content-field-row]")?.remove();
  syncContentFieldRows();
}

export function moveContentField(button) {
  const row = button.closest("[data-content-field-row]");
  const list = row?.parentElement;
  const direction = button.dataset.moveContentField;
  if (!row || !list || !["up", "down"].includes(direction)) return;

  const sibling = direction === "up" ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling) return;
  if (direction === "up") list.insertBefore(row, sibling);
  else list.insertBefore(sibling, row);
  syncContentFieldRows();
  button.focus();
  const label = row.querySelector('[name="fieldLabel"]')?.value.trim() || "Field";
  setStatus(`${label} moved ${direction}.`);
}

export function clearContentAsset(button) {
  const field = button.closest("[data-entry-field]");
  if (!field) return;
  const key = field.dataset.fieldKey;
  const current = field.querySelector(`input[name="field_${key}_current"]`);
  const preview = field.querySelector("[data-content-asset-preview]");
  if (current) current.value = field.dataset.fieldMultiple === "true" ? "[]" : "null";
  if (preview) preview.innerHTML = '<span class="content-asset-placeholder">No file selected</span>';
  button.remove();
}

export async function saveContentCollection(form) {
  const formData = new FormData(form);
  const fields = Array.from(form.querySelectorAll("[data-content-field-row]")).map(fieldFromRow);
  const currentSlug = form.dataset.collectionSlug || "";
  const description = optional(formData.get("description"));
  const payload = {
    name: String(formData.get("name") || "").trim(),
    slug: String(formData.get("slug") || "").trim(),
    description: description ?? (currentSlug ? null : undefined),
    titleField: String(formData.get("titleField") || "").trim(),
    fields,
    publicRead: formData.has("publicRead")
  };

  setFormDisabled(form, true);
  setFormMessage(form, "Saving collection...");
  try {
    const { collection } = await api(
      currentSlug ? `/cms/collections/${encodeURIComponent(currentSlug)}` : "/cms/collections",
      { method: currentSlug ? "PATCH" : "POST", body: JSON.stringify(payload) }
    );
    window.history.pushState({}, "", `/dashboard/collections/${encodeURIComponent(collection.slug)}`);
    await bootstrap();
    setStatus(`${collection.name} saved.`);
  } catch (error) {
    setFormDisabled(form, false);
    setFormMessage(form, error.message || "Unable to save collection.", true);
  }
}

async function confirmation(title, message, expected, options = {}) {
  const values = await getModalFormHandler()({
    label: options.label || "Confirm deletion",
    title,
    description: message,
    fields: [{ name: "confirmation", label: `Type ${expected}`, required: true }],
    submitLabel: options.submitLabel || "Delete"
  });
  return values?.confirmation === expected;
}

export async function deleteContentCollection(button) {
  const slug = button.dataset.deleteContentCollection;
  if (!slug || !await confirmation("Delete collection", "Entries and revisions will be deleted permanently.", slug)) return;
  try {
    await api(`/cms/collections/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation: slug })
    });
    window.history.pushState({}, "", "/dashboard/collections");
    await bootstrap();
    setStatus("Collection deleted.");
  } catch (error) {
    setStatus(error.message || "Unable to delete collection.", true);
  }
}

function parseCurrentAsset(field, multiple) {
  try {
    const value = JSON.parse(field.querySelector(`input[name="field_${field.dataset.fieldKey}_current"]`)?.value || "null");
    return multiple ? (Array.isArray(value) ? value : value ? [value] : []) : value;
  } catch {
    return multiple ? [] : null;
  }
}

async function assetValue(field) {
  const input = field.querySelector('input[type="file"]');
  const files = Array.from(input?.files || []);
  const multiple = field.dataset.fieldMultiple === "true";
  if (!files.length) return parseCurrentAsset(field, multiple);
  const assets = [];
  for (const file of files) {
    const asset = await uploadMediaFile(file, file.name);
    assets.push({
      url: asset.url,
      assetId: asset.id,
      altText: asset.altText || file.name,
      ...(asset.width ? { width: asset.width } : {}),
      ...(asset.height ? { height: asset.height } : {})
    });
  }
  return multiple ? assets : assets[0];
}

async function entryData(form, formData) {
  const data = {};
  for (const field of form.querySelectorAll("[data-entry-field]")) {
    const key = field.dataset.fieldKey;
    const type = field.dataset.fieldType;
    const name = `field_${key}`;
    const multiple = field.dataset.fieldMultiple === "true";
    if (type === "boolean") data[key] = formData.has(name);
    else if (type === "number") data[key] = formData.get(name) === "" ? null : Number(formData.get(name));
    else if (type === "image" || type === "file") data[key] = await assetValue(field);
    else if (multiple) data[key] = formData.getAll(name).map(String).filter(Boolean);
    else if (type === "dateTime") {
      const value = String(formData.get(name) || "");
      data[key] = value ? new Date(value).toISOString() : null;
    } else data[key] = String(formData.get(name) || "");
  }
  return data;
}

export async function saveContentEntry(form) {
  const formData = new FormData(form);
  const currentSlug = form.dataset.entrySlug || "";
  const collectionSlug = form.dataset.collectionSlug;
  const locale = form.dataset.entryLocale || String(formData.get("locale") || "en");
  setFormDisabled(form, true);
  setFormMessage(form, "Saving entry...");
  try {
    const publishedAt = String(formData.get("publishedAt") || "");
    const payload = {
      slug: String(formData.get("slug") || "").trim(),
      ...(currentSlug ? {} : { locale }),
      data: await entryData(form, formData),
      status: String(formData.get("status") || "DRAFT"),
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null
    };
    if (!currentSlug && payload.publishedAt === null) delete payload.publishedAt;
    const { entry } = await api(
      currentSlug
        ? `/cms/collections/${encodeURIComponent(collectionSlug)}/entries/${encodeURIComponent(currentSlug)}?locale=${encodeURIComponent(locale)}`
        : `/cms/collections/${encodeURIComponent(collectionSlug)}/entries`,
      { method: currentSlug ? "PATCH" : "POST", body: JSON.stringify(payload) }
    );
    window.history.pushState({}, "", `/dashboard/collections/${encodeURIComponent(collectionSlug)}/entries/${encodeURIComponent(entry.slug)}?locale=${encodeURIComponent(entry.locale)}`);
    await bootstrap();
    setStatus(`${entry.title} saved.`);
  } catch (error) {
    setFormDisabled(form, false);
    setFormMessage(form, error.message || "Unable to save entry.", true);
  }
}

export async function deleteContentEntry(button) {
  const form = button.closest("[data-content-entry-form]");
  const slug = button.dataset.deleteContentEntry;
  const collectionSlug = form?.dataset.collectionSlug;
  const locale = form?.dataset.entryLocale || "en";
  if (!slug || !collectionSlug || !await confirmation("Delete entry", "This entry and its revision history will be removed.", slug)) return;
  try {
    await api(`/cms/collections/${encodeURIComponent(collectionSlug)}/entries/${encodeURIComponent(slug)}?locale=${encodeURIComponent(locale)}`, { method: "DELETE" });
    window.history.pushState({}, "", `/dashboard/collections/${encodeURIComponent(collectionSlug)}`);
    await bootstrap();
    setStatus("Entry deleted.");
  } catch (error) {
    setStatus(error.message || "Unable to delete entry.", true);
  }
}

export async function installContentExtension(button) {
  const extensionId = button.dataset.installContentExtension;
  if (!extensionId) return;
  button.disabled = true;
  try {
    await api(`/cms/extensions/${encodeURIComponent(extensionId)}/install`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await bootstrap();
    setStatus("Extension installed.");
  } catch (error) {
    button.disabled = false;
    setStatus(error.message || "Unable to install extension.", true);
  }
}

export async function updateContentExtension(button) {
  const extensionId = button.dataset.updateContentExtension;
  if (!extensionId) return;
  button.disabled = true;
  try {
    const response = await api(`/cms/extensions/${encodeURIComponent(extensionId)}/update`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await bootstrap();
    const preserved = response.preservedCollections?.length
      ? ` ${response.preservedCollections.length} removed model${response.preservedCollections.length === 1 ? " was" : "s were"} kept as normal collections.`
      : "";
    setStatus(`Extension updated.${preserved}`);
  } catch (error) {
    button.disabled = false;
    setStatus(error.message || "Unable to update extension.", true);
  }
}

export async function disconnectContentExtension(button) {
  const extensionId = button.dataset.disconnectContentExtension;
  if (!extensionId || !await confirmation(
    "Disconnect extension",
    "The extension receipt will be removed. Collections and entries stay unchanged.",
    extensionId,
    { label: "Confirm disconnection", submitLabel: "Disconnect" }
  )) return;
  button.disabled = true;
  try {
    const response = await api(`/cms/extensions/${encodeURIComponent(extensionId)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation: extensionId })
    });
    await bootstrap();
    setStatus(`Extension disconnected. ${response.preservedCollections.length} collection${response.preservedCollections.length === 1 ? " was" : "s were"} preserved.`);
  } catch (error) {
    button.disabled = false;
    setStatus(error.message || "Unable to disconnect extension.", true);
  }
}

export async function exportContentBundle(button) {
  const collections = String(button.dataset.exportContentBundle || "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
  if (!collections.length) return;
  button.disabled = true;
  try {
    const { bundle } = await api("/cms/collections/export", {
      method: "POST",
      body: JSON.stringify({ collections })
    });
    const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `codey-content-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`${collections.length} collection${collections.length === 1 ? "" : "s"} exported.`);
  } catch (error) {
    setStatus(error.message || "Unable to export collections.", true);
  } finally {
    button.disabled = false;
  }
}

export async function importContentBundle(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.disabled = true;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error("Content bundles cannot exceed 10 MB.");
    const bundle = JSON.parse(await file.text());
    const response = await api("/cms/collections/import", {
      method: "POST",
      body: JSON.stringify(bundle)
    });
    input.value = "";
    await bootstrap();
    setStatus(`${response.collections.length} collection${response.collections.length === 1 ? "" : "s"} and ${response.entries} entries imported.`);
  } catch (error) {
    setStatus(error.message || "Unable to import the content bundle.", true);
  } finally {
    input.disabled = false;
  }
}
