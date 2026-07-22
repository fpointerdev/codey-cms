import { api, setStatus, state } from "./core.js";
import { currentLocale } from "./routes.js";
import { getModalFormHandler } from "./modal.js";
import { renderPage } from "./public-renderer.js";
import {
  copyBuilderSections,
  duplicateBuilderBlockInSections,
  duplicateBuilderSectionInSections,
  instantiateBuilderSectionTemplate,
  moveBuilderBlockInSections,
  moveBuilderSectionInSections,
  normalizeBuilderSectionsForSave,
  sectionToBuilderInput
} from "./builder-operations.js";

const visualHistoryLimit = 30;

function localeQuery() {
  return `locale=${encodeURIComponent(currentLocale())}`;
}

function ensureVisualHistory() {
  const historyKey = `${state.page?.locale || currentLocale()}:${state.page?.slug || ""}`;
  if (state.visualEditorHistoryKey === historyKey) return;

  state.visualEditorHistoryKey = historyKey;
  state.visualEditorUndoStack = [];
  state.visualEditorRedoStack = [];
  state.visualEditorSelection = null;
  state.visualEditorEditingBlockKey = "";
}

function pushHistory(stack, sections) {
  stack.push(copyBuilderSections(sections));
  if (stack.length > visualHistoryLimit) stack.splice(0, stack.length - visualHistoryLimit);
}

function recordHistory(sections) {
  ensureVisualHistory();
  pushHistory(state.visualEditorUndoStack, sections);
  state.visualEditorRedoStack = [];
}

async function saveVisualSections(sections, message, selection = null, options = {}) {
  if (!state.page) return;
  const previous = options.recordHistory === false ? null : copyBuilderSections(state.page.sections || []);
  const { page } = await api(`/cms/pages/${encodeURIComponent(state.page.slug)}?${localeQuery()}`, {
    method: "PATCH",
    body: JSON.stringify({ sections: normalizeBuilderSectionsForSave(sections) })
  });

  if (previous) recordHistory(previous);
  state.page = page;
  state.visualEditorSelection = selection;
  state.visualEditorEditingBlockKey = "";
  renderPage(page);
  setStatus(message);
}

function sectionById(sectionId) {
  return (state.page?.sections || []).find((section) => section.id === sectionId);
}

function blockByKey(blockKey) {
  for (const section of state.page?.sections || []) {
    const block = (section.blocks || []).find((item) => item.key === blockKey);
    if (block) return { block, section };
  }

  return null;
}

