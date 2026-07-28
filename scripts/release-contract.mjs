import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify
} from "node:crypto";
import { createReadStream } from "node:fs";

export const releaseSchemaVersion = 1;

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function assertReleasePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Release payload must be an object.");
  }
  if (payload.schemaVersion !== releaseSchemaVersion) {
    throw new Error(`Unsupported release schema version: ${payload.schemaVersion}.`);
  }
  if (payload.product !== "codey-cms") {
    throw new Error("Release payload product must be codey-cms.");
  }
  assertSemver(payload.version, "Release version");
  if (payload.channel !== "stable") {
    throw new Error("Only the stable release channel is supported.");
  }
  if (payload.version.includes("-")) {
    throw new Error("Stable releases cannot use a prerelease version.");
  }
  if (!Number.isFinite(Date.parse(payload.releasedAt))) {
    throw new Error("Release timestamp is invalid.");
  }
  if (!payload.artifact || typeof payload.artifact !== "object") {
    throw new Error("Release payload must describe an artifact.");
  }
  if (!isSafeReleaseFile(payload.artifact.file)) {
    throw new Error("Release artifact file name is invalid.");
  }
  if (payload.artifact.file !== `codey-cms-${payload.version}.tar.gz`) {
    throw new Error("Release artifact file does not match the release version.");
  }
  if (!isHttpUrl(payload.artifact.url)) {
    throw new Error("Release artifact URL is invalid.");
  }
  if (!Number.isSafeInteger(payload.artifact.sizeBytes) || payload.artifact.sizeBytes <= 0) {
    throw new Error("Release artifact size must be a positive integer.");
  }
  if (!/^[a-f0-9]{64}$/.test(payload.artifact.sha256 || "")) {
    throw new Error("Release artifact SHA-256 is invalid.");
  }
  if (payload.downloads?.selfHostedZip) {
    assertDownload(
      payload.downloads.selfHostedZip,
      `codey-cms-${payload.version}.zip`,
      "Self-hosted ZIP"
    );
  }
  if (
    !payload.contracts ||
    payload.contracts.websiteSpec !== "1.0" ||
    payload.contracts.builder !== "1.0" ||
    payload.contracts.exportedSiteAcceptance !== "1.0"
  ) {
    throw new Error("Release payload has an unsupported runtime contract.");
  }

  return payload;
}

export function createSignedRelease(payload, privateKeyInput) {
  assertReleasePayload(payload);
  const privateKey = readPrivateKey(privateKeyInput);
  const publicKey = createPublicKey(privateKey);
  const signature = sign(null, Buffer.from(canonicalJson(payload)), privateKey);

  return {
    envelope: {
      schemaVersion: releaseSchemaVersion,
      payload,
      signature: {
        algorithm: "Ed25519",
        keyId: releaseKeyId(publicKey),
        value: signature.toString("base64")
      }
    },
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString()
  };
}

export function releasePublicKey(privateKeyInput) {
  const privateKey = readPrivateKey(privateKeyInput);
  return createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
}

export function createUnsignedRelease(payload) {
  assertReleasePayload(payload);

  return {
    schemaVersion: releaseSchemaVersion,
    payload,
    signature: null
  };
}

export function verifyReleaseEnvelope(envelope, publicKeyInput, options = {}) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("Release manifest must be an object.");
  }
  if (envelope.schemaVersion !== releaseSchemaVersion) {
    throw new Error(`Unsupported release envelope version: ${envelope.schemaVersion}.`);
  }

  const payload = assertReleasePayload(envelope.payload);
  if (!envelope.signature) {
    if (options.allowUnsigned) return payload;
    throw new Error("Release manifest is not signed.");
  }
  if (envelope.signature.algorithm !== "Ed25519") {
    throw new Error("Release signature must use Ed25519.");
  }
  if (!publicKeyInput) {
    throw new Error("A release public key is required to verify this manifest.");
  }

  const publicKey = readPublicKey(publicKeyInput);
  if (releaseKeyId(publicKey) !== envelope.signature.keyId) {
    throw new Error("Release signing key does not match the manifest key ID.");
  }

  const valid = verify(
    null,
    Buffer.from(canonicalJson(payload)),
    publicKey,
    Buffer.from(envelope.signature.value || "", "base64")
  );
  if (!valid) throw new Error("Release manifest signature is invalid.");

  return payload;
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export function releaseKeyId(publicKeyInput) {
  const publicKey = readPublicKey(publicKeyInput);
  const der = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

export function assertSemver(value, label = "Version") {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`${label} must use semantic versioning.`);
  }
  return value;
}

export function compareSemver(left, right) {
  const leftParts = assertSemver(left).split("-")[0].split(".").map(Number);
  const rightParts = assertSemver(right).split("-")[0].split(".").map(Number);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }

  if (left === right) return 0;
  if (!left.includes("-")) return 1;
  if (!right.includes("-")) return -1;
  return left.localeCompare(right);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])])
  );
}

function readPrivateKey(input) {
  if (!input) throw new Error("CODEY_RELEASE_PRIVATE_KEY is required for a signed release.");
  if (typeof input === "object" && input?.type === "private") return input;
  const value = decodeKeyInput(input);
  return createPrivateKey(value);
}

function readPublicKey(input) {
  if (typeof input === "object" && input?.type === "public") return input;
  return createPublicKey(decodeKeyInput(input));
}

function decodeKeyInput(input) {
  if (typeof input !== "string") return input;
  const value = input.trim().replaceAll("\\n", "\n");
  if (value.includes("-----BEGIN")) return value;

  return Buffer.from(value, "base64");
}

function isSafeReleaseFile(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 180 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    value !== "." &&
    value !== "..";
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function assertDownload(download, expectedFile, label) {
  if (!download || typeof download !== "object" || download.file !== expectedFile) {
    throw new Error(`${label} file does not match the release version.`);
  }
  if (!isSafeReleaseFile(download.file) || !isHttpUrl(download.url)) {
    throw new Error(`${label} location is invalid.`);
  }
  if (!Number.isSafeInteger(download.sizeBytes) || download.sizeBytes <= 0) {
    throw new Error(`${label} size must be a positive integer.`);
  }
  if (!/^[a-f0-9]{64}$/.test(download.sha256 || "")) {
    throw new Error(`${label} SHA-256 is invalid.`);
  }
}
