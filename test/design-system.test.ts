import assert from "node:assert/strict";
import test from "node:test";
import {
  designSystemCss,
  designSystemFromForm,
  designSystemPresets,
  normalizeDesignSystem,
  syncDesignColorTextInput
} from "../apps/web/web/design-system.js";
import {
  designSystemCss as serverDesignSystemCss,
  normalizeDesignSystemSettings,
  publicSiteStyleTag
} from "../src/modules/config/site-design.js";

test("design settings normalize invalid saved values to a complete safe theme", () => {
  const design = normalizeDesignSystem({
    colors: { primary: "javascript:alert(1)", text: "#ABCDEF" },
    typography: { headingFont: "Remote Font", baseSize: 100 },
    layout: { contentWidth: 200, radius: -4 },
    buttons: { radius: 999 }
  });

  assert.equal(design.colors.primary, "#0d7c68");
  assert.equal(design.colors.text, "#abcdef");
  assert.equal(design.typography.headingFont, "Inter");
  assert.equal(design.typography.baseSize, 20);
  assert.equal(design.layout.contentWidth, 880);
  assert.equal(design.layout.radius, 0);
  assert.equal(design.buttons.radius, 32);
});

test("browser and server design renderers emit the same core public tokens", () => {
  const design = designSystemPresets.editorial;
  const browserCss = designSystemCss(design);
  const serverCss = serverDesignSystemCss(normalizeDesignSystemSettings(design));

  for (const [name, value] of [["--bg", "#f4f1ea"], ["--accent", "#a33d2d"], ["--site-content-width", "1040px"]]) {
    const token = new RegExp(`${name}:\\s*${value}`);
    assert.match(browserCss, token);
    assert.match(serverCss, token);
  }
  assert.match(browserCss, /font-family: var\(--site-body-font\)/);
  assert.doesNotMatch(browserCss, /undefined|javascript:/);
});

test("type scale affects public headings on desktop and mobile", () => {
  const browserCss = designSystemCss(designSystemPresets.bold);
  const serverCss = serverDesignSystemCss(designSystemPresets.bold);

  for (const css of [browserCss, serverCss]) {
    assert.match(css, /--site-page-title-size:\s*84px/);
    assert.match(css, /--site-section-title-size:\s*68px/);
    assert.match(css, /font-size:\s*56px/);
    assert.match(css, /font-size:\s*46px/);
  }
});

test("server-rendered design and custom CSS use separate managed style tags", () => {
  const html = publicSiteStyleTag(designSystemPresets.clean, ".page-title { color: #123456; }");

  assert.match(html, /<style data-site-design-system>/);
  assert.match(html, /<style data-site-custom-css>\.page-title/);
  assert.doesNotMatch(publicSiteStyleTag({}, "@import 'https:\/\/example.com\/bad.css';"), /data-site-custom-css/);
});

test("design form parsing keeps saved values when a settings tab has no design controls", () => {
  const current = designSystemPresets.bold;
  const emptyForm = {
    elements: { namedItem: () => null },
    querySelector: () => null
  };

  assert.deepEqual(designSystemFromForm(emptyForm, current), normalizeDesignSystem(current));
});

test("typed design colors update the native picker and recover from incomplete values", () => {
  const colorField = { value: "#0d7c68" };
  const attributes = new Map<string, string>();
  const form = {
    elements: { namedItem: (name: string) => name === "design.colors.primary" ? colorField : null },
    querySelector: () => null
  };
  const input = {
    dataset: { designColorTextFor: "design.colors.primary" },
    value: "2463eb",
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name)
  };

  assert.equal(syncDesignColorTextInput(form, input), true);
  assert.equal(colorField.value, "#2463eb");
  assert.equal(input.value, "#2463EB");

  input.value = "#12";
  assert.equal(syncDesignColorTextInput(form, input), false);
  assert.equal(attributes.get("aria-invalid"), "true");
  assert.equal(syncDesignColorTextInput(form, input, { restoreInvalid: true }), false);
  assert.equal(input.value, "#2463EB");
  assert.equal(attributes.has("aria-invalid"), false);
});
