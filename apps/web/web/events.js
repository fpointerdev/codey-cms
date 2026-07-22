import { availableComponentTemplates, elements, escapeHtml, normalizePageLayout, slugFromTitle, state } from "./core.js";
import { bootstrap } from "./controller.js";
import {
  addArticle,
  addElementTemplate,
  addLocaleRow,
  addMenuItem,
  addSection,
  editBlock,
  editFooter,
  editMenuItem,
  editPageSettings,
  publishPage,
  removeLocaleRow,
  saveEmailSettings,
  saveLocalizationSettings,
  syncLocaleLanguageFields,
  testEmailSettings,
  toggleLocalizationModule,
  saveSiteSettings
} from "./content-actions.js";
import {
  addBuilderContainer,
  addReusableTemplateToBuilder,
  addSectionPatternToBuilder,
  addTemplateToBuilder,
  addTemplateToBuilderSection,
  comparePageRevision,
  createPageFromBuilder,
  createPageFromDashboard,
  createPageTranslation,
  createPostFromDashboard,
  createPostTranslation,
  deleteBuilderBlock,
  deleteBuilderSection,
  deleteReusableTemplate,
  duplicateBuilderBlock,
  duplicateBuilderSection,
  editBuilderBlock,
  editBuilderSection,
  editReusableTemplate,
  insertTemplateIntoPost,
  linkExistingPageTranslation,
  linkExistingPostTranslation,
  loadPageRevisions,
  moveBuilderBlock,
  moveBuilderSection,
  openOrCreatePageTranslation,
  openOrCreatePostTranslation,
  reorderBuilderBlock,
  reorderBuilderSection,
  replaceReusableTemplateFromBuilder,
  redoBuilderChange,
  restorePageRevision,
  saveBuilderPageTemplate,
  saveBuilderSectionTemplate,
  savePageBuilderSettings,
  savePostEditor,
  undoBuilderChange
} from "./builder-actions.js";
import { hydrateBuilderPreview, insertIntoTextarea, refreshRichPreview } from "./builder-views.js";
import {
  acceptUserInvite,
  changeOwnPassword,
  confirmEmailVerification,
  confirmPasswordReset,
  loginAdmin,
  logoutAdmin,
  requestPasswordResetFromLogin,
  revokeAllSessions,
  submitContactForm
} from "./session-actions.js";
import {
  createUserInvite,
  deleteUser,
  filterUsers,
  resendUserInvite,
  revokeUserInvite,
  updateUser
} from "./user-actions.js";
import {
  addRepeaterRow,
  copyPaymentWebhook,
  createProductFromDashboard,
  openProductEditor,
  removeRepeaterRow,
  savePaymentProvider,
  saveProductEditor,
  saveShopSettings,
  testPaymentProvider,
  updateShopSettingsPreview,
  updateManualPayment
} from "./shop-actions.js";
import {
  deletePostCategory,
  deleteProductAttribute,
  deleteProductCategory,
  savePostCategory,
  saveProductAttribute,
  saveProductCategory
} from "./taxonomy-actions.js";
import { getModalFormHandler } from "./modal.js";
import {
  enhanceStructuredTabs,
  handleStructuredTabClick,
  handleStructuredTabKeydown
} from "./structured-tabs.js";
import { handleSliderClick } from "./slider-runtime.js";
import { applyDesignPreset, syncDesignColorTextInput, updateDesignSystemPreview } from "./design-system.js";
import {
  cancelVisualInlineEdit,
  deleteVisualBlock,
  deleteVisualReusableTemplate,
  deleteVisualSection,
  duplicateVisualBlock,
  duplicateVisualSection,
  editVisualSection,
  handleVisualEditorKeydown,
  insertVisualReusableTemplate,
  moveVisualBlock,
  moveVisualSection,
  redoVisualEditorChange,
  saveVisualInlineEdit,
  saveVisualPageTemplate,
  saveVisualSectionTemplate,
  selectVisualEditorItem,
  setVisualEditorDevice,
  startVisualInlineEdit,
  undoVisualEditorChange
} from "./visual-editor.js";

const builderDragType = "application/x-codey-builder";

function closeVisualCommandMenus(target) {
  const activeMenu = target?.closest?.(".visual-command-menu");
  const activeSummary = target?.closest?.("summary");

  document.querySelectorAll?.(".visual-command-menu[open]").forEach((menu) => {
    const keepOpen = menu === activeMenu && activeSummary?.parentElement === menu;
    if (!keepOpen) menu.removeAttribute("open");
  });
}

function isAdminPath(pathname) {
  return pathname === "/cy-admin" || pathname.startsWith("/dashboard") || pathname.startsWith("/auth/");
}

function shouldHandleLocalPageLink(event, link) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (!link || link.target && link.target !== "_self" || link.hasAttribute("download")) return false;

  const currentHref = window.location.href || `${window.location.origin || "http://localhost"}${window.location.pathname || "/"}${window.location.search || ""}`;
  const url = new URL(link.getAttribute("href"), currentHref);
  const currentOrigin = window.location.origin || new URL(currentHref).origin;
  if (url.origin !== currentOrigin) return false;
  if (isAdminPath(url.pathname) || url.pathname.startsWith("/api/") || /\.[a-z0-9]+$/i.test(url.pathname)) return false;
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return false;

  return true;
}

function handlePublicPageLink(event) {
  const link = event.target.closest("a[href]");
  if (!shouldHandleLocalPageLink(event, link)) return false;

  const currentHref = window.location.href || `${window.location.origin || "http://localhost"}${window.location.pathname || "/"}${window.location.search || ""}`;
  const url = new URL(link.getAttribute("href"), currentHref);
  if (state.visualEditorActive && !isAdminPath(url.pathname)) url.searchParams.set("edit", "1");
  event.preventDefault();
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  void bootstrap();
  return true;
}

