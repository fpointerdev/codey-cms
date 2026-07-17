import { z } from "zod";

export const slugParams = z.object({
  slug: z.string().trim().min(1).max(180)
});

export const localeQuerySchema = z.object({
  locale: z.string().trim().toLowerCase().min(2).max(16).optional()
});

export const pageQuerySchema = z.object({
  preview: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  locale: z.string().trim().toLowerCase().min(2).max(16).optional()
});

export const revisionParams = slugParams.extend({
  revisionId: z.string().trim().min(1)
});

export const sectionParams = slugParams.extend({
  sectionId: z.string().trim().min(1)
});

export const blockParams = slugParams.extend({
  blockKey: z.string().trim().min(1).max(120)
});

export const categoryParams = z.object({
  categorySlug: z.string().trim().min(1).max(120)
});

export const redirectParams = z.object({
  redirectId: z.string().trim().min(1)
});

export const menuParams = z.object({
  menuSlug: z.string().trim().min(1).max(120)
});

export const mediaAssetParams = z.object({
  assetId: z.string().trim().min(1)
});

export const menuItemParams = menuParams.extend({
  itemId: z.string().trim().min(1)
});

const jsonObjectSchema = z.record(z.unknown());

const contentBlockTypeSchema = z.enum([
  "TEXT",
  "RICH_TEXT",
  "IMAGE",
  "GALLERY",
  "EMBED",
  "BUTTON",
  "CTA",
  "CONTACT_FORM",
  "PRODUCT_LIST",
  "CUSTOM"
]);

const sectionSettingsSchema = z.object({
  template: z
    .enum(["hero", "content", "gallery", "products", "contact", "custom", "section-pattern"])
    .default("custom"),
  layout: z
    .enum(["one-column", "two-column", "three-column", "four-column", "sidebar-left", "sidebar-right", "full-bleed", "asymmetric"])
    .default("one-column"),
  container: z.enum(["narrow", "default", "wide", "full"]).default("default"),
  spacing: z.enum(["none", "sm", "md", "lg", "xl"]).default("md"),
  background: z
    .object({
      color: z.string().trim().max(40).optional(),
      imageAssetId: z.string().trim().min(1).optional(),
      style: z.enum(["cover", "contain", "tile"]).default("cover")
    })
    .optional(),
  visibility: z
    .object({
      desktop: z.boolean().default(true),
      tablet: z.boolean().default(true),
      mobile: z.boolean().default(true)
    })
    .optional()
}).passthrough();

export const contentBlockSchema = z.object({
  key: z.string().trim().min(1).max(120),
  type: contentBlockTypeSchema,
  label: z.string().trim().min(1).max(120).optional(),
  value: z.unknown(),
  settings: jsonObjectSchema.optional().default({}),
  sortOrder: z.number().int().min(0).default(0),
  editable: z.boolean().default(true),
  mediaAssetId: z.string().trim().min(1).optional()
});

export const pageSectionSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160).optional(),
  sortOrder: z.number().int().min(0).default(0),
  settings: sectionSettingsSchema.default({}),
  blocks: z.array(contentBlockSchema).default([])
});

export const createCmsPageSchema = z.object({
  title: z.string().trim().min(1).max(180),
  slug: z.string().trim().min(1).max(180),
  locale: z.string().trim().toLowerCase().min(2).max(16).optional(),
  translationGroupId: z.string().trim().min(1).max(120).nullable().optional(),
  excerpt: z.string().trim().max(500).optional(),
  content: jsonObjectSchema.default({}),
  metaTitle: z.string().trim().max(180).optional(),
  metaDescription: z.string().trim().max(300).optional(),
  seo: jsonObjectSchema.optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  publishedAt: z.coerce.date().optional(),
  sections: z.array(pageSectionSchema).default([])
});

export const updateCmsPageSchema = createCmsPageSchema.partial().extend({
  sections: z.array(pageSectionSchema).optional()
});

