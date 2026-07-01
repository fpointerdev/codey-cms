import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import sharp from "sharp";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import { createStorageAdapter } from "../../infrastructure/storage/s3-storage.js";
import type { StorageAdapter } from "../../infrastructure/storage/storage.types.js";
import { extractImageMetadata } from "./media-metadata.js";

type MediaDatabase = PrismaClient | Prisma.TransactionClient;

type SiteRecord = {
  id: string;
  slug: string;
  deploymentProfile: string;
};

type MediaKind = "DOCUMENT" | "IMAGE" | "OTHER" | "VIDEO";
type ImageVariantStatus = "FAILED" | "PENDING" | "READY";

type ImageVariant = {
  name: string;
  width: number;
  height: number;
  storageKey: string;
  status: ImageVariantStatus;
  url?: string;
  sizeBytes?: number;
  mimeType?: string;
  error?: string;
};

type DirectUploadInput = {
  filename: string;
  mimeType: string;
  dataBase64: string;
  kind?: MediaKind;
  altText?: string;
};

type SignedUploadInput = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind?: MediaKind;
  altText?: string;
};

type CompleteSignedUploadInput = SignedUploadInput & {
  storageKey: string;
  width?: number;
  height?: number;
};

type CreateExternalMediaInput = {
  kind?: MediaKind;
  storageKey?: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  altText?: string;
};

type CleanupInput = {
  dryRun?: boolean;
  olderThanDays?: number;
  limit?: number;
};

function checksumSha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function decodeBase64(value: string) {
  const normalized = value.includes(",") ? value.split(",").pop() ?? "" : value;
  return Buffer.from(normalized, "base64");
}

function sanitizeFilename(filename: string) {
  const cleaned = filename
    .toLowerCase()
    .replace(/[/\\]/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return cleaned || "upload";
}

function inferKind(mimeType: string): MediaKind {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (
    mimeType === "application/pdf" ||
    mimeType.includes("document") ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("presentation")
  ) {
    return "DOCUMENT";
  }

  return "OTHER";
}

function normalizeKeyPrefix(prefix: string) {
  return prefix.replace(/^\/+|\/+$/g, "");
}

function collectVariantStorageKeys(variants: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(variants)) return [];

  return variants.flatMap((variant) => {
    if (typeof variant !== "object" || variant === null || Array.isArray(variant)) return [];
    const storageKey = (variant as Record<string, unknown>).storageKey;
    return typeof storageKey === "string" ? [storageKey] : [];
  });
}

function collectVariantSizeBytes(variants: Prisma.JsonValue | ImageVariant[] | null | undefined) {
  if (!Array.isArray(variants)) return 0;

  return (variants as unknown[]).reduce<number>((total, variant) => {
    if (typeof variant !== "object" || variant === null || Array.isArray(variant)) return total;
    const sizeBytes = (variant as Record<string, unknown>).sizeBytes;
    return total + (typeof sizeBytes === "number" ? sizeBytes : 0);
  }, 0);
}

function normalizedMimeType(mimeType?: string) {
  return mimeType?.split(";")[0]?.trim().toLowerCase();
}

function imageVariantMimeType(mimeType?: string) {
  const normalized = normalizedMimeType(mimeType);
  if (!normalized) return "image/webp";
  if (normalized === "image/jpg") return "image/jpeg";
  if (normalized === "image/jpeg" || normalized === "image/png" || normalized === "image/webp") {
    return normalized;
  }

  return undefined;
}

function imageVariantFormat(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpeg";
  return "webp";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Image variant generation failed.";
}

export class MediaService {
  constructor(
    private readonly prisma: MediaDatabase,
    private readonly config: AppConfig,
    private readonly storage: StorageAdapter = createStorageAdapter(config.storage)
  ) {}

