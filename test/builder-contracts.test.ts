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