function bindSubmitEvents() {
  elements.page.addEventListener("submit", (event) => {
    const contactForm = event.target.closest("[data-contact-form]");
    if (contactForm) {
      event.preventDefault();
      void submitContactForm(contactForm);
      return;
    }

    const form = event.target.closest("[data-admin-login-form]");
    if (form) {
      event.preventDefault();
      void loginAdmin(form);
      return;
    }

    const resetForm = event.target.closest("[data-password-reset-form]");
    if (resetForm) {
      event.preventDefault();
      void confirmPasswordReset(resetForm);
      return;
    }

    const inviteAcceptanceForm = event.target.closest("[data-invite-acceptance-form]");
    if (inviteAcceptanceForm) {
      event.preventDefault();
      void acceptUserInvite(inviteAcceptanceForm);
      return;
    }

    const emailVerificationForm = event.target.closest("[data-email-verification-form]");
    if (emailVerificationForm) {
      event.preventDefault();
      void confirmEmailVerification(emailVerificationForm);
      return;
    }

    const userFilterForm = event.target.closest("[data-user-filter-form]");
    if (userFilterForm) {
      event.preventDefault();
      void filterUsers(userFilterForm);
      return;
    }

    const userEditForm = event.target.closest("[data-user-edit-form]");
    if (userEditForm) {
      event.preventDefault();
      void updateUser(userEditForm);
      return;
    }

    const changePasswordForm = event.target.closest("[data-change-password-form]");
    if (changePasswordForm) {
      event.preventDefault();
      void changeOwnPassword(changePasswordForm);
      return;
    }

    const pageCreateForm = event.target.closest("[data-page-create-form]");
    if (pageCreateForm) {
      event.preventDefault();
      void createPageFromBuilder(pageCreateForm);
      return;
    }

    const pageBuilderSettings = event.target.closest("[data-page-builder-settings]");
    if (pageBuilderSettings) {
      event.preventDefault();
      void savePageBuilderSettings(pageBuilderSettings);
      return;
    }

    const postEditorForm = event.target.closest("[data-post-editor-form]");
    if (postEditorForm) {
      event.preventDefault();
      void savePostEditor(postEditorForm);
      return;
    }

    const settingsForm = event.target.closest("[data-site-settings-form]");
    if (settingsForm) {
      event.preventDefault();
      void saveSiteSettings(settingsForm);
      return;
    }

    const emailSettingsForm = event.target.closest("[data-email-settings-form]");
    if (emailSettingsForm) {
      event.preventDefault();
      void saveEmailSettings(emailSettingsForm);
      return;
    }

    const localizationSettingsForm = event.target.closest("[data-localization-settings-form]");
    if (localizationSettingsForm) {
      event.preventDefault();
      void saveLocalizationSettings(localizationSettingsForm);
      return;
    }

    const productEditorForm = event.target.closest("[data-product-editor-form]");
    if (productEditorForm) {
      event.preventDefault();
      void saveProductEditor(productEditorForm);
      return;
    }

    const shopSettingsForm = event.target.closest("[data-shop-settings-form]");
    if (shopSettingsForm) {
      event.preventDefault();
      void saveShopSettings(shopSettingsForm);
      return;
    }

    const paymentProviderForm = event.target.closest("[data-payment-provider-form]");
    if (paymentProviderForm) {
      event.preventDefault();
      void savePaymentProvider(paymentProviderForm);
    }
  });
}

function bindDashboardClick(event) {
  const dashboardLink = event.target.closest("[data-dashboard-link]");
  if (!dashboardLink) return false;

  event.preventDefault();
  window.history.pushState({}, "", dashboardLink.getAttribute("href"));
  void bootstrap();
  return true;
}

function bindSliderClick(event) {
  return handleSliderClick(event);
}

function bindDesignSystemClick(event) {
  const preset = event.target.closest("[data-design-preset]");
  if (!preset?.dataset.designPreset) return false;

  const form = preset.closest("[data-design-system-form]");
  applyDesignPreset(form, preset.dataset.designPreset, state.config?.siteSettings?.design);
  return true;
}

function applyBuilderLibraryFilters(rail) {
  const query = String(rail?.querySelector?.("[data-builder-library-search]")?.value || "").trim().toLowerCase();
  const selectedFilter = Array.from(rail?.querySelectorAll?.("[data-builder-library-filter]") || [])
    .find((button) => button.getAttribute("aria-pressed") === "true")?.dataset.builderLibraryFilter || "all";
  const items = Array.from(rail?.querySelectorAll?.("[data-builder-library-item]") || []);
  let visibleItems = 0;

  items.forEach((item) => {
    const matchesQuery = !query || String(item.dataset.builderLibrarySearchText || item.textContent || "").includes(query);
    const matchesFilter = selectedFilter === "all" || item.dataset.builderLibraryCategory === selectedFilter;
    item.hidden = !matchesQuery || !matchesFilter;
    if (!item.hidden) visibleItems += 1;
  });

  rail?.querySelectorAll?.("[data-builder-library-group]").forEach((group) => {
    group.hidden = !Array.from(group.querySelectorAll("[data-builder-library-item]")).some((item) => !item.hidden);
  });

  const empty = rail?.querySelector?.("[data-builder-library-empty]");
  if (empty) empty.hidden = visibleItems > 0;
}

