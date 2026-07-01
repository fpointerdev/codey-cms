import { AppError } from "../../core/errors/app-error.js";
import type { ModuleContext, ModuleId } from "../../core/types/module.js";
import {
  moduleCatalog,
  type ModuleLifecycleHook,
  type ModuleManifestEntry
} from "../manifest.js";

export type ModuleLifecycleContext = {
  context: ModuleContext;
  module: ModuleManifestEntry;
};

type ModuleLifecycleHandler = (lifecycleContext: ModuleLifecycleContext) => void | Promise<void>;

const lifecycleHandlers: Partial<
  Record<ModuleId, Partial<Record<ModuleLifecycleHook, ModuleLifecycleHandler>>>
> = {};

export async function runModuleLifecycleHook(
  context: ModuleContext,
  moduleId: ModuleId,
  hook: ModuleLifecycleHook
) {
  const module = moduleCatalog[moduleId];

  if (!module.lifecycle[hook]) {
    throw new AppError(400, "unsupported_module_lifecycle", `${module.label} does not support ${hook}.`);
  }

  await lifecycleHandlers[moduleId]?.[hook]?.({ context, module });

  context.logger.info(
    {
      module: moduleId,
      hook,
      version: module.version
    },
    "Module lifecycle hook completed"
  );
}
