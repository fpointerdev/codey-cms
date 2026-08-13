import compression from "compression";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pinoHttp } from "pino-http";
import { config, type AppConfig } from "../config/index.js";
import { createAdminMutationAudit } from "./audit/admin-mutation-audit.middleware.js";
import { errorHandler } from "./http/error.middleware.js";
import { createMaintenanceMiddleware } from "./http/maintenance.middleware.js";
import { loadModules } from "./http/module-loader.js";
import { notFoundHandler } from "./http/not-found.middleware.js";
import { requestContext } from "./http/request-context.middleware.js";
import { injectPublicShellContent, type PublicShellContent } from "./public-shell.js";
import { canonicalPublicRedirectTarget } from "./public-routing.js";
import {
  customStorefrontAssetCacheControl,
  resolveCustomStorefrontRoot
} from "./custom-storefront.js";
import { registerPublicMediaRoutes } from "./public-media-router.js";
import {
  createPlatformSecurityMiddleware,
  normalizeAllowedOrigin
} from "./security-middleware.js";
import { prisma } from "../infrastructure/database/prisma.js";
import { logger } from "../infrastructure/logging/logger.js";
import { StorageSettingsService } from "../infrastructure/storage/storage-settings.service.js";
import {
  serializeHttpRequest,
  serializeHttpResponse
} from "../infrastructure/logging/http-logging.js";
import { modules } from "../modules/index.js";
import { CmsService } from "../modules/cms/cms.service.js";
import { sanitizeContentBlockValue, sanitizePostContent } from "../modules/cms/rich-text-sanitizer.js";
import { enrichPublicMedia } from "../modules/cms/public-media.js";
import {
  normalizeLocale,
  publicLocaleCodes,
  readLocalizationSettings
} from "../modules/localization/localization.service.js";
import {
  findProductAttributePage,
  orderProductsByIds
} from "../modules/products/product-attribute-filter.js";
import { withAvailableInventory } from "../modules/products/product-inventory.js";
import { enrichProductListContent } from "../modules/products/product-list-content.js";
import { productCatalogOrderBy, type ProductCatalogSort } from "../modules/products/product-sort.js";
import { readShopSettings } from "../modules/products/shop-settings.js";
import { publicSiteStyleTag } from "../modules/config/site-design.js";
import {
  createInstallationGate,
  createInstallationRouter
} from "../modules/installation/installation.routes.js";

type SeoDocument = {
  title: string;
  description: string;
  htmlLang: string;
  noindex?: boolean;
  alternates?: Array<{ hreflang: string; href: string }>;
};

type PublicSeoRenderer = {
  createGenericSeoDocument(input: Record<string, unknown>): SeoDocument;
  createPageSeoDocument(page: unknown, context?: Record<string, unknown>): SeoDocument;
  createPostSeoDocument(post: unknown, context?: Record<string, unknown>): SeoDocument;
  createProductSeoDocument(product: unknown, context?: Record<string, unknown>): SeoDocument;
  createShopSeoDocument(shop: unknown, context?: Record<string, unknown>): SeoDocument;
  injectSeoDocument(html: string, document: SeoDocument): string;
  renderLanguageSwitcher(document: SeoDocument, localization: RouteLocalizationSettings): string;
};

type PublicMarkupRenderer = {
  withPublicRenderContext<T>(context: Record<string, unknown>, render: () => T): T;
  renderFooter(page: unknown, canEdit?: boolean, options?: { menu?: string }): string;
  renderMenuItems(items: unknown[], canEdit?: boolean): string;
  renderPageContent(page: unknown, options?: { canEdit?: boolean; commerceEnabled?: boolean; shopSettings?: unknown }): string;
  renderPostContent(post: unknown): string;
  renderProductDetailContent(product: unknown, options?: Record<string, unknown>): string;
  renderShopListingContent(input: unknown, options?: Record<string, unknown>): string;
};

type PublicShellResolution = {
  found: boolean;
  content: PublicShellContent | null;
  siteTitle?: string;
  localization?: RouteLocalizationSettings;
};

let publicMarkupRenderer: Promise<PublicMarkupRenderer> | null = null;
let publicSeoRenderer: Promise<PublicSeoRenderer> | null = null;

type PublicContentRoute =
  | { type: "page"; slug: string; locale: string }
  | { type: "post"; slug: string; locale: string }
  | { type: "product"; slug: string; locale: string }
  | {
      type: "shop";
      locale: string;
      category?: string;
      attributeName?: string;
      attributeValue?: string;
      page: number;
    };

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeBrandLogoUrl(value: unknown) {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url || url.startsWith("//") || url.includes("\\")) return "";
  if (/^(https?:\/\/|\/|\.\/)/i.test(url)) return url;
  if (/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(url)) return url;

  return "";
}

function brandInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "CY";
}

