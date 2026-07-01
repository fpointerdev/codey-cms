import type { Router } from "express";
import type { Prisma } from "@prisma/client";
import type { ModuleContext } from "../../core/types/module.js";
import { AppError } from "../../core/errors/app-error.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendCreated, sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { hasPermission, optionalAuth, requirePermission } from "../auth/auth.middleware.js";
import {
  createProductAttributeSchema,
  createProductCategorySchema,
  createProductImageSchema,
  createProductOptionSchema,
  createProductSchema,
  createProductVariantSchema,
  localeQuerySchema,
  listProductsQuery,
  productAttributeParams,
  productCategoryParams,
  productSlugParams,
  updateProductAttributeSchema,
  updateProductCategorySchema,
  updateProductSchema
} from "./products.schemas.js";
import { normalizeLocale, readLocalizationSettings, resolveLocale } from "../localization/localization.service.js";

function productInclude(canReadInactiveVariants = false) {
  return {
    category: true,
    images: {
      orderBy: { sortOrder: "asc" as const }
    },
    options: {
      orderBy: { sortOrder: "asc" as const }
    },
    variants: {
      ...(canReadInactiveVariants ? {} : { where: { active: true } }),
      orderBy: { createdAt: "asc" as const }
    }
  };
}

function productAttributeMatches(
  product: { metadata?: unknown },
  attributeName?: string,
  attributeValue?: string
) {
  if (!attributeName && !attributeValue) return true;

  const metadata = product.metadata && typeof product.metadata === "object" ? product.metadata as Record<string, unknown> : {};
  const attributes = Array.isArray(metadata.attributes) ? metadata.attributes : [];
  const normalize = (value = "") =>
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const normalizedName = attributeName ? normalize(attributeName) : "";
  const normalizedValue = attributeValue ? normalize(attributeValue) : "";

  return attributes.some((item) => {
    if (!item || typeof item !== "object") return false;

    const attribute = item as Record<string, unknown>;
    const name = normalize(String(attribute.name || ""));
    const value = normalize(String(attribute.value || ""));

    return (!normalizedName || name === normalizedName) && (!normalizedValue || value === normalizedValue);
  });
}

async function requestLocale(context: ModuleContext, requestedLocale: unknown) {
  const settings = await readLocalizationSettings(context.prisma);
  return resolveLocale(settings, requestedLocale);
}

