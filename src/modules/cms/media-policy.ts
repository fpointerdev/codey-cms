import { extname } from "node:path";
import { AppError } from "../../core/errors/app-error.js";

export type AllowedMediaKind = "DOCUMENT" | "IMAGE" | "OTHER" | "VIDEO";

type MediaPolicy = {
  mimeType: string;
  kind: AllowedMediaKind;
  extensions: string[];
  matches: (body: Buffer) => boolean;
};

function isSelfContainedGlb(body: Buffer) {
  if (
    body.length < 20 ||
    body.subarray(0, 4).toString("ascii") !== "glTF" ||
    body.readUInt32LE(4) !== 2 ||
    body.readUInt32LE(8) !== body.length
  ) {
    return false;
  }

  try {
    let offset = 12;
    let document: Record<string, unknown> | null = null;
    let binaryLength = 0;

    while (offset < body.length) {
      if (offset + 8 > body.length) return false;
      const chunkLength = body.readUInt32LE(offset);
      const chunkType = body.readUInt32LE(offset + 4);
      const chunkEnd = offset + 8 + chunkLength;
      if (chunkLength % 4 !== 0 || chunkEnd > body.length) return false;

      if (offset === 12 && chunkType !== 0x4e4f534a) return false;
      if (chunkType === 0x4e4f534a) {
        if (document || chunkLength < 2) return false;
        const value: unknown = JSON.parse(body.subarray(offset + 8, chunkEnd).toString("utf8").trim());
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        document = value as Record<string, unknown>;
      } else if (chunkType === 0x004e4942) {
        if (binaryLength > 0) return false;
        binaryLength = chunkLength;
      }

      offset = chunkEnd;
    }

    if (!document || offset !== body.length) return false;
    const asset = document.asset;
    if (
      !asset ||
      typeof asset !== "object" ||
      Array.isArray(asset) ||
      (asset as Record<string, unknown>).version !== "2.0"
    ) return false;

    const hasExternalUri = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(hasExternalUri);
      if (!value || typeof value !== "object") return false;

      return Object.entries(value).some(([key, item]) => (
        (key === "uri" && typeof item === "string") || hasExternalUri(item)
      ));
    };

    const buffers = Array.isArray(document.buffers) ? document.buffers : [];
    if (buffers.length > 1) return false;
    if (buffers.length === 1) {
      const buffer = buffers[0];
      if (!buffer || typeof buffer !== "object" || Array.isArray(buffer)) return false;
      const byteLength = buffer.byteLength;
      if (!Number.isInteger(byteLength) || Number(byteLength) < 0 || Number(byteLength) > binaryLength) return false;
    }

    return !hasExternalUri(document);
  } catch {
    return false;
  }
}

const policies: MediaPolicy[] = [
  {
    mimeType: "image/jpeg",
    kind: "IMAGE",
    extensions: [".jpg", ".jpeg"],
    matches: (body) => body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
  },
  {
    mimeType: "image/png",
    kind: "IMAGE",
    extensions: [".png"],
    matches: (body) => body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  {
    mimeType: "image/gif",
    kind: "IMAGE",
    extensions: [".gif"],
    matches: (body) => ["GIF87a", "GIF89a"].includes(body.subarray(0, 6).toString("ascii"))
  },
  {
    mimeType: "image/webp",
    kind: "IMAGE",
    extensions: [".webp"],
    matches: (body) => body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP"
  },
  {
    mimeType: "image/avif",
    kind: "IMAGE",
    extensions: [".avif"],
    matches: (body) => isIsoMedia(body, ["avif", "avis"])
  },
  {
    mimeType: "video/mp4",
    kind: "VIDEO",
    extensions: [".mp4", ".m4v"],
    matches: (body) => isIsoMedia(body, ["avc1", "iso2", "isom", "M4V ", "mp41", "mp42"])
  },
  {
    mimeType: "video/webm",
    kind: "VIDEO",
    extensions: [".webm"],
    matches: (body) => body.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  },
  {
    mimeType: "application/pdf",
    kind: "DOCUMENT",
    extensions: [".pdf"],
    matches: (body) => body.subarray(0, 5).toString("ascii") === "%PDF-"
  },
  {
    mimeType: "model/gltf-binary",
    kind: "OTHER",
    extensions: [".glb"],
    matches: isSelfContainedGlb
  }
];

function isIsoMedia(body: Buffer, compatibleBrands: string[]) {
  if (body.length < 12 || body.subarray(4, 8).toString("ascii") !== "ftyp") return false;

  const brands = [body.subarray(8, 12).toString("ascii")];
  for (let offset = 16; offset + 4 <= Math.min(body.length, 64); offset += 4) {
    brands.push(body.subarray(offset, offset + 4).toString("ascii"));
  }

  return brands.some((brand) => compatibleBrands.includes(brand));
}

export function normalizeMediaMimeType(value: string) {
  return value.split(";")[0]?.trim().toLowerCase();
}

export function mediaPolicyForMimeType(mimeType: string) {
  const normalized = normalizeMediaMimeType(mimeType);
  return policies.find((policy) => policy.mimeType === normalized);
}

export function mediaPolicyForStorageKey(storageKey: string) {
  const extension = extname(storageKey).toLowerCase();
  return policies.find((policy) => policy.extensions.includes(extension));
}

export function assertAllowedMediaDeclaration(
  filename: string,
  mimeType: string,
  requestedKind?: string
) {
  const policy = mediaPolicyForMimeType(mimeType);
  if (!policy) {
    throw new AppError(
      422,
      "unsupported_media_type",
      "File type is not supported. Use JPEG, PNG, GIF, WebP, AVIF, MP4, WebM, PDF, or GLB."
    );
  }

  const extension = extname(filename).toLowerCase();
  if (!policy.extensions.includes(extension)) {
    throw new AppError(422, "media_extension_mismatch", "Filename extension does not match the declared file type.");
  }

  if (requestedKind && requestedKind !== policy.kind) {
    throw new AppError(422, "media_kind_mismatch", "Media kind does not match the uploaded file type.");
  }

  return policy;
}

export function inspectMediaFile(
  filename: string,
  mimeType: string,
  body: Buffer,
  requestedKind?: string
) {
  const policy = assertAllowedMediaDeclaration(filename, mimeType, requestedKind);
  if (!policy.matches(body)) {
    throw new AppError(422, "media_signature_mismatch", "File contents do not match the declared file type.");
  }

  return policy;
}

export function publicMediaResponsePolicy(storageKey: string) {
  const policy = mediaPolicyForStorageKey(storageKey);
  if (!policy) return null;

  return {
    mimeType: policy.mimeType,
    disposition: policy.kind === "DOCUMENT" ? "attachment" as const : "inline" as const
  };
}