export function selectVisualEditorItem(element) {
  const block = element?.closest?.("[data-visual-block]");
  const section = element?.closest?.("[data-visual-section]");
  const selection = block?.dataset.blockKey
    ? { type: "block", key: block.dataset.blockKey }
    : section?.dataset.sectionKey
      ? { type: "section", key: section.dataset.sectionKey }
      : null;
  state.visualEditorSelection = selection;

  document.querySelectorAll?.("[data-visual-block], [data-visual-section]").forEach((item) => {
    const selected = selection?.type === "block"
      ? item.matches("[data-visual-block]") && item.dataset.blockKey === selection.key
      : selection?.type === "section" && item.matches("[data-visual-section]") && item.dataset.sectionKey === selection.key;
    item.classList.toggle("visual-selected", Boolean(selected));
    if (item.hasAttribute("tabindex")) item.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

export async function duplicateVisualSection(sectionId) {
  const result = duplicateBuilderSectionInSections(state.page?.sections || [], sectionId);
  if (!result) return;

  try {
    await saveVisualSections(result.sections, "Section duplicated.", { type: "section", key: result.activeSectionKey });
  } catch (error) {
    setStatus(error.message || "Unable to duplicate section.", true);
  }
}

export async function moveVisualSection(sectionId, direction) {
  const result = moveBuilderSectionInSections(state.page?.sections || [], sectionId, direction);
  if (!result) return;

  try {
    await saveVisualSections(result.sections, "Section order saved.", { type: "section", key: result.activeSectionKey });
  } catch (error) {
    setStatus(error.message || "Unable to move section.", true);
  }
}

export async function deleteVisualSection(sectionId) {
  const section = sectionById(sectionId);
  if (!section) return;
  const blockCount = section.blocks?.length || 0;
  const confirmation = await getModalFormHandler()({
    label: "Delete section",
    title: `Remove ${section.label || "this section"}?`,
    description: blockCount ? `This also removes ${blockCount} element${blockCount === 1 ? "" : "s"}.` : "This section is empty.",
    fields: [],
    submitLabel: "Delete section",
    destructive: true
  });
  if (!confirmation) return;

  try {
    await saveVisualSections(
      (state.page.sections || []).filter((item) => item.id !== sectionId),
      "Section deleted."
    );
  } catch (error) {
    setStatus(error.message || "Unable to delete section.", true);
  }
}

export async function editVisualSection(sectionId) {
  const section = sectionById(sectionId);
  if (!section) return;
  const settings = section.settings || {};
  const values = await getModalFormHandler()({
    label: "Section settings",
    title: section.label || "Edit section",
    fields: [
      { name: "label", label: "Label", value: section.label || section.key },
      {
        name: "layout",
        label: "Layout",
        type: "select",
        value: settings.layout || "one-column",
        options: [
          { value: "one-column", label: "1 column" },
          { value: "two-column", label: "2 columns" },
          { value: "three-column", label: "3 columns" },
          { value: "four-column", label: "4 columns" },
          { value: "asymmetric", label: "Asymmetric" },
          { value: "full-bleed", label: "Full width" }
        ]
      },
      {
        name: "container",
        label: "Content width",
        type: "select",
        value: settings.container || "default",
        options: [
          { value: "narrow", label: "Narrow" },
          { value: "default", label: "Default" },
          { value: "wide", label: "Wide" },
          { value: "full", label: "Edge to edge" }
        ]
      },
      {
        name: "spacing",
        label: "Spacing",
        type: "select",
        value: settings.spacing || "md",
        options: [
          { value: "none", label: "None" },
          { value: "sm", label: "Small" },
          { value: "md", label: "Medium" },
          { value: "lg", label: "Large" },
          { value: "xl", label: "Extra large" }
        ]
      },
      { name: "backgroundColor", label: "Background color", type: "color", value: settings.background?.color || "#ffffff", required: false }
    ],
    submitLabel: "Save section"
  });
  if (!values) return;

  const sections = (state.page.sections || []).map((item) => item.id === sectionId
    ? {
        ...item,
        label: values.label,
        settings: {
          ...(item.settings || {}),
          layout: values.layout,
          container: values.container,
          spacing: values.spacing,
          background: {
            ...(item.settings?.background || {}),
            color: values.backgroundColor,
            style: item.settings?.background?.style || "cover"
          }
        }
      }
    : item);

  try {
    await saveVisualSections(sections, "Section settings saved.", { type: "section", key: section.key });
  } catch (error) {
    setStatus(error.message || "Unable to save section settings.", true);
  }
}

export async function duplicateVisualBlock(blockKey) {
  const result = duplicateBuilderBlockInSections(state.page?.sections || [], blockKey);
  if (!result) return;

  try {
    await saveVisualSections(result.sections, "Element duplicated.", { type: "block", key: result.blockKey });
  } catch (error) {
    setStatus(error.message || "Unable to duplicate element.", true);
  }
}

export async function moveVisualBlock(blockKey, direction) {
  const result = moveBuilderBlockInSections(state.page?.sections || [], blockKey, direction);
  if (!result) return;

  try {
    await saveVisualSections(result.sections, "Element order saved.", { type: "block", key: blockKey });
  } catch (error) {
    setStatus(error.message || "Unable to move element.", true);
  }
}

export async function deleteVisualBlock(blockKey) {
  const found = blockByKey(blockKey);
  if (!found) return;
  const confirmation = await getModalFormHandler()({
    label: "Delete element",
    title: `Remove ${found.block.label || "this element"}?`,
    fields: [],
    submitLabel: "Delete element",
    destructive: true
  });
  if (!confirmation) return;

  const sections = (state.page.sections || []).map((section) => ({
    ...section,
    blocks: (section.blocks || []).filter((block) => block.key !== blockKey)
  }));
  try {
    await saveVisualSections(sections, "Element deleted.", { type: "section", key: found.section.key });
  } catch (error) {
    setStatus(error.message || "Unable to delete element.", true);
  }
}

export function startVisualInlineEdit(blockKey) {
  const found = blockByKey(blockKey);
  const blockElement = Array.from(document.querySelectorAll?.("[data-visual-block]") || [])
    .find((element) => element.dataset.blockKey === blockKey);
  const surface = blockElement?.querySelector?.("[data-visual-edit-surface]");
  const editor = found?.block.type === "TEXT" ? surface?.querySelector?.("p") : surface?.querySelector?.(".block-rich");
  if (!found || !editor || !["TEXT", "RICH_TEXT"].includes(found.block.type)) return;

  state.visualEditorEditingBlockKey = blockKey;
  selectVisualEditorItem(blockElement);
  blockElement.classList.add("visual-inline-editing");
  editor.setAttribute("contenteditable", "true");
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", found.block.type === "RICH_TEXT" ? "true" : "false");
  editor.dataset.visualInlineEditor = "true";
  blockElement.querySelector?.("[data-visual-inline-default]")?.setAttribute("hidden", "");
  blockElement.querySelector?.("[data-visual-inline-actions]")?.removeAttribute("hidden");
  editor.focus();
}

export function cancelVisualInlineEdit() {
  state.visualEditorEditingBlockKey = "";
  if (state.page) renderPage(state.page);
}

export async function saveVisualInlineEdit(blockKey = state.visualEditorEditingBlockKey) {
  const found = blockByKey(blockKey);
  const blockElement = Array.from(document.querySelectorAll?.("[data-visual-block]") || [])
    .find((element) => element.dataset.blockKey === blockKey);
  const editor = blockElement?.querySelector?.("[data-visual-inline-editor]");
  if (!found || !editor) return;

  const value = found.block.type === "TEXT" ? editor.textContent.trim() : editor.innerHTML.trim();
  const previous = copyBuilderSections(state.page.sections || []);
  try {
    setStatus("Saving text...");
    const { page } = await api(`/cms/pages/${encodeURIComponent(state.page.slug)}/blocks/${encodeURIComponent(blockKey)}?${localeQuery()}`, {
      method: "PATCH",
      body: JSON.stringify({ value })
    });
    recordHistory(previous);
    state.page = page;
    state.visualEditorEditingBlockKey = "";
    state.visualEditorSelection = { type: "block", key: blockKey };
    renderPage(page);
    setStatus("Text saved.");
  } catch (error) {
    setStatus(error.message || "Unable to save text.", true);
  }
}

async function createVisualTemplate(type, name, content) {
  const values = await getModalFormHandler()({
    label: type === "PAGE" ? "Reusable page" : "Reusable section",
    title: type === "PAGE" ? "Save page as template" : "Save section to library",
    fields: [
      { name: "name", label: "Template name", value: name },
      { name: "description", label: "Description", type: "textarea", rows: 2, value: "", required: false }
    ],
    submitLabel: "Save template"
  });
  if (!values) return null;

  const { template } = await api("/cms/templates", {
    method: "POST",
    body: JSON.stringify({
      type,
      name: values.name,
      description: values.description || undefined,
      content
    })
  });
  state.cmsTemplates = [template, ...(state.cmsTemplates || []).filter((item) => item.id !== template.id)];
  return template;
}

export async function saveVisualSectionTemplate(sectionId) {
  const section = sectionById(sectionId);
  if (!section) return;

  try {
    const template = await createVisualTemplate("SECTION", section.label || "Reusable section", {
      section: sectionToBuilderInput(section)
    });
    if (template) {
      renderPage(state.page);
      setStatus(`${template.name} saved to reusable sections.`);
    }
  } catch (error) {
    setStatus(error.message || "Unable to save reusable section.", true);
  }
}

export async function saveVisualPageTemplate() {
  if (!state.page) return;

  try {
    const template = await createVisualTemplate("PAGE", `${state.page.title || "Page"} template`, {
      excerpt: state.page.excerpt || undefined,
      content: state.page.content || {},
      sections: normalizeBuilderSectionsForSave(state.page.sections || [])
    });
    if (template) {
      renderPage(state.page);
      setStatus(`${template.name} saved as a page template.`);
    }
  } catch (error) {
    setStatus(error.message || "Unable to save page template.", true);
  }
}

export async function insertVisualReusableTemplate(templateId) {
  const template = (state.cmsTemplates || []).find((item) => item.id === templateId && item.type === "SECTION");
  const section = instantiateBuilderSectionTemplate(template?.content?.section, state.page?.sections || []);
  if (!template || !section) return;

  try {
    await saveVisualSections(
      [...(state.page.sections || []), section],
      `${template.name} added.`,
      { type: "section", key: section.key }
    );
  } catch (error) {
    setStatus(error.message || "Unable to insert reusable section.", true);
  }
}

export async function deleteVisualReusableTemplate(templateId) {
  const template = (state.cmsTemplates || []).find((item) => item.id === templateId);
  if (!template) return;
  const confirmation = await getModalFormHandler()({
    label: "Reusable template",
    title: `Delete ${template.name}?`,
    description: "Existing pages keep their content.",
    fields: [],
    submitLabel: "Delete template",
    destructive: true
  });
  if (!confirmation) return;

  try {
    await api(`/cms/templates/${encodeURIComponent(template.id)}`, { method: "DELETE" });
    state.cmsTemplates = (state.cmsTemplates || []).filter((item) => item.id !== template.id);
    renderPage(state.page);
    setStatus(`${template.name} deleted from the library.`);
  } catch (error) {
    setStatus(error.message || "Unable to delete reusable template.", true);
  }
}

export async function undoVisualEditorChange() {
  if (!state.page) return;
  ensureVisualHistory();
  const previous = state.visualEditorUndoStack.pop();
  if (!previous) return;
  const current = copyBuilderSections(state.page.sections || []);
  pushHistory(state.visualEditorRedoStack, current);

  try {
    await saveVisualSections(previous, "Last visual change undone.", null, { recordHistory: false });
  } catch (error) {
    state.visualEditorRedoStack.pop();
    pushHistory(state.visualEditorUndoStack, previous);
    setStatus(error.message || "Unable to undo the last change.", true);
  }
}

export async function redoVisualEditorChange() {
  if (!state.page) return;
  ensureVisualHistory();
  const next = state.visualEditorRedoStack.pop();
  if (!next) return;
  const current = copyBuilderSections(state.page.sections || []);
  pushHistory(state.visualEditorUndoStack, current);

  try {
    await saveVisualSections(next, "Visual change redone.", null, { recordHistory: false });
  } catch (error) {
    state.visualEditorUndoStack.pop();
    pushHistory(state.visualEditorRedoStack, next);
    setStatus(error.message || "Unable to redo the change.", true);
  }
}

export function setVisualEditorDevice(device) {
  if (!["desktop", "tablet", "mobile"].includes(device)) return;
  state.visualEditorDevice = device;
  document.body.dataset.visualDevice = device;
  document.querySelectorAll?.("button[data-visual-device]").forEach((button) => {
    const active = button.dataset.visualDevice === device;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

export function handleVisualEditorKeydown(event) {
  if (!state.visualEditorActive) return false;
  const key = String(event.key || "").toLowerCase();

  if (state.visualEditorEditingBlockKey) {
    if (key === "escape") {
      event.preventDefault();
      cancelVisualInlineEdit();
      return true;
    }
    if ((event.metaKey || event.ctrlKey) && key === "s") {
      event.preventDefault();
      void saveVisualInlineEdit();
      return true;
    }
    return false;
  }

  if (key === "escape") {
    const openMenus = Array.from(document.querySelectorAll?.(".visual-command-menu[open]") || []);
    if (openMenus.length) {
      event.preventDefault();
      openMenus.forEach((menu) => menu.removeAttribute("open"));
      return true;
    }
  }

  if ((!event.metaKey && !event.ctrlKey) || event.target?.closest?.("input, textarea, select, [contenteditable='true']")) {
    return false;
  }
  if (key === "z") {
    event.preventDefault();
    if (event.shiftKey) void redoVisualEditorChange();
    else void undoVisualEditorChange();
    return true;
  }
  if (key === "y") {
    event.preventDefault();
    void redoVisualEditorChange();
    return true;
  }

  return false;
}
