import { z } from "zod";

export const productSlugParams = z.object({
  slug: z.string().trim().min(1)
});

export const productCategoryParams = z.object({
  categorySlug: z.string().trim().min(1).max(120)
});

export const productAttributeParams = z.object({
  attributeSlug: z.string().trim().min(1).max(120)
});

export const localeQuerySchema = z.object({
  locale: z.string().trim().toLowerCase().min(2).max(16).optional()
});

export const shopSettingsSchema = z.object({
  catalogTitle: z.string().trim().min(1).max(120).default("Shop"),
  catalogDescription: z.string().trim().max(500).default("Browse our products."),
  catalogLayout: z.enum(["grid", "editorial", "compact"]).default("grid"),
  cardStyle: z.enum(["minimal", "image-led", "technical"]).default("minimal"),
  detailLayout: z.enum(["classic", "immersive", "spec-sheet"]).default("classic"),
  detailStyle: z.enum(["standard", "premium", "industrial"]).default("standard"),
  productsPerPage: z.number().int().min(8).max(48).default(20),
  showCategories: z.boolean().default(true),
  showAttributes: z.boolean().default(true),
  showSku: z.boolean().default(true),
  showStock: z.boolean().default(true)
});

const productImageUrlSchema = z.string().trim().max(1000).refine((value) => {
  if (/^(https?:\/\/|s3:\/\/)/i.test(value)) {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  if (!value.startsWith("/uploads/") || /[<>"\\]/.test(value)) return false;

  try {
    return !decodeURIComponent(value.split("?")[0] || "").split("/").includes("..");
  } catch {
    return false;
  }
}, "Image URL must be an absolute URL or a safe /uploads path.");

export const listProductsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  locale: z.string().trim().toLowerCase().min(2).max(16).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  attributeName: z.string().trim().min(1).max(120).optional(),
  attributeValue: z.string().trim().min(1).max(180).optional()
});

export const createProductSchema = z.object({
  categoryId: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(180),
  slug: z.string().trim().min(1).max(180),
  locale: z.string().trim().toLowerCase().min(2).max(16).optional(),
  translationGroupId: z.string().trim().min(1).max(120).nullable().optional(),
  description: z.string().trim().max(2000).optional(),
  sku: z.string().trim().max(80).optional(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3).default("USD"),
  stockQuantity: z.number().int().nonnegative().default(0),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  metaTitle: z.string().trim().max(180).optional(),
  metaDescription: z.string().trim().max(300).optional(),
  seo: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  images: z.array(
    z.object({
      mediaAssetId: z.string().cuid().optional(),
      url: productImageUrlSchema,
      alt: z.string().trim().max(180).optional(),
      sortOrder: z.number().int().default(0),
      isPrimary: z.boolean().default(false)
    })
  ).max(20).optional(),
  options: z.array(
    z.object({
      name: z.string().trim().min(1).max(80),
      values: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
      sortOrder: z.number().int().default(0)
    })
  ).max(20).optional(),
  variants: z.array(
    z.object({
      name: z.string().trim().min(1).max(120),
      sku: z.string().trim().max(80).optional(),
      optionValues: z.record(z.unknown()).optional(),
      priceCents: z.number().int().nonnegative().optional(),
      stockQuantity: z.number().int().nonnegative().default(0),
      active: z.boolean().default(true),
      metadata: z.record(z.unknown()).optional()
    })
  ).max(200).optional()
});

export const updateProductSchema = createProductSchema.partial().omit({
  images: true,
  options: true,
  variants: true
});

export const createProductCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120),
  locale: z.string().trim().toLowerCase().min(2).max(16).optional(),
  translationGroupId: z.string().trim().min(1).max(120).nullable().optional(),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().default(0)
});

export const updateProductCategorySchema = createProductCategorySchema.partial();

export const createProductAttributeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120),
  locale: z.string().trim().toLowerCase().min(2).max(16).optional(),
  translationGroupId: z.string().trim().min(1).max(120).nullable().optional(),
  values: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().default(0)
});

export const updateProductAttributeSchema = createProductAttributeSchema.partial();

export const createProductImageSchema = z.object({
  mediaAssetId: z.string().cuid().optional(),
  url: productImageUrlSchema,
  alt: z.string().trim().max(180).optional(),
  sortOrder: z.number().int().default(0),
  isPrimary: z.boolean().default(false)
});

export const createProductOptionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  values: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  sortOrder: z.number().int().default(0)
});

export const createProductVariantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(80).optional(),
  optionValues: z.record(z.unknown()).optional(),
  priceCents: z.number().int().nonnegative().optional(),
  stockQuantity: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional()
});
