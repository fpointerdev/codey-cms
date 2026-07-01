import {
  availableSectionPatterns,
  availableComponentTemplates,
  escapeHtml,
  layoutOptionHtml,
  normalizePageLayout,
  setStatus,
  state
} from "./core.js";
import { adminHref, publicPageHref } from "./routes.js";
import { renderBlock, renderRichText } from "./public-renderer.js";
import { renderAdminShell, renderFormMessage } from "./ui.js";
import { hydrateRichEditors } from "./rich-editor.js";
import { styleAttribute } from "./custom-css.js";

function statusOptionHtml(value = "DRAFT") {
  return ["DRAFT", "PUBLISHED", "ARCHIVED"]
    .map((status) => `<option value="${status}"${status === value ? " selected" : ""}>${status}</option>`)
    .join("");
}

function templateIcon(templateId) {
  const icons = {
    slider: "SL",
    gallery: "GL",
    "hero-creative": "HR",
    "stats-grid": "ST",
    "feature-cards": "FC",
    "team-section": "TM",
    "logo-grid": "LG",
    testimonials: "QT",
    "pricing-cards": "PR",
    "faq-accordion": "FQ",
    tabs: "TB",
    accordion: "AC",
    "text-layout": "TX",
    "image-text": "IM",
    cta: "CT",
    "contact-form": "FM",
    "product-list": "PR"
  };

  return icons[templateId] || "EL";
}

function patternIcon(patternId) {
  const icons = {
    "hero-proof": "HP",
    "split-hero": "SH",
    "service-showcase": "SS",
    "media-band": "MB",
    "process-tabs": "PT",
    "portfolio-gallery": "PG",
    "pricing-trust": "PR",
    "faq-contact": "FC"
  };

  return icons[patternId] || "SC";
}

function builderShellClass() {
  return `builder-shell${state.builderRailCollapsed ? " builder-shell-collapsed" : ""}`;
}

function enabledLocales() {
  const locales = Array.isArray(state.config?.localization?.locales) ? state.config.localization.locales : [];

  return locales
    .filter((locale) => locale?.enabled !== false && locale?.code)
    .map((locale) => ({
      code: String(locale.code).toLowerCase(),
      label: locale.label || String(locale.code).toUpperCase()
    }));
}

function currentLocaleForContent(content) {
  return String(content?.locale || state.config?.localization?.defaultLocale || "en").toLowerCase();
}

function renderTranslationPanel(kind, content) {
  const locales = enabledLocales();
  if (locales.length < 2 || !content?.slug) return "";

  const currentLocale = currentLocaleForContent(content);
  const actionAttribute = kind === "page" ? "data-open-page-translation" : "data-open-post-translation";
  const linkAttribute = kind === "page" ? "data-link-page-translation" : "data-link-post-translation";
  const translationGroup = content.translationGroupId || content.slug;

  return `
    <section class="builder-card translation-panel">
      <div>
        <p class="section-label">Languages</p>
        <h2>Translations</h2>
        <p class="dashboard-copy compact">Open an existing language version or create a linked draft from this content.</p>
      </div>
      <div class="translation-editor-actions">
        <span class="status-pill success">Current: ${escapeHtml(currentLocale.toUpperCase())}</span>
        ${locales
          .filter((locale) => locale.code !== currentLocale)
          .map(
            (locale) => `
              <button
                type="button"
                class="secondary-button"
                ${actionAttribute}="${escapeHtml(content.slug)}"
                data-source-locale="${escapeHtml(currentLocale)}"
                data-source-title="${escapeHtml(content.title || "")}"
                data-target-locale="${escapeHtml(locale.code)}"
                data-translation-group="${escapeHtml(translationGroup)}"
              >
                Add / edit ${escapeHtml(locale.label)}
              </button>
            `
          )
          .join("")}
        <button
          type="button"
          class="secondary-button"
          ${linkAttribute}="${escapeHtml(content.slug)}"
          data-source-locale="${escapeHtml(currentLocale)}"
          data-source-title="${escapeHtml(content.title || "")}"
          data-translation-group="${escapeHtml(translationGroup)}"
        >
          Link existing
        </button>
      </div>
    </section>
  `;
}

