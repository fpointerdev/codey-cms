import { Router, type Express } from "express";
import { Prisma } from "@prisma/client";
import { moduleCatalog } from "../../modules/manifest.js";
import type { AppModule, ModuleContext, ModuleId } from "../types/module.js";

const moduleIds = new Set(Object.keys(moduleCatalog));

function isModuleId(value: string): value is ModuleId {
  return moduleIds.has(value);
}

function resolveConfigEnabledModules(modules: AppModule[], context: ModuleContext) {
  return new Set(
    modules
      .filter((module) => module.enabled(context.config))
      .map((module) => module.id)
  );
}

function removeModulesWithMissingDependencies(enabledModuleIds: Set<ModuleId>, context: ModuleContext) {
  let changed = true;

  while (changed) {
    changed = false;

    for (const moduleId of [...enabledModuleIds]) {
      const missingDependencies = moduleCatalog[moduleId].dependencies.filter(
        (dependency) => !enabledModuleIds.has(dependency)
      );

      if (missingDependencies.length > 0) {
        enabledModuleIds.delete(moduleId);
        changed = true;
        context.logger.warn(
          { module: moduleId, missingDependencies },
          "Module disabled because dependencies are missing"
        );
      }
    }
  }

  return enabledModuleIds;
}

export async function resolveEnabledModuleIds(
  modules: AppModule[],
  context: ModuleContext
): Promise<Set<ModuleId>> {
  const fallbackModuleIds = resolveConfigEnabledModules(modules, context);

  try {
    const installedModules = await context.prisma.installedModule.findMany({
      where: {
        site: {
          slug: "default"
        }
      },
      select: {
        moduleId: true,
        status: true
      }
    });

    if (installedModules.length === 0) {
      return removeModulesWithMissingDependencies(fallbackModuleIds, context);
    }

    const enabledModuleIds = new Set<ModuleId>();

    for (const installedModule of installedModules) {
      if (!isModuleId(installedModule.moduleId)) {
        context.logger.warn(
          { module: installedModule.moduleId },
          "Ignoring installed module that is not present in the codebase"
        );
        continue;
      }

      if (installedModule.status === "ENABLED") {
        enabledModuleIds.add(installedModule.moduleId);
      }
    }

    return removeModulesWithMissingDependencies(enabledModuleIds, context);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      context.logger.warn("Installed module table is missing; falling back to deployment profile defaults");
      return removeModulesWithMissingDependencies(fallbackModuleIds, context);
    }

    throw error;
  }
}

export async function loadModules(
  app: Express,
  modules: AppModule[],
  context: ModuleContext
) {
  const apiRouter = Router();
  const loadedModules: string[] = [];
  const enabledModuleIds = await resolveEnabledModuleIds(modules, context);

  for (const module of modules) {
    if (!enabledModuleIds.has(module.id)) {
      context.logger.info({ module: module.id }, "Module disabled");
      continue;
    }

    const router = Router();
    await module.register(router, context);
    apiRouter.use(module.basePath, router);
    loadedModules.push(module.id);
    context.logger.info({ module: module.id, basePath: module.basePath }, "Module loaded");
  }

  app.use(context.config.api.prefix, apiRouter);

  return loadedModules;
}