function renderPublicBrand(site: Awaited<ReturnType<typeof readSiteSeoDefaults>>) {
  const title = site.brandTitle || site.title || config.app.name;
  const logoUrl = safeBrandLogoUrl(site.logoUrl);
  const configuredLogoMode = typeof site.logoMode === "string" ? site.logoMode : "";
  const logoMode = ["text", "image", "image-and-name"].includes(configuredLogoMode)
    ? configuredLogoMode
    : "text";
  const showLogo = logoUrl && logoMode !== "text";
  const showName = logoMode !== "image" || !showLogo;
  const showGeneratedFallback = site.generatedFrom === "websiteSpec" && !showLogo;
  const configuredLogoHeight = typeof site.logoHeight === "number" ? site.logoHeight : Number.NaN;
  const logoHeight = Number.isFinite(configuredLogoHeight)
    ? Math.min(120, Math.max(20, Math.round(configuredLogoHeight)))
    : 42;

  return [
    showLogo
      ? `<img class="brand-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(site.logoAltText || title)}" style="--brand-logo-height:${logoHeight}px" />`
      : showGeneratedFallback ? `<span>${escapeHtml(brandInitials(title))}</span>` : "",
    showName ? `<strong>${escapeHtml(title)}</strong>` : ""
  ].join("");
}

function generatedPageBodyAttributes(page: { content?: unknown }) {
  const content = page.content && typeof page.content === "object" && !Array.isArray(page.content)
    ? page.content as Record<string, unknown>
    : {};
  if (content.source !== "websiteSpec") return undefined;
  const style = content.style && typeof content.style === "object" && !Array.isArray(content.style)
    ? content.style as Record<string, unknown>
    : {};
  const experience = style.experience && typeof style.experience === "object" && !Array.isArray(style.experience)
    ? style.experience as Record<string, unknown>
    : {};
  const value = (key: string, fallback = "") => {
    const candidate = experience[key];
    return typeof candidate === "string" && candidate.trim() ? candidate.trim().slice(0, 80) : fallback;
  };

  return {
    "data-codey-preview": "cms",
    "data-codey-cms-rendered-preview": "true",
    "data-codey-runtime-theme": typeof style.runtimeCss === "string" && style.runtimeCss.trim() ? "true" : "",
    "data-design-family": value("family", "generated"),
    "data-design-recipe": value("recipeId", typeof style.theme === "string" ? style.theme : "generated-site"),
    "data-hero-composition": value("heroComposition"),
    "data-navigation-system": value("navigationSystem"),
    "data-section-rhythm": value("sectionRhythm"),
    "data-grid-system": value("gridSystem"),
    "data-image-treatment": value("imageTreatment"),
    "data-typography-system": value("typographySystem"),
    "data-signature-interaction": value("signatureInteraction"),
    "data-shape-language": value("shapeLanguage"),
    "data-motion-system": value("motionSystem"),
    "data-motion-level": value("motionLevel", "light")
  };
}

function requestOrigin(req: Request) {
  const protocol = req.header("x-forwarded-proto") ?? req.protocol;
  const host = req.header("x-forwarded-host") ?? req.header("host") ?? "localhost";

  return config.app.publicUrl ?? `${protocol}://${host}`;
}

function firstQueryValue(value: unknown) {
  if (Array.isArray(value)) return firstQueryValue(value[0]);
  return typeof value === "string" ? value : undefined;
}

function publicPageNumber(value: unknown) {
  const rawValue = firstQueryValue(value);
  if (!rawValue || !/^\d+$/.test(rawValue)) return 1;

  const page = Number(rawValue);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

function isAdminShellPath(path: string) {
  return path === "/install" || path === "/cy-admin" || path.startsWith("/dashboard") || path.startsWith("/auth/");
}

function looksLikeLocale(value: string | undefined) {
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(value || "");
}

function htmlLangFromLocale(locale: string) {
  return normalizeLocale(locale);
}

type RouteLocalizationSettings = Awaited<ReturnType<typeof readLocalizationSettings>>;

function isConfiguredRouteLocale(value: string | undefined, localization?: RouteLocalizationSettings) {
  if (!looksLikeLocale(value)) return false;
  if (!localization) return true;
  if (!localization.enabled) return false;

  return localization.locales.some((locale) => locale.enabled !== false && locale.code === normalizeLocale(value));
}

function decodePublicPathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function publicContentRouteFromRequest(req: Request, localization?: RouteLocalizationSettings): PublicContentRoute {
  const querySlug = firstQueryValue(req.query.slug);
  const parts = req.path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map(decodePublicPathSegment);
  let locale = normalizeLocale(localization?.defaultLocale || "en");

  if (isConfiguredRouteLocale(parts[0], localization)) locale = normalizeLocale(parts.shift());
  if (parts[0] === "posts" && parts[1]) return { type: "post", slug: parts.slice(1).join("/"), locale };
  if (parts[0] === "product" && parts[1]) return { type: "product", slug: parts.slice(1).join("/"), locale };
  const page = publicPageNumber(req.query.page);
  if (parts[0] === "shop" && parts.length === 1) return { type: "shop", locale, page };
  if (parts[0] === "shop" && parts[1] === "category" && parts[2]) {
    return { type: "shop", locale, category: parts[2], page };
  }
  if (parts[0] === "shop" && parts[1] === "attribute" && parts[2]) {
    return {
      type: "shop",
      locale,
      attributeName: parts[2],
      attributeValue: parts[3] || "",
      page
    };
  }

  return { type: "page", slug: querySlug || parts.join("/") || "home", locale };
}

async function readPublicShopProductPage(
  route: Extract<PublicContentRoute, { type: "shop" }>,
  limit: number,
  sort: ProductCatalogSort = "newest"
) {
  const where: Prisma.ProductWhereInput = {
    locale: route.locale,
    status: "ACTIVE",
    ...(route.category ? { category: { slug: route.category, locale: route.locale } } : {})
  };
  const skip = (route.page - 1) * limit;
  const orderBy = productCatalogOrderBy(sort);
  const include = {
    category: true,
    images: { orderBy: { sortOrder: "asc" as const } },
    variants: {
      where: { active: true },
      orderBy: { createdAt: "asc" as const }
    }
  };

  if (route.attributeName || route.attributeValue) {
    const result = await findProductAttributePage(
      (cursor, take) => prisma.product.findMany({
        where,
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy,
        select: { id: true, metadata: true }
      }),
      route,
      { skip, take: limit, countTotal: true }
    );
    const matchedProducts = result.ids.length
      ? await prisma.product.findMany({
          where: { id: { in: result.ids } },
          include
        })
      : [];

    return {
      products: await enrichPublicMedia(
        prisma,
        orderProductsByIds(matchedProducts, result.ids).map(withAvailableInventory)
      ),
      total: result.total
    };
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include
    }),
    prisma.product.count({ where })
  ]);

  return {
    products: await enrichPublicMedia(prisma, products.map(withAvailableInventory)),
    total
  };
}