function renderSlugField(slug = "") {
  return `
    <label class="slug-field" data-slug-field>
      <span>Slug</span>
      <div class="slug-edit-row">
        <input name="slug" value="${escapeHtml(slug)}" readonly data-editable-slug />
        <button type="button" class="secondary-button" data-edit-slug>Edit slug</button>
      </div>
      <small class="field-help">Generated from the title. Unlock only when the URL must change.</small>
    </label>
  `;
}

function localizedPublicPageHref(page) {
  const locale = currentLocaleForContent(page);
  const defaultLocale = String(state.config?.localization?.defaultLocale || "en").toLowerCase();
  const href = publicPageHref(page.slug);

  if (!locale || locale === defaultLocale) return href;
  if (href === "/") return `/${encodeURIComponent(locale)}`;

  return `/${encodeURIComponent(locale)}${href}`;
}

function renderBuilderLibrary({ action = "builder", selectedTemplateId = "" } = {}) {
  const attribute =
    action === "select"
      ? "data-select-template"
      : action === "post"
        ? "data-post-template"
        : "data-builder-template";
  const collapsed = state.builderRailCollapsed;
  const sectionPatterns = action === "builder" ? availableSectionPatterns() : [];

  return `
    <aside class="builder-rail${collapsed ? " collapsed" : ""}" data-builder-rail>
      <button
        type="button"
        class="builder-rail-toggle"
        data-toggle-builder-rail
        aria-expanded="${collapsed ? "false" : "true"}"
      >
        ${collapsed ? "Elements" : "Collapse"}
      </button>
      <div class="builder-rail-content">
        <div class="builder-rail-header">
          <p class="section-label">Builder library</p>
          <h2>Sections & elements</h2>
          <p class="builder-help">Start with a section pattern, then refine individual elements.</p>
        </div>
        ${
          sectionPatterns.length
            ? `<div class="builder-library-group">
                <p class="builder-library-label">Reusable sections</p>
                <div class="builder-pattern-list">
                  ${sectionPatterns
                    .map(
                      (pattern) => `
                        <button
                          type="button"
                          class="builder-template builder-pattern"
                          draggable="true"
                          data-builder-section-pattern="${escapeHtml(pattern.id)}"
                        >
                          <span class="builder-pattern-card-top">
                            <span class="builder-template-icon" aria-hidden="true">${escapeHtml(patternIcon(pattern.id))}</span>
                            ${builderSectionLayoutPreview({ settings: pattern.settings || {} })}
                          </span>
                          <strong>${escapeHtml(pattern.label)}</strong>
                          <small>${escapeHtml(pattern.category || "Section")}</small>
                          <span>${escapeHtml(pattern.description)}</span>
                        </button>
                      `
                    )
                    .join("")}
                </div>
              </div>`
            : ""
        }
        <div class="builder-library-group">
          <p class="builder-library-label">Elements</p>
        <div class="builder-template-list">
          ${availableComponentTemplates()
            .map(
              (template) => `
                <button
                  type="button"
                  class="builder-template ${template.id === selectedTemplateId ? "active" : ""}"
                  draggable="true"
                  ${attribute}="${escapeHtml(template.id)}"
                  data-template-id="${escapeHtml(template.id)}"
                >
                  <span class="builder-template-icon" aria-hidden="true">${escapeHtml(templateIcon(template.id))}</span>
                  <strong>${escapeHtml(template.label)}</strong>
                  <span>${escapeHtml(template.description)}</span>
                </button>
              `
            )
            .join("")}
        </div>
        </div>
      </div>
    </aside>
  `;
}

