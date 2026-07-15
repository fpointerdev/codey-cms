function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstKey(source, keys) {
  if (!isRecord(source)) return "";

  return keys.find((key) => source[key] !== undefined) || "";
}

function firstText(source, keys) {
  const key = firstKey(source, keys);
  const value = key ? source[key] : "";

  return typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
}

function valueKey(source, keys, fallback) {
  return firstKey(source, keys) || fallback;
}

function statsToText(items = []) {
  return Array.isArray(items)
    ? items.map((item) => `${item.value || ""} | ${item.label || item.name || item.title || ""}`.trim()).join("\n")
    : "";
}

function textToStats(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [valuePart, labelPart = ""] = line.split("|").map((part) => part.trim());

      return { value: valuePart, label: labelPart };
    });
}

function stringsToText(items = []) {
  return Array.isArray(items) ? items.filter(Boolean).join("\n") : "";
}

function textToStrings(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function rowsToText(items = [], keys = []) {
  return Array.isArray(items)
    ? items
        .map((item) => keys.map((key) => item?.[key] || "").join(" | ").replace(/\s+\|\s+$/g, "").trim())
        .filter(Boolean)
        .join("\n")
    : "";
}

const visualCollectionEditors = {
  "stats-grid": {
    keys: ["stats", "metrics", "items"],
    label: "Metrics",
    minRows: 4,
    fields: [
      { key: "value", label: "Value" },
      { key: "label", label: "Label" }
    ]
  },
  "feature-cards": {
    keys: ["items", "cards", "features"],
    label: "Cards",
    minRows: 3,
    fields: [
      { key: "title", label: "Title" },
      { key: "body", label: "Body", type: "richtext" },
      { key: "label", label: "Small label", required: false },
      { key: "url", label: "Link", required: false }
    ]
  },
  "team-section": {
    keys: ["items", "people"],
    label: "People",
    minRows: 3,
    fields: [
      { key: "title", label: "Name" },
      { key: "label", label: "Role", required: false },
      { key: "body", label: "Bio", type: "richtext", required: false },
      { key: "imageUrl", label: "Image URL", required: false },
      { key: "imageAlt", label: "Image description", required: false }
    ]
  },
  "logo-grid": {
    keys: ["items", "logos"],
    label: "Logos",
    minRows: 4,
    fields: [
      { key: "title", label: "Name" },
      { key: "imageUrl", label: "Logo URL", required: false },
      { key: "imageAlt", label: "Logo description", required: false },
      { key: "url", label: "Link", required: false }
    ]
  },
  testimonials: {
    keys: ["items", "quotes"],
    label: "Quotes",
    minRows: 2,
    fields: [
      { key: "title", label: "Person / headline" },
      { key: "body", label: "Quote", type: "richtext" },
      { key: "label", label: "Role / company", required: false }
    ]
  },
  "pricing-cards": {
    keys: ["items", "plans"],
    label: "Plans",
    minRows: 3,
    fields: [
      { key: "title", label: "Plan name" },
      { key: "value", label: "Price / value" },
      { key: "body", label: "Description", type: "richtext", required: false },
      { key: "url", label: "Button link", required: false },
      { key: "featured", label: "Featured", type: "checkbox", required: false }
    ]
  },
  "faq-accordion": {
    keys: ["items", "questions"],
    label: "Questions",
    minRows: 4,
    fields: [
      { key: "title", label: "Question" },
      { key: "body", label: "Answer", type: "richtext" },
      { key: "open", label: "Open by default", type: "checkbox", required: false }
    ]
  },
  tabs: {
    keys: ["items", "tabs"],
    label: "Tabs",
    minRows: 3,
    fields: [
      { key: "title", label: "Tab label" },
      { key: "body", label: "Tab content", type: "richtext" },
      { key: "note", label: "Small note", required: false },
      { key: "url", label: "Button link", required: false }
    ]
  },
  accordion: {
    keys: ["items", "panels"],
    label: "Panels",
    minRows: 3,
    fields: [
      { key: "title", label: "Panel title" },
      { key: "body", label: "Panel content", type: "richtext" },
      { key: "open", label: "Open by default", type: "checkbox", required: false }
    ]
  }
};

function normalizedVariant(value, block) {
  const variant = firstText(value, ["variant", "type"]) || block.settings?.elementId || "";

  return String(variant).toLowerCase();
}

function fieldNameForItem(index, key) {
  return `structuredItem${index + 1}${key[0].toUpperCase()}${key.slice(1)}`;
}

function existingImageForItem(item) {
  const image = item?.image || item?.media;
  if (typeof image === "string") return { url: image };
  return isRecord(image) ? image : {};
}

function itemFieldValue(item, key) {
  const image = existingImageForItem(item);

  if (key === "imageUrl") return image.url || image.src || "";
  if (key === "imageAlt") return image.alt || image.title || "";
  if (key === "open") return item?.open === true || item?.defaultOpen === true;
  if (key === "featured") return item?.featured === true || item?.highlighted === true;

  return item?.[key] ?? "";
}

function itemHasContent(row, config) {
  const image = existingImageForItem(row);
  if (image.url || image.src) return true;

  return config.fields.some((field) => {
    const value = row[field.key];
    if (typeof value === "boolean") return value;
    return String(value || "").trim().length > 0;
  });
}

function visualCollectionEditor(block, value) {
  const variant = normalizedVariant(value, block);
  const config = visualCollectionEditors[variant];
  if (!config) return null;

  const collectionKey = firstKey(value, config.keys) || config.keys[0];
  const items = Array.isArray(value[collectionKey]) ? value[collectionKey] : [];
  const rowCount = Math.min(8, Math.max(config.minRows, items.length + 1));
  const fields = [];

  for (let index = 0; index < rowCount; index += 1) {
    const item = isRecord(items[index]) ? items[index] : {};
    const group = config.label;

    addField(fields, {
      name: `structuredItem${index + 1}Section`,
      label: `${config.label} item ${index + 1}`,
      type: "section",
      group,
      help: index >= items.length ? "Optional row. Leave the fields empty to ignore it." : ""
    });

    for (const field of config.fields) {
      addField(fields, {
        name: fieldNameForItem(index, field.key),
        label: field.label,
        type: field.type || "text",
        value: itemFieldValue(item, field.key),
        checked: Boolean(itemFieldValue(item, field.key)),
        required: field.required === true && index < Math.max(1, Math.min(config.minRows, items.length || 1)),
        group,
        help: index >= items.length ? "Leave empty to ignore this row." : undefined
      });
    }
  }

  return {
    collectionKey,
    fields,
    valueFrom(values) {
      const nextItems = [];

      for (let index = 0; index < rowCount; index += 1) {
        const existingItem = isRecord(items[index]) ? items[index] : {};
        const row = { ...existingItem };

        for (const field of config.fields) {
          const name = fieldNameForItem(index, field.key);

          if (field.key === "imageUrl" || field.key === "imageAlt") {
            continue;
          }

          if (field.type === "checkbox") {
            row[field.key] = values[name] === true;
            continue;
          }

          row[field.key] = values[name] || "";
        }

        const imageUrl = values[fieldNameForItem(index, "imageUrl")];
        const imageAlt = values[fieldNameForItem(index, "imageAlt")];
        if (imageUrl || imageAlt || existingItem.image || existingItem.media) {
          const existingImage = existingImageForItem(existingItem);
          row.image = {
            ...existingImage,
            url: imageUrl || existingImage.url || existingImage.src || "",
            alt: imageAlt || existingImage.alt || existingImage.title || row.title || ""
          };
        }

        if (itemHasContent(row, config)) {
          nextItems.push(row);
        }
      }

      return nextItems;
    }
  };
}

function textToRows(value, existingItems = [], keys = []) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split("|").map((part) => part.trim());
      const row = { ...(existingItems[index] || {}) };

      keys.forEach((key, keyIndex) => {
        row[key] = parts[keyIndex] || "";
      });

      return row;
    });
}

