import type { AppModule } from "../../core/types/module.js";
import { registerNotificationRoutes } from "./notifications.routes.js";

export const notificationsModule: AppModule = {
  id: "notifications",
  basePath: "/notifications",
  enabled: (config) => config.features.notifications,
  register: registerNotificationRoutes
};
