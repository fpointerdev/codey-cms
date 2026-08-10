import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import sharp from "sharp";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import { createStorageAdapter } from "../../infrastructure/storage/s3-storage.js";
import type { StorageAdapter } from "../../infrastructure/storage/storage.types.js";
import {
  inspectImageBuffer,
  isOptimizableImageMimeType,
  MediaProcessingQueue,
  optimizedImageMimeType,
  optimizedImageStorageKey
} from "./media-optimizer.js";
import {
  assertAllowedMediaDeclaration,
  inspectMediaFile,
  normalizeMediaMimeType
} from "./media-policy.js";

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

type MediaUsageAsset = {
  id: string;
  url: string;
  storageKey: string | null;
};

type ProductImageUsageReader = {
  findMany: (args: {
    select: { mediaAssetId: true; url: true };
  }) => Promise<Array<{ mediaAssetId: string | null; url: string }>>;
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Image variant generation failed.";
}

export function containsMediaReference(value: unknown, references: ReadonlySet<string>): boolean {
  if (typeof value === "string") return references.has(value);
  if (Array.isArray(value)) return value.some((item) => containsMediaReference(item, references));
  if (!value || typeof value !== "object") return false;

  return Object.values(value).some((item) => containsMediaReference(item, references));
}

export class MediaService {
  private readonly processingQueue: MediaProcessingQueue;

