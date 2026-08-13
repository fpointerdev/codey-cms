import { z } from "zod";
import { moduleCatalog, type ModuleLifecycleHook } from "../manifest.js";
import type { ModuleId } from "../../core/types/module.js";
import { defaultDesignSystemSettings } from "./site-design.js";

const moduleIds = Object.keys(moduleCatalog);
const hostnamePattern =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const httpEndpointSchema = z
  .string()
  .trim()
  .max(2_000)
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Email endpoint must use HTTP or HTTPS."
  });
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

export const emailSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(["generic", "resend", "postmark", "smtp"]).optional(),
  recoveryEnabled: z.boolean().optional(),
  from: z.string().trim().email().max(320).or(z.literal("")).optional(),
  httpEndpoint: httpEndpointSchema.or(z.literal("")).optional(),
  bearerToken: z.string().trim().max(2_000).optional(),
  clearBearerToken: z.boolean().optional(),
  smtpHost: z.string().trim().max(253).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65_535).optional(),
  smtpSecurity: z.enum(["starttls", "tls"]).optional(),
  smtpUsername: z.string().trim().max(320).optional(),
  smtpPassword: z.string().trim().max(2_000).optional(),
  clearSmtpPassword: z.boolean().optional()
}).strict().superRefine((value, context) => {
  if (value.bearerToken && value.clearBearerToken) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["clearBearerToken"],
      message: "Cannot set and remove the bearer token together."
    });
  }
  if (value.smtpPassword && value.clearSmtpPassword) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["clearSmtpPassword"],
      message: "Cannot set and remove the SMTP password together."
    });
  }
});

export const emailTestSchema = z.object({
  recipient: z.string().trim().email().max(320).optional()
}).strict();

export const storageSettingsSchema = z.object({
  provider: z.enum(["local", "s3", "r2"]),
  region: z.string().trim().max(100).optional(),
  bucket: z.string().trim().max(255).optional(),
  accountId: z.string().trim().max(64).optional(),
  accessKeyId: z.string().trim().max(512).optional(),
  secretAccessKey: z.string().trim().max(2_000).optional()
}).strict().superRefine((value, context) => {
  if (value.provider === "local") return;

  if (!value.bucket) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bucket"],
      message: "Bucket name is required."
    });
  }
  if (!value.accessKeyId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accessKeyId"],
      message: "Access key ID is required."
    });
  }
  if (value.provider === "r2" && !value.accountId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accountId"],
      message: "Cloudflare account ID is required."
    });
  }
});

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color.");
const designColorsSchema = z.object({
  background: hexColorSchema.default(defaultDesignSystemSettings.colors.background),
  surface: hexColorSchema.default(defaultDesignSystemSettings.colors.surface),
  text: hexColorSchema.default(defaultDesignSystemSettings.colors.text),
  muted: hexColorSchema.default(defaultDesignSystemSettings.colors.muted),
  primary: hexColorSchema.default(defaultDesignSystemSettings.colors.primary),
  primaryContrast: hexColorSchema.default(defaultDesignSystemSettings.colors.primaryContrast),
  border: hexColorSchema.default(defaultDesignSystemSettings.colors.border)
}).default(defaultDesignSystemSettings.colors);

export const designSystemSettingsSchema = z.object({
  preset: z.enum(["clean", "editorial", "bold", "soft", "custom"]).default(defaultDesignSystemSettings.preset),
  colors: designColorsSchema,
  typography: z.object({
    headingFont: z.enum(["Inter", "Arial", "Georgia", "Verdana", "Trebuchet MS"]).default(defaultDesignSystemSettings.typography.headingFont),
    bodyFont: z.enum(["Inter", "Arial", "Georgia", "Verdana", "Trebuchet MS"]).default(defaultDesignSystemSettings.typography.bodyFont),
    headingWeight: z.enum(["600", "700", "800"]).default(defaultDesignSystemSettings.typography.headingWeight),
    baseSize: z.number().int().min(14).max(20).default(defaultDesignSystemSettings.typography.baseSize),
    scale: z.enum(["compact", "standard", "expressive"]).default(defaultDesignSystemSettings.typography.scale)
  }).default(defaultDesignSystemSettings.typography),
  layout: z.object({
    contentWidth: z.number().int().min(880).max(1440).default(defaultDesignSystemSettings.layout.contentWidth),
    sectionSpacing: z.number().int().min(24).max(128).default(defaultDesignSystemSettings.layout.sectionSpacing),
    radius: z.number().int().min(0).max(24).default(defaultDesignSystemSettings.layout.radius),
    shadow: z.enum(["none", "soft", "strong"]).default(defaultDesignSystemSettings.layout.shadow)
  }).default(defaultDesignSystemSettings.layout),
  buttons: z.object({
    radius: z.number().int().min(0).max(32).default(defaultDesignSystemSettings.buttons.radius),
    style: z.enum(["solid", "outline"]).default(defaultDesignSystemSettings.buttons.style)
  }).default(defaultDesignSystemSettings.buttons),
  header: z.object({
    background: hexColorSchema.default(defaultDesignSystemSettings.header.background),
    text: hexColorSchema.default(defaultDesignSystemSettings.header.text),
    sticky: z.boolean().default(defaultDesignSystemSettings.header.sticky)
  }).default(defaultDesignSystemSettings.header),
  footer: z.object({
    background: hexColorSchema.default(defaultDesignSystemSettings.footer.background),
    text: hexColorSchema.default(defaultDesignSystemSettings.footer.text)
  }).default(defaultDesignSystemSettings.footer)
}).default(defaultDesignSystemSettings);

const siteImageUrlSchema = z
  .string()
  .trim()
  .max(120_000)
  .refine((value) => {
    if (!value || value.startsWith("/")) return true;
    if (/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);(?:base64|utf8),/i.test(value)) return true;

    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an uploaded image or an HTTP(S) image URL.");

export const siteSettingsSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional().default(""),
  metaTitle: z.string().trim().max(160).optional().default(""),
  metaDescription: z.string().trim().max(300).optional().default(""),
  siteUrl: z.string().trim().url().max(300).or(z.literal("")).optional().default(""),
  searchIndexing: z.boolean().optional().default(true),
  sitemapEnabled: z.boolean().optional().default(true),
  logoUrl: siteImageUrlSchema.optional().default(""),
  logoMode: z.enum(["text", "image", "image-and-name"]).optional().default("text"),
  logoAltText: z.string().trim().max(160).optional().default(""),
  logoHeight: z.number().int().min(20).max(120).optional().default(42),
  faviconUrl: siteImageUrlSchema.optional().default(""),
  socialImageUrl: siteImageUrlSchema.optional().default(""),
  socialImageAlt: z.string().trim().max(240).optional().default(""),
  design: designSystemSettingsSchema.optional().default(defaultDesignSystemSettings),
  customCss: z.string().trim().max(20000).optional().default("")
});
