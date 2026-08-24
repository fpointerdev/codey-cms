import { escapeHtml, formatDate, hasPermission, setStatus, state } from "./core.js";
import { renderRichTextEditor } from "./builder-views.js";
import { hydrateRichEditors } from "./rich-editor.js";
import { renderAdminShell, renderFormMessage } from "./ui.js";

const fieldTypes = [
  ["text", "Short text"],
  ["textarea", "Long text"],
  ["richText", "Rich text"],
  ["email", "Email address"],
  ["url", "Web address"],
  ["number", "Number"],
  ["boolean", "On / off"],
  ["date", "Date"],
  ["dateTime", "Date and time"],
  ["image", "Image"],
  ["file", "File"],
  ["select", "Choice"],
  ["relation", "Related entry"]
];

function fieldTypeOptions(selected) {
  return fieldTypes.map(([value, label]) => (
    `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`
  )).join("");
}

function relationCollectionOptions(collections, selected) {
  return [
    '<option value="">Choose a collection</option>',
    ...collections.map((collection) => (
      `<option value="${escapeHtml(collection.slug)}"${collection.slug === selected ? " selected" : ""}>${escapeHtml(collection.name)}</option>`
    ))
  ].join("");
}

export function renderContentFieldRow(field = {}, collections = [], index = 0) {
  const type = field.type || "text";
  const options = (field.options || []).map((option) => (
    option.label === option.value ? option.value : `${option.label}=${option.value}`
  )).join(", ");

  return `
    <article class="content-field-row" data-content-field-row data-field-type="${escapeHtml(type)}" data-field-definition="${escapeHtml(JSON.stringify(field))}">
      <div class="content-field-row-heading">
        <span class="content-field-order" aria-hidden="true">${index + 1}</span>
        <strong>${escapeHtml(field.label || "New field")}</strong>
        <span class="content-field-row-actions" role="group" aria-label="Reorder and remove ${escapeHtml(field.label || "field")}">
          <button type="button" class="secondary-button compact" data-move-content-field="up" aria-label="Move ${escapeHtml(field.label || "field")} up">Up</button>
          <button type="button" class="secondary-button compact" data-move-content-field="down" aria-label="Move ${escapeHtml(field.label || "field")} down">Down</button>
          <button type="button" class="secondary-button compact danger" data-remove-content-field aria-label="Remove ${escapeHtml(field.label || "field")}">Remove</button>
        </span>
      </div>
      <div class="content-field-grid">
        <label><span>Label</span><input name="fieldLabel" value="${escapeHtml(field.label || "")}" maxlength="120" required data-content-field-label /></label>
        <label><span>Key</span><input name="fieldKey" value="${escapeHtml(field.key || "")}" maxlength="64" pattern="[a-z][a-z0-9_]*" placeholder="field_name" required /></label>
        <label><span>Type</span><select name="fieldType" data-content-field-type>${fieldTypeOptions(type)}</select></label>
        <label class="content-field-checkbox"><input name="fieldRequired" type="checkbox"${field.required ? " checked" : ""} /><span>Required</span></label>
        <label class="content-field-checkbox" data-content-field-multiple><input name="fieldMultiple" type="checkbox"${field.multiple ? " checked" : ""} /><span>Allow multiple</span></label>
        <label data-content-field-options><span>Choices</span><input name="fieldOptions" value="${escapeHtml(options)}" placeholder="Label=value, Label=value" /><small>Comma-separated. A value without = uses the same label.</small></label>
        <label data-content-field-relation><span>Related collection</span><select name="fieldRelation">${relationCollectionOptions(collections, field.relationCollection)}</select></label>
      </div>
      <details class="content-field-validation">
        <summary>Guidance and validation</summary>
        <div class="content-field-validation-grid">
          <label><span>Help text</span><input name="fieldHelp" value="${escapeHtml(field.helpText || "")}" maxlength="240" placeholder="Optional guidance for editors" /></label>
          <label data-content-text-validation><span>Placeholder</span><input name="fieldPlaceholder" value="${escapeHtml(field.placeholder || "")}" maxlength="160" placeholder="Optional example" /></label>
          <label data-content-text-validation><span>Minimum length</span><input type="number" name="fieldMinLength" value="${field.minLength ?? ""}" min="0" max="100000" inputmode="numeric" /></label>
          <label data-content-text-validation><span>Maximum length</span><input type="number" name="fieldMaxLength" value="${field.maxLength ?? ""}" min="1" max="100000" inputmode="numeric" /></label>
          <label data-content-number-validation><span>Minimum value</span><input type="number" name="fieldMin" value="${field.min ?? ""}" step="any" /></label>
          <label data-content-number-validation><span>Maximum value</span><input type="number" name="fieldMax" value="${field.max ?? ""}" step="any" /></label>
        </div>
      </details>
    </article>
  `;
}