async function readPublicModuleStates() {
  const installedModules = await prisma.installedModule.findMany({
    where: { site: { slug: "default" } },
    select: { moduleId: true, status: true }
  });

  return {
    configured: installedModules.length > 0,
    enabled: new Set(installedModules.filter((item) => item.status === "ENABLED").map((item) => item.moduleId))
  };
}

function publicModuleEnabled(
  states: Awaited<ReturnType<typeof readPublicModuleStates>>,
  moduleId: "cms" | "products"
) {
  return config.features[moduleId] && (!states.configured || states.enabled.has(moduleId));
}

export function shouldRenderPublicShell(path: string, copiedRuntimeEnabled = true) {
  if (!copiedRuntimeEnabled) return false;
  if (path === "/api" || path.startsWith("/api/")) return false;
  if (path === "/platform" || path.startsWith("/platform/")) return false;
  if (path.startsWith(config.api.prefix)) return false;
  if (path.startsWith("/uploads/")) return false;
  if (/\.[a-z0-9]+$/i.test(path)) return false;

  return true;
}

async function readSiteSeoDefaults() {
  const site = await prisma.site.findUnique({
    where: {
      slug: "default"
    },
    select: {
      id: true,
      name: true
    }
  });

  if (!site) {
    return {
      title: config.app.name,
      brandTitle: config.app.name,
      description: "",
      design: undefined,
      experience: undefined,
      generatedCss: "",
      generatedFrom: "",
      logoUrl: "",
      logoMode: "text",
      logoAltText: "",
      logoHeight: 42,
      faviconUrl: "",
      socialImageUrl: "",
      socialImageAlt: "",
      customCss: ""
    };
  }

  const setting = await prisma.moduleSetting.findFirst({
    where: {
      siteId: site.id,
      moduleId: "config",
      key: "site"
    }
  });
  const value = setting?.value;
  const storedSettings =
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

  return {
    title: typeof storedSettings.metaTitle === "string" && storedSettings.metaTitle
      ? storedSettings.metaTitle
      : typeof storedSettings.title === "string" && storedSettings.title
        ? storedSettings.title
        : site.name,
    brandTitle: typeof storedSettings.title === "string" && storedSettings.title
      ? storedSettings.title
      : site.name,
    description: typeof storedSettings.metaDescription === "string" && storedSettings.metaDescription
      ? storedSettings.metaDescription
      : typeof storedSettings.description === "string"
        ? storedSettings.description
        : "",
    publicBaseUrl: typeof storedSettings.siteUrl === "string" && storedSettings.siteUrl.trim()
      ? normalizeAllowedOrigin(storedSettings.siteUrl)
      : undefined,
    noindex: storedSettings.searchIndexing === false,
    design: storedSettings.design,
    experience: storedSettings.experience,
    generatedCss: typeof storedSettings.generatedCss === "string" ? storedSettings.generatedCss : "",
    generatedFrom: typeof storedSettings.generatedFrom === "string" ? storedSettings.generatedFrom : "",
    logoUrl: typeof storedSettings.logoUrl === "string" ? storedSettings.logoUrl : "",
    logoMode: typeof storedSettings.logoMode === "string" ? storedSettings.logoMode : "text",
    logoAltText: typeof storedSettings.logoAltText === "string" ? storedSettings.logoAltText : "",
    logoHeight: typeof storedSettings.logoHeight === "number" ? storedSettings.logoHeight : 42,
    faviconUrl: typeof storedSettings.faviconUrl === "string" ? storedSettings.faviconUrl : "",
    socialImageUrl: typeof storedSettings.socialImageUrl === "string" ? storedSettings.socialImageUrl : "",
    socialImageAlt: typeof storedSettings.socialImageAlt === "string" ? storedSettings.socialImageAlt : "",
    customCss: typeof storedSettings.customCss === "string" ? storedSettings.customCss : ""
  };
}

