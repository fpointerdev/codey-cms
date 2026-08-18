import {
  advancedSettingsFromValues,
  animationEffectOptions,
  sanitizeAnimationSettings
} from "./custom-css.js";

const containerLayoutOptions = [
  { value: "one-column", label: "1 column", description: "Stacked content and long-form sections." },
  { value: "two-column", label: "2 columns", description: "Image/text, forms, FAQs, and balanced content." },
  { value: "three-column", label: "3 columns", description: "Service cards, proof points, and compact grids." },
  { value: "four-column", label: "4 columns", description: "Dense cards, stats, logos, and team sections." },
  { value: "asymmetric", label: "Asymmetric", description: "Editorial split with one dominant side." },
  { value: "full-bleed", label: "Full width", description: "Wide media, hero, or immersive sections." }
];

const sectionContainerOptions = [
  { value: "default", label: "Default" },
  { value: "narrow", label: "Narrow" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Edge to edge" }
];

const sectionSpacingOptions = [
  { value: "none", label: "None" },
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "Extra large" }
];

const sectionGapOptions = [
  { value: "sm", label: "Tight", description: "Compact editorial rhythm." },
  { value: "md", label: "Standard", description: "Balanced default spacing." },
  { value: "lg", label: "Wide", description: "Premium section breathing room." },
  { value: "xl", label: "Extra wide", description: "Hero and gallery scale." }
];

const inheritedSectionSpacingOptions = [
  { value: "inherit", label: "Inherit desktop spacing" },
  ...sectionSpacingOptions
];

const tabletLayoutOptions = [
  { value: "inherit", label: "Inherit", description: "Use the desktop grid." },
  { value: "one-column", label: "1 column", description: "Stack for readability." },
  { value: "two-column", label: "2 columns", description: "Keep paired content together." },
  { value: "three-column", label: "3 columns", description: "Useful for card grids." }
];

const mobileLayoutOptions = [
  { value: "inherit", label: "Inherit", description: "Use tablet/default behavior." },
  { value: "one-column", label: "1 column", description: "Best for content and forms." },
  { value: "two-column", label: "2 columns", description: "Use only for short cards." }
];

const sectionStylePresetOptions = [
  { value: "default", label: "Default" },
  { value: "editorial-light", label: "Editorial light" },
  { value: "quiet", label: "Quiet" },
  { value: "carded", label: "Carded" },
  { value: "framed-card", label: "Framed card" },
  { value: "contrast", label: "Contrast" },
  { value: "industrial-grid", label: "Industrial grid" },
  { value: "premium-dark", label: "Premium dark" }
];

const sectionDecorationOptions = [
  { value: "none", label: "None" },
  { value: "spotlight", label: "Soft spotlight" },
  { value: "grid", label: "Grid layer" },
  { value: "frame", label: "Frame" },
  { value: "texture", label: "Texture" },
  { value: "split", label: "Split background" },
  { value: "glow", label: "Glow" },
  { value: "pattern", label: "Pattern" }
];

const sectionDecorationPositionOptions = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "center-left", label: "Center left" },
  { value: "center-right", label: "Center right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" }
];

const backgroundPositionOptions = [
  { value: "center", label: "Center" },
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" }
];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function oneOf(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

function optionalNumber(value, min, max) {
  if (value === "" || value === null || value === undefined) return undefined;

  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;

  return Math.min(max, Math.max(min, Math.round(number)));
}

function optionalRatio(value, fallback = 0.4) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(0.9, Math.max(0, number)) : fallback;
}

function optionalColor(value) {
  const color = String(value || "").trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : undefined;
}

function cleanText(value, maxLength = 2048) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : undefined;
}

function imageAssetFromBackground(background = {}) {
  return {
    id: cleanText(background.imageAssetId, 160),
    url: cleanText(background.imageUrl || background.url, 4096),
    altText: cleanText(background.altText, 240),
    width: optionalNumber(background.width, 1, 8000),
    height: optionalNumber(background.height, 1, 8000)
  };
}

