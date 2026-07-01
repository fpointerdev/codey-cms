import { escapeHtml } from "./core.js";
import { renderRichText } from "./public-renderer.js";
import { hydrateRichEditors, syncRichEditors } from "./rich-editor.js";

function modalFieldHtml(field) {
  const value = field.value ?? "";
  const required = field.required === false ? "" : " required";
  const help = field.help ? `<small class="field-help">${escapeHtml(field.help)}</small>` : "";
  const numericAttrs = ["min", "max", "step"]
    .filter((name) => field[name] !== undefined)
    .map((name) => `${name}="${escapeHtml(field[name])}"`)
    .join(" ");

  if (field.type === "section") {
    return `
      <div class="modal-field-section">
        <strong>${escapeHtml(field.label)}</strong>
        ${help}
      </div>
    `;
  }

  if (field.type === "textarea") {
    return `
      <label>
        <span>${escapeHtml(field.label)}</span>
        <textarea name="${escapeHtml(field.name)}" rows="${field.rows || 4}"${required}>${escapeHtml(value)}</textarea>
        ${help}
      </label>
    `;
  }

  if (field.type === "code") {
    return `
      <label class="advanced-code-field">
        <span>${escapeHtml(field.label)}</span>
        <textarea name="${escapeHtml(field.name)}" rows="${field.rows || 8}" spellcheck="false"${required}>${escapeHtml(value)}</textarea>
        ${help}
      </label>
    `;
  }

  if (field.type === "richtext") {
    return `
      <label>
        <span>${escapeHtml(field.label)}</span>
      </label>
      <div class="rich-editor" data-rich-editor>
        <div class="rich-editor-header">
          <span>${escapeHtml(field.label)}</span>
          <div class="rich-toolbar" data-rich-toolbar aria-label="${escapeHtml(field.label)} toolbar">
            <span class="rich-format-group">
              <select data-rich-block aria-label="Text style">
                <option value="">Paragraph</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
                <option value="h4">Heading 4</option>
              </select>
            </span>
            <span class="rich-format-group">
              <button type="button" class="rich-tool-button" data-rich-command="bold" aria-label="Bold"><strong>B</strong></button>
              <button type="button" class="rich-tool-button" data-rich-command="italic" aria-label="Italic"><em>I</em></button>
              <button type="button" class="rich-tool-button" data-rich-command="underline" aria-label="Underline"><u>U</u></button>
              <button type="button" class="rich-tool-button" data-rich-command="strikeThrough" aria-label="Strikethrough"><s>S</s></button>
            </span>
            <span class="rich-format-group">
              <button type="button" class="rich-tool-button" data-rich-command="insertOrderedList" aria-label="Ordered list">1.</button>
              <button type="button" class="rich-tool-button" data-rich-command="insertUnorderedList" aria-label="Bullet list">UL</button>
              <select data-rich-align aria-label="Text alignment">
                <option value="">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </span>
            <span class="rich-format-group rich-link-group">
              <button type="button" class="rich-tool-button" data-rich-command="blockquote" aria-label="Quote">Quote</button>
              <input type="url" data-rich-link-url placeholder="https://..." aria-label="Link URL" />
              <button type="button" class="rich-tool-button" data-rich-command="createLink" aria-label="Apply link">Link</button>
              <button type="button" class="rich-tool-button" data-rich-command="removeFormat" aria-label="Clear formatting">Clear</button>
            </span>
          </div>
        </div>
        <input type="hidden" name="${escapeHtml(field.name)}" value="${escapeHtml(value)}" data-rich-source />
        <div class="rich-editor-surface" data-rich-surface>${renderRichText(value || "<p>Start writing content...</p>")}</div>
      </div>
    `;
  }

  if (field.type === "select") {
    return `
      <label>
        <span>${escapeHtml(field.label)}</span>
        <select name="${escapeHtml(field.name)}"${required}>
          ${(field.options || [])
            .map(
              (option) => `
                <option value="${escapeHtml(option.value)}"${option.value === value ? " selected" : ""}>
                  ${escapeHtml(option.label)}
                </option>
              `
            )
            .join("")}
        </select>
        ${help}
      </label>
    `;
  }

  if (field.type === "choice") {
    return `
      <fieldset class="choice-field${field.compact ? " compact" : ""}">
        <legend>${escapeHtml(field.label)}</legend>
        ${help}
        <div class="choice-card-grid">
          ${(field.options || [])
            .map((option) => {
              const selected = option.value === value;
              const preview = option.preview || option.value;

              return `
                <label class="choice-card">
                  <input name="${escapeHtml(field.name)}" type="radio" value="${escapeHtml(option.value)}"${selected ? " checked" : ""}${required} />
                  <span class="choice-card-frame">
                    <span class="choice-preview choice-preview-${escapeHtml(preview)}" aria-hidden="true">
                      <i></i><i></i><i></i><i></i>
                    </span>
                    <span class="choice-card-copy">
                      <strong>${escapeHtml(option.label)}</strong>
                      ${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}
                    </span>
                  </span>
                </label>
              `;
            })
            .join("")}
        </div>
      </fieldset>
    `;
  }

  if (field.type === "checkbox") {
    return `
      <label class="checkbox-field">
        <input name="${escapeHtml(field.name)}" type="checkbox"${field.checked || value ? " checked" : ""} />
        <span>${escapeHtml(field.label)}</span>
        ${help}
      </label>
    `;
  }

  if (field.type === "file") {
    return `
      <label>
        <span>${escapeHtml(field.label)}</span>
        <input name="${escapeHtml(field.name)}" type="file" accept="${escapeHtml(field.accept || "")}"${field.multiple ? " multiple" : ""}${required} data-file-preview-input />
        <div class="file-preview-list" data-file-preview></div>
        ${help}
      </label>
    `;
  }

  if (field.type === "gallery") {
    const items = Array.isArray(value) ? value : [];
    const mediaAssets = Array.isArray(field.mediaAssets) ? field.mediaAssets : [];
    const existingUrls = new Set(items.map((item) => item?.url).filter(Boolean));
    const libraryItems = mediaAssets
      .filter((asset) => asset?.url && !existingUrls.has(asset.url))
      .map((asset) => ({
        url: asset.url,
        mediaAssetId: asset.id || "",
        alt: asset.altText || asset.filename || "Media library image",
        caption: "",
        link: "",
        source: "library",
        selected: false
      }));
    const selectableItems = [
      ...items.map((item) => ({ ...item, source: "existing", selected: true })),
      ...libraryItems
    ];

    return `
      <div class="gallery-field" data-gallery-field>
        <div>
          <span>${escapeHtml(field.label)}</span>
          ${help || '<small class="field-help">Choose images from the media library, upload new ones, and drag selected cards into the right order.</small>'}
        </div>
        ${
          selectableItems.length
            ? `<div class="gallery-existing-list" data-gallery-sort-list>
                ${selectableItems
                  .map(
                    (item, index) => `
                      <article class="gallery-existing-item${item.source === "library" ? " gallery-library-item" : ""}" draggable="true" data-gallery-sort-item>
                        <input
                          name="${escapeHtml(field.name)}SelectedIndex"
                          type="checkbox"
                          value="${escapeHtml(index)}"
                          ${item.selected ? "checked" : ""}
                        />
                        <input name="${escapeHtml(field.name)}Sort${index}" type="hidden" value="${escapeHtml(index)}" data-gallery-sort-value />
                        <input name="${escapeHtml(field.name)}Url${index}" type="hidden" value="${escapeHtml(item.url || "")}" />
                        <input name="${escapeHtml(field.name)}MediaAssetId${index}" type="hidden" value="${escapeHtml(item.mediaAssetId || "")}" />
                        <img src="${escapeHtml(item.url || "")}" alt="${escapeHtml(item.alt || `Slide ${index + 1}`)}" />
                        <div class="gallery-existing-content">
                          <div class="gallery-existing-toolbar">
                            <span data-gallery-position>Position ${index + 1}</span>
                            <div>
                              <button type="button" class="secondary-button compact" data-gallery-move="up">Up</button>
                              <button type="button" class="secondary-button compact" data-gallery-move="down">Down</button>
                            </div>
                          </div>
                          <label>
                            <span>Image description</span>
                            <input name="${escapeHtml(field.name)}Alt${index}" value="${escapeHtml(item.alt || `Slide ${index + 1}`)}" />
                          </label>
                          <label>
                            <span>Caption</span>
                            <textarea name="${escapeHtml(field.name)}Caption${index}" rows="3">${escapeHtml(item.caption || "")}</textarea>
                          </label>
                          <label>
                            <span>Optional link</span>
                            <input name="${escapeHtml(field.name)}Link${index}" value="${escapeHtml(item.link || "")}" />
                          </label>
                          ${item.source === "library" ? '<small class="field-help">Media library image. Check it to include it.</small>' : ""}
                        </div>
                      </article>
                    `
                  )
                  .join("")}
              </div>`
            : '<p class="gallery-empty">No images selected yet. Upload images below or add assets to the media library first.</p>'
        }
        <label class="gallery-upload-box">
          <span>Upload images</span>
          <input name="${escapeHtml(field.name)}Files" type="file" accept="image/*" multiple data-file-preview-input />
          <div class="file-preview-list" data-file-preview></div>
        </label>
      </div>
    `;
  }

  return `
    <label>
      <span>${escapeHtml(field.label)}</span>
      <input name="${escapeHtml(field.name)}" type="${escapeHtml(field.type || "text")}" value="${escapeHtml(value)}"${numericAttrs ? ` ${numericAttrs}` : ""}${required} />
      ${help}
    </label>
  `;
}