function collectionForm(collection, collections) {
  const isNew = !collection;
  const fields = collection?.fields?.length
    ? collection.fields
    : [{ key: "title", label: "Title", type: "text", required: true, multiple: false, maxLength: 160 }];
  const titleOptions = fields
    .filter((field) => ["text", "textarea"].includes(field.type))
    .map((field) => `<option value="${escapeHtml(field.key)}"${field.key === (collection?.titleField || "title") ? " selected" : ""}>${escapeHtml(field.label)}</option>`)
    .join("");

  return `
    <form class="content-model-form" data-content-model-form data-collection-slug="${escapeHtml(collection?.slug || "")}">
      <section class="admin-page-header content-model-header">
        <div>
          <p class="section-label">Content model</p>
          <h1 class="dashboard-title">${escapeHtml(isNew ? "New collection" : collection.name)}</h1>
          <p class="dashboard-copy">Define the fields once. Editors get a focused form for every entry.</p>
        </div>
        <div class="button-row">
          <a class="secondary-button" href="/dashboard/collections" data-dashboard-link>Back</a>
          <button type="submit">${isNew ? "Create collection" : "Save model"}</button>
        </div>
      </section>
      <section class="admin-card content-model-basics">
        <div class="builder-form-grid">
          <label><span>Name</span><input name="name" value="${escapeHtml(collection?.name || "")}" maxlength="120" required data-title-source /></label>
          <label><span>URL name</span><input name="slug" value="${escapeHtml(collection?.slug || "")}" maxlength="80" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required data-slug-target /></label>
        </div>
        <label><span>Description</span><textarea name="description" rows="2" maxlength="500">${escapeHtml(collection?.description || "")}</textarea></label>
        <div class="builder-form-grid">
          <label><span>Display title</span><select name="titleField" required data-content-title-field>${titleOptions}</select><small>The field used to name entries in lists.</small></label>
          <label class="checkbox-field"><input type="checkbox" name="publicRead"${collection?.publicRead !== false ? " checked" : ""} /><span>Allow published entries through the public API</span></label>
        </div>
      </section>
      <section class="admin-section content-model-fields">
        <div class="section-heading-row">
          <div><p class="section-label">Entry form</p><h2>Fields</h2><p class="dashboard-copy">Keep the form short and order fields as editors should complete them.</p></div>
          <button type="button" class="secondary-button" data-add-content-field>Add field</button>
        </div>
        <div class="content-field-list" data-content-field-list>
          ${fields.map((field, index) => renderContentFieldRow(field, collections, index)).join("")}
        </div>
      </section>
      ${renderFormMessage()}
      ${!isNew && hasPermission("delete", "cms") ? `
        <section class="content-model-danger">
          <div><strong>Delete collection</strong><span>Deletes its entries and revision history. Related collections must be disconnected first.</span></div>
          <button type="button" class="secondary-button danger" data-delete-content-collection="${escapeHtml(collection.slug)}">Delete</button>
        </section>
      ` : ""}
    </form>
  `;
}

