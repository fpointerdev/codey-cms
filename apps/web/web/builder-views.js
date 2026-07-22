import {
  availableSectionPatterns,
  availableComponentTemplates,
  elements,
  escapeHtml,
  hasPermission,
  layoutOptionHtml,
  normalizePageLayout,
  setStatus,
  state
} from "./core.js";
import { adminHref, publicPageHref } from "./routes.js";
import { renderBlock, renderFooter, renderMenuItems, renderPageContent, renderRichText } from "./public-renderer.js";
import { renderAdminShell, renderFormMessage } from "./ui.js";
import { designSystemCss } from "./design-system.js";
import { hydrateRichEditors } from "./rich-editor.js";
import { sanitizeStylesheet, styleAttribute } from "./custom-css.js";

function statusOptionHtml(value = "DRAFT") {
  return ["DRAFT", "PUBLISHED", "ARCHIVED"]
    .map((status) => `<option value="${status}"${status === value ? " selected" : ""}>${status}</option>`)
    .join("");
}

function templateIcon(templateId) {
  const icons = {
    slider: "SL",
    carousel: "CR",
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

function templateCategory(templateId) {
  const categories = {
    slider: "media",
    carousel: "media",
    gallery: "media",
    "image-text": "media",
    "pricing-cards": "commerce",
    "product-list": "commerce",
    "contact-form": "forms"
  };

  return categories[templateId] || "content";
}

function renderBuilderLibraryFilters(includeSections, includeReusable = false) {
  const filters = [
    ["all", "All"],
    ...(includeReusable ? [["saved", "Saved"]] : []),
    ...(includeSections ? [["sections", "Sections"]] : []),
    ["content", "Content"],
    ["media", "Media"],
    ["commerce", "Commerce"],
    ["forms", "Forms"]
  ];

  return `
    <div class="builder-library-controls">
      <label class="builder-library-search">
        <span class="visually-hidden">Search builder library</span>
        <input type="search" placeholder="Search sections and elements" autocomplete="off" data-builder-library-search />
      </label>
      <div class="builder-library-filters" role="group" aria-label="Filter builder library">
        ${filters
          .map(
            ([value, label], index) => `
              <button
                type="button"
                class="secondary-button${index === 0 ? " active" : ""}"
                data-builder-library-filter="${value}"
                aria-pressed="${index === 0 ? "true" : "false"}"
              >${label}</button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderBuilderStructure(page) {
  const sections = Array.isArray(page?.sections) ? page.sections : [];
  if (!sections.length) {
    return '<p class="builder-structure-empty">No containers yet. Add a section pattern or container to start the page.</p>';
  }

  return `
    <ol class="builder-structure-list">
      ${sections
        .map((section, sectionIndex) => {
          const blocks = Array.isArray(section.blocks) ? section.blocks : [];
          const sectionLabel = section.label || section.key;

          return `
            <li class="builder-structure-section${section.id === state.activeBuilderSectionId ? " active" : ""}" data-builder-structure-section-row="${escapeHtml(section.id)}">
              <div class="builder-structure-row">
                <button type="button" class="builder-structure-target" data-builder-structure-section="${escapeHtml(section.id)}">
                  <span class="builder-structure-index" aria-hidden="true">${sectionIndex + 1}</span>
                  <span><strong>${escapeHtml(sectionLabel)}</strong><small>${blocks.length} element${blocks.length === 1 ? "" : "s"}</small></span>
                </button>
                <span class="builder-structure-order" role="group" aria-label="Reorder ${escapeHtml(sectionLabel)}">
                  <button type="button" class="secondary-button builder-icon-button" data-builder-structure-move-section="up" data-builder-section-id="${escapeHtml(section.id)}" aria-label="Move ${escapeHtml(sectionLabel)} up" title="Move up"${sectionIndex === 0 ? " disabled" : ""}>&uarr;</button>
                  <button type="button" class="secondary-button builder-icon-button" data-builder-structure-move-section="down" data-builder-section-id="${escapeHtml(section.id)}" aria-label="Move ${escapeHtml(sectionLabel)} down" title="Move down"${sectionIndex === sections.length - 1 ? " disabled" : ""}>&darr;</button>
                </span>
              </div>
              ${blocks.length
                ? `<ol class="builder-structure-blocks">
                    ${blocks
                      .map((block, blockIndex) => {
                        const blockLabel = block.label || block.key;
                        const blockType = String(block.type || "element").replaceAll("_", " ").toLowerCase();

                        return `
                          <li class="builder-structure-block" data-builder-structure-block-row="${escapeHtml(block.key)}">
                            <div class="builder-structure-row">
                              <button type="button" class="builder-structure-target" data-builder-structure-block="${escapeHtml(block.key)}" data-builder-section-id="${escapeHtml(section.id)}">
                                <span class="builder-structure-line" aria-hidden="true"></span>
                                <span><strong>${escapeHtml(blockLabel)}</strong><small>${escapeHtml(blockType)}</small></span>
                              </button>
                              <span class="builder-structure-order" role="group" aria-label="Reorder ${escapeHtml(blockLabel)}">
                                <button type="button" class="secondary-button builder-icon-button" data-builder-structure-move-block="up" data-builder-structure-block-key="${escapeHtml(block.key)}" aria-label="Move ${escapeHtml(blockLabel)} up" title="Move up"${blockIndex === 0 ? " disabled" : ""}>&uarr;</button>
                                <button type="button" class="secondary-button builder-icon-button" data-builder-structure-move-block="down" data-builder-structure-block-key="${escapeHtml(block.key)}" aria-label="Move ${escapeHtml(blockLabel)} down" title="Move down"${blockIndex === blocks.length - 1 ? " disabled" : ""}>&darr;</button>
                              </span>
                            </div>
                          </li>
                        `;
                      })
                      .join("")}
                  </ol>`
                : '<p class="builder-structure-empty compact">Empty container</p>'}
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

function renderBuilderLibrary({ action = "builder", selectedTemplateId = "", page = null } = {}) {
  const attribute =
    action === "select"
      ? "data-select-template"
      : action === "post"
        ? "data-post-template"
        : "data-builder-template";
  const collapsed = state.builderRailCollapsed;
  const sectionPatterns = action === "builder" ? availableSectionPatterns() : [];
  const reusableSections = action === "builder"
    ? (state.cmsTemplates || []).filter((template) => template.type === "SECTION")
    : [];
  const templates = availableComponentTemplates();
  const railView = page && state.builderRailView === "structure" ? "structure" : "library";

  const libraryPanel = `
    <div class="builder-rail-panel" data-builder-rail-panel="library"${railView === "library" ? "" : " hidden"}>
      ${renderBuilderLibraryFilters(sectionPatterns.length > 0, reusableSections.length > 0)}
      ${
        reusableSections.length
          ? `<div class="builder-library-group" data-builder-library-group>
              <p class="builder-library-label">Reusable sections</p>
              <div class="builder-template-list builder-reusable-list">
                ${reusableSections
                  .map((template) => `
                    <div
                      class="builder-template builder-reusable-template"
                      draggable="true"
                      data-builder-reusable-drag="${escapeHtml(template.id)}"
                      data-builder-library-item
                      data-builder-library-category="saved"
                      data-builder-library-search-text="${escapeHtml(`${template.name} ${template.description || "reusable section"}`.toLowerCase())}"
                    >
                      <button type="button" class="builder-reusable-insert" data-builder-reusable-template="${escapeHtml(template.id)}">
                        <span class="builder-template-icon" aria-hidden="true">&#9638;</span>
                        <strong>${escapeHtml(template.name)}</strong>
                        <span>${escapeHtml(template.description || "Reusable section")}</span>
                      </button>
                      <span class="builder-reusable-actions">
                        ${hasPermission("update", "cms") ? `<button type="button" class="secondary-button compact" data-edit-reusable-template="${escapeHtml(template.id)}" aria-label="Rename ${escapeHtml(template.name)}">Rename</button>` : ""}
                        <button type="button" class="secondary-button compact" data-replace-reusable-template="${escapeHtml(template.id)}" aria-label="Replace ${escapeHtml(template.name)} from selected container" title="Replace from selected container">Replace</button>
                        ${hasPermission("delete", "cms") ? `<button type="button" class="secondary-button compact danger" data-delete-reusable-template="${escapeHtml(template.id)}" aria-label="Delete ${escapeHtml(template.name)}">Delete</button>` : ""}
                      </span>
                    </div>
                  `)
                  .join("")}
              </div>
            </div>`
          : ""
      }
      ${
        sectionPatterns.length
          ? `<div class="builder-library-group" data-builder-library-group>
              <p class="builder-library-label">Section patterns</p>
              <div class="builder-pattern-list">
                ${sectionPatterns
                  .map(
                    (pattern) => `
                      <button
                        type="button"
                        class="builder-template builder-pattern"
                        draggable="true"
                        data-builder-section-pattern="${escapeHtml(pattern.id)}"
                        data-builder-library-item
                        data-builder-library-category="sections"
                        data-builder-library-search-text="${escapeHtml(`${pattern.label} ${pattern.category || "section"} ${pattern.description}`.toLowerCase())}"
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
      <div class="builder-library-group" data-builder-library-group>
        <p class="builder-library-label">Elements</p>
        <div class="builder-template-list">
          ${templates
            .map((template) => {
              const category = templateCategory(template.id);

              return `
                <button
                  type="button"
                  class="builder-template ${template.id === selectedTemplateId ? "active" : ""}"
                  draggable="true"
                  ${attribute}="${escapeHtml(template.id)}"
                  data-template-id="${escapeHtml(template.id)}"
                  data-builder-library-item
                  data-builder-library-category="${escapeHtml(category)}"
                  data-builder-library-search-text="${escapeHtml(`${template.label} ${category} ${template.description}`.toLowerCase())}"
                >
                  <span class="builder-template-icon" aria-hidden="true">${escapeHtml(templateIcon(template.id))}</span>
                  <strong>${escapeHtml(template.label)}</strong>
                  <span>${escapeHtml(template.description)}</span>
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
      <p class="builder-library-empty" data-builder-library-empty hidden>No sections or elements match this search.</p>
    </div>
  `;

  return `
    <aside class="builder-rail${collapsed ? " collapsed" : ""}" data-builder-rail>
      <button
        type="button"
        class="builder-rail-toggle"
        data-toggle-builder-rail
        aria-expanded="${collapsed ? "false" : "true"}"
      >
        ${collapsed ? "Builder" : "Collapse"}
      </button>
      <div class="builder-rail-content">
        <div class="builder-rail-header">
          <p class="section-label">Builder library</p>
          <h2>Sections & elements</h2>
          <p class="builder-help">Start with a section pattern, then refine individual elements.</p>
        </div>
        ${page
          ? `<div class="builder-rail-views" role="group" aria-label="Builder panel">
              <button type="button" class="secondary-button${railView === "library" ? " active" : ""}" data-builder-rail-view="library" aria-pressed="${railView === "library"}">Add</button>
              <button type="button" class="secondary-button${railView === "structure" ? " active" : ""}" data-builder-rail-view="structure" aria-pressed="${railView === "structure"}">Structure</button>
            </div>`
          : ""}
        ${libraryPanel}
        ${page
          ? `<div class="builder-rail-panel" data-builder-rail-panel="structure"${railView === "structure" ? "" : " hidden"}>
              <div class="builder-structure-heading">
                <strong>Page structure</strong>
                <span>Select an item to locate it on the canvas.</span>
              </div>
              ${renderBuilderStructure(page)}
            </div>`
          : ""}
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

function renderPageTemplateManager(templates) {
  if (!templates.length) return "";

  return `
    <div class="builder-page-template-manager" data-page-template-manager>
      <div class="builder-page-template-heading">
        <strong>Saved page templates</strong>
        <span>Reusable structures available in the Start from menu.</span>
      </div>
      <div class="builder-page-template-list">
        ${templates.map((template) => `
          <div class="builder-page-template-row" data-page-template-row="${escapeHtml(template.id)}">
            <span class="builder-page-template-copy">
              <strong data-page-template-name>${escapeHtml(template.name)}</strong>
              <span data-page-template-description>${escapeHtml(template.description || "Reusable page structure")}</span>
            </span>
            <span class="builder-page-template-actions">
              ${hasPermission("update", "cms") ? `<button type="button" class="secondary-button compact" data-edit-reusable-template="${escapeHtml(template.id)}" aria-label="Rename ${escapeHtml(template.name)}">Rename</button>` : ""}
              ${hasPermission("delete", "cms") ? `<button type="button" class="secondary-button compact danger" data-delete-reusable-template="${escapeHtml(template.id)}" aria-label="Delete ${escapeHtml(template.name)}">Delete</button>` : ""}
            </span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

export function renderCreatePagePage() {
  const pageTemplates = (state.cmsTemplates || []).filter((template) => template.type === "PAGE");
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
              <label><span>Start from</span><select name="templateId" data-page-template-select data-page-template-default-layout="full-width" data-page-template-default-excerpt=""><option value="">Blank page</option>${pageTemplates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join("")}</select></label>
            </div>
            <p class="field-help slug-create-help">The slug is generated automatically from the title after the page is created.</p>
            <label><span>Excerpt</span><textarea name="excerpt" rows="3"></textarea></label>
            <div class="builder-form-grid">
              <label class="checkbox-field"><input name="addToMenu" type="checkbox" checked /><span>Add to main navigation</span></label>
              <label><span>Navigation label</span><input name="menuLabel" value="New page" /></label>
            </div>
            ${renderFormMessage()}
            ${renderPageTemplateManager(pageTemplates)}
          </section>
        </main>
      </form>
    `
  );
  setStatus("Create page editor loaded.");
}

function renderMoveToContainerControl(block, section, sections) {
  if (sections.length < 2) return "";

  return `
    <label class="builder-move-control">
      <span class="visually-hidden">Move ${escapeHtml(block.label || block.key)} to container</span>
      <select data-move-builder-block-section="${escapeHtml(block.key)}" aria-label="Move ${escapeHtml(block.label || block.key)} to container">
        ${sections
          .map((item) => `<option value="${escapeHtml(item.id)}"${item.id === section.id ? " selected" : ""}>${escapeHtml(item.label || item.key)}</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function renderBuilderBlock(block, index, blocks, section, sections) {
  return `
    <article class="builder-block" data-builder-block-key="${escapeHtml(block.key)}" tabindex="-1">
      <header>
        <div class="builder-block-heading"><strong>${escapeHtml(block.label || block.key)}</strong><span>${escapeHtml(block.type.replace("_", " "))}</span></div>
        <div class="builder-block-actions">
          <span class="builder-drag-handle" draggable="true" aria-hidden="true">Drag</span>
          <span class="builder-order-controls" role="group" aria-label="Reorder ${escapeHtml(block.label || block.key)}">
            <button type="button" class="secondary-button builder-icon-button" data-move-builder-block="up" aria-label="Move ${escapeHtml(block.label || block.key)} up" title="Move up"${index === 0 ? " disabled" : ""}>&uarr;</button>
            <button type="button" class="secondary-button builder-icon-button" data-move-builder-block="down" aria-label="Move ${escapeHtml(block.label || block.key)} down" title="Move down"${index === blocks.length - 1 ? " disabled" : ""}>&darr;</button>
          </span>
          ${renderMoveToContainerControl(block, section, sections)}
          <button type="button" class="secondary-button" data-duplicate-builder-block>Duplicate</button>
          ${block.editable ? '<button type="button" class="secondary-button" data-builder-edit-block>Edit</button>' : ""}
          <button type="button" class="secondary-button danger" data-delete-builder-block aria-label="Delete ${escapeHtml(block.label || block.key)}">Delete</button>
        </div>
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
      (section, sectionIndex) => `
        <article class="builder-section-card ${section.id === activeSectionId ? "active" : ""}" data-builder-section="${escapeHtml(section.id)}" data-builder-section-key="${escapeHtml(section.key)}" tabindex="-1"${styleAttribute(section.settings?.customCss)}>
          <header>
            <div><p class="section-label">Container</p><h3>${escapeHtml(section.label || section.key)}</h3></div>
            <div class="builder-section-actions">
              <span class="builder-drag-handle" draggable="true" aria-hidden="true">Drag</span>
              <span class="builder-order-controls" role="group" aria-label="Reorder ${escapeHtml(section.label || section.key)}">
                <button type="button" class="secondary-button builder-icon-button" data-move-builder-section="up" aria-label="Move ${escapeHtml(section.label || section.key)} up" title="Move up"${sectionIndex === 0 ? " disabled" : ""}>&uarr;</button>
                <button type="button" class="secondary-button builder-icon-button" data-move-builder-section="down" aria-label="Move ${escapeHtml(section.label || section.key)} down" title="Move down"${sectionIndex === page.sections.length - 1 ? " disabled" : ""}>&darr;</button>
              </span>
              <button type="button" class="secondary-button builder-layout-pill" data-select-builder-section>
                ${builderSectionLayoutPreview(section)}
                <span>
                  <strong>${escapeHtml(layoutTitle(section.settings?.layout || "one-column"))}</strong>
                  <small>${escapeHtml(builderSectionLayoutLabel(section))}</small>
                </span>
              </button>
              <button type="button" class="secondary-button" data-add-element-to-section="${escapeHtml(section.id)}">Add element</button>
              ${hasPermission("create", "cms") ? '<button type="button" class="secondary-button" data-save-builder-section-template>Save reusable</button>' : ""}
              <button type="button" class="secondary-button" data-duplicate-builder-section>Duplicate</button>
              <button type="button" class="secondary-button" data-edit-builder-section>Settings</button>
              <button type="button" class="secondary-button danger" data-delete-builder-section aria-label="Delete ${escapeHtml(section.label || section.key)}">Delete</button>
            </div>
          </header>
          <div class="builder-block-list ${escapeHtml(builderSectionLayoutClasses(section))}" data-builder-dropzone data-section-id="${escapeHtml(section.id)}">
            ${(section.blocks || []).length ? (section.blocks || []).map((block, index, blocks) => renderBuilderBlock(block, index, blocks, section, page.sections)).join("") : '<div class="builder-empty small"><strong>Empty container</strong><span>Click an element from the left library or drop it here.</span></div>'}
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
        <a class="secondary-button" href="${escapeHtml(`${localizedPublicPageHref(page)}${localizedPublicPageHref(page).includes("?") ? "&" : "?"}edit=1`)}">Visual editor</a>
        ${hasPermission("create", "cms") ? '<button type="button" class="secondary-button" data-save-builder-page-template>Save as template</button>' : ""}
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

function renderBuilderPreviewDocument(page) {
  const customCss = sanitizeStylesheet(state.config?.siteSettings?.customCss || "");
  const designCss = designSystemCss(state.config?.siteSettings?.design);
  const language = currentLocaleForContent(page);

  return `<!doctype html>
<html lang="${escapeHtml(language)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <base href="/" />
    <title>${escapeHtml(page.title || "Page preview")}</title>
    <link rel="stylesheet" href="/styles.css" />
    <style data-site-design-system>${designCss}</style>
    ${customCss ? `<style data-site-custom-css>${customCss}</style>` : ""}
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="${escapeHtml(localizedPublicPageHref(page))}">${escapeHtml(page.title || "CMS Site")}</a>
      <nav class="site-nav" aria-label="Site navigation">${renderMenuItems(state.menu?.items || [], false)}</nav>
    </header>
    <main class="page-shell">
      <article data-page>${renderPageContent(page, { canEdit: false })}</article>
    </main>
    <footer class="site-footer">${renderFooter(page, false)}</footer>
    <script type="module" src="/web/builder-preview.js"></script>
  </body>
</html>`;
}

function renderBuilderLivePreview(page) {
  return `
    <section
      class="builder-live-preview"
      data-builder-canvas-panel="preview"
      data-builder-live-preview
      data-builder-preview-device="${escapeHtml(state.builderPreviewDevice)}"
      ${state.builderCanvasView === "preview" ? "" : "hidden"}
    >
      <header class="builder-live-preview-heading">
        <div>
          <p class="section-label">Responsive preview</p>
          <h2>Public page viewport</h2>
          <p>Styles and media queries run inside the selected device width.</p>
        </div>
        <a class="secondary-button" href="${escapeHtml(localizedPublicPageHref(page))}" target="_blank" rel="noreferrer">Open full page</a>
      </header>
      <div class="builder-preview-stage">
        <iframe title="Responsive preview of ${escapeHtml(page.title || "page")}" data-builder-preview-frame></iframe>
      </div>
    </section>
  `;
}

export function hydrateBuilderPreview(page) {
  const frame = elements.page?.querySelector?.("[data-builder-preview-frame]");
  if (!frame || frame.dataset.builderPreviewHydrated === "true") return;

  frame.srcdoc = renderBuilderPreviewDocument(page);
  frame.dataset.builderPreviewHydrated = "true";
}

function renderBuilderCanvasTools() {
  const previewDevice = ["desktop", "tablet", "mobile"].includes(state.builderPreviewDevice)
    ? state.builderPreviewDevice
    : "desktop";
  const canvasView = state.builderCanvasView === "preview" ? "preview" : "edit";

  return `
    <section class="builder-canvas-tools">
      <div>
        <p class="section-label">Canvas</p>
        <h2>Containers</h2>
      </div>
      <div class="builder-canvas-actions">
        <span class="builder-order-controls" role="group" aria-label="Canvas history">
          <button type="button" class="secondary-button builder-icon-button" data-builder-undo aria-label="Undo last canvas change" title="Undo"${state.builderUndoStack.length ? "" : " disabled"}>&#8630;</button>
          <button type="button" class="secondary-button builder-icon-button" data-builder-redo aria-label="Redo canvas change" title="Redo"${state.builderRedoStack.length ? "" : " disabled"}>&#8631;</button>
        </span>
        <span class="builder-canvas-view-switch" role="group" aria-label="Canvas view">
          ${["edit", "preview"]
            .map((view) => `<button type="button" class="secondary-button${canvasView === view ? " active" : ""}" data-builder-canvas-view="${view}" aria-pressed="${canvasView === view}">${view === "edit" ? "Edit" : "Preview"}</button>`)
            .join("")}
        </span>
        <span class="builder-device-switch" role="group" aria-label="Preview device">
          ${["desktop", "tablet", "mobile"]
            .map((device) => `<button type="button" class="secondary-button${previewDevice === device ? " active" : ""}" data-builder-preview-device="${device}" aria-pressed="${previewDevice === device}">${device[0].toUpperCase()}${device.slice(1)}</button>`)
            .join("")}
        </span>
        <button type="button" data-add-container>Add container</button>
        <button type="button" class="secondary-button" data-load-page-revisions>Revisions</button>
      </div>
    </section>
  `;
}

export function renderPageBuilderPage(page, message = "") {
  const enteringBuilderPage = state.builderPage?.slug !== page.slug;
  if (state.builderHistorySlug !== page.slug) {
    state.builderHistorySlug = page.slug;
    state.builderUndoStack = [];
    state.builderRedoStack = [];
    state.builderRailView = "library";
    state.builderCanvasView = "edit";
    state.builderPreviewDevice = "desktop";
  }
  if (enteringBuilderPage && window.matchMedia?.("(max-width: 1180px)").matches) {
    state.builderRailCollapsed = true;
  }

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
        ${renderBuilderLibrary({ action: "builder", page })}
        <main class="builder-main">
          ${renderBuilderStickyHeader(page, layout)}
          ${message ? `<p class="form-message" role="status" aria-live="polite">${escapeHtml(message)}</p>` : ""}
          ${renderBuilderCanvasTools()}
          ${renderBuilderLivePreview(page)}
          <section class="builder-canvas page-layout-${escapeHtml(layout)}" data-builder-canvas-panel="edit" data-builder-canvas-dropzone data-builder-preview-device="${escapeHtml(state.builderPreviewDevice)}"${state.builderCanvasView === "edit" ? "" : " hidden"}>
            ${renderBuilderSections(page)}
          </section>
          ${renderRevisionPanel(page)}
        </main>
      </section>
    `
  );
  if (state.builderCanvasView === "preview") hydrateBuilderPreview(page);
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
