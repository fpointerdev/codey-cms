import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import {
  localizedPath,
  normalizeLocale,
  publicLocaleCodes,
  readLocalizationSettings
} from "../localization/localization.service.js";
import {
  sanitizeContentBlockValue,
  sanitizePostContent,
  sanitizeRichObject
} from "./rich-text-sanitizer.js";
import { buildSitemapXml, emptySitemapXml, type SitemapEntry } from "./sitemap.js";
import { enrichPublicMedia } from "./public-media.js";
import {
  ContactSubmissionService,
  type ContactSubmissionInput,
  type ContactSubmissionMeta
} from "./contact-submission.service.js";
import { RedirectService, type RedirectInput } from "./redirect.service.js";
import { MenuService, type MenuItemInput } from "./menu.service.js";

type CmsDatabase = PrismaClient | Prisma.TransactionClient;

type RequestUser = {
  id: string;
};

type ContentBlockInput = {
  key: string;
  type: Prisma.ContentBlockCreateInput["type"];
  label?: string;
  value: unknown;
  settings?: Record<string, unknown>;
  sortOrder: number;
  editable: boolean;
  mediaAssetId?: string;
};

type PageSectionInput = {
  key: string;
  label?: string;
  sortOrder: number;
  settings: Record<string, unknown>;
  blocks: ContentBlockInput[];
};

type CreatePageInput = {
  title: string;
  slug: string;
  locale?: string;
  translationGroupId?: string | null;
  excerpt?: string;
  content: Record<string, unknown>;
  metaTitle?: string;
  metaDescription?: string;
  seo?: Record<string, unknown>;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt?: Date;
  sections: PageSectionInput[];
};

type CreatePostInput = Omit<CreatePageInput, "sections"> & {
  tags: string[];
  categorySlugs: string[];
};

type UpdatePageInput = Partial<Omit<CreatePageInput, "sections">> & {
  sections?: PageSectionInput[];
};

type UpdatePostInput = Partial<CreatePostInput>;

type CmsTemplateType = "SECTION" | "PAGE";

type CmsTemplateContent =
  | { section: PageSectionInput }
  | { excerpt?: string; content: Record<string, unknown>; sections: PageSectionInput[] };

type CreateCmsTemplateInput = {
  name: string;
  description?: string;
  type: CmsTemplateType;
  content: CmsTemplateContent;
};

type UpdateCmsTemplateInput = {
  name?: string;
  description?: string | null;
  content?: CmsTemplateContent;
};

type CreateTranslationInput = {
  targetLocale: string;
  title?: string;
  slug?: string;
  excerpt?: string;
  metaTitle?: string;
  metaDescription?: string;
};

type PostQueryInput = {
  locale?: string;
  category?: string;
  tag?: string;
  q?: string;
  includeDrafts?: boolean;
};

type SeoSettings = {
  baseUrl: string;
  searchIndexing: boolean;
  sitemapEnabled: boolean;
};

const pageInclude = {
  sections: {
    orderBy: {
      sortOrder: "asc"
    },
    include: {
      blocks: {
        orderBy: {
          sortOrder: "asc"
        },
        include: {
          mediaAsset: true
        }
      }
    }
  }
} as const;

const postInclude = {
  categories: {
    include: {
      category: true
    }
  }
} as const;

function toJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function sanitizePageRecord<T extends {
  content: unknown;
  sections: Array<{ blocks: Array<{ type: string; value: unknown }> }>;
}>(page: T): T {
  return {
    ...page,
    content: sanitizeRichObject(page.content),
    sections: page.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({
        ...block,
        value: sanitizeContentBlockValue(block.type, block.value)
      }))
    }))
  };
}