function seoDocumentContext(
  origin: string,
  site: Awaited<ReturnType<typeof readSiteSeoDefaults>>,
  localization: RouteLocalizationSettings,
  storagePublicBaseUrl?: string
) {
  return {
    origin,
    siteName: site.brandTitle || site.title || config.app.name,
    siteDescription: site.description,
    noindex: site.noindex === true,
    defaultLocale: localization.defaultLocale,
    storagePublicBaseUrl,
    organizationLogo: site.logoUrl,
    faviconUrl: site.faviconUrl,
    defaultImage: site.socialImageUrl
      ? { url: site.socialImageUrl, alt: site.socialImageAlt || site.brandTitle || site.title }
      : undefined
  };
}

function publishedTranslationWhere(id: string, translationGroupId: string | null, locales: string[]) {
  return {
    locale: { in: locales },
    status: "PUBLISHED" as const,
    AND: [
      {
        OR: [
          { publishedAt: null },
          { publishedAt: { lte: new Date() } }
        ]
      },
      {
        OR: [
          { id },
          ...(translationGroupId ? [{ translationGroupId }] : [])
        ]
      }
    ]
  };
}

function visiblePublishedWhere(slug: string, locale: string) {
  return {
    slug,
    locale,
    status: "PUBLISHED" as const,
    OR: [
      { publishedAt: null },
      { publishedAt: { lte: new Date() } }
    ]
  };
}

async function resolvePostSeo(
  route: Extract<PublicContentRoute, { type: "post" }>,
  origin: string,
  site: Awaited<ReturnType<typeof readSiteSeoDefaults>>,
  localization: RouteLocalizationSettings,
  renderer: PublicSeoRenderer,
  storagePublicBaseUrl?: string
) {
  const post = await prisma.cmsPost.findFirst({
    where: visiblePublishedWhere(route.slug, route.locale),
    select: {
      id: true,
      title: true,
      slug: true,
      locale: true,
      translationGroupId: true,
      excerpt: true,
      metaTitle: true,
      metaDescription: true,
      seo: true,
      publishedAt: true,
      updatedAt: true
    }
  });
  if (!post) return null;

  const translations = await prisma.cmsPost.findMany({
    where: publishedTranslationWhere(post.id, post.translationGroupId, publicLocaleCodes(localization)),
    select: { title: true, slug: true, locale: true },
    orderBy: { locale: "asc" }
  });

  return renderer.createPostSeoDocument({ ...post, translations }, {
    ...seoDocumentContext(origin, site, localization, storagePublicBaseUrl),
    locale: post.locale
  });
}

async function resolveProductSeo(
  route: Extract<PublicContentRoute, { type: "product" }>,
  origin: string,
  site: Awaited<ReturnType<typeof readSiteSeoDefaults>>,
  localization: RouteLocalizationSettings,
  renderer: PublicSeoRenderer,
  storagePublicBaseUrl?: string
) {
  const product = await prisma.product.findFirst({
    where: {
      slug: route.slug,
      locale: route.locale,
      status: "ACTIVE"
    },
    select: {
      id: true,
      name: true,
      slug: true,
      locale: true,
      translationGroupId: true,
      description: true,
      sku: true,
      priceCents: true,
      currency: true,
      stockQuantity: true,
      reservedQuantity: true,
      metaTitle: true,
      metaDescription: true,
      seo: true,
      images: {
        orderBy: [
          { isPrimary: "desc" },
          { sortOrder: "asc" }
        ],
        take: 1,
        select: {
          mediaAssetId: true,
          url: true,
          alt: true,
          isPrimary: true
        }
      },
      variants: {
        where: { active: true },
        select: { stockQuantity: true, reservedQuantity: true }
      }
    }
  });
  if (!product) return null;

  const translations = await prisma.product.findMany({
    where: {
      locale: { in: publicLocaleCodes(localization) },
      status: "ACTIVE",
      OR: [
        { id: product.id },
        ...(product.translationGroupId ? [{ translationGroupId: product.translationGroupId }] : [])
      ]
    },
    select: { name: true, slug: true, locale: true },
    orderBy: { locale: "asc" }
  });

  const enrichedProduct = await enrichPublicMedia(prisma, withAvailableInventory(product));

  return renderer.createProductSeoDocument({ ...enrichedProduct, translations }, {
    ...seoDocumentContext(origin, site, localization, storagePublicBaseUrl),
    locale: product.locale
  });
}

