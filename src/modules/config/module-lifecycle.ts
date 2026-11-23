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

const lifecycleHandlers = new Map<ModuleId, Map<ModuleLifecycleHook, ModuleLifecycleHandler>>();

export async function runModuleLifecycleHook(
  context: ModuleContext,
  moduleId: ModuleId,
  hook: ModuleLifecycleHook
) {
  if (!Object.hasOwn(moduleCatalog, moduleId)) {
    throw new AppError(400, "unsupported_module", "Unknown module.");
  }
  const module = moduleCatalog[moduleId];

  if (!Object.hasOwn(module.lifecycle, hook) || !module.lifecycle[hook]) {
    throw new AppError(400, "unsupported_module_lifecycle", `${module.label} does not support ${hook}.`);
  }

  const handler = lifecycleHandlers.get(moduleId)?.get(hook);

  if (!handler) {
    context.logger.debug(
      {
        module: moduleId,
        hook,
        version: module.version
      },
      "Module lifecycle hook has no registered side effect"
    );
    return false;
  }

  await handler({ context, module });

  context.logger.info(
    {
      module: moduleId,
      hook,
      version: module.version
    },
    "Module lifecycle hook completed"
  );

  return true;
}