function entriesTable(collection, entries) {
  if (!collection) return "";
  return `
    <section class="admin-section content-entry-section">
      <div class="section-heading-row">
        <div><p class="section-label">Content</p><h2>Entries</h2><p class="dashboard-copy">${entries.length} ${entries.length === 1 ? "entry" : "entries"} in this collection.</p></div>
        ${hasPermission("create", "cms") ? `<a class="admin-primary-link" href="/dashboard/collections/${encodeURIComponent(collection.slug)}/entries/new" data-dashboard-link>Add entry</a>` : ""}
      </div>
      <div class="admin-card table-card">
        <table class="admin-table">
          <thead><tr><th>Title</th><th>Slug</th><th>Language</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead>
          <tbody>
            ${entries.length ? entries.map((entry) => `
              <tr>
                <td><strong>${escapeHtml(entry.title)}</strong></td>
                <td>${escapeHtml(entry.slug)}</td>
                <td>${escapeHtml(String(entry.locale || "en").toUpperCase())}</td>
                <td><span class="status-pill">${escapeHtml(entry.status)}</span></td>
                <td>${escapeHtml(formatDate(entry.updatedAt))}</td>
                <td><a href="/dashboard/collections/${encodeURIComponent(collection.slug)}/entries/${encodeURIComponent(entry.slug)}?locale=${encodeURIComponent(entry.locale || "en")}" data-dashboard-link>Edit</a></td>
              </tr>
            `).join("") : `
              <tr><td colspan="6"><div class="table-empty-state"><strong>No entries yet</strong><span>Add the first ${escapeHtml(collection.name.toLowerCase())} entry.</span></div></td></tr>
            `}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function renderCollectionEditorPage(collection, collections = [], entries = []) {
  renderAdminShell(
    { view: "collections" },
    `${collectionForm(collection, collections)}${entriesTable(collection, entries)}`
  );
  syncContentFieldRows();
  setStatus(collection ? `${collection.name} loaded.` : "Create a content collection.");
}

function extensionCards(extensions = []) {
  if (!extensions.length) return "";
  return `
    <section class="admin-section content-extension-section">
      <div class="section-heading-row"><div><p class="section-label">Starter packs</p><h2>Extensions</h2><p class="dashboard-copy">Install trusted declarative models without server code.</p></div></div>
      <div class="content-extension-grid">
        ${extensions.map((extension) => `
          <article class="admin-card content-extension-card">
            <div><span class="status-pill">v${escapeHtml(extension.version)}</span><h3>${escapeHtml(extension.name)}</h3><p>${escapeHtml(extension.description)}</p></div>
            <footer>
              <small>${extension.contentModels.length} ${extension.contentModels.length === 1 ? "collection" : "collections"} · ${escapeHtml(extension.license)}</small>
              ${extension.installed
                ? '<span class="status-pill success">Installed</span>'
                : extension.compatible && hasPermission("create", "cms")
                  ? `<button type="button" class="secondary-button" data-install-content-extension="${escapeHtml(extension.id)}">Install</button>`
                  : '<span class="status-pill error">Not compatible</span>'}
            </footer>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

export function renderCollectionsPage(collections = [], extensionResponse = {}, errorMessage = "") {
  renderAdminShell(
    { view: "collections" },
    `
      <section class="admin-page-header">
        <div><p class="section-label">CMS</p><h1 class="dashboard-title">Collections</h1><p class="dashboard-copy">Structure reusable content, then manage every entry with a simple form.</p></div>
        ${hasPermission("create", "cms") ? '<a class="admin-primary-link" href="/dashboard/collections/new" data-dashboard-link>New collection</a>' : ""}
      </section>
      ${errorMessage ? `<p class="form-message error">${escapeHtml(errorMessage)}</p>` : ""}
      <section class="admin-section">
        <div class="content-collection-grid">
          ${collections.length ? collections.map((collection) => `
            <a class="admin-card content-collection-card" href="/dashboard/collections/${encodeURIComponent(collection.slug)}" data-dashboard-link>
              <div><span class="status-pill">${collection.publicRead ? "Public API" : "Private"}</span><h2>${escapeHtml(collection.name)}</h2><p>${escapeHtml(collection.description || "Reusable structured content")}</p></div>
              <footer><span>${escapeHtml(collection.fields?.length || 0)} fields</span><strong>${escapeHtml(collection._count?.entries || 0)} entries</strong></footer>
            </a>
          `).join("") : `
            <div class="admin-card content-collection-empty">
              <strong>Create your first collection</strong>
              <p>Use collections for team members, locations, testimonials, resources, events, or any repeated content.</p>
            </div>
          `}
        </div>
      </section>
      ${extensionCards(extensionResponse.extensions || [])}
      ${(extensionResponse.failures || []).length ? `<p class="form-message error">${escapeHtml(extensionResponse.failures.length)} extension manifest${extensionResponse.failures.length === 1 ? " is" : "s are"} invalid. Run pnpm extension:validate for details.</p>` : ""}
    `
  );
  setStatus(errorMessage ? "Collections could not be loaded." : `${collections.length} collections loaded.`);
}

function selectedValues(value) {
  return new Set(Array.isArray(value) ? value.map(String) : value ? [String(value)] : []);
}

function assetPreview(value, field) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first?.url) return '<span class="content-asset-placeholder">No file selected</span>';
  if (field.type === "image") return `<img src="${escapeHtml(first.url)}" alt="${escapeHtml(first.altText || field.label)}" />`;
  return `<a href="${escapeHtml(first.url)}" target="_blank" rel="noopener">Open current file</a>`;
}

function entryField(field, value, relationEntries) {
  const name = `field_${field.key}`;
  const required = field.required ? " required" : "";
  const multiple = field.multiple ? " multiple" : "";
  const help = field.helpText ? `<small>${escapeHtml(field.helpText)}</small>` : "";
  if (field.type === "richText") {
    return `<div class="content-entry-field" data-entry-field data-field-key="${escapeHtml(field.key)}" data-field-type="richText" data-field-multiple="false">${renderRichTextEditor(name, String(value || ""), field.label)}${help}</div>`;
  }
  if (field.type === "boolean") {
    return `<label class="content-entry-field checkbox-field" data-entry-field data-field-key="${escapeHtml(field.key)}" data-field-type="boolean" data-field-multiple="false"><input type="checkbox" name="${escapeHtml(name)}"${value === true ? " checked" : ""} /><span>${escapeHtml(field.label)}</span>${help}</label>`;
  }
  if (["image", "file"].includes(field.type)) {
    const hasAsset = Array.isArray(value) ? value.some((item) => item?.url) : Boolean(value?.url);
    return `
      <div class="content-entry-field content-asset-field" data-entry-field data-field-key="${escapeHtml(field.key)}" data-field-type="${escapeHtml(field.type)}" data-field-multiple="${field.multiple}">
        <span class="content-entry-label">${escapeHtml(field.label)}${field.required ? " *" : ""}</span>
        <input type="hidden" name="${escapeHtml(name)}_current" value="${escapeHtml(JSON.stringify(value ?? (field.multiple ? [] : null)))}" />
        <div class="content-asset-preview" data-content-asset-preview>${assetPreview(value, field)}</div>
        <label class="secondary-button content-file-button">${hasAsset ? "Replace" : "Upload"}<input type="file" name="${escapeHtml(name)}"${field.type === "image" ? ' accept="image/*"' : ""}${multiple}${required && !hasAsset ? " required" : ""} /></label>
        ${hasAsset ? '<button type="button" class="secondary-button compact danger" data-clear-content-asset>Remove current</button>' : ""}
        ${help}
      </div>
    `;
  }
  if (field.type === "select" || field.type === "relation") {
    const values = selectedValues(value);
    const options = field.type === "select"
      ? field.options || []
      : (relationEntries[field.relationCollection] || []).map((entry) => ({ value: entry.slug, label: entry.title }));
    return `
      <label class="content-entry-field" data-entry-field data-field-key="${escapeHtml(field.key)}" data-field-type="${escapeHtml(field.type)}" data-field-multiple="${field.multiple}">
        <span>${escapeHtml(field.label)}</span>
        <select name="${escapeHtml(name)}"${multiple}${required}>${field.multiple ? "" : '<option value="">Choose</option>'}${options.map((option) => `<option value="${escapeHtml(option.value)}"${values.has(String(option.value)) ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>
        ${help}
      </label>
    `;
  }
  if (field.type === "textarea") {
    return `<label class="content-entry-field" data-entry-field data-field-key="${escapeHtml(field.key)}" data-field-type="textarea" data-field-multiple="false"><span>${escapeHtml(field.label)}</span><textarea name="${escapeHtml(name)}" rows="5"${required}${field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : ""}${field.minLength !== undefined ? ` minlength="${field.minLength}"` : ""}${field.maxLength !== undefined ? ` maxlength="${field.maxLength}"` : ""}${field.key === field.collectionTitleField ? " data-title-source" : ""}>${escapeHtml(value || "")}</textarea>${help}</label>`;
  }
  const inputType = ["number", "date", "email", "url"].includes(field.type)
    ? field.type
    : field.type === "dateTime"
      ? "datetime-local"
      : "text";
  const formattedValue = field.type === "dateTime" && value ? String(value).slice(0, 16) : value ?? "";
  const textInput = ["text", "email", "url"].includes(field.type);
  return `<label class="content-entry-field" data-entry-field data-field-key="${escapeHtml(field.key)}" data-field-type="${escapeHtml(field.type)}" data-field-multiple="false"><span>${escapeHtml(field.label)}</span><input type="${inputType}" name="${escapeHtml(name)}" value="${escapeHtml(formattedValue)}"${required}${field.placeholder && textInput ? ` placeholder="${escapeHtml(field.placeholder)}"` : ""}${field.minLength !== undefined && textInput ? ` minlength="${field.minLength}"` : ""}${field.maxLength !== undefined && textInput ? ` maxlength="${field.maxLength}"` : ""}${field.min !== undefined && field.type === "number" ? ` min="${field.min}"` : ""}${field.max !== undefined && field.type === "number" ? ` max="${field.max}"` : ""}${field.type === "number" ? ' step="any"' : ""}${field.key === field.collectionTitleField ? " data-title-source" : ""} />${help}</label>`;
}

function localeOptions(selected) {
  const locales = state.config?.localization?.locales || [{ code: selected || "en", label: (selected || "en").toUpperCase() }];
  return locales.filter((locale) => locale.enabled !== false).map((locale) => (
    `<option value="${escapeHtml(locale.code)}"${locale.code === selected ? " selected" : ""}>${escapeHtml(locale.label || locale.code.toUpperCase())}</option>`
  )).join("");
}

export function renderCollectionEntryPage(collection, entry = null, relationEntries = {}) {
  const isNew = !entry;
  const locale = entry?.locale || state.config?.localization?.defaultLocale || "en";
  const fields = (collection.fields || []).map((field) => ({ ...field, collectionTitleField: collection.titleField }));
  renderAdminShell(
    { view: "collections" },
    `
      <form class="content-entry-form" data-content-entry-form data-collection-slug="${escapeHtml(collection.slug)}" data-entry-slug="${escapeHtml(entry?.slug || "")}" data-entry-locale="${escapeHtml(locale)}">
        <section class="admin-page-header content-model-header">
          <div><p class="section-label">${escapeHtml(collection.name)}</p><h1 class="dashboard-title">${escapeHtml(isNew ? "New entry" : entry.title)}</h1><p class="dashboard-copy">Complete the content fields, then save as a draft or publish.</p></div>
          <div class="button-row"><a class="secondary-button" href="/dashboard/collections/${encodeURIComponent(collection.slug)}" data-dashboard-link>Cancel</a><button type="submit">${isNew ? "Create entry" : "Save entry"}</button></div>
        </section>
        <section class="admin-card content-entry-meta">
          <div class="builder-form-grid">
            <label><span>URL name</span><input name="slug" value="${escapeHtml(entry?.slug || "")}" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxlength="180" required data-slug-target /></label>
            <label><span>Language</span><select name="locale"${isNew ? "" : " disabled"}>${localeOptions(locale)}</select></label>
            <label><span>Status</span><select name="status"><option value="DRAFT"${entry?.status !== "PUBLISHED" && entry?.status !== "ARCHIVED" ? " selected" : ""}>Draft</option><option value="PUBLISHED"${entry?.status === "PUBLISHED" ? " selected" : ""}>Published</option><option value="ARCHIVED"${entry?.status === "ARCHIVED" ? " selected" : ""}>Archived</option></select></label>
            <label><span>Publish at</span><input type="datetime-local" name="publishedAt" value="${entry?.publishedAt ? escapeHtml(new Date(entry.publishedAt).toISOString().slice(0, 16)) : ""}" /><small>Optional. Keep draft status to schedule publishing.</small></label>
          </div>
        </section>
        <section class="admin-card content-entry-fields">
          ${fields.map((field) => entryField(field, entry?.data?.[field.key], relationEntries)).join("")}
        </section>
        ${renderFormMessage()}
        ${!isNew && hasPermission("delete", "cms") ? `<section class="content-model-danger"><div><strong>Delete entry</strong><span>Removes this entry and its revision history.</span></div><button type="button" class="secondary-button danger" data-delete-content-entry="${escapeHtml(entry.slug)}">Delete</button></section>` : ""}
      </form>
    `
  );
  hydrateRichEditors();
  setStatus(isNew ? `Create a ${collection.name} entry.` : `${entry.title} loaded.`);
}

export function syncContentFieldRows() {
  const rows = Array.from(document.querySelectorAll("[data-content-field-row]"));
  rows.forEach((row, index) => {
    const type = row.querySelector("[data-content-field-type]")?.value || "text";
    row.dataset.fieldType = type;
    const order = row.querySelector(".content-field-order");
    if (order) order.textContent = String(index + 1);
    const multiple = row.querySelector("[data-content-field-multiple]");
    if (multiple) multiple.hidden = !["select", "relation", "image", "file"].includes(type);
    const options = row.querySelector("[data-content-field-options]");
    if (options) options.hidden = type !== "select";
    const relation = row.querySelector("[data-content-field-relation]");
    if (relation) relation.hidden = type !== "relation";
    row.querySelectorAll("[data-content-text-validation]").forEach((control) => {
      control.hidden = !["text", "textarea", "richText", "email", "url"].includes(type);
    });
    row.querySelectorAll("[data-content-number-validation]").forEach((control) => {
      control.hidden = type !== "number";
    });
    const label = row.querySelector('[name="fieldLabel"]')?.value.trim() || "field";
    row.querySelectorAll("[data-move-content-field], [data-remove-content-field]").forEach((button) => {
      const action = button.dataset.moveContentField
        ? `Move ${label} ${button.dataset.moveContentField}`
        : `Remove ${label}`;
      button.setAttribute("aria-label", action);
    });
    const up = row.querySelector('[data-move-content-field="up"]');
    const down = row.querySelector('[data-move-content-field="down"]');
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === rows.length - 1;
  });

  const titleSelect = document.querySelector("[data-content-title-field]");
  if (titleSelect) {
    const selected = titleSelect.value;
    const options = rows
      .filter((row) => ["text", "textarea"].includes(row.querySelector("[data-content-field-type]")?.value))
      .map((row) => {
        const key = row.querySelector('[name="fieldKey"]')?.value.trim();
        const label = row.querySelector('[name="fieldLabel"]')?.value.trim();
        return key ? { key, label: label || key } : null;
      })
      .filter(Boolean);
    titleSelect.innerHTML = options.map((option) => `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`).join("");
    titleSelect.value = options.some((option) => option.key === selected) ? selected : options[0]?.key || "";
  }
}
