import { z } from "zod";
import { moduleCatalog, type ModuleLifecycleHook } from "../manifest.js";
import type { ModuleId } from "../../core/types/module.js";

const moduleIds = Object.keys(moduleCatalog);
const hostnamePattern =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const lifecycleHooks: ModuleLifecycleHook[] = [
  "install",
  "enable",
  "disable",
  "uninstall",
  "seed",
  "migrate"
];

export const moduleIdParams = z.object({
  moduleId: z.string().refine((value): value is ModuleId => moduleIds.includes(value), {
    message: "Unknown module."
  })
});

export const moduleLifecycleParams = moduleIdParams.extend({
  hook: z.enum(lifecycleHooks as [ModuleLifecycleHook, ...ModuleLifecycleHook[]])
});

export const moduleSettingsSchema = z.object({
  settings: z.record(z.unknown())
});

const domainTypes = ["PLATFORM_SUBDOMAIN", "CUSTOM"] as const;
const domainStatuses = ["PENDING", "ACTIVE", "FAILED", "DISABLED"] as const;

export const domainIdParams = z.object({
  domainId: z.string().trim().min(1)
});

const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .transform((value) => value.replace(/\.$/, ""))
  .refine((value) => hostnamePattern.test(value), {
    message: "Domain hostname is invalid."
  });

export const createSiteDomainSchema = z
  .object({
    hostname: hostnameSchema.optional(),
    type: z.enum(domainTypes).default("CUSTOM"),
    status: z.enum(domainStatuses).optional(),
    isPrimary: z.boolean().default(false),
    metadata: z.record(z.unknown()).optional()
  })
  .superRefine((value, context) => {
    if (value.type === "CUSTOM" && !value.hostname) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hostname"],
        message: "Domain hostname is required for custom domains."
      });
    }
  });

export const updateSiteDomainSchema = z.object({
  status: z.enum(domainStatuses).optional(),
  isPrimary: z.boolean().optional(),
  metadata: z.record(z.unknown()).nullable().optional()
});

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  action: z.string().trim().min(1).max(120).optional(),
  subject: z.string().trim().min(1).max(120).optional(),
  actorUserId: z.string().trim().min(1).optional()
});

export const maintenanceSettingsSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().min(1).max(300).default("This site is temporarily unavailable for maintenance."),
  allowedPaths: z.array(z.string().trim().min(1).max(120)).max(20).default(["/health", "/auth", "/config"])
});

export const siteSettingsSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional().default(""),
  metaTitle: z.string().trim().max(160).optional().default(""),
  metaDescription: z.string().trim().max(300).optional().default(""),
  siteUrl: z.string().trim().url().max(300).or(z.literal("")).optional().default(""),
  searchIndexing: z.boolean().optional().default(true),
  sitemapEnabled: z.boolean().optional().default(true),
  customCss: z.string().trim().max(20000).optional().default("")
});