export function registerProductRoutes(router: Router, context: ModuleContext) {
  router.get(
    "/categories",
    validateRequest({ query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const locale = await requestLocale(context, req.query.locale);
      const categories = await context.prisma.productCategory.findMany({
        where: {
          locale
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
      });

      return sendSuccess(res, { categories });
    })
  );

  router.post(
    "/categories",
    requirePermission(context, "create", "products"),
    validateRequest({ body: createProductCategorySchema }),
    asyncHandler(async (req, res) => {
      const category = await context.prisma.productCategory.create({
        data: {
          ...req.body,
          locale: await requestLocale(context, req.body.locale)
        }
      });

      return sendCreated(res, { category });
    })
  );

  router.patch(
    "/categories/:categorySlug",
    requirePermission(context, "update", "products"),
    validateRequest({ params: productCategoryParams, query: localeQuerySchema, body: updateProductCategorySchema }),
    asyncHandler(async (req, res) => {
      const existingCategory = await context.prisma.productCategory.findFirstOrThrow({
        where: {
          slug: req.params.categorySlug,
          locale: await requestLocale(context, req.query.locale ?? req.body.locale)
        },
        select: {
          id: true
        }
      });
      const { locale, ...input } = req.body;
      const category = await context.prisma.productCategory.update({
        where: { id: existingCategory.id },
        data: {
          ...input,
          locale: locale ? normalizeLocale(locale) : undefined
        }
      });

      return sendSuccess(res, { category });
    })
  );

  router.delete(
    "/categories/:categorySlug",
    requirePermission(context, "update", "products"),
    validateRequest({ params: productCategoryParams, query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const category = await context.prisma.productCategory.findFirstOrThrow({
        where: {
          slug: req.params.categorySlug,
          locale: await requestLocale(context, req.query.locale)
        },
        select: {
          id: true
        }
      });
      await context.prisma.productCategory.delete({
        where: { id: category.id }
      });

      return sendSuccess(res, { deleted: true });
    })
  );

  router.get(
    "/attributes",
    validateRequest({ query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const locale = await requestLocale(context, req.query.locale);
      const attributes = await context.prisma.productAttribute.findMany({
        where: {
          locale
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
      });

      return sendSuccess(res, { attributes });
    })
  );

  router.post(
    "/attributes",
    requirePermission(context, "create", "products"),
    validateRequest({ body: createProductAttributeSchema }),
    asyncHandler(async (req, res) => {
      const attribute = await context.prisma.productAttribute.create({
        data: {
          ...req.body,
          locale: await requestLocale(context, req.body.locale)
        }
      });

      return sendCreated(res, { attribute });
    })
  );

  router.patch(
    "/attributes/:attributeSlug",
    requirePermission(context, "update", "products"),
    validateRequest({ params: productAttributeParams, query: localeQuerySchema, body: updateProductAttributeSchema }),
    asyncHandler(async (req, res) => {
      const existingAttribute = await context.prisma.productAttribute.findFirstOrThrow({
        where: {
          slug: req.params.attributeSlug,
          locale: await requestLocale(context, req.query.locale ?? req.body.locale)
        },
        select: {
          id: true
        }
      });
      const { locale, ...input } = req.body;
      const attribute = await context.prisma.productAttribute.update({
        where: { id: existingAttribute.id },
        data: {
          ...input,
          locale: locale ? normalizeLocale(locale) : undefined
        }
      });

      return sendSuccess(res, { attribute });
    })
  );

  router.delete(
    "/attributes/:attributeSlug",
    requirePermission(context, "update", "products"),
    validateRequest({ params: productAttributeParams, query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const attribute = await context.prisma.productAttribute.findFirstOrThrow({
        where: {
          slug: req.params.attributeSlug,
          locale: await requestLocale(context, req.query.locale)
        },
        select: {
          id: true
        }
      });
      await context.prisma.productAttribute.delete({
        where: { id: attribute.id }
      });

      return sendSuccess(res, { deleted: true });
    })
  );

  router.get(
    "/",
    optionalAuth(context),
    validateRequest({ query: listProductsQuery }),
    asyncHandler(async (req, res) => {
      const { page, limit, status, category, attributeName, attributeValue } = req.query as unknown as {
        page: number;
        limit: number;
        status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
        locale?: string;
        category?: string;
        attributeName?: string;
        attributeValue?: string;
      };
      const locale = await requestLocale(context, req.query.locale);
      const canReadDrafts = hasPermission(req.user, "read", "products");

      if (status && status !== "ACTIVE" && !canReadDrafts) {
        throw new AppError(403, "forbidden", "You do not have permission to read draft products.");
      }

      const skip = (page - 1) * limit;
      const where: Prisma.ProductWhereInput = {
        locale,
        status: status || "ACTIVE",
        ...(category ? { category: { slug: category, locale } } : {})
      };
      const needsAttributeFilter = Boolean(attributeName || attributeValue);

      if (needsAttributeFilter) {
        const products = (await context.prisma.product.findMany({
          where,
          orderBy: { createdAt: "desc" },
          include: productInclude(canReadDrafts)
        })).filter((product) => productAttributeMatches(product, attributeName, attributeValue));

        return sendSuccess(res, { products: products.slice(skip, skip + limit) }, { page, limit, total: products.length });
      }

      const [products, total] = await Promise.all([
        context.prisma.product.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: productInclude(canReadDrafts)
        }),
        context.prisma.product.count({ where })
      ]);

      return sendSuccess(res, { products }, { page, limit, total });
    })
  );

  router.get(
    "/:slug",
    optionalAuth(context),
    validateRequest({ params: productSlugParams, query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const canReadDrafts = hasPermission(req.user, "read", "products");
      const product = await context.prisma.product.findFirstOrThrow({
        where: {
          slug: req.params.slug,
          locale: await requestLocale(context, req.query.locale)
        },
        include: productInclude(canReadDrafts)
      });

      if (product.status !== "ACTIVE" && !canReadDrafts) {
        throw new AppError(404, "not_found", "Product not found.");
      }

      return sendSuccess(res, { product });
    })
  );

  router.post(
    "/",
    requirePermission(context, "create", "products"),
    validateRequest({ body: createProductSchema }),
    asyncHandler(async (req, res) => {
      const { images, options, variants, metadata, seo, ...input } = req.body as {
        categoryId?: string;
        name: string;
        slug: string;
        locale?: string;
        translationGroupId?: string | null;
        description?: string;
        sku?: string;
        priceCents: number;
        currency: string;
        stockQuantity: number;
        status: "DRAFT" | "ACTIVE" | "ARCHIVED";
        metaTitle?: string;
        metaDescription?: string;
        seo?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
        images?: Array<{
          mediaAssetId?: string;
          url: string;
          alt?: string;
          sortOrder: number;
          isPrimary: boolean;
        }>;
        options?: Array<{ name: string; values: string[]; sortOrder: number }>;
        variants?: Array<{
          name: string;
          sku?: string;
          optionValues?: Record<string, unknown>;
          priceCents?: number;
          stockQuantity: number;
          active: boolean;
          metadata?: Record<string, unknown>;
        }>;
      };
      const product = await context.prisma.product.create({
        data: {
          ...input,
          locale: await requestLocale(context, input.locale),
          currency: input.currency.toUpperCase(),
          seo: seo as Prisma.ProductUncheckedCreateInput["seo"],
          metadata: metadata as Prisma.ProductUncheckedCreateInput["metadata"],
          images: images?.length
            ? {
                create: images
              }
            : undefined,
          options: options?.length
            ? {
                create: options
              }
            : undefined,
          variants: variants?.length
            ? {
                create: variants.map((variant) => ({
                  ...variant,
                  optionValues: variant.optionValues as Prisma.ProductVariantUncheckedCreateInput["optionValues"],
                  metadata: variant.metadata as Prisma.ProductVariantUncheckedCreateInput["metadata"]
                }))
              }
            : undefined
        },
        include: productInclude(true)
      });

      return sendCreated(res, { product });
    })
  );

  router.post(
    "/:slug/images",
    requirePermission(context, "update", "products"),
    validateRequest({ params: productSlugParams, query: localeQuerySchema, body: createProductImageSchema }),
    asyncHandler(async (req, res) => {
      const product = await context.prisma.product.findFirstOrThrow({
        where: {
          slug: req.params.slug,
          locale: await requestLocale(context, req.query.locale)
        },
        select: { id: true }
      });
      const image = await context.prisma.productImage.create({
        data: {
          ...req.body,
          productId: product.id
        }
      });

      return sendCreated(res, { image });
    })
  );

  router.patch(
    "/:slug",
    requirePermission(context, "update", "products"),
    validateRequest({ params: productSlugParams, query: localeQuerySchema, body: updateProductSchema }),
    asyncHandler(async (req, res) => {
      const { metadata, seo, currency, locale, ...input } = req.body as {
        categoryId?: string | null;
        name?: string;
        slug?: string;
        locale?: string;
        translationGroupId?: string | null;
        description?: string | null;
        sku?: string | null;
        priceCents?: number;
        currency?: string;
        stockQuantity?: number;
        status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
        metaTitle?: string | null;
        metaDescription?: string | null;
        seo?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
      };
      const existingProduct = await context.prisma.product.findFirstOrThrow({
        where: {
          slug: req.params.slug,
          locale: await requestLocale(context, req.query.locale ?? locale)
        },
        select: {
          id: true
        }
      });
      const product = await context.prisma.product.update({
        where: { id: existingProduct.id },
        data: {
          ...input,
          locale: locale ? normalizeLocale(locale) : undefined,
          currency: currency?.toUpperCase(),
          seo: seo as Prisma.ProductUncheckedUpdateInput["seo"],
          metadata: metadata as Prisma.ProductUncheckedUpdateInput["metadata"]
        },
        include: productInclude(true)
      });

      return sendSuccess(res, { product });
    })
  );

  router.post(
    "/:slug/options",
    requirePermission(context, "update", "products"),
    validateRequest({ params: productSlugParams, query: localeQuerySchema, body: createProductOptionSchema }),
    asyncHandler(async (req, res) => {
      const product = await context.prisma.product.findFirstOrThrow({
        where: {
          slug: req.params.slug,
          locale: await requestLocale(context, req.query.locale)
        },
        select: { id: true }
      });
      const option = await context.prisma.productOption.create({
        data: {
          ...req.body,
          productId: product.id
        }
      });

      return sendCreated(res, { option });
    })
  );

  router.post(
    "/:slug/variants",
    requirePermission(context, "update", "products"),
    validateRequest({ params: productSlugParams, query: localeQuerySchema, body: createProductVariantSchema }),
    asyncHandler(async (req, res) => {
      const product = await context.prisma.product.findFirstOrThrow({
        where: {
          slug: req.params.slug,
          locale: await requestLocale(context, req.query.locale)
        },
        select: { id: true }
      });
      const variant = await context.prisma.productVariant.create({
        data: {
          ...req.body,
          productId: product.id,
          optionValues: req.body.optionValues as Prisma.ProductVariantUncheckedCreateInput["optionValues"],
          metadata: req.body.metadata as Prisma.ProductVariantUncheckedCreateInput["metadata"]
        }
      });

      return sendCreated(res, { variant });
    })
  );
}
