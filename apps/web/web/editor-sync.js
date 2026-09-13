export const pageChangeStoragePrefix = "codey_cms_page_change:";

export function pageSettingsHaveUnsavedChanges(form) {
  return Array.from(form?.querySelectorAll?.("input, textarea, select") || []).some((field) => {
    if (field.tagName === "SELECT") return Array.from(field.options || []).some((option) => option.selected !== option.defaultSelected);
    if (["checkbox", "radio"].includes(field.type)) return field.checked !== field.defaultChecked;
    return field.value !== field.defaultValue;
  });
}

function browserStorage(storage) {
  if (storage) return storage;

  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function pageChangeStorageKey(page = {}) {
  const slug = String(page.slug || "").trim();
  if (!slug) return "";

  const locale = String(page.locale || "").trim().toLowerCase();
  return `${pageChangeStoragePrefix}${encodeURIComponent(`${locale}:${slug}`)}`;
}

export function pageChangeToken(page, storage) {
  const key = pageChangeStorageKey(page);
  if (!key) return "";

  try {
    return browserStorage(storage)?.getItem?.(key) || "";
  } catch {
    return "";
  }
}

export function recordPageChange(page, storage) {
  const key = pageChangeStorageKey(page);
  if (!key) return "";

  const token = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
  try {
    browserStorage(storage)?.setItem?.(key, token);
    return token;
  } catch {
    return "";
  }
}
