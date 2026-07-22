import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pathToFileURL } from "node:url";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config } from "../config/index.js";
import { errorHandler } from "./http/error.middleware.js";
import { createMaintenanceMiddleware } from "./http/maintenance.middleware.js";
import { loadModules } from "./http/module-loader.js";
import { notFoundHandler } from "./http/not-found.middleware.js";
import { requestContext } from "./http/request-context.middleware.js";
import { injectPublicShellContent, type PublicShellContent } from "./public-shell.js";
import { prisma } from "../infrastructure/database/prisma.js";
import { logger } from "../infrastructure/logging/logger.js";
import {
  serializeHttpRequest,
  serializeHttpResponse
} from "../infrastructure/logging/http-logging.js";
import { createStorageAdapter } from "../infrastructure/storage/s3-storage.js";
import type { StorageAdapter } from "../infrastructure/storage/storage.types.js";
import { modules } from "../modules/index.js";
import { CmsService } from "../modules/cms/cms.service.js";
import {
  isOptimizableImageKey,
  optimizedImageStorageKey,
  requestedImageWidth
} from "../modules/cms/media-optimizer.js";
import { publicMediaResponsePolicy } from "../modules/cms/media-policy.js";
import { sanitizeContentBlockValue, sanitizePostContent } from "../modules/cms/rich-text-sanitizer.js";
import { localizedPath, normalizeLocale, readLocalizationSettings } from "../modules/localization/localization.service.js";
import {
  findProductAttributePage,
  orderProductsByIds
} from "../modules/products/product-attribute-filter.js";
import { readShopSettings } from "../modules/products/shop-settings.js";
import { publicSiteStyleTag } from "../modules/config/site-design.js";

function normalizeOrigin(origin: string | undefined) {
  if (!origin) return undefined;

  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(/\/+$/, "");
  }
}

function createCorsOptions() {
  const allowedOrigins = new Set(
    [...config.cors.origins, config.app.publicUrl]
      .map(normalizeOrigin)
      .filter((origin): origin is string => Boolean(origin))
  );

  if (!config.isProduction) {
    allowedOrigins.add(`http://localhost:${config.api.port}`);
    allowedOrigins.add(`http://127.0.0.1:${config.api.port}`);
  }

  return {
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      const normalizedOrigin = normalizeOrigin(origin);

      if (!normalizedOrigin || allowedOrigins.size === 0 || allowedOrigins.has(normalizedOrigin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true
  };
}

function createApiLimiter() {
  return createRateLimiter("rate_limit_exceeded", "Too many API requests.", config.rateLimits.platform.apiMax);
}

function createAuthLimiter() {
  return createRateLimiter(
    "auth_rate_limit_exceeded",
    "Too many authentication attempts.",
    config.rateLimits.platform.authMax,
    { writeOnly: true }
  );
}

function createAiLimiter() {
  return createRateLimiter(
    "platform_ai_rate_limit_exceeded",
    "Too many prompt or chat requests. Please wait before trying again.",
    config.rateLimits.platform.aiMax,
    { writeOnly: true }
  );
}

function createGenerationLimiter() {
  return createRateLimiter(
    "platform_generation_rate_limit_exceeded",
    "Too many generation requests. Please wait before trying again.",
    config.rateLimits.platform.generationMax,
    { writeOnly: true }
  );
}

function createPublishLimiter() {
  return createRateLimiter(
    "platform_publish_rate_limit_exceeded",
    "Too many publish requests. Please wait before trying again.",
    config.rateLimits.platform.publishMax,
    { writeOnly: true }
  );
}

function createAdminWriteLimiter() {
  return createRateLimiter(
    "admin_write_rate_limit_exceeded",
    "Too many admin write requests. Please wait before trying again.",
    config.rateLimits.platform.adminMax,
    { writeOnly: true }
  );
}

function createRateLimiter(
  code: string,
  message: string,
  limit: number,
  options: { writeOnly?: boolean } = {}
) {
  return rateLimit({
    windowMs: config.rateLimits.platform.windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      if (!config.rateLimits.platform.enabled) return true;
      if (!options.writeOnly) return false;
      return !["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase());
    },
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        success: false,
        data: null,
        error: {
          code,
          message,
          details: {
            windowMs: config.rateLimits.platform.windowMs,
            limit
          }
        },
        meta: {
          requestId: res.locals.requestId
        }
      });
    }
  });
}

