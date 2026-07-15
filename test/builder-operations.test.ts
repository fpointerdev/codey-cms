import assert from "node:assert/strict";
import test from "node:test";
import {
  duplicateBuilderBlockInSections,
  duplicateBuilderSectionInSections,
  moveBuilderBlockInSections,
  moveBuilderSectionInSections
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
