import { Prisma } from "@prisma/client";
import type { AppModule, ModuleContext, ModuleId } from "../../core/types/module.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendCreated, sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { requirePermission } from "../auth/auth.middleware.js";
import {
  deploymentProfiles,
  moduleCatalog,
  type DeploymentProfile,
  type ModuleLifecycleHook,
  type ModuleManifestEntry
} from "../manifest.js";
import {
  auditLogQuerySchema,
  createSiteDomainSchema,
  domainIdParams,
  maintenanceSettingsSchema,
  moduleIdParams,
  moduleLifecycleParams,
  moduleSettingsSchema,
  siteSettingsSchema,
  updateSiteDomainSchema
} from "./config.schemas.js";
import { ModuleAdminService } from "./module-admin.service.js";
import { SiteDomainService } from "./site-domain.service.js";
import {
  applyWebsiteSpec,
  buildWebsiteGenerationPlan,
  generationContract
} from "./website-spec.service.js";
import { readLocalizationSettings } from "../localization/localization.service.js";
import {
  applyWebsiteSpecRequestSchema,
  websiteSpecRequestSchema
} from "./website-spec.schemas.js";
import {
  builderElementRegistry,
  builderRegistryVersion,
  builderSectionPatternRegistry,
  builderStylePresetRegistry,
  sectionPresetRegistry
} from "../builder/element-registry.js";

async function getOrCreateDefaultSite(context: ModuleContext) {
  return context.prisma.site.upsert({
    where: {
      slug: "default"
    },
    update: {},
    create: {
      slug: "default",
      name: context.config.app.name,
      deploymentProfile: context.config.app.mode === "landing" ? "presentation" : context.config.app.mode
    }
  });
}

async function readMaintenanceSettings(context: ModuleContext) {
  const setting = await context.prisma.moduleSetting.findFirst({
    where: {
      moduleId: "config",
      key: "maintenance",
      site: {
        slug: "default"
      }
    }
  });
  const storedMaintenance = (setting?.value ?? {}) as Record<string, unknown>;
  const dbEnabled = storedMaintenance.enabled === true;
  const envEnabled = context.config.maintenance.enabled;
  const effectiveEnabled = envEnabled || dbEnabled;

  return {
    enabled: effectiveEnabled,
    message: dbEnabled && typeof storedMaintenance.message === "string"
      ? storedMaintenance.message
      : context.config.maintenance.message,
    allowedPaths: dbEnabled && Array.isArray(storedMaintenance.allowedPaths)
      ? storedMaintenance.allowedPaths
      : context.config.maintenance.allowedPaths,
    forcedByEnv: envEnabled,
    stored: {
      enabled: storedMaintenance.enabled === true,
      message: typeof storedMaintenance.message === "string" ? storedMaintenance.message : undefined,
      allowedPaths: Array.isArray(storedMaintenance.allowedPaths)
        ? storedMaintenance.allowedPaths
        : undefined
    }
  };
}

async function readSiteSettings(context: ModuleContext) {
  const site = await getOrCreateDefaultSite(context);
  const setting = await context.prisma.moduleSetting.findFirst({
    where: {
      moduleId: "config",
      key: "site",
      siteId: site.id
    }
  });
  const storedSettings = (setting?.value ?? {}) as Record<string, unknown>;

  return {
    title: typeof storedSettings.title === "string" ? storedSettings.title : site.name,
    description: typeof storedSettings.description === "string" ? storedSettings.description : "",
    metaTitle: typeof storedSettings.metaTitle === "string" ? storedSettings.metaTitle : site.name,
    metaDescription: typeof storedSettings.metaDescription === "string" ? storedSettings.metaDescription : "",
    siteUrl: typeof storedSettings.siteUrl === "string" ? storedSettings.siteUrl : "",
    searchIndexing: storedSettings.searchIndexing !== false,
    sitemapEnabled: storedSettings.sitemapEnabled !== false,
    customCss: typeof storedSettings.customCss === "string" ? storedSettings.customCss : ""
  };
}

function compatibilityMatrix() {
  const modules = Object.values(moduleCatalog) as ModuleManifestEntry[];
  const profiles = Object.values(deploymentProfiles) as DeploymentProfile[];

  return modules.map((module) => ({
    moduleId: module.id,
    version: module.version,
    category: module.category,
    required: module.required,
    dependencies: module.dependencies,
    dependents: modules
      .filter((candidate) => candidate.dependencies.includes(module.id))
      .map((candidate) => candidate.id),
    plans: module.plans,
    deploymentProfiles: profiles
      .filter((profile) => profile.modules.includes(module.id))
      .map((profile) => profile.id),
    lifecycle: module.lifecycle,
    compatibility: module.compatibility
  }));
}

function auditMeta(req: { user?: { id: string }; header: (name: string) => string | undefined; ip?: string }) {
  return {
    actorUserId: req.user?.id,
    userAgent: req.header("user-agent"),
    ipAddress: req.ip
  };
}

