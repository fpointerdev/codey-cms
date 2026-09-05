export function enhanceMotionWhenPresent(root = document) {
  if (!root?.querySelector?.(".codey-animate, .codey-scroll-motion")) return null;

  return import("../vendor/motion-runtime.js")
    .then(({ enhanceMotion }) => enhanceMotion(root))
    .catch(() => undefined);
}

export function loadThreeRuntimeNearScene(root = document) {
  const scenes = [...(root?.querySelectorAll?.("[data-three-scene]") || [])];
  if (!scenes.length) return;

  let loading = false;
  const load = () => {
    if (loading) return;
    loading = true;
    void import("../vendor/three-runtime.js")
      .then(({ enhanceThreeScenes }) => enhanceThreeScenes(root))
      .catch(() => undefined);
  };

  if (!("IntersectionObserver" in window)) {
    load();
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    load();
  }, { rootMargin: "320px" });

  scenes.forEach((scene) => observer.observe(scene));
}
