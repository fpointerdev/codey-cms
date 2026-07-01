import type { env } from "./env.js";

export type AppMode = "presentation" | "shop" | "cms" | "saas" | "landing";

export type FeatureFlags = {
  auth: true;
  users: true;
  roles: true;
  config: true;
  health: true;
  products: boolean;
  orders: boolean;
  cms: boolean;
  notifications: boolean;
  payments: boolean;
};

const modeDefaults: Record<AppMode, Omit<FeatureFlags, "auth" | "users" | "roles" | "config" | "health">> = {
  presentation: { products: false, orders: false, cms: true, notifications: false, payments: false },
  shop: { products: true, orders: true, cms: true, notifications: true, payments: true },
  cms: { products: false, orders: false, cms: true, notifications: true, payments: false },
  saas: { products: false, orders: false, cms: false, notifications: true, payments: false },
  landing: { products: false, orders: false, cms: true, notifications: false, payments: false }
};

type RuntimeEnv = typeof env;

export function resolveFeatures(runtimeEnv: RuntimeEnv): FeatureFlags {
  const defaults = modeDefaults[runtimeEnv.APP_MODE];

  return {
    auth: true,
    users: true,
    roles: true,
    config: true,
    health: true,
    products: defaults.products,
    orders: defaults.orders,
    cms: defaults.cms,
    notifications: defaults.notifications,
    payments: defaults.payments
  };
}
