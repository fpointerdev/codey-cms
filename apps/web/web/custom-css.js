import { escapeHtml } from "./core.js";

const dangerousCssPattern =
  /(@import|expression\s*\(|javascript:|vbscript:|data:text\/html|behavior\s*:|-moz-binding|<\/?style)/i;
const dangerousPropertyPattern = /^(?:@import|expression|javascript|vbscript|behavior|-moz-binding)$/i;
const animationEffects = new Set(["none", "fade-in", "fade-up", "fade-down", "slide-left", "slide-right", "zoom-in", "blur-in"]);
const reservedClassPatterns = [
  /^page-section$/,
  /^content-block$/,
  /^block-edit$/,
  /^front-edit-button$/,
  /^builder-/,
  /^codey-/,
  /^section-(?:layout|container|spacing|gap|align|valign|style|shadow|decoration|tablet|mobile)-/,
  /^structured-/,
  /^slider-/,
  /^gallery-/
];

export const animationEffectOptions = [
  { value: "none", label: "None" },
  { value: "fade-in", label: "Fade in" },
  { value: "fade-up", label: "Fade up" },
  { value: "fade-down", label: "Fade down" },
  { value: "slide-left", label: "Slide left" },
  { value: "slide-right", label: "Slide right" },
  { value: "zoom-in", label: "Zoom in" },
  { value: "blur-in", label: "Soft blur" }
];

export function sanitizeInlineCss(value = "") {
  const css = String(value || "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!css || /[<>]/.test(css)) return "";

  return css
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf(":");
      if (separator <= 0) return "";

      const property = item.slice(0, separator).trim();
      const declarationValue = item.slice(separator + 1).trim();
      if (!/^(?:--)?[a-zA-Z][a-zA-Z0-9-]*$/.test(property)) return "";
      if (dangerousPropertyPattern.test(property)) return "";
      if (!declarationValue || /[{}<>]/.test(declarationValue) || dangerousCssPattern.test(declarationValue)) return "";

      return `${property}: ${declarationValue}`;
    })
    .filter(Boolean)
    .join("; ");
}

export function sanitizeStylesheet(value = "", maxLength = 20000) {
  const css = String(value || "")
    .replace(/<\/?style[^>]*>/gi, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .slice(0, maxLength)
    .trim();

  if (!css || dangerousCssPattern.test(css) || css.includes("<")) return "";

  return css;
}

export function styleAttribute(value = "") {
  const css = sanitizeInlineCss(value);

  return css ? ` style="${escapeHtml(css)}"` : "";
}

export function sanitizeDomId(value = "") {
  const id = String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_:-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^A-Za-z_]+/, "")
    .slice(0, 80);

  return /^[A-Za-z_][A-Za-z0-9_:-]{0,79}$/.test(id) ? id : "";
}

export function sanitizeClassList(value = "") {
  return String(value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) =>
      /^-?[_A-Za-z][_A-Za-z0-9:-]{0,63}$/.test(item) &&
      !reservedClassPatterns.some((pattern) => pattern.test(item))
    )
    .slice(0, 12)
    .join(" ");
}

export function sanitizeAnimationEffect(value = "") {
  const effect = String(value || "none").trim();
  return animationEffects.has(effect) ? effect : "none";
}

function clampMotionNumber(value, fallback, min, max) {
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function advancedSettingsFromValues(values = {}, currentSettings = {}) {
  const currentAnimation = currentSettings.animation || {};

  return {
    htmlId: sanitizeDomId(values.htmlId ?? currentSettings.htmlId),
    cssClasses: sanitizeClassList(values.cssClasses ?? currentSettings.cssClasses),
    animation: {
      effect: sanitizeAnimationEffect(values.animationEffect ?? currentAnimation.effect),
      durationMs: clampMotionNumber(values.animationDuration ?? currentAnimation.durationMs, 700, 120, 3000),
      delayMs: clampMotionNumber(values.animationDelay ?? currentAnimation.delayMs, 0, 0, 5000)
    }
  };
}

export function sanitizeAnimationSettings(animation = {}) {
  return {
    effect: sanitizeAnimationEffect(animation.effect),
    durationMs: clampMotionNumber(animation.durationMs, 700, 120, 3000),
    delayMs: clampMotionNumber(animation.delayMs, 0, 0, 5000)
  };
}

export function advancedIdAttribute(settings = {}) {
  const id = sanitizeDomId(settings.htmlId || "");
  return id ? ` id="${escapeHtml(id)}"` : "";
}

export function advancedClassList(settings = {}) {
  const classes = sanitizeClassList(settings.cssClasses || "");
  const animation = sanitizeAnimationSettings(settings.animation || {});
  const animationClasses = animation.effect === "none"
    ? ""
    : `codey-animate codey-animation-${animation.effect}`;

  return [classes, animationClasses].filter(Boolean).join(" ");
}

export function animationCssVariables(settings = {}) {
  const animation = sanitizeAnimationSettings(settings.animation || {});
  if (animation.effect === "none") return "";

  return `--codey-animation-duration: ${animation.durationMs}ms; --codey-animation-delay: ${animation.delayMs}ms`;
}

export function advancedStyleAttribute(settings = {}) {
  const declarations = [
    animationCssVariables(settings),
    sanitizeInlineCss(settings.customCss || "")
  ].filter(Boolean).join("; ");

  return declarations ? ` style="${escapeHtml(declarations)}"` : "";
}