  constructor(
    private readonly prisma: MediaDatabase,
    private readonly config: AppConfig,
    private readonly storage: StorageAdapter = createStorageAdapter(config.storage)
  ) {
    this.processingQueue = new MediaProcessingQueue(config.media.processingConcurrency);
  }

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
    const url = new URL(input.url);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new AppError(422, "invalid_media_url", "External media URL must use HTTP or HTTPS.");
    }

    const filename = url.pathname.split("/").filter(Boolean).at(-1) ?? "external-media";
    const declaredMedia = input.mimeType
      ? assertAllowedMediaDeclaration(filename, input.mimeType, input.kind)
      : null;
    const kind = declaredMedia?.kind ?? input.kind;
    if (!kind || kind === "OTHER") {
      throw new AppError(422, "unsupported_media_type", "External media must be an image, video, or PDF document.");
    }

    const site = await this.getDefaultSite();
    return this.createAssetWithinQuota(
      site,
      input.sizeBytes ?? 0,
      {
        siteId: site.id,
        kind,
        storageKey: input.storageKey,
        url: input.url,
        mimeType: declaredMedia?.mimeType,
        sizeBytes: input.sizeBytes,
        width: input.width,
        height: input.height,
        altText: input.altText
      }
    );
  }

  async createSignedUpload(input: SignedUploadInput) {
    this.assertStorageEnabled();
    this.assertUploadSize(input.sizeBytes);
    const media = assertAllowedMediaDeclaration(input.filename, input.mimeType, input.kind);

    const site = await this.getDefaultSite();
    await this.assertQuota(site, input.sizeBytes);

    const storageKey = this.createStorageKey(site.slug, input.filename);
    const upload = await this.storage.createUploadUrl(storageKey, media.mimeType);

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
    const uploadedKeys = [input.storageKey];

    try {
      const declaredMedia = assertAllowedMediaDeclaration(input.filename, input.mimeType, input.kind);
      const objectMetadata = await this.storage.headObject(input.storageKey);
      const sizeBytes = objectMetadata.sizeBytes ?? input.sizeBytes;
      this.assertUploadSize(sizeBytes);
      await this.assertQuota(site, sizeBytes);

      const storedMimeType = objectMetadata.mimeType
        ? normalizeMediaMimeType(objectMetadata.mimeType)
        : declaredMedia.mimeType;
      if (storedMimeType !== declaredMedia.mimeType) {
        throw new AppError(422, "media_type_mismatch", "Stored file type does not match the upload request.");
      }

      const body = await this.storage.getObject(input.storageKey);
      const media = inspectMediaFile(input.filename, declaredMedia.mimeType, body, input.kind);
      const imageMetadata = media.kind === "IMAGE"
        ? await inspectImageBuffer(body, this.config.media)
        : null;
      const width = imageMetadata?.width ?? input.width;
      const height = imageMetadata?.height ?? input.height;
      const variantPlan = this.createImageVariantPlan(input.storageKey, {
        kind: media.kind,
        width,
        height,
        mimeType: media.mimeType
      });
      const variants = await this.generateImageVariants(body, media.mimeType, variantPlan);
      uploadedKeys.push(...this.readyVariantStorageKeys(variants));

      const totalIncomingBytes = sizeBytes + collectVariantSizeBytes(variants);
      if (totalIncomingBytes > sizeBytes) {
        await this.assertQuota(site, totalIncomingBytes);
      }

      return await this.createAssetWithinQuota(
        site,
        totalIncomingBytes,
        {
          siteId: site.id,
          kind: media.kind,
          storageKey: input.storageKey,
          originalFilename: input.filename,
          url: this.storage.publicUrl(input.storageKey),
          mimeType: media.mimeType,
          sizeBytes,
          width,
          height,
          variants: variants.length > 0 ? variants : undefined,
          altText: input.altText
        }
      );
    } catch (error) {
      await this.deleteStorageKeys(uploadedKeys);
      throw error;
    }
  }

  async uploadMedia(input: DirectUploadInput) {
    this.assertStorageEnabled();

    const body = decodeBase64(input.dataBase64);
    this.assertUploadSize(body.byteLength);
    const media = inspectMediaFile(input.filename, input.mimeType, body, input.kind);

    const site = await this.getDefaultSite();
    await this.assertQuota(site, body.byteLength);

    const storageKey = this.createStorageKey(site.slug, input.filename);
    const uploadedKeys = [storageKey];
    const imageMetadata = media.kind === "IMAGE"
      ? await inspectImageBuffer(body, this.config.media)
      : null;
    const variantPlan = this.createImageVariantPlan(storageKey, {
      kind: media.kind,
      width: imageMetadata?.width,
      height: imageMetadata?.height,
      mimeType: media.mimeType
    });

    try {
      await this.storage.putObject(storageKey, body, media.mimeType);

      const variants = await this.generateImageVariants(body, media.mimeType, variantPlan);
      uploadedKeys.push(...this.readyVariantStorageKeys(variants));

      const totalIncomingBytes = body.byteLength + collectVariantSizeBytes(variants);
      if (totalIncomingBytes > body.byteLength) {
        await this.assertQuota(site, totalIncomingBytes);
      }

      return await this.createAssetWithinQuota(
        site,
        totalIncomingBytes,
        {
          siteId: site.id,
          kind: media.kind,
          storageKey,
          originalFilename: input.filename,
          checksumSha256: checksumSha256(body),
          url: this.storage.publicUrl(storageKey),
          mimeType: media.mimeType,
          sizeBytes: body.byteLength,
          width: imageMetadata?.width,
          height: imageMetadata?.height,
          variants: variants.length > 0 ? variants : undefined,
          altText: input.altText
        }
      );
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

    if (!force) {
      const usedAssetIds = asset._count.blocks > 0
        ? new Set([asset.id])
        : await this.findUsedMediaAssetIds([asset]);

      if (usedAssetIds.has(asset.id)) {
        throw new AppError(409, "media_asset_in_use", "Media asset is still used by content or products.");
      }
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
    const assets: Prisma.MediaAssetGetPayload<{}>[] = [];
    const batchSize = Math.max(limit, 50);
    let cursorId: string | undefined;

    while (assets.length < limit) {
      const candidates = await this.prisma.mediaAsset.findMany({
        where: {
          deletedAt: null,
          createdAt: {
            lt: cutoff
          },
          blocks: {
            none: {}
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: batchSize,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
      });
      if (candidates.length === 0) break;

      const usedAssetIds = await this.findUsedMediaAssetIds(candidates);
      assets.push(...candidates.filter((asset) => !usedAssetIds.has(asset.id)));
      cursorId = candidates.at(-1)?.id;
      if (candidates.length < batchSize) break;
    }

    assets.splice(limit);

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

    this.assertQuotaAvailable(usedBytes, incomingBytes, quotaBytes);
  }

  private assertQuotaAvailable(usedBytes: number, incomingBytes: number, quotaBytes: number) {
    if (usedBytes + incomingBytes > quotaBytes) {
      throw new AppError(413, "storage_quota_exceeded", "Storage quota exceeded.", {
        usedBytes,
        incomingBytes,
        quotaBytes
      });
    }
  }

  private async createAssetWithinQuota(
    site: SiteRecord,
    incomingBytes: number,
    data: Prisma.MediaAssetUncheckedCreateInput
  ) {
    return this.withQuotaLock(site.id, async (database) => {
      const quotaBytes = this.quotaBytes(site.deploymentProfile);
      const usedBytes = await this.currentUsage(site.id, database);
      this.assertQuotaAvailable(usedBytes, incomingBytes, quotaBytes);

      return database.mediaAsset.create({ data });
    });
  }

  private async withQuotaLock<T>(
    siteId: string,
    operation: (database: MediaDatabase) => Promise<T>
  ): Promise<T> {
    const run = async (database: MediaDatabase) => {
      await database.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`media-quota:${siteId}`}, 0))`
      );
      return operation(database);
    };

    if ("$transaction" in this.prisma) {
      return this.prisma.$transaction((transaction) => run(transaction));
    }

    return run(this.prisma);
  }

  private async currentUsage(siteId: string, database: MediaDatabase = this.prisma) {
    const assets: Array<{ sizeBytes: number | null; variants: Prisma.JsonValue | null }> =
      await database.mediaAsset.findMany({
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
    if (!isOptimizableImageMimeType(input.mimeType)) return [];

    return this.config.storage.imageVariantWidths
      .filter((width) => width <= input.width!)
      .map((width) => ({
        name: `w${width}`,
        width,
        height: Math.round((input.height! / input.width!) * width),
        storageKey: optimizedImageStorageKey(storageKey, width),
        status: "PENDING"
      }));
  }

  private async generateImageVariants(body: Buffer, mimeType: string | undefined, variants: ImageVariant[]) {
    if (!isOptimizableImageMimeType(mimeType)) return variants;

    return Promise.all(
      variants.map((variant) => this.processingQueue.run(async (): Promise<ImageVariant> => {
        try {
          const variantBody = await sharp(body, {
            failOn: "error",
            limitInputPixels: this.config.media.maxPixels
          })
            .rotate()
            .resize({ width: variant.width, withoutEnlargement: true })
            .webp({ quality: 78, effort: 4 })
            .toBuffer();

          await this.storage.putObject(variant.storageKey, variantBody, optimizedImageMimeType);

          return {
            ...variant,
            status: "READY",
            url: this.storage.publicUrl(variant.storageKey),
            mimeType: optimizedImageMimeType,
            sizeBytes: variantBody.byteLength
          };
        } catch (error) {
          return {
            ...variant,
            status: "FAILED",
            error: errorMessage(error)
          };
        }
      }))
    );
  }

  private readyVariantStorageKeys(variants: ImageVariant[]) {
    return variants
      .filter((variant) => variant.status === "READY")
      .map((variant) => variant.storageKey);
  }

  private async findUsedMediaAssetIds(assets: MediaUsageAsset[]) {
    if (assets.length === 0) return new Set<string>();

    const [blocks, sections, productImages] = await Promise.all([
      this.prisma.contentBlock.findMany({
        select: {
          mediaAssetId: true,
          value: true,
          settings: true
        }
      }),
      this.prisma.pageSection.findMany({
        select: {
          settings: true
        }
      }),
      this.listProductImageUsage()
    ]);
    const values: unknown[] = [
      ...blocks.flatMap((block) => [block.mediaAssetId, block.value, block.settings]),
      ...sections.map((section) => section.settings),
      ...productImages.flatMap((image) => [image.mediaAssetId, image.url])
    ];
    const usedAssetIds = new Set<string>();

    for (const asset of assets) {
      const references = new Set(
        [asset.id, asset.url, asset.storageKey].filter((value): value is string => Boolean(value))
      );

      if (values.some((value) => containsMediaReference(value, references))) {
        usedAssetIds.add(asset.id);
      }
    }

    return usedAssetIds;
  }

  private async listProductImageUsage() {
    const productImage = (this.prisma as unknown as { productImage?: ProductImageUsageReader }).productImage;
    if (!productImage) return [];

    try {
      return await productImage.findMany({
        select: {
          mediaAssetId: true,
          url: true
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
        return [];
      }

      throw error;
    }
  }

  private async deleteStoredObjects(asset: { storageKey: string | null; variants?: Prisma.JsonValue | null }) {
    if (!asset.storageKey) return;

    this.assertStorageEnabled();
    const storageKeys = [
      asset.storageKey,
      ...collectVariantStorageKeys(asset.variants),
      optimizedImageStorageKey(asset.storageKey),
      ...this.config.storage.imageVariantWidths.map((width) => optimizedImageStorageKey(asset.storageKey!, width))
    ];

    await this.deleteStorageKeys([...new Set(storageKeys)]);
  }

  private async deleteStorageKeys(storageKeys: string[]) {
    for (const storageKey of storageKeys) {
      await this.storage.deleteObject(storageKey);
    }
  }
}