export const createContentTranslationSchema = z.object({
  targetLocale: z.string().trim().toLowerCase().min(2).max(16),
  title: z.string().trim().min(1).max(180).optional(),
  slug: z.string().trim().min(1).max(180).optional(),
  excerpt: z.string().trim().max(500).optional(),
  metaTitle: z.string().trim().max(180).optional(),
  metaDescription: z.string().trim().max(300).optional()
});

export const createCmsPostSchema = createCmsPageSchema.omit({ sections: true }).extend({
  tags: z.array(z.string().trim().min(1).max(80)).default([]),
  categorySlugs: z.array(z.string().trim().min(1).max(120)).default([])
});

export const updateCmsPostSchema = createCmsPostSchema.partial();

export const postQuerySchema = z.object({
  locale: z.string().trim().toLowerCase().min(2).max(16).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  tag: z.string().trim().min(1).max(80).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  includeDrafts: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true")
});

export const createCmsCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120),
  locale: z.string().trim().toLowerCase().min(2).max(16).optional(),
  translationGroupId: z.string().trim().min(1).max(120).nullable().optional(),
  description: z.string().trim().max(300).optional()
});

export const updateCmsCategorySchema = createCmsCategorySchema.partial();

export const addSectionSchema = pageSectionSchema;

export const addContentBlockSchema = contentBlockSchema;

export const updateContentBlockSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  value: z.unknown().optional(),
  settings: jsonObjectSchema.optional(),
  editable: z.boolean().optional(),
  mediaAssetId: z.string().trim().min(1).nullable().optional()
});

export const createMenuSchema = z.object({
  slug: z.string().trim().min(1).max(120),
  locale: z.string().trim().toLowerCase().min(2).max(16).optional(),
  name: z.string().trim().min(1).max(160),
  location: z.string().trim().min(1).max(80)
});

export const createMenuItemSchema = z.object({
  parentId: z.string().trim().min(1).nullable().optional(),
  pageId: z.string().trim().min(1).nullable().optional(),
  label: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  openInNewTab: z.boolean().default(false)
});

export const updateMenuItemSchema = createMenuItemSchema.partial();

export const redirectResolveQuerySchema = z.object({
  path: z.string().trim().min(1).max(600)
});

export const createRedirectSchema = z.object({
  sourcePath: z.string().trim().min(1).max(600),
  targetPath: z.string().trim().min(1).max(600),
  statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(301),
  preserveQuery: z.boolean().default(true),
  active: z.boolean().default(true)
});

export const updateRedirectSchema = createRedirectSchema.partial();

export const createMediaAssetSchema = z.object({
  kind: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]).default("IMAGE"),
  storageKey: z.string().trim().min(1).max(500).optional(),
  url: z.string().trim().url().max(1000).refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Media URL must use HTTP or HTTPS."
  }),
  mimeType: z.string().trim().max(160).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  altText: z.string().trim().max(240).optional()
});

export const createSignedUploadSchema = z.object({
  filename: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive(),
  kind: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]).optional(),
  altText: z.string().trim().max(240).optional()
});

export const completeSignedUploadSchema = createSignedUploadSchema.extend({
  storageKey: z.string().trim().min(1).max(700),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
});

export const directMediaUploadSchema = z.object({
  filename: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(160),
  dataBase64: z.string().trim().min(1),
  kind: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]).optional(),
  altText: z.string().trim().max(240).optional()
});

export const deleteMediaAssetSchema = z.object({
  force: z.boolean().default(false)
}).default({});

export const cleanupOrphanMediaSchema = z.object({
  dryRun: z.boolean().default(true),
  olderThanDays: z.number().int().min(0).max(365).default(1),
  limit: z.number().int().min(1).max(200).default(50)
}).default({});

export const contactSubmissionSchema = z.object({
  formKey: z.string().trim().min(1).max(120).default("contact"),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(180),
  phone: z.string().trim().max(80).optional(),
  subject: z.string().trim().max(160).optional(),
  message: z.string().trim().min(1).max(5000),
  metadata: jsonObjectSchema.optional(),
  website: z.string().trim().max(240).optional(),
  startedAt: z.coerce.date().optional()
});
