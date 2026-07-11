import { Router, type Express, type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { moduleCatalog } from "../../modules/manifest.js";
import { AppError } from "../errors/app-error.js";
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
  const availableModuleIds = removeModulesWithMissingDependencies(
    resolveConfigEnabledModules(modules, context),
    context
  );

  for (const module of modules) {
    if (!availableModuleIds.has(module.id)) {
      context.logger.info({ module: module.id }, "Module is not included in this deployment profile");
      continue;
    }

    const router = Router();
    if (!moduleCatalog[module.id].required) {
      router.use(createRuntimeModuleGate(module, context));
    }
    await module.register(router, context);
    apiRouter.use(module.basePath, router);

    if (enabledModuleIds.has(module.id)) {
      loadedModules.push(module.id);
      context.logger.info({ module: module.id, basePath: module.basePath }, "Module loaded");
    } else {
      context.logger.info({ module: module.id, basePath: module.basePath }, "Disabled module routes mounted behind runtime gate");
    }
  }

  app.use(context.config.api.prefix, apiRouter);

  return loadedModules;
}

function createRuntimeModuleGate(module: AppModule, context: ModuleContext) {
  return async function runtimeModuleGate(
    _req: Request,
    _res: Response,
    next: NextFunction
  ) {
    try {
      const installedModules = await context.prisma.installedModule.findMany({
        where: {
          site: { slug: "default" }
        },
        select: {
          moduleId: true,
          status: true
        }
      });
      const installedModule = installedModules.find((item) => item.moduleId === module.id);
      const enabled = installedModules.length === 0
        ? module.enabled(context.config)
        : installedModule?.status === "ENABLED";

      if (!enabled) {
        next(new AppError(404, "module_disabled", `${moduleCatalog[module.id].label} module is disabled.`));
        return;
      }

      next();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
        if (module.enabled(context.config)) {
          next();
        } else {
          next(new AppError(404, "module_disabled", `${moduleCatalog[module.id].label} module is disabled.`));
        }
        return;
      }

      next(error);
    }
  };
}
