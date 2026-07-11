import sharp from "sharp";

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

export async function optimizeImageBuffer(
  input: Buffer,
  options: { maxWidth?: number; quality?: number } = {}
): Promise<OptimizedImage> {
  const maxWidth = options.maxWidth ?? defaultMaxImageWidth;
  const quality = options.quality ?? defaultImageQuality;
  const metadata = await sharp(input, { failOn: "none" }).metadata();
  const resizeWidth = metadata.width && metadata.width > maxWidth ? maxWidth : undefined;
  let pipeline = sharp(input, { failOn: "none" }).rotate();

  if (resizeWidth) {
    pipeline = pipeline.resize({ width: resizeWidth, withoutEnlargement: true });
  }

  const body = await pipeline.webp({ quality, effort: 4 }).toBuffer();
  const optimizedMetadata = await sharp(body, { failOn: "none" }).metadata();

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
  options: { maxWidth?: number; quality?: number } = {}
) {
  if (!isOptimizableImageMimeType(mimeType)) return null;

  try {
    return await optimizeImageBuffer(input, options);
  } catch {
    return null;
  }
}