function createHelmetOptions() {
  const openerPolicy = config.features.payments
    ? "same-origin-allow-popups" as const
    : "same-origin" as const;
  const stripeScriptSources = [
    "https://js.stripe.com",
    "https://*.js.stripe.com",
    "https://maps.googleapis.com"
  ];
  const stripeFrameSources = [
    "https://js.stripe.com",
    "https://*.js.stripe.com",
    "https://hooks.stripe.com"
  ];
  const contentSecurityPolicyDirectives = {
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "script-src": ["'self'", ...(config.features.payments ? stripeScriptSources : [])],
    "connect-src": [
      "'self'",
      "blob:",
      ...(config.features.payments ? ["https://api.stripe.com", "https://maps.googleapis.com"] : [])
    ],
    "frame-src": ["'self'", "blob:", ...(config.features.payments ? stripeFrameSources : [])],
    "child-src": ["'self'", "blob:", ...(config.features.payments ? stripeFrameSources : [])],
    ...(config.env === "production" ? {} : { "upgrade-insecure-requests": null })
  };

  return {
    contentSecurityPolicy: {
      directives: contentSecurityPolicyDirectives
    },
    crossOriginOpenerPolicy: {
      policy: openerPolicy
    }
  };
}

type SeoMeta = {
  title: string;
  description: string;
  htmlLang: string;
  canonicalUrl?: string;
  imageUrl?: string;
  noindex?: boolean;
};

type PublicMarkupRenderer = {
  renderFooter(page: unknown, canEdit?: boolean): string;
  renderPageContent(page: unknown, options?: { canEdit?: boolean }): string;
  renderPostContent(post: unknown): string;
  renderProductDetailContent(product: unknown, options?: Record<string, unknown>): string;
  renderShopListingContent(input: unknown, options?: Record<string, unknown>): string;
};

type PublicShellResolution = {
  found: boolean;
  content: PublicShellContent | null;
  siteTitle?: string;
};

let publicMarkupRenderer: Promise<PublicMarkupRenderer> | null = null;

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

