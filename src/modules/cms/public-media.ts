import type { Prisma } from "@prisma/client";

type PublicMediaAsset = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  variants: Prisma.JsonValue | null;
  altText: string | null;
};

type PublicMediaDatabase = {
  mediaAsset: {
    findMany(args: {
      where: {
        deletedAt: null;
        OR: Array<{ id: { in: string[] } } | { url: { in: string[] } }>;
      };
      select: {
        id: true;
        url: true;
        width: true;
        height: true;
        variants: true;
        altText: true;
      };
    }): Promise<PublicMediaAsset[]>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function collectReferences(value: unknown, ids: Set<string>, urls: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferences(item, ids, urls));
    return;
  }
  if (!isRecord(value)) return;

  if (typeof value.mediaAssetId === "string" && value.mediaAssetId) ids.add(value.mediaAssetId);
  for (const key of ["url", "src"] as const) {
    if (typeof value[key] === "string" && value[key]) urls.add(value[key]);
  }
  Object.values(value).forEach((item) => collectReferences(item, ids, urls));
}

function mediaMetadata(asset: PublicMediaAsset) {
  return {
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
    ...(asset.variants ? { variants: asset.variants } : {})
  };
}

function enrichRecord(
  source: Record<string, unknown>,
  byId: ReadonlyMap<string, PublicMediaAsset>,
  byUrl: ReadonlyMap<string, PublicMediaAsset>
) {
  const enriched = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, enrichValue(value, byId, byUrl)])
  );
  const mediaAssetId = typeof enriched.mediaAssetId === "string" ? enriched.mediaAssetId : "";
  const mediaUrl = typeof enriched.url === "string"
    ? enriched.url
    : typeof enriched.src === "string"
      ? enriched.src
      : "";
  const directAsset = isRecord(enriched.mediaAsset) ? enriched.mediaAsset as unknown as PublicMediaAsset : null;
  const asset = byId.get(mediaAssetId) || byUrl.get(mediaUrl) || directAsset;
  if (!asset) return enriched;

  const result: Record<string, unknown> = {
    ...mediaMetadata(asset),
    ...enriched
  };
  if (!result.alt && !result.altText && asset.altText) result.alt = asset.altText;

  if (isRecord(result.value) && (source.mediaAssetId || source.mediaAsset)) {
    result.value = {
      ...mediaMetadata(asset),
      ...(asset.altText ? { alt: asset.altText } : {}),
      ...result.value
    };
  }

  return result;
}

function enrichValue(
  value: unknown,
  byId: ReadonlyMap<string, PublicMediaAsset>,
  byUrl: ReadonlyMap<string, PublicMediaAsset>
): unknown {
  if (Array.isArray(value)) return value.map((item) => enrichValue(item, byId, byUrl));
  if (!isRecord(value)) return value;
  return enrichRecord(value, byId, byUrl);
}

export async function enrichPublicMedia<T>(database: PublicMediaDatabase, value: T): Promise<T> {
  const ids = new Set<string>();
  const urls = new Set<string>();
  collectReferences(value, ids, urls);
  if (!ids.size && !urls.size) return value;

  const OR: Array<{ id: { in: string[] } } | { url: { in: string[] } }> = [];
  if (ids.size) OR.push({ id: { in: [...ids] } });
  if (urls.size) OR.push({ url: { in: [...urls] } });
  const assets = await database.mediaAsset.findMany({
    where: { deletedAt: null, OR },
    select: {
      id: true,
      url: true,
      width: true,
      height: true,
      variants: true,
      altText: true
    }
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const byUrl = new Map(assets.map((asset) => [asset.url, asset]));

  return enrichValue(value, byId, byUrl) as T;
}