  async listMediaAssets() {
    return this.prisma.mediaAsset.findMany({
      where: {
        deletedAt: null
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  }

  async getUsage() {
    const site = await this.getDefaultSite();
    const usage = await this.currentUsage(site.id);

    return {
      siteId: site.id,
      profile: site.deploymentProfile,
      usedBytes: usage,
      quotaBytes: this.quotaBytes(site.deploymentProfile),
      remainingBytes: Math.max(this.quotaBytes(site.deploymentProfile) - usage, 0)
    };
  }

  async createExternalMedia(input: CreateExternalMediaInput) {
    const site = await this.getDefaultSite();
    await this.assertQuota(site, input.sizeBytes ?? 0);

    return this.prisma.mediaAsset.create({
      data: {
        siteId: site.id,
        kind: input.kind ?? (input.mimeType ? inferKind(input.mimeType) : "OTHER"),
        storageKey: input.storageKey,
        url: input.url,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        width: input.width,
        height: input.height,
        altText: input.altText
      }
    });
  }

  async createSignedUpload(input: SignedUploadInput) {
    this.assertStorageEnabled();
    this.assertUploadSize(input.sizeBytes);

    const site = await this.getDefaultSite();
    await this.assertQuota(site, input.sizeBytes);

    const storageKey = this.createStorageKey(site.slug, input.filename);
    const upload = await this.storage.createUploadUrl(storageKey, input.mimeType);

    return {
      storageKey,
      method: upload.method,
      uploadUrl: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt,
      publicUrl: this.storage.publicUrl(storageKey)
    };
  }

  async completeSignedUpload(input: CompleteSignedUploadInput) {
    this.assertStorageEnabled();

    const site = await this.getDefaultSite();
    this.assertSiteStorageKey(site.slug, input.storageKey);

    const objectMetadata = await this.storage.headObject(input.storageKey);
    const sizeBytes = objectMetadata.sizeBytes ?? input.sizeBytes;
    this.assertUploadSize(sizeBytes);
    await this.assertQuota(site, sizeBytes);

    const mimeType = objectMetadata.mimeType ?? input.mimeType;
    const kind = input.kind ?? inferKind(mimeType);
    const uploadedKeys = [input.storageKey];

    try {
      const body = kind === "IMAGE" ? await this.storage.getObject(input.storageKey) : undefined;
      const imageMetadata = body ? extractImageMetadata(body, normalizedMimeType(mimeType)) : {};
      const width = input.width ?? imageMetadata.width;
      const height = input.height ?? imageMetadata.height;
      const variantPlan = this.createImageVariantPlan(input.storageKey, {
        kind,
        width,
        height,
        mimeType
      });
      const variants = body ? await this.generateImageVariants(body, mimeType, variantPlan) : variantPlan;
      uploadedKeys.push(...this.readyVariantStorageKeys(variants));

      const totalIncomingBytes = sizeBytes + collectVariantSizeBytes(variants);
      if (totalIncomingBytes > sizeBytes) {
        await this.assertQuota(site, totalIncomingBytes);
      }

      return await this.prisma.mediaAsset.create({
        data: {
          siteId: site.id,
          kind,
          storageKey: input.storageKey,
          originalFilename: input.filename,
          url: this.storage.publicUrl(input.storageKey),
          mimeType,
          sizeBytes,
          width,
          height,
          variants: variants.length > 0 ? (variants as Prisma.InputJsonValue) : undefined,
          altText: input.altText
        }
      });
    } catch (error) {
      await this.deleteStorageKeys(uploadedKeys);
      throw error;
    }
  }

  async uploadMedia(input: DirectUploadInput) {
    this.assertStorageEnabled();

    const body = decodeBase64(input.dataBase64);
    this.assertUploadSize(body.byteLength);

    const site = await this.getDefaultSite();
    await this.assertQuota(site, body.byteLength);

    const kind = input.kind ?? inferKind(input.mimeType);
    const storageKey = this.createStorageKey(site.slug, input.filename);
    const uploadedKeys = [storageKey];
    const imageMetadata = kind === "IMAGE" ? extractImageMetadata(body, normalizedMimeType(input.mimeType)) : {};
    const variantPlan = this.createImageVariantPlan(storageKey, {
      kind,
      width: imageMetadata.width,
      height: imageMetadata.height,
      mimeType: input.mimeType
    });

    try {
      await this.storage.putObject(storageKey, body, input.mimeType);

      const variants = await this.generateImageVariants(body, input.mimeType, variantPlan);
      uploadedKeys.push(...this.readyVariantStorageKeys(variants));

      const totalIncomingBytes = body.byteLength + collectVariantSizeBytes(variants);
      if (totalIncomingBytes > body.byteLength) {
        await this.assertQuota(site, totalIncomingBytes);
      }

      return await this.prisma.mediaAsset.create({
        data: {
          siteId: site.id,
          kind,
          storageKey,
          originalFilename: input.filename,
          checksumSha256: checksumSha256(body),
          url: this.storage.publicUrl(storageKey),
          mimeType: input.mimeType,
          sizeBytes: body.byteLength,
          width: imageMetadata.width,
          height: imageMetadata.height,
          variants: variants.length > 0 ? (variants as Prisma.InputJsonValue) : undefined,
          altText: input.altText
        }
      });
    } catch (error) {
      await this.deleteStorageKeys(uploadedKeys);
      throw error;
    }
  }

  async createSignedDownload(assetId: string) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        deletedAt: null
      }
    });

