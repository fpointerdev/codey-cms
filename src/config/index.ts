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
  app: {
    name: env.APP_NAME,
    mode: env.APP_MODE,
    publicUrl: env.APP_PUBLIC_URL
  },
  api: {
    prefix: env.API_PREFIX,
    port: env.PORT
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
    dir: env.BACKUP_DIR
  },
  logging: {
    level: env.LOG_LEVEL
  },
  rateLimits: {
    platform: {
      enabled: true,
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
  email: {
    driver: env.EMAIL_DRIVER,
    from: env.EMAIL_FROM,
    httpEndpoint: env.EMAIL_HTTP_ENDPOINT,
    httpBearerToken: env.EMAIL_HTTP_BEARER_TOKEN,
    timeoutMs: env.EMAIL_TIMEOUT_MS
  },
  features: resolveFeatures(env)
} as const;

export type AppConfig = typeof config;
