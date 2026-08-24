export const defaultDesignSystem = {
  preset: "clean",
  colors: {
    background: "#f6f5f1",
    surface: "#ffffff",
    text: "#1e2329",
    muted: "#687078",
    primary: "#0d7c68",
    primaryContrast: "#ffffff",
    border: "#dde2e6"
  },
  typography: {
    headingFont: "Inter",
    bodyFont: "Inter",
    headingWeight: "700",
    baseSize: 16,
    scale: "standard"
  },
  layout: {
    contentWidth: 1120,
    sectionSpacing: 48,
    radius: 8,
    shadow: "soft",
    surfaceStyle: "solid"
  },
  buttons: {
    radius: 7,
    style: "solid"
  },
  header: {
    background: "#f7f7f4",
    text: "#1e2329",
    sticky: true
  },
  footer: {
    background: "#ffffff",
    text: "#687078"
  }
};

export const designSystemPresets = {
  clean: defaultDesignSystem,
  editorial: {
    preset: "editorial",
    colors: {
      background: "#f4f1ea",
      surface: "#ffffff",
      text: "#24211f",
      muted: "#746d66",
      primary: "#a33d2d",
      primaryContrast: "#ffffff",
      border: "#d9d1c7"
    },
    typography: { headingFont: "Georgia", bodyFont: "Inter", headingWeight: "700", baseSize: 17, scale: "expressive" },
    layout: { contentWidth: 1040, sectionSpacing: 72, radius: 2, shadow: "none", surfaceStyle: "solid" },
    buttons: { radius: 2, style: "outline" },
    header: { background: "#24211f", text: "#ffffff", sticky: true },
    footer: { background: "#24211f", text: "#f4f1ea" }
  },
  bold: {
    preset: "bold",
    colors: {
      background: "#f7f7f2",
      surface: "#ffffff",
      text: "#111111",
      muted: "#5b6068",
      primary: "#2251ff",
      primaryContrast: "#ffffff",
      border: "#c9ced6"
    },
    typography: { headingFont: "Arial", bodyFont: "Inter", headingWeight: "800", baseSize: 16, scale: "expressive" },
    layout: { contentWidth: 1240, sectionSpacing: 64, radius: 0, shadow: "strong", surfaceStyle: "solid" },
    buttons: { radius: 0, style: "solid" },
    header: { background: "#111111", text: "#ffffff", sticky: true },
    footer: { background: "#ffd43b", text: "#111111" }
  },
  soft: {
    preset: "soft",
    colors: {
      background: "#f2f5f3",
      surface: "#ffffff",
      text: "#26302c",
      muted: "#66736d",
      primary: "#b13f6c",
      primaryContrast: "#ffffff",
      border: "#d8e0dc"
    },
    typography: { headingFont: "Trebuchet MS", bodyFont: "Verdana", headingWeight: "600", baseSize: 15, scale: "standard" },
    layout: { contentWidth: 1080, sectionSpacing: 56, radius: 16, shadow: "soft", surfaceStyle: "solid" },
    buttons: { radius: 24, style: "solid" },
    header: { background: "#ffffff", text: "#26302c", sticky: true },
    footer: { background: "#26302c", text: "#f2f5f3" }
  },
  liquid: {
    preset: "liquid",
    colors: {
      background: "#edf4f3",
      surface: "#ffffff",
      text: "#172426",
      muted: "#5f6f72",
      primary: "#087f76",
      primaryContrast: "#ffffff",
      border: "#c8d8d6"
    },
    typography: { headingFont: "Inter", bodyFont: "Inter", headingWeight: "700", baseSize: 16, scale: "standard" },
    layout: { contentWidth: 1160, sectionSpacing: 64, radius: 16, shadow: "soft", surfaceStyle: "liquid" },
    buttons: { radius: 12, style: "solid" },
    header: { background: "#edf4f3", text: "#172426", sticky: true },
    footer: { background: "#172426", text: "#edf4f3" }
  }
};

const allowedFonts = new Set(["Inter", "Arial", "Georgia", "Verdana", "Trebuchet MS"]);
const hexColor = /^#[0-9a-f]{6}$/i;
const typeScaleSizes = {
  compact: { page: 56, section: 46, pageMobile: 40, sectionMobile: 34 },
  standard: { page: 72, section: 58, pageMobile: 48, sectionMobile: 40 },
  expressive: { page: 84, section: 68, pageMobile: 56, sectionMobile: 46 }
};

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function option(value, values, fallback) {
  return values.includes(value) ? value : fallback;
}

function color(value, fallback) {
  return typeof value === "string" && hexColor.test(value) ? value.toLowerCase() : fallback;
}

