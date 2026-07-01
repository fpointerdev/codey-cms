import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "../../core/audit/audit-log.js";
import { AppError } from "../../core/errors/app-error.js";
import type { ModuleContext, ModuleId } from "../../core/types/module.js";
import {
  moduleCatalog,
  type ModuleLifecycleHook,
  type ModuleManifestEntry
} from "../manifest.js";
import { normalizeLocalizationSettings } from "../localization/localization.service.js";
import { runModuleLifecycleHook } from "./module-lifecycle.js";

type InstalledModuleState = {
  moduleId: string;
  status: "ENABLED" | "DISABLED";
};

type ModuleAuditMeta = {
  actorUserId?: string;
  ipAddress?: string;
  userAgent?: string;
};

function serializeInstalledModule(installedModule: {
  moduleId: string;
  status: "ENABLED" | "DISABLED";
  version: string;
  monthlyEuroCents: number;
  installedAt: Date;
  updatedAt: Date;
  settings?: Array<{
    key: string;
    value: Prisma.JsonValue;
    updatedAt: Date;
  }>;
}) {
  return {
    moduleId: installedModule.moduleId,
    status: installedModule.status,
    version: installedModule.version,
    monthlyEuroCents: installedModule.monthlyEuroCents,
    installedAt: installedModule.installedAt,
    updatedAt: installedModule.updatedAt,
    settings:
      installedModule.settings?.reduce<Record<string, Prisma.JsonValue>>((settings, setting) => {
        settings[setting.key] = setting.value;
        return settings;
      }, {}) ?? {}
  };
}

function serializePublicInstalledModule(installedModule: ReturnType<typeof serializeInstalledModule>) {
  return {
    moduleId: installedModule.moduleId,
    status: installedModule.status,
    version: installedModule.version,
    monthlyEuroCents: installedModule.monthlyEuroCents,
    installedAt: installedModule.installedAt,
    updatedAt: installedModule.updatedAt
  };
}

export class ModuleAdminService {
  constructor(private readonly context: ModuleContext) {}

  async listInstalledModules() {
    const site = await this.context.prisma.site.findUnique({
      where: {
        slug: "default"
      }
    });

    if (!site) {
      return [];
    }

    const installedModules = await this.context.prisma.installedModule.findMany({
      where: {
        siteId: site.id
      },
      orderBy: {
        moduleId: "asc"
      },
      select: {
        moduleId: true,
        status: true,
        version: true,
        monthlyEuroCents: true,
        installedAt: true,
        updatedAt: true
      }
    });
    const moduleSettings = await this.context.prisma.moduleSetting.findMany({
      where: {
        siteId: site.id
      },
      orderBy: {
        key: "asc"
      },
      select: {
        moduleId: true,
        key: true,
        value: true,
        updatedAt: true
      }
    });
    const settingsByModule = moduleSettings.reduce<
      Map<string, Array<{ key: string; value: Prisma.JsonValue; updatedAt: Date }>>
    >((settings, setting) => {
      const currentSettings = settings.get(setting.moduleId) ?? [];
      currentSettings.push(setting);
      settings.set(setting.moduleId, currentSettings);
      return settings;
    }, new Map());

    return installedModules.map((installedModule) =>
      serializeInstalledModule({
        ...installedModule,
        settings: settingsByModule.get(installedModule.moduleId)
      })
    );
  }

  async listPublicInstalledModules() {
    const installedModules = await this.listInstalledModules();

    return installedModules.map(serializePublicInstalledModule);
  }

