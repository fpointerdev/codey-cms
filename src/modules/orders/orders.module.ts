import type { AppModule } from "../../core/types/module.js";
import { registerOrderRoutes } from "./orders.routes.js";

export const ordersModule: AppModule = {
  id: "orders",
  basePath: "/orders",
  enabled: (config) => config.features.orders,
  register: registerOrderRoutes
};