export function sectionDesignSettings(settings = {}) {
  const style = isRecord(settings.style) ? settings.style : {};
  const background = isRecord(settings.background) ? settings.background : {};
  const visibility = isRecord(settings.visibility) ? settings.visibility : {};
  const image = imageAssetFromBackground(background);
  const color = optionalColor(background.color) || optionalColor(style.backgroundColor || style.background);
  const inferredMode = image.url || image.id ? "image" : color ? "color" : "none";

  return {
    style: {
      ...style,
      backgroundColor: color,
      textColor: optionalColor(style.textColor || style.foreground),
      accentColor: optionalColor(style.accentColor || style.accent),
      radius: optionalNumber(style.radius, 0, 48),
      shadow: oneOf(style.shadow, ["none", "soft", "strong", "glow"], "none"),
      borderWidth: optionalNumber(style.borderWidth, 0, 8) || 0,
      borderColor: optionalColor(style.borderColor)
    },
    background: {
      ...background,
      mode: oneOf(background.mode, ["none", "color", "image"], inferredMode),
      color,
      imageAssetId: image.id,
      imageUrl: image.url,
      altText: image.altText,
      width: image.width,
      height: image.height,
      style: oneOf(background.style || background.fit, ["cover", "contain", "tile"], "cover"),
      position: oneOf(background.position, backgroundPositionOptions.map((option) => option.value), "center"),
      overlayColor: optionalColor(background.overlayColor) || "#000000",
      overlayOpacity: optionalRatio(background.overlayOpacity)
    },
    visibility: {
      desktop: visibility.desktop !== false,
      tablet: visibility.tablet !== false,
      mobile: visibility.mobile !== false
    }
  };
}

function responsiveSettings(values, currentSettings = {}) {
  return {
    ...(currentSettings.responsive || {}),
    tablet: {
      ...(currentSettings.responsive?.tablet || {}),
      layout: values.tabletLayout || "inherit",
      spacing: values.tabletSpacing || "inherit"
    },
    mobile: {
      ...(currentSettings.responsive?.mobile || {}),
      layout: values.mobileLayout || "one-column",
      spacing: values.mobileSpacing || "sm"
    }
  };
}

function mediaLibraryOptions(mediaAssets, currentBackground) {
  const options = [{
    value: "",
    label: currentBackground.imageUrl || currentBackground.imageAssetId
      ? "Keep current image"
      : "Choose from media library"
  }];
  const knownIds = new Set();

  for (const asset of mediaAssets) {
    if (!asset?.id || !asset?.url || knownIds.has(asset.id)) continue;
    knownIds.add(asset.id);
    options.push({
      value: asset.id,
      label: asset.altText || asset.filename || "Media library image"
    });
  }

  if (currentBackground.imageAssetId && !knownIds.has(currentBackground.imageAssetId)) {
    options.push({ value: currentBackground.imageAssetId, label: "Current media image" });
  }

  return options;
}