  async installModule(moduleId: ModuleId, audit?: ModuleAuditMeta) {
    const module = moduleCatalog[moduleId];
    const site = await this.getOrCreateDefaultSite();

    await this.assertDependenciesEnabled(module);

    const existing = await this.context.prisma.installedModule.findUnique({
      where: {
        siteId_moduleId: {
          siteId: site.id,
          moduleId
        }
      }
    });

    const installedModule = await this.context.prisma.installedModule.upsert({
      where: {
        siteId_moduleId: {
          siteId: site.id,
          moduleId
        }
      },
      update: {
        status: "ENABLED",
        version: module.version,
        monthlyEuroCents: module.monthlyEuroCents
      },
      create: {
        siteId: site.id,
        moduleId,
        status: "ENABLED",
        version: module.version,
        monthlyEuroCents: module.monthlyEuroCents
      }
    });

    if (!existing) {
      await runModuleLifecycleHook(this.context, moduleId, "install");
    }

    await runModuleLifecycleHook(this.context, moduleId, "enable");
    await this.audit("module.install", moduleId, audit);

    return installedModule;
  }

  async enableModule(moduleId: ModuleId, audit?: ModuleAuditMeta) {
    const module = moduleCatalog[moduleId];
    const site = await this.getOrCreateDefaultSite();

    await this.assertDependenciesEnabled(module);

    const installedModule = await this.context.prisma.installedModule.upsert({
      where: {
        siteId_moduleId: {
          siteId: site.id,
          moduleId
        }
      },
      update: {
        status: "ENABLED",
        version: module.version,
        monthlyEuroCents: module.monthlyEuroCents
      },
      create: {
        siteId: site.id,
        moduleId,
        status: "ENABLED",
        version: module.version,
        monthlyEuroCents: module.monthlyEuroCents
      }
    });

    await runModuleLifecycleHook(this.context, moduleId, "enable");
    await this.audit("module.enable", moduleId, audit);

    return installedModule;
  }

  async disableModule(moduleId: ModuleId, audit?: ModuleAuditMeta) {
    const module = moduleCatalog[moduleId];

    if (module.required) {
      throw new AppError(409, "required_module", `${module.label} is required and cannot be disabled.`);
    }

    await this.assertNoEnabledDependents(moduleId);

    const installedModule = await this.context.prisma.installedModule.update({
      where: {
        siteId_moduleId: {
          siteId: (await this.getOrCreateDefaultSite()).id,
          moduleId
        }
      },
      data: {
        status: "DISABLED"
      }
    });

    await runModuleLifecycleHook(this.context, moduleId, "disable");
    await this.audit("module.disable", moduleId, audit);

    return installedModule;
  }

  async uninstallModule(moduleId: ModuleId, audit?: ModuleAuditMeta) {
    const module = moduleCatalog[moduleId];
    const site = await this.getOrCreateDefaultSite();

    if (module.required) {
      throw new AppError(409, "required_module", `${module.label} is required and cannot be uninstalled.`);
    }

    await this.assertNoEnabledDependents(moduleId);

    await this.context.prisma.$transaction(async (tx) => {
      await tx.moduleSetting.deleteMany({
        where: {
          siteId: site.id,
          moduleId
        }
      });
      await tx.installedModule.delete({
        where: {
          siteId_moduleId: {
            siteId: site.id,
            moduleId
          }
        }
      });
    });

    await runModuleLifecycleHook(this.context, moduleId, "uninstall");
    await this.audit("module.uninstall", moduleId, audit);
  }

  async updateSettings(
    moduleId: ModuleId,
    settings: Record<string, unknown>,
    audit?: ModuleAuditMeta
  ) {
    await this.assertInstalled(moduleId);
    const site = await this.getOrCreateDefaultSite();

    if (moduleId === "localization") {
      const normalizedSettings = normalizeLocalizationSettings(settings, true);

      await this.context.prisma.moduleSetting.upsert({
        where: {
          siteId_moduleId_key: {
            siteId: site.id,
            moduleId,
            key: "settings"
          }
        },
        update: {
          value: normalizedSettings as Prisma.InputJsonValue
        },
        create: {
          siteId: site.id,
          moduleId,
          key: "settings",
          value: normalizedSettings as Prisma.InputJsonValue
        }
      });

      await this.audit("module.settings.update", moduleId, audit, {
        keys: Object.keys(settings)
      });

      return this.listInstalledModules();
    }

    for (const [key, value] of Object.entries(settings)) {
      await this.context.prisma.moduleSetting.upsert({
        where: {
          siteId_moduleId_key: {
            siteId: site.id,
            moduleId,
            key
          }
        },
        update: {
          value: value as Prisma.InputJsonValue
        },
        create: {
          siteId: site.id,
          moduleId,
          key,
          value: value as Prisma.InputJsonValue
        }
      });
    }

    await this.audit("module.settings.update", moduleId, audit, {
      keys: Object.keys(settings)
    });

    return this.listInstalledModules();
  }

