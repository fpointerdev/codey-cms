import assert from "node:assert/strict";
import test from "node:test";
import {
  builderElementRegistry,
  builderSectionPatternRegistry,
  validateBuilderSectionContract,
  validateBuilderTemplateContract
} from "../src/modules/builder/element-registry.js";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => null,
    removeItem: () => undefined,
    setItem: () => undefined
  }
});

const {
  buildSectionPattern,
  componentTemplates,
  sectionPatternTemplates
} = await import("../apps/web/web/core.js");
const { structuredContentEditor } = await import("../apps/web/web/structured-content-editor.js");
const { mediaKindForMimeType } = await import("../apps/web/web/content-actions.js");

test("frontend builder templates match the registered generator-safe elements", () => {
  const registeredIds = builderElementRegistry
    .filter((element) => element.generatorSafe)
    .map((element) => element.id)
    .sort();
  const frontendIds = componentTemplates.map((template) => template.id).sort();

  assert.deepEqual(frontendIds, registeredIds);
});

test("frontend builder templates satisfy the builder contract", () => {
  for (const template of componentTemplates) {
    const result = validateBuilderTemplateContract(template);
    assert.deepEqual(result.errors, [], `${template.id}: ${JSON.stringify(result.errors)}`);
  }
});

test("section patterns preserve block ownership and satisfy the builder contract", () => {
  const registeredPatternIds = builderSectionPatternRegistry.map((pattern) => pattern.id).sort();
  const frontendPatternIds = sectionPatternTemplates.map((pattern) => pattern.id).sort();
  assert.deepEqual(frontendPatternIds, registeredPatternIds);

  for (const pattern of sectionPatternTemplates) {
    const section = buildSectionPattern(pattern.id, { sections: [] });
    const result = validateBuilderSectionContract(section, {
      pageSlug: "builder-test",
      productSlugs: ["starter-product"],
      requireElementId: true
    });

    assert.ok(
      section.blocks.every((block) => typeof block.settings?.elementId === "string"),
      `${pattern.id} has a block without an element id`
    );
    assert.deepEqual(result.errors, [], `${pattern.id}: ${JSON.stringify(result.errors)}`);
  }
});

test("v1 structured elements expose simple settings and preserve comparison content", () => {
  const editor = structuredContentEditor({
    key: "comparison",
    type: "CUSTOM",
    settings: { elementId: "comparison-table" },
    value: {
      variant: "comparison-table",
      title: "Compare plans",
      firstColumnTitle: "Basic",
      secondColumnTitle: "Pro",
      items: [{ title: "Support", firstValue: "Email", secondValue: "Priority" }],
      display: { alignment: "left", density: "comfortable", surface: "outline", striped: true }
    }
  });

  assert.ok(editor);
  assert.ok(editor.fields.some((field) => field.name === "structuredAlignment" && field.group === "Settings"));
  assert.ok(editor.fields.some((field) => field.name === "structuredStripedRows" && field.group === "Settings"));

  const value = editor.valueFrom({
    structuredTitle: "Compare plans",
    structuredFirstColumnTitle: "Starter",
    structuredSecondColumnTitle: "Business",
    structuredItem1Title: "Support",
    structuredItem1FirstValue: "Email",
    structuredItem1SecondValue: "Priority",
    structuredAlignment: "center",
    structuredDensity: "compact",
    structuredSurface: "soft",
    structuredStripedRows: true
  });

  assert.equal(value.firstColumnTitle, "Starter");
  assert.equal(value.secondColumnTitle, "Business");
  assert.deepEqual(value.items, [{ title: "Support", firstValue: "Email", secondValue: "Priority" }]);
  assert.deepEqual(value.display, {
    alignment: "center",
    density: "compact",
    surface: "soft",
    striped: true
  });
});

test("media uploads classify supported video and document formats correctly", () => {
  assert.equal(mediaKindForMimeType("image/webp"), "IMAGE");
  assert.equal(mediaKindForMimeType("video/mp4"), "VIDEO");
  assert.equal(mediaKindForMimeType("application/pdf"), "DOCUMENT");
  assert.equal(mediaKindForMimeType("text/plain"), "OTHER");
});