async function resolveSeoMeta(
  req: Request,
  renderer: PublicSeoRenderer,
  storagePublicBaseUrl?: string
): Promise<SeoDocument> {
  if (isAdminShellPath(req.path)) {
    return renderer.createGenericSeoDocument({
      title: "Code Epsylon Admin",
      description: "Code Epsylon administration console.",
      htmlLang: "en",
      noindex: true
    });
  }

  const fallbackOrigin = requestOrigin(req).replace(/\/+$/g, "");
  let route = publicContentRouteFromRequest(req);

  try {
    const [site, localization] = await Promise.all([
      readSiteSeoDefaults(),
      readLocalizationSettings(prisma)
    ]);
    route = publicContentRouteFromRequest(req, localization);
    const origin = (site.publicBaseUrl || fallbackOrigin).replace(/\/+$/g, "");

    if (route.type === "post") {
      const postMeta = await resolvePostSeo(
        route,
        origin,
        site,
        localization,
        renderer,
        storagePublicBaseUrl
      );
      if (postMeta) return postMeta;
    }

    if (route.type === "product") {
      const productMeta = await resolveProductSeo(
        route,
        origin,
        site,
        localization,
        renderer,
        storagePublicBaseUrl
      );
      if (productMeta) return productMeta;
    }

    if (route.type === "shop") {
      const [category, shopSettings] = await Promise.all([
        route.category
          ? prisma.productCategory.findFirst({
              where: { slug: route.category, locale: route.locale },
              select: {
                id: true,
                name: true,
                slug: true,
                locale: true,
                translationGroupId: true
              }
            })
          : Promise.resolve(null),
        readShopSettings(prisma)
      ]);
      const routeTitle = category?.name || (route.attributeValue
        ? `${route.attributeName}: ${route.attributeValue}`.replaceAll("-", " ")
        : shopSettings.catalogTitle);
      const categoryTranslations = category
        ? await prisma.productCategory.findMany({
            where: {
              locale: { in: publicLocaleCodes(localization) },
              OR: [
                { id: category.id },
                ...(category.translationGroupId ? [{ translationGroupId: category.translationGroupId }] : [])
              ]
            },
            select: { slug: true, locale: true },
            orderBy: { locale: "asc" }
          })
        : [];
      const translations = categoryTranslations.length
        ? categoryTranslations.map((translation) => ({
            locale: translation.locale,
            route: { ...route, locale: translation.locale, category: translation.slug }
          }))
        : publicLocaleCodes(localization)
            .map((locale) => ({ locale, route: { ...route, locale } }));

      return renderer.createShopSeoDocument({
        locale: route.locale,
        route,
        title: routeTitle,
        description: shopSettings.catalogDescription || site.description || "Browse products and product details.",
        translations
      }, {
        ...seoDocumentContext(origin, site, localization, storagePublicBaseUrl),
        locale: route.locale,
        route
      });
    }

    const page = route.type === "page"
      ? await prisma.cmsPage.findFirst({
          where: visiblePublishedWhere(route.slug, route.locale),
          select: {
            id: true,
            title: true,
            slug: true,
            locale: true,
            translationGroupId: true,
            excerpt: true,
            metaTitle: true,
            metaDescription: true,
            seo: true
          }
        })
      : null;
    if (!page) {
      return renderer.createGenericSeoDocument({
        ...seoDocumentContext(origin, site, localization, storagePublicBaseUrl),
        title: site.title || config.app.name,
        description: site.description || "Modular project foundation.",
        htmlLang: htmlLangFromLocale(route.locale),
        canonicalUrl: `${origin}/`,
        locale: route.locale
      });
    }

    const translations = await prisma.cmsPage.findMany({
      where: publishedTranslationWhere(page.id, page.translationGroupId, publicLocaleCodes(localization)),
      select: { title: true, slug: true, locale: true },
      orderBy: { locale: "asc" }
    });

    return renderer.createPageSeoDocument({ ...page, translations }, {
      ...seoDocumentContext(origin, site, localization, storagePublicBaseUrl),
      locale: page.locale
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) {
      return renderer.createGenericSeoDocument({
        title: config.app.name,
        description: "Modular project foundation.",
        htmlLang: htmlLangFromLocale(route.locale),
        canonicalUrl: `${fallbackOrigin}/`,
        origin: fallbackOrigin,
        locale: route.locale,
        siteName: config.app.name
      });
    }

    logger.warn({ err: error, path: req.path }, "Unable to resolve page SEO metadata");
    return renderer.createGenericSeoDocument({
      title: config.app.name,
      description: "Modular project foundation.",
      htmlLang: htmlLangFromLocale(route.locale),
      canonicalUrl: `${fallbackOrigin}/`,
      origin: fallbackOrigin,
      locale: route.locale,
      siteName: config.app.name
    });
  }
}

function loadPublicMarkupRenderer(webRoot: string) {
  if (!publicMarkupRenderer) {
    const rendererUrl = pathToFileURL(join(webRoot, "web", "public-renderer.js")).href;
    publicMarkupRenderer = import(rendererUrl) as Promise<PublicMarkupRenderer>;
  }

  return publicMarkupRenderer;
}

function loadPublicSeoRenderer(webRoot: string) {
  if (!publicSeoRenderer) {
    const rendererUrl = pathToFileURL(join(webRoot, "web", "seo-document.js")).href;
    publicSeoRenderer = import(rendererUrl) as Promise<PublicSeoRenderer>;
  }

  return publicSeoRenderer;
}

async function resolvePublicMenu(
  renderer: PublicMarkupRenderer,
  locale: string,
  renderContext: Record<string, unknown>
) {
  try {
    const menu = await new CmsService(prisma).getMenu("main", false, locale);
    return renderer.withPublicRenderContext(
      renderContext,
      () => renderer.renderMenuItems(menu.items, false)
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "";
    throw error;
  }
}

async function resolvePublicShellContent(
  req: Request,
  webRoot: string,
  storage: AppConfig["storage"] = config.storage
): Promise<PublicShellResolution> {
  if (isAdminShellPath(req.path)) return { found: true, content: null };

  try {
    const [localization, site, renderer, moduleStates] = await Promise.all([
      readLocalizationSettings(prisma),
      readSiteSeoDefaults(),
      loadPublicMarkupRenderer(webRoot),
      readPublicModuleStates()
    ]);
    const route = publicContentRouteFromRequest(req, localization);
    const siteTitle = site.title || config.app.name;
    const head = publicSiteStyleTag(site.design, site.customCss, site.generatedCss);
    const publicRenderContext = {
      locale: route.locale,
      path: req.path,
      config: {
        app: config.app,
        api: config.api,
        storage: {
          publicBaseUrl: storage.publicBaseUrl,
          imageVariantWidths: storage.imageVariantWidths
        },
        siteSettings: {
          title: siteTitle,
          description: site.description,
          metaDescription: site.description,
          searchIndexing: site.noindex !== true,
          design: site.design,
          customCss: site.customCss
        },
        localization
      }
    };
    const renderPublic = <T>(render: () => T) =>
      renderer.withPublicRenderContext(publicRenderContext, render);
    const requiredModule = route.type === "product" || route.type === "shop" ? "products" : "cms";
    if (!publicModuleEnabled(moduleStates, requiredModule)) {
      return { found: false, content: null, siteTitle, localization };
    }
    const shopSettings = route.type === "product" || route.type === "shop"
      ? await readShopSettings(prisma)
      : null;
    const menu = await resolvePublicMenu(renderer, route.locale, publicRenderContext);

    if (route.type === "post") {
      const post = await prisma.cmsPost.findFirst({
        where: visiblePublishedWhere(route.slug, route.locale),
        select: {
          title: true,
          slug: true,
          locale: true,
          excerpt: true,
          content: true,
          status: true,
          publishedAt: true
        }
      });
      if (!post) return { found: false, content: null, siteTitle, localization };

      return {
        found: true,
        siteTitle,
        localization,
        content: {
          head,
          brand: renderPublicBrand(site),
          menu,
          body: renderPublic(() => renderer.renderPostContent({
            ...post,
            content: sanitizePostContent(post.content)
          })),
          footer: renderPublic(() => renderer.renderFooter({ title: siteTitle }, false))
        }
      };
    }

    if (route.type === "product") {
      const product = await prisma.product.findFirst({
        where: {
          slug: route.slug,
          locale: route.locale,
          status: "ACTIVE"
        },
        include: {
          category: true,
          images: {
            orderBy: { sortOrder: "asc" }
          },
          options: {
            orderBy: { sortOrder: "asc" }
          },
          variants: {
            where: { active: true },
            orderBy: { createdAt: "asc" }
          }
        }
      });
      if (!product) return { found: false, content: null, siteTitle, localization };
      const enrichedProduct = await enrichPublicMedia(prisma, withAvailableInventory(product));

      return {
        found: true,
        siteTitle,
        localization,
        content: {
          head,
          brand: renderPublicBrand(site),
          menu,
          body: renderPublic(() => renderer.renderProductDetailContent(enrichedProduct, {
            locale: route.locale,
            defaultLocale: localization.defaultLocale,
            shopSettings
          })),
          footer: renderPublic(() => renderer.renderFooter({ title: siteTitle }, false))
        }
      };
    }

    if (route.type === "shop") {
      const limit = shopSettings?.productsPerPage || 20;
      const hero = shopSettings?.catalogHero;
      const [productPage, categories, attributes, catalogHeroMedia] = await Promise.all([
        readPublicShopProductPage(route, limit, shopSettings?.catalogSort),
        prisma.productCategory.findMany({
          where: { locale: route.locale },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
        }),
        prisma.productAttribute.findMany({
          where: { locale: route.locale },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
        }),
        hero?.enabled && hero.mediaType === "IMAGE" && hero.mediaUrl
          ? enrichPublicMedia(prisma, {
              url: hero.mediaUrl,
              alt: hero.altText || shopSettings?.catalogTitle || "Shop"
            })
          : Promise.resolve(null)
      ]);

      return {
        found: true,
        siteTitle,
        localization,
        content: {
          head,
          brand: renderPublicBrand(site),
          menu,
          body: renderPublic(() => renderer.renderShopListingContent({
            products: productPage.products,
            categories,
            attributes,
            route,
            pagination: {
              page: route.page,
              limit,
              total: productPage.total
            }
          }, {
            locale: route.locale,
            defaultLocale: localization.defaultLocale,
            shopSettings,
            catalogHeroMedia
          })),
          footer: renderPublic(() => renderer.renderFooter({ title: siteTitle }, false))
        }
      };
    }

    const page = await prisma.cmsPage.findFirst({
      where: visiblePublishedWhere(route.slug, route.locale),
      include: {
        sections: {
          orderBy: { sortOrder: "asc" },
          include: {
            blocks: {
              orderBy: { sortOrder: "asc" },
              include: { mediaAsset: true }
            }
          }
        }
      }
    });
    if (!page) return { found: false, content: null, siteTitle, localization };
    const sanitizedPage = {
      ...page,
      sections: page.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => ({
          ...block,
          value: sanitizeContentBlockValue(block.type, block.value)
        }))
      }))
    };
    const mediaEnrichedPage = await enrichPublicMedia(prisma, sanitizedPage);
    const commerceEnabled = publicModuleEnabled(moduleStates, "products");
    const enrichedPage = commerceEnabled
      ? await enrichProductListContent(prisma, mediaEnrichedPage, route.locale)
      : mediaEnrichedPage;
    const pageShopSettings = commerceEnabled
      ? await readShopSettings(prisma)
      : null;

    return {
      found: true,
      siteTitle,
      localization,
      content: {
        head,
        brand: renderPublicBrand(site),
        bodyAttributes: generatedPageBodyAttributes(enrichedPage),
        menu,
        body: renderPublic(() => renderer.renderPageContent(enrichedPage, {
          canEdit: false,
          commerceEnabled,
          shopSettings: pageShopSettings
        })),
        footer: renderPublic(() => renderer.renderFooter(enrichedPage, false, { menu }))
      }
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) {
      return { found: false, content: null };
    }

    throw error;
  }
}