function addField(fields, field) {
  fields.push({ required: false, ...field });
}

function arrayRowKeys(items) {
  const candidates = ["title", "body", "text", "label", "value", "meta", "category", "url"];
  const keys = candidates.filter((key) => items.some((item) => isRecord(item) && item[key] !== undefined));

  return keys.length ? keys.slice(0, 4) : ["title", "body", "meta", "url"];
}

function arrayContentEditor(block) {
  const value = block.value;
  if (!Array.isArray(value)) return null;

  const hasObjectRows = value.some(isRecord);
  if (!hasObjectRows) {
    return {
      fields: [
        {
          name: "structuredItems",
          label: "Items",
          type: "textarea",
          rows: 6,
          value: stringsToText(value),
          required: false,
          help: "One item per line."
        }
      ],
      valueFrom(values) {
        return textToStrings(values.structuredItems);
      }
    };
  }

  const keys = arrayRowKeys(value);

  return {
    fields: [
      {
        name: "structuredRows",
        label: "Items",
        type: "textarea",
        rows: 7,
        value: rowsToText(value, keys),
        required: false,
        help: `One per line: ${keys.join(" | ")}`
      }
    ],
    valueFrom(values) {
      return textToRows(values.structuredRows, value, keys);
    }
  };
}

export function structuredContentEditor(block) {
  const value = block.value;
  const arrayEditor = arrayContentEditor(block);
  if (arrayEditor) return arrayEditor;

  if (!isRecord(value)) return null;

  const titleKey = firstKey(value, ["title", "heading", "headline", "name"]);
  const bodyKey = firstKey(value, ["body", "text", "copy", "description", "content"]);
  const noteKey = firstKey(value, ["note", "kicker", "eyebrow", "summary"]);
  const imageKey = firstKey(value, ["image", "media"]);
  const statsKey = firstKey(value, ["stats", "metrics"]);
  const itemsKey = firstKey(value, ["items", "points"]);
  const actionsKey = firstKey(value, ["actions", "buttons"]);
  const cardsKey = firstKey(value, ["cards", "features"]);
  const projectsKey = firstKey(value, ["projects", "works"]);
  const collectionEditor = visualCollectionEditor(block, value);
  const handledCollectionKey = collectionEditor?.collectionKey || "";

  if (!titleKey && !bodyKey && !noteKey && !imageKey && !statsKey && !itemsKey && !actionsKey && !cardsKey && !projectsKey) {
    return null;
  }

  const fields = [];

  if (titleKey) {
    addField(fields, {
      name: "structuredTitle",
      label: "Title",
      value: firstText(value, [titleKey])
    });
  }

  if (bodyKey) {
    addField(fields, {
      name: "structuredBody",
      label: "Content",
      type: "richtext",
      value: firstText(value, [bodyKey])
    });
  }

  if (noteKey) {
    addField(fields, {
      name: "structuredNote",
      label: "Small note / eyebrow",
      value: firstText(value, [noteKey])
    });
  }

  if (imageKey) {
    const image = typeof value[imageKey] === "string" ? { url: value[imageKey] } : value[imageKey] || {};
    addField(fields, {
      name: "structuredImageFile",
      label: "Image",
      type: "file",
      accept: "image/*",
      imagePicker: true,
      previewUrl: image.url || image.src || "",
      previewAlt: image.alt || image.title || firstText(value, [titleKey]) || "Image"
    });
    addField(fields, {
      name: "structuredImageAlt",
      label: "Image description",
      value: image.alt || image.title || ""
    });
  }

  if (statsKey && statsKey !== handledCollectionKey) {
    addField(fields, {
      name: "structuredStats",
      label: "Stats",
      type: "textarea",
      rows: 4,
      value: statsToText(value[statsKey]),
      help: "One per line: value | label"
    });
  }

  if (itemsKey && itemsKey !== handledCollectionKey) {
    addField(fields, {
      name: "structuredItems",
      label: "List items",
      type: "textarea",
      rows: 5,
      value: stringsToText(value[itemsKey]),
      help: "One item per line."
    });
  }

  if (actionsKey) {
    addField(fields, {
      name: "structuredActions",
      label: "Buttons / links",
      type: "textarea",
      rows: 4,
      value: rowsToText(value[actionsKey], ["label", "url", "variant"]),
      help: "One per line: label | url | style"
    });
  }

  if (cardsKey && cardsKey !== handledCollectionKey) {
    addField(fields, {
      name: "structuredCards",
      label: "Cards",
      type: "textarea",
      rows: 6,
      value: rowsToText(value[cardsKey], ["title", "body", "meta", "url"]),
      help: "One per line: title | body | meta | url"
    });
  }

  if (projectsKey && projectsKey !== handledCollectionKey) {
    addField(fields, {
      name: "structuredProjects",
      label: "Projects / works",
      type: "textarea",
      rows: 6,
      value: rowsToText(value[projectsKey], ["title", "meta", "category", "url"]),
      help: "One per line: title | meta | category | url"
    });
  }

  if (collectionEditor) {
    fields.push(...collectionEditor.fields);
  }

  return {
    fields,
    valueFrom(values, mediaAsset = null) {
      const next = { ...value };

      if (titleKey) next[titleKey] = values.structuredTitle || "";
      if (bodyKey) next[bodyKey] = values.structuredBody || "";
      if (noteKey) next[noteKey] = values.structuredNote || "";
      if (statsKey && statsKey !== handledCollectionKey) next[statsKey] = textToStats(values.structuredStats);
      if (itemsKey && itemsKey !== handledCollectionKey) next[itemsKey] = textToStrings(values.structuredItems);
      if (actionsKey) next[actionsKey] = textToRows(values.structuredActions, value[actionsKey], ["label", "url", "variant"]);
      if (cardsKey && cardsKey !== handledCollectionKey) next[cardsKey] = textToRows(values.structuredCards, value[cardsKey], ["title", "body", "meta", "url"]);
      if (projectsKey && projectsKey !== handledCollectionKey) next[projectsKey] = textToRows(values.structuredProjects, value[projectsKey], ["title", "meta", "category", "url"]);
      if (collectionEditor) next[collectionEditor.collectionKey] = collectionEditor.valueFrom(values);

      if (imageKey) {
        const existingImage = typeof value[imageKey] === "string" ? { url: value[imageKey] } : value[imageKey] || {};
        const url = mediaAsset?.url || existingImage.url || existingImage.src || "";
        const alt = values.structuredImageAlt || mediaAsset?.altText || existingImage.alt || "";

        next[imageKey] = {
          ...existingImage,
          [valueKey(existingImage, ["url", "src"], "url")]: url,
          alt
        };
      }

      return next;
    }
  };
}
