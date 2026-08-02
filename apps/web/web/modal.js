import { escapeHtml } from "./core.js";
import { renderRichText } from "./public-renderer.js";
import { hydrateRichEditors, syncRichEditors } from "./rich-editor.js";

function richTextFieldHtml(name, label, value = "", options = {}) {
  const help = options.help ? `<small class="field-help">${escapeHtml(options.help)}</small>` : "";
  const fallbackHtml = options.emptyHtml === undefined ? "<p>Start writing content...</p>" : options.emptyHtml;
  const surfaceHtml = value ? renderRichText(value) : renderRichText(fallbackHtml);

  return `
    <label>
      <span>${escapeHtml(label)}</span>
    </label>
    <div class="rich-editor${options.compact ? " rich-editor-compact" : ""}" data-rich-editor>
      <div class="rich-editor-header">
        <span>${escapeHtml(label)}</span>
        <div class="rich-toolbar" data-rich-toolbar aria-label="${escapeHtml(label)} toolbar">
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
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" data-rich-source />
      <div class="rich-editor-surface" data-rich-surface>${surfaceHtml}</div>
    </div>
    ${help}
  `;
}

function galleryItemTitle(item = {}, index = 0, itemLabel = "Image") {
  const fallback = `${itemLabel} ${index + 1}`;
  const text = String(item.alt || item.caption || item.url || "")
    .replace(/<[^>]*>/g, "")
    .trim();

  return text ? text.slice(0, 80) : fallback;
}

function galleryItemMeta(item = {}, index = 0, itemLabel = "Image") {
  if (item.source === "library") return "Media library";
  if (item.source === "manual") return "Manual slide";
  return `${itemLabel} ${index + 1}`;
}

function galleryPreviewHtml(item = {}, alt = "", className = "gallery-preview-frame", emptyText = "No image") {
  return `
    <span class="${escapeHtml(className)}" data-gallery-preview>
      ${
        item.url
          ? `<img src="${escapeHtml(item.url || "")}" alt="${escapeHtml(alt)}" />`
          : `<span class="gallery-accordion-placeholder" aria-hidden="true">${escapeHtml(emptyText)}</span>`
      }
    </span>
  `;
}