export function sectionControlFields(section = {}, mediaAssets = []) {
  const settings = section.settings || {};
  const design = sectionDesignSettings(settings);
  const style = design.style;
  const background = design.background;
  const decoration = settings.decoration || {};
  const responsive = settings.responsive || {};
  const tablet = responsive.tablet || {};
  const mobile = responsive.mobile || {};
  const animation = sanitizeAnimationSettings(settings.animation || {});

  return [
    { name: "label", label: "Container label", value: section.label || section.key || "", group: "Layout" },
    { type: "section", label: "Desktop layout", help: "Structure and spacing for larger screens.", open: true, group: "Layout" },
    {
      name: "layout",
      label: "Grid",
      type: "choice",
      value: settings.layout || "one-column",
      options: containerLayoutOptions,
      help: "Choose the desktop structure. Tablet and mobile can override it.",
      group: "Layout"
    },
    { name: "container", label: "Width", type: "select", value: settings.container || "default", options: sectionContainerOptions, group: "Layout" },
    { name: "spacing", label: "Vertical spacing", type: "select", value: settings.spacing || "md", options: sectionSpacingOptions, group: "Layout" },
    { name: "gap", label: "Column gap", type: "choice", value: settings.gap || "md", options: sectionGapOptions, compact: true, group: "Layout" },
    {
      name: "align",
      label: "Content alignment",
      type: "select",
      value: settings.align || "start",
      options: [{ value: "start", label: "Left" }, { value: "center", label: "Center" }, { value: "end", label: "Right" }],
      group: "Layout"
    },
    {
      name: "verticalAlign",
      label: "Vertical alignment",
      type: "select",
      value: settings.verticalAlign || "start",
      options: [{ value: "start", label: "Top" }, { value: "center", label: "Center" }, { value: "end", label: "Bottom" }],
      group: "Layout"
    },
    { name: "minHeight", label: "Minimum height", type: "number", value: settings.minHeight ?? "", min: 0, max: 1200, step: 20, required: false, group: "Layout" },
    { type: "section", label: "Tablet and mobile", help: "Override only what needs to change on smaller screens.", group: "Layout" },
    { name: "tabletLayout", label: "Tablet grid", type: "choice", value: tablet.layout || "inherit", options: tabletLayoutOptions, compact: true, group: "Layout" },
    { name: "tabletSpacing", label: "Tablet spacing", type: "select", value: tablet.spacing || "inherit", options: inheritedSectionSpacingOptions, group: "Layout" },
    { name: "mobileLayout", label: "Mobile grid", type: "choice", value: mobile.layout || "one-column", options: mobileLayoutOptions, compact: true, group: "Layout" },
    { name: "mobileSpacing", label: "Mobile spacing", type: "select", value: mobile.spacing || "sm", options: inheritedSectionSpacingOptions, group: "Layout" },

    { name: "stylePreset", label: "Style preset", type: "select", value: style.preset || "default", options: sectionStylePresetOptions, group: "Style" },
    {
      type: "section",
      label: "Background",
      help: "Use a color or one uploaded image. Image overlays keep text readable.",
      open: background.mode !== "none",
      group: "Style"
    },
    {
      name: "backgroundMode",
      label: "Background type",
      type: "select",
      value: background.mode,
      options: [{ value: "none", label: "None" }, { value: "color", label: "Color" }, { value: "image", label: "Image" }],
      group: "Style"
    },
    { name: "backgroundColor", label: "Background color", type: "color", value: background.color || "#ffffff", required: false, group: "Style" },
    {
      name: "backgroundAssetId",
      label: "Media library image",
      type: "select",
      value: background.imageAssetId || "",
      options: mediaLibraryOptions(mediaAssets, background),
      required: false,
      group: "Style"
    },
    {
      name: "backgroundImageFile",
      label: "Upload or replace image",
      type: "file",
      accept: "image/*",
      imagePicker: true,
      previewUrl: background.imageUrl || "",
      previewAlt: background.altText || section.label || "Section background",
      required: false,
      group: "Style"
    },
    {
      name: "backgroundStyle",
      label: "Image fit",
      type: "select",
      value: background.style,
      options: [{ value: "cover", label: "Fill section" }, { value: "contain", label: "Fit whole image" }, { value: "tile", label: "Repeat image" }],
      group: "Style"
    },
    { name: "backgroundPosition", label: "Image position", type: "select", value: background.position, options: backgroundPositionOptions, group: "Style" },
    { name: "overlayColor", label: "Overlay color", type: "color", value: background.overlayColor, required: false, group: "Style" },
    { name: "overlayOpacity", label: "Overlay opacity", type: "range", value: background.overlayOpacity, min: 0, max: 0.9, step: 0.05, required: false, group: "Style" },
    { type: "section", label: "Surface", help: "Shape, border, shadow, and foreground colors.", group: "Style" },
    { name: "textColor", label: "Text color", type: "color", value: style.textColor || "", required: false, group: "Style" },
    { name: "accentColor", label: "Accent color", type: "color", value: style.accentColor || "", required: false, group: "Style" },
    { name: "radius", label: "Corner radius", type: "number", value: style.radius ?? "", min: 0, max: 48, step: 1, required: false, group: "Style" },
    {
      name: "borderWidth",
      label: "Border",
      type: "select",
      value: String(style.borderWidth || 0),
      options: [{ value: "0", label: "None" }, { value: "1", label: "Thin" }, { value: "2", label: "Medium" }, { value: "4", label: "Strong" }],
      group: "Style"
    },
    { name: "borderColor", label: "Border color", type: "color", value: style.borderColor || "", required: false, group: "Style" },
    {
      name: "shadow",
      label: "Shadow",
      type: "select",
      value: style.shadow || "none",
      options: [{ value: "none", label: "None" }, { value: "soft", label: "Soft" }, { value: "strong", label: "Strong" }, { value: "glow", label: "Glow" }],
      group: "Style"
    },
    { type: "section", label: "Decoration", help: "Optional visual layer behind the content.", group: "Style" },
    { name: "decorationType", label: "Decoration", type: "select", value: decoration.type || "none", options: sectionDecorationOptions, group: "Style" },
    { name: "decorationPosition", label: "Decoration position", type: "select", value: decoration.position || "bottom-right", options: sectionDecorationPositionOptions, group: "Style" },
    { name: "decorationColor", label: "Decoration color", type: "color", value: decoration.color || "#5b5cff", required: false, group: "Style" },
    { name: "decorationOpacity", label: "Decoration opacity", type: "range", value: decoration.opacity ?? 0.35, min: 0, max: 0.9, step: 0.05, required: false, group: "Style" },

    { type: "section", label: "Device visibility", help: "Keep content available only on the screens where it belongs.", open: true, group: "Advanced" },
    { name: "visibilityDesktop", label: "Show on desktop", type: "checkbox", checked: design.visibility.desktop, group: "Advanced" },
    { name: "visibilityTablet", label: "Show on tablet", type: "checkbox", checked: design.visibility.tablet, group: "Advanced" },
    { name: "visibilityMobile", label: "Show on mobile", type: "checkbox", checked: design.visibility.mobile, group: "Advanced" },
    { type: "section", label: "Motion", help: "Motion respects reduced-motion preferences.", group: "Advanced" },
    { name: "animationEffect", label: "Animation", type: "select", value: animation.effect, options: animationEffectOptions, required: false, group: "Advanced" },
    { name: "animationDuration", label: "Duration ms", type: "number", value: animation.durationMs, min: 120, max: 3000, step: 10, required: false, group: "Advanced" },
    { name: "animationDelay", label: "Delay ms", type: "number", value: animation.delayMs, min: 0, max: 5000, step: 50, required: false, group: "Advanced" },
    { type: "section", label: "Developer options", help: "Use these only when the visual controls are not enough.", group: "Advanced" },
    { name: "htmlId", label: "HTML ID", value: settings.htmlId || "", required: false, help: "Optional anchor ID, for example services or contact-cta.", group: "Advanced" },
    { name: "cssClasses", label: "CSS classes", value: settings.cssClasses || "", required: false, help: "Optional safe class names separated by spaces.", group: "Advanced" },
    { name: "customCss", label: "Advanced CSS", type: "textarea", rows: 3, value: settings.customCss || "", required: false, help: "Optional CSS declarations for this section.", group: "Advanced" }
  ];
}

