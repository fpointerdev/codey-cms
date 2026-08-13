import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import { decryptSecretEnvelope, encryptSecretEnvelope } from "../../core/security/secret-envelope.js";
import { createStorageAdapter } from "./s3-storage.js";
import type { StorageAdapter } from "./storage.types.js";

export type StorageProvider = "local" | "s3" | "r2";
export type StorageRuntimeConfig = AppConfig["storage"];

type StoredStorageSettings = {
  provider: StorageProvider;
  endpoint?: string;
  region?: string;
  bucket?: string;
  accountId?: string;
  accessKeyId?: string;
  forcePathStyle?: boolean;
  encryptedCredentials?: string;
  lastTestedAt?: string;
  configurationRevision?: string;
};

type StorageCredentials = {
  secretAccessKey?: string;
};

export type UpdateStorageSettingsInput = {
  provider: StorageProvider;
  region?: string;
  bucket?: string;
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

type ResolvedStorageSettings = {
  source: "dashboard" | "environment";
  provider: StorageProvider | "disabled";
  runtime: StorageRuntimeConfig;
  secretAccessKeyConfigured: boolean;
  lastTestedAt?: string;
  configurationRevision?: string;
};

type MediaStorageRecord = {
  storageKey: string | null;
  mimeType: string | null;
  variants: Prisma.JsonValue | null;
};

function clean(value?: string | null) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function providerFromRuntime(runtime: StorageRuntimeConfig): StorageProvider | "disabled" {
  if (runtime.driver === "local") return "local";
  if (runtime.driver !== "s3") return "disabled";
  return runtime.endpoint?.includes(".r2.cloudflarestorage.com") ? "r2" : "s3";
}

function asStoredSettings(value: Prisma.JsonValue | null | undefined): StoredStorageSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const provider = String(record.provider || "");
  if (!["local", "s3", "r2"].includes(provider)) return null;

  return {
    provider: provider as StorageProvider,
    endpoint: typeof record.endpoint === "string" ? record.endpoint : undefined,
    region: typeof record.region === "string" ? record.region : undefined,
    bucket: typeof record.bucket === "string" ? record.bucket : undefined,
    accountId: typeof record.accountId === "string" ? record.accountId : undefined,
    accessKeyId: typeof record.accessKeyId === "string" ? record.accessKeyId : undefined,
    forcePathStyle: typeof record.forcePathStyle === "boolean" ? record.forcePathStyle : undefined,
    encryptedCredentials: typeof record.encryptedCredentials === "string"
      ? record.encryptedCredentials
      : undefined,
    lastTestedAt: typeof record.lastTestedAt === "string" ? record.lastTestedAt : undefined,
    configurationRevision: typeof record.configurationRevision === "string"
      ? record.configurationRevision
      : undefined
  };
}

function r2Endpoint(accountId: string) {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function defaultS3Endpoint(region: string) {
  return `https://s3.${region}.amazonaws.com`;
}

function normalizeAwsRegion(value?: string) {
  const region = clean(value) || "us-east-1";
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) {
    throw new AppError(422, "invalid_s3_region", "Enter a valid AWS region, such as eu-central-1.");
  }
  return region;
}

function variantStorageEntries(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((variant) => {
    if (!variant || typeof variant !== "object" || Array.isArray(variant)) return [];
    const record = variant as Record<string, unknown>;
    if (record.status && record.status !== "READY") return [];
    return typeof record.storageKey === "string" && record.storageKey
      ? [{
          key: record.storageKey,
          mimeType: typeof record.mimeType === "string" ? record.mimeType : "image/webp"
        }]
      : [];
  });
}

function storageEntries(assets: MediaStorageRecord[]) {
  const entries = new Map<string, string>();
  for (const asset of assets) {
    if (asset.storageKey) entries.set(asset.storageKey, asset.mimeType || "application/octet-stream");
    for (const variant of variantStorageEntries(asset.variants)) {
      entries.set(variant.key, variant.mimeType);
    }
  }
  return [...entries].map(([key, mimeType]) => ({ key, mimeType }));
}

function sameStorageLocation(left: StorageRuntimeConfig, right: StorageRuntimeConfig) {
  if (left.driver !== right.driver) return false;
  if (left.driver === "local") return left.localDir === right.localDir;
  if (left.driver !== "s3") return true;

  return left.endpoint === right.endpoint &&
    left.bucket === right.bucket &&
    left.region === right.region &&
    left.forcePathStyle === right.forcePathStyle &&
    left.keyPrefix === right.keyPrefix;
}

class ManagedStorageAdapter implements StorageAdapter {
  constructor(private readonly service: StorageSettingsService) {}

  get enabled() {
    return this.service.currentAdapter.enabled;
  }

