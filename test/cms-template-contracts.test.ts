import assert from "node:assert/strict";
import test from "node:test";
import {
  createCmsTemplateSchema,
  updateCmsTemplateSchema
} from "../src/modules/cms/cms.schemas.js";

const section = {
  key: "reusable-hero",
  label: "Reusable hero",
  blocks: [{
    key: "reusable-heading",
    type: "RICH_TEXT" as const,
    value: "<h1>Reusable heading</h1>"
  }]
};

test("CMS reusable template contracts distinguish section and page snapshots", () => {
  const sectionTemplate = createCmsTemplateSchema.parse({
    name: "Hero",
    type: "SECTION",
    content: { section }
  });
  const pageTemplate = createCmsTemplateSchema.parse({
    name: "Landing page",
    type: "PAGE",
    content: { content: { layout: "full-width" }, sections: [section] }
  });

  assert.equal(sectionTemplate.content.section.blocks[0].editable, true);
  assert.equal(pageTemplate.content.sections[0].sortOrder, 0);
  assert.equal(createCmsTemplateSchema.safeParse({
    name: "Broken",
    type: "SECTION",
    content: { sections: [section] }
  }).success, false);
  assert.equal(updateCmsTemplateSchema.safeParse({ type: "PAGE" }).success, false);
});
