import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { AppConfig } from "../../config/index.js";
import type { AppLogger } from "../../infrastructure/logging/logger.js";

export type ModuleId =
  | "health"
  | "config"
  | "auth"
  | "users"
  | "roles"
  | "products"
  | "orders"
  | "cms"
  | "localization"
  | "notifications"
  | "payments";

export type ModuleContext = {
  config: AppConfig;
  prisma: PrismaClient;
  logger: AppLogger;
};

export type AppModule = {
  id: ModuleId;
  basePath: string;
  enabled: (config: AppConfig) => boolean;
  register: (router: Router, context: ModuleContext) => void | Promise<void>;
};