  publicUrl(key: string) {
    if (this.service.source === "dashboard") {
      const encodedKey = key.split("/").map(encodeURIComponent).join("/");
      return `/uploads/${encodedKey}`;
    }
    return this.service.currentAdapter.publicUrl(key);
  }

  async checkConnection() {
    return this.service.withAdapter((adapter) => adapter.checkConnection());
  }

  async createUploadUrl(key: string, contentType: string) {
    return this.service.withAdapter((adapter) => adapter.createUploadUrl(key, contentType));
  }

  async createDownloadUrl(key: string) {
    return this.service.withAdapter((adapter) => adapter.createDownloadUrl(key));
  }

  async putObject(key: string, body: Buffer, contentType: string) {
    return this.service.withAdapter((adapter) => adapter.putObject(key, body, contentType));
  }

  async getObject(key: string) {
    return this.service.withAdapter((adapter) => adapter.getObject(key));
  }

  async deleteObject(key: string) {
    return this.service.withAdapter((adapter) => adapter.deleteObject(key));
  }

  async headObject(key: string) {
    return this.service.withAdapter((adapter) => adapter.headObject(key));
  }
}

export class StorageSettingsService {
  readonly adapter: StorageAdapter;
  currentAdapter: StorageAdapter;
  source: ResolvedStorageSettings["source"] = "environment";
  private active: ResolvedStorageSettings;
  private operationGate: Promise<void> = Promise.resolve();
  private activeOperations = 0;
  private operationsDrained: Promise<void> | null = null;
  private resolveOperationsDrained: (() => void) | null = null;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig
  ) {
    this.currentAdapter = createStorageAdapter(config.storage);
    this.active = this.environmentSettings();
    this.adapter = new ManagedStorageAdapter(this);
  }

  async initialize() {
    try {
      const resolved = await this.resolveFromDatabase();
      this.activate(resolved);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021")) {
        throw error;
      }
    }
    return this.getAdminStatus();
  }

  getRuntimeConfig() {
    return this.active.runtime;
  }

  async withAdapter<T>(operation: (adapter: StorageAdapter) => Promise<T>) {
    while (true) {
      const gate = this.operationGate;
      await gate;
      if (gate !== this.operationGate) continue;

      this.activeOperations += 1;
      break;
    }

    try {
      return await operation(this.currentAdapter);
    } finally {
      this.activeOperations -= 1;
      if (this.activeOperations === 0) {
        this.resolveOperationsDrained?.();
        this.operationsDrained = null;
        this.resolveOperationsDrained = null;
      }
    }
  }

  async getAdminStatus() {
    const active = this.active;
    return {
      source: active.source,
      provider: active.provider,
      configured: active.runtime.driver !== "disabled" && active.secretAccessKeyConfigured,
      localReady: active.runtime.driver === "local",
      endpoint: active.provider === "s3" ? active.runtime.endpoint ?? "" : "",
      region: active.runtime.region,
      bucket: active.runtime.bucket ?? "",
      accountId: active.provider === "r2"
        ? active.runtime.endpoint?.split(".", 1)[0]?.replace("https://", "") ?? ""
        : "",
      accessKeyId: active.runtime.accessKeyId ?? "",
      secretAccessKeyConfigured: active.secretAccessKeyConfigured,
      forcePathStyle: active.runtime.forcePathStyle,
      keyPrefix: active.runtime.keyPrefix,
      lastTestedAt: active.lastTestedAt,
      settingsRevision: active.configurationRevision
    };
  }

  async requiresSensitiveAuthorization(input: UpdateStorageSettingsInput) {
    const current = this.active;
    if (input.secretAccessKey) return true;
    if (input.provider !== current.provider) return true;
    if (input.provider === "local") return false;

    const endpoint = input.provider === "r2"
      ? r2Endpoint(clean(input.accountId) || "")
      : defaultS3Endpoint(normalizeAwsRegion(input.region));
    return endpoint !== current.runtime.endpoint ||
      clean(input.bucket) !== current.runtime.bucket ||
      clean(input.accessKeyId) !== current.runtime.accessKeyId;
  }

  async update(input: UpdateStorageSettingsInput) {
    const previousQueue = this.updateQueue;
    let finishQueue = () => {};
    this.updateQueue = new Promise<void>((resolve) => {
      finishQueue = resolve;
    });
    await previousQueue;

    let releaseOperations = () => {};
    this.operationGate = new Promise<void>((resolve) => {
      releaseOperations = resolve;
    });

    try {
      await this.waitForOperationsToDrain();
      const site = await this.getDefaultSite();
      const stored = await this.readStoredSettings(site.id);
      const resolved = await this.buildDashboardSettings(input, stored);
      const nextAdapter = createStorageAdapter(resolved.runtime);
      await nextAdapter.checkConnection();
      const migratedObjects = await this.migrateMediaIfNeeded(nextAdapter, resolved.runtime);
      const now = new Date().toISOString();
      const value = this.storedValue(input, resolved, now);

      await this.prisma.moduleSetting.upsert({
        where: {
          siteId_moduleId_key: {
            siteId: site.id,
            moduleId: "config",
            key: "storage"
          }
        },
        update: { value },
        create: {
          siteId: site.id,
          moduleId: "config",
          key: "storage",
          value
        }
      });

      this.activate({
        ...resolved,
        lastTestedAt: now,
        configurationRevision: value.configurationRevision
      });
      return {
        storage: await this.getAdminStatus(),
        migration: { copiedObjects: migratedObjects }
      };
    } finally {
      releaseOperations();
      finishQueue();
    }
  }

  private waitForOperationsToDrain() {
    if (this.activeOperations === 0) return Promise.resolve();
    if (!this.operationsDrained) {
      this.operationsDrained = new Promise<void>((resolve) => {
        this.resolveOperationsDrained = resolve;
      });
    }
    return this.operationsDrained;
  }

  private async resolveFromDatabase(): Promise<ResolvedStorageSettings> {
    const site = await this.getDefaultSite();
    const stored = await this.readStoredSettings(site.id);
    if (!stored) return this.environmentSettings();

    const credentials = this.decryptCredentials(stored.encryptedCredentials);
    return this.resolvedDashboardSettings(stored, credentials.secretAccessKey);
  }

  private environmentSettings(): ResolvedStorageSettings {
    return {
      source: "environment",
      provider: providerFromRuntime(this.config.storage),
      runtime: this.config.storage,
      secretAccessKeyConfigured: this.config.storage.driver === "local" ||
        Boolean(this.config.storage.secretAccessKey)
    };
  }

  private async buildDashboardSettings(
    input: UpdateStorageSettingsInput,
    stored: StoredStorageSettings | null
  ): Promise<ResolvedStorageSettings> {
    if (input.provider === "local") {
      return this.resolvedDashboardSettings({ provider: "local" });
    }

    const requestedRegion = input.provider === "s3" ? normalizeAwsRegion(input.region) : "auto";
    const requestedEndpoint = input.provider === "r2"
      ? r2Endpoint(clean(input.accountId) || "")
      : defaultS3Endpoint(requestedRegion);
    const environmentSecret = !stored &&
      this.source === "environment" &&
      this.active.provider === input.provider &&
      this.active.runtime.endpoint?.replace(/\/$/, "") === requestedEndpoint &&
      this.active.runtime.bucket === clean(input.bucket) &&
      this.active.runtime.accessKeyId === clean(input.accessKeyId)
      ? this.active.runtime.secretAccessKey
      : undefined;
    const bindingChanged = stored
      ? stored.provider !== input.provider ||
        clean(stored.bucket) !== clean(input.bucket) ||
        clean(stored.accessKeyId) !== clean(input.accessKeyId) ||
        (input.provider === "r2"
          ? clean(stored.accountId) !== clean(input.accountId)
          : defaultS3Endpoint(normalizeAwsRegion(stored.region)) !== requestedEndpoint)
      : !environmentSecret;
    const previousSecret = stored
      ? this.decryptCredentials(stored.encryptedCredentials).secretAccessKey
      : environmentSecret;
    const secretAccessKey = clean(input.secretAccessKey) || (bindingChanged ? undefined : previousSecret);
    if (!secretAccessKey) {
      throw new AppError(
        422,
        "storage_credentials_required",
        "Enter the secret access key before saving this storage connection."
      );
    }

    if (input.provider === "r2") {
      const accountId = clean(input.accountId);
      if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) {
        throw new AppError(422, "invalid_r2_account", "Enter the 32-character Cloudflare account ID.");
      }
      return this.resolvedDashboardSettings({
        provider: "r2",
        accountId,
        bucket: clean(input.bucket),
        accessKeyId: clean(input.accessKeyId)
      }, secretAccessKey);
    }

    const region = requestedRegion;
    const endpoint = defaultS3Endpoint(region);
    return this.resolvedDashboardSettings({
      provider: "s3",
      endpoint,
      region,
      bucket: clean(input.bucket),
      accessKeyId: clean(input.accessKeyId),
      forcePathStyle: false
    }, secretAccessKey);
  }

  private resolvedDashboardSettings(
    stored: StoredStorageSettings,
    secretAccessKey?: string
  ): ResolvedStorageSettings {
    if (stored.provider === "local") {
      return {
        source: "dashboard",
        provider: "local",
        runtime: {
          ...this.config.storage,
          driver: "local",
          endpoint: undefined,
          bucket: undefined,
          accessKeyId: undefined,
          secretAccessKey: undefined,
          publicBaseUrl: undefined
        },
        secretAccessKeyConfigured: true,
        lastTestedAt: stored.lastTestedAt,
        configurationRevision: stored.configurationRevision
      };
    }

    const accountId = clean(stored.accountId);
    const region = stored.provider === "r2" ? "auto" : normalizeAwsRegion(stored.region);
    const endpoint = stored.provider === "r2" && accountId
      ? r2Endpoint(accountId)
      : defaultS3Endpoint(region);
    const forcePathStyle = stored.provider === "r2";
    const bucket = clean(stored.bucket);
    const accessKeyId = clean(stored.accessKeyId);
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new AppError(503, "storage_credentials_unavailable", "Stored storage credentials are incomplete.");
    }

    return {
      source: "dashboard",
      provider: stored.provider,
      runtime: {
        ...this.config.storage,
        driver: "s3",
        endpoint,
        region,
        bucket,
        accessKeyId,
        secretAccessKey,
        forcePathStyle,
        publicBaseUrl: undefined
      },
      secretAccessKeyConfigured: true,
      lastTestedAt: stored.lastTestedAt,
      configurationRevision: stored.configurationRevision
    };
  }

  private storedValue(
    input: UpdateStorageSettingsInput,
    resolved: ResolvedStorageSettings,
    lastTestedAt: string
  ): StoredStorageSettings {
    const configurationRevision = randomUUID();
    if (input.provider === "local") {
      return { provider: "local", lastTestedAt, configurationRevision };
    }

    return {
      provider: input.provider,
      endpoint: input.provider === "s3" ? resolved.runtime.endpoint : undefined,
      region: input.provider === "s3" ? resolved.runtime.region : undefined,
      bucket: resolved.runtime.bucket,
      accountId: input.provider === "r2" ? clean(input.accountId) : undefined,
      accessKeyId: resolved.runtime.accessKeyId,
      forcePathStyle: resolved.runtime.forcePathStyle,
      encryptedCredentials: encryptSecretEnvelope(
        this.config.security.credentialEncryptionKey,
        { secretAccessKey: resolved.runtime.secretAccessKey } satisfies StorageCredentials
      ),
      lastTestedAt,
      configurationRevision
    };
  }

  private async migrateMediaIfNeeded(target: StorageAdapter, targetConfig: StorageRuntimeConfig) {
    if (sameStorageLocation(this.active.runtime, targetConfig)) return 0;

    const assets = await this.prisma.mediaAsset.findMany({
      where: { deletedAt: null, storageKey: { not: null } },
      select: { storageKey: true, mimeType: true, variants: true }
    });
    const entries = storageEntries(assets);
    if (entries.length === 0) return 0;
    if (!this.currentAdapter.enabled) {
      throw new AppError(409, "storage_migration_unavailable", "Current media storage is unavailable.");
    }
    if (this.active.runtime.publicBaseUrl) {
      throw new AppError(
        409,
        "storage_url_migration_required",
        "Existing media uses a deployment CDN URL. Migrate those URLs before changing storage."
      );
    }

    for (const entry of entries) {
      const body = await this.currentAdapter.getObject(entry.key);
      await target.putObject(entry.key, body, entry.mimeType);
    }
    return entries.length;
  }

  private activate(resolved: ResolvedStorageSettings) {
    this.active = resolved;
    this.source = resolved.source;
    this.currentAdapter = createStorageAdapter(resolved.runtime);
  }

  private decryptCredentials(envelope?: string): StorageCredentials {
    if (!envelope) return {};
    try {
      const credentials = decryptSecretEnvelope<unknown>(
        this.config.security.credentialEncryptionKey,
        envelope
      );
      if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
        throw new Error("Invalid storage credential payload");
      }
      const secretAccessKey = (credentials as Record<string, unknown>).secretAccessKey;
      return { secretAccessKey: typeof secretAccessKey === "string" ? secretAccessKey : undefined };
    } catch {
      throw new AppError(
        503,
        "storage_credentials_unavailable",
        "Stored storage credentials could not be decrypted. Check the CMS credential encryption key."
      );
    }
  }

  private async getDefaultSite() {
    return this.prisma.site.upsert({
      where: { slug: "default" },
      update: {},
      create: {
        slug: "default",
        name: this.config.app.name,
        deploymentProfile: this.config.app.mode === "landing" ? "presentation" : this.config.app.mode
      },
      select: { id: true }
    });
  }

  private async readStoredSettings(siteId: string) {
    const setting = await this.prisma.moduleSetting.findUnique({
      where: {
        siteId_moduleId_key: {
          siteId,
          moduleId: "config",
          key: "storage"
        }
      },
      select: { value: true }
    });
    return asStoredSettings(setting?.value);
  }
}
