function fieldLabel(key) {
  const label = String(key).replace(/([a-z])([A-Z])/g, "$1 $2");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Patch only displayed content leaves. Collection shape and unknown design data stay intact.
export function contentOnlyEditor(block, contract) {
  const fields = [];
  const bindings = [];
  if (block.editable === false || block.type === "EMBED") return { fields };
  const contentFields = new Set(contract?.contentFields || []);
  const containers = new Set(contract?.containers || []);
  const richFields = new Set(["body", "text", "description", "caption", "quote"]);

  function addField(value, path, key, media = false) {
    const name = `content-${bindings.length}`;
    bindings.push({ name, path, media, value });
    fields.push(media ? {
      name, label: "Image", type: "file", accept: "image/*", required: false,
      imagePicker: true, previewUrl: value || "", previewAlt: block.label || "Image"
    } : {
      name, label: fieldLabel(key), value: value ?? "", required: false,
      type: richFields.has(key) ? "richtext" : typeof value === "number" ? "number" : "text"
    });
  }

  function visit(value, path = [], media = false) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        fields.push({ type: "section", label: item?.title || item?.label || `Item ${index + 1}` });
        if (typeof item === "string") addField(item, [...path, index], "text");
        else visit(item, [...path, index], media);
      });
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (contentFields.has(key) && key !== "mediaAssetId" && ["string", "number"].includes(typeof child)) {
        addField(child, [...path, key], key, (media && key === "url") || ["imageUrl", "posterUrl"].includes(key));
      } else if (containers.has(key)) {
        const isMedia = ["image", "poster"].includes(key) || media && ["items", "slides"].includes(key);
        if (isMedia && typeof child === "string") addField(child, [...path, key], key, true);
        else visit(child, [...path, key], isMedia);
      }
    }
  }

  if (["TEXT", "RICH_TEXT"].includes(block.type) && typeof block.value === "string") {
    addField(block.value, [], block.type === "RICH_TEXT" ? "body" : "text");
    fields[0].type = block.type === "RICH_TEXT" ? "richtext" : "text";
  } else {
    visit(block.value, [], ["IMAGE", "GALLERY"].includes(block.type));
  }

  return {
    fields: fields.filter((field, index) => field.type !== "section" || fields[index + 1]?.name),
    async valueFrom(values, upload) {
      let value = structuredClone(block.value);
      for (const binding of bindings) {
        if (!(binding.name in values)) continue;
        let replacement = values[binding.name];
        let asset = null;
        if (binding.media) {
          const file = replacement?.[0] || replacement;
          if (!file?.size) continue;
          asset = await upload(file, block.label || "Image");
          replacement = asset.url;
        } else if (typeof binding.value === "number") {
          replacement = Number(replacement);
        }
        if (!binding.path.length) value = replacement;
        else {
          const parent = binding.path.slice(0, -1).reduce((item, key) => item[key], value);
          const key = binding.path.at(-1);
          parent[key] = replacement;
          if (asset && key === "url") {
            if (asset.id) parent.mediaAssetId = asset.id;
            if (asset.width) parent.width = asset.width;
            if (asset.height) parent.height = asset.height;
          }
        }
      }
      return value;
    }
  };
}
