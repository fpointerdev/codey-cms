const maxKeyLength = 120;

export function copyBuilderSections(sections = []) {
  if (typeof structuredClone === "function") return structuredClone(sections);

  return JSON.parse(JSON.stringify(sections));
}

function uniqueCopyKey(value, usedKeys) {
  const base = String(value || "item").slice(0, maxKeyLength);
  let copyNumber = 1;

  while (copyNumber < 1000) {
    const suffix = copyNumber === 1 ? "-copy" : `-copy-${copyNumber}`;
    const candidate = `${base.slice(0, maxKeyLength - suffix.length)}${suffix}`;
    if (!usedKeys.has(candidate)) {
      usedKeys.add(candidate);
      return candidate;
    }
    copyNumber += 1;
  }

  return `${base.slice(0, maxKeyLength - 14)}-${Date.now()}`;
}

function copiedLabel(value, fallback) {
  const label = String(value || fallback).trim() || fallback;
  return `${label.slice(0, 155)} copy`;
}

function builderBlockKeys(sections) {
  return new Set(sections.flatMap((section) => (section.blocks || []).map((block) => block.key)));
}

export function sectionToBuilderInput(section = {}) {
  return {
    key: section.key,
    label: section.label || undefined,
    sortOrder: section.sortOrder || 0,
    settings: section.settings || {},
    blocks: (section.blocks || []).map((block) => ({
      key: block.key,
      type: block.type,
      label: block.label || undefined,
      value: block.value,
      settings: block.settings || {},
      sortOrder: block.sortOrder || 0,
      editable: block.editable !== false,
      ...(block.mediaAssetId ? { mediaAssetId: block.mediaAssetId } : {})
    }))
  };
}

export function normalizeBuilderSectionsForSave(sections = []) {
  return sections.map((section, sectionIndex) =>
    sectionToBuilderInput({
      ...section,
      sortOrder: sectionIndex,
      blocks: (section.blocks || []).map((block, blockIndex) => ({
        ...block,
        sortOrder: blockIndex
      }))
    })
  );
}

function availableTemplateKey(value, usedKeys) {
  const key = String(value || "item").slice(0, maxKeyLength);
  if (!usedKeys.has(key)) {
    usedKeys.add(key);
    return key;
  }

  return uniqueCopyKey(key, usedKeys);
}

export function instantiateBuilderSectionTemplate(templateSection, sections = []) {
  if (!templateSection || typeof templateSection !== "object") return null;

  const sectionKeys = new Set(sections.map((section) => section.key));
  const blockKeys = builderBlockKeys(sections);
  const section = copyBuilderSections([templateSection])[0];
  delete section.id;
  section.key = availableTemplateKey(section.key, sectionKeys);
  section.blocks = (section.blocks || []).map((block) => {
    delete block.id;
    block.key = availableTemplateKey(block.key, blockKeys);
    return block;
  });

  return sectionToBuilderInput(section);
}

export function duplicateBuilderSectionInSections(sections = [], sectionId = "") {
  const nextSections = copyBuilderSections(sections);
  const sectionIndex = nextSections.findIndex((section) => section.id === sectionId);
  if (sectionIndex < 0) return null;

  const sectionKeys = new Set(nextSections.map((section) => section.key));
  const blockKeys = builderBlockKeys(nextSections);
  const copy = copyBuilderSections([nextSections[sectionIndex]])[0];
  delete copy.id;
  copy.key = uniqueCopyKey(copy.key, sectionKeys);
  copy.label = copiedLabel(copy.label, "Container");
  copy.blocks = (copy.blocks || []).map((block) => {
    delete block.id;
    block.key = uniqueCopyKey(block.key, blockKeys);
    return block;
  });

  nextSections.splice(sectionIndex + 1, 0, copy);
  return { sections: nextSections, activeSectionKey: copy.key };
}

export function duplicateBuilderBlockInSections(sections = [], blockKey = "") {
  const nextSections = copyBuilderSections(sections);
  const blockKeys = builderBlockKeys(nextSections);

  for (const section of nextSections) {
    const blockIndex = (section.blocks || []).findIndex((block) => block.key === blockKey);
    if (blockIndex < 0) continue;

    const copy = copyBuilderSections([section.blocks[blockIndex]])[0];
    delete copy.id;
    copy.key = uniqueCopyKey(copy.key, blockKeys);
    copy.label = copiedLabel(copy.label, "Element");
    section.blocks.splice(blockIndex + 1, 0, copy);

    return { sections: nextSections, activeSectionKey: section.key, blockKey: copy.key };
  }

  return null;
}

export function moveBuilderSectionInSections(sections = [], sectionId = "", direction = "up") {
  const nextSections = copyBuilderSections(sections);
  const sectionIndex = nextSections.findIndex((section) => section.id === sectionId);
  const targetIndex = direction === "down" ? sectionIndex + 1 : sectionIndex - 1;
  if (sectionIndex < 0 || targetIndex < 0 || targetIndex >= nextSections.length) return null;

  [nextSections[sectionIndex], nextSections[targetIndex]] = [nextSections[targetIndex], nextSections[sectionIndex]];
  return { sections: nextSections, activeSectionKey: nextSections[targetIndex].key };
}

export function moveBuilderBlockInSections(sections = [], blockKey = "", direction = "up") {
  const nextSections = copyBuilderSections(sections);

  for (const section of nextSections) {
    const blockIndex = (section.blocks || []).findIndex((block) => block.key === blockKey);
    const targetIndex = direction === "down" ? blockIndex + 1 : blockIndex - 1;
    if (blockIndex < 0) continue;
    if (targetIndex < 0 || targetIndex >= section.blocks.length) return null;

    [section.blocks[blockIndex], section.blocks[targetIndex]] = [section.blocks[targetIndex], section.blocks[blockIndex]];
    return { sections: nextSections, activeSectionKey: section.key };
  }

  return null;
}