export function renderRichTextEditor(name, value = "", label = "Rich text") {
  return `
    <div class="rich-editor" data-rich-editor>
      <div class="rich-editor-header">
        <span>${escapeHtml(label)}</span>
        <div class="rich-toolbar" data-rich-toolbar aria-label="${escapeHtml(label)} toolbar">
          <span class="rich-format-group">
            <select data-rich-block aria-label="Text style">
              <option value="">Paragraph</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
              <option value="h4">Heading 4</option>
            </select>
          </span>
          <span class="rich-format-group">
            <button type="button" class="rich-tool-button" data-rich-command="bold" aria-label="Bold"><strong>B</strong></button>
            <button type="button" class="rich-tool-button" data-rich-command="italic" aria-label="Italic"><em>I</em></button>
            <button type="button" class="rich-tool-button" data-rich-command="underline" aria-label="Underline"><u>U</u></button>
            <button type="button" class="rich-tool-button" data-rich-command="strikeThrough" aria-label="Strikethrough"><s>S</s></button>
          </span>
          <span class="rich-format-group">
            <button type="button" class="rich-tool-button" data-rich-command="insertOrderedList" aria-label="Ordered list">1.</button>
            <button type="button" class="rich-tool-button" data-rich-command="insertUnorderedList" aria-label="Bullet list">UL</button>
            <select data-rich-align aria-label="Text alignment">
              <option value="">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </span>
          <span class="rich-format-group rich-link-group">
            <button type="button" class="rich-tool-button" data-rich-command="blockquote" aria-label="Quote">Quote</button>
            <input type="url" data-rich-link-url placeholder="https://..." aria-label="Link URL" />
            <button type="button" class="rich-tool-button" data-rich-command="createLink" aria-label="Apply link">Link</button>
            <button type="button" class="rich-tool-button" data-rich-command="removeFormat" aria-label="Clear formatting">Clear</button>
          </span>
        </div>
      </div>
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" data-rich-source />
      <div class="rich-editor-surface" data-rich-surface>${renderRichText(value || "<p>Start writing content...</p>")}</div>
    </div>
  `;
}

export function renderCreatePagePage() {
  renderAdminShell(
    { view: "pages" },
    `
      <form class="builder-create" data-page-create-form>
        <main class="builder-main">
          <section class="builder-topbar">
            <div>
              <p class="section-label">New page</p>
              <h1 class="dashboard-title">Create Page</h1>
              <p class="dashboard-copy">Create the page shell first. Containers and elements are added in the builder.</p>
            </div>
            <div class="button-row">
              <a class="secondary-button" href="/dashboard/pages" data-dashboard-link>Cancel</a>
              <button type="submit">Create page</button>
            </div>
          </section>
          <section class="builder-card">
            <div class="builder-form-grid">
              <label><span>Title</span><input name="title" value="New page" required /></label>
              <label><span>Status</span><select name="status">${statusOptionHtml("DRAFT")}</select></label>
              <label><span>Page layout</span><select name="layout">${layoutOptionHtml("full-width")}</select></label>
            </div>
            <p class="field-help slug-create-help">The slug is generated automatically from the title after the page is created.</p>
            <label><span>Excerpt</span><textarea name="excerpt" rows="3"></textarea></label>
            <div class="builder-form-grid">
              <label class="checkbox-field"><input name="addToMenu" type="checkbox" checked /><span>Add to main navigation</span></label>
              <label><span>Navigation label</span><input name="menuLabel" value="New page" /></label>
            </div>
            ${renderFormMessage()}
          </section>
        </main>
      </form>
    `
  );
  setStatus("Create page editor loaded.");
}

function renderBuilderBlock(block) {
  return `
    <article class="builder-block" data-builder-block-key="${escapeHtml(block.key)}" draggable="true">
      <header>
        <div><strong>${escapeHtml(block.label || block.key)}</strong><span>${escapeHtml(block.type.replace("_", " "))}</span></div>
        <span class="builder-drag-handle" aria-hidden="true">Drag</span>
        ${block.editable ? '<button type="button" class="secondary-button" data-builder-edit-block>Edit</button>' : ""}
      </header>
      <div class="builder-block-preview"${styleAttribute(block.settings?.customCss)}>${renderBlock(block)}</div>
    </article>
  `;
}

function builderSectionLayoutClasses(section) {
  const settings = section.settings || {};
  const responsive = settings.responsive || {};
  const tablet = responsive.tablet || {};
  const mobile = responsive.mobile || {};

  return [
    `layout-${settings.layout || "one-column"}`,
    `gap-${settings.gap || "md"}`,
    `tablet-layout-${tablet.layout || "inherit"}`,
    `mobile-layout-${mobile.layout || "one-column"}`
  ].join(" ");
}

function layoutTitle(layout) {
  const titles = {
    inherit: "Inherit",
    "one-column": "1 column",
    "two-column": "2 columns",
    "three-column": "3 columns",
    "four-column": "4 columns",
    "full-bleed": "Full width",
    asymmetric: "Asymmetric"
  };

  return titles[layout] || "1 column";
}