export function publicNotFoundContent(siteTitle: string, renderer?: PublicMarkupRenderer): PublicShellContent {
  return {
    brand: escapeHtml(siteTitle),
    body: `
      <section class="empty-state public-not-found">
        <p class="section-label">404</p>
        <h1 class="page-title">Page not found</h1>
        <p class="page-excerpt">The page may have moved or is no longer available.</p>
        <a class="action-link" href="/">Return home</a>
      </section>
    `,
    footer: renderer?.renderFooter({ title: siteTitle }, false) ?? ""
  };
}

function createAppShellRenderer(
  webRoot: string,
  options: { publicRoute?: boolean; storageSettings?: StorageSettingsService } = {}
) {
  const indexPath = join(webRoot, "index.html");

  return async function renderAppShell(req: Request, res: Response, next: NextFunction) {
    try {
      const seoRendererPromise = loadPublicSeoRenderer(webRoot);
      const [html, seoRenderer, meta, resolution] = await Promise.all([
        readFile(indexPath, "utf8"),
        seoRendererPromise,
        seoRendererPromise.then((renderer) => resolveSeoMeta(
          req,
          renderer,
          options.storageSettings?.getRuntimeConfig().publicBaseUrl
        )),
        options.publicRoute
          ? resolvePublicShellContent(
              req,
              webRoot,
              options.storageSettings?.getRuntimeConfig() ?? config.storage
            )
          : Promise.resolve<PublicShellResolution>({ found: true, content: null })
      ]);
      const notFound = options.publicRoute && !resolution.found;
      const renderer = notFound ? await loadPublicMarkupRenderer(webRoot) : undefined;
      let content = notFound
        ? publicNotFoundContent(resolution.siteTitle || meta.title || config.app.name, renderer)
        : resolution.content;
      const document = notFound
        ? seoRenderer.createGenericSeoDocument({
            title: `Page not found | ${resolution.siteTitle || config.app.name}`,
            description: "The requested page could not be found.",
            htmlLang: meta.htmlLang,
            locale: meta.htmlLang,
            siteName: resolution.siteTitle || config.app.name,
            noindex: true
          })
        : meta;
      if (content && resolution.localization && !notFound) {
        content = {
          ...content,
          menu: `${content.menu ?? ""}${seoRenderer.renderLanguageSwitcher(document, resolution.localization)}`
        };
      }
      const shell = seoRenderer.injectSeoDocument(html, document);

      if (notFound) res.status(404).setHeader("cache-control", "no-store");
      res.type("html").send(content ? injectPublicShellContent(shell, content) : shell);
    } catch (error) {
      next(error);
    }
  };
}

