import type { Router } from "express";
import rateLimit from "express-rate-limit";
import type { ModuleContext } from "../../core/types/module.js";
import { AppError } from "../../core/errors/app-error.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendCreated, sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { hasPermission, optionalAuth, requirePermission } from "../auth/auth.middleware.js";
import {
  addContentBlockSchema,
  addSectionSchema,
  blockParams,
  categoryParams,
  cleanupOrphanMediaSchema,
  completeSignedUploadSchema,
  createContentTranslationSchema,
  contactSubmissionSchema,
  createCmsCategorySchema,
  createCmsPageSchema,
  createCmsPostSchema,
  createMediaAssetSchema,
  createMenuItemSchema,
  createMenuSchema,
  createRedirectSchema,
  createSignedUploadSchema,
  deleteMediaAssetSchema,
  directMediaUploadSchema,
  localeQuerySchema,
  mediaAssetParams,
  menuItemParams,
  menuParams,
  pageQuerySchema,
  postQuerySchema,
  redirectParams,
  redirectResolveQuerySchema,
  revisionParams,
  sectionParams,
  slugParams,
  updateCmsCategorySchema,
  updateCmsPageSchema,
  updateCmsPostSchema,
  updateContentBlockSchema,
  updateMenuItemSchema,
  updateRedirectSchema
} from "./cms.schemas.js";
import { CmsService } from "./cms.service.js";
import { MediaService } from "./media.service.js";
import { readLocalizationSettings, resolveLocale } from "../localization/localization.service.js";

function canReadDrafts(user: Express.Request["user"]) {
  return hasPermission(user, "read", "cms");
}

function assertPageVisible(
  page: { status: string; publishedAt?: Date | null },
  user: Express.Request["user"]
) {
  const isPublishedNow =
    page.status === "PUBLISHED" && (!page.publishedAt || page.publishedAt.getTime() <= Date.now());

  if (!isPublishedNow && !canReadDrafts(user)) {
    throw new AppError(404, "not_found", "Page not found.");
  }
}

function requestOrigin(req: {
  protocol: string;
  header: (name: string) => string | undefined;
}) {
  const protocol = req.header("x-forwarded-proto") ?? req.protocol;
  const host = req.header("x-forwarded-host") ?? req.header("host") ?? "localhost";

  return `${protocol}://${host}`;
}

function requestMeta(req: { header: (name: string) => string | undefined; ip?: string }) {
  return {
    userAgent: req.header("user-agent"),
    ipAddress: req.ip
  };
}

function normalizePublishedAt<T extends { status?: string; publishedAt?: Date }>(data: T) {
  if (data.status === "PUBLISHED" && !data.publishedAt) {
    return {
      ...data,
      publishedAt: new Date()
    };
  }

  return data;
}

async function requestLocale(context: ModuleContext, value: unknown) {
  const settings = await readLocalizationSettings(context.prisma);
  return resolveLocale(settings, value);
}

async function localizeInput<T extends { locale?: string }>(
  context: ModuleContext,
  input: T
) {
  return {
    ...input,
    locale: await requestLocale(context, input.locale)
  };
}

function createContactFormLimiter() {
  return rateLimit({
    windowMs: 5 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(
        new AppError(
          429,
          "rate_limit_exceeded",
          "Too many contact form attempts. Please wait a few minutes and try again."
        )
      );
    }
  });
}

