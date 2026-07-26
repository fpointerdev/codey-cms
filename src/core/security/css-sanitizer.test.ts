import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeGeneratedStylesheet } from "./css-sanitizer.js";

test("generated CSS sanitizer keeps scroll behavior and rejects executable CSS", () => {
  const reducedMotionCss =
    "html{scroll-behavior:smooth}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}";

  assert.equal(sanitizeGeneratedStylesheet(reducedMotionCss), reducedMotionCss);
  assert.equal(
    sanitizeGeneratedStylesheet(".section-copy>p{color:#334155}"),
    ".section-copy>p{color:#334155}"
  );
  assert.equal(sanitizeGeneratedStylesheet(".hero{color:red}<script>alert(1)</script>"), "");
  assert.equal(sanitizeGeneratedStylesheet(".legacy{behavior:none}"), "");
  assert.equal(sanitizeGeneratedStylesheet(".hero{background:url(https://example.com/pixel)}"), "");
});