export const configModule: AppModule = {
  id: "config",
  basePath: "/config",
  enabled: (config) => config.features.config,
  register: (router, context) => {
    const moduleAdminService = new ModuleAdminService(context);
    const siteDomainService = new SiteDomainService(context);

    router.get("/", asyncHandler(async (_req, res) => {
      let installedModules: unknown[] = [];
      const siteSettings = await readSiteSettings(context);
      const localization = await readLocalizationSettings(context.prisma);

      try {
        installedModules = await moduleAdminService.listPublicInstalledModules();
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021")) {
          throw error;
        }
      }

      return sendSuccess(res, {
        app: context.config.app,
        env: context.config.env,
        api: context.config.api,
        features: context.config.features,
        modules: moduleCatalog,
        deploymentProfiles,
        builder: {
          version: builderRegistryVersion,
          elements: builderElementRegistry,
          sectionPresets: sectionPresetRegistry,
          stylePresets: builderStylePresetRegistry,
          sectionPatterns: builderSectionPatternRegistry
        },
        storage: {
          driver: context.config.storage.driver,
          bucket: context.config.storage.bucket,
          keyPrefix: context.config.storage.keyPrefix,
          publicBaseUrl: context.config.storage.publicBaseUrl,
          imageVariantWidths: context.config.storage.imageVariantWidths
        },
        installedModules,
        siteSettings,
        localization
      });
    }));

    router.get(
      "/modules",
      requirePermission(context, "read", "modules"),
      asyncHandler(async (_req, res) => {
        const installedModules = await moduleAdminService.listInstalledModules();

        return sendSuccess(res, {
          modules: moduleCatalog,
          installedModules
        });
      })
    );

    router.get(
      "/compatibility",
      requirePermission(context, "read", "modules"),
      asyncHandler(async (_req, res) => {
        return sendSuccess(res, {
          baseVersion: "0.1.0",
          matrix: compatibilityMatrix()
        });
      })
    );

    router.get(
      "/maintenance",
      requirePermission(context, "read", "modules"),
      asyncHandler(async (_req, res) => {
        const maintenance = await readMaintenanceSettings(context);

        return sendSuccess(res, { maintenance });
      })
    );

    router.patch(
      "/maintenance",
      requirePermission(context, "manage", "modules"),
      validateRequest({ body: maintenanceSettingsSchema }),
      asyncHandler(async (req, res) => {
        const site = await getOrCreateDefaultSite(context);
        const maintenance = req.body;
        await context.prisma.moduleSetting.upsert({
          where: {
            siteId_moduleId_key: {
              siteId: site.id,
              moduleId: "config",
              key: "maintenance"
            }
          },
          update: {
            value: maintenance as Prisma.InputJsonValue
          },
          create: {
            siteId: site.id,
            moduleId: "config",
            key: "maintenance",
            value: maintenance as Prisma.InputJsonValue
          }
        });
        await context.prisma.auditLog.create({
          data: {
            actorUserId: req.user?.id,
            action: "maintenance.update",
            subject: "site",
            subjectId: site.id,
            ipAddress: req.ip,
            userAgent: req.header("user-agent"),
            metadata: maintenance as Prisma.InputJsonValue
          }
        });
        const effectiveMaintenance = await readMaintenanceSettings(context);

        return sendSuccess(res, { maintenance: effectiveMaintenance });
      })
    );

    router.patch(
      "/site-settings",
      requirePermission(context, "manage", "modules"),
      validateRequest({ body: siteSettingsSchema }),
      asyncHandler(async (req, res) => {
        const site = await getOrCreateDefaultSite(context);
        const siteSettings = req.body;

        await context.prisma.$transaction(async (tx) => {
          await tx.site.update({
            where: {
              id: site.id
            },
            data: {
              name: siteSettings.title
            }
          });
          await tx.moduleSetting.upsert({
            where: {
              siteId_moduleId_key: {
                siteId: site.id,
                moduleId: "config",
                key: "site"
              }
            },
            update: {
              value: siteSettings as Prisma.InputJsonValue
            },
            create: {
              siteId: site.id,
              moduleId: "config",
              key: "site",
              value: siteSettings as Prisma.InputJsonValue
            }
          });
          await tx.auditLog.create({
            data: {
              actorUserId: req.user?.id,
              action: "site.settings.update",
              subject: "site",
              subjectId: site.id,
              ipAddress: req.ip,
              userAgent: req.header("user-agent"),
              metadata: siteSettings as Prisma.InputJsonValue
            }
          });
        });

        return sendSuccess(res, { siteSettings: await readSiteSettings(context) });
      })
    );

    router.get(
      "/audit-logs",
      requirePermission(context, "read", "audit"),
      validateRequest({ query: auditLogQuerySchema }),
      asyncHandler(async (req, res) => {
        const query = req.query as unknown as {
          page: number;
          limit: number;
          action?: string;
          subject?: string;
          actorUserId?: string;
        };
        const where = {
          action: query.action,
          subject: query.subject,
          actorUserId: query.actorUserId
        };
        const [auditLogs, total] = await Promise.all([
          context.prisma.auditLog.findMany({
            where,
            skip: (query.page - 1) * query.limit,
            take: query.limit,
            orderBy: { createdAt: "desc" }
          }),
          context.prisma.auditLog.count({ where })
        ]);

        return sendSuccess(res, { auditLogs }, { page: query.page, limit: query.limit, total });
      })
    );

    router.get(
      "/domains",
      requirePermission(context, "read", "modules"),
      asyncHandler(async (_req, res) => {
        const domains = await siteDomainService.listDomains();

        return sendSuccess(res, { domains });
      })
    );

    router.get(
      "/generation/contract",
      requirePermission(context, "read", "modules"),
      asyncHandler(async (_req, res) => {
        return sendSuccess(res, generationContract());
      })
    );

    router.post(
      "/generation/validate",
      requirePermission(context, "read", "modules"),
      validateRequest({ body: websiteSpecRequestSchema }),
      asyncHandler(async (req, res) => {
        const plan = buildWebsiteGenerationPlan(req.body.spec);

        return sendSuccess(res, { valid: true, plan });
      })
    );

    router.post(
      "/generation/apply",
      requirePermission(context, "manage", "modules"),
      validateRequest({ body: applyWebsiteSpecRequestSchema }),
      asyncHandler(async (req, res) => {
        const result = req.body.dryRun
          ? { plan: buildWebsiteGenerationPlan(req.body.spec), applied: null }
          : await applyWebsiteSpec(context, req.body.spec, req.user);

        return sendSuccess(res, result);
      })
    );

    router.post(
      "/domains",
      requirePermission(context, "manage", "modules"),
      validateRequest({ body: createSiteDomainSchema }),
      asyncHandler(async (req, res) => {
        const domain = await siteDomainService.createDomain(req.body);

        return sendCreated(res, { domain });
      })
    );

    router.patch(
      "/domains/:domainId",
      requirePermission(context, "manage", "modules"),
      validateRequest({ params: domainIdParams, body: updateSiteDomainSchema }),
      asyncHandler(async (req, res) => {
        const domain = await siteDomainService.updateDomain(req.params.domainId, req.body);

        return sendSuccess(res, { domain });
      })
    );

    router.post(
      "/domains/:domainId/verify",
      requirePermission(context, "manage", "modules"),
      validateRequest({ params: domainIdParams }),
      asyncHandler(async (req, res) => {
        const domain = await siteDomainService.refreshVerification(req.params.domainId);

        return sendSuccess(res, { domain });
      })
    );

    router.post(
      "/modules/:moduleId/install",
      requirePermission(context, "manage", "modules"),
      validateRequest({ params: moduleIdParams }),
      asyncHandler(async (req, res) => {
        const moduleId = req.params.moduleId as ModuleId;
        const installedModule = await moduleAdminService.installModule(moduleId, auditMeta(req));

        return sendSuccess(res, { installedModule });
      })
    );

    router.post(
      "/modules/:moduleId/enable",
      requirePermission(context, "manage", "modules"),
      validateRequest({ params: moduleIdParams }),
      asyncHandler(async (req, res) => {
        const moduleId = req.params.moduleId as ModuleId;
        const installedModule = await moduleAdminService.enableModule(moduleId, auditMeta(req));

        return sendSuccess(res, { installedModule });
      })
    );

    router.post(
      "/modules/:moduleId/disable",
      requirePermission(context, "manage", "modules"),
      validateRequest({ params: moduleIdParams }),
      asyncHandler(async (req, res) => {
        const moduleId = req.params.moduleId as ModuleId;
        const installedModule = await moduleAdminService.disableModule(moduleId, auditMeta(req));

        return sendSuccess(res, { installedModule });
      })
    );

    router.delete(
      "/modules/:moduleId",
      requirePermission(context, "manage", "modules"),
      validateRequest({ params: moduleIdParams }),
      asyncHandler(async (req, res) => {
        const moduleId = req.params.moduleId as ModuleId;
        await moduleAdminService.uninstallModule(moduleId, auditMeta(req));

        return sendSuccess(res, { uninstalled: true });
      })
    );

    router.patch(
      "/modules/:moduleId/settings",
      requirePermission(context, "manage", "modules"),
      validateRequest({ params: moduleIdParams, body: moduleSettingsSchema }),
      asyncHandler(async (req, res) => {
        const moduleId = req.params.moduleId as ModuleId;
        const installedModules = await moduleAdminService.updateSettings(
          moduleId,
          req.body.settings,
          auditMeta(req)
        );
        const localization = moduleId === "localization"
          ? await readLocalizationSettings(context.prisma)
          : undefined;

        return sendSuccess(res, { installedModules, localization });
      })
    );

    router.post(
      "/modules/:moduleId/lifecycle/:hook",
      requirePermission(context, "manage", "modules"),
      validateRequest({ params: moduleLifecycleParams }),
      asyncHandler(async (req, res) => {
        const moduleId = req.params.moduleId as ModuleId;
        const hook = req.params.hook as ModuleLifecycleHook;
        const handled = await moduleAdminService.runLifecycle(moduleId, hook, auditMeta(req));

        return sendSuccess(res, {
          moduleId: req.params.moduleId,
          hook: req.params.hook,
          completed: handled,
          message: handled ? undefined : "No lifecycle side effect is registered for this module."
        });
      })
    );
  }
};
