import { escapeHtml } from "./core.js";

const dangerousCssPattern =
  /(@import|expression\s*\(|javascript:|vbscript:|data:text\/html|behavior\s*:|-moz-binding|<\/?style)/i;
const dangerousPropertyPattern = /^(?:@import|expression|javascript|vbscript|behavior|-moz-binding)$/i;
const animationEffects = new Set([
  "none",
  "fade-in",
  "fade-up",
  "fade-down",
  "slide-left",
  "slide-right",
  "zoom-in",
  "blur-in",
  "reveal-up",
  "stagger-up",
  "bounce-in",
  "swing-in",
  "flip-in"
]);
const scrollMotionEffects = new Set(["none", "parallax-soft", "parallax-deep"]);
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
  { value: "blur-in", label: "Soft blur" },
  { value: "reveal-up", label: "Reveal up" },
  { value: "stagger-up", label: "Stagger items" },
  { value: "bounce-in", label: "Gentle bounce" },
  { value: "swing-in", label: "Swing in" },
  { value: "flip-in", label: "Flip in" }
];

const motionStylePresets = [
  { value: "none", label: "Still", description: "No entrance motion.", preview: "motion-none" },
  { value: "fade-up", label: "Soft", description: "A calm fade with a small lift.", preview: "motion-soft" },
  { value: "reveal-up", label: "Reveal", description: "Content opens into view.", preview: "motion-reveal" },
  { value: "stagger-up", label: "Sequence", description: "Items appear in a short rhythm.", preview: "motion-sequence" },
  { value: "zoom-in", label: "Focus", description: "A restrained scale-in effect.", preview: "motion-focus" },
  { value: "slide-left", label: "Glide", description: "Content enters from the side.", preview: "motion-glide" }
];

export function motionStyleOptions(currentEffect = "none") {
  const effect = sanitizeAnimationEffect(currentEffect);
  if (motionStylePresets.some((option) => option.value === effect)) return motionStylePresets;

  const current = animationEffectOptions.find((option) => option.value === effect);
  return [
    ...motionStylePresets,
    {
      value: effect,
      label: current?.label || "Current effect",
      description: "Preserves the existing effect.",
      preview: "motion-custom"
    }
  ];
}

export function motionDurationOptions(currentDuration = 700) {
  const duration = clampMotionNumber(currentDuration, 700, 120, 3000);
  const options = [
    { value: "450", label: "Quick" },
    { value: "700", label: "Smooth" },
    { value: "1000", label: "Relaxed" }
  ];
  if (options.some((option) => Number(option.value) === duration)) return options;

  return [...options, { value: String(duration), label: `Current (${duration} ms)` }];
}

export function motionDelayOptions(currentDelay = 0) {
  const delay = clampMotionNumber(currentDelay, 0, 0, 5000);
  const options = [
    { value: "0", label: "Immediately" },
    { value: "100", label: "Short pause" },
    { value: "200", label: "Medium pause" },
    { value: "400", label: "Long pause" }
  ];
  if (options.some((option) => Number(option.value) === delay)) return options;

  return [...options, { value: String(delay), label: `Current (${delay} ms)` }];
}

export function scrollMotionOptions() {
  return [
    {
      value: "none",
      label: "None",
      description: "Keep the element fixed while scrolling.",
      preview: "scroll-none"
    },
    {
      value: "parallax-soft",
      label: "Gentle parallax",
      description: "A small scroll shift for images and visual accents.",
      preview: "scroll-soft"
    },
    {
      value: "parallax-deep",
      label: "Deep parallax",
      description: "A stronger shift for spacious visual layouts.",
      preview: "scroll-deep"
    }
  ];
}

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

export function sanitizeScrollMotionEffect(value = "") {
  const effect = String(value || "none").trim();
  return scrollMotionEffects.has(effect) ? effect : "none";
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
      delayMs: clampMotionNumber(values.animationDelay ?? currentAnimation.delayMs, 0, 0, 5000),
      scrollEffect: sanitizeScrollMotionEffect(values.animationScrollEffect ?? currentAnimation.scrollEffect)
    }
  };
}

export function sanitizeAnimationSettings(animation = {}) {
  return {
    effect: sanitizeAnimationEffect(animation.effect),
    durationMs: clampMotionNumber(animation.durationMs, 700, 120, 3000),
    delayMs: clampMotionNumber(animation.delayMs, 0, 0, 5000),
    scrollEffect: sanitizeScrollMotionEffect(animation.scrollEffect)
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
  const scrollClasses = animation.scrollEffect === "none"
    ? ""
    : `codey-scroll-motion codey-scroll-${animation.scrollEffect}`;

  return [classes, animationClasses, scrollClasses].filter(Boolean).join(" ");
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
