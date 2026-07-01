import type { AppModule } from "../../core/types/module.js";
import { registerProductRoutes } from "./products.routes.js";

export const productsModule: AppModule = {
  id: "products",
  basePath: "/products",
  enabled: (config) => config.features.products,
  register: registerProductRoutes
};