function encodeSlugPath(slug: string) {
  return slug
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function isAdminShellPath(path: string) {
  return path === "/cy-admin" || path.startsWith("/dashboard") || path.startsWith("/auth/");
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

function localizedResourcePath(prefix: string, slug: string, locale: string, defaultLocale = "en") {
  const localeCode = normalizeLocale(locale);
  const defaultLocaleCode = normalizeLocale(defaultLocale);
  const normalizedSlug = slug.replace(/^\/+|\/+$/g, "");
  const path = `/${prefix}/${encodeSlugPath(normalizedSlug)}`;

  return localeCode === defaultLocaleCode ? path : `/${localeCode}${path}`;
}

function localizedShopPath(route: Extract<PublicContentRoute, { type: "shop" }>, defaultLocale = "en") {
  const suffix = route.category
    ? `/category/${encodeURIComponent(route.category)}`
    : route.attributeName
      ? `/attribute/${encodeURIComponent(route.attributeName)}/${encodeURIComponent(route.attributeValue || "")}`
      : "";
  const path = `/shop${suffix}`;

  const localizedPath = normalizeLocale(route.locale) === normalizeLocale(defaultLocale)
    ? path
    : `/${normalizeLocale(route.locale)}${path}`;
  return route.page > 1 ? `${localizedPath}?page=${route.page}` : localizedPath;
}

async function readPublicShopProductPage(
  route: Extract<PublicContentRoute, { type: "shop" }>,
  limit: number
) {
  const where: Prisma.ProductWhereInput = {
    locale: route.locale,
    status: "ACTIVE",
    ...(route.category ? { category: { slug: route.category, locale: route.locale } } : {})
  };
  const skip = (route.page - 1) * limit;
  const include = {
    category: true,
    images: { orderBy: { sortOrder: "asc" as const } }
  };

  if (route.attributeName || route.attributeValue) {
    const result = await findProductAttributePage(
      (cursor, take) => prisma.product.findMany({
        where,
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
      products: orderProductsByIds(matchedProducts, result.ids),
      total: result.total
    };
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include
    }),
    prisma.product.count({ where })
  ]);

  return { products, total };
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

function readSeoImage(seo: Prisma.JsonValue | null) {
  if (!seo || typeof seo !== "object" || Array.isArray(seo)) return undefined;
  const image = (seo as Record<string, unknown>).image;

  return typeof image === "string" && image.trim() ? image : undefined;
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
      description: "",
      design: undefined,
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
    description: typeof storedSettings.metaDescription === "string" && storedSettings.metaDescription
      ? storedSettings.metaDescription
      : typeof storedSettings.description === "string"
        ? storedSettings.description
        : "",
    publicBaseUrl: typeof storedSettings.siteUrl === "string" && storedSettings.siteUrl.trim()
      ? normalizeOrigin(storedSettings.siteUrl)
      : undefined,
    noindex: storedSettings.searchIndexing === false,
    design: storedSettings.design,
    customCss: typeof storedSettings.customCss === "string" ? storedSettings.customCss : ""
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
  defaultLocale: string
) {
  const post = await prisma.cmsPost.findFirst({
    where: visiblePublishedWhere(route.slug, route.locale),
    select: {
      title: true,
      slug: true,
      locale: true,
      excerpt: true,
      metaTitle: true,
      metaDescription: true,
      seo: true
    }
  });
  if (!post) return null;

  return {
    title: post.metaTitle || post.title || site.title || config.app.name,
    description: post.metaDescription || post.excerpt || site.description || "Published article.",
    htmlLang: htmlLangFromLocale(post.locale),
    canonicalUrl: `${origin}${localizedResourcePath("posts", post.slug, post.locale, defaultLocale)}`,
    imageUrl: readSeoImage(post.seo ?? null),
    noindex: site.noindex
  };
}

async function resolveProductSeo(
  route: Extract<PublicContentRoute, { type: "product" }>,
  origin: string,
  site: Awaited<ReturnType<typeof readSiteSeoDefaults>>,
  defaultLocale: string
) {
  const product = await prisma.product.findFirst({
    where: {
      slug: route.slug,
      locale: route.locale,
      status: "ACTIVE"
    },
    select: {
      name: true,
      slug: true,
      locale: true,
      description: true,
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
          url: true
        }
      }
    }
  });
  if (!product) return null;

  return {
    title: product.metaTitle || product.name || site.title || config.app.name,
    description: product.metaDescription || product.description || site.description || "Product details.",
    htmlLang: htmlLangFromLocale(product.locale),
    canonicalUrl: `${origin}${localizedResourcePath("product", product.slug, product.locale, defaultLocale)}`,
    imageUrl: readSeoImage(product.seo ?? null) || product.images[0]?.url,
    noindex: site.noindex
  };
}