function galleryItemHtml(fieldName, item = {}, index = 0, options = {}) {
  const itemLabel = options.itemLabel || "Image";
  const accordion = options.accordion === true;
  const imageInput = options.imageInput || "hidden";
  const captionInput = options.captionInput || "textarea";
  const showUrlInput = options.showUrlInput === true;
  const sourceClass = item.source === "library"
    ? " gallery-library-item"
    : item.source === "manual"
      ? " gallery-manual-item"
      : "";
  const itemTitle = galleryItemTitle(item, index, itemLabel);
  const position = `${itemLabel} ${index + 1}`;
  const selected = item.selected ? "checked" : "";
  const image = accordion
    ? galleryPreviewHtml(item, item.alt || position)
    : `<img src="${escapeHtml(item.url || "")}" alt="${escapeHtml(item.alt || position)}" />`;
  const selectedInput = accordion
    ? `<input name="${escapeHtml(fieldName)}SelectedIndex" type="hidden" value="${escapeHtml(index)}" />`
    : `
      <input
        name="${escapeHtml(fieldName)}SelectedIndex"
        type="checkbox"
        value="${escapeHtml(index)}"
        ${selected}
      />
    `;
  const hiddenUrlInput = `<input name="${escapeHtml(fieldName)}Url${index}" type="hidden" value="${escapeHtml(item.url || "")}" />`;
  const imageField = imageInput === "file"
    ? `
      ${hiddenUrlInput}
      <label class="gallery-image-picker">
        <span class="gallery-image-label">Image</span>
        ${galleryPreviewHtml(item, item.alt || position, "gallery-image-preview", "Upload image")}
        <span class="gallery-image-change">${item.url ? "&#9998;" : "Upload image"}</span>
        <input name="${escapeHtml(fieldName)}File${index}" type="file" accept="image/*" data-gallery-image-input />
      </label>
    `
    : showUrlInput
      ? `<label>
        <span>Image URL</span>
        <input name="${escapeHtml(fieldName)}Url${index}" value="${escapeHtml(item.url || "")}" placeholder="/uploads/image.jpg or https://..." />
      </label>`
      : hiddenUrlInput;
  const captionField = captionInput === "richtext"
    ? richTextFieldHtml(`${fieldName}Caption${index}`, "Caption", item.caption || "", { compact: true, emptyHtml: "" })
    : `
      <label>
        <span>Caption</span>
        <textarea name="${escapeHtml(fieldName)}Caption${index}" rows="3">${escapeHtml(item.caption || "")}</textarea>
      </label>
    `;
  const controls = `
    <div class="gallery-existing-toolbar">
      <span data-gallery-position>Position ${index + 1}</span>
      <div>
        <button type="button" class="secondary-button compact" data-gallery-move="up">Up</button>
        <button type="button" class="secondary-button compact" data-gallery-move="down">Down</button>
        ${accordion ? `<button type="button" class="secondary-button compact danger" data-gallery-delete-item aria-label="Delete ${escapeHtml(itemTitle)}">Delete</button>` : ""}
      </div>
    </div>
  `;
  const fields = `
    ${imageField}
    <label>
      <span>Image description</span>
      <input name="${escapeHtml(fieldName)}Alt${index}" value="${escapeHtml(item.alt || position)}" />
    </label>
    ${captionField}
    <label>
      <span>Optional link</span>
      <input name="${escapeHtml(fieldName)}Link${index}" value="${escapeHtml(item.link || "")}" />
    </label>
    ${item.source === "library" ? '<small class="field-help">Media library image. Check it to include it.</small>' : ""}
  `;

  if (accordion) {
    return `
      <details class="gallery-existing-item gallery-accordion-item${sourceClass}" draggable="true" data-gallery-sort-item ${item.open ? "open" : ""}>
        <summary class="gallery-accordion-summary">
          ${selectedInput}
          ${image}
          <span class="gallery-accordion-title">
            <strong data-gallery-title-text>${escapeHtml(itemTitle)}</strong>
            <small>${escapeHtml(galleryItemMeta(item, index, itemLabel))}</small>
          </span>
          <span data-gallery-position>Position ${index + 1}</span>
        </summary>
        <input name="${escapeHtml(fieldName)}Sort${index}" type="hidden" value="${escapeHtml(index)}" data-gallery-sort-value />
        <input name="${escapeHtml(fieldName)}MediaAssetId${index}" type="hidden" value="${escapeHtml(item.mediaAssetId || "")}" />
        <div class="gallery-existing-content">
          ${controls}
          ${fields}
        </div>
      </details>
    `;
  }

  return `
    <article class="gallery-existing-item${sourceClass}" draggable="true" data-gallery-sort-item>
      ${selectedInput}
      <input name="${escapeHtml(fieldName)}Sort${index}" type="hidden" value="${escapeHtml(index)}" data-gallery-sort-value />
      <input name="${escapeHtml(fieldName)}MediaAssetId${index}" type="hidden" value="${escapeHtml(item.mediaAssetId || "")}" />
      ${image}
      <div class="gallery-existing-content">
        ${controls}
        ${fields}
      </div>
    </article>
  `;
}

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
    return richTextFieldHtml(field.name, field.label, value, { help: field.help });
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
    if (field.imagePicker) {
      const previewUrl = String(field.previewUrl || "").trim();
      const previewAlt = field.previewAlt || field.label || "Selected image";

      return `
        <label class="gallery-image-picker modal-image-picker">
          <span class="gallery-image-label">${escapeHtml(field.label)}</span>
          <span class="gallery-image-preview" data-image-picker-preview>
            ${
              previewUrl
                ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(previewAlt)}" />`
                : '<span class="gallery-accordion-placeholder" aria-hidden="true">Upload image</span>'
            }
          </span>
          <span class="gallery-image-change">${previewUrl ? "&#9998;" : "Upload image"}</span>
          <input name="${escapeHtml(field.name)}" type="file" accept="${escapeHtml(field.accept || "image/*")}"${required} data-image-picker-input />
        </label>
        ${help}
      `;
    }

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
    const accordion = field.itemLayout === "accordion";
    const itemLabel = field.itemLabel || "Image";
    const imageInput = field.imageInput || (accordion ? "file" : "hidden");
    const captionInput = field.captionInput || (accordion ? "richtext" : "textarea");
    const emptyText = field.emptyText || (accordion ? `No ${itemLabel.toLowerCase()}s yet. Add one below.` : "No images selected yet. Upload images below or add assets to the media library first.");
    const showUrlInput = field.showUrlInput === true;
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
    const selectableItems = accordion
      ? items.map((item, index) => ({ ...item, source: "existing", selected: true, open: index === 0 }))
      : [
        ...items.map((item) => ({ ...item, source: "existing", selected: true })),
        ...libraryItems
      ];

    return `
      <div class="gallery-field" data-gallery-field>
        <div>
          <span>${escapeHtml(field.label)}</span>
          ${help || '<small class="field-help">Choose images from the media library, upload new ones, and drag selected cards into the right order.</small>'}
        </div>
        <p class="gallery-empty" data-gallery-empty ${selectableItems.length ? "hidden" : ""}>${escapeHtml(emptyText)}</p>
        <div
          class="gallery-existing-list${accordion ? " gallery-accordion-list" : ""}"
          data-gallery-sort-list
          data-gallery-field-name="${escapeHtml(field.name)}"
          data-gallery-item-label="${escapeHtml(itemLabel)}"
          data-gallery-image-input="${escapeHtml(imageInput)}"
          data-gallery-caption-input="${escapeHtml(captionInput)}"
          data-gallery-show-url-input="${showUrlInput ? "true" : "false"}"
          data-gallery-accordion="${accordion ? "true" : "false"}"
          ${!accordion && !selectableItems.length ? "hidden" : ""}
        >
          ${selectableItems
            .map((item, index) => galleryItemHtml(field.name, item, index, { accordion, itemLabel, imageInput, captionInput, showUrlInput }))
            .join("")}
        </div>
        ${accordion ? `<div class="button-row gallery-add-row"><button type="button" class="secondary-button" data-gallery-add-item="${escapeHtml(field.name)}">${escapeHtml(field.addItemLabel || "+ Add item")}</button></div>` : ""}
        ${accordion ? "" : `
          <label class="gallery-upload-box">
            <span>Upload images</span>
            <input name="${escapeHtml(field.name)}Files" type="file" accept="image/*" multiple data-file-preview-input />
            <div class="file-preview-list" data-file-preview></div>
          </label>
        `}
      </div>
    `;
  }

  return `
    <label>
      <span>${escapeHtml(field.label)}</span>
      <input name="${escapeHtml(field.name)}" type="${escapeHtml(field.type || "text")}" value="${escapeHtml(value)}"${numericAttrs ? ` ${numericAttrs}` : ""}${field.readOnly ? " readonly" : ""}${required} />
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
      const file = formData.get(`${fieldName}File${index}`);
      const hasFile = Boolean(
        file &&
        typeof file === "object" &&
        typeof file.arrayBuffer === "function" &&
        file.size
      );
      if (!url && !hasFile) return null;

      return {
        sortOrder: Number(formData.get(`${fieldName}Sort${index}`) ?? fallbackSort),
        url,
        mediaAssetId: String(formData.get(`${fieldName}MediaAssetId${index}`) || "").trim() || undefined,
        alt: String(formData.get(`${fieldName}Alt${index}`) || "").trim(),
        caption: String(formData.get(`${fieldName}Caption${index}`) || "").trim(),
        link: String(formData.get(`${fieldName}Link${index}`) || "").trim(),
        ...(hasFile ? { file } : {})
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(({ sortOrder: _sortOrder, ...item }) => item);
}

function renumberGalleryItems(list) {
  Array.from(list.querySelectorAll("[data-gallery-sort-item]")).forEach((item, index) => {
    const sortInput = item.querySelector("[data-gallery-sort-value]");

    if (sortInput) sortInput.value = String(index);
    item.querySelectorAll("[data-gallery-position]").forEach((position) => {
      position.textContent = `Position ${index + 1}`;
    });
  });
}

function updateGalleryEmptyState(field) {
  const list = field.querySelector("[data-gallery-sort-list]");
  const empty = field.querySelector("[data-gallery-empty]");
  if (!list || !empty) return;

  empty.hidden = Boolean(list.querySelector("[data-gallery-sort-item]"));
  list.hidden = list.dataset.galleryAccordion !== "true" && !list.querySelector("[data-gallery-sort-item]");
}

function nextGalleryItemIndex(list, fieldName) {
  const selectedName = `${fieldName}SelectedIndex`;
  const indices = Array.from(list.querySelectorAll("input"))
    .filter((input) => input.name === selectedName)
    .map((input) => Number(input.value))
    .filter((index) => Number.isInteger(index));

  return Math.max(-1, ...indices) + 1;
}

function addGalleryItem(button) {
  const field = button.closest("[data-gallery-field]");
  const list = field?.querySelector("[data-gallery-sort-list]");
  const fieldName = button.dataset.galleryAddItem || list?.dataset.galleryFieldName || "";
  if (!field || !list || !fieldName) return;

  const itemLabel = list.dataset.galleryItemLabel || "Image";
  const index = nextGalleryItemIndex(list, fieldName);

  list.insertAdjacentHTML("beforeend", galleryItemHtml(
    fieldName,
    {
      url: "",
      alt: `${itemLabel} ${list.querySelectorAll("[data-gallery-sort-item]").length + 1}`,
      caption: "",
      link: "",
      source: "manual",
      selected: true,
      open: true
    },
    index,
    {
      accordion: list.dataset.galleryAccordion === "true",
      itemLabel,
      imageInput: list.dataset.galleryImageInput || "hidden",
      captionInput: list.dataset.galleryCaptionInput || "textarea",
      showUrlInput: list.dataset.galleryShowUrlInput === "true"
    }
  ));

  renumberGalleryItems(list);
  updateGalleryEmptyState(field);
  const newItem = list.querySelector("[data-gallery-sort-item]:last-child");
  if (newItem) hydrateRichEditors(newItem);
  newItem?.querySelector?.("[data-gallery-image-input]")?.focus?.();
}

function deleteGalleryItem(button) {
  const item = button.closest("[data-gallery-sort-item]");
  const field = button.closest("[data-gallery-field]");
  const list = item?.closest("[data-gallery-sort-list]");
  if (!item || !field || !list) return;

  item.remove();
  renumberGalleryItems(list);
  updateGalleryEmptyState(field);
}

function updateGalleryImagePreview(input) {
  const file = Array.from(input.files || []).find((item) => item?.type?.startsWith("image/") && item.size);
  const item = input.closest("[data-gallery-sort-item]");
  const canPreviewImages = typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
  if (!file || !item || !canPreviewImages) return;

  const objectUrl = URL.createObjectURL(file);
  const previewHtml = `<img src="${escapeHtml(objectUrl)}" alt="${escapeHtml(file.name || "Selected image")}" />`;
  item.querySelectorAll("[data-gallery-preview]").forEach((preview) => {
    preview.innerHTML = previewHtml;
  });

  const changeLabel = item.querySelector(".gallery-image-change");
  if (changeLabel) changeLabel.innerHTML = "&#9998;";
}

function updateImagePickerPreview(input) {
  const file = Array.from(input.files || []).find((item) => item?.type?.startsWith("image/") && item.size);
  const picker = input.closest(".gallery-image-picker");
  const preview = picker?.querySelector?.("[data-image-picker-preview]");
  const canPreviewImages = typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
  if (!file || !picker || !preview || !canPreviewImages) return;

  preview.innerHTML = `<img src="${escapeHtml(URL.createObjectURL(file))}" alt="${escapeHtml(file.name || "Selected image")}" />`;
  const changeLabel = picker.querySelector(".gallery-image-change");
  if (changeLabel) changeLabel.innerHTML = "&#9998;";
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

function activateModalTab(tab) {
  const shell = tab?.closest?.("[data-modal-tab-shell]");
  const target = tab?.dataset?.modalTabTarget;
  if (!shell || !target) return;

  shell.querySelectorAll("[data-modal-tab-target]").forEach((button) => {
    const selected = button.dataset.modalTabTarget === target;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });
  shell.querySelectorAll("[data-modal-tab-panel]").forEach((panel) => {
    const selected = panel.dataset.modalTabPanel === target;
    panel.classList.toggle("active", selected);
    panel.hidden = !selected;
  });
}

function revealInvalidControl(form) {
  const control = form.querySelector(":invalid");
  if (!control) return false;

  const panel = control.closest("[data-modal-tab-panel]");
  const tabTarget = panel?.dataset?.modalTabPanel;
  const tab = tabTarget
    ? form.querySelector(`[data-modal-tab-target="${tabTarget}"]`)
    : null;
  if (tab) activateModalTab(tab);

  control.focus?.();
  control.reportValidity?.();
  return true;
}

function openModalForm(config) {
  return new Promise((resolveModal) => {
    const fields = Array.isArray(config.fields) ? config.fields : [];
    const previouslyFocused = document.activeElement;
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <section class="modal-panel${fields.length ? "" : " modal-panel-confirmation"}" role="dialog" aria-modal="true" aria-labelledby="modal-title"${config.description ? ' aria-describedby="modal-description"' : ""}>
        <form data-modal-form novalidate>
          <div class="modal-header">
            <div>
              <p class="section-label">${escapeHtml(config.label || "Editor")}</p>
              <h2 id="modal-title">${escapeHtml(config.title)}</h2>
              ${config.description ? `<p id="modal-description">${escapeHtml(config.description)}</p>` : ""}
            </div>
            <button type="button" class="modal-close" data-modal-cancel aria-label="Close">×</button>
          </div>
          ${fields.length ? `<div class="modal-body">${modalFieldsHtml(fields)}</div>` : ""}
          <div class="modal-actions">
            <button type="button" class="secondary-button" data-modal-cancel>Cancel</button>
            <button type="submit"${config.destructive ? ' class="danger-button"' : ""}>${escapeHtml(config.submitLabel || "Save")}</button>
          </div>
        </form>
      </section>
    `;

    function close(result) {
      document.removeEventListener("keydown", handleKeydown);
      modal.remove();
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
      resolveModal(result);
    }

    function handleKeydown(event) {
      if (event.key === "Escape") close(null);
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
      activateModalTab(tab);
    });

    modal.querySelector("[data-modal-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      syncRichEditors(event.currentTarget);
      if (revealInvalidControl(event.currentTarget)) return;

      const formData = new FormData(event.currentTarget);
      const values = {};

      fields.forEach((field) => {
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
      const imagePickerInput = event.target.closest("[data-image-picker-input]");
      if (imagePickerInput) {
        updateImagePickerPreview(imagePickerInput);
        return;
      }

      const galleryImageInput = event.target.closest("[data-gallery-image-input]");
      if (galleryImageInput) {
        updateGalleryImagePreview(galleryImageInput);
        return;
      }

      const input = event.target.closest("[data-file-preview-input]");
      const preview = input?.parentElement?.querySelector?.("[data-file-preview]");
      if (!input || !preview) return;

      preview.innerHTML = filePreviewHtml(Array.from(input.files || []));
    });

    modal.addEventListener("click", (event) => {
      const addButton = event.target.closest("[data-gallery-add-item]");
      if (addButton) {
        event.preventDefault();
        addGalleryItem(addButton);
        return;
      }

      const deleteButton = event.target.closest("[data-gallery-delete-item]");
      if (deleteButton) {
        event.preventDefault();
        deleteGalleryItem(deleteButton);
        return;
      }

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
    document.addEventListener("keydown", handleKeydown);
    modal.querySelectorAll("[data-gallery-sort-list]").forEach(renumberGalleryItems);
    hydrateRichEditors(modal);
    const firstField = modal.querySelector(".modal-body input, .modal-body textarea, .modal-body select, .modal-body button");
    (firstField || modal.querySelector('button[type="submit"]'))?.focus();
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
