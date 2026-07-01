const defaultSliderSettings = {
  slidesPerView: 1,
  overlayColor: "#000000",
  overlayOpacity: 0,
  caption: "",
  textPosition: "bottom-left",
  textWidth: 56,
  displayMode: "slider",
  effect: "slide",
  direction: "horizontal",
  focusMode: "standard",
  containerFade: "none",
  loop: true,
  showNavigation: true,
  navigationStyle: "pill",
  navigationPosition: "bottom-right"
};

const defaultGallerySettings = {
  displayMode: "gallery",
  layoutMode: "grid",
  columnsDesktop: 3,
  columnsTablet: 2,
  columnsMobile: 1,
  gap: 16,
  imageRatio: "4 / 3",
  objectFit: "cover",
  showCaptions: true,
  lightbox: true
};

const textPositions = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right"
];
const navigationStyles = ["pill", "circle", "minimal"];
const navigationPositions = ["bottom-right", "bottom-center", "top-right", "center-sides"];
const displayModes = ["slider", "carousel"];
const effects = ["slide", "fade", "zoom"];
const directions = ["horizontal", "vertical"];
const focusModes = ["standard", "peek"];
const containerFades = ["none", "horizontal", "vertical", "all"];
const galleryLayoutModes = ["grid", "masonry", "justified"];
const galleryRatios = ["1 / 1", "4 / 3", "3 / 2", "16 / 9", "auto"];
const objectFits = ["cover", "contain"];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;

  return Math.min(max, Math.max(min, number));
}

function safeColor(value, fallback = defaultSliderSettings.overlayColor) {
  const color = String(value || "").trim();

  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : fallback;
}