async function resolveSeoMeta(req: Request): Promise<SeoMeta> {
  if (isAdminShellPath(req.path)) {
    return {
      title: "Code Epsylon Admin",
      description: "Code Epsylon administration console.",
      htmlLang: "en",
      noindex: true
    };
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
      const postMeta = await resolvePostSeo(route, origin, site, localization.defaultLocale);
      if (postMeta) return postMeta;
    }

    if (route.type === "product") {
      const productMeta = await resolveProductSeo(route, origin, site, localization.defaultLocale);
      if (productMeta) return productMeta;
    }

    if (route.type === "shop") {
      const [category, shopSettings] = await Promise.all([
        route.category
          ? prisma.productCategory.findFirst({
              where: { slug: route.category, locale: route.locale },
              select: { name: true }
            })
          : Promise.resolve(null),
        readShopSettings(prisma)
      ]);
      const routeTitle = category?.name || (route.attributeValue
        ? `${route.attributeName}: ${route.attributeValue}`.replaceAll("-", " ")
        : shopSettings.catalogTitle);
      const pageTitle = route.page > 1 ? `${routeTitle} - Page ${route.page}` : routeTitle;

      return {
        title: `${pageTitle} | ${site.title || config.app.name}`,
        description: shopSettings.catalogDescription || site.description || "Browse products and product details.",
        htmlLang: htmlLangFromLocale(route.locale),
        canonicalUrl: `${origin}${localizedShopPath(route, localization.defaultLocale)}`,
        noindex: site.noindex
      };
    }

    const page = route.type === "page"
      ? await prisma.cmsPage.findFirst({
          where: visiblePublishedWhere(route.slug, route.locale),
          select: {
            title: true,
            slug: true,
            locale: true,
            excerpt: true,
            metaTitle: true,
            metaDescription: true,
            seo: true
          }
        })
      : null;
    const path = page ? localizedPath(page.slug, page.locale, localization.defaultLocale) : "/";

    return {
      title: page?.metaTitle || page?.title || site.title || config.app.name,
      description: page?.metaDescription || page?.excerpt || site.description || "Modular project foundation.",
      htmlLang: htmlLangFromLocale(page?.locale || route.locale),
      canonicalUrl: `${origin}${path}`,
      imageUrl: readSeoImage(page?.seo ?? null),
      noindex: site.noindex
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) {
      return {
        title: config.app.name,
        description: "Modular project foundation.",
        htmlLang: htmlLangFromLocale(route.locale),
        canonicalUrl: `${fallbackOrigin}/`
      };
    }

    logger.warn({ err: error, path: req.path }, "Unable to resolve page SEO metadata");
    return {
      title: config.app.name,
      description: "Modular project foundation.",
      htmlLang: htmlLangFromLocale(route.locale),
      canonicalUrl: `${fallbackOrigin}/`
    };
  }
}

function loadPublicMarkupRenderer(webRoot: string) {
  if (!publicMarkupRenderer) {
    const rendererUrl = pathToFileURL(join(webRoot, "web", "public-renderer.js")).href;
    publicMarkupRenderer = import(rendererUrl) as Promise<PublicMarkupRenderer>;
  }

  return publicMarkupRenderer;
}

async function resolvePublicShellContent(req: Request, webRoot: string): Promise<PublicShellResolution> {
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
    const head = publicSiteStyleTag(site.design, site.customCss);
    const requiredModule = route.type === "product" || route.type === "shop" ? "products" : "cms";
    if (!publicModuleEnabled(moduleStates, requiredModule)) {
      return { found: false, content: null, siteTitle };
    }
    const shopSettings = route.type === "product" || route.type === "shop"
      ? await readShopSettings(prisma)
      : null;

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
      if (!post) return { found: false, content: null, siteTitle };

      return {
        found: true,
        siteTitle,
        content: {
          head,
          brand: escapeHtml(siteTitle),
          body: renderer.renderPostContent({
            ...post,
            content: sanitizePostContent(post.content)
          }),
          footer: renderer.renderFooter({ title: siteTitle }, false)
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
          }
        }
      });
      if (!product) return { found: false, content: null, siteTitle };

      return {
        found: true,
        siteTitle,
        content: {
          head,
          brand: escapeHtml(siteTitle),
          body: renderer.renderProductDetailContent(product, {
            locale: route.locale,
            defaultLocale: localization.defaultLocale,
            shopSettings
          }),
          footer: renderer.renderFooter({ title: siteTitle }, false)
        }
      };
    }

    if (route.type === "shop") {
      const limit = shopSettings?.productsPerPage || 20;
      const [productPage, categories, attributes] = await Promise.all([
        readPublicShopProductPage(route, limit),
        prisma.productCategory.findMany({
          where: { locale: route.locale },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
        }),
        prisma.productAttribute.findMany({
          where: { locale: route.locale },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
        })
      ]);

      return {
        found: true,
        siteTitle,
        content: {
          head,
          brand: escapeHtml(siteTitle),
          body: renderer.renderShopListingContent({
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
            shopSettings
          }),
          footer: renderer.renderFooter({ title: siteTitle }, false)
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
              orderBy: { sortOrder: "asc" }
            }
          }
        }
      }
    });
    if (!page) return { found: false, content: null, siteTitle };

    return {
      found: true,
      siteTitle,
      content: {
        head,
        brand: escapeHtml(siteTitle),
        body: renderer.renderPageContent({
          ...page,
          sections: page.sections.map((section) => ({
            ...section,
            blocks: section.blocks.map((block) => ({
              ...block,
              value: sanitizeContentBlockValue(block.type, block.value)
            }))
          }))
        }, { canEdit: false }),
        footer: renderer.renderFooter({ title: siteTitle }, false)
      }
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) {
      return { found: false, content: null };
    }

    throw error;
  }
}

