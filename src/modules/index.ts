import { authModule } from "./auth/auth.module.js";
import { cmsModule } from "./cms/cms.module.js";
import { configModule } from "./config/config.module.js";
import { healthModule } from "./health/health.module.js";
import { localizationModule } from "./localization/localization.module.js";
import { notificationsModule } from "./notifications/notifications.module.js";
import { ordersModule } from "./orders/orders.module.js";
import { paymentsModule } from "./payments/payments.module.js";
import { productsModule } from "./products/products.module.js";
import { rolesModule } from "./roles/roles.module.js";
import { usersModule } from "./users/users.module.js";
import type { AppModule } from "../core/types/module.js";

export const modules: AppModule[] = [
  healthModule,
  configModule,
  authModule,
  usersModule,
  rolesModule,
  productsModule,
  ordersModule,
  cmsModule,
  localizationModule,
  notificationsModule,
  paymentsModule
];
