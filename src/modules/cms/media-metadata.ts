export type ImageMetadata = {
  width?: number;
  height?: number;
};

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

function readUInt24LE(buffer: Buffer, offset: number) {
  return buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16);
}

function readPngDimensions(buffer: Buffer): ImageMetadata {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(pngSignature)) return {};

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function readJpegDimensions(buffer: Buffer): ImageMetadata {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return {};

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return {};
    if (offset + 4 > buffer.length) return {};

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);

    if (jpegStartOfFrameMarkers.has(marker) && offset + 8 < buffer.length) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }

    offset += 2 + length;
  }

  return {};
}

function readWebpDimensions(buffer: Buffer): ImageMetadata {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return {};
  }

  const chunkType = buffer.toString("ascii", 12, 16);

  if (chunkType === "VP8X" && buffer.length >= 30) {
    return {
      width: readUInt24LE(buffer, 24) + 1,
      height: readUInt24LE(buffer, 27) + 1
    };
  }

  if (chunkType === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }

  if (chunkType === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);

    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }

  return {};
}

export function extractImageMetadata(buffer: Buffer, mimeType?: string): ImageMetadata {
  if (mimeType === "image/png") return readPngDimensions(buffer);
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return readJpegDimensions(buffer);
  if (mimeType === "image/webp") return readWebpDimensions(buffer);

  return {
    ...readPngDimensions(buffer),
    ...readJpegDimensions(buffer),
    ...readWebpDimensions(buffer)
  };
}
