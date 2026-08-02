import { env } from "./env.js";
import { resolveFeatures } from "./features.js";

function megabytesToBytes(value: number) {
  return Math.round(value * 1024 * 1024);
}

function parseImageVariantWidths(value: string) {
  return value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0).sort((left, right) => left - right);
}

function parseCommaSeparated(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export const config = {
  env: env.APP_ENV,
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  selfHosted: env.SELF_HOSTED,
  app: {
    name: env.APP_NAME,
    mode: env.APP_MODE,
    publicUrl: env.APP_PUBLIC_URL
  },
  api: {
    prefix: env.API_PREFIX,
    port: env.PORT,
    trustProxy: env.TRUST_PROXY ?? false
  },
  auth: {
    accessTokenSecret: env.JWT_ACCESS_SECRET,
    accessTokenTtl: env.JWT_ACCESS_TTL,
    refreshTokenTtl: env.JWT_REFRESH_TTL,
    allowRegistration: env.AUTH_ALLOW_REGISTRATION,
    requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
    recoveryTokenDelivery: env.AUTH_RECOVERY_TOKEN_DELIVERY ?? (env.NODE_ENV === "production" ? "disabled" : "response")
  },
  cors: {
    origins: parseCommaSeparated(env.CORS_ORIGINS)
  },
  database: {
    url: env.DATABASE_URL
  },
  domains: {
    platformBaseDomain: undefined as string | undefined
  },
  backup: {
    dir: env.BACKUP_DIR,
    mirrorDir: env.BACKUP_MIRROR_DIR,
    retentionDays: env.BACKUP_RETENTION_DAYS,
    intervalHours: env.BACKUP_INTERVAL_HOURS,
    maxAgeHours: env.BACKUP_MAX_AGE_HOURS,
    required: env.BACKUP_REQUIRED,
    encrypted: Boolean(env.BACKUP_ENCRYPTION_KEY),
    requireEncryption: env.BACKUP_REQUIRE_ENCRYPTION,
    offsiteRequired: env.BACKUP_OFFSITE_REQUIRED,
    offsiteProtected: env.BACKUP_OFFSITE_PROTECTED,
    s3MediaProtected: env.BACKUP_S3_MEDIA_PROTECTED,
    storageDriver: env.STORAGE_DRIVER
  },
  logging: {
    level: env.LOG_LEVEL
  },
  security: {
    credentialEncryptionKey: env.CMS_CREDENTIAL_ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET,
    auditIntegrityKey: env.SECURITY_AUDIT_KEY ?? env.CMS_CREDENTIAL_ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET,
    auditPreviousIntegrityKeys: parseCommaSeparated(env.SECURITY_AUDIT_PREVIOUS_KEYS),
    loginProtection: {
      windowMs: 15 * 60_000,
      accountFreeAttempts: 5,
      ipFreeAttempts: 20,
      maxDelayMs: 15 * 60_000
    }
  },
  rateLimits: {
    platform: {
      enabled: env.PLATFORM_RATE_LIMIT_ENABLED,
      windowMs: 60_000,
      apiMax: 300,
      authMax: 30,
      aiMax: 20,
      generationMax: 10,
      publishMax: 20,
      adminMax: 60
    }
  },
  maintenance: {
    enabled: env.MAINTENANCE_MODE,
    message: env.MAINTENANCE_MESSAGE,
    allowedPaths: parseCommaSeparated(env.MAINTENANCE_ALLOWED_PATHS)
  },
  storage: {
    driver: env.STORAGE_DRIVER,
    localDir: env.STORAGE_LOCAL_DIR,
    endpoint: env.STORAGE_S3_ENDPOINT,
    region: env.STORAGE_S3_REGION,
    bucket: env.STORAGE_S3_BUCKET,
    accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL,
    keyPrefix: env.STORAGE_KEY_PREFIX,
    signedUrlTtlSeconds: env.STORAGE_SIGNED_URL_TTL_SECONDS,
    maxUploadBytes: env.STORAGE_MAX_UPLOAD_BYTES,
    requestBodyLimit: env.STORAGE_UPLOAD_BODY_LIMIT,
    imageVariantWidths: parseImageVariantWidths(env.STORAGE_IMAGE_VARIANT_WIDTHS),
    quotaBytes: {
      default: megabytesToBytes(env.STORAGE_QUOTA_DEFAULT_MB),
      presentation: megabytesToBytes(env.STORAGE_QUOTA_PRESENTATION_MB),
      cms: megabytesToBytes(env.STORAGE_QUOTA_CMS_MB),
      shop: megabytesToBytes(env.STORAGE_QUOTA_SHOP_MB),
      saas: megabytesToBytes(env.STORAGE_QUOTA_SAAS_MB)
    }
  },
  payments: {
    credentialEncryptionKey: env.CMS_CREDENTIAL_ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET
  },
  installation: {
    claimToken: env.CODEY_INSTALL_TOKEN
  },
  updates: {
    enabled: env.CODEY_UPDATES_ENABLED,
    autoApply: env.CODEY_AUTO_UPDATE,
    feedUrl: env.CODEY_RELEASE_FEED_URL,
    publicKey: env.CODEY_RELEASE_PUBLIC_KEY,
    publicKeyFile: env.CODEY_RELEASE_PUBLIC_KEY_FILE,
    directory: env.CODEY_UPDATE_DIR,
    controlFile: env.CODEY_UPDATE_CONTROL_FILE,
    checkIntervalHours: env.CODEY_UPDATE_CHECK_INTERVAL_HOURS
  },
  email: {
    driver: env.EMAIL_DRIVER,
    provider: "generic" as const,
    from: env.EMAIL_FROM,
    httpEndpoint: env.EMAIL_HTTP_ENDPOINT,
    httpBearerToken: env.EMAIL_HTTP_BEARER_TOKEN,
    timeoutMs: env.EMAIL_TIMEOUT_MS
  },
  features: resolveFeatures(env)
} as const;

export type AppConfig = typeof config;
