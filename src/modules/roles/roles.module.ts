import type { AppModule } from "../../core/types/module.js";
import { registerRoleRoutes } from "./roles.routes.js";

export const rolesModule: AppModule = {
  id: "roles",
  basePath: "/roles",
  enabled: (config) => config.features.roles,
  register: registerRoleRoutes
};
