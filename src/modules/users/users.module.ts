import type { AppModule } from "../../core/types/module.js";
import { registerUserRoutes } from "./users.routes.js";

export const usersModule: AppModule = {
  id: "users",
  basePath: "/users",
  enabled: (config) => config.features.users,
  register: registerUserRoutes
};
