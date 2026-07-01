import type { AppModule } from "../../core/types/module.js";
import { registerAuthRoutes } from "./auth.routes.js";

export const authModule: AppModule = {
  id: "auth",
  basePath: "/auth",
  enabled: (config) => config.features.auth,
  register: registerAuthRoutes
};
