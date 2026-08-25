import type { Router } from "express";
import type { ModuleContext } from "../../core/types/module.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { AppError } from "../../core/errors/app-error.js";
import { sendCreated, sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { hasPermission, optionalAuth, requirePermission } from "../auth/auth.middleware.js";
import { readLocalizationSettings, resolveLocale } from "../localization/localization.service.js";
import {
  contentCollectionParams,
  contentEntryParams,
  contentEntryQuerySchema,
  contentEntryRevisionParams,
  contentBundleSchema,
  createContentCollectionSchema,
  createContentEntrySchema,
  deleteContentCollectionSchema,
  exportContentBundleSchema,
  updateContentCollectionSchema,
  updateContentEntrySchema
} from "./content-models.schemas.js";
import type { ContentEntryQuery } from "./content-models.schemas.js";
import { ContentModelsService } from "./content-models.service.js";
import {
  disconnectExtensionSchema,
  extensionManifestSchema,
  extensionParamsSchema
} from "../../extensions/extension-manifest.js";
import {
  discoverExtensions,
  getExtension,
  satisfiesCmsVersion
} from "../../extensions/extension-registry.js";
import { runtimeVersion } from "../../runtime/release.js";

function canReadDrafts(user: Express.Request["user"]) {
  return hasPermission(user, "read", "cms");
}

async function requestLocale(context: ModuleContext, value: unknown) {
  return resolveLocale(await readLocalizationSettings(context.prisma), value);
}

export function registerContentModelRoutes(
  router: Router,
  context: ModuleContext,
  service = new ContentModelsService(context.prisma)
) {
  router.get(
    "/extensions",
    requirePermission(context, "read", "cms"),
    asyncHandler(async (_req, res) => {
      const [{ extensions, failures }, installations] = await Promise.all([
        discoverExtensions(),
        service.listExtensionInstallations()
      ]);
      const availableIds = new Set(extensions.map((extension) => extension.manifest.id));
      const available = await Promise.all(extensions.map(async ({ manifest, provenance }) => {
        const lifecycle = await service.planExtension(manifest);
        return {
          ...manifest,
          provenance,
          available: true,
          compatible: satisfiesCmsVersion(runtimeVersion, manifest.requires.cms),
          installed: lifecycle.installedVersion !== null,
          lifecycle
        };
      }));
      const unavailable = installations
        .filter((installation) => !availableIds.has(installation.extensionId))
        .map((installation) => {
          const manifest = extensionManifestSchema.safeParse(installation.manifest);
          return {
            ...(manifest.success ? manifest.data : {
              id: installation.extensionId,
              name: installation.extensionId,
              description: "The installed extension package is not available in this runtime.",
              version: installation.version,
              license: "Unknown",
              author: { name: "Unknown" },
              requires: { cms: "Unknown" },
              contentModels: []
            }),
            available: false,
            compatible: false,
            installed: true,
            lifecycle: {
              status: "unavailable",
              installedVersion: installation.version,
              availableVersion: null,
              installedDigest: installation.manifestSha256,
              availableDigest: null,
              added: [],
              updated: [],
              removed: [],
              customized: [],
              conflicts: []
            }
          };
        });
      return sendSuccess(res, {
        extensions: [...available, ...unavailable],
        failures
      });
    })
  );

  router.post(
    "/extensions/:extensionId/install",
    requirePermission(context, "create", "cms"),
    validateRequest({ params: extensionParamsSchema }),
    asyncHandler(async (req, res) => {
      const { manifest: extension } = await getExtension(req.params.extensionId);
      if (!satisfiesCmsVersion(runtimeVersion, extension.requires.cms)) {
        throw new AppError(
          422,
          "extension_incompatible",
          `Extension ${extension.name} requires CodeY CMS ${extension.requires.cms}.`
        );
      }
      const result = await service.installExtension(extension);
      return sendCreated(res, { extension: extension.id, ...result });
    })
  );

  router.get(
    "/extensions/:extensionId/plan",
    requirePermission(context, "read", "cms"),
    validateRequest({ params: extensionParamsSchema }),
    asyncHandler(async (req, res) => {
      const { manifest: extension } = await getExtension(req.params.extensionId);
      return sendSuccess(res, {
        extension: extension.id,
        compatible: satisfiesCmsVersion(runtimeVersion, extension.requires.cms),
        plan: await service.planExtension(extension)
      });
    })
  );

  router.post(
    "/extensions/:extensionId/update",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: extensionParamsSchema }),
    asyncHandler(async (req, res) => {
      const { manifest: extension } = await getExtension(req.params.extensionId);
      if (!satisfiesCmsVersion(runtimeVersion, extension.requires.cms)) {
        throw new AppError(
          422,
          "extension_incompatible",
          `Extension ${extension.name} requires CodeY CMS ${extension.requires.cms}.`
        );
      }
      return sendSuccess(res, { extension: extension.id, ...await service.updateExtension(extension) });
    })
  );

  router.delete(
    "/extensions/:extensionId",
    requirePermission(context, "delete", "cms"),
    validateRequest({ params: extensionParamsSchema, body: disconnectExtensionSchema }),
    asyncHandler(async (req, res) => {
      return sendSuccess(res, await service.disconnectExtension(
        req.params.extensionId,
        req.body.confirmation
      ));
    })
  );

  router.get(
    "/collections",
    requirePermission(context, "read", "cms"),
    asyncHandler(async (_req, res) => {
      return sendSuccess(res, { collections: await service.listCollections() });
    })
  );

  router.post(
    "/collections",
    requirePermission(context, "create", "cms"),
    validateRequest({ body: createContentCollectionSchema }),
    asyncHandler(async (req, res) => {
      return sendCreated(res, { collection: await service.createCollection(req.body) });
    })
  );

  router.post(
    "/collections/export",
    requirePermission(context, "read", "cms"),
    validateRequest({ body: exportContentBundleSchema }),
    asyncHandler(async (req, res) => {
      return sendSuccess(res, {
        bundle: await service.exportContentBundle(req.body.collections)
      });
    })
  );

  router.post(
    "/collections/import",
    requirePermission(context, "create", "cms"),
    validateRequest({ body: contentBundleSchema }),
    asyncHandler(async (req, res) => {
      return sendCreated(res, await service.importContentBundle(req.body, req.user));
    })
  );

  router.get(
    "/collections/:collectionSlug",
    requirePermission(context, "read", "cms"),
    validateRequest({ params: contentCollectionParams }),
    asyncHandler(async (req, res) => {
      return sendSuccess(res, { collection: await service.getCollection(req.params.collectionSlug) });
    })
  );

  router.patch(
    "/collections/:collectionSlug",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: contentCollectionParams, body: updateContentCollectionSchema }),
    asyncHandler(async (req, res) => {
      return sendSuccess(res, {
        collection: await service.updateCollection(req.params.collectionSlug, req.body)
      });
    })
  );

  router.delete(
    "/collections/:collectionSlug",
    requirePermission(context, "delete", "cms"),
    validateRequest({ params: contentCollectionParams, body: deleteContentCollectionSchema }),
    asyncHandler(async (req, res) => {
      return sendSuccess(res, await service.deleteCollection(
        req.params.collectionSlug,
        req.body.confirmation
      ));
    })
  );

  router.get(
    "/collections/:collectionSlug/entries",
    optionalAuth(context),
    validateRequest({ params: contentCollectionParams, query: contentEntryQuerySchema }),
    asyncHandler(async (req, res) => {
      const query = req.query as unknown as ContentEntryQuery;
      const allowDrafts = canReadDrafts(req.user);
      const result = await service.listEntries(
        req.params.collectionSlug,
        {
          ...query,
          locale: query.locale || !allowDrafts
            ? await requestLocale(context, query.locale)
            : undefined
        },
        allowDrafts
      );
      return sendSuccess(res, result);
    })
  );

  router.post(
    "/collections/:collectionSlug/entries",
    requirePermission(context, "create", "cms"),
    validateRequest({ params: contentCollectionParams, body: createContentEntrySchema }),
    asyncHandler(async (req, res) => {
      const entry = await service.createEntry(
        req.params.collectionSlug,
        { ...req.body, locale: await requestLocale(context, req.body.locale) },
        req.user
      );
      return sendCreated(res, { entry });
    })
  );

  router.get(
    "/collections/:collectionSlug/entries/:entrySlug",
    optionalAuth(context),
    validateRequest({ params: contentEntryParams, query: contentEntryQuerySchema }),
    asyncHandler(async (req, res) => {
      const result = await service.getEntry(
        req.params.collectionSlug,
        req.params.entrySlug,
        await requestLocale(context, req.query.locale),
        canReadDrafts(req.user)
      );
      return sendSuccess(res, result);
    })
  );

  router.patch(
    "/collections/:collectionSlug/entries/:entrySlug",
    requirePermission(context, "update", "cms"),
    validateRequest({
      params: contentEntryParams,
      query: contentEntryQuerySchema,
      body: updateContentEntrySchema
    }),
    asyncHandler(async (req, res) => {
      const entry = await service.updateEntry(
        req.params.collectionSlug,
        req.params.entrySlug,
        await requestLocale(context, req.query.locale),
        req.body,
        req.user
      );
      return sendSuccess(res, { entry });
    })
  );

  router.delete(
    "/collections/:collectionSlug/entries/:entrySlug",
    requirePermission(context, "delete", "cms"),
    validateRequest({ params: contentEntryParams, query: contentEntryQuerySchema }),
    asyncHandler(async (req, res) => {
      return sendSuccess(res, await service.deleteEntry(
        req.params.collectionSlug,
        req.params.entrySlug,
        await requestLocale(context, req.query.locale)
      ));
    })
  );

  router.get(
    "/collections/:collectionSlug/entries/:entrySlug/revisions",
    requirePermission(context, "read", "cms"),
    validateRequest({ params: contentEntryParams, query: contentEntryQuerySchema }),
    asyncHandler(async (req, res) => {
      const revisions = await service.listRevisions(
        req.params.collectionSlug,
        req.params.entrySlug,
        await requestLocale(context, req.query.locale)
      );
      return sendSuccess(res, { revisions });
    })
  );

  router.post(
    "/collections/:collectionSlug/entries/:entrySlug/revisions/:revisionId/restore",
    requirePermission(context, "update", "cms"),
    validateRequest({ params: contentEntryRevisionParams, query: contentEntryQuerySchema }),
    asyncHandler(async (req, res) => {
      const entry = await service.restoreRevision(
        req.params.collectionSlug,
        req.params.entrySlug,
        await requestLocale(context, req.query.locale),
        req.params.revisionId,
        req.user
      );
      return sendSuccess(res, { entry });
    })
  );
}