function builderSectionLayoutLabel(section) {
  const settings = section.settings || {};
  const responsive = settings.responsive || {};
  const tabletLayout = responsive.tablet?.layout || "inherit";
  const mobileLayout = responsive.mobile?.layout || "one-column";

  return `Tablet ${layoutTitle(tabletLayout)} · Mobile ${layoutTitle(mobileLayout)}`;
}

function builderSectionLayoutPreview(section) {
  const layout = section.settings?.layout || "one-column";

  return `
    <span class="builder-layout-preview builder-layout-preview-${escapeHtml(layout)}" aria-hidden="true">
      <i></i><i></i><i></i><i></i>
    </span>
  `;
}

function renderBuilderSections(page) {
  if (!page.sections?.length) {
    return '<div class="builder-empty"><strong>No containers yet</strong><span>Drag a reusable section or element here, or add a container first.</span></div>';
  }

  const activeSectionId = state.activeBuilderSectionId || page.sections[0]?.id;

  return page.sections
    .map(
      (section) => `
        <article class="builder-section-card ${section.id === activeSectionId ? "active" : ""}" data-builder-section="${escapeHtml(section.id)}" draggable="true"${styleAttribute(section.settings?.customCss)}>
          <header>
            <div><p class="section-label">Container</p><h3>${escapeHtml(section.label || section.key)}</h3></div>
            <div class="builder-section-actions">
              <span class="builder-drag-handle" aria-hidden="true">Drag</span>
              <button type="button" class="secondary-button builder-layout-pill" data-select-builder-section>
                ${builderSectionLayoutPreview(section)}
                <span>
                  <strong>${escapeHtml(layoutTitle(section.settings?.layout || "one-column"))}</strong>
                  <small>${escapeHtml(builderSectionLayoutLabel(section))}</small>
                </span>
              </button>
              <button type="button" class="secondary-button" data-add-element-to-section="${escapeHtml(section.id)}">Add element</button>
              <button type="button" class="secondary-button" data-edit-builder-section>Settings</button>
            </div>
          </header>
          <div class="builder-block-list ${escapeHtml(builderSectionLayoutClasses(section))}" data-builder-dropzone data-section-id="${escapeHtml(section.id)}">
            ${(section.blocks || []).length ? (section.blocks || []).map(renderBuilderBlock).join("") : '<div class="builder-empty small"><strong>Empty container</strong><span>Click an element from the left library or drop it here.</span></div>'}
          </div>
        </article>
      `
    )
    .join("");
}

