import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
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
import { localizedPath, normalizeLocale, readLocalizationSettings } from "../modules/localization/localization.service.js";

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
  return createRateLimiter("auth_rate_limit_exceeded", "Too many authentication attempts.", config.rateLimits.platform.authMax);
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
};

let publicMarkupRenderer: Promise<PublicMarkupRenderer> | null = null;

type PublicContentRoute =
  | { type: "page"; slug: string; locale: string }
  | { type: "post"; slug: string; locale: string }
  | { type: "product"; slug: string; locale: string };

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

function publicContentRouteFromRequest(req: Request, localization?: RouteLocalizationSettings): PublicContentRoute {
  const querySlug = firstQueryValue(req.query.slug);
  const parts = req.path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  let locale = normalizeLocale(localization?.defaultLocale || "en");

  if (isConfiguredRouteLocale(parts[0], localization)) locale = normalizeLocale(parts.shift());
  if (parts[0] === "posts" && parts[1]) return { type: "post", slug: parts.slice(1).join("/"), locale };
  if (parts[0] === "product" && parts[1]) return { type: "product", slug: parts.slice(1).join("/"), locale };

  return { type: "page", slug: querySlug || parts.join("/") || "home", locale };
}

function localizedResourcePath(prefix: string, slug: string, locale: string, defaultLocale = "en") {
  const localeCode = normalizeLocale(locale);
  const defaultLocaleCode = normalizeLocale(defaultLocale);
  const normalizedSlug = slug.replace(/^\/+|\/+$/g, "");
  const path = `/${prefix}/${encodeSlugPath(normalizedSlug)}`;

  return localeCode === defaultLocaleCode ? path : `/${localeCode}${path}`;
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
      description: ""
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
    noindex: storedSettings.searchIndexing === false
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

async function resolvePublicShellContent(req: Request, webRoot: string): Promise<PublicShellContent | null> {
  if (isAdminShellPath(req.path)) return null;

  try {
    const [localization, site, renderer] = await Promise.all([
      readLocalizationSettings(prisma),
      readSiteSeoDefaults(),
      loadPublicMarkupRenderer(webRoot)
    ]);
    const route = publicContentRouteFromRequest(req, localization);
    const siteTitle = site.title || config.app.name;

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
      if (!post) return null;

      return {
        brand: escapeHtml(siteTitle),
        body: renderer.renderPostContent(post),
        footer: renderer.renderFooter({ title: siteTitle }, false)
      };
    }

    if (route.type !== "page") return null;
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
    if (!page) return null;

    return {
      brand: escapeHtml(siteTitle),
      body: renderer.renderPageContent(page, { canEdit: false }),
      footer: renderer.renderFooter({ title: siteTitle }, false)
    };
  } catch (error) {
    logger.warn({ err: error, path: req.path }, "Unable to render public page content");
    return null;
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

function createAppShellRenderer(webRoot: string) {
  const indexPath = join(webRoot, "index.html");

  return async function renderAppShell(req: Request, res: Response, next: NextFunction) {
    try {
      const [html, meta, content] = await Promise.all([
        readFile(indexPath, "utf8"),
        resolveSeoMeta(req),
        resolvePublicShellContent(req, webRoot)
      ]);
      const shell = injectSeoMeta(html, meta);

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
      if (!key) {
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

      await sendStorageResponse(res, storageResponse);
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

function acceptsWebp(req: Request) {
  return /\bimage\/webp\b/i.test(req.header("accept") || "");
}

async function fetchStorageObject(storage: StorageAdapter, key: string) {
  const download = await storage.createDownloadUrl(key);

  return fetch(download.url);
}

function setPublicUploadCacheHeaders(res: Response, varyAccept = false) {
  if (varyAccept) res.setHeader("vary", "Accept");
  res.setHeader("cache-control", "public, max-age=31536000, immutable");
}

async function sendBufferResponse(
  res: Response,
  body: Buffer,
  contentType: string | null | undefined,
  varyAccept = false
) {
  if (contentType) res.type(contentType);
  res.setHeader("content-length", String(body.byteLength));
  setPublicUploadCacheHeaders(res, varyAccept);
  res.send(body);
}

async function sendStorageResponse(res: Response, storageResponse: globalThis.Response, varyAccept = false) {
  const contentType = storageResponse.headers.get("content-type");
  const contentLength = storageResponse.headers.get("content-length");

  if (contentType) res.type(contentType);
  if (contentLength) res.setHeader("content-length", contentLength);
  setPublicUploadCacheHeaders(res, varyAccept);

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
    await sendStorageResponse(res, variantResponse, true);
    return true;
  }

  return false;
}

export async function createApp() {
  const app = express();
  const webRoot = resolve(process.cwd(), "apps/web");
  const localStorageRoot = resolve(process.cwd(), config.storage.localDir);
  const renderAppShell = createAppShellRenderer(webRoot);
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
  app.use(`${config.api.prefix}/config/modules`, createAdminWriteLimiter());
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
    app.use("/uploads", express.static(localStorageRoot, { dotfiles: "deny", index: false }));
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

  app.get("*", (req, res, next) => {
    if (!shouldRenderPublicShell(req.path, copiedRuntimeEnabled)) {
      next();
      return;
    }

    void renderAppShell(req, res, next);
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
