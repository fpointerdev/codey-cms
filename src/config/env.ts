import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const booleanFromEnv = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  return value;
}, z.boolean().optional());

const optionalStringFromEnv = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  return value;
}, z.string().trim().min(1).optional());

const optionalHttpUrlFromEnv = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  return value;
}, z.string().trim().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
  message: "URL must use HTTP or HTTPS."
}).optional());

const optionalSecretFromEnv = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  return value;
}, z.string().trim().min(32).optional());

const trustProxyFromEnv = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (["false", "no", "off"].includes(normalized)) return false;
  if (["true", "yes", "on"].includes(normalized)) return true;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return value.trim();
}, z.union([
  z.boolean(),
  z.number().int().min(0).max(10),
  z.string().trim().min(1).max(200)
]).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SELF_HOSTED: booleanFromEnv.default(false),
  CODEY_ALLOW_LOCAL_SETUP_HTTP: booleanFromEnv.default(false),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  APP_NAME: z.string().default("CodeY CMS"),
  APP_MODE: z.enum(["presentation", "shop", "cms", "saas", "landing"]).default("cms"),
  APP_PUBLIC_URL: optionalHttpUrlFromEnv,
  API_PREFIX: z.string().default("/api/v1"),
  PORT: z.coerce.number().int().positive().default(4000),
  TRUST_PROXY: trustProxyFromEnv,
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  CORS_ORIGINS: z.string().default(""),
  LOG_LEVEL: z.string().default("info"),
  PLATFORM_RATE_LIMIT_ENABLED: booleanFromEnv.default(true),
  CHECKOUT_MAX_ITEM_QUANTITY: z.coerce.number().int().positive().max(10_000).default(20),
  CHECKOUT_MAX_ORDER_ITEMS: z.coerce.number().int().positive().max(1_000).default(50),
  CHECKOUT_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(10_000).default(15),
  CHECKOUT_PENDING_ORDER_LIMIT_PER_EMAIL: z.coerce.number().int().positive().max(1_000).default(3),
  CHECKOUT_PENDING_ORDER_LIMIT_PER_IP: z.coerce.number().int().positive().max(1_000).default(5),
  ORDER_RESERVATION_TTL_MINUTES: z.coerce.number().int().positive().max(24 * 60).default(10),
  MAINTENANCE_MODE: booleanFromEnv.default(false),
  MAINTENANCE_MESSAGE: z.string().trim().min(1).default("This site is temporarily unavailable for maintenance."),
  MAINTENANCE_ALLOWED_PATHS: z.string().trim().default("/health,/auth,/config"),
  AUTH_ALLOW_REGISTRATION: booleanFromEnv.default(false),
  AUTH_REQUIRE_EMAIL_VERIFICATION: booleanFromEnv.default(false),
  AUTH_RECOVERY_TOKEN_DELIVERY: z.enum(["response", "email", "disabled"]).optional(),
  CMS_CREDENTIAL_ENCRYPTION_KEY: optionalSecretFromEnv,
  SECURITY_AUDIT_KEY: optionalSecretFromEnv,
  SECURITY_AUDIT_PREVIOUS_KEYS: z.string().trim().default(""),
  CODEY_INSTALL_TOKEN: optionalSecretFromEnv,
  CODEY_UPDATES_ENABLED: booleanFromEnv.default(true),
  CODEY_AUTO_UPDATE: booleanFromEnv.default(false),
  CODEY_RELEASE_FEED_URL: optionalHttpUrlFromEnv.default("https://github.com/fpointerdev/codey-cms/releases/latest/download/stable.json"),
  CODEY_RELEASE_PUBLIC_KEY: optionalStringFromEnv,
  CODEY_RELEASE_PUBLIC_KEY_FILE: z.string().trim().min(1).default("runtime-meta/release-public-key.pem"),
  CODEY_UPDATE_DIR: z.string().trim().min(1).default("updates"),
  CODEY_UPDATE_CONTROL_FILE: z.string().trim().min(1).default("updates/control/pending-update.json"),
  CODEY_UPDATE_CHECK_INTERVAL_HOURS: z.coerce.number().positive().min(0.25).max(168).default(6),
  EMAIL_DRIVER: z.enum(["disabled", "http"]).default("disabled"),
  EMAIL_FROM: optionalStringFromEnv,
  EMAIL_HTTP_ENDPOINT: optionalHttpUrlFromEnv,
  EMAIL_HTTP_BEARER_TOKEN: optionalStringFromEnv,
  EMAIL_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
  STORAGE_DRIVER: z.enum(["disabled", "local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().trim().min(1).default("storage/uploads"),
  STORAGE_S3_ENDPOINT: optionalHttpUrlFromEnv,
  STORAGE_S3_REGION: z.string().trim().min(1).default("auto"),
  STORAGE_S3_BUCKET: optionalStringFromEnv,
  STORAGE_S3_ACCESS_KEY_ID: optionalStringFromEnv,
  STORAGE_S3_SECRET_ACCESS_KEY: optionalStringFromEnv,
  STORAGE_S3_FORCE_PATH_STYLE: booleanFromEnv.default(true),
  STORAGE_PUBLIC_BASE_URL: optionalHttpUrlFromEnv,
  STORAGE_KEY_PREFIX: z.string().trim().default(""),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(86_400).default(900),
  STORAGE_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  STORAGE_UPLOAD_BODY_LIMIT: z.string().trim().min(1).default("12mb"),
  STORAGE_IMAGE_VARIANT_WIDTHS: z.string().trim().default("320,640,1200"),
  STORAGE_QUOTA_DEFAULT_MB: z.coerce.number().positive().default(512),
  STORAGE_QUOTA_PRESENTATION_MB: z.coerce.number().positive().default(512),
  STORAGE_QUOTA_CMS_MB: z.coerce.number().positive().default(2048),
  STORAGE_QUOTA_SHOP_MB: z.coerce.number().positive().default(5120),
  STORAGE_QUOTA_SAAS_MB: z.coerce.number().positive().default(2048),
  BACKUP_DIR: z.string().trim().min(1).default("backups"),
  BACKUP_MIRROR_DIR: optionalStringFromEnv,
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).default(30),
  BACKUP_INTERVAL_HOURS: z.coerce.number().positive().max(168).default(24),
  BACKUP_MAX_AGE_HOURS: z.coerce.number().positive().max(720).default(30),
  BACKUP_REQUIRED: booleanFromEnv.default(false),
  BACKUP_ENCRYPTION_KEY: optionalSecretFromEnv,
  BACKUP_REQUIRE_ENCRYPTION: booleanFromEnv.default(false),
  BACKUP_OFFSITE_REQUIRED: booleanFromEnv.default(false),
  BACKUP_OFFSITE_PROTECTED: booleanFromEnv.default(false),
  BACKUP_S3_MEDIA_PROTECTED: booleanFromEnv.default(false),
  BACKUP_ALERT_WEBHOOK_URL: optionalHttpUrlFromEnv,
  BACKUP_ALERT_WEBHOOK_TOKEN: optionalStringFromEnv
}).superRefine((value, context) => {
  if (value.STORAGE_DRIVER === "s3") {
    for (const field of ["STORAGE_S3_ENDPOINT", "STORAGE_S3_BUCKET", "STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY"] as const) {
      if (!value[field]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when STORAGE_DRIVER=s3.`
        });
      }
    }
  }

  if (value.EMAIL_DRIVER === "http") {
    for (const field of ["EMAIL_FROM", "EMAIL_HTTP_ENDPOINT"] as const) {
      if (!value[field]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when EMAIL_DRIVER=http.`
        });
      }
    }
  }

  if (value.BACKUP_REQUIRE_ENCRYPTION && !value.BACKUP_ENCRYPTION_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BACKUP_ENCRYPTION_KEY"],
      message: "BACKUP_ENCRYPTION_KEY is required when backup encryption is mandatory."
    });
  }
  if (value.BACKUP_OFFSITE_REQUIRED && !value.BACKUP_REQUIRED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BACKUP_REQUIRED"],
      message: "BACKUP_REQUIRED must be enabled when off-site backup protection is required."
    });
  }
  if (value.BACKUP_OFFSITE_PROTECTED && !value.BACKUP_MIRROR_DIR) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BACKUP_MIRROR_DIR"],
      message: "BACKUP_MIRROR_DIR is required when off-site backup protection is confirmed."
    });
  }

  const previousAuditKeys = value.SECURITY_AUDIT_PREVIOUS_KEYS
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  if (previousAuditKeys.some((key) => key.length < 32)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SECURITY_AUDIT_PREVIOUS_KEYS"],
      message: "Every previous audit key must contain at least 32 characters."
    });
  }
  if (new Set(previousAuditKeys).size !== previousAuditKeys.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SECURITY_AUDIT_PREVIOUS_KEYS"],
      message: "Previous audit keys must be unique."
    });
  }
  if (value.SECURITY_AUDIT_KEY && previousAuditKeys.includes(value.SECURITY_AUDIT_KEY)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SECURITY_AUDIT_PREVIOUS_KEYS"],
      message: "The current audit key must not also be listed as a previous key."
    });
  }

  if (value.NODE_ENV !== "production") return;

  if (!value.PLATFORM_RATE_LIMIT_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PLATFORM_RATE_LIMIT_ENABLED"],
      message: "PLATFORM_RATE_LIMIT_ENABLED cannot be disabled in production."
    });
  }

  const corsOrigins = value.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
  const allowedCorsOrigins = [...corsOrigins, value.APP_PUBLIC_URL].filter(Boolean);

  if (allowedCorsOrigins.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["CORS_ORIGINS"], message: "CORS_ORIGINS or APP_PUBLIC_URL must be set in production." });
  }

  if (corsOrigins.includes("*")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["CORS_ORIGINS"], message: "Wildcard CORS origins are not allowed in production." });
  }

  if (value.TRUST_PROXY === true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["TRUST_PROXY"],
      message: "TRUST_PROXY=true is not allowed in production. Use the exact proxy hop count, such as TRUST_PROXY=1."
    });
  }

  const localSetupUrl = value.SELF_HOSTED &&
    value.CODEY_ALLOW_LOCAL_SETUP_HTTP &&
    value.APP_PUBLIC_URL &&
    ["localhost", "127.0.0.1", "::1"].includes(new URL(value.APP_PUBLIC_URL).hostname);

  if (!value.APP_PUBLIC_URL) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_PUBLIC_URL"], message: "APP_PUBLIC_URL must be set in production." });
  } else if (new URL(value.APP_PUBLIC_URL).protocol !== "https:" && !localSetupUrl) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_PUBLIC_URL"], message: "APP_PUBLIC_URL must use HTTPS in production." });
  }

  const recoveryTokenDelivery = value.AUTH_RECOVERY_TOKEN_DELIVERY ?? "disabled";

  if (recoveryTokenDelivery === "response") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["AUTH_RECOVERY_TOKEN_DELIVERY"], message: "Response-based auth recovery token delivery is not allowed in production." });
  }

  if (value.AUTH_REQUIRE_EMAIL_VERIFICATION && recoveryTokenDelivery === "disabled") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["AUTH_RECOVERY_TOKEN_DELIVERY"], message: "AUTH_REQUIRE_EMAIL_VERIFICATION requires auth recovery token delivery in production." });
  }

  if (value.EMAIL_DRIVER === "http" && value.EMAIL_HTTP_ENDPOINT && new URL(value.EMAIL_HTTP_ENDPOINT).protocol !== "https:") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["EMAIL_HTTP_ENDPOINT"], message: "EMAIL_HTTP_ENDPOINT must use HTTPS in production." });
  }

  if (!value.CMS_CREDENTIAL_ENCRYPTION_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CMS_CREDENTIAL_ENCRYPTION_KEY"],
      message: "CMS_CREDENTIAL_ENCRYPTION_KEY is required to encrypt dashboard-managed credentials in production."
    });
  }

  if (!value.CODEY_INSTALL_TOKEN) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CODEY_INSTALL_TOKEN"],
      message: "CODEY_INSTALL_TOKEN is required to protect first-run setup in production."
    });
  }

  if (value.CODEY_UPDATES_ENABLED && value.CODEY_RELEASE_FEED_URL && new URL(value.CODEY_RELEASE_FEED_URL).protocol !== "https:") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CODEY_RELEASE_FEED_URL"],
      message: "CODEY_RELEASE_FEED_URL must use HTTPS in production."
    });
  }

  if (value.STORAGE_DRIVER !== "s3" && !(value.SELF_HOSTED && value.STORAGE_DRIVER === "local")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["STORAGE_DRIVER"], message: "STORAGE_DRIVER=s3 is required in production." });
  }

  if (!value.STORAGE_KEY_PREFIX) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["STORAGE_KEY_PREFIX"], message: "STORAGE_KEY_PREFIX must be set to a unique site directory in production." });
  }
});

export function parseEnvironment(source: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment configuration: ${JSON.stringify(errors)}`);
  }
  return parsed.data;
}

export const env = parseEnvironment(process.env);
