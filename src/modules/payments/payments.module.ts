import type { AppModule } from "../../core/types/module.js";
import { registerPaymentRoutes } from "./payments.routes.js";

export const paymentsModule: AppModule = {
  id: "payments",
  basePath: "/payments",
  enabled: (config) => config.features.payments,
  register: registerPaymentRoutes
};
