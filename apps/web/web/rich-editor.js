const commandMap = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strikeThrough: "strikeThrough",
  insertOrderedList: "insertOrderedList",
  insertUnorderedList: "insertUnorderedList"
};

function syncEditor(editor, html) {
  const source = editor.querySelector("[data-rich-source]");
  if (source) source.value = html;
}

function safeEditorUrl(value = "") {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("/") || url.startsWith("#") || url.startsWith("mailto:") || url.startsWith("tel:")) {
    return url;
  }

  return "";
}

function runEditorCommand(editor, command, value = null) {
  const surface = editor.querySelector("[data-rich-surface]");
  if (!surface || typeof document.execCommand !== "function") return;

  surface.focus();
  document.execCommand(command, false, value);
  syncEditor(editor, surface.innerHTML);
}

function cleanEditor(editor) {
  runEditorCommand(editor, "removeFormat");
  runEditorCommand(editor, "unlink");
}

function formatBlock(editor, blockName) {
  runEditorCommand(editor, "formatBlock", blockName || "p");
}

function applyAlignment(editor, value) {
  const command = value === "center" ? "justifyCenter" : value === "right" ? "justifyRight" : "justifyLeft";
  runEditorCommand(editor, command);
}

function applyLink(editor) {
  const input = editor.querySelector("[data-rich-link-url]");
  const url = safeEditorUrl(input?.value);

  if (!url) {
    runEditorCommand(editor, "unlink");
    return;
  }

  runEditorCommand(editor, "createLink", url);
}

function bindRichEditor(editor) {
  const surface = editor.querySelector("[data-rich-surface]");
  if (!surface) return;

  surface.contentEditable = "true";
  surface.setAttribute("role", "textbox");
  surface.setAttribute("aria-multiline", "true");

  surface.addEventListener("input", () => {
    syncEditor(editor, surface.innerHTML);
    surface.removeAttribute("aria-invalid");
    const message = editor.querySelector("[data-rich-required-message]");
    if (message) message.hidden = true;
  });
  surface.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain");
    if (!text || typeof document.execCommand !== "function") return;

    event.preventDefault();
    document.execCommand("insertText", false, text);
    syncEditor(editor, surface.innerHTML);
  });

  editor.querySelector("[data-rich-toolbar]")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rich-command]");
    if (!button) return;

    event.preventDefault();
    const command = button.dataset.richCommand;
    if (command === "createLink") applyLink(editor);
    else if (command === "blockquote") formatBlock(editor, "blockquote");
    else if (command === "removeFormat") cleanEditor(editor);
    else if (commandMap[command]) runEditorCommand(editor, commandMap[command]);
  });

  editor.querySelector("[data-rich-block]")?.addEventListener("change", (event) => {
    formatBlock(editor, event.target.value);
  });
  editor.querySelector("[data-rich-align]")?.addEventListener("change", (event) => {
    applyAlignment(editor, event.target.value);
  });

  syncEditor(editor, surface.innerHTML);
}

export function hydrateRichEditors(root = document) {
  if (!root.querySelectorAll) return;

  const editors = Array.from(root.querySelectorAll("[data-rich-editor]:not([data-rich-ready])"));
  editors.forEach((editor) => {
    editor.dataset.richReady = "true";
    bindRichEditor(editor);
  });
}

export function syncRichEditors(root = document) {
  if (!root.querySelectorAll) return;

  root.querySelectorAll("[data-rich-editor]").forEach((editor) => {
    const surface = editor.querySelector("[data-rich-surface]");
    syncEditor(editor, surface?.innerHTML || "");
  });
}