function setBuilderCanvasView(builder, view) {
  state.builderCanvasView = view;
  builder?.querySelectorAll?.("[data-builder-canvas-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.builderCanvasPanel !== view;
  });
  builder?.querySelectorAll?.("[data-builder-canvas-view]").forEach((button) => {
    const active = button.dataset.builderCanvasView === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (view === "preview" && state.builderPage) hydrateBuilderPreview(state.builderPage);
}

function focusBuilderStructureTarget(control) {
  const builder = control.closest("[data-page-builder]");
  if (!builder) return false;

  const sectionId = control.dataset.builderStructureSection || control.dataset.builderSectionId;
  const blockKey = control.dataset.builderStructureBlock;
  const target = blockKey
    ? Array.from(builder.querySelectorAll("[data-builder-block-key]")).find((item) => item.dataset.builderBlockKey === blockKey)
    : Array.from(builder.querySelectorAll("[data-builder-section]")).find((item) => item.dataset.builderSection === sectionId);
  if (!target) return false;

  setBuilderCanvasView(builder, "edit");
  if (sectionId) state.activeBuilderSectionId = sectionId;
  builder.querySelectorAll("[data-builder-section]").forEach((section) => {
    section.classList.toggle("active", section.dataset.builderSection === sectionId);
  });
  builder.querySelectorAll("[data-builder-structure-section-row]").forEach((row) => {
    row.classList.toggle("active", row.dataset.builderStructureSectionRow === sectionId);
  });
  builder.querySelectorAll("[data-builder-structure-block-row]").forEach((row) => {
    row.classList.toggle("active", Boolean(blockKey) && row.dataset.builderStructureBlockRow === blockKey);
  });

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  target.focus?.({ preventScroll: true });
  return true;
}

function bindBuilderClick(event) {
  const adminSidebarToggle = event.target.closest("[data-toggle-admin-sidebar]");
  if (adminSidebarToggle) {
    state.adminSidebarCollapsed = !state.adminSidebarCollapsed;
    const layout = adminSidebarToggle.closest("[data-admin-layout]");
    const sidebar = adminSidebarToggle.closest("[data-admin-sidebar]");
    layout?.classList.toggle("admin-layout-sidebar-collapsed", state.adminSidebarCollapsed);
    sidebar?.classList.toggle("collapsed", state.adminSidebarCollapsed);
    adminSidebarToggle.setAttribute?.("aria-expanded", state.adminSidebarCollapsed ? "false" : "true");
    adminSidebarToggle.setAttribute?.(
      "aria-label",
      state.adminSidebarCollapsed ? "Expand admin navigation" : "Collapse admin navigation"
    );
    return true;
  }

  const builderRailToggle = event.target.closest("[data-toggle-builder-rail]");
  if (builderRailToggle) {
    state.builderRailCollapsed = !state.builderRailCollapsed;
    const shell = builderRailToggle.closest("[data-page-builder], [data-post-editor-form]");
    const rail = builderRailToggle.closest("[data-builder-rail]");
    shell?.classList.toggle("builder-shell-collapsed", state.builderRailCollapsed);
    rail?.classList.toggle("collapsed", state.builderRailCollapsed);
    builderRailToggle.setAttribute?.("aria-expanded", state.builderRailCollapsed ? "false" : "true");
    builderRailToggle.textContent = state.builderRailCollapsed ? "Builder" : "Collapse";
    return true;
  }

  const builderRailViewButton = event.target.closest("[data-builder-rail-view]");
  if (builderRailViewButton?.dataset.builderRailView) {
    const view = builderRailViewButton.dataset.builderRailView;
    if (!["library", "structure"].includes(view)) return true;

    state.builderRailView = view;
    const rail = builderRailViewButton.closest("[data-builder-rail]");
    rail?.querySelectorAll?.("[data-builder-rail-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.builderRailPanel !== view;
    });
    rail?.querySelectorAll?.("[data-builder-rail-view]").forEach((button) => {
      const active = button.dataset.builderRailView === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    return true;
  }

  const builderLibraryFilter = event.target.closest("[data-builder-library-filter]");
  if (builderLibraryFilter?.dataset.builderLibraryFilter) {
    const rail = builderLibraryFilter.closest("[data-builder-rail]");
    rail?.querySelectorAll?.("[data-builder-library-filter]").forEach((button) => {
      const active = button === builderLibraryFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    applyBuilderLibraryFilters(rail);
    return true;
  }

  const canvasViewButton = event.target.closest("[data-builder-canvas-view]");
  if (canvasViewButton?.dataset.builderCanvasView) {
    const view = canvasViewButton.dataset.builderCanvasView;
    if (!["edit", "preview"].includes(view)) return true;

    setBuilderCanvasView(canvasViewButton.closest("[data-page-builder]"), view);
    return true;
  }

  const previewDeviceButton = event.target.closest("button[data-builder-preview-device]");
  if (previewDeviceButton?.dataset.builderPreviewDevice) {
    const device = previewDeviceButton.dataset.builderPreviewDevice;
    if (!["desktop", "tablet", "mobile"].includes(device)) return true;

    state.builderPreviewDevice = device;
    const builder = previewDeviceButton.closest("[data-page-builder]");
    builder?.querySelectorAll?.("[data-builder-canvas-dropzone], [data-builder-live-preview]").forEach((preview) => {
      preview.dataset.builderPreviewDevice = device;
    });
    builder?.querySelectorAll?.("button[data-builder-preview-device]").forEach((button) => {
      const active = button.dataset.builderPreviewDevice === device;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    return true;
  }

  const structureSectionMove = event.target.closest("[data-builder-structure-move-section]");
  if (structureSectionMove?.dataset.builderSectionId) {
    event.preventDefault();
    void moveBuilderSection(structureSectionMove.dataset.builderSectionId, structureSectionMove.dataset.builderStructureMoveSection);
    return true;
  }

  const structureBlockMove = event.target.closest("[data-builder-structure-move-block]");
  if (structureBlockMove?.dataset.builderStructureBlockKey) {
    event.preventDefault();
    void moveBuilderBlock(structureBlockMove.dataset.builderStructureBlockKey, structureBlockMove.dataset.builderStructureMoveBlock);
    return true;
  }

  const structureTarget = event.target.closest("[data-builder-structure-section], [data-builder-structure-block]");
  if (structureTarget) {
    event.preventDefault();
    focusBuilderStructureTarget(structureTarget);
    return true;
  }

  if (event.target.closest("[data-builder-undo]")) {
    event.preventDefault();
    void undoBuilderChange();
    return true;
  }

  if (event.target.closest("[data-builder-redo]")) {
    event.preventDefault();
    void redoBuilderChange();
    return true;
  }

  const editSlugButton = event.target.closest("[data-edit-slug]");
  if (editSlugButton) {
    const field = editSlugButton.closest("[data-slug-field]");
    const input = field?.querySelector?.("[data-editable-slug]");
    if (input) {
      input.readOnly = false;
      input.dataset.slugUnlocked = "true";
      field.classList.add("editing");
      editSlugButton.disabled = true;
      editSlugButton.textContent = "Editing";
      input.focus?.();
      input.select?.();
    }
    return true;
  }

  const templateButton = event.target.closest("[data-add-template]");
  if (templateButton?.dataset.addTemplate) {
    void addElementTemplate(templateButton.dataset.addTemplate);
    return true;
  }

  const selectTemplateButton = event.target.closest("[data-select-template]");
  if (selectTemplateButton?.dataset.selectTemplate) {
    const form = selectTemplateButton.closest("[data-page-create-form]");
    const input = form?.querySelector("[data-selected-template]");
    if (input) input.value = selectTemplateButton.dataset.selectTemplate;
    form?.querySelectorAll("[data-select-template]").forEach((button) => {
      button.classList.toggle("active", button === selectTemplateButton);
    });
    return true;
  }

  const builderTemplateButton = event.target.closest("[data-builder-template]");
  if (builderTemplateButton?.dataset.builderTemplate) {
    event.preventDefault();
    void addTemplateToBuilder(builderTemplateButton.dataset.builderTemplate);
    return true;
  }

  const reusableTemplateButton = event.target.closest("[data-builder-reusable-template]");
  if (reusableTemplateButton?.dataset.builderReusableTemplate) {
    event.preventDefault();
    void addReusableTemplateToBuilder(reusableTemplateButton.dataset.builderReusableTemplate);
    return true;
  }

  const replaceReusableButton = event.target.closest("[data-replace-reusable-template]");
  if (replaceReusableButton?.dataset.replaceReusableTemplate) {
    event.preventDefault();
    void replaceReusableTemplateFromBuilder(replaceReusableButton.dataset.replaceReusableTemplate);
    return true;
  }

  const editReusableButton = event.target.closest("[data-edit-reusable-template]");
  if (editReusableButton?.dataset.editReusableTemplate) {
    event.preventDefault();
    void editReusableTemplate(editReusableButton.dataset.editReusableTemplate);
    return true;
  }

  const deleteReusableButton = event.target.closest("[data-delete-reusable-template]");
  if (deleteReusableButton?.dataset.deleteReusableTemplate) {
    event.preventDefault();
    void deleteReusableTemplate(deleteReusableButton.dataset.deleteReusableTemplate);
    return true;
  }

  if (event.target.closest("[data-save-builder-page-template]")) {
    event.preventDefault();
    void saveBuilderPageTemplate();
    return true;
  }

  const sectionPatternButton = event.target.closest("[data-builder-section-pattern]");
  if (sectionPatternButton?.dataset.builderSectionPattern) {
    event.preventDefault();
    void addSectionPatternToBuilder(sectionPatternButton.dataset.builderSectionPattern);
    return true;
  }

  const addRepeaterButton = event.target.closest("[data-add-repeater-row]");
  if (addRepeaterButton?.dataset.addRepeaterRow) {
    addRepeaterRow(addRepeaterButton.dataset.addRepeaterRow);
    return true;
  }

  if (event.target.closest("[data-remove-repeater-row]")) {
    removeRepeaterRow(event.target.closest("[data-remove-repeater-row]"));
    return true;
  }

  if (event.target.closest("[data-add-container]")) {
    event.preventDefault();
    void addBuilderContainer();
    return true;
  }

  const addElementButton = event.target.closest("[data-add-element-to-section]");
  if (addElementButton?.dataset.addElementToSection) {
    event.preventDefault();
    void addTemplateToBuilderSection(addElementButton.dataset.addElementToSection);
    return true;
  }

  if (event.target.closest("[data-add-locale-row]")) {
    addLocaleRow();
    return true;
  }

  const removeLocaleButton = event.target.closest("[data-remove-locale-row]");
  if (removeLocaleButton) {
    removeLocaleRow(removeLocaleButton);
    return true;
  }

  if (event.target.closest("[data-load-page-revisions]")) {
    void loadPageRevisions();
    return true;
  }

  const compareRevisionButton = event.target.closest("[data-compare-page-revision]");
  if (compareRevisionButton?.dataset.comparePageRevision) {
    void comparePageRevision(compareRevisionButton.dataset.comparePageRevision);
    return true;
  }

  const restoreRevisionButton = event.target.closest("[data-restore-page-revision]");
  if (restoreRevisionButton?.dataset.restorePageRevision) {
    void restorePageRevision(
      restoreRevisionButton.dataset.restorePageRevision,
      restoreRevisionButton.dataset.revisionVersion || ""
    );
    return true;
  }

  const sectionButton = event.target.closest("[data-select-builder-section]");
  const section = sectionButton?.closest("[data-builder-section]");
  if (section?.dataset.builderSection) {
    event.preventDefault();
    state.activeBuilderSectionId = section.dataset.builderSection;
    section.closest("[data-page-builder]")?.querySelectorAll("[data-builder-section]").forEach((item) => {
      item.classList.toggle("active", item === section);
    });
    return true;
  }

  const sectionSettingsButton = event.target.closest("[data-edit-builder-section]");
  const editableSection = sectionSettingsButton?.closest("[data-builder-section]");
  if (editableSection?.dataset.builderSection) {
    event.preventDefault();
    void editBuilderSection(editableSection.dataset.builderSection);
    return true;
  }

  const saveSectionTemplateButton = event.target.closest("[data-save-builder-section-template]");
  const reusableSection = saveSectionTemplateButton?.closest("[data-builder-section]");
  if (reusableSection?.dataset.builderSection) {
    event.preventDefault();
    void saveBuilderSectionTemplate(reusableSection.dataset.builderSection);
    return true;
  }

  const sectionDuplicateButton = event.target.closest("[data-duplicate-builder-section]");
  const duplicatedSection = sectionDuplicateButton?.closest("[data-builder-section]");
  if (duplicatedSection?.dataset.builderSection) {
    event.preventDefault();
    void duplicateBuilderSection(duplicatedSection.dataset.builderSection);
    return true;
  }

  const sectionMoveButton = event.target.closest("[data-move-builder-section]");
  const movedSection = sectionMoveButton?.closest("[data-builder-section]");
  if (movedSection?.dataset.builderSection) {
    event.preventDefault();
    void moveBuilderSection(movedSection.dataset.builderSection, sectionMoveButton.dataset.moveBuilderSection);
    return true;
  }

  const sectionDeleteButton = event.target.closest("[data-delete-builder-section]");
  const deletedSection = sectionDeleteButton?.closest("[data-builder-section]");
  if (deletedSection?.dataset.builderSection) {
    event.preventDefault();
    void deleteBuilderSection(deletedSection.dataset.builderSection);
    return true;
  }

  const blockDeleteButton = event.target.closest("[data-delete-builder-block]");
  const deletedBlock = blockDeleteButton?.closest("[data-builder-block-key]");
  if (deletedBlock?.dataset.builderBlockKey) {
    event.preventDefault();
    void deleteBuilderBlock(deletedBlock.dataset.builderBlockKey);
    return true;
  }

  const blockDuplicateButton = event.target.closest("[data-duplicate-builder-block]");
  const duplicatedBlock = blockDuplicateButton?.closest("[data-builder-block-key]");
  if (duplicatedBlock?.dataset.builderBlockKey) {
    event.preventDefault();
    void duplicateBuilderBlock(duplicatedBlock.dataset.builderBlockKey);
    return true;
  }

  const blockMoveButton = event.target.closest("[data-move-builder-block]");
  const movedBlock = blockMoveButton?.closest("[data-builder-block-key]");
  if (movedBlock?.dataset.builderBlockKey) {
    event.preventDefault();
    void moveBuilderBlock(movedBlock.dataset.builderBlockKey, blockMoveButton.dataset.moveBuilderBlock);
    return true;
  }

  const postTemplateButton = event.target.closest("[data-post-template]");
  if (postTemplateButton?.dataset.postTemplate) {
    insertTemplateIntoPost(postTemplateButton.dataset.postTemplate);
    return true;
  }

  const richInsertButton = event.target.closest("[data-rich-insert]");
  if (richInsertButton?.dataset.richInsert) {
    const editor = richInsertButton.closest("[data-rich-editor]");
    const source = editor?.querySelector?.("[data-rich-source]");
    if (source) {
      insertIntoTextarea(source, richInsertButton.dataset.richInsert);
      refreshRichPreview(editor);
    }
    return true;
  }

  const richWrapButton = event.target.closest("[data-rich-wrap]");
  if (richWrapButton?.dataset.richWrap) {
    const editor = richWrapButton.closest("[data-rich-editor]");
    const source = editor?.querySelector?.("[data-rich-source]");
    if (source) {
      insertIntoTextarea(source, "", richWrapButton.dataset.richWrap);
      refreshRichPreview(editor);
    }
    return true;
  }

  return false;
}

function bindAdminClick(event) {
  const emailTestButton = event.target.closest("[data-test-email-settings]");
  if (emailTestButton) {
    void testEmailSettings(emailTestButton);
    return true;
  }

  const paymentTestButton = event.target.closest("[data-test-payment-provider]");
  if (paymentTestButton) {
    void testPaymentProvider(paymentTestButton);
    return true;
  }

  const webhookCopyButton = event.target.closest("[data-copy-payment-webhook]");
  if (webhookCopyButton) {
    void copyPaymentWebhook(webhookCopyButton);
    return true;
  }

  const manualPaymentButton = event.target.closest("[data-manual-payment-action]");
  if (manualPaymentButton) {
    void updateManualPayment(manualPaymentButton);
    return true;
  }

  if (event.target.closest("[data-admin-logout]")) {
    void logoutAdmin();
    return true;
  }

  if (event.target.closest("[data-revoke-all-sessions]")) {
    void revokeAllSessions();
    return true;
  }

  if (event.target.closest("[data-invite-user]")) {
    void createUserInvite();
    return true;
  }

  const deleteUserButton = event.target.closest("[data-delete-user]");
  if (deleteUserButton?.dataset.deleteUser) {
    void deleteUser(deleteUserButton.dataset.deleteUser, deleteUserButton.dataset.userEmail);
    return true;
  }

  const resendInviteButton = event.target.closest("[data-resend-user-invite]");
  if (resendInviteButton?.dataset.resendUserInvite) {
    void resendUserInvite(resendInviteButton.dataset.resendUserInvite, resendInviteButton.dataset.inviteEmail);
    return true;
  }

  const revokeInviteButton = event.target.closest("[data-revoke-user-invite]");
  if (revokeInviteButton?.dataset.revokeUserInvite) {
    void revokeUserInvite(revokeInviteButton.dataset.revokeUserInvite, revokeInviteButton.dataset.inviteEmail);
    return true;
  }

  if (event.target.closest("[data-create-page]")) {
    createPageFromDashboard();
    return true;
  }

  if (event.target.closest("[data-create-post]")) {
    createPostFromDashboard();
    return true;
  }

  const pageTranslationButton = event.target.closest("[data-create-page-translation]");
  if (pageTranslationButton?.dataset.createPageTranslation) {
    void createPageTranslation(
      pageTranslationButton.dataset.createPageTranslation,
      pageTranslationButton.dataset.sourceLocale || "en",
      pageTranslationButton.dataset.sourceTitle || "",
      pageTranslationButton.dataset.targetLocale || ""
    );
    return true;
  }

  const postTranslationButton = event.target.closest("[data-create-post-translation]");
  if (postTranslationButton?.dataset.createPostTranslation) {
    void createPostTranslation(
      postTranslationButton.dataset.createPostTranslation,
      postTranslationButton.dataset.sourceLocale || "en",
      postTranslationButton.dataset.sourceTitle || "",
      postTranslationButton.dataset.targetLocale || ""
    );
    return true;
  }

  const openPageTranslationButton = event.target.closest("[data-open-page-translation]");
  if (openPageTranslationButton?.dataset.openPageTranslation) {
    void openOrCreatePageTranslation(
      openPageTranslationButton.dataset.openPageTranslation,
      openPageTranslationButton.dataset.sourceLocale || "en",
      openPageTranslationButton.dataset.sourceTitle || "",
      openPageTranslationButton.dataset.targetLocale || "",
      openPageTranslationButton.dataset.translationGroup || ""
    );
    return true;
  }

  const openPostTranslationButton = event.target.closest("[data-open-post-translation]");
  if (openPostTranslationButton?.dataset.openPostTranslation) {
    void openOrCreatePostTranslation(
      openPostTranslationButton.dataset.openPostTranslation,
      openPostTranslationButton.dataset.sourceLocale || "en",
      openPostTranslationButton.dataset.sourceTitle || "",
      openPostTranslationButton.dataset.targetLocale || "",
      openPostTranslationButton.dataset.translationGroup || ""
    );
    return true;
  }

  const linkPageTranslationButton = event.target.closest("[data-link-page-translation]");
  if (linkPageTranslationButton?.dataset.linkPageTranslation) {
    void linkExistingPageTranslation(
      linkPageTranslationButton.dataset.linkPageTranslation,
      linkPageTranslationButton.dataset.sourceLocale || "en",
      linkPageTranslationButton.dataset.sourceTitle || "",
      linkPageTranslationButton.dataset.translationGroup || ""
    );
    return true;
  }

  const linkPostTranslationButton = event.target.closest("[data-link-post-translation]");
  if (linkPostTranslationButton?.dataset.linkPostTranslation) {
    void linkExistingPostTranslation(
      linkPostTranslationButton.dataset.linkPostTranslation,
      linkPostTranslationButton.dataset.sourceLocale || "en",
      linkPostTranslationButton.dataset.sourceTitle || "",
      linkPostTranslationButton.dataset.translationGroup || ""
    );
    return true;
  }

  if (event.target.closest("[data-create-product]")) {
    createProductFromDashboard();
    return true;
  }

  if (event.target.closest("[data-create-post-category]")) {
    void savePostCategory();
    return true;
  }

  const editPostCategoryButton = event.target.closest("[data-edit-post-category]");
  if (editPostCategoryButton?.dataset.editPostCategory) {
    void savePostCategory(editPostCategoryButton.dataset.editPostCategory);
    return true;
  }

  const deletePostCategoryButton = event.target.closest("[data-delete-post-category]");
  if (deletePostCategoryButton?.dataset.deletePostCategory) {
    void deletePostCategory(deletePostCategoryButton.dataset.deletePostCategory);
    return true;
  }

  if (event.target.closest("[data-create-product-category]")) {
    void saveProductCategory();
    return true;
  }

  const editProductCategoryButton = event.target.closest("[data-edit-product-category]");
  if (editProductCategoryButton?.dataset.editProductCategory) {
    void saveProductCategory(editProductCategoryButton.dataset.editProductCategory);
    return true;
  }

  const deleteProductCategoryButton = event.target.closest("[data-delete-product-category]");
  if (deleteProductCategoryButton?.dataset.deleteProductCategory) {
    void deleteProductCategory(deleteProductCategoryButton.dataset.deleteProductCategory);
    return true;
  }

  if (event.target.closest("[data-create-product-attribute]")) {
    void saveProductAttribute();
    return true;
  }

  const editProductAttributeButton = event.target.closest("[data-edit-product-attribute]");
  if (editProductAttributeButton?.dataset.editProductAttribute) {
    void saveProductAttribute(editProductAttributeButton.dataset.editProductAttribute);
    return true;
  }

  const deleteProductAttributeButton = event.target.closest("[data-delete-product-attribute]");
  if (deleteProductAttributeButton?.dataset.deleteProductAttribute) {
    void deleteProductAttribute(deleteProductAttributeButton.dataset.deleteProductAttribute);
    return true;
  }

  const shopProductButton = event.target.closest("[data-edit-shop-product]");
  if (shopProductButton?.dataset.editShopProduct) {
    openProductEditor(shopProductButton.dataset.editShopProduct);
    return true;
  }

  const localizationToggle = event.target.closest("[data-localization-toggle]");
  if (localizationToggle?.dataset.localizationToggle) {
    void toggleLocalizationModule(localizationToggle.dataset.localizationToggle);
    return true;
  }

  return false;
}

function bindInlineEditorClick(event) {
  if (event.target.closest("[data-enter-visual-editor]")) {
    const url = new URL(window.location.href);
    url.searchParams.set("edit", "1");
    state.visualEditorActive = true;
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    void bootstrap();
    return true;
  }

  if (event.target.closest("[data-exit-visual-editor]")) {
    const url = new URL(window.location.href);
    url.searchParams.delete("edit");
    state.visualEditorActive = false;
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    void bootstrap();
    return true;
  }

  const visualSection = event.target.closest("[data-visual-section]");
  const visualBlock = event.target.closest("[data-visual-block]");
  const sectionId = visualSection?.dataset.sectionId;
  const blockKey = visualBlock?.dataset.blockKey;

  if (event.target.closest("[data-visual-start-inline]") && blockKey) {
    startVisualInlineEdit(blockKey);
    return true;
  }
  if (event.target.closest("[data-visual-save-inline]")) {
    void saveVisualInlineEdit(blockKey);
    return true;
  }
  if (event.target.closest("[data-visual-cancel-inline]")) {
    cancelVisualInlineEdit();
    return true;
  }
  const moveSectionButton = event.target.closest("[data-visual-move-section]");
  if (moveSectionButton && sectionId) {
    void moveVisualSection(sectionId, moveSectionButton.dataset.visualMoveSection);
    return true;
  }
  if (event.target.closest("[data-visual-duplicate-section]") && sectionId) {
    void duplicateVisualSection(sectionId);
    return true;
  }
  if (event.target.closest("[data-visual-edit-section]") && sectionId) {
    void editVisualSection(sectionId);
    return true;
  }
  if (event.target.closest("[data-visual-save-section]") && sectionId) {
    void saveVisualSectionTemplate(sectionId);
    return true;
  }
  if (event.target.closest("[data-visual-delete-section]") && sectionId) {
    void deleteVisualSection(sectionId);
    return true;
  }
  const moveBlockButton = event.target.closest("[data-visual-move-block]");
  if (moveBlockButton && blockKey) {
    void moveVisualBlock(blockKey, moveBlockButton.dataset.visualMoveBlock);
    return true;
  }
  if (event.target.closest("[data-visual-duplicate-block]") && blockKey) {
    void duplicateVisualBlock(blockKey);
    return true;
  }
  if (event.target.closest("[data-visual-delete-block]") && blockKey) {
    void deleteVisualBlock(blockKey);
    return true;
  }
  if (event.target.closest("[data-visual-undo]")) {
    void undoVisualEditorChange();
    return true;
  }
  if (event.target.closest("[data-visual-redo]")) {
    void redoVisualEditorChange();
    return true;
  }
  const deviceButton = event.target.closest("button[data-visual-device]");
  if (deviceButton?.dataset.visualDevice) {
    setVisualEditorDevice(deviceButton.dataset.visualDevice);
    return true;
  }
  const insertTemplateButton = event.target.closest("[data-visual-insert-template]");
  if (insertTemplateButton?.dataset.visualInsertTemplate) {
    void insertVisualReusableTemplate(insertTemplateButton.dataset.visualInsertTemplate);
    return true;
  }
  const deleteTemplateButton = event.target.closest("[data-visual-delete-template]");
  if (deleteTemplateButton?.dataset.visualDeleteTemplate) {
    void deleteVisualReusableTemplate(deleteTemplateButton.dataset.visualDeleteTemplate);
    return true;
  }
  if (event.target.closest("[data-visual-save-page-template]")) {
    void saveVisualPageTemplate();
    return true;
  }

  const block = event.target.closest("[data-edit-block]")?.closest("[data-block-key]");
  if (block?.dataset.blockKey) {
    void editBlock(block.dataset.blockKey);
    return true;
  }

  if (event.target.closest("[data-edit-page-inline]")) {
    void editPageSettings();
    return true;
  }

  if (event.target.closest("[data-add-section-inline]")) {
    void addSection();
    return true;
  }

  if (event.target.closest("[data-add-element-inline]")) {
    const templates = availableComponentTemplates();
    const defaultTemplate = templates.find((template) => template.id === "text-layout") || templates[0];
    if (!defaultTemplate) {
      setStatus("No elements are available for this site.", true);
      return true;
    }

    void getModalFormHandler()({
      label: "Add element",
      title: "Add an element",
      fields: [
        {
          name: "templateId",
          label: "Element",
          type: "select",
          value: defaultTemplate.id,
          options: templates.map((template) => ({ value: template.id, label: template.label }))
        }
      ],
      submitLabel: "Add element"
    }).then((values) => {
      if (values?.templateId) void addElementTemplate(values.templateId);
    });
    return true;
  }

  if (event.target.closest("[data-add-article-inline]")) {
    void addArticle();
    return true;
  }

  if (event.target.closest("[data-add-product-inline]")) {
    createProductFromDashboard();
    return true;
  }

  if (event.target.closest("[data-publish-inline]")) {
    void publishPage();
    return true;
  }

  const productButton = event.target.closest("[data-edit-product]");
  if (productButton?.dataset.editProduct) {
    openProductEditor(productButton.dataset.editProduct);
    return true;
  }

  const builderBlock = event.target.closest("[data-builder-edit-block]")?.closest("[data-builder-block-key]");
  if (builderBlock?.dataset.builderBlockKey) {
    void editBuilderBlock(builderBlock.dataset.builderBlockKey);
    return true;
  }

  const visualItem = event.target.closest("[data-visual-block], [data-visual-section]");
  if (visualItem && !event.target.closest("a, button, input, textarea, select, [contenteditable='true']")) {
    selectVisualEditorItem(visualItem);
    return true;
  }

  return false;
}

function bindClickEvents() {
  elements.page.addEventListener("click", (event) => {
    if (event.target.closest("[data-forgot-password]")) {
      void requestPasswordResetFromLogin(event.target.closest("[data-admin-login-form]"));
      return;
    }

    if (bindDashboardClick(event)) return;
    if (bindSliderClick(event)) return;
    if (bindDesignSystemClick(event)) return;
    if (bindBuilderClick(event)) return;
    if (bindAdminClick(event)) return;
    if (bindInlineEditorClick(event)) return;
    handlePublicPageLink(event);
  });
}

function bindRichTextEvents() {
  elements.page.addEventListener("input", (event) => {
    const librarySearch = event.target.closest("[data-builder-library-search]");
    if (librarySearch) {
      applyBuilderLibraryFilters(librarySearch.closest("[data-builder-rail]"));
      return;
    }

    const richSource = event.target.closest("[data-rich-source]");
    if (richSource) refreshRichPreview(richSource.closest("[data-rich-editor]"));
  });
}

function bindSlugEvents() {
  elements.page.addEventListener("input", (event) => {
    const titleInput = event.target.closest("[data-title-source]");
    if (titleInput) {
      const form = titleInput.closest("form");
      const slugInput = form?.querySelector("[data-slug-target]");
      if (slugInput && slugInput.dataset.slugEdited !== "true") {
        slugInput.value = slugFromTitle(titleInput.value);
      }
      return;
    }

    const slugInput = event.target.closest("[data-slug-target]");
    if (slugInput) {
      slugInput.dataset.slugEdited = "true";
      slugInput.value = slugFromTitle(slugInput.value);
      return;
    }

    const editableSlug = event.target.closest("[data-editable-slug]");
    if (editableSlug && editableSlug.dataset.slugUnlocked === "true") {
      editableSlug.value = slugFromTitle(editableSlug.value);
      return;
    }

    const localeLanguageInput = event.target.closest("[data-locale-language-input]");
    if (localeLanguageInput) {
      syncLocaleLanguageFields(localeLanguageInput);
      return;
    }

    const localeCodeInput = event.target.closest("[data-locale-code-input]");
    if (localeCodeInput) {
      localeCodeInput.dataset.localeCodeEdited = "true";
      localeCodeInput.value = String(localeCodeInput.value || "").trim().toLowerCase();
    }
  });
}

function filePreviewHtml(files = []) {
  const canPreviewImages = typeof URL !== "undefined" && typeof URL.createObjectURL === "function";

  return files
    .filter((file) => file?.size)
    .map((file, index) => {
      const objectUrl = file.type?.startsWith("image/") && canPreviewImages ? URL.createObjectURL(file) : "";

      return `
        <span class="file-preview-item">
          ${objectUrl ? `<img src="${escapeHtml(objectUrl)}" alt="" />` : ""}
          <span>${escapeHtml(file.name || `File ${index + 1}`)}</span>
        </span>
      `;
    })
    .join("");
}

function bindFilePreviewEvents() {
  elements.page.addEventListener("change", (event) => {
    const input = event.target.closest("[data-file-preview-input]");
    const preview = input?.parentElement?.querySelector?.("[data-file-preview]");
    if (!input || !preview) return;

    preview.innerHTML = filePreviewHtml(Array.from(input.files || []));
  });
}

function bindBuilderControlEvents() {
  elements.page.addEventListener("change", (event) => {
    const pageTemplateSelect = event.target.closest("[data-page-template-select]");
    if (pageTemplateSelect) {
      const template = (state.cmsTemplates || []).find((item) => item.id === pageTemplateSelect.value && item.type === "PAGE");
      const form = pageTemplateSelect.closest("form");
      const layout = form?.elements?.namedItem?.("layout");
      const excerpt = form?.elements?.namedItem?.("excerpt");
      if (!template) {
        if (layout) layout.value = normalizePageLayout(pageTemplateSelect.dataset.pageTemplateDefaultLayout || "full-width");
        if (excerpt) excerpt.value = pageTemplateSelect.dataset.pageTemplateDefaultExcerpt || "";
        return;
      }

      if (layout) layout.value = normalizePageLayout(template.content?.content?.layout);
      if (excerpt) excerpt.value = template.content?.excerpt || "";
      return;
    }

    const containerSelect = event.target.closest("[data-move-builder-block-section]");
    if (!containerSelect?.value || !containerSelect.dataset.moveBuilderBlockSection) return;

    void reorderBuilderBlock(containerSelect.dataset.moveBuilderBlockSection, containerSelect.value);
  });
}

function bindStructuredTabEvents() {
  enhanceStructuredTabs(elements.page);
  elements.page.addEventListener("click", handleStructuredTabClick);
  elements.page.addEventListener("keydown", handleStructuredTabKeydown);
}

function bindShopControlEvents() {
  elements.page.addEventListener("input", (event) => {
    const form = event.target.closest("[data-shop-settings-form]");
    if (form) updateShopSettingsPreview(form);
  });

  elements.page.addEventListener("change", (event) => {
    const categorySelect = event.target.closest("[data-product-category-select]");
    if (categorySelect) {
      const fields = categorySelect.closest("form")?.querySelector("[data-new-category-fields]");
      if (fields) fields.hidden = categorySelect.value !== "__new";
    }

    const form = event.target.closest("[data-shop-settings-form]");
    if (form) updateShopSettingsPreview(form);
  });
}

function bindDesignSystemEvents() {
  const update = (event) => {
    const form = event.target.closest?.("[data-design-system-form]");
    if (!form) return;

    const colorTextInput = event.target.closest?.("[data-design-color-text-for]");
    if (colorTextInput && !syncDesignColorTextInput(form, colorTextInput, { restoreInvalid: event.type === "change" })) return;
    updateDesignSystemPreview(form, state.config?.siteSettings?.design);
  };

  elements.page.addEventListener("input", update);
  elements.page.addEventListener("change", update);
  elements.page.addEventListener("focusout", (event) => {
    const input = event.target.closest?.("[data-design-color-text-for]");
    const form = input?.closest?.("[data-design-system-form]");
    if (form && input?.getAttribute("aria-invalid") === "true") {
      syncDesignColorTextInput(form, input, { restoreInvalid: true });
    }
  });
}

function bindBuilderKeyboardEvents() {
  if (typeof window.addEventListener !== "function") return;

  window.addEventListener("keydown", (event) => {
    if (handleVisualEditorKeydown(event)) return;
    if (!document.querySelector("[data-page-builder]")) return;
    if (!event.metaKey && !event.ctrlKey) return;

    const target = event.target;
    if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;

    const key = String(event.key || "").toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) void redoBuilderChange();
      else void undoBuilderChange();
    } else if (key === "y") {
      event.preventDefault();
      void redoBuilderChange();
    }
  });
}

function bindVisualEditorFocusEvents() {
  elements.page.addEventListener("focusin", (event) => {
    const item = event.target.closest?.("[data-visual-block], [data-visual-section]");
    if (item && !event.target.closest?.("[data-editor-ui]")) selectVisualEditorItem(item);
  });
}

function bindDragEvents() {
  elements.page.addEventListener("dragstart", (event) => {
    const builderBlock = event.target.closest("[data-builder-block-key]");
    if (builderBlock?.dataset.builderBlockKey && event.dataTransfer) {
      event.dataTransfer.setData(builderDragType, JSON.stringify({ type: "block", blockKey: builderBlock.dataset.builderBlockKey }));
      event.dataTransfer.effectAllowed = "move";
      builderBlock.classList.add("dragging");
      return;
    }

    const builderSection = event.target.closest("[data-builder-section]");
    if (builderSection?.dataset.builderSection && event.dataTransfer) {
      event.dataTransfer.setData(builderDragType, JSON.stringify({ type: "section", sectionId: builderSection.dataset.builderSection }));
      event.dataTransfer.effectAllowed = "move";
      builderSection.classList.add("dragging");
      return;
    }

    const builderTemplate = event.target.closest("[data-builder-template]");
    if (builderTemplate?.dataset.builderTemplate && event.dataTransfer) {
      event.dataTransfer.setData(builderDragType, JSON.stringify({
        type: "template",
        templateId: builderTemplate.dataset.builderTemplate
      }));
      event.dataTransfer.setData("text/plain", builderTemplate.dataset.builderTemplate);
      event.dataTransfer.effectAllowed = "copy";
      builderTemplate.classList.add("dragging");
      return;
    }

    const reusableTemplate = event.target.closest("[data-builder-reusable-drag]");
    if (reusableTemplate?.dataset.builderReusableDrag && event.dataTransfer) {
      event.dataTransfer.setData(builderDragType, JSON.stringify({
        type: "reusable-template",
        templateId: reusableTemplate.dataset.builderReusableDrag
      }));
      event.dataTransfer.effectAllowed = "copy";
      reusableTemplate.classList.add("dragging");
      return;
    }

    const sectionPattern = event.target.closest("[data-builder-section-pattern]");
    if (sectionPattern?.dataset.builderSectionPattern && event.dataTransfer) {
      event.dataTransfer.setData(builderDragType, JSON.stringify({
        type: "section-pattern",
        patternId: sectionPattern.dataset.builderSectionPattern
      }));
      event.dataTransfer.effectAllowed = "copy";
      sectionPattern.classList.add("dragging");
      return;
    }

    const postTemplate = event.target.closest("[data-post-template]");
    if (postTemplate?.dataset.postTemplate && event.dataTransfer) {
      event.dataTransfer.setData("text/plain", postTemplate.dataset.postTemplate);
      event.dataTransfer.effectAllowed = "copy";
      postTemplate.classList.add("dragging");
    }
  });

  elements.page.addEventListener("dragover", (event) => {
    const builderTarget = event.target.closest("[data-builder-dropzone], [data-builder-section], [data-builder-canvas-dropzone]");
    if (builderTarget || event.target.closest("[data-post-editor-form] [data-rich-editor]")) {
      event.preventDefault();
      builderTarget?.classList.add("drag-over");
    }
  });

  elements.page.addEventListener("dragleave", (event) => {
    event.target.closest("[data-builder-dropzone], [data-builder-section], [data-builder-canvas-dropzone]")?.classList.remove("drag-over");
  });

  elements.page.addEventListener("drop", (event) => {
    const builderPayload = event.dataTransfer?.getData(builderDragType);
    if (builderPayload) {
      let payload = null;
      try {
        payload = JSON.parse(builderPayload);
      } catch {
        payload = null;
      }

      if (payload?.type === "block") {
        const dropzone = event.target.closest("[data-builder-dropzone]");
        const targetBlock = event.target.closest("[data-builder-block-key]");
        if (dropzone?.dataset.sectionId) {
          event.preventDefault();
          void reorderBuilderBlock(payload.blockKey, dropzone.dataset.sectionId, targetBlock?.dataset.builderBlockKey || "");
        }
      }

      if (payload?.type === "section") {
        const targetSection = event.target.closest("[data-builder-section]");
        if (targetSection?.dataset.builderSection) {
          event.preventDefault();
          void reorderBuilderSection(payload.sectionId, targetSection.dataset.builderSection);
        }
      }

      if (payload?.type === "template") {
        const dropzone = event.target.closest("[data-builder-dropzone]");
        const canvas = event.target.closest("[data-builder-canvas-dropzone]");
        if (dropzone || canvas) {
          event.preventDefault();
          void addTemplateToBuilder(payload.templateId, dropzone?.dataset.sectionId || "");
        }
      }

      if (payload?.type === "section-pattern") {
        const canvas = event.target.closest("[data-builder-canvas-dropzone]");
        if (canvas) {
          event.preventDefault();
          void addSectionPatternToBuilder(payload.patternId);
        }
      }

      if (payload?.type === "reusable-template") {
        const canvas = event.target.closest("[data-builder-canvas-dropzone]");
        if (canvas) {
          event.preventDefault();
          void addReusableTemplateToBuilder(payload.templateId);
        }
      }

      document.querySelectorAll?.(".drag-over, .dragging").forEach((element) => {
        element.classList.remove("drag-over", "dragging");
      });
      return;
    }

    const templateId = event.dataTransfer?.getData("text/plain");
    if (!templateId) return;

    const dropzone = event.target.closest("[data-builder-dropzone]");
    if (dropzone) {
      event.preventDefault();
      void addTemplateToBuilder(templateId, dropzone.dataset.sectionId);
      return;
    }

    if (event.target.closest("[data-post-editor-form] [data-rich-editor]")) {
      event.preventDefault();
      insertTemplateIntoPost(templateId);
    }
  });

  elements.page.addEventListener("dragend", () => {
    document.querySelectorAll?.(".drag-over, .dragging").forEach((element) => {
      element.classList.remove("drag-over", "dragging");
    });
  });
}

function bindMenuAndFooterEvents() {
  elements.menu.addEventListener("change", (event) => {
    const languageSelect = event.target.closest("[data-language-select]");
    if (!languageSelect?.value) return;

    window.history.pushState({}, "", languageSelect.value);
    void bootstrap();
  });

  elements.menu.addEventListener("click", (event) => {
    if (event.target.closest("[data-add-menu-item]")) {
      void addMenuItem();
      return;
    }

    const editButton = event.target.closest("[data-edit-menu-item]");
    if (editButton?.dataset.editMenuItem) {
      event.preventDefault();
      void editMenuItem(editButton.dataset.editMenuItem);
      return;
    }

    handlePublicPageLink(event);
  });

  elements.footer.addEventListener("click", (event) => {
    if (event.target.closest("[data-edit-footer]")) void editFooter();
  });
}

export function bindEvents() {
  bindSubmitEvents();
  bindClickEvents();
  bindRichTextEvents();
  bindSlugEvents();
  bindFilePreviewEvents();
  bindStructuredTabEvents();
  bindBuilderControlEvents();
  bindShopControlEvents();
  bindDesignSystemEvents();
  bindVisualEditorFocusEvents();
  bindBuilderKeyboardEvents();
  bindDragEvents();
  bindMenuAndFooterEvents();

  document.addEventListener?.("click", (event) => {
    closeVisualCommandMenus(event.target);
  });

  if (typeof window.addEventListener === "function") {
    window.addEventListener("popstate", () => {
      void bootstrap();
    });
  }
}
