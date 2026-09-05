import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("editor modals freeze and restore the page background", async () => {
  const [modalSource, modalStyles] = await Promise.all([
    readFile("apps/web/web/modal.js", "utf8"),
    readFile("apps/web/styles/tables-modal-responsive.css", "utf8")
  ]);

  assert.match(modalSource, /freezePageForModal\(modal\)/);
  assert.match(modalSource, /restorePageAfterModal\(modal\)/);
  assert.match(modalSource, /window\.scrollTo\(x, y\)/);
  assert.match(modalSource, /element\.inert = Boolean\(activeModal && element !== activeModal\)/);
  assert.match(modalSource, /event\.key !== "Tab"/);
  assert.match(modalStyles, /html\.modal-open,[\s\S]*body\.modal-open[\s\S]*overflow: hidden/);
});

test("builder and public previews share lazy premium visual runtimes", async () => {
  const [builderPreview, publicRuntime, premiumVisuals, threeRuntime] = await Promise.all([
    readFile("apps/web/web/builder-preview.js", "utf8"),
    readFile("apps/web/web/public-runtime.js", "utf8"),
    readFile("apps/web/web/premium-visuals.js", "utf8"),
    readFile("apps/web/web/three-runtime.entry.js", "utf8")
  ]);

  for (const source of [builderPreview, publicRuntime]) {
    assert.match(source, /enhanceMotionWhenPresent\(page\)/);
    assert.match(source, /loadThreeRuntimeNearScene\(page\)/);
  }
  assert.match(premiumVisuals, /import\("\.\.\/vendor\/motion-runtime\.js"\)/);
  assert.match(premiumVisuals, /\.codey-animate, \.codey-scroll-motion/);
  assert.match(premiumVisuals, /import\("\.\.\/vendor\/three-runtime\.js"\)/);
  assert.match(premiumVisuals, /IntersectionObserver/);
  assert.match(threeRuntime, /renderer\.shadowMap\.type = THREE\.PCFShadowMap/);
  assert.doesNotMatch(threeRuntime, /PCFSoftShadowMap/);
  assert.match(threeRuntime, /if \(!\("IntersectionObserver" in window\)\)/);

  const motionRuntime = await readFile("apps/web/web/motion-runtime.entry.js", "utf8");
  assert.match(motionRuntime, /import \{ animate, inView, scroll \} from "motion"/);
  assert.match(motionRuntime, /offset: \["start end", "end start"\]/);
  assert.match(motionRuntime, /window\.innerWidth <= 720/);
  assert.match(motionRuntime, /if \(reducedMotion\) return/);
});
