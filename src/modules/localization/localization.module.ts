import type { AppModule } from "../../core/types/module.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendSuccess } from "../../core/http/response.js";
import { readLocalizationSettings } from "./localization.service.js";

export const localizationModule: AppModule = {
  id: "localization",
  basePath: "/localization",
  enabled: (config) => config.features.cms,
  register: (router, context) => {
    router.get(
      "/",
      asyncHandler(async (_req, res) => {
        return sendSuccess(res, {
          localization: await readLocalizationSettings(context.prisma)
        });
      })
    );
  }
};