function sanitizePostRecord<T extends { content: unknown }>(post: T): T {
  return {
    ...post,
    content: sanitizePostContent(post.content)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateUrlLike(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function validGalleryItems(value: unknown) {
  return Array.isArray(value) && value.every((item) =>
    isRecord(item) &&
    validateUrlLike(item.url) &&
    (item.alt === undefined || typeof item.alt === "string") &&
    (item.altText === undefined || typeof item.altText === "string") &&
    (item.caption === undefined || typeof item.caption === "string") &&
    (item.link === undefined || typeof item.link === "string")
  );
}

function validGallerySettings(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;

  const displayMode = value.displayMode;
  const layoutMode = value.layoutMode;
  const columnsDesktop = value.columnsDesktop;
  const columnsTablet = value.columnsTablet;
  const columnsMobile = value.columnsMobile;
  const gap = value.gap;
  const imageRatio = value.imageRatio;
  const objectFit = value.objectFit;
  const showCaptions = value.showCaptions;
  const lightbox = value.lightbox;
  const layoutModes = ["grid", "masonry", "justified"];
  const imageRatios = ["1 / 1", "4 / 3", "3 / 2", "16 / 9", "auto"];
  const objectFits = ["cover", "contain"];

  return (
    (displayMode === undefined || displayMode === "gallery") &&
    (layoutMode === undefined || typeof layoutMode === "string" && layoutModes.includes(layoutMode)) &&
    (columnsDesktop === undefined || typeof columnsDesktop === "number" && Number.isInteger(columnsDesktop) && columnsDesktop >= 1 && columnsDesktop <= 6) &&
    (columnsTablet === undefined || typeof columnsTablet === "number" && Number.isInteger(columnsTablet) && columnsTablet >= 1 && columnsTablet <= 4) &&
    (columnsMobile === undefined || typeof columnsMobile === "number" && Number.isInteger(columnsMobile) && columnsMobile >= 1 && columnsMobile <= 2) &&
    (gap === undefined || typeof gap === "number" && Number.isInteger(gap) && gap >= 0 && gap <= 48) &&
    (imageRatio === undefined || typeof imageRatio === "string" && imageRatios.includes(imageRatio)) &&
    (objectFit === undefined || typeof objectFit === "string" && objectFits.includes(objectFit)) &&
    (showCaptions === undefined || typeof showCaptions === "boolean") &&
    (lightbox === undefined || typeof lightbox === "boolean")
  );
}

function validSliderSettings(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;

  const slidesPerView = value.slidesPerView;
  const overlayColor = value.overlayColor;
  const overlayOpacity = value.overlayOpacity;
  const caption = value.caption;
  const textPosition = value.textPosition;
  const textWidth = value.textWidth;
  const displayMode = value.displayMode;
  const effect = value.effect;
  const direction = value.direction;
  const focusMode = value.focusMode;
  const loop = value.loop;
  const showNavigation = value.showNavigation;
  const navigationStyle = value.navigationStyle;
  const navigationPosition = value.navigationPosition;
  const textPositions = ["top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right"];
  const navigationStyles = ["pill", "circle", "minimal"];
  const navigationPositions = ["bottom-right", "bottom-center", "top-right", "center-sides"];
  const displayModes = ["slider", "carousel"];
  const effects = ["slide", "fade", "zoom"];
  const directions = ["horizontal", "vertical"];
  const focusModes = ["standard", "peek"];

  return (
    (slidesPerView === undefined || typeof slidesPerView === "number" && Number.isInteger(slidesPerView) && slidesPerView >= 1 && slidesPerView <= 6) &&
    (overlayColor === undefined || typeof overlayColor === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(overlayColor)) &&
    (overlayOpacity === undefined || typeof overlayOpacity === "number" && overlayOpacity >= 0 && overlayOpacity <= 0.9) &&
    (caption === undefined || typeof caption === "string") &&
    (textPosition === undefined || typeof textPosition === "string" && textPositions.includes(textPosition)) &&
    (textWidth === undefined || typeof textWidth === "number" && Number.isInteger(textWidth) && textWidth >= 24 && textWidth <= 100) &&
    (displayMode === undefined || typeof displayMode === "string" && displayModes.includes(displayMode)) &&
    (effect === undefined || typeof effect === "string" && effects.includes(effect)) &&
    (direction === undefined || typeof direction === "string" && directions.includes(direction)) &&
    (focusMode === undefined || typeof focusMode === "string" && focusModes.includes(focusMode)) &&
    (loop === undefined || typeof loop === "boolean") &&
    (showNavigation === undefined || typeof showNavigation === "boolean") &&
    (navigationStyle === undefined || typeof navigationStyle === "string" && navigationStyles.includes(navigationStyle)) &&
    (navigationPosition === undefined || typeof navigationPosition === "string" && navigationPositions.includes(navigationPosition))
  );
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function assertValidBlockValue(block: Pick<ContentBlockInput, "type" | "value" | "key">) {
  if (block.type === "TEXT" || block.type === "RICH_TEXT" || block.type === "EMBED") {
    if (typeof block.value !== "string") {
      throw new AppError(422, "invalid_content_block", `${block.key} must contain text.`);
    }
    return;
  }

  if (block.type === "IMAGE") {
    if (!isRecord(block.value) || !validateUrlLike(block.value.url)) {
      throw new AppError(422, "invalid_content_block", `${block.key} image block needs a url.`);
    }
    return;
  }

  if (block.type === "GALLERY") {
    const isLegacyGallery = validGalleryItems(block.value);
    const isConfiguredGallery =
      isRecord(block.value) && validGalleryItems(block.value.items) && validGallerySettings(block.value.settings);
    const isConfiguredSlider =
      isRecord(block.value) && validGalleryItems(block.value.slides) && validSliderSettings(block.value.settings);

    if (!isLegacyGallery && !isConfiguredGallery && !isConfiguredSlider) {
      throw new AppError(422, "invalid_content_block", `${block.key} gallery block needs image items.`);
    }
    return;
  }

  if (block.type === "BUTTON" || block.type === "CTA") {
    if (!isRecord(block.value) || !validateUrlLike(block.value.label) || !validateUrlLike(block.value.url)) {
      throw new AppError(422, "invalid_content_block", `${block.key} action block needs label and url.`);
    }
    return;
  }

  if (block.type === "CONTACT_FORM") {
    if (!isRecord(block.value)) {
      throw new AppError(422, "invalid_content_block", `${block.key} contact form block needs configuration.`);
    }

    const formKey = block.value.formKey;
    if (formKey !== undefined && !validateUrlLike(formKey)) {
      throw new AppError(422, "invalid_content_block", `${block.key} contact form needs a valid formKey.`);
    }

    return;
  }

  if (block.type === "PRODUCT_LIST") {
    if (!isRecord(block.value)) {
      throw new AppError(422, "invalid_content_block", `${block.key} product list block needs configuration.`);
    }
  }
}

function assertUniqueKeys(sections: PageSectionInput[]) {
  const sectionKeys = new Set<string>();
  const blockKeys = new Set<string>();

  for (const section of sections) {
    if (sectionKeys.has(section.key)) {
      throw new AppError(422, "duplicate_section_key", `Duplicate section key: ${section.key}`);
    }
    sectionKeys.add(section.key);

    for (const block of section.blocks) {
      if (blockKeys.has(block.key)) {
        throw new AppError(422, "duplicate_block_key", `Duplicate content block key: ${block.key}`);
      }
      blockKeys.add(block.key);
      assertValidBlockValue(block);
    }
  }
}

function templateSectionInput(section: PageSectionInput): PageSectionInput {
  return {
    key: section.key,
    label: section.label,
    sortOrder: section.sortOrder,
    settings: section.settings,
    blocks: section.blocks.map((block) => {
      const value = sanitizeContentBlockValue(block.type, block.value);
      const sanitized = {
        key: block.key,
        type: block.type,
        label: block.label,
        value,
        settings: block.settings,
        sortOrder: block.sortOrder,
        editable: block.editable,
        mediaAssetId: block.mediaAssetId
      };
      assertValidBlockValue(sanitized);

      return sanitized;
    })
  };
}

function templateContentInput(type: CmsTemplateType, value: CmsTemplateContent) {
  if (type === "SECTION") {
    if (!("section" in value)) {
      throw new AppError(422, "invalid_template_content", "Section templates need one section.");
    }

    assertUniqueKeys([value.section]);
    return { section: templateSectionInput(value.section) };
  }

  if (!("sections" in value) || !("content" in value)) {
    throw new AppError(422, "invalid_template_content", "Page templates need page content and sections.");
  }

  assertUniqueKeys(value.sections);
  return {
    ...(value.excerpt ? { excerpt: value.excerpt } : {}),
    content: sanitizeRichObject(value.content),
    sections: value.sections.map(templateSectionInput)
  };
}

function normalizePublishData(input: {
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt?: Date;
}) {
  if (input.status === "PUBLISHED" && !input.publishedAt) {
    return { publishedAt: new Date() };
  }

  return {};
}

function visibleContentWhere(now = new Date()) {
  return {
    status: "PUBLISHED" as const,
    OR: [
      {
        publishedAt: null
      },
      {
        publishedAt: {
          lte: now
        }
      }
    ]
  };
}

function cleanPostData(input: Partial<CreatePostInput>) {
  return {
    title: input.title,
    slug: input.slug,
    locale: input.locale ? normalizeLocale(input.locale) : undefined,
    translationGroupId: input.translationGroupId,
    excerpt: input.excerpt,
    content: input.content ? toJson(sanitizePostContent(input.content)) : undefined,
    metaTitle: input.metaTitle,
    metaDescription: input.metaDescription,
    seo: input.seo ? toJson(input.seo) : undefined,
    status: input.status,
    publishedAt: input.publishedAt,
    tags: input.tags ? uniqueStrings(input.tags) : undefined,
    ...normalizePublishData(input)
  };
}

function createPostData(input: CreatePostInput) {
  return {
    title: input.title,
    slug: input.slug,
    locale: normalizeLocale(input.locale),
    translationGroupId: input.translationGroupId,
    excerpt: input.excerpt,
    content: toJson(sanitizePostContent(input.content)),
    metaTitle: input.metaTitle,
    metaDescription: input.metaDescription,
    seo: input.seo ? toJson(input.seo) : undefined,
    status: input.status,
    publishedAt: input.publishedAt,
    tags: uniqueStrings(input.tags),
    ...normalizePublishData(input)
  };
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/g, "");
}

function normalizePublicBaseUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";

  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function localizedResourcePath(prefix: string, slug: string, locale: string, defaultLocale = "en") {
  const localeCode = normalizeLocale(locale);
  const defaultLocaleCode = normalizeLocale(defaultLocale);
  const normalizedSlug = slug
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  const path = `/${prefix}/${normalizedSlug}`;

  return localeCode === defaultLocaleCode ? path : `/${localeCode}${path}`;
}

function cleanPageData(input: UpdatePageInput) {
  return {
    title: input.title,
    slug: input.slug,
    locale: input.locale ? normalizeLocale(input.locale) : undefined,
    translationGroupId: input.translationGroupId,
    excerpt: input.excerpt,
    content: input.content ? toJson(sanitizeRichObject(input.content)) : undefined,
    metaTitle: input.metaTitle,
    metaDescription: input.metaDescription,
    seo: input.seo ? toJson(input.seo) : undefined,
    status: input.status,
    publishedAt: input.publishedAt,
    ...normalizePublishData(input)
  };
}

function pageSnapshot(page: Prisma.CmsPageGetPayload<{ include: typeof pageInclude }>) {
  return {
    page: {
      title: page.title,
      slug: page.slug,
      locale: page.locale,
      translationGroupId: page.translationGroupId,
      excerpt: page.excerpt,
      content: page.content,
      metaTitle: page.metaTitle,
      metaDescription: page.metaDescription,
      seo: page.seo,
      status: page.status,
      publishedAt: page.publishedAt?.toISOString() ?? null
    },
    sections: page.sections.map((section) => ({
      key: section.key,
      label: section.label,
      sortOrder: section.sortOrder,
      settings: section.settings,
      blocks: section.blocks.map((block) => ({
        key: block.key,
        type: block.type,
        label: block.label,
        value: block.value,
        settings: block.settings,
        sortOrder: block.sortOrder,
        editable: block.editable,
        mediaAssetId: block.mediaAssetId
      }))
    }))
  };
}

function pageSectionsInput(page: Prisma.CmsPageGetPayload<{ include: typeof pageInclude }>) {
  return page.sections.map((section) => ({
    key: section.key,
    label: section.label ?? undefined,
    sortOrder: section.sortOrder,
    settings: section.settings as Record<string, unknown>,
    blocks: section.blocks.map((block) => ({
      key: block.key,
      type: block.type,
      label: block.label ?? undefined,
      value: block.value,
      settings: block.settings as Record<string, unknown> | undefined,
      sortOrder: block.sortOrder,
      editable: block.editable,
      mediaAssetId: block.mediaAssetId ?? undefined
    }))
  }));
}

function changedFields(
  current: Prisma.CmsPageGetPayload<{ include: typeof pageInclude }>,
  snapshot: ReturnType<typeof pageSnapshot>
) {
  const currentSnapshot = pageSnapshot(current);
  const fields = Object.keys(currentSnapshot.page).filter((field) => {
    const key = field as keyof typeof currentSnapshot.page;
    return JSON.stringify(currentSnapshot.page[key]) !== JSON.stringify(snapshot.page[key]);
  });

  if (JSON.stringify(currentSnapshot.sections) !== JSON.stringify(snapshot.sections)) {
    fields.push("sections");
  }

  return fields;
}

export class CmsService {
  private readonly contactSubmissions: ContactSubmissionService;
  private readonly menus: MenuService;
  private readonly redirects: RedirectService;

  constructor(private readonly prisma: CmsDatabase) {
    this.contactSubmissions = new ContactSubmissionService(prisma);
    this.menus = new MenuService(prisma);
    this.redirects = new RedirectService(prisma);
  }

  private transaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
    if ("$transaction" in this.prisma) {
      return this.prisma.$transaction(operation);
    }

    return operation(this.prisma);
  }

  private async defaultSiteId() {
    const site = await this.prisma.site.findUnique({
      where: { slug: "default" },
      select: { id: true }
    });

    if (!site) {
      throw new AppError(503, "site_not_initialized", "Initialize the site before managing reusable templates.");
    }

    return site.id;
  }

  async listTemplates(type?: CmsTemplateType) {
    const siteId = await this.defaultSiteId();

    return this.prisma.cmsTemplate.findMany({
      where: {
        siteId,
        ...(type ? { type } : {})
      },
      orderBy: [{ type: "asc" }, { updatedAt: "desc" }]
    });
  }

  async createTemplate(input: CreateCmsTemplateInput) {
    const siteId = await this.defaultSiteId();

    return this.prisma.cmsTemplate.create({
      data: {
        siteId,
        name: input.name,
        description: input.description,
        type: input.type,
        content: toJson(templateContentInput(input.type, input.content))
      }
    });
  }

  async updateTemplate(templateId: string, input: UpdateCmsTemplateInput) {
    const siteId = await this.defaultSiteId();
    const existing = await this.prisma.cmsTemplate.findFirst({
      where: { id: templateId, siteId }
    });
    if (!existing) throw new AppError(404, "cms_template_not_found", "Reusable template not found.");

    return this.prisma.cmsTemplate.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        description: input.description,
        content: input.content === undefined
          ? undefined
          : toJson(templateContentInput(existing.type, input.content))
      }
    });
  }

  async deleteTemplate(templateId: string) {
    const siteId = await this.defaultSiteId();
    const deleted = await this.prisma.cmsTemplate.deleteMany({
      where: { id: templateId, siteId }
    });

    if (!deleted.count) throw new AppError(404, "cms_template_not_found", "Reusable template not found.");
  }

  async listPages(input: { locale?: string } = {}) {
    return this.prisma.cmsPage.findMany({
      where: input.locale
        ? {
            locale: normalizeLocale(input.locale)
          }
        : undefined,
      orderBy: {
        updatedAt: "desc"
      },
      take: 100,
      select: {
        id: true,
        title: true,
        slug: true,
        locale: true,
        translationGroupId: true,
        status: true,
        excerpt: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async getPage(slug: string, locale = "en") {
    const page = await this.prisma.cmsPage.findFirstOrThrow({
      where: {
        slug,
        locale: normalizeLocale(locale)
      },
      include: pageInclude
    });
    const translationGroupId = page.translationGroupId || page.slug;
    const translations = await this.prisma.cmsPage.findMany({
      where: {
        OR: [
          { id: page.id },
          { translationGroupId }
        ],
        status: "PUBLISHED"
      },
      select: {
        title: true,
        slug: true,
        locale: true,
        status: true
      },
      orderBy: {
        locale: "asc"
      }
    });

    const sanitizedPage = await enrichPublicMedia(this.prisma, sanitizePageRecord(page));

    return {
      ...sanitizedPage,
      translations
    };
  }

  async createPage(input: CreatePageInput, user?: RequestUser) {
    assertUniqueKeys(input.sections);

    return this.transaction(async (tx) => {
      const page = await tx.cmsPage.create({
        data: {
          title: input.title,
          slug: input.slug,
          locale: normalizeLocale(input.locale),
          translationGroupId: input.translationGroupId,
          excerpt: input.excerpt,
          content: toJson(sanitizeRichObject(input.content)),
          metaTitle: input.metaTitle,
          metaDescription: input.metaDescription,
          seo: input.seo ? toJson(input.seo) : undefined,
          status: input.status,
          publishedAt: input.publishedAt,
          ...normalizePublishData(input)
        }
      });

      await this.replaceSections(tx, page.id, input.sections);
      await this.createRevision(tx, page.id, "create", user?.id);

      return this.findPageById(tx, page.id);
    });
  }

  async createPageTranslation(
    sourceSlug: string,
    input: CreateTranslationInput,
    user?: RequestUser,
    sourceLocale = "en"
  ) {
    const targetLocale = normalizeLocale(input.targetLocale);
    const normalizedSourceLocale = normalizeLocale(sourceLocale);

    if (targetLocale === normalizedSourceLocale) {
      throw new AppError(409, "same_translation_locale", "Choose a different target language.");
    }

    return this.transaction(async (tx) => {
      const sourcePage = await tx.cmsPage.findFirstOrThrow({
        where: {
          slug: sourceSlug,
          locale: normalizedSourceLocale
        },
        include: pageInclude
      });
      const translationGroupId = sourcePage.translationGroupId || sourcePage.slug;
      const existingTranslation = await tx.cmsPage.findFirst({
        where: {
          locale: targetLocale,
          translationGroupId
        },
        select: {
          slug: true
        }
      });

      if (existingTranslation) {
        throw new AppError(409, "translation_exists", "A translation already exists for this language.");
      }

      if (!sourcePage.translationGroupId) {
        await tx.cmsPage.update({
          where: {
            id: sourcePage.id
          },
          data: {
            translationGroupId
          }
        });
      }

      const page = await tx.cmsPage.create({
        data: {
          title: input.title || sourcePage.title,
          slug: input.slug || sourcePage.slug,
          locale: targetLocale,
          translationGroupId,
          excerpt: input.excerpt ?? sourcePage.excerpt,
          content: toJson(sanitizeRichObject(sourcePage.content)),
          metaTitle: input.metaTitle ?? sourcePage.metaTitle,
          metaDescription: input.metaDescription ?? sourcePage.metaDescription,
          seo: sourcePage.seo === null ? undefined : toJson(sourcePage.seo),
          status: "DRAFT",
          publishedAt: null
        }
      });

      await this.replaceSections(tx, page.id, pageSectionsInput(sourcePage));
      await this.createRevision(tx, page.id, "translation.create", user?.id);

      return this.findPageById(tx, page.id);
    });
  }

  async updatePage(slug: string, input: UpdatePageInput, user?: RequestUser, locale = "en") {
    if (input.sections) {
      assertUniqueKeys(input.sections);
    }

    return this.transaction(async (tx) => {
      const existingPage = await tx.cmsPage.findFirstOrThrow({
        where: {
          slug,
          locale: normalizeLocale(locale)
        },
        include: pageInclude
      });

      await this.createRevision(tx, existingPage.id, "update", user?.id);
      await tx.cmsPage.update({
        where: { id: existingPage.id },
        data: cleanPageData(input)
      });

      if (input.sections) {
        await this.replaceSections(tx, existingPage.id, input.sections);
      }

      return this.findPageById(tx, existingPage.id);
    });
  }

  async addSection(slug: string, input: PageSectionInput, user?: RequestUser, locale = "en") {
    assertUniqueKeys([input]);

    return this.transaction(async (tx) => {
      const page = await tx.cmsPage.findFirstOrThrow({
        where: {
          slug,
          locale: normalizeLocale(locale)
        },
        include: pageInclude
      });

      await this.createRevision(tx, page.id, "section.add", user?.id);
      const section = await tx.pageSection.create({
        data: {
          pageId: page.id,
          key: input.key,
          label: input.label,
          sortOrder: input.sortOrder,
          settings: toJson(input.settings)
        }
      });
      await this.createBlocks(tx, page.id, section.id, input.blocks);

      return this.findPageById(tx, page.id);
    });
  }

  async addContentBlock(
    slug: string,
    sectionId: string,
    input: ContentBlockInput,
    user?: RequestUser,
    locale = "en"
  ) {
    assertValidBlockValue(input);

    return this.transaction(async (tx) => {
      const page = await tx.cmsPage.findFirstOrThrow({
        where: {
          slug,
          locale: normalizeLocale(locale)
        },
        include: pageInclude
      });
      const section = await tx.pageSection.findFirst({
        where: {
          id: sectionId,
          pageId: page.id
        }
      });

      if (!section) {
        throw new AppError(404, "section_not_found", "Section not found.");
      }

      await this.createRevision(tx, page.id, "block.add", user?.id);
      await this.createBlocks(tx, page.id, section.id, [input]);

      return this.findPageById(tx, page.id);
    });
  }

  async updateContentBlock(
    slug: string,
    blockKey: string,
    input: {
      label?: string;
      value?: unknown;
      settings?: Record<string, unknown>;
      editable?: boolean;
      mediaAssetId?: string | null;
    },
    user?: RequestUser,
    locale = "en"
  ) {
    return this.transaction(async (tx) => {
      const page = await tx.cmsPage.findFirstOrThrow({
        where: {
          slug,
          locale: normalizeLocale(locale)
        },
        include: pageInclude
      });
      const block = await tx.contentBlock.findUnique({
        where: {
          pageId_key: {
            pageId: page.id,
            key: blockKey
          }
        }
      });

      if (!block) {
        throw new AppError(404, "content_block_not_found", "Content block not found.");
      }

      if (!block.editable) {
        throw new AppError(409, "content_block_locked", "This content block is not editable.");
      }

      const value = sanitizeContentBlockValue(block.type, input.value ?? block.value);
      assertValidBlockValue({
        key: block.key,
        type: block.type,
        value
      });

      await this.createRevision(tx, page.id, "block.update", user?.id);
      await tx.contentBlock.update({
        where: {
          id: block.id
        },
        data: {
          label: input.label,
          value: input.value === undefined ? undefined : toJson(value),
          settings: input.settings === undefined ? undefined : toJson(input.settings),
          editable: input.editable,
          mediaAssetId: input.mediaAssetId
        }
      });

      return this.findPageById(tx, page.id);
    });
  }

  async publishPage(slug: string, user?: RequestUser, locale = "en") {
    return this.transaction(async (tx) => {
      const page = await tx.cmsPage.findFirstOrThrow({
        where: {
          slug,
          locale: normalizeLocale(locale)
        },
        include: pageInclude
      });

      await this.createRevision(tx, page.id, "publish", user?.id);
      await tx.cmsPage.update({
        where: { id: page.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date()
        }
      });

      return this.findPageById(tx, page.id);
    });
  }

  async archivePage(slug: string, user?: RequestUser, locale = "en") {
    return this.transaction(async (tx) => {
      const page = await tx.cmsPage.findFirstOrThrow({
        where: {
          slug,
          locale: normalizeLocale(locale)
        },
        include: pageInclude
      });

      await this.createRevision(tx, page.id, "archive", user?.id);
      await tx.cmsPage.update({
        where: { id: page.id },
        data: {
          status: "ARCHIVED"
        }
      });

      return this.findPageById(tx, page.id);
    });
  }

  async listRevisions(slug: string, locale = "en") {
    const page = await this.prisma.cmsPage.findFirstOrThrow({
      where: {
        slug,
        locale: normalizeLocale(locale)
      },
      select: { id: true }
    });

    return this.prisma.contentRevision.findMany({
      where: {
        pageId: page.id
      },
      orderBy: {
        version: "desc"
      }
    });
  }

  async compareRevision(slug: string, revisionId: string, locale = "en") {
    const page = await this.getPage(slug, locale);
    const revision = await this.findRevision(page.id, revisionId);
    const snapshot = revision.snapshot as ReturnType<typeof pageSnapshot>;

    return {
      revision,
      changedFields: changedFields(page, snapshot)
    };
  }

  async restoreRevision(slug: string, revisionId: string, user?: RequestUser, locale = "en") {
    return this.transaction(async (tx) => {
      const page = await tx.cmsPage.findFirstOrThrow({
        where: {
          slug,
          locale: normalizeLocale(locale)
        },
        include: pageInclude
      });
      const revision = await this.findRevision(page.id, revisionId, tx);
      const snapshot = revision.snapshot as ReturnType<typeof pageSnapshot>;

      await this.createRevision(tx, page.id, "restore", user?.id);
      await tx.cmsPage.update({
        where: { id: page.id },
        data: {
          title: snapshot.page.title,
          slug: snapshot.page.slug,
          locale: normalizeLocale(snapshot.page.locale),
          translationGroupId: snapshot.page.translationGroupId,
          excerpt: snapshot.page.excerpt,
          content: toJson(sanitizeRichObject(snapshot.page.content)),
          metaTitle: snapshot.page.metaTitle,
          metaDescription: snapshot.page.metaDescription,
          seo: snapshot.page.seo === null ? Prisma.DbNull : toJson(snapshot.page.seo),
          status: snapshot.page.status,
          publishedAt: snapshot.page.publishedAt ? new Date(snapshot.page.publishedAt) : null
        }
      });
      await this.replaceSections(tx, page.id, snapshot.sections as PageSectionInput[]);

      return this.findPageById(tx, page.id);
    });
  }

  async listCategories(input: { locale?: string } = {}) {
    return this.prisma.cmsCategory.findMany({
      where: input.locale
        ? {
            locale: normalizeLocale(input.locale)
          }
        : undefined,
      orderBy: {
        name: "asc"
      }
    });
  }

  async createCategory(input: {
    name: string;
    slug: string;
    locale?: string;
    translationGroupId?: string | null;
    description?: string;
  }) {
    return this.prisma.cmsCategory.create({
      data: {
        ...input,
        locale: normalizeLocale(input.locale)
      }
    });
  }

  async updateCategory(
    slug: string,
    input: Partial<{
      name: string;
      slug: string;
      locale: string;
      translationGroupId: string | null;
      description?: string;
    }>,
    locale = "en"
  ) {
    const category = await this.prisma.cmsCategory.findFirstOrThrow({
      where: {
        slug,
        locale: normalizeLocale(locale)
      }
    });

    return this.prisma.cmsCategory.update({
      where: {
        id: category.id
      },
      data: {
        ...input,
        locale: input.locale ? normalizeLocale(input.locale) : undefined
      }
    });
  }

  async deleteCategory(slug: string, locale = "en") {
    const category = await this.prisma.cmsCategory.findFirstOrThrow({
      where: {
        slug,
        locale: normalizeLocale(locale)
      },
      select: {
        id: true
      }
    });

    await this.prisma.cmsCategory.delete({
      where: {
        id: category.id
      }
    });
  }

  async listPosts(input: PostQueryInput = {}, canReadDrafts = false) {
    const locale = normalizeLocale(input.locale);
    const where: Prisma.CmsPostWhereInput = {
      locale
    };
    const filters: Prisma.CmsPostWhereInput[] = [];

    if (!canReadDrafts || !input.includeDrafts) {
      filters.push(visibleContentWhere());
    }

    if (input.category) {
      filters.push({
        categories: {
          some: {
            category: {
              slug: input.category,
              locale
            }
          }
        }
      });
    }

    if (input.tag) {
      filters.push({
        tags: {
          has: input.tag
        }
      });
    }

    if (input.q) {
      filters.push({
        OR: [
          {
            title: {
              contains: input.q,
              mode: "insensitive"
            }
          },
          {
            excerpt: {
              contains: input.q,
              mode: "insensitive"
            }
          }
        ]
      });
    }

    if (filters.length > 0) {
      where.AND = filters;
    }

    const posts = await this.prisma.cmsPost.findMany({
      where,
      include: postInclude,
      orderBy: [
        {
          publishedAt: "desc"
        },
        {
          createdAt: "desc"
        }
      ]
    });

    return posts.map(sanitizePostRecord);
  }

  async getPost(slug: string, locale = "en") {
    const post = await this.prisma.cmsPost.findFirstOrThrow({
      where: {
        slug,
        locale: normalizeLocale(locale)
      },
      include: postInclude
    });
    const translationGroupId = post.translationGroupId || post.slug;
    const translations = await this.prisma.cmsPost.findMany({
      where: {
        OR: [
          { id: post.id },
          { translationGroupId }
        ],
        status: "PUBLISHED"
      },
      select: {
        title: true,
        slug: true,
        locale: true,
        status: true
      },
      orderBy: {
        locale: "asc"
      }
    });

    return {
      ...sanitizePostRecord(post),
      translations
    };
  }

  async createPost(input: CreatePostInput, user?: RequestUser) {
    return this.transaction(async (tx) => {
      const post = await tx.cmsPost.create({
        data: createPostData(input)
      });

      await this.replacePostCategories(tx, post.id, input.categorySlugs, post.locale);
      await this.createPostRevision(tx, post.id, "create", user?.id);

      return this.findPostById(tx, post.id);
    });
  }

  async createPostTranslation(
    sourceSlug: string,
    input: CreateTranslationInput,
    user?: RequestUser,
    sourceLocale = "en"
  ) {
    const targetLocale = normalizeLocale(input.targetLocale);
    const normalizedSourceLocale = normalizeLocale(sourceLocale);

    if (targetLocale === normalizedSourceLocale) {
      throw new AppError(409, "same_translation_locale", "Choose a different target language.");
    }

    return this.transaction(async (tx) => {
      const sourcePost = await tx.cmsPost.findFirstOrThrow({
        where: {
          slug: sourceSlug,
          locale: normalizedSourceLocale
        },
        include: postInclude
      });
      const translationGroupId = sourcePost.translationGroupId || sourcePost.slug;
      const existingTranslation = await tx.cmsPost.findFirst({
        where: {
          locale: targetLocale,
          translationGroupId
        },
        select: {
          slug: true
        }
      });

      if (existingTranslation) {
        throw new AppError(409, "translation_exists", "A translation already exists for this language.");
      }

      if (!sourcePost.translationGroupId) {
        await tx.cmsPost.update({
          where: {
            id: sourcePost.id
          },
          data: {
            translationGroupId
          }
        });
      }

      const post = await tx.cmsPost.create({
        data: createPostData({
          title: input.title || sourcePost.title,
          slug: input.slug || sourcePost.slug,
          locale: targetLocale,
          translationGroupId,
          excerpt: input.excerpt ?? sourcePost.excerpt ?? undefined,
          content: sourcePost.content as Record<string, unknown>,
          metaTitle: input.metaTitle ?? sourcePost.metaTitle ?? undefined,
          metaDescription: input.metaDescription ?? sourcePost.metaDescription ?? undefined,
          seo: sourcePost.seo as Record<string, unknown> | undefined,
          status: "DRAFT",
          tags: sourcePost.tags,
          categorySlugs: []
        })
      });

      await this.createPostRevision(tx, post.id, "translation.create", user?.id);

      return this.findPostById(tx, post.id);
    });
  }

  async updatePost(slug: string, input: UpdatePostInput, user?: RequestUser, locale = "en") {
    return this.transaction(async (tx) => {
      const post = await tx.cmsPost.findFirstOrThrow({
        where: {
          slug,
          locale: normalizeLocale(locale)
        }
      });

      await this.createPostRevision(tx, post.id, "update", user?.id);
      await tx.cmsPost.update({
        where: {
          id: post.id
        },
        data: cleanPostData(input)
      });

      if (input.categorySlugs) {
        await this.replacePostCategories(tx, post.id, input.categorySlugs, input.locale ?? post.locale);
      }

      return this.findPostById(tx, post.id);
    });
  }

  async createMenu(input: { slug: string; name: string; location: string; locale?: string }) {
    return this.menus.create(input);
  }

  async getMenu(slug: string, canReadDrafts: boolean, locale = "en") {
    return this.menus.get(slug, canReadDrafts, locale);
  }

  async createMenuItem(menuSlug: string, input: MenuItemInput, locale = "en") {
    return this.menus.createItem(menuSlug, input, locale);
  }

  async updateMenuItem(menuSlug: string, itemId: string, input: Partial<MenuItemInput>, locale = "en") {
    return this.menus.updateItem(menuSlug, itemId, input, locale);
  }

  async deleteMenuItem(menuSlug: string, itemId: string, locale = "en") {
    await this.menus.deleteItem(menuSlug, itemId, locale);
  }

  async listRedirects() {
    return this.redirects.list();
  }

  async createRedirect(input: RedirectInput) {
    return this.redirects.create(input);
  }

  async updateRedirect(redirectId: string, input: Partial<RedirectInput>) {
    return this.redirects.update(redirectId, input);
  }

  async deleteRedirect(redirectId: string) {
    await this.redirects.delete(redirectId);
  }

  async resolveRedirect(path: string) {
    return this.redirects.resolve(path);
  }

  private async readSeoSettings(baseUrl: string): Promise<SeoSettings> {
    const fallbackBaseUrl = trimTrailingSlash(baseUrl);
    const database = this.prisma as unknown as Record<string, any>;
    const siteDelegate = database.site;
    const settingDelegate = database.moduleSetting;

    if (!siteDelegate?.findUnique || !settingDelegate?.findFirst) {
      return {
        baseUrl: fallbackBaseUrl,
        searchIndexing: true,
        sitemapEnabled: true
      };
    }

    try {
      const site = await siteDelegate.findUnique({
        where: {
          slug: "default"
        },
        select: {
          id: true
        }
      });
      if (!site) {
        return {
          baseUrl: fallbackBaseUrl,
          searchIndexing: true,
          sitemapEnabled: true
        };
      }

      const setting = await settingDelegate.findFirst({
        where: {
          siteId: site.id,
          moduleId: "config",
          key: "site"
        }
      });
      const value = setting?.value;
      const settings = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      const configuredBaseUrl = normalizePublicBaseUrl(settings.siteUrl);

      return {
        baseUrl: configuredBaseUrl || fallbackBaseUrl,
        searchIndexing: settings.searchIndexing !== false,
        sitemapEnabled: settings.sitemapEnabled !== false
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
        return {
          baseUrl: fallbackBaseUrl,
          searchIndexing: true,
          sitemapEnabled: true
        };
      }

      throw error;
    }
  }

  private async listProductsForSitemap(locales: string[]) {
    try {
      return await this.prisma.product.findMany({
        where: {
          locale: { in: locales },
          status: "ACTIVE"
        },
        orderBy: {
          updatedAt: "desc"
        },
        select: {
          slug: true,
          locale: true,
          translationGroupId: true,
          updatedAt: true
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) {
        return [];
      }

      throw error;
    }
  }

  async buildSitemap(baseUrl: string) {
    const [seoSettings, localization] = await Promise.all([
      this.readSeoSettings(baseUrl),
      readLocalizationSettings(this.prisma)
    ]);
    const origin = trimTrailingSlash(seoSettings.baseUrl);
    if (!seoSettings.searchIndexing || !seoSettings.sitemapEnabled) return emptySitemapXml();
    const locales = publicLocaleCodes(localization);

    type LocalizedSitemapRecord = {
      slug: string;
      locale: string;
      translationGroupId: string | null;
      updatedAt: Date;
    };

    let pages: LocalizedSitemapRecord[] = [];
    let posts: LocalizedSitemapRecord[] = [];
    let products: LocalizedSitemapRecord[] = [];
    let productCategories: LocalizedSitemapRecord[] = [];

    try {
      [pages, posts, products, productCategories] = await Promise.all([
        this.prisma.cmsPage.findMany({
          where: {
            ...visibleContentWhere(),
            locale: { in: locales }
          },
          orderBy: {
            updatedAt: "desc"
          },
          select: {
            slug: true,
            locale: true,
            translationGroupId: true,
            updatedAt: true
          }
        }),
        this.prisma.cmsPost.findMany({
          where: {
            ...visibleContentWhere(),
            locale: { in: locales }
          },
          orderBy: {
            updatedAt: "desc"
          },
          select: {
            slug: true,
            locale: true,
            translationGroupId: true,
            updatedAt: true
          }
        }),
        this.listProductsForSitemap(locales),
        this.prisma.productCategory.findMany({
          where: { locale: { in: locales } },
          orderBy: { updatedAt: "desc" },
          select: {
            slug: true,
            locale: true,
            translationGroupId: true,
            updatedAt: true
          }
        })
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) {
        return emptySitemapXml();
      }

      throw error;
    }
    const urls: SitemapEntry[] = [
      ...pages.map((page) => ({
        loc: `${origin}${localizedPath(page.slug, page.locale, localization.defaultLocale)}`,
        lastmod: page.updatedAt,
        locale: page.locale,
        groupKey: `page:${page.translationGroupId || `${page.locale}:${page.slug}`}`
      })),
      ...posts.map((post) => {
        return {
          loc: `${origin}${localizedResourcePath("posts", post.slug, post.locale, localization.defaultLocale)}`,
          lastmod: post.updatedAt,
          locale: post.locale,
          groupKey: `post:${post.translationGroupId || `${post.locale}:${post.slug}`}`
        };
      }),
      ...products.map((product) => {
        return {
          loc: `${origin}${localizedResourcePath("product", product.slug, product.locale, localization.defaultLocale)}`,
          lastmod: product.updatedAt,
          locale: product.locale,
          groupKey: `product:${product.translationGroupId || `${product.locale}:${product.slug}`}`
        };
      }),
      ...productCategories.map((category) => ({
        loc: `${origin}${localizedResourcePath("shop/category", category.slug, category.locale, localization.defaultLocale)}`,
        lastmod: category.updatedAt,
        locale: category.locale,
        groupKey: `product-category:${category.translationGroupId || `${category.locale}:${category.slug}`}`
      }))
    ];

    if (products.length > 0) {
      const lastmod = products.reduce(
        (latest, product) => product.updatedAt > latest ? product.updatedAt : latest,
        products[0].updatedAt
      );
      urls.push(...locales.map((locale) => ({
        loc: `${origin}${normalizeLocale(locale) === normalizeLocale(localization.defaultLocale) ? "/shop" : `/${normalizeLocale(locale)}/shop`}`,
        lastmod,
        locale,
        groupKey: "shop:index"
      })));
    }

    return buildSitemapXml(urls, localization.defaultLocale);
  }

  async buildRobotsTxt(baseUrl: string) {
    const seoSettings = await this.readSeoSettings(baseUrl);
    const origin = trimTrailingSlash(seoSettings.baseUrl);

    if (!seoSettings.searchIndexing) {
      return [
        "User-agent: *",
        "Disallow: /"
      ].join("\n");
    }

    const rules = [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /cy-admin",
      "Disallow: /dashboard",
      "Disallow: /auth/"
    ];
    if (seoSettings.sitemapEnabled) rules.push(`Sitemap: ${origin}/sitemap.xml`);

    return rules.join("\n");
  }

  async createContactSubmission(input: ContactSubmissionInput, meta: ContactSubmissionMeta = {}) {
    return this.contactSubmissions.create(input, meta);
  }

  async listContactSubmissions() {
    return this.contactSubmissions.list();
  }

  async listScheduledContent(now = new Date()) {
    const [pages, posts] = await Promise.all([
      this.prisma.cmsPage.findMany({
        where: {
          status: "DRAFT",
          publishedAt: {
            gt: now
          }
        },
        orderBy: {
          publishedAt: "asc"
        }
      }),
      this.prisma.cmsPost.findMany({
        where: {
          status: "DRAFT",
          publishedAt: {
            gt: now
          }
        },
        orderBy: {
          publishedAt: "asc"
        }
      })
    ]);

    return { pages, posts };
  }

  async publishScheduledContent(now = new Date()) {
    const [pages, posts] = await Promise.all([
      this.prisma.cmsPage.updateMany({
        where: {
          status: "DRAFT",
          publishedAt: {
            lte: now
          }
        },
        data: {
          status: "PUBLISHED"
        }
      }),
      this.prisma.cmsPost.updateMany({
        where: {
          status: "DRAFT",
          publishedAt: {
            lte: now
          }
        },
        data: {
          status: "PUBLISHED"
        }
      })
    ]);

    return {
      pages: pages.count,
      posts: posts.count
    };
  }

  async listMediaAssets() {
    return this.prisma.mediaAsset.findMany({
      orderBy: {
        createdAt: "desc"
      }
    });
  }

  async createMediaAsset(input: Prisma.MediaAssetUncheckedCreateInput) {
    return this.prisma.mediaAsset.create({
      data: input
    });
  }

  private async findPageById(database: CmsDatabase, pageId: string) {
    const page = await database.cmsPage.findUniqueOrThrow({
      where: { id: pageId },
      include: pageInclude
    });

    return sanitizePageRecord(page);
  }

  private async findPostById(database: CmsDatabase, postId: string) {
    const post = await database.cmsPost.findUniqueOrThrow({
      where: {
        id: postId
      },
      include: postInclude
    });

    return sanitizePostRecord(post);
  }

  private async findRevision(pageId: string, revisionId: string, database: CmsDatabase = this.prisma) {
    const revision = await database.contentRevision.findFirst({
      where: {
        id: revisionId,
        pageId
      }
    });

    if (!revision) {
      throw new AppError(404, "revision_not_found", "Revision not found.");
    }

    return revision;
  }

  private async replaceSections(
    database: CmsDatabase,
    pageId: string,
    sections: PageSectionInput[]
  ) {
    await database.contentBlock.deleteMany({
      where: {
        pageId
      }
    });
    await database.pageSection.deleteMany({
      where: {
        pageId
      }
    });

    for (const section of sections) {
      const createdSection = await database.pageSection.create({
        data: {
          pageId,
          key: section.key,
          label: section.label,
          sortOrder: section.sortOrder,
          settings: toJson(section.settings)
        }
      });

      await this.createBlocks(database, pageId, createdSection.id, section.blocks);
    }
  }

  private async createBlocks(
    database: CmsDatabase,
    pageId: string,
    sectionId: string,
    blocks: ContentBlockInput[]
  ) {
    for (const block of blocks) {
      assertValidBlockValue(block);
      await database.contentBlock.create({
        data: {
          pageId,
          sectionId,
          mediaAssetId: block.mediaAssetId,
          key: block.key,
          type: block.type,
          label: block.label,
          value: toJson(sanitizeContentBlockValue(block.type, block.value)),
          settings: block.settings ? toJson(block.settings) : undefined,
          sortOrder: block.sortOrder,
          editable: block.editable
        }
      });
    }
  }

  private async replacePostCategories(
    database: CmsDatabase,
    postId: string,
    categorySlugs: string[],
    locale = "en"
  ) {
    await database.cmsPostCategory.deleteMany({
      where: {
        postId
      }
    });

    const slugs = uniqueStrings(categorySlugs);
    if (slugs.length === 0) return;

    const categories = await database.cmsCategory.findMany({
      where: {
        locale: normalizeLocale(locale),
        slug: {
          in: slugs
        }
      }
    });

    if (categories.length !== slugs.length) {
      throw new AppError(422, "invalid_post_categories", "One or more post categories do not exist.");
    }

    await database.cmsPostCategory.createMany({
      data: categories.map((category) => ({
        postId,
        categoryId: category.id
      })),
      skipDuplicates: true
    });
  }

  private async createRevision(
    database: CmsDatabase,
    pageId: string,
    action: string,
    createdById?: string
  ) {
    const page = await this.findPageById(database, pageId);
    const maxVersion = await database.contentRevision.aggregate({
      where: {
        pageId
      },
      _max: {
        version: true
      }
    });
    const version = (maxVersion._max.version ?? 0) + 1;

    await database.contentRevision.create({
      data: {
        entityType: "PAGE",
        pageId,
        version,
        action,
        title: page.title,
        slug: page.slug,
        status: page.status,
        snapshot: toJson(pageSnapshot(page)),
        createdById
      }
    });
  }

  private async createPostRevision(
    database: CmsDatabase,
    postId: string,
    action: string,
    createdById?: string
  ) {
    const post = await database.cmsPost.findUniqueOrThrow({
      where: {
        id: postId
      }
    });
    const maxVersion = await database.contentRevision.aggregate({
      where: {
        postId
      },
      _max: {
        version: true
      }
    });
    const version = (maxVersion._max.version ?? 0) + 1;

    await database.contentRevision.create({
      data: {
        entityType: "POST",
        postId,
        version,
        action,
        title: post.title,
        slug: post.slug,
        status: post.status,
        snapshot: toJson({
          title: post.title,
          slug: post.slug,
          locale: post.locale,
          translationGroupId: post.translationGroupId,
          excerpt: post.excerpt,
          content: post.content,
          metaTitle: post.metaTitle,
          metaDescription: post.metaDescription,
          seo: post.seo,
          status: post.status,
          publishedAt: post.publishedAt?.toISOString() ?? null,
          tags: post.tags
        }),
        createdById
      }
    });
  }
}