export function sectionBackgroundAsset(values, currentSettings = {}, mediaAssets = [], uploadedAsset = null) {
  if (uploadedAsset?.url) return uploadedAsset;

  const selectedId = cleanText(values.backgroundAssetId, 160);
  const selected = selectedId ? mediaAssets.find((asset) => asset?.id === selectedId) : null;
  if (selected?.url) return selected;

  return imageAssetFromBackground(sectionDesignSettings(currentSettings).background);
}

export function sectionSettingsFromControls(values, currentSettings = {}, backgroundAsset = null) {
  const currentDesign = sectionDesignSettings(currentSettings);
  const mode = oneOf(values.backgroundMode, ["none", "color", "image"], currentDesign.background.mode);
  const backgroundColor = optionalColor(values.backgroundColor);
  const image = mode === "image"
    ? backgroundAsset || imageAssetFromBackground(currentDesign.background)
    : {};

  return {
    ...currentSettings,
    ...advancedSettingsFromValues(values, currentSettings),
    layout: values.layout || "one-column",
    container: values.container || "default",
    spacing: values.spacing || "md",
    gap: values.gap || "md",
    align: values.align || "start",
    verticalAlign: values.verticalAlign || "start",
    minHeight: optionalNumber(values.minHeight, 0, 1200),
    responsive: responsiveSettings(values, currentSettings),
    style: {
      ...(currentSettings.style || {}),
      preset: values.stylePreset || "default",
      backgroundColor: mode === "none" ? undefined : backgroundColor,
      textColor: optionalColor(values.textColor),
      accentColor: optionalColor(values.accentColor),
      radius: optionalNumber(values.radius, 0, 48),
      borderWidth: optionalNumber(values.borderWidth, 0, 8) || 0,
      borderColor: optionalColor(values.borderColor),
      shadow: values.shadow || "none"
    },
    background: {
      ...(currentSettings.background || {}),
      mode,
      color: mode === "none" ? undefined : backgroundColor,
      imageAssetId: image.id,
      imageUrl: image.url,
      altText: image.altText,
      width: image.width,
      height: image.height,
      style: oneOf(values.backgroundStyle, ["cover", "contain", "tile"], currentDesign.background.style),
      position: oneOf(values.backgroundPosition, backgroundPositionOptions.map((option) => option.value), currentDesign.background.position),
      overlayColor: optionalColor(values.overlayColor) || "#000000",
      overlayOpacity: optionalRatio(values.overlayOpacity)
    },
    visibility: {
      desktop: values.visibilityDesktop !== false,
      tablet: values.visibilityTablet !== false,
      mobile: values.visibilityMobile !== false
    },
    decoration: {
      ...(currentSettings.decoration || {}),
      type: values.decorationType || "none",
      position: values.decorationPosition || "bottom-right",
      color: optionalColor(values.decorationColor) || "#5b5cff",
      opacity: optionalRatio(values.decorationOpacity, 0.35)
    },
    customCss: String(values.customCss || "").trim()
  };
}