function injectSeoMeta(html: string, meta: SeoMeta) {
  const htmlLang = escapeHtml(meta.htmlLang || "en");
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    meta.noindex ? '<meta name="robots" content="noindex, nofollow" />' : undefined,
    meta.canonicalUrl ? `<link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />` : undefined,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    meta.canonicalUrl ? `<meta property="og:url" content="${escapeHtml(meta.canonicalUrl)}" />` : undefined,
    '<meta property="og:type" content="website" />',
    meta.imageUrl ? `<meta property="og:image" content="${escapeHtml(meta.imageUrl)}" />` : undefined,
    '<meta name="twitter:card" content="summary_large_image" />'
  ].filter(Boolean).join("\n    ");

  return html
    .replace(/<html\b[^>]*>/i, (tag) => {
      if (/\slang=(["']).*?\1/i.test(tag)) return tag.replace(/\slang=(["']).*?\1/i, ` lang="${htmlLang}"`);

      return tag.replace(/<html\b/i, `<html lang="${htmlLang}"`);
    })
    .replace(/\n?\s*<meta\s+name=(["'])description\1[^>]*\/?>/gis, "")
    .replace(/<title>.*?<\/title>/is, tags);
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

function createAppShellRenderer(webRoot: string, options: { publicRoute?: boolean } = {}) {
  const indexPath = join(webRoot, "index.html");

  return async function renderAppShell(req: Request, res: Response, next: NextFunction) {
    try {
      const [html, meta, resolution] = await Promise.all([
        readFile(indexPath, "utf8"),
        resolveSeoMeta(req),
        options.publicRoute
          ? resolvePublicShellContent(req, webRoot)
          : Promise.resolve({ found: true, content: null } satisfies PublicShellResolution)
      ]);
      const notFound = options.publicRoute && !resolution.found;
      const renderer = notFound ? await loadPublicMarkupRenderer(webRoot) : undefined;
      const content = notFound
        ? publicNotFoundContent(resolution.siteTitle || meta.title || config.app.name, renderer)
        : resolution.content;
      const shell = injectSeoMeta(html, notFound
        ? {
            title: `Page not found | ${resolution.siteTitle || config.app.name}`,
            description: "The requested page could not be found.",
            htmlLang: meta.htmlLang,
            noindex: true
          }
        : meta);

      if (notFound) res.status(404).setHeader("cache-control", "no-store");
      res.type("html").send(content ? injectPublicShellContent(shell, content) : shell);
    } catch (error) {
      next(error);
    }
  };
}

function createStaticShellRenderer(root: string) {
  const indexPath = join(root, "index.html");

  return async function renderStaticShell(_req: Request, res: Response, next: NextFunction) {
    try {
      res.type("html").send(await readFile(indexPath, "utf8"));
    } catch (error) {
      next(error);
    }
  };
}

function normalizeUploadStorageKey(value = "") {
  try {
    const key = decodeURIComponent(value).replace(/^\/+/, "");
    const keyParts = key.split("/");
    const keyPrefix = config.storage.keyPrefix.replace(/^\/+|\/+$/g, "");

    if (!key || keyParts.includes("..")) return "";
    if (keyPrefix && key !== keyPrefix && !key.startsWith(`${keyPrefix}/`)) return "";

    return key;
  } catch {
    return "";
  }
}

function createS3UploadProxy() {
  const storage = createStorageAdapter(config.storage);

  return async function proxyS3Upload(req: Request, res: Response, next: NextFunction) {
    try {
      const key = normalizeUploadStorageKey(req.params[0] || "");
      const responsePolicy = publicMediaResponsePolicy(key);
      if (!key || !responsePolicy) {
        res.status(404).end();
        return;
      }

      if (await serveOptimizedUpload(req, res, storage, key)) {
        return;
      }

      const storageResponse = await fetchStorageObject(storage, key);
      if (!storageResponse.ok) {
        res.status(storageResponse.status === 404 ? 404 : 502).end();
        return;
      }

      await sendStorageResponse(res, storageResponse, {
        contentType: responsePolicy.mimeType,
        disposition: responsePolicy.disposition,
        filename: key
      });
    } catch (error) {
      next(error);
    }
  };
}

function createLocalUploadVariantProxy(root: string) {
  return async function proxyLocalUploadVariant(req: Request, res: Response, next: NextFunction) {
    try {
      const key = normalizeUploadStorageKey(req.params[0] || "");
      const width = requestedImageWidth(req.query.w, config.storage.imageVariantWidths);
      if (!key || !width || !acceptsWebp(req) || !isOptimizableImageKey(key)) {
        next();
        return;
      }

      const variantPath = resolve(root, optimizedImageStorageKey(key, width));
      const relativePath = relative(root, variantPath);
      if (!relativePath || relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) {
        next();
        return;
      }

      try {
        await sendBufferResponse(res, await readFile(variantPath), "image/webp", true);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          next();
          return;
        }

        throw error;
      }
    } catch (error) {
      next(error);
    }
  };
}

function createLocalUploadProxy(root: string) {
  return async function proxyLocalUpload(req: Request, res: Response, next: NextFunction) {
    try {
      const key = normalizeUploadStorageKey(req.params[0] || "");
      const responsePolicy = publicMediaResponsePolicy(key);
      if (!key || !responsePolicy) {
        res.status(404).end();
        return;
      }

      const objectPath = resolve(root, key);
      const relativePath = relative(root, objectPath);
      if (!relativePath || relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) {
        res.status(404).end();
        return;
      }

      try {
        await sendBufferResponse(
          res,
          await readFile(objectPath),
          responsePolicy.mimeType,
          false,
          responsePolicy.disposition,
          key
        );
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          res.status(404).end();
          return;
        }

        throw error;
      }
    } catch (error) {
      next(error);
    }
  };
}

function acceptsWebp(req: Request) {
  return /\bimage\/webp\b/i.test(req.header("accept") || "");
}

async function fetchStorageObject(storage: StorageAdapter, key: string) {
  const download = await storage.createDownloadUrl(key);

  return fetch(download.url);
}

function setPublicUploadHeaders(
  res: Response,
  varyAccept = false,
  disposition: "attachment" | "inline" = "inline",
  filename?: string
) {
  if (varyAccept) res.setHeader("vary", "Accept");
  res.setHeader("cache-control", "public, max-age=31536000, immutable");
  res.setHeader("content-security-policy", "default-src 'none'; sandbox");
  res.setHeader("x-content-type-options", "nosniff");
  if (filename) {
    const safeFilename = basename(filename).replace(/[^a-z0-9._-]+/gi, "-");
    res.setHeader("content-disposition", `${disposition}; filename="${safeFilename || "download"}"`);
  }
}

async function sendBufferResponse(
  res: Response,
  body: Buffer,
  contentType: string | null | undefined,
  varyAccept = false,
  disposition: "attachment" | "inline" = "inline",
  filename?: string
) {
  if (contentType) res.type(contentType);
  res.setHeader("content-length", String(body.byteLength));
  setPublicUploadHeaders(res, varyAccept, disposition, filename);
  res.send(body);
}

async function sendStorageResponse(
  res: Response,
  storageResponse: globalThis.Response,
  options: {
    contentType?: string;
    disposition?: "attachment" | "inline";
    filename?: string;
    varyAccept?: boolean;
  } = {}
) {
  const contentType = options.contentType ?? storageResponse.headers.get("content-type");
  const contentLength = storageResponse.headers.get("content-length");

  if (contentType) res.type(contentType);
  if (contentLength) res.setHeader("content-length", contentLength);
  setPublicUploadHeaders(
    res,
    options.varyAccept ?? false,
    options.disposition ?? "inline",
    options.filename
  );

  if (!storageResponse.body) {
    res.end();
    return;
  }

  await new Promise<void>((resolveStream, rejectStream) => {
    const stream = Readable.fromWeb(storageResponse.body! as unknown as NodeReadableStream<Uint8Array>);

    stream.on("error", rejectStream);
    res.on("error", rejectStream);
    res.on("finish", resolveStream);
    stream.pipe(res);
  });
}

async function serveOptimizedUpload(req: Request, res: Response, storage: StorageAdapter, key: string) {
  if (!acceptsWebp(req) || !isOptimizableImageKey(key)) return false;

  const width = requestedImageWidth(req.query.w, config.storage.imageVariantWidths);
  if (!width) return false;

  const variantKey = optimizedImageStorageKey(key, width);
  const variantResponse = await fetchStorageObject(storage, variantKey);

  if (variantResponse.ok) {
    await sendStorageResponse(res, variantResponse, {
      contentType: "image/webp",
      varyAccept: true
    });
    return true;
  }

  return false;
}

export async function createApp() {
  const app = express();
  const webRoot = resolve(process.cwd(), "apps/web");
  const localStorageRoot = resolve(process.cwd(), config.storage.localDir);
  const renderAppShell = createAppShellRenderer(webRoot);
  const renderPublicShell = createAppShellRenderer(webRoot, { publicRoute: true });
  const copiedRuntimeEnabled = true;
  const cmsService = new CmsService(prisma);

  app.disable("x-powered-by");
  if (config.isProduction) app.set("trust proxy", 1);
  app.use(requestContext);
  app.use(pinoHttp({
    logger,
    serializers: {
      req: serializeHttpRequest,
      res: serializeHttpResponse
    },
    wrapSerializers: false
  }));
  app.use(helmet(createHelmetOptions()));
  app.use(cors(createCorsOptions()));
  app.use(compression());
  app.use(cookieParser());
  app.use(config.api.prefix, createApiLimiter());
  app.use(`${config.api.prefix}/auth`, createAuthLimiter());
  app.use(`${config.api.prefix}/config`, createAdminWriteLimiter());
  app.use(express.json({
    limit: config.storage.requestBodyLimit,
    verify: (req, _res, buffer) => {
      (req as Request).rawBody = Buffer.from(buffer);
    }
  }));
  app.use(express.urlencoded({ extended: true }));
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
  if (config.storage.driver === "local") {
    app.get("/uploads/*", createLocalUploadVariantProxy(localStorageRoot));
    app.get("/uploads/*", createLocalUploadProxy(localStorageRoot));
  } else if (config.storage.driver === "s3") {
    app.get("/uploads/*", createS3UploadProxy());
  }
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
    logger
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
      const redirect = await cmsService.resolveRedirect(req.originalUrl);
      if (redirect) {
        res.setHeader("cache-control", redirect.statusCode === 301 || redirect.statusCode === 308
          ? "public, max-age=3600"
          : "no-store");
        res.redirect(redirect.statusCode, redirect.targetPath);
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
