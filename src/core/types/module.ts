import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { AppConfig } from "../../config/index.js";
import type { AppLogger } from "../../infrastructure/logging/logger.js";
import type { StorageSettingsService } from "../../infrastructure/storage/storage-settings.service.js";

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
  storageSettings?: StorageSettingsService;
};

export type AppModule = {
  id: ModuleId;
  basePath: string;
  enabled: (config: AppConfig) => boolean;
  register: (router: Router, context: ModuleContext) => void | Promise<void>;
};