function createStaticShellRenderer(root: string, webRoot: string) {
  const indexPath = join(root, "index.html");

  return async function renderStaticShell(req: Request, res: Response, next: NextFunction) {
    try {
      const [html, seoRenderer] = await Promise.all([
        readFile(indexPath, "utf8"),
        loadPublicSeoRenderer(webRoot)
      ]);
      const document = await resolveSeoMeta(req, seoRenderer);
      res.type("html").send(seoRenderer.injectSeoDocument(html, document));
    } catch (error) {
      next(error);
    }
  };
}

export async function createApp() {
  const app = express();
  const webRoot = resolve(process.cwd(), "apps/web");
  const customStorefrontRoot = await resolveCustomStorefrontRoot(config.app.customStorefrontDir);
  const localStorageRoot = resolve(process.cwd(), config.storage.localDir);
  const storageSettings = new StorageSettingsService(prisma, config);
  await storageSettings.initialize();
  const renderAppShell = createAppShellRenderer(webRoot, { storageSettings });
  const renderPublicShell = createAppShellRenderer(webRoot, { publicRoute: true, storageSettings });
  const renderCustomStorefront = customStorefrontRoot
    ? createStaticShellRenderer(customStorefrontRoot, webRoot)
    : null;
  const copiedRuntimeEnabled = true;
  const cmsService = new CmsService(prisma);
  const security = createPlatformSecurityMiddleware(config, prisma);

  app.disable("x-powered-by");
  app.set("trust proxy", config.api.trustProxy);
  app.use(requestContext);
  app.use(pinoHttp({
    logger,
    serializers: {
      req: serializeHttpRequest,
      res: serializeHttpResponse
    },
    wrapSerializers: false
  }));
  app.use(security.headers);
  app.use(security.cors);
  app.use(compression());
  app.use(cookieParser());
  app.use(createAdminMutationAudit({ config, prisma, logger }));
  app.use(config.api.prefix, security.apiLimiter);
  app.use(`${config.api.prefix}/auth`, security.authLimiter);
  app.use(`${config.api.prefix}/config`, security.adminWriteLimiter);
  app.use(express.json({
    limit: config.storage.requestBodyLimit,
    verify: (req, _res, buffer) => {
      (req as Request).rawBody = Buffer.from(buffer);
    }
  }));
  app.use(express.urlencoded({ extended: true }));
  const installation = createInstallationRouter({ config, prisma, logger });
  app.use(`${config.api.prefix}/install`, installation.router);
  app.get("/install", async (_req, res, next) => {
    try {
      if ((await installation.service.status()).installed) {
        res.redirect(302, "/cy-admin");
        return;
      }
      res.sendFile(join(webRoot, "install.html"));
    } catch (error) {
      next(error);
    }
  });
  app.use(createInstallationGate(installation.service, config));
  app.get("/sitemap.xml", async (req, res, next) => {
    try {
      res.type("application/xml").send(await cmsService.buildSitemap(requestOrigin(req)));
    } catch (error) {
      next(error);
    }
  });
  app.get("/robots.txt", async (req, res, next) => {
    try {
      res.type("text/plain").send(await cmsService.buildRobotsTxt(requestOrigin(req)));
    } catch (error) {
      next(error);
    }
  });
  if (copiedRuntimeEnabled) {
    app.use(express.static(webRoot, { index: false }));
  }
  if (customStorefrontRoot) {
    app.use("/__storefront", (_req, res, next) => {
      res.setHeader("cache-control", customStorefrontAssetCacheControl(config.isProduction));
      next();
    });
    app.use("/__storefront", express.static(customStorefrontRoot, {
      cacheControl: false,
      index: false,
      etag: true
    }));
  }
  registerPublicMediaRoutes(app, config, localStorageRoot, {
    adapter: storageSettings.adapter,
    getRuntimeConfig: () => storageSettings.getRuntimeConfig()
  });
  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });
  app.use(createMaintenanceMiddleware({ config, prisma, logger }));
  if (copiedRuntimeEnabled) {
    app.get([
      "/cy-admin",
      "/auth/reset-password",
      "/auth/invite",
      "/auth/verify-email",
      "/dashboard",
      "/dashboard/*"
    ], renderAppShell);
  }

  const loadedModules = await loadModules(app, modules, {
    config,
    prisma,
    logger,
    storageSettings
  });

  app.get(config.api.prefix, (_req, res) => {
    res.json({
      success: true,
      data: {
        name: config.app.name,
        mode: config.app.mode,
        api: config.api.prefix,
        modules: loadedModules
      },
      error: null,
      meta: null
    });
  });

  app.get("*", async (req, res, next) => {
    if (!shouldRenderPublicShell(req.path, copiedRuntimeEnabled)) {
      next();
      return;
    }

    try {
      const canonicalTarget = canonicalPublicRedirectTarget(req.originalUrl, req.path);
      if (canonicalTarget) {
        res.setHeader("cache-control", "public, max-age=3600");
        res.redirect(308, canonicalTarget);
        return;
      }

      const redirect = await cmsService.resolveRedirect(req.originalUrl);
      if (redirect) {
        res.setHeader("cache-control", redirect.statusCode === 301 || redirect.statusCode === 308
          ? "public, max-age=3600"
          : "no-store");
        res.redirect(redirect.statusCode, redirect.targetPath);
        return;
      }

      if (renderCustomStorefront) {
        await renderCustomStorefront(req, res, next);
        return;
      }

      await renderPublicShell(req, res, next);
    } catch (error) {
      next(error);
    }
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
