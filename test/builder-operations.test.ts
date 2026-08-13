import assert from "node:assert/strict";
import test from "node:test";
import {
  createBuilderClipboardPayload,
  duplicateBuilderBlockInSections,
  duplicateBuilderSectionInSections,
  instantiateBuilderSectionTemplate,
  moveBuilderBlockInSections,
  moveBuilderSectionInSections,
  normalizeBuilderSectionsForSave,
  pasteBuilderClipboardInSections
} from "../apps/web/web/builder-operations.js";

const sections = [
  {
    id: "section-a",
    key: "section-a",
    label: "Section A",
    blocks: [
      { id: "block-a", key: "block-a", label: "Block A", type: "TEXT", value: "A" },
      { id: "block-b", key: "block-b", label: "Block B", type: "TEXT", value: "B" }
    ]
  },
  {
    id: "section-b",
    key: "section-b",
    label: "Section B",
    blocks: [{ id: "block-c", key: "block-c", label: "Block C", type: "TEXT", value: "C" }]
  }
];

test("builder sections and elements duplicate with unique keys without mutating the source", () => {
  const sectionCopy = duplicateBuilderSectionInSections(sections, "section-a");
  assert.ok(sectionCopy);
  assert.equal(sectionCopy.sections.length, 3);
  assert.equal(sectionCopy.sections[1].key, "section-a-copy");
  assert.deepEqual(sectionCopy.sections[1].blocks.map((block) => block.key), ["block-a-copy", "block-b-copy"]);
  assert.equal(sections.length, 2);

  const secondSectionCopy = duplicateBuilderSectionInSections(sectionCopy.sections, "section-a");
  assert.equal(secondSectionCopy?.sections[1].key, "section-a-copy-2");

  const blockCopy = duplicateBuilderBlockInSections(sections, "block-a");
  assert.ok(blockCopy);
  assert.deepEqual(blockCopy.sections[0].blocks.map((block) => block.key), ["block-a", "block-a-copy", "block-b"]);
  assert.deepEqual(sections[0].blocks.map((block) => block.key), ["block-a", "block-b"]);
});

test("builder sections and elements move one position with boundary protection", () => {
  const movedSection = moveBuilderSectionInSections(sections, "section-b", "up");
  assert.deepEqual(movedSection?.sections.map((section) => section.key), ["section-b", "section-a"]);
  assert.equal(moveBuilderSectionInSections(sections, "section-a", "up"), null);

  const movedBlock = moveBuilderBlockInSections(sections, "block-a", "down");
  assert.deepEqual(movedBlock?.sections[0].blocks.map((block) => block.key), ["block-b", "block-a"]);
  assert.equal(moveBuilderBlockInSections(sections, "block-b", "down"), null);
});

test("builder clipboard pastes elements into the selected container with unique keys", () => {
  const payload = createBuilderClipboardPayload(sections, { blockKey: "block-a" });
  const result = pasteBuilderClipboardInSections(sections, payload, {
    sectionId: "section-b",
    blockKey: "block-c"
  });

  assert.ok(result);
  assert.equal(result.activeSectionKey, "section-b");
  assert.equal(result.blockKey, "block-a-copy");
  assert.deepEqual(result.sections[1].blocks.map((block) => block.key), ["block-c", "block-a-copy"]);
  assert.equal(result.sections[1].blocks[1].label, "Block A copy");
  assert.deepEqual(sections[1].blocks.map((block) => block.key), ["block-c"]);
});

test("builder clipboard pastes containers after the selected container", () => {
  const payload = createBuilderClipboardPayload(sections, { sectionId: "section-a" });
  const result = pasteBuilderClipboardInSections(sections, payload, { sectionId: "section-b" });

  assert.ok(result);
  assert.deepEqual(result.sections.map((section) => section.key), ["section-a", "section-b", "section-a-copy"]);
  assert.deepEqual(result.sections[2].blocks.map((block) => block.key), ["block-a-copy", "block-b-copy"]);
  assert.equal(result.activeSectionKey, "section-a-copy");
});

test("builder clipboard rejects malformed payloads", () => {
  assert.equal(pasteBuilderClipboardInSections(sections, { version: 2, kind: "block", item: {} }), null);
  assert.equal(pasteBuilderClipboardInSections(sections, { version: 1, kind: "block", item: { key: "missing-type" } }), null);
});

test("reusable sections insert with unique keys and persistence-safe ordering", () => {
  const reusable = instantiateBuilderSectionTemplate({
    id: "template-id",
    key: "section-a",
    label: "Saved section",
    sortOrder: 9,
    settings: {},
    blocks: [{ id: "template-block", key: "block-a", type: "TEXT", value: "Saved", sortOrder: 4 }]
  }, sections);

  assert.ok(reusable);
  assert.equal(reusable.key, "section-a-copy");
  assert.equal(reusable.blocks[0].key, "block-a-copy");
  assert.equal("id" in reusable, false);
  assert.equal("id" in reusable.blocks[0], false);

  const normalized = normalizeBuilderSectionsForSave([...sections, reusable]);
  assert.deepEqual(normalized.map((section) => section.sortOrder), [0, 1, 2]);
  assert.deepEqual(normalized[0].blocks.map((block) => block.sortOrder), [0, 1]);
});
