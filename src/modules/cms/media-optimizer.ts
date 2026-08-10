import sharp from "sharp";
import { AppError } from "../../core/errors/app-error.js";

export const optimizedImageMimeType = "image/webp";

const defaultMaxImageWidth = 1800;
const defaultImageQuality = 78;
const optimizableImageMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const optimizableImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export type OptimizedImage = {
  body: Buffer;
  mimeType: typeof optimizedImageMimeType;
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
};

export type MediaProcessingLimits = {
  maxPixels: number;
  maxWidth: number;
  maxHeight: number;
  maxFrames: number;
};

export type InspectedImage = {
  width: number;
  height: number;
  frames: number;
  decodedPixels: number;
};

type PendingTask<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export class MediaProcessingQueue {
  private active = 0;
  private readonly pending: Array<PendingTask<unknown>> = [];

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("Media processing concurrency must be a positive integer.");
    }
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ task, resolve, reject } as PendingTask<unknown>);
      this.drain();
    });
  }

  private drain() {
    while (this.active < this.concurrency) {
      const pending = this.pending.shift();
      if (!pending) return;

      this.active += 1;
      void pending.task()
        .then(pending.resolve, pending.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

function normalizeMimeType(mimeType = "") {
  return mimeType.split(";")[0]?.trim().toLowerCase() || "";
}

function splitExtension(value: string) {
  const slashIndex = value.lastIndexOf("/");
  const dotIndex = value.lastIndexOf(".");

  if (dotIndex <= slashIndex) {
    return { base: value, extension: "" };
  }

  return {
    base: value.slice(0, dotIndex),
    extension: value.slice(dotIndex).toLowerCase()
  };
}

export function isOptimizableImageMimeType(mimeType = "") {
  return optimizableImageMimeTypes.has(normalizeMimeType(mimeType));
}

export function isOptimizableImageKey(key = "") {
  const cleanKey = key.split("?")[0] || "";
  const { base, extension } = splitExtension(cleanKey);

  if (!optimizableImageExtensions.has(extension)) return false;
  return !/-w\d+$/.test(base) && !/-optimized$/.test(base);
}

export function optimizedImageStorageKey(storageKey: string, width?: number) {
  const { base } = splitExtension(storageKey);
  const suffix = width ? `-w${width}` : "-optimized";

  return `${base}${suffix}.webp`;
}

export function requestedImageWidth(value: unknown, allowedWidths: number[] = []) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const width = Number(rawValue);

  if (!Number.isInteger(width)) return undefined;
  if (width < 160 || width > 2400) return undefined;
  if (allowedWidths.length > 0 && !allowedWidths.includes(width)) return undefined;

  return width;
}

export async function inspectImageBuffer(
  input: Buffer,
  limits: MediaProcessingLimits
): Promise<InspectedImage> {
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(input, {
      animated: true,
      failOn: "error",
      limitInputPixels: limits.maxPixels
    }).metadata();
  } catch {
    throw new AppError(
      422,
      "media_image_invalid",
      "Image could not be decoded within the configured processing limits."
    );
  }

  const width = metadata.width ?? 0;
  const frames = metadata.pages ?? 1;
  const height = metadata.pageHeight ?? metadata.height ?? 0;
  const decodedPixels = width * height * frames;
  if (
    width <= 0 ||
    height <= 0 ||
    width > limits.maxWidth ||
    height > limits.maxHeight ||
    frames > limits.maxFrames ||
    decodedPixels > limits.maxPixels
  ) {
    throw new AppError(422, "media_image_limits_exceeded", "Image dimensions or frame count exceed the configured limits.", {
      maxPixels: limits.maxPixels,
      maxWidth: limits.maxWidth,
      maxHeight: limits.maxHeight,
      maxFrames: limits.maxFrames
    });
  }

  return { width, height, frames, decodedPixels };
}

export async function optimizeImageBuffer(
  input: Buffer,
  options: { maxWidth?: number; quality?: number; limits?: MediaProcessingLimits } = {}
): Promise<OptimizedImage> {
  const maxWidth = options.maxWidth ?? defaultMaxImageWidth;
  const quality = options.quality ?? defaultImageQuality;
  const limits = options.limits ?? {
    maxPixels: 40_000_000,
    maxWidth: 12_000,
    maxHeight: 12_000,
    maxFrames: 100
  };
  const metadata = await inspectImageBuffer(input, limits);
  const resizeWidth = metadata.width && metadata.width > maxWidth ? maxWidth : undefined;
  let pipeline = sharp(input, { failOn: "error", limitInputPixels: limits.maxPixels }).rotate();

  if (resizeWidth) {
    pipeline = pipeline.resize({ width: resizeWidth, withoutEnlargement: true });
  }

  const body = await pipeline.webp({ quality, effort: 4 }).toBuffer();
  const optimizedMetadata = await sharp(body, {
    failOn: "error",
    limitInputPixels: limits.maxPixels
  }).metadata();

  return {
    body,
    mimeType: optimizedImageMimeType,
    width: optimizedMetadata.width,
    height: optimizedMetadata.height,
    originalWidth: metadata.width,
    originalHeight: metadata.height
  };
}

export async function tryOptimizeImageBuffer(
  input: Buffer,
  mimeType: string,
  options: { maxWidth?: number; quality?: number; limits?: MediaProcessingLimits } = {}
) {
  if (!isOptimizableImageMimeType(mimeType)) return null;

  try {
    return await optimizeImageBuffer(input, options);
  } catch {
    return null;
  }
}