    if (!asset) {
      throw new AppError(404, "media_asset_not_found", "Media asset not found.");
    }

    if (!asset.storageKey) {
      return {
        downloadUrl: asset.url,
        expiresAt: null
      };
    }

    this.assertStorageEnabled();
    const signedDownload = await this.storage.createDownloadUrl(asset.storageKey);

    return {
      downloadUrl: signedDownload.url,
      expiresAt: signedDownload.expiresAt
    };
  }

  async deleteMediaAsset(assetId: string, force = false) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        deletedAt: null
      },
      include: {
        _count: {
          select: {
            blocks: true
          }
        }
      }
    });

    if (!asset) {
      throw new AppError(404, "media_asset_not_found", "Media asset not found.");
    }

    if (asset._count.blocks > 0 && !force) {
      throw new AppError(409, "media_asset_in_use", "Media asset is still used by content blocks.");
    }

    await this.deleteStoredObjects(asset);
    await this.prisma.mediaAsset.delete({
      where: {
        id: asset.id
      }
    });

    return { deleted: true };
  }

  async cleanupOrphanMedia(input: CleanupInput = {}) {
    const limit = input.limit ?? 50;
    const olderThanDays = input.olderThanDays ?? 1;
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        deletedAt: null,
        createdAt: {
          lt: cutoff
        },
        blocks: {
          none: {}
        }
      },
      orderBy: {
        createdAt: "asc"
      },
      take: limit
    });

    if (input.dryRun ?? true) {
      return {
        deleted: false,
        count: assets.length,
        assets
      };
    }

    for (const asset of assets) {
      await this.deleteStoredObjects(asset);
      await this.prisma.mediaAsset.delete({
        where: {
          id: asset.id
        }
      });
    }

    return {
      deleted: true,
      count: assets.length,
      assets
    };
  }

  private async getDefaultSite(): Promise<SiteRecord> {
    return this.prisma.site.upsert({
      where: {
        slug: "default"
      },
      update: {},
      create: {
        slug: "default",
        name: this.config.app.name,
        deploymentProfile: this.config.app.mode
      },
      select: {
        id: true,
        slug: true,
        deploymentProfile: true
      }
    });
  }

  private createStorageKey(siteSlug: string, filename: string) {
    const safeFilename = sanitizeFilename(filename);
    const id = randomBytes(10).toString("hex");
    const month = new Date().toISOString().slice(0, 7);

    return [this.mediaStoragePrefix(siteSlug), month, `${id}-${safeFilename}`]
      .filter(Boolean)
      .join("/");
  }

  private assertSiteStorageKey(siteSlug: string, storageKey: string) {
    const expectedPrefix = this.mediaStoragePrefix(siteSlug);

    if (!storageKey.startsWith(`${expectedPrefix}/`)) {
      throw new AppError(422, "invalid_storage_key", "Storage key does not belong to this site.");
    }
  }

  private mediaStoragePrefix(siteSlug: string) {
    const prefix = normalizeKeyPrefix(this.config.storage.keyPrefix);

    if (prefix) return [prefix, "media"].join("/");

    return ["sites", siteSlug, "media"].join("/");
  }

  private assertStorageEnabled() {
    if (!this.storage.enabled) {
      throw new AppError(503, "storage_not_configured", "Storage is not configured.");
    }
  }

  private assertUploadSize(sizeBytes: number) {
    if (sizeBytes <= 0) {
      throw new AppError(422, "invalid_upload", "Uploaded file is empty.");
    }

    if (sizeBytes > this.config.storage.maxUploadBytes) {
      throw new AppError(413, "upload_too_large", "Uploaded file exceeds the configured limit.", {
        maxUploadBytes: this.config.storage.maxUploadBytes
      });
    }
  }

  private async assertQuota(site: SiteRecord, incomingBytes: number) {
    const quotaBytes = this.quotaBytes(site.deploymentProfile);
    const usedBytes = await this.currentUsage(site.id);

    if (usedBytes + incomingBytes > quotaBytes) {
      throw new AppError(413, "storage_quota_exceeded", "Storage quota exceeded.", {
        usedBytes,
        incomingBytes,
        quotaBytes
      });
    }
  }

  private async currentUsage(siteId: string) {
    const assets: Array<{ sizeBytes: number | null; variants: Prisma.JsonValue | null }> =
      await this.prisma.mediaAsset.findMany({
        where: {
          siteId,
          deletedAt: null
        },
        select: {
          sizeBytes: true,
          variants: true
        }
      });

    return assets.reduce((total: number, asset) => {
      return total + (asset.sizeBytes ?? 0) + collectVariantSizeBytes(asset.variants);
    }, 0);
  }

  private quotaBytes(profile: string) {
    const quotas = this.config.storage.quotaBytes;
    if (profile === "presentation") return quotas.presentation;
    if (profile === "cms") return quotas.cms;
    if (profile === "shop") return quotas.shop;
    if (profile === "saas") return quotas.saas;
    return quotas.default;
  }

  private createImageVariantPlan(
    storageKey: string,
    input: { kind: MediaKind; width?: number; height?: number; mimeType?: string }
  ): ImageVariant[] {
    if (input.kind !== "IMAGE" || !input.width || !input.height) return [];
    if (!imageVariantMimeType(input.mimeType)) return [];

    return this.config.storage.imageVariantWidths
      .filter((width) => width < input.width!)
      .map((width) => ({
        name: `w${width}`,
        width,
        height: Math.round((input.height! / input.width!) * width),
        storageKey: storageKey.replace(/([^/.]+)(\.[^/.]+)?$/, `$1-w${width}$2`),
        status: "PENDING"
      }));
  }

  private async generateImageVariants(body: Buffer, mimeType: string | undefined, variants: ImageVariant[]) {
    const outputMimeType = imageVariantMimeType(mimeType);
    if (!outputMimeType) return variants;

    const format = imageVariantFormat(outputMimeType);

    return Promise.all(
      variants.map(async (variant): Promise<ImageVariant> => {
        try {
          const variantBody = await sharp(body)
            .rotate()
            .resize({ width: variant.width, withoutEnlargement: true })
            .toFormat(format)
            .toBuffer();

          await this.storage.putObject(variant.storageKey, variantBody, outputMimeType);

          return {
            ...variant,
            status: "READY",
            url: this.storage.publicUrl(variant.storageKey),
            mimeType: outputMimeType,
            sizeBytes: variantBody.byteLength
          };
        } catch (error) {
          return {
            ...variant,
            status: "FAILED",
            error: errorMessage(error)
          };
        }
      })
    );
  }

  private readyVariantStorageKeys(variants: ImageVariant[]) {
    return variants
      .filter((variant) => variant.status === "READY")
      .map((variant) => variant.storageKey);
  }

  private async deleteStoredObjects(asset: { storageKey: string | null; variants?: Prisma.JsonValue | null }) {
    if (!asset.storageKey) return;

    this.assertStorageEnabled();
    const storageKeys = [asset.storageKey, ...collectVariantStorageKeys(asset.variants)];

    await this.deleteStorageKeys(storageKeys);
  }

  private async deleteStorageKeys(storageKeys: string[]) {
    for (const storageKey of storageKeys) {
      await this.storage.deleteObject(storageKey);
    }
  }
}
