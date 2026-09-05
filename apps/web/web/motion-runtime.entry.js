import { animate, inView, scroll } from "motion";

const supportedEffects = new Set([
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

function animationEffect(element) {
  for (const className of element.classList) {
    if (!className.startsWith("codey-animation-")) continue;
    const effect = className.slice("codey-animation-".length);
    if (supportedEffects.has(effect)) return effect;
  }

  return "fade-up";
}

function motionKeyframes(effect, element) {
  const computed = getComputedStyle(element);
  const computedTransform = computed.transform;
  const base = computed.getPropertyValue("--codey-base-transform").trim()
    || (computedTransform === "none" ? "" : computedTransform);
  const transformed = (...values) => ({
    opacity: values.map((_, index) => index === values.length - 1 ? 1 : 0),
    transform: values.map((value) => `${base} ${value}`.trim() || "none")
  });

  if (effect === "fade-up" || effect === "stagger-up") return transformed("translate3d(0, 28px, 0)", "translate3d(0, 0, 0)");
  if (effect === "fade-down") return transformed("translate3d(0, -28px, 0)", "translate3d(0, 0, 0)");
  if (effect === "slide-left") return transformed("translate3d(44px, 0, 0)", "translate3d(0, 0, 0)");
  if (effect === "slide-right") return transformed("translate3d(-44px, 0, 0)", "translate3d(0, 0, 0)");
  if (effect === "zoom-in") return transformed("scale(0.94)", "scale(1)");
  if (effect === "reveal-up") {
    return { ...transformed("translate3d(0, 34px, 0)", "translate3d(0, 0, 0)"), clipPath: ["inset(18% 0 0 0)", "inset(0 0 0 0)"] };
  }
  if (effect === "bounce-in") return transformed("translate3d(0, 34px, 0) scale(0.96)", "translate3d(0, -5px, 0) scale(1.01)", "translate3d(0, 0, 0) scale(1)");
  if (effect === "swing-in") return transformed("translate3d(0, 20px, 0) rotate(-3deg)", "translate3d(0, 0, 0) rotate(0deg)");
  if (effect === "flip-in") return transformed("perspective(800px) translate3d(0, 18px, 0) rotateX(22deg)", "perspective(800px) translate3d(0, 0, 0) rotateX(0deg)");
  if (effect === "blur-in") return { opacity: [0, 1], filter: ["blur(12px)", "blur(0px)"] };
  return { opacity: [0, 1] };
}

function cssDuration(element, property, fallback) {
  const value = getComputedStyle(element).getPropertyValue(property).trim();
  if (!value) return fallback;
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return fallback;
  return value.endsWith("ms") ? amount / 1000 : amount;
}

function enhanceScrollMotion(root, reducedMotion) {
  root.querySelectorAll(".codey-scroll-motion:not([data-scroll-motion-enhanced])").forEach((element) => {
    element.dataset.scrollMotionEnhanced = "true";
    if (reducedMotion) return;

    let stop = () => undefined;
    stop = scroll((progress) => {
      if (!element.isConnected) {
        stop();
        return;
      }

      const configuredDistance = element.classList.contains("codey-scroll-parallax-deep") ? 36 : 18;
      const distance = window.innerWidth <= 720 ? configuredDistance * 0.55 : configuredDistance;
      const offset = (0.5 - progress) * distance * 2;
      element.style.setProperty("--codey-scroll-offset", `${offset.toFixed(2)}px`);
    }, {
      target: element,
      offset: ["start end", "end start"]
    });
  });
}

export function enhanceMotion(root = document) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  enhanceScrollMotion(root, reducedMotion);

  root.querySelectorAll(".codey-animate:not([data-motion-enhanced])").forEach((element) => {
    element.dataset.motionEnhanced = "true";
    if (reducedMotion) return;

    let played = false;
    inView(element, () => {
      if (played) return;
      played = true;

      const duration = cssDuration(element, "--codey-animation-duration", 0.7);
      const delay = cssDuration(element, "--codey-animation-delay", 0);
      const effect = animationEffect(element);
      const targets = effect === "stagger-up"
        ? [...element.children].filter((child) => child instanceof HTMLElement).slice(0, 8)
        : [element];
      const animatedTargets = targets.length ? targets : [element];
      const controls = animatedTargets.map((target, index) => animate(
        target,
        motionKeyframes(effect, target),
        {
          delay: delay + (effect === "stagger-up" ? index * 0.08 : 0),
          duration,
          ease: [0.2, 0.8, 0.2, 1]
        }
      ));
      void Promise.all(controls).then(() => {
        controls.forEach((control) => control.stop());
        animatedTargets.forEach((target) => {
          for (const property of ["opacity", "transform", "filter", "clip-path"]) {
            target.style.removeProperty(property);
          }
        });
      });
    }, { amount: 0.18 });
  });
}
