import type { AppModule } from "../../core/types/module.js";
import { registerCmsRoutes } from "./cms.routes.js";

export const cmsModule: AppModule = {
  id: "cms",
  basePath: "/cms",
  enabled: (config) => config.features.cms,
  register: registerCmsRoutes
};
