type DesignColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  primaryContrast: string;
  border: string;
};

type DesignFont = "Inter" | "Arial" | "Georgia" | "Verdana" | "Trebuchet MS";

export type DesignSystemSettings = {
  preset: "clean" | "editorial" | "bold" | "soft" | "liquid" | "custom";
  colors: DesignColors;
  typography: {
    headingFont: DesignFont;
    bodyFont: DesignFont;
    headingWeight: "600" | "700" | "800";
    baseSize: number;
    scale: "compact" | "standard" | "expressive";
  };
  layout: {
    contentWidth: number;
    sectionSpacing: number;
    radius: number;
    shadow: "none" | "soft" | "strong";
    surfaceStyle: "solid" | "liquid";
  };
  buttons: {
    radius: number;
    style: "solid" | "outline";
  };
  header: {
    background: string;
    text: string;
    sticky: boolean;
  };
  footer: {
    background: string;
    text: string;
  };
};

export const defaultDesignSystemSettings: DesignSystemSettings = {
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

const allowedFonts = new Set(["Inter", "Arial", "Georgia", "Verdana", "Trebuchet MS"]);
const hexColor = /^#[0-9a-f]{6}$/i;
const typeScaleSizes = {
  compact: { page: 56, section: 46, pageMobile: 40, sectionMobile: 34 },
  standard: { page: 72, section: 58, pageMobile: 48, sectionMobile: 40 },
  expressive: { page: 84, section: 68, pageMobile: 56, sectionMobile: 46 }
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function color(value: unknown, fallback: string) {
  return typeof value === "string" && hexColor.test(value) ? value.toLowerCase() : fallback;
}

function option<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function font(value: unknown, fallback: DesignFont): DesignFont {
  return typeof value === "string" && allowedFonts.has(value) ? value as DesignFont : fallback;
}

export function normalizeDesignSystemSettings(value: unknown): DesignSystemSettings {
  const input = record(value);
  const colors = record(input.colors);
  const typography = record(input.typography);
  const layout = record(input.layout);
  const buttons = record(input.buttons);
  const header = record(input.header);
  const footer = record(input.footer);
  const defaults = defaultDesignSystemSettings;

  return {
    preset: option(input.preset, ["clean", "editorial", "bold", "soft", "liquid", "custom"] as const, defaults.preset),
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
      headingWeight: option(typography.headingWeight, ["600", "700", "800"] as const, defaults.typography.headingWeight),
      baseSize: integer(typography.baseSize, defaults.typography.baseSize, 14, 20),
      scale: option(typography.scale, ["compact", "standard", "expressive"] as const, defaults.typography.scale)
    },
    layout: {
      contentWidth: integer(layout.contentWidth, defaults.layout.contentWidth, 880, 1440),
      sectionSpacing: integer(layout.sectionSpacing, defaults.layout.sectionSpacing, 24, 128),
      radius: integer(layout.radius, defaults.layout.radius, 0, 24),
      shadow: option(layout.shadow, ["none", "soft", "strong"] as const, defaults.layout.shadow),
      surfaceStyle: option(layout.surfaceStyle, ["solid", "liquid"] as const, defaults.layout.surfaceStyle)
    },
    buttons: {
      radius: integer(buttons.radius, defaults.buttons.radius, 0, 32),
      style: option(buttons.style, ["solid", "outline"] as const, defaults.buttons.style)
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

function fontStack(value: string) {
  const stacks: Record<string, string> = {
    Inter: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    Arial: 'Arial, Helvetica, sans-serif',
    Georgia: 'Georgia, "Times New Roman", serif',
    Verdana: 'Verdana, Geneva, sans-serif',
    "Trebuchet MS": '"Trebuchet MS", Arial, sans-serif'
  };

  return stacks[value] || stacks.Inter;
}

export function designSystemCss(value: unknown) {
  const design = normalizeDesignSystemSettings(value);
  const typeSizes = typeScaleSizes[design.typography.scale];
  const shadows = {
    none: "none",
    soft: "0 14px 36px rgba(18, 27, 36, 0.10)",
    strong: "0 22px 58px rgba(18, 27, 36, 0.18)"
  };
  const scales = {
    compact: "1.125",
    standard: "1.2",
    expressive: "1.3"
  };
  const buttonBackground = design.buttons.style === "outline" ? "transparent" : design.colors.primary;
  const buttonText = design.buttons.style === "outline" ? design.colors.primary : design.colors.primaryContrast;
  const liquidCss = design.layout.surfaceStyle === "liquid"
    ? `
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) .site-header {
  border-bottom-color: color-mix(in srgb, var(--line) 72%, transparent);
  background: color-mix(in srgb, ${design.header.background} 76%, transparent);
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
  --bg: ${design.colors.background};
  --page: ${design.colors.surface};
  --surface: ${design.colors.surface};
  --text: ${design.colors.text};
  --ink: ${design.colors.text};
  --muted: ${design.colors.muted};
  --line: ${design.colors.border};
  --accent: ${design.colors.primary};
  --accent-strong: ${design.colors.primary};
  --site-content-width: ${design.layout.contentWidth}px;
  --site-section-spacing: ${design.layout.sectionSpacing}px;
  --site-radius: ${design.layout.radius}px;
  --site-shadow: ${shadows[design.layout.shadow]};
  --site-heading-font: ${fontStack(design.typography.headingFont)};
  --site-body-font: ${fontStack(design.typography.bodyFont)};
  --site-heading-weight: ${design.typography.headingWeight};
  --site-type-scale: ${scales[design.typography.scale]};
  --site-page-title-size: ${typeSizes.page}px;
  --site-section-title-size: ${typeSizes.section}px;
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
  background: ${design.header.background};
  color: ${design.header.text};
}
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) .site-header :where(.brand, .site-nav a) { color: ${design.header.text}; }
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) .site-footer { background: ${design.footer.background}; color: ${design.footer.text}; }
body:not(.auth-enabled):not(.dashboard-enabled):not([data-codey-preview="cms"]) :where(.action-link, .contact-form > button, .shop-product-card button) {
  border-color: ${design.colors.primary};
  border-radius: ${design.buttons.radius}px;
  background: ${buttonBackground};
  color: ${buttonText};
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

export function sanitizeSiteStylesheet(value: unknown, maxLength = 20_000) {
  const css = typeof value === "string"
    ? value.replace(/<\/?style[^>]*>/gi, "").replace(/\/\*[\s\S]*?\*\//g, "").slice(0, maxLength).trim()
    : "";
  const dangerous = /(@import|expression\s*\(|javascript:|vbscript:|data:text\/html|(?:^|[;{])\s*behavior\s*:|-moz-binding|<)/i;

  return css && !dangerous.test(css) ? css : "";
}

export function publicSiteStyleTag(design: unknown, customCss: unknown, generatedCss?: unknown) {
  const custom = sanitizeSiteStylesheet(customCss);
  const generated = sanitizeSiteStylesheet(generatedCss, 60_000);
  const designTag = `<style data-site-design-system>${designSystemCss(design)}</style>`;
  const generatedTag = generated ? `<style data-codey-generated-theme>${generated}</style>` : "";
  const customTag = custom ? `<style data-site-custom-css>${custom}</style>` : "";

  return `${designTag}${generatedTag}${customTag}`;
}