function number(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function font(value, fallback) {
  return allowedFonts.has(value) ? value : fallback;
}

export function normalizeDesignSystem(value = {}) {
  const input = objectValue(value);
  const colors = objectValue(input.colors);
  const typography = objectValue(input.typography);
  const layout = objectValue(input.layout);
  const buttons = objectValue(input.buttons);
  const header = objectValue(input.header);
  const footer = objectValue(input.footer);
  const defaults = defaultDesignSystem;

  return {
    preset: option(input.preset, ["clean", "editorial", "bold", "soft", "liquid", "custom"], defaults.preset),
    colors: {
      background: color(colors.background, defaults.colors.background),
      surface: color(colors.surface, defaults.colors.surface),
      text: color(colors.text, defaults.colors.text),
      muted: color(colors.muted, defaults.colors.muted),
      primary: color(colors.primary, defaults.colors.primary),
      primaryContrast: color(colors.primaryContrast, defaults.colors.primaryContrast),
      border: color(colors.border, defaults.colors.border)
    },
    typography: {
      headingFont: font(typography.headingFont, defaults.typography.headingFont),
      bodyFont: font(typography.bodyFont, defaults.typography.bodyFont),
      headingWeight: option(String(typography.headingWeight || ""), ["600", "700", "800"], defaults.typography.headingWeight),
      baseSize: number(typography.baseSize, defaults.typography.baseSize, 14, 20),
      scale: option(typography.scale, ["compact", "standard", "expressive"], defaults.typography.scale)
    },
    layout: {
      contentWidth: number(layout.contentWidth, defaults.layout.contentWidth, 880, 1440),
      sectionSpacing: number(layout.sectionSpacing, defaults.layout.sectionSpacing, 24, 128),
      radius: number(layout.radius, defaults.layout.radius, 0, 24),
      shadow: option(layout.shadow, ["none", "soft", "strong"], defaults.layout.shadow),
      surfaceStyle: option(layout.surfaceStyle, ["solid", "liquid"], defaults.layout.surfaceStyle)
    },
    buttons: {
      radius: number(buttons.radius, defaults.buttons.radius, 0, 32),
      style: option(buttons.style, ["solid", "outline"], defaults.buttons.style)
    },
    header: {
      background: color(header.background, defaults.header.background),
      text: color(header.text, defaults.header.text),
      sticky: typeof header.sticky === "boolean" ? header.sticky : defaults.header.sticky
    },
    footer: {
      background: color(footer.background, defaults.footer.background),
      text: color(footer.text, defaults.footer.text)
    }
  };
}

function fontStack(value) {
  const stacks = {
    Inter: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    Arial: "Arial, Helvetica, sans-serif",
    Georgia: 'Georgia, "Times New Roman", serif',
    Verdana: "Verdana, Geneva, sans-serif",
    "Trebuchet MS": '"Trebuchet MS", Arial, sans-serif'
  };

  return stacks[value] || stacks.Inter;
}

export function designSystemDeclarations(value = {}) {
  const design = normalizeDesignSystem(value);
  const typeSizes = typeScaleSizes[design.typography.scale];
  const shadows = {
    none: "none",
    soft: "0 14px 36px rgba(18, 27, 36, 0.10)",
    strong: "0 22px 58px rgba(18, 27, 36, 0.18)"
  };
  const scales = { compact: "1.125", standard: "1.2", expressive: "1.3" };

  return [
    `--bg:${design.colors.background}`,
    `--page:${design.colors.surface}`,
    `--surface:${design.colors.surface}`,
    `--text:${design.colors.text}`,
    `--ink:${design.colors.text}`,
    `--muted:${design.colors.muted}`,
    `--line:${design.colors.border}`,
    `--accent:${design.colors.primary}`,
    `--accent-strong:${design.colors.primary}`,
    `--site-content-width:${design.layout.contentWidth}px`,
    `--site-section-spacing:${design.layout.sectionSpacing}px`,
    `--site-radius:${design.layout.radius}px`,
    `--site-shadow:${shadows[design.layout.shadow]}`,
    `--site-heading-font:${fontStack(design.typography.headingFont)}`,
    `--site-body-font:${fontStack(design.typography.bodyFont)}`,
    `--site-heading-weight:${design.typography.headingWeight}`,
    `--site-type-scale:${scales[design.typography.scale]}`,
    `--site-page-title-size:${typeSizes.page}px`,
    `--site-section-title-size:${typeSizes.section}px`,
    `--site-header-bg:${design.header.background}`,
    `--site-header-text:${design.header.text}`,
    `--site-footer-bg:${design.footer.background}`,
    `--site-footer-text:${design.footer.text}`,
    `--site-button-radius:${design.buttons.radius}px`,
    `--site-button-bg:${design.buttons.style === "outline" ? "transparent" : design.colors.primary}`,
    `--site-button-text:${design.buttons.style === "outline" ? design.colors.primary : design.colors.primaryContrast}`
  ].join(";");
}

export function designSystemCss(value = {}) {
  const design = normalizeDesignSystem(value);
  const declarations = designSystemDeclarations(design);
  const typeSizes = typeScaleSizes[design.typography.scale];
  const liquidCss = design.layout.surfaceStyle === "liquid"
    ? `
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) .site-header {
  border-bottom-color: color-mix(in srgb, var(--line) 72%, transparent);
  background: color-mix(in srgb, var(--site-header-bg) 76%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(135%);
  backdrop-filter: blur(18px) saturate(135%);
}
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) :where(.structured-card, .shop-product-card) {
  border-color: color-mix(in srgb, var(--line) 72%, transparent);
  background: color-mix(in srgb, var(--surface) 74%, transparent);
  box-shadow: 0 18px 48px color-mix(in srgb, var(--text) 12%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(135%);
  backdrop-filter: blur(18px) saturate(135%);
}`
    : "";

  return `
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) {
  ${declarations};
  background: var(--bg);
  color: var(--text);
  font-family: var(--site-body-font);
  font-size: ${design.typography.baseSize}px;
}
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) :where(h1, h2, h3, h4, h5, h6, .brand) {
  font-family: var(--site-heading-font);
  font-weight: var(--site-heading-weight);
}
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) .page-title { font-size: var(--site-page-title-size); }
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) :where(.structured-block h3, .slider-caption h1, .slider-caption h2, .slider-caption h3) {
  font-size: var(--site-section-title-size);
}
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) .page-shell { width: min(100%, var(--site-content-width)); }
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) .page-section { padding-block: var(--site-section-spacing); }
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) .site-header {
  position: ${design.header.sticky ? "sticky" : "relative"};
  background: var(--site-header-bg);
  color: var(--site-header-text);
}
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) .site-header :where(.brand, .site-nav a) { color: var(--site-header-text); }
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) .site-footer { background: var(--site-footer-bg); color: var(--site-footer-text); }
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) :where(.action-link, .contact-form > button, .shop-product-card button) {
  border-color: var(--accent);
  border-radius: var(--site-button-radius);
  background: var(--site-button-bg);
  color: var(--site-button-text);
}
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) :where(.structured-card, .shop-product-card) {
  border-radius: var(--site-radius);
  box-shadow: var(--site-shadow);
}
${liquidCss}
@media (max-width: 680px) {
  body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) .page-title { font-size: ${typeSizes.pageMobile}px; }
  body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) :where(.structured-block h3, .slider-caption h1, .slider-caption h2, .slider-caption h3) {
    font-size: ${typeSizes.sectionMobile}px;
  }
}`.trim();
}

export function applyDesignSystem(value = {}) {
  if (!document.head || !document.createElement) return;

  let element = document.querySelector("[data-site-design-system]");
  if (!element) {
    element = document.createElement("style");
    element.setAttribute("data-site-design-system", "");
    document.head.append(element);
  }
  element.textContent = designSystemCss(value);
}

function formField(form, name) {
  return form?.elements?.namedItem?.(name) || form?.querySelector?.(`[name="${name}"]`);
}

export function syncDesignColorTextInput(form, input, options = {}) {
  const fieldName = input?.dataset?.designColorTextFor;
  const field = fieldName ? formField(form, fieldName) : null;
  if (!field || !input) return false;

  const rawValue = String(input.value || "").trim();
  const value = rawValue.startsWith("#") ? rawValue : `#${rawValue}`;
  if (!hexColor.test(value)) {
    input.setAttribute("aria-invalid", "true");
    if (options.restoreInvalid) {
      input.value = String(field.value || "").toUpperCase();
      input.removeAttribute("aria-invalid");
    }
    return false;
  }

  field.value = value.toLowerCase();
  input.value = value.toUpperCase();
  input.removeAttribute("aria-invalid");
  return true;
}

function formValue(form, name, fallback) {
  const field = formField(form, name);
  return field ? field.value : fallback;
}

export function designSystemFromForm(form, current = {}) {
  const design = normalizeDesignSystem(current);
  const stickyField = formField(form, "design.header.sticky");

  return normalizeDesignSystem({
    preset: formValue(form, "design.preset", design.preset),
    colors: {
      background: formValue(form, "design.colors.background", design.colors.background),
      surface: formValue(form, "design.colors.surface", design.colors.surface),
      text: formValue(form, "design.colors.text", design.colors.text),
      muted: formValue(form, "design.colors.muted", design.colors.muted),
      primary: formValue(form, "design.colors.primary", design.colors.primary),
      primaryContrast: formValue(form, "design.colors.primaryContrast", design.colors.primaryContrast),
      border: formValue(form, "design.colors.border", design.colors.border)
    },
    typography: {
      headingFont: formValue(form, "design.typography.headingFont", design.typography.headingFont),
      bodyFont: formValue(form, "design.typography.bodyFont", design.typography.bodyFont),
      headingWeight: formValue(form, "design.typography.headingWeight", design.typography.headingWeight),
      baseSize: formValue(form, "design.typography.baseSize", design.typography.baseSize),
      scale: formValue(form, "design.typography.scale", design.typography.scale)
    },
    layout: {
      contentWidth: formValue(form, "design.layout.contentWidth", design.layout.contentWidth),
      sectionSpacing: formValue(form, "design.layout.sectionSpacing", design.layout.sectionSpacing),
      radius: formValue(form, "design.layout.radius", design.layout.radius),
      shadow: formValue(form, "design.layout.shadow", design.layout.shadow),
      surfaceStyle: formValue(form, "design.layout.surfaceStyle", design.layout.surfaceStyle)
    },
    buttons: {
      radius: formValue(form, "design.buttons.radius", design.buttons.radius),
      style: formValue(form, "design.buttons.style", design.buttons.style)
    },
    header: {
      background: formValue(form, "design.header.background", design.header.background),
      text: formValue(form, "design.header.text", design.header.text),
      sticky: stickyField ? Boolean(stickyField.checked) : design.header.sticky
    },
    footer: {
      background: formValue(form, "design.footer.background", design.footer.background),
      text: formValue(form, "design.footer.text", design.footer.text)
    }
  });
}

function setFieldValue(form, name, value) {
  const field = formField(form, name);
  if (!field) return;
  if (field.type === "checkbox") field.checked = Boolean(value);
  else field.value = String(value);
}

function flattenedDesign(design) {
  return {
    "design.preset": design.preset,
    ...Object.fromEntries(Object.entries(design.colors).map(([key, value]) => [`design.colors.${key}`, value])),
    ...Object.fromEntries(Object.entries(design.typography).map(([key, value]) => [`design.typography.${key}`, value])),
    ...Object.fromEntries(Object.entries(design.layout).map(([key, value]) => [`design.layout.${key}`, value])),
    ...Object.fromEntries(Object.entries(design.buttons).map(([key, value]) => [`design.buttons.${key}`, value])),
    ...Object.fromEntries(Object.entries(design.header).map(([key, value]) => [`design.header.${key}`, value])),
    ...Object.fromEntries(Object.entries(design.footer).map(([key, value]) => [`design.footer.${key}`, value]))
  };
}

export function updateDesignSystemPreview(form, current = {}, options = {}) {
  if (!form) return normalizeDesignSystem(current);
  if (options.markCustom !== false && formField(form, "design.preset")) {
    setFieldValue(form, "design.preset", "custom");
  }
  const design = designSystemFromForm(form, current);
  const preview = form.closest?.("[data-design-workspace]")?.querySelector?.("[data-design-preview]");
  if (preview) {
    preview.setAttribute("style", designSystemDeclarations(design));
    preview.dataset.buttonStyle = design.buttons.style;
    preview.dataset.surfaceStyle = design.layout.surfaceStyle;
  }

  form.querySelectorAll?.("[data-design-value-for]").forEach((output) => {
    const field = formField(form, output.dataset.designValueFor);
    if (field) output.textContent = `${field.value}${output.dataset.designUnit || ""}`;
  });
  form.querySelectorAll?.("[data-design-color-text-for]").forEach((input) => {
    const field = formField(form, input.dataset.designColorTextFor);
    if (field) input.value = field.value.toUpperCase();
  });
  form.querySelectorAll?.("[data-design-preset]").forEach((button) => {
    const active = button.dataset.designPreset === design.preset;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const summaries = {
    typography: `${design.typography.headingFont} + ${design.typography.bodyFont}`,
    layout: `${design.layout.contentWidth}px`,
    header: design.header.sticky ? "Sticky header" : "Static header",
    css: String(formField(form, "customCss")?.value || "").trim() ? "Custom styles" : "Not set"
  };
  form.querySelectorAll?.("[data-design-summary]").forEach((section) => {
    const output = section.querySelector?.("[data-design-summary-value]");
    const value = summaries[section.dataset.designSummary];
    if (output && value) output.textContent = value;
  });

  return design;
}

export function applyDesignPreset(form, presetName, current = {}) {
  const preset = designSystemPresets[presetName];
  if (!form || !preset) return;

  const design = normalizeDesignSystem(preset);
  Object.entries(flattenedDesign(design)).forEach(([name, value]) => setFieldValue(form, name, value));
  updateDesignSystemPreview(form, current, { markCustom: false });
}