export function registerCmsRoutes(router: Router, context: ModuleContext) {
  const cmsService = new CmsService(context.prisma);
  const mediaService = new MediaService(context.prisma, context.config);

  router.get(
    "/sitemap.xml",
    asyncHandler(async (req, res) => {
      const sitemap = await cmsService.buildSitemap(requestOrigin(req));

      return res.type("application/xml").send(sitemap);
    })
  );

  router.get(
    "/robots.txt",
    asyncHandler(async (req, res) => {
      return res.type("text/plain").send(await cmsService.buildRobotsTxt(requestOrigin(req)));
    })
  );

  router.get(
    "/pages",
    requirePermission(context, "read", "cms"),
    validateRequest({ query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const pages = await cmsService.listPages({
        locale: req.query.locale ? await requestLocale(context, req.query.locale) : undefined
      });

      return sendSuccess(res, { pages });
    })
  );

  router.get(
    "/pages/:slug",
    optionalAuth(context),
    validateRequest({ params: slugParams, query: pageQuerySchema }),
    asyncHandler(async (req, res) => {
      const locale = await requestLocale(context, req.query.locale);
      const page = await cmsService.getPage(req.params.slug, locale);

      assertPageVisible(page, req.user);

      return sendSuccess(res, { page });
    })
  );

  router.post(
    "/pages",
    requirePermission(context, "create", "cms"),
    validateRequest({ body: createCmsPageSchema }),
    asyncHandler(async (req, res) => {
      const page = await cmsService.createPage(await localizeInput(context, req.body), req.user);

      return sendCreated(res, { page });
    })
  );

  router.post(
    "/pages/:slug/translations",
    requirePermission(context, "create", "cms"),
    validateRequest({ params: slugParams, query: localeQuerySchema, body: createContentTranslationSchema }),
    asyncHandler(async (req, res) => {
      const page = await cmsService.createPageTranslation(
        req.params.slug,
        {
          ...req.body,
          targetLocale: await requestLocale(context, req.body.targetLocale)
        },
        req.user,
        await requestLocale(context, req.query.locale)
      );

      return sendCreated(res, { page });
    })
  );

  router.patch(
    "/pages/:slug",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: slugParams, query: localeQuerySchema, body: updateCmsPageSchema }),
    asyncHandler(async (req, res) => {
      const locale = await requestLocale(context, req.query.locale ?? req.body.locale);
      const page = await cmsService.updatePage(req.params.slug, req.body, req.user, locale);

      return sendSuccess(res, { page });
    })
  );

  router.post(
    "/pages/:slug/publish",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: slugParams, query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const page = await cmsService.publishPage(
        req.params.slug,
        req.user,
        await requestLocale(context, req.query.locale)
      );

      return sendSuccess(res, { page });
    })
  );

  router.post(
    "/pages/:slug/archive",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: slugParams, query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const page = await cmsService.archivePage(
        req.params.slug,
        req.user,
        await requestLocale(context, req.query.locale)
      );

      return sendSuccess(res, { page });
    })
  );

  router.get(
    "/pages/:slug/revisions",
    requirePermission(context, "read", "cms"),
    validateRequest({ params: slugParams, query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const revisions = await cmsService.listRevisions(
        req.params.slug,
        await requestLocale(context, req.query.locale)
      );

      return sendSuccess(res, { revisions });
    })
  );

  router.get(
    "/pages/:slug/revisions/:revisionId/compare",
    requirePermission(context, "read", "cms"),
    validateRequest({ params: revisionParams, query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const comparison = await cmsService.compareRevision(
        req.params.slug,
        req.params.revisionId,
        await requestLocale(context, req.query.locale)
      );

      return sendSuccess(res, comparison);
    })
  );

  router.post(
    "/pages/:slug/revisions/:revisionId/restore",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: revisionParams, query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const page = await cmsService.restoreRevision(
        req.params.slug,
        req.params.revisionId,
        req.user,
        await requestLocale(context, req.query.locale)
      );

      return sendSuccess(res, { page });
    })
  );

  router.post(
    "/pages/:slug/sections",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: slugParams, query: localeQuerySchema, body: addSectionSchema }),
    asyncHandler(async (req, res) => {
      const page = await cmsService.addSection(
        req.params.slug,
        req.body,
        req.user,
        await requestLocale(context, req.query.locale)
      );

      return sendCreated(res, { page });
    })
  );

  router.post(
    "/pages/:slug/sections/:sectionId/blocks",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: sectionParams, query: localeQuerySchema, body: addContentBlockSchema }),
    asyncHandler(async (req, res) => {
      const page = await cmsService.addContentBlock(
        req.params.slug,
        req.params.sectionId,
        req.body,
        req.user,
        await requestLocale(context, req.query.locale)
      );

      return sendCreated(res, { page });
    })
  );

  router.patch(
    "/pages/:slug/blocks/:blockKey",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: blockParams, query: localeQuerySchema, body: updateContentBlockSchema }),
    asyncHandler(async (req, res) => {
      const page = await cmsService.updateContentBlock(
        req.params.slug,
        req.params.blockKey,
        req.body,
        req.user,
        await requestLocale(context, req.query.locale)
      );

      return sendSuccess(res, { page });
    })
  );

  router.get(
    "/publishing/scheduled",
    requirePermission(context, "read", "cms"),
    asyncHandler(async (_req, res) => {
      const scheduled = await cmsService.listScheduledContent();

      return sendSuccess(res, { scheduled });
    })
  );

  router.post(
    "/publishing/run",
    requirePermission(context, "update", "cms"),
    asyncHandler(async (_req, res) => {
      const published = await cmsService.publishScheduledContent();

      return sendSuccess(res, { published });
    })
  );

  router.get(
    "/menus/:menuSlug",
    optionalAuth(context),
    validateRequest({ params: menuParams, query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const menu = await cmsService.getMenu(
        req.params.menuSlug,
        canReadDrafts(req.user),
        await requestLocale(context, req.query.locale)
      );

      return sendSuccess(res, { menu });
    })
  );

  router.post(
    "/menus",
    requirePermission(context, "create", "cms"),
    validateRequest({ body: createMenuSchema }),
    asyncHandler(async (req, res) => {
      const menu = await cmsService.createMenu(await localizeInput(context, req.body));

      return sendCreated(res, { menu });
    })
  );

  router.post(
    "/menus/:menuSlug/items",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: menuParams, query: localeQuerySchema, body: createMenuItemSchema }),
    asyncHandler(async (req, res) => {
      const item = await cmsService.createMenuItem(
        req.params.menuSlug,
        req.body,
        await requestLocale(context, req.query.locale)
      );

      return sendCreated(res, { item });
    })
  );

  router.patch(
    "/menus/:menuSlug/items/:itemId",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: menuItemParams, query: localeQuerySchema, body: updateMenuItemSchema }),
    asyncHandler(async (req, res) => {
      const item = await cmsService.updateMenuItem(
        req.params.menuSlug,
        req.params.itemId,
        req.body,
        await requestLocale(context, req.query.locale)
      );

      return sendSuccess(res, { item });
    })
  );

  router.delete(
    "/menus/:menuSlug/items/:itemId",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: menuItemParams, query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      await cmsService.deleteMenuItem(
        req.params.menuSlug,
        req.params.itemId,
        await requestLocale(context, req.query.locale)
      );

      return sendSuccess(res, { deleted: true });
    })
  );

  router.get(
    "/categories",
    validateRequest({ query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      const categories = await cmsService.listCategories({
        locale: await requestLocale(context, req.query.locale)
      });

      return sendSuccess(res, { categories });
    })
  );

  router.post(
    "/categories",
    requirePermission(context, "create", "cms"),
    validateRequest({ body: createCmsCategorySchema }),
    asyncHandler(async (req, res) => {
      const category = await cmsService.createCategory(await localizeInput(context, req.body));

      return sendCreated(res, { category });
    })
  );

  router.patch(
    "/categories/:categorySlug",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: categoryParams, query: localeQuerySchema, body: updateCmsCategorySchema }),
    asyncHandler(async (req, res) => {
      const locale = await requestLocale(context, req.query.locale ?? req.body.locale);
      const category = await cmsService.updateCategory(req.params.categorySlug, req.body, locale);

      return sendSuccess(res, { category });
    })
  );

  router.delete(
    "/categories/:categorySlug",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: categoryParams, query: localeQuerySchema }),
    asyncHandler(async (req, res) => {
      await cmsService.deleteCategory(
        req.params.categorySlug,
        await requestLocale(context, req.query.locale)
      );

      return sendSuccess(res, { deleted: true });
    })
  );

  router.get(
    "/redirects/resolve",
    validateRequest({ query: redirectResolveQuerySchema }),
    asyncHandler(async (req, res) => {
      const redirect = await cmsService.resolveRedirect(String(req.query.path));

      return sendSuccess(res, { redirect });
    })
  );

  router.get(
    "/redirects",
    requirePermission(context, "read", "cms"),
    asyncHandler(async (_req, res) => {
      const redirects = await cmsService.listRedirects();

      return sendSuccess(res, { redirects });
    })
  );

  router.post(
    "/redirects",
    requirePermission(context, "create", "cms"),
    validateRequest({ body: createRedirectSchema }),
    asyncHandler(async (req, res) => {
      const redirect = await cmsService.createRedirect(req.body);

      return sendCreated(res, { redirect });
    })
  );

  router.patch(
    "/redirects/:redirectId",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: redirectParams, body: updateRedirectSchema }),
    asyncHandler(async (req, res) => {
      const redirect = await cmsService.updateRedirect(req.params.redirectId, req.body);

      return sendSuccess(res, { redirect });
    })
  );

  router.delete(
    "/redirects/:redirectId",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: redirectParams }),
    asyncHandler(async (req, res) => {
      await cmsService.deleteRedirect(req.params.redirectId);

      return sendSuccess(res, { deleted: true });
    })
  );

  router.get(
    "/media",
    requirePermission(context, "read", "cms"),
    asyncHandler(async (_req, res) => {
      const assets = await mediaService.listMediaAssets();

      return sendSuccess(res, { assets });
    })
  );

  router.get(
    "/media/usage",
    requirePermission(context, "read", "cms"),
    asyncHandler(async (_req, res) => {
      const usage = await mediaService.getUsage();

      return sendSuccess(res, { usage });
    })
  );

  router.post(
    "/media",
    requirePermission(context, "create", "cms"),
    validateRequest({ body: createMediaAssetSchema }),
    asyncHandler(async (req, res) => {
      const asset = await mediaService.createExternalMedia(req.body);

      return sendCreated(res, { asset });
    })
  );

  router.post(
    "/media/uploads",
    requirePermission(context, "create", "cms"),
    validateRequest({ body: createSignedUploadSchema }),
    asyncHandler(async (req, res) => {
      const upload = await mediaService.createSignedUpload(req.body);

      return sendCreated(res, { upload });
    })
  );

  router.post(
    "/media/uploads/complete",
    requirePermission(context, "create", "cms"),
    validateRequest({ body: completeSignedUploadSchema }),
    asyncHandler(async (req, res) => {
      const asset = await mediaService.completeSignedUpload(req.body);

      return sendCreated(res, { asset });
    })
  );

  router.post(
    "/media/upload",
    requirePermission(context, "create", "cms"),
    validateRequest({ body: directMediaUploadSchema }),
    asyncHandler(async (req, res) => {
      const asset = await mediaService.uploadMedia(req.body);

      return sendCreated(res, { asset });
    })
  );

  router.post(
    "/media/orphan-cleanup",
    requirePermission(context, "update", "cms"),
    validateRequest({ body: cleanupOrphanMediaSchema }),
    asyncHandler(async (req, res) => {
      const result = await mediaService.cleanupOrphanMedia(req.body);

      return sendSuccess(res, result);
    })
  );

  router.get(
    "/media/:assetId/download",
    requirePermission(context, "read", "cms"),
    validateRequest({ params: mediaAssetParams }),
    asyncHandler(async (req, res) => {
      const download = await mediaService.createSignedDownload(req.params.assetId);

      return sendSuccess(res, download);
    })
  );

  router.delete(
    "/media/:assetId",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: mediaAssetParams, body: deleteMediaAssetSchema }),
    asyncHandler(async (req, res) => {
      const result = await mediaService.deleteMediaAsset(req.params.assetId, req.body.force);

      return sendSuccess(res, result);
    })
  );

  router.post(
    "/forms/contact",
    createContactFormLimiter(),
    validateRequest({ body: contactSubmissionSchema }),
    asyncHandler(async (req, res) => {
      const result = await cmsService.createContactSubmission(req.body, requestMeta(req));

      return sendCreated(res, { received: result.received });
    })
  );

  router.get(
    "/forms/contact/submissions",
    requirePermission(context, "read", "cms"),
    asyncHandler(async (_req, res) => {
      const submissions = await cmsService.listContactSubmissions();

      return sendSuccess(res, { submissions });
    })
  );

  router.get(
    "/posts",
    optionalAuth(context),
    validateRequest({ query: postQuerySchema }),
    asyncHandler(async (req, res) => {
      const posts = await cmsService.listPosts(
        {
          ...req.query,
          locale: await requestLocale(context, req.query.locale)
        },
        canReadDrafts(req.user)
      );

      return sendSuccess(res, { posts });
    })
  );

  router.get(
    "/posts/:slug",
    optionalAuth(context),
    validateRequest({ params: slugParams, query: pageQuerySchema }),
    asyncHandler(async (req, res) => {
      const post = await cmsService.getPost(
        req.params.slug,
        await requestLocale(context, req.query.locale)
      );

      assertPageVisible(post, req.user);

      return sendSuccess(res, { post });
    })
  );

  router.post(
    "/posts",
    requirePermission(context, "create", "cms"),
    validateRequest({ body: createCmsPostSchema }),
    asyncHandler(async (req, res) => {
      const post = await cmsService.createPost(
        normalizePublishedAt(await localizeInput(context, req.body)),
        req.user
      );

      return sendCreated(res, { post });
    })
  );

  router.post(
    "/posts/:slug/translations",
    requirePermission(context, "create", "cms"),
    validateRequest({ params: slugParams, query: localeQuerySchema, body: createContentTranslationSchema }),
    asyncHandler(async (req, res) => {
      const post = await cmsService.createPostTranslation(
        req.params.slug,
        {
          ...req.body,
          targetLocale: await requestLocale(context, req.body.targetLocale)
        },
        req.user,
        await requestLocale(context, req.query.locale)
      );

      return sendCreated(res, { post });
    })
  );

  router.patch(
    "/posts/:slug",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: slugParams, query: localeQuerySchema, body: updateCmsPostSchema }),
    asyncHandler(async (req, res) => {
      const locale = await requestLocale(context, req.query.locale ?? req.body.locale);
      const post = await cmsService.updatePost(req.params.slug, normalizePublishedAt(req.body), req.user, locale);

      return sendSuccess(res, { post });
    })
  );
}