  async runLifecycle(moduleId: ModuleId, hook: ModuleLifecycleHook, audit?: ModuleAuditMeta) {
    await this.assertInstalled(moduleId);
    await runModuleLifecycleHook(this.context, moduleId, hook);
    await this.audit("module.lifecycle.run", moduleId, audit, { hook });
  }

  private async getOrCreateDefaultSite() {
    return this.context.prisma.site.upsert({
      where: {
        slug: "default"
      },
      update: {},
      create: {
        slug: "default",
        name: this.context.config.app.name,
        deploymentProfile: this.context.config.app.mode === "landing" ? "presentation" : this.context.config.app.mode
      }
    });
  }

  private async assertDependenciesEnabled(module: ModuleManifestEntry) {
    if (module.dependencies.length === 0) return;

    const enabledModules = await this.listModuleStates();
    const missingDependencies = module.dependencies.filter(
      (dependency) => enabledModules.get(dependency) !== "ENABLED"
    );

    if (missingDependencies.length > 0) {
      throw new AppError(409, "missing_module_dependencies", "Module dependencies are not enabled.", {
        moduleId: module.id,
        missingDependencies
      });
    }
  }

  private async assertNoEnabledDependents(moduleId: ModuleId) {
    const enabledModules = await this.listModuleStates();
    const dependents = Object.values(moduleCatalog)
      .filter(
        (module) =>
          (module.dependencies as ModuleId[]).includes(moduleId) &&
          enabledModules.get(module.id) === "ENABLED"
      )
      .map((module) => module.id);

    if (dependents.length > 0) {
      throw new AppError(409, "module_has_enabled_dependents", "Disable dependent modules first.", {
        moduleId,
        dependents
      });
    }
  }

  private async assertInstalled(moduleId: ModuleId) {
    const site = await this.getOrCreateDefaultSite();
    const installedModule = await this.context.prisma.installedModule.findUnique({
      where: {
        siteId_moduleId: {
          siteId: site.id,
          moduleId
        }
      }
    });

    if (!installedModule) {
      throw new AppError(404, "module_not_installed", "Module is not installed.");
    }
  }

  private async listModuleStates() {
    const site = await this.getOrCreateDefaultSite();
    const installedModules = await this.context.prisma.installedModule.findMany({
      where: {
        siteId: site.id
      },
      select: {
        moduleId: true,
        status: true
      }
    });

    return installedModules.reduce<Map<ModuleId, InstalledModuleState["status"]>>(
      (states, installedModule) => {
        if (installedModule.moduleId in moduleCatalog) {
          states.set(installedModule.moduleId as ModuleId, installedModule.status);
        }

        return states;
      },
      new Map()
    );
  }

  private async audit(
    action: string,
    moduleId: ModuleId,
    audit?: ModuleAuditMeta,
    metadata: Record<string, unknown> = {}
  ) {
    await writeAuditLog(this.context.prisma, {
      actorUserId: audit?.actorUserId,
      action,
      subject: "module",
      subjectId: moduleId,
      ipAddress: audit?.ipAddress,
      userAgent: audit?.userAgent,
      metadata: {
        moduleId,
        ...metadata
      }
    });
  }
}