function oneOf(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

function normalizeSlide(item = {}, index = 0) {
  return {
    ...(item.mediaAssetId ? { mediaAssetId: item.mediaAssetId } : {}),
    url: item.url || "",
    alt: item.alt || item.altText || `Slide ${index + 1}`,
    caption: typeof item.caption === "string" ? item.caption : "",
    link: typeof item.link === "string" ? item.link : ""
  };
}

function normalizeGalleryItem(item = {}, index = 0) {
  return {
    ...(item.mediaAssetId ? { mediaAssetId: item.mediaAssetId } : {}),
    url: item.url || "",
    alt: item.alt || item.altText || `Gallery image ${index + 1}`,
    caption: typeof item.caption === "string" ? item.caption : "",
    link: typeof item.link === "string" ? item.link : ""
  };
}

export function sliderSlides(value) {
  if (Array.isArray(value)) return value.map(normalizeSlide);
  if (isRecord(value) && Array.isArray(value.slides)) return value.slides.map(normalizeSlide);

  return [];
}

export function sliderSettings(value = {}) {
  const source = isRecord(value) && isRecord(value.settings) ? value.settings : isRecord(value) ? value : {};

  return {
    slidesPerView: Math.round(clampNumber(source.slidesPerView, defaultSliderSettings.slidesPerView, 1, 6)),
    overlayColor: safeColor(source.overlayColor),
    overlayOpacity: clampNumber(source.overlayOpacity, defaultSliderSettings.overlayOpacity, 0, 0.9),
    caption: typeof source.caption === "string" ? source.caption : "",
    textPosition: oneOf(source.textPosition, textPositions, defaultSliderSettings.textPosition),
    textWidth: Math.round(clampNumber(source.textWidth, defaultSliderSettings.textWidth, 24, 100)),
    displayMode: oneOf(source.displayMode, displayModes, defaultSliderSettings.displayMode),
    effect: oneOf(source.effect, effects, defaultSliderSettings.effect),
    direction: oneOf(source.direction, directions, defaultSliderSettings.direction),
    focusMode: oneOf(source.focusMode, focusModes, defaultSliderSettings.focusMode),
    containerFade: oneOf(source.containerFade, containerFades, defaultSliderSettings.containerFade),
    loop: source.loop === false || source.loop === "false" ? false : defaultSliderSettings.loop,
    showNavigation: source.showNavigation === false || source.showNavigation === "false" ? false : defaultSliderSettings.showNavigation,
    navigationStyle: oneOf(source.navigationStyle, navigationStyles, defaultSliderSettings.navigationStyle),
    navigationPosition: oneOf(source.navigationPosition, navigationPositions, defaultSliderSettings.navigationPosition)
  };
}

export function galleryItems(value) {
  if (Array.isArray(value)) return value.map(normalizeGalleryItem);
  if (isRecord(value) && Array.isArray(value.items)) return value.items.map(normalizeGalleryItem);
  if (isRecord(value) && Array.isArray(value.slides)) return value.slides.map(normalizeGalleryItem);

  return [];
}

export function gallerySettings(value = {}) {
  const source = isRecord(value) && isRecord(value.settings) ? value.settings : isRecord(value) ? value : {};

  return {
    displayMode: "gallery",
    layoutMode: oneOf(source.layoutMode, galleryLayoutModes, defaultGallerySettings.layoutMode),
    columnsDesktop: Math.round(clampNumber(source.columnsDesktop, defaultGallerySettings.columnsDesktop, 1, 6)),
    columnsTablet: Math.round(clampNumber(source.columnsTablet, defaultGallerySettings.columnsTablet, 1, 4)),
    columnsMobile: Math.round(clampNumber(source.columnsMobile, defaultGallerySettings.columnsMobile, 1, 2)),
    gap: Math.round(clampNumber(source.gap, defaultGallerySettings.gap, 0, 48)),
    imageRatio: oneOf(source.imageRatio, galleryRatios, defaultGallerySettings.imageRatio),
    objectFit: oneOf(source.objectFit, objectFits, defaultGallerySettings.objectFit),
    showCaptions: source.showCaptions === false || source.showCaptions === "false" ? false : defaultGallerySettings.showCaptions,
    lightbox: source.lightbox === false || source.lightbox === "false" ? false : defaultGallerySettings.lightbox
  };
}

export function isGalleryValue(value = {}) {
  if (Array.isArray(value)) return true;
  if (!isRecord(value)) return false;
  if (Array.isArray(value.items)) return true;
  const source = isRecord(value.settings) ? value.settings : value;

  return source.displayMode === "gallery";
}

export function normalizeSliderValue(value, slides = sliderSlides(value)) {
  return {
    slides,
    settings: sliderSettings(value)
  };
}

export function sliderModalFields(value = {}, options = {}) {
  const settings = sliderSettings(value);

  return [
    { name: "slides", label: "Slider images", type: "gallery", value: sliderSlides(value), mediaAssets: options.mediaAssets || [], required: false, group: "Content" },
    {
      name: "slidesPerView",
      label: "Images visible at once",
      type: "number",
      value: settings.slidesPerView,
      min: 1,
      max: 6,
      step: 1,
      group: "Configuration",
      help: "Use 1 for a classic hero slider, or more for project/product rows."
    },
    {
      name: "caption",
      label: "Fallback text over images",
      type: "richtext",
      value: settings.caption,
      required: false,
      group: "Content",
      help: "Used only when the active image does not have its own slide text."
    },
    {
      name: "textPosition",
      label: "Text position",
      type: "select",
      value: settings.textPosition,
      options: [
        { value: "top-left", label: "Top left" },
        { value: "top-center", label: "Top center" },
        { value: "top-right", label: "Top right" },
        { value: "center-left", label: "Center left" },
        { value: "center", label: "Center" },
        { value: "center-right", label: "Center right" },
        { value: "bottom-left", label: "Bottom left" },
        { value: "bottom-center", label: "Bottom center" },
        { value: "bottom-right", label: "Bottom right" }
      ],
      group: "Style"
    },
    {
      name: "textWidth",
      label: "Text width",
      type: "range",
      value: settings.textWidth,
      min: 24,
      max: 100,
      step: 2,
      required: false,
      group: "Style"
    },
    {
      name: "displayMode",
      label: "Media mode",
      type: "select",
      value: settings.displayMode,
      options: [
        { value: "slider", label: "Slider" },
        { value: "carousel", label: "Carousel" }
      ],
      group: "Configuration",
      help: "Slider is best for hero media. Carousel is best for projects, products, and galleries."
    },
    {
      name: "effect",
      label: "Transition effect",
      type: "select",
      value: settings.effect,
      options: [
        { value: "slide", label: "Slide" },
        { value: "fade", label: "Fade" },
        { value: "zoom", label: "Soft zoom" }
      ],
      group: "Configuration"
    },
    {
      name: "direction",
      label: "Direction",
      type: "select",
      value: settings.direction,
      options: [
        { value: "horizontal", label: "Horizontal" },
        { value: "vertical", label: "Vertical" }
      ],
      group: "Configuration"
    },
    {
      name: "focusMode",
      label: "Carousel focus",
      type: "select",
      value: settings.focusMode,
      options: [
        { value: "standard", label: "Standard" },
        { value: "peek", label: "Focused item with side previews" }
      ],
      group: "Configuration",
      help: "Use the focused option to show one main image with half previews before and after."
    },
    {
      name: "containerFade",
      label: "Container edge fade",
      type: "select",
      value: settings.containerFade,
      options: [
        { value: "none", label: "No container fade" },
        { value: "horizontal", label: "Fade left and right edges" },
        { value: "vertical", label: "Fade top and bottom edges" },
        { value: "all", label: "Fade all container edges" }
      ],
      group: "Style",
      help: "Applies a soft mask to the whole slider container, separate from slide transition effects."
    },
    {
      name: "overlayColor",
      label: "Overlay color",
      type: "color",
      value: settings.overlayColor,
      required: false,
      group: "Style"
    },
    {
      name: "overlayOpacity",
      label: "Overlay opacity",
      type: "range",
      value: settings.overlayOpacity,
      min: 0,
      max: 0.9,
      step: 0.05,
      required: false,
      group: "Style"
    },
    {
      name: "loop",
      label: "Loop behavior",
      type: "select",
      value: settings.loop ? "true" : "false",
      options: [
        { value: "true", label: "Infinite loop" },
        { value: "false", label: "Stop at the end" }
      ],
      group: "Configuration"
    },
    {
      name: "showNavigation",
      label: "Show next/previous",
      type: "select",
      value: settings.showNavigation ? "true" : "false",
      options: [
        { value: "true", label: "Show buttons" },
        { value: "false", label: "Hide buttons" }
      ],
      group: "Configuration"
    },
    {
      name: "navigationStyle",
      label: "Button style",
      type: "select",
      value: settings.navigationStyle,
      options: [
        { value: "pill", label: "Pill buttons" },
        { value: "circle", label: "Circle buttons" },
        { value: "minimal", label: "Minimal text" }
      ],
      group: "Configuration"
    },
    {
      name: "navigationPosition",
      label: "Button position",
      type: "select",
      value: settings.navigationPosition,
      options: [
        { value: "bottom-right", label: "Bottom right" },
        { value: "bottom-center", label: "Bottom center" },
        { value: "top-right", label: "Top right" },
        { value: "center-sides", label: "Sides center" }
      ],
      group: "Configuration"
    }
  ];
}

export function galleryModalFields(value = {}, options = {}) {
  const settings = gallerySettings(value);

  return [
    {
      name: "items",
      label: "Gallery images",
      type: "gallery",
      value: galleryItems(value),
      mediaAssets: options.mediaAssets || [],
      required: false,
      help: "Upload or keep multiple images. Captions, alt text, and links can be changed per image."
    },
    {
      name: "layoutMode",
      label: "Layout",
      type: "select",
      value: settings.layoutMode,
      options: [
        { value: "grid", label: "Grid" },
        { value: "masonry", label: "Masonry" },
        { value: "justified", label: "Justified" }
      ]
    },
    {
      name: "columnsDesktop",
      label: "Desktop columns",
      type: "number",
      value: settings.columnsDesktop,
      min: 1,
      max: 6,
      step: 1
    },
    {
      name: "columnsTablet",
      label: "Tablet columns",
      type: "number",
      value: settings.columnsTablet,
      min: 1,
      max: 4,
      step: 1
    },
    {
      name: "columnsMobile",
      label: "Mobile columns",
      type: "number",
      value: settings.columnsMobile,
      min: 1,
      max: 2,
      step: 1
    },
    {
      name: "gap",
      label: "Image gap",
      type: "range",
      value: settings.gap,
      min: 0,
      max: 48,
      step: 2
    },
    {
      name: "imageRatio",
      label: "Image ratio",
      type: "select",
      value: settings.imageRatio,
      options: [
        { value: "1 / 1", label: "Square" },
        { value: "4 / 3", label: "Standard" },
        { value: "3 / 2", label: "Photo" },
        { value: "16 / 9", label: "Wide" },
        { value: "auto", label: "Original" }
      ]
    },
    {
      name: "objectFit",
      label: "Image fit",
      type: "select",
      value: settings.objectFit,
      options: [
        { value: "cover", label: "Crop to fill" },
        { value: "contain", label: "Fit inside" }
      ]
    },
    {
      name: "showCaptions",
      label: "Captions",
      type: "select",
      value: settings.showCaptions ? "true" : "false",
      options: [
        { value: "true", label: "Show captions" },
        { value: "false", label: "Hide captions" }
      ]
    },
    {
      name: "lightbox",
      label: "Image click behavior",
      type: "select",
      value: settings.lightbox ? "true" : "false",
      options: [
        { value: "true", label: "Open image preview" },
        { value: "false", label: "No preview" }
      ]
    }
  ];
}

export function sliderValueFromModal(values, currentValue = {}, uploadedItems = []) {
  const galleryItems = [...(values.slides?.existing || []), ...uploadedItems];

  return {
    slides: galleryItems,
    settings: {
      slidesPerView: Math.round(clampNumber(values.slidesPerView, sliderSettings(currentValue).slidesPerView, 1, 6)),
      overlayColor: safeColor(values.overlayColor, sliderSettings(currentValue).overlayColor),
      overlayOpacity: clampNumber(values.overlayOpacity, sliderSettings(currentValue).overlayOpacity, 0, 0.9),
      caption: String(values.caption || "").trim(),
      textPosition: oneOf(values.textPosition, textPositions, sliderSettings(currentValue).textPosition),
      textWidth: Math.round(clampNumber(values.textWidth, sliderSettings(currentValue).textWidth, 24, 100)),
      displayMode: oneOf(values.displayMode, displayModes, sliderSettings(currentValue).displayMode),
      effect: oneOf(values.effect, effects, sliderSettings(currentValue).effect),
      direction: oneOf(values.direction, directions, sliderSettings(currentValue).direction),
      focusMode: oneOf(values.focusMode, focusModes, sliderSettings(currentValue).focusMode),
      containerFade: oneOf(values.containerFade, containerFades, sliderSettings(currentValue).containerFade),
      loop: values.loop !== "false",
      showNavigation: values.showNavigation !== "false",
      navigationStyle: oneOf(values.navigationStyle, navigationStyles, sliderSettings(currentValue).navigationStyle),
      navigationPosition: oneOf(values.navigationPosition, navigationPositions, sliderSettings(currentValue).navigationPosition)
    }
  };
}

export function galleryValueFromModal(values, currentValue = {}, uploadedItems = []) {
  const items = [...(values.items?.existing || []), ...uploadedItems];

  return {
    items,
    settings: {
      displayMode: "gallery",
      layoutMode: oneOf(values.layoutMode, galleryLayoutModes, gallerySettings(currentValue).layoutMode),
      columnsDesktop: Math.round(clampNumber(values.columnsDesktop, gallerySettings(currentValue).columnsDesktop, 1, 6)),
      columnsTablet: Math.round(clampNumber(values.columnsTablet, gallerySettings(currentValue).columnsTablet, 1, 4)),
      columnsMobile: Math.round(clampNumber(values.columnsMobile, gallerySettings(currentValue).columnsMobile, 1, 2)),
      gap: Math.round(clampNumber(values.gap, gallerySettings(currentValue).gap, 0, 48)),
      imageRatio: oneOf(values.imageRatio, galleryRatios, gallerySettings(currentValue).imageRatio),
      objectFit: oneOf(values.objectFit, objectFits, gallerySettings(currentValue).objectFit),
      showCaptions: values.showCaptions !== "false",
      lightbox: values.lightbox !== "false"
    }
  };
}