function formatRevisionDate(value) {
  if (!value) return "Unknown time";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function revisionSnapshotTitle(revision) {
  const snapshotTitle = revision?.snapshot?.page?.title;
  return typeof snapshotTitle === "string" && snapshotTitle.trim() ? snapshotTitle : "Untitled page";
}

function renderRevisionComparison() {
  const comparison = state.builderRevisionComparison;
  if (!comparison) return "";

  const fields = comparison.changedFields?.length
    ? comparison.changedFields.map((field) => `<span class="revision-field">${escapeHtml(field)}</span>`).join("")
    : '<span class="revision-field muted">No visible differences</span>';

  return `
    <div class="revision-compare">
      <div>
        <p class="section-label">Compared version</p>
        <strong>Version ${escapeHtml(comparison.version || "")}</strong>
        <span>${escapeHtml(comparison.action || "revision")}</span>
      </div>
      <div class="revision-fields">${fields}</div>
    </div>
  `;
}

function renderRevisionPanel(page) {
  const revisions = state.builderRevisionSlug === page.slug ? state.builderPageRevisions || [] : [];

  return `
    <section class="builder-card revision-panel">
      <div class="builder-card-heading">
        <div>
          <p class="section-label">Version history</p>
          <h2>Revisions</h2>
        </div>
        <button type="button" class="secondary-button" data-load-page-revisions>Refresh history</button>
      </div>
      ${renderRevisionComparison()}
      ${
        revisions.length
          ? `<div class="revision-list">
              ${revisions
                .map(
                  (revision) => `
                    <article class="revision-item">
                      <div>
                        <strong>Version ${escapeHtml(revision.version || "")}</strong>
                        <span>${escapeHtml(revision.action || "change")} · ${escapeHtml(formatRevisionDate(revision.createdAt))}</span>
                        <small>${escapeHtml(revisionSnapshotTitle(revision))}</small>
                      </div>
                      <div class="revision-actions">
                        <button type="button" class="secondary-button" data-compare-page-revision="${escapeHtml(revision.id)}">Compare</button>
                        <button type="button" class="secondary-button danger" data-restore-page-revision="${escapeHtml(revision.id)}" data-revision-version="${escapeHtml(revision.version || "")}">Restore</button>
                      </div>
                    </article>
                  `
                )
                .join("")}
            </div>`
          : '<p class="dashboard-copy compact">Load the revision history to compare previous saves or restore an older version of this page.</p>'
      }
    </section>
  `;
}

function renderPageSettingsForm(page, layout) {
  return `
    <form id="builder-page-settings-form" class="builder-card builder-settings-form" data-page-builder-settings data-page-slug="${escapeHtml(page.slug)}">
      <div class="builder-card-heading">
        <div>
          <p class="section-label">Page settings</p>
          <h2>Publishing details</h2>
        </div>
        <span class="status-pill">${escapeHtml(page.status || "DRAFT")}</span>
      </div>
      <div class="builder-form-grid">
        <label><span>Title</span><input name="title" value="${escapeHtml(page.title || "")}" required /></label>
        ${renderSlugField(page.slug || "")}
        <label><span>Status</span><select name="status">${statusOptionHtml(page.status || "DRAFT")}</select></label>
        <label><span>Page layout</span><select name="layout">${layoutOptionHtml(layout)}</select></label>
      </div>
      <label><span>Excerpt</span><textarea name="excerpt" rows="3">${escapeHtml(page.excerpt || "")}</textarea></label>
      ${renderFormMessage()}
    </form>
  `;
}

function renderBuilderStickyHeader(page, layout) {
  const locale = currentLocaleForContent(page).toUpperCase();

  return `
    <section class="builder-sticky-header">
      <div class="builder-sticky-summary">
        <div>
          <p class="section-label">Page builder</p>
          <h1 class="dashboard-title">${escapeHtml(page.title || "Untitled page")}</h1>
        </div>
        <span class="status-pill success">${escapeHtml(locale)}</span>
      </div>
      <div class="builder-sticky-actions">
        <a class="secondary-button" href="/dashboard/pages" data-dashboard-link>Pages</a>
        <a class="secondary-button" href="${escapeHtml(localizedPublicPageHref(page))}">Frontend editor</a>
        <button type="submit" form="builder-page-settings-form">Save</button>
        <details class="builder-sticky-details">
          <summary class="secondary-button builder-details-toggle">Details</summary>
          <div class="builder-details-panel">
            ${renderTranslationPanel("page", page)}
            ${renderPageSettingsForm(page, layout)}
          </div>
        </details>
      </div>
    </section>
  `;
}

function renderBuilderCanvasTools() {
  return `
    <section class="builder-canvas-tools">
      <div>
        <p class="section-label">Canvas</p>
        <h2>Containers</h2>
      </div>
      <div class="button-row">
        <button type="button" data-add-container>Add container</button>
        <button type="button" class="secondary-button" data-load-page-revisions>Revisions</button>
      </div>
    </section>
  `;
}

export function renderPageBuilderPage(page, message = "") {
  if (state.builderRevisionSlug !== page.slug) {
    state.builderPageRevisions = [];
    state.builderRevisionComparison = null;
    state.builderRevisionSlug = "";
  }

  state.builderPage = page;
  if (!state.activeBuilderSectionId || !page.sections?.some((section) => section.id === state.activeBuilderSectionId)) {
    state.activeBuilderSectionId = page.sections?.[0]?.id || null;
  }
  const layout = normalizePageLayout(page.content?.layout);

  renderAdminShell(
    { view: "page-builder", slug: page.slug || "" },
    `
      <section class="${builderShellClass()}" data-page-builder data-builder-page-slug="${escapeHtml(page.slug)}">
        ${renderBuilderLibrary({ action: "builder" })}
        <main class="builder-main">
          ${renderBuilderStickyHeader(page, layout)}
          ${message ? `<p class="form-message">${escapeHtml(message)}</p>` : ""}
          ${renderBuilderCanvasTools()}
          ${renderRevisionPanel(page)}
          <section class="builder-canvas page-layout-${escapeHtml(layout)}" data-builder-canvas-dropzone>
            ${renderBuilderSections(page)}
          </section>
        </main>
      </section>
    `
  );
  setStatus(message || "Page builder loaded.");
  hydrateRichEditors();
}

function postBody(post) {
  return typeof post?.content?.body === "string" ? post.content.body : "";
}

export function renderPostEditorPage(post = null, message = "") {
  state.builderPost = post;
  const isNew = !post;
  const content = post?.content || {};
  const layout = normalizePageLayout(content.layout);

  renderAdminShell(
    { view: isNew ? "post-create" : "post-builder", slug: post?.slug || "" },
    `
      <form class="${builderShellClass()}" data-post-editor-form data-post-slug="${escapeHtml(post?.slug || "")}">
        ${renderBuilderLibrary({ action: "post" })}
        <main class="builder-main">
          <section class="builder-topbar">
            <div><p class="section-label">${isNew ? "New post" : "Post editor"}</p><h1 class="dashboard-title">${escapeHtml(post?.title || "Create Post")}</h1><p class="dashboard-copy">Write the article body and keep the publishing metadata in the same editor.</p></div>
            <div class="button-row"><a class="secondary-button" href="/dashboard/posts" data-dashboard-link>Posts</a><button type="submit">${isNew ? "Create post" : "Save post"}</button></div>
          </section>
          ${message ? `<p class="form-message">${escapeHtml(message)}</p>` : ""}
          ${!isNew ? renderTranslationPanel("post", post) : ""}
          <section class="builder-card">
            <div class="builder-form-grid">
              <label><span>Title</span><input name="title" value="${escapeHtml(post?.title || "New post")}" required /></label>
              ${isNew ? '<p class="field-help slug-create-help">The slug is generated automatically from the title after the post is created.</p>' : renderSlugField(post?.slug || "")}
              <label><span>Status</span><select name="status">${statusOptionHtml(post?.status || "DRAFT")}</select></label>
              <label><span>Article layout</span><select name="layout">${layoutOptionHtml(layout)}</select></label>
            </div>
            <label><span>Excerpt</span><textarea name="excerpt" rows="3">${escapeHtml(post?.excerpt || "")}</textarea></label>
            <label><span>Tags</span><input name="tags" value="${escapeHtml((post?.tags || []).join(", "))}" placeholder="fabrication, updates" /></label>
          </section>
          <section class="builder-card">
            ${renderRichTextEditor("body", postBody(post) || "Write the article content.", "Article body")}
            ${renderFormMessage()}
          </section>
        </main>
      </form>
    `
  );
  setStatus(message || `${isNew ? "Create post" : "Post editor"} loaded.`);
  hydrateRichEditors();
}

export function refreshRichPreview(editor) {
  const source = editor?.querySelector?.("[data-rich-source]");
  const preview = editor?.querySelector?.("[data-rich-preview]");
  if (!source || !preview) return;

  preview.innerHTML = renderRichText(source.value || "Start writing content...");
}

export function insertIntoTextarea(textarea, value, wrap = "") {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const selected = textarea.value.slice(start, end);
  const insertion = wrap ? `${wrap}${selected || "text"}${wrap}` : value;

  textarea.value = `${textarea.value.slice(0, start)}${insertion}${textarea.value.slice(end)}`;
  textarea.focus();
  const cursor = start + insertion.length;
  textarea.setSelectionRange?.(cursor, cursor);
}

export function richTextSnippetForTemplate(templateId) {
  const template = availableComponentTemplates().find((item) => item.id === templateId);
  if (!template) return "";

  return template.blocks
    .map((block) => {
      if (block.type === "TEXT") return `## ${block.value || block.label || template.label}`;
      if (block.type === "RICH_TEXT") return String(block.value || "");
      if (block.type === "CTA") return `[${block.value?.label || "Call to action"}](${block.value?.url || "/"})`;
      if (block.type === "IMAGE") return `Image: ${block.value?.url || ""}`;
      return block.label || template.label;
    })
    .filter(Boolean)
    .join("\n\n");
}
