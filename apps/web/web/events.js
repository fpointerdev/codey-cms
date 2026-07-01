import { availableComponentTemplates, elements, slugFromTitle, state } from "./core.js";
import { bootstrap } from "./controller.js";
import {
  addArticle,
  addElementTemplate,
  addLocaleRow,
  addMenuItem,
  addSection,
  createUserInvite,
  editBlock,
  editFooter,
  editMenuItem,
  editPageSettings,
  publishPage,
  removeLocaleRow,
  saveLocalizationSettings,
  syncLocaleLanguageFields,
  toggleLocalizationModule,
  saveSiteSettings
} from "./content-actions.js";
import {
  addBuilderContainer,
  addSectionPatternToBuilder,
  addTemplateToBuilder,
  addTemplateToBuilderSection,
  comparePageRevision,
  createPageFromBuilder,
  createPageFromDashboard,
  createPageTranslation,
  createPostFromDashboard,
  createPostTranslation,
  editBuilderBlock,
  editBuilderSection,
  insertTemplateIntoPost,
  linkExistingPageTranslation,
  linkExistingPostTranslation,
  loadPageRevisions,
  openOrCreatePageTranslation,
  openOrCreatePostTranslation,
  reorderBuilderBlock,
  reorderBuilderSection,
  restorePageRevision,
  savePageBuilderSettings,
  savePostEditor
} from "./builder-actions.js";
import { insertIntoTextarea, refreshRichPreview } from "./builder-views.js";
import {
  confirmPasswordReset,
  loginAdmin,
  logoutAdmin,
  requestPasswordResetFromLogin,
  submitContactForm
} from "./session-actions.js";
import {
  addRepeaterRow,
  createProductFromDashboard,
  openProductEditor,
  removeRepeaterRow,
  saveProductEditor
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

const builderDragType = "application/x-codey-builder";

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

function updateSlider(slider, nextIndex) {
  const track = slider.querySelector("[data-slider-track]");
  const slides = slider.querySelectorAll(".slider-slide");
  const visibleStyle = typeof getComputedStyle === "function" ? getComputedStyle(slider).getPropertyValue("--slider-visible") : "";
  const perView = Math.max(1, Number(visibleStyle || slider.dataset.sliderPerView || 1));
  const effect = slider.dataset.sliderEffect || "slide";
  const direction = slider.dataset.sliderDirection || "horizontal";
  const focus = slider.dataset.sliderFocus || "standard";
  const singleStep = effect === "fade" || effect === "zoom" || focus === "peek";
  const maxIndex = Math.max(0, slides.length - (singleStep ? 1 : perView));
  const loop = slider.dataset.sliderLoop === "true";
  let index = nextIndex;

  if (loop && slides.length > perView) {
    if (index < 0) index = maxIndex;
    if (index > maxIndex) index = 0;
  } else {
    index = Math.min(maxIndex, Math.max(0, index));
  }

  slider.dataset.sliderIndex = String(index);
  slides.forEach((slide, slideIndex) => {
    slide.classList.toggle("active", slideIndex === index);
    slide.classList.toggle("is-before", slideIndex < index);
    slide.classList.toggle("is-after", slideIndex > index);
  });

  if (track && (effect === "fade" || effect === "zoom")) {
    track.style.transform = "";
  } else if (track && focus === "peek") {
    const activeSlide = slides[index];
    const stage = slider.querySelector(".slider-stage");
    const offset = direction === "vertical"
      ? Math.max(0, activeSlide.offsetTop - ((stage?.clientHeight || activeSlide.clientHeight) - activeSlide.clientHeight) / 2)
      : Math.max(0, activeSlide.offsetLeft - ((stage?.clientWidth || activeSlide.clientWidth) - activeSlide.clientWidth) / 2);
    track.style.transform = direction === "vertical" ? `translateY(-${offset}px)` : `translateX(-${offset}px)`;
  } else if (track) {
    const amount = index * (100 / perView);
    track.style.transform = direction === "vertical" ? `translateY(-${amount}%)` : `translateX(-${amount}%)`;
  }

  const count = slider.querySelector("[data-slider-count]");
  if (count) count.textContent = `${index + 1} / ${Math.max(1, maxIndex + 1)}`;

  slider.querySelectorAll("[data-slider-caption]").forEach((caption) => {
    caption.classList.toggle("active", Number(caption.dataset.sliderCaption) === index);
  });

  const previous = slider.querySelector("[data-slider-prev]");
  const next = slider.querySelector("[data-slider-next]");
  if (previous) previous.disabled = maxIndex === 0 || !loop && index <= 0;
  if (next) next.disabled = maxIndex === 0 || !loop && index >= maxIndex;
}

function bindSliderClick(event) {
  const direction = event.target.closest("[data-slider-prev]") ? -1 : event.target.closest("[data-slider-next]") ? 1 : 0;
  if (!direction) return false;

  const slider = event.target.closest("[data-slider]");
  if (!slider) return false;

  event.preventDefault();
  updateSlider(slider, Number(slider.dataset.sliderIndex || 0) + direction);
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
    builderRailToggle.textContent = state.builderRailCollapsed ? "Elements" : "Collapse";
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
    void addTemplateToBuilder(builderTemplateButton.dataset.builderTemplate);
    return true;
  }

  const sectionPatternButton = event.target.closest("[data-builder-section-pattern]");
  if (sectionPatternButton?.dataset.builderSectionPattern) {
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
    void addBuilderContainer();
    return true;
  }

  const addElementButton = event.target.closest("[data-add-element-to-section]");
  if (addElementButton?.dataset.addElementToSection) {
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
  if (event.target.closest("[data-admin-logout]")) {
    void logoutAdmin();
    return true;
  }

  if (event.target.closest("[data-invite-user]")) {
    void createUserInvite();
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

    void getModalFormHandler()({
      label: "Page builder",
      title: "Choose element",
      fields: [
        {
          name: "templateId",
          label: "Element type",
          type: "select",
          value: templates[0]?.id || "",
          options: templates.map((template) => ({ value: template.id, label: template.label }))
        }
      ],
      submitLabel: "Continue"
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
    if (bindBuilderClick(event)) return;
    if (bindAdminClick(event)) return;
    if (bindInlineEditorClick(event)) return;
    handlePublicPageLink(event);
  });
}

function bindRichTextEvents() {
  elements.page.addEventListener("input", (event) => {
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
          ${objectUrl ? `<img src="${objectUrl}" alt="" />` : ""}
          <span>${file.name || `File ${index + 1}`}</span>
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
  bindDragEvents();
  bindMenuAndFooterEvents();

  if (typeof window.addEventListener === "function") {
    window.addEventListener("popstate", () => {
      void bootstrap();
    });
  }
}