function fieldGroupId(label, index) {
  return `modal-group-${String(label || "general").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || index + 1}`;
}

function groupedModalFields(fields = []) {
  const groups = [];

  fields.forEach((field) => {
    const label = typeof field.group === "string" && field.group.trim() ? field.group.trim() : "Content";
    let group = groups.find((item) => item.label === label);

    if (!group) {
      group = {
        id: fieldGroupId(label, groups.length),
        label,
        fields: []
      };
      groups.push(group);
    }

    group.fields.push(field);
  });

  return groups;
}

function modalFieldsHtml(fields = []) {
  const groups = groupedModalFields(fields);

  if (groups.length <= 1) {
    return fields.map(modalFieldHtml).join("");
  }

  return `
    <div class="modal-tab-shell" data-modal-tab-shell>
      <div class="modal-tabs" role="tablist" aria-label="Editor sections">
        ${groups
          .map(
            (group, index) => `
              <button
                type="button"
                class="modal-tab${index === 0 ? " active" : ""}"
                role="tab"
                id="${escapeHtml(group.id)}-tab"
                aria-controls="${escapeHtml(group.id)}-panel"
                aria-selected="${index === 0 ? "true" : "false"}"
                data-modal-tab-target="${escapeHtml(group.id)}"
              >
                ${escapeHtml(group.label)}
              </button>
            `
          )
          .join("")}
      </div>
      ${groups
        .map(
          (group, index) => `
            <div
              class="modal-tab-panel${index === 0 ? " active" : ""}"
              role="tabpanel"
              id="${escapeHtml(group.id)}-panel"
              aria-labelledby="${escapeHtml(group.id)}-tab"
              data-modal-tab-panel="${escapeHtml(group.id)}"
              ${index === 0 ? "" : "hidden"}
            >
              ${group.fields.map(modalFieldHtml).join("")}
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function filePreviewHtml(files = []) {
  const imageFiles = files.filter((file) => file?.type?.startsWith("image/"));
  const canPreviewImages = typeof URL !== "undefined" && typeof URL.createObjectURL === "function";

  if (!files.length) return "";

  return files
    .map((file, index) => {
      const objectUrl = imageFiles.includes(file) && canPreviewImages ? URL.createObjectURL(file) : "";

      return `
        <span class="file-preview-item">
          ${objectUrl ? `<img src="${escapeHtml(objectUrl)}" alt="" />` : ""}
          <span>${escapeHtml(file.name || `File ${index + 1}`)}</span>
        </span>
      `;
    })
    .join("");
}

export function parseGalleryExisting(formData, fieldName) {
  return formData
    .getAll(`${fieldName}SelectedIndex`)
    .map((indexValue, fallbackSort) => {
      const index = Number(indexValue);
      const url = String(formData.get(`${fieldName}Url${index}`) || "").trim();
      if (!url) return null;

      return {
        sortOrder: Number(formData.get(`${fieldName}Sort${index}`) ?? fallbackSort),
        url,
        mediaAssetId: String(formData.get(`${fieldName}MediaAssetId${index}`) || "").trim() || undefined,
        alt: String(formData.get(`${fieldName}Alt${index}`) || "").trim(),
        caption: String(formData.get(`${fieldName}Caption${index}`) || "").trim(),
        link: String(formData.get(`${fieldName}Link${index}`) || "").trim()
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(({ sortOrder, ...item }) => item);
}

function renumberGalleryItems(list) {
  Array.from(list.querySelectorAll("[data-gallery-sort-item]")).forEach((item, index) => {
    const sortInput = item.querySelector("[data-gallery-sort-value]");
    const position = item.querySelector("[data-gallery-position]");

    if (sortInput) sortInput.value = String(index);
    if (position) position.textContent = `Position ${index + 1}`;
  });
}

function moveGalleryItem(item, direction) {
  const list = item.closest("[data-gallery-sort-list]");
  if (!list) return;

  if (direction === "up" && item.previousElementSibling) {
    list.insertBefore(item, item.previousElementSibling);
  }

  if (direction === "down" && item.nextElementSibling) {
    list.insertBefore(item.nextElementSibling, item);
  }

  renumberGalleryItems(list);
}

function openModalForm(config) {
  return new Promise((resolveModal) => {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <form data-modal-form>
          <div class="modal-header">
            <div>
              <p class="section-label">${escapeHtml(config.label || "Editor")}</p>
              <h2 id="modal-title">${escapeHtml(config.title)}</h2>
              ${config.description ? `<p>${escapeHtml(config.description)}</p>` : ""}
            </div>
            <button type="button" class="modal-close" data-modal-cancel aria-label="Close">×</button>
          </div>
          <div class="modal-body">
            ${modalFieldsHtml(config.fields)}
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary-button" data-modal-cancel>Cancel</button>
            <button type="submit">${escapeHtml(config.submitLabel || "Save")}</button>
          </div>
        </form>
      </section>
    `;

    function close(result) {
      modal.remove();
      resolveModal(result);
    }

    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-modal-cancel]")) {
        close(null);
      }
    });

    modal.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-modal-tab-target]");
      if (!tab) return;

      event.preventDefault();
      const shell = tab.closest("[data-modal-tab-shell]");
      const target = tab.dataset.modalTabTarget;
      shell?.querySelectorAll("[data-modal-tab-target]").forEach((button) => {
        const selected = button.dataset.modalTabTarget === target;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", selected ? "true" : "false");
      });
      shell?.querySelectorAll("[data-modal-tab-panel]").forEach((panel) => {
        const selected = panel.dataset.modalTabPanel === target;
        panel.classList.toggle("active", selected);
        panel.hidden = !selected;
      });
    });

    modal.querySelector("[data-modal-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      syncRichEditors(event.currentTarget);
      const formData = new FormData(event.currentTarget);
      const values = {};

      config.fields.forEach((field) => {
        if (field.type === "section") return;

        if (field.type === "gallery") {
          values[field.name] = {
            existing: parseGalleryExisting(formData, field.name),
            files: formData.getAll(`${field.name}Files`)
          };
          return;
        }

        const value = field.multiple ? formData.getAll(field.name) : formData.get(field.name);
        if (field.type === "file") {
          values[field.name] = value;
          return;
        }
        if (field.type === "checkbox") {
          values[field.name] = value === "on";
          return;
        }
        values[field.name] = String(value || "").trim();
      });
      close(values);
    });

    modal.addEventListener("change", (event) => {
      const input = event.target.closest("[data-file-preview-input]");
      const preview = input?.parentElement?.querySelector?.("[data-file-preview]");
      if (!input || !preview) return;

      preview.innerHTML = filePreviewHtml(Array.from(input.files || []));
    });

    modal.addEventListener("click", (event) => {
      const moveButton = event.target.closest("[data-gallery-move]");
      if (!moveButton) return;

      event.preventDefault();
      const item = moveButton.closest("[data-gallery-sort-item]");
      if (item) moveGalleryItem(item, moveButton.dataset.galleryMove);
    });

    let draggedGalleryItem = null;

    modal.addEventListener("dragstart", (event) => {
      const item = event.target.closest("[data-gallery-sort-item]");
      if (!item) return;

      draggedGalleryItem = item;
      item.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", "gallery-item");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });

    modal.addEventListener("dragover", (event) => {
      const target = event.target.closest("[data-gallery-sort-item]");
      if (!draggedGalleryItem || !target || target === draggedGalleryItem) return;

      event.preventDefault();
      const box = target.getBoundingClientRect();
      const before = event.clientY < box.top + box.height / 2;
      target.parentElement.insertBefore(draggedGalleryItem, before ? target : target.nextElementSibling);
      renumberGalleryItems(target.parentElement);
    });

    modal.addEventListener("dragend", () => {
      draggedGalleryItem?.classList.remove("dragging");
      draggedGalleryItem = null;
    });

    document.body.append(modal);
    modal.querySelectorAll("[data-gallery-sort-list]").forEach(renumberGalleryItems);
    hydrateRichEditors(modal);
    modal.querySelector("input, textarea, select, button")?.focus();
  });
}

let modalFormHandler = openModalForm;

export function getModalFormHandler() {
  return modalFormHandler;
}

export function setModalFormHandler(handler) {
  modalFormHandler = handler || openModalForm;
}

export function parseEditableValue(block, nextValue) {
  if (block.type === "TEXT" || block.type === "RICH_TEXT" || block.type === "EMBED") {
    return nextValue;
  }

  if (block.type === "BUTTON" || block.type === "CTA") {
    const [label, url] = nextValue.split("|").map((part) => part.trim());
    return { label, url };
  }

  if (block.type === "IMAGE") {
    const [url, alt = ""] = nextValue.split("|").map((part) => part.trim());
    return { url, alt };
  }

  try {
    return JSON.parse(nextValue);
  } catch {
    throw new Error("This advanced field must stay valid structured content. Use a standard element when possible.");
  }
}

export function editablePromptValue(block) {
  if (block.type === "BUTTON" || block.type === "CTA") {
    return `${block.value.label || ""} | ${block.value.url || ""}`;
  }

  if (block.type === "IMAGE") {
    return `${block.value.url || ""} | ${block.value.alt || ""}`;
  }

  if (block.type === "TEXT" || block.type === "RICH_TEXT" || block.type === "EMBED") {
    return block.value;
  }

  return JSON.stringify(block.value, null, 2);
}
