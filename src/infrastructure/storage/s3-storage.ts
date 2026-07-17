import { createHash, createHmac } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import type { SignedStorageUrl, StorageAdapter, StorageObjectMetadata } from "./storage.types.js";

type S3StorageConfig = AppConfig["storage"];

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function formatAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function formatDateStamp(date: Date) {
  return formatAmzDate(date).slice(0, 8);
}

function canonicalQuery(entries: Array<[string, string]>) {
  return entries
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

function required(value: string | undefined, name: string) {
  if (!value) {
    throw new AppError(500, "storage_not_configured", `${name} is required for S3 storage.`);
  }

  return value;
}

class DisabledStorageAdapter implements StorageAdapter {
  enabled = false;

  async checkConnection() {
    throw new AppError(503, "storage_not_configured", "Storage is not configured.");
  }

  publicUrl(key: string) {
    return `storage://${key}`;
  }

  async createUploadUrl(): Promise<SignedStorageUrl> {
    throw new AppError(503, "storage_not_configured", "Storage is not configured.");
  }

  async createDownloadUrl(): Promise<SignedStorageUrl> {
    throw new AppError(503, "storage_not_configured", "Storage is not configured.");
  }

  async putObject() {
    throw new AppError(503, "storage_not_configured", "Storage is not configured.");
  }

  async getObject(): Promise<Buffer> {
    throw new AppError(503, "storage_not_configured", "Storage is not configured.");
  }

  async deleteObject() {
    throw new AppError(503, "storage_not_configured", "Storage is not configured.");
  }

  async headObject(): Promise<StorageObjectMetadata> {
    throw new AppError(503, "storage_not_configured", "Storage is not configured.");
  }
}

class LocalStorageAdapter implements StorageAdapter {
  enabled = true;
  private readonly rootDir: string;

  constructor(private readonly config: S3StorageConfig) {
    this.rootDir = resolve(config.localDir ?? "storage/uploads");
  }

  async checkConnection() {
    await mkdir(this.rootDir, { recursive: true });
    await access(this.rootDir, constants.R_OK | constants.W_OK);
  }

  publicUrl(key: string) {
    const encodedKey = key.split("/").map(encodeRfc3986).join("/");
    const localUrl = `/uploads/${encodedKey}`;

    if (this.config.publicBaseUrl) {
      return `${this.config.publicBaseUrl.replace(/\/+$/g, "")}${localUrl}`;
    }

    return localUrl;
  }

  async createUploadUrl(): Promise<SignedStorageUrl> {
    throw new AppError(
      501,
      "local_signed_upload_unsupported",
      "Presigned browser uploads require S3-compatible storage."
    );
  }

  async createDownloadUrl(key: string): Promise<SignedStorageUrl> {
    return {
      method: "GET",
      url: this.publicUrl(key),
      headers: {},
      expiresAt: new Date(Date.now() + this.config.signedUrlTtlSeconds * 1000)
    };
  }

  async putObject(key: string, body: Buffer) {
    const objectPath = this.objectPath(key);

    await mkdir(dirname(objectPath), { recursive: true });
    await writeFile(objectPath, body);
  }

  async getObject(key: string) {
    try {
      return await readFile(this.objectPath(key));
    } catch (error) {
      if (this.isFileNotFound(error)) {
        throw new AppError(404, "storage_object_not_found", "Storage object was not found.");
      }

      throw error;
    }
  }

  async deleteObject(key: string) {
    try {
      await unlink(this.objectPath(key));
    } catch (error) {
      if (!this.isFileNotFound(error)) {
        throw error;
      }
    }
  }

  async headObject(key: string): Promise<StorageObjectMetadata> {
    try {
      const metadata = await stat(this.objectPath(key));

      return {
        sizeBytes: metadata.size
      };
    } catch (error) {
      if (this.isFileNotFound(error)) {
        throw new AppError(404, "storage_object_not_found", "Storage object was not found.");
      }

      throw error;
    }
  }

  private objectPath(key: string) {
    if (!key.trim()) {
      throw new AppError(422, "invalid_storage_key", "Storage key is invalid.");
    }

    const objectPath = resolve(this.rootDir, key);
    const objectRelativePath = relative(this.rootDir, objectPath);

    if (
      objectRelativePath === "" ||
      objectRelativePath === ".." ||
      objectRelativePath.startsWith("../") ||
      isAbsolute(objectRelativePath)
    ) {
      throw new AppError(422, "invalid_storage_key", "Storage key is invalid.");
    }

    return objectPath;
  }

  private isFileNotFound(error: unknown) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
  }
}

export class S3StorageAdapter implements StorageAdapter {
  enabled = true;
  private readonly endpoint: URL;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(private readonly config: S3StorageConfig) {
    this.endpoint = new URL(required(config.endpoint, "STORAGE_S3_ENDPOINT"));
    this.bucket = required(config.bucket, "STORAGE_S3_BUCKET");
    this.region = config.region;
    this.accessKeyId = required(config.accessKeyId, "STORAGE_S3_ACCESS_KEY_ID");
    this.secretAccessKey = required(config.secretAccessKey, "STORAGE_S3_SECRET_ACCESS_KEY");
  }

  async checkConnection() {
    const signedUrl = this.presign("HEAD", "");
    const response = await fetch(signedUrl.url, {
      method: "HEAD",
      signal: AbortSignal.timeout(3_000)
    });

    if (!response.ok) {
      throw new AppError(502, "storage_unavailable", "Storage bucket is unavailable.", {
        status: response.status
      });
    }
  }

  publicUrl(key: string) {
    if (this.config.publicBaseUrl) {
      return `${this.config.publicBaseUrl.replace(/\/+$/g, "")}/${this.encodeKey(key)}`;
    }

    return `s3://${this.bucket}/${key}`;
  }

  async createUploadUrl(key: string, contentType: string) {
    const signedUrl = this.presign("PUT", key);

    return {
      ...signedUrl,
      headers: {
        "content-type": contentType
      }
    };
  }

  async createDownloadUrl(key: string) {
    return this.presign("GET", key);
  }

  async putObject(key: string, body: Buffer, contentType: string) {
    const signedUrl = await this.createUploadUrl(key, contentType);
    const response = await fetch(signedUrl.url, {
      method: "PUT",
      headers: signedUrl.headers,
      body: new Uint8Array(body)
    });

    if (!response.ok) {
      throw new AppError(502, "storage_upload_failed", "Storage upload failed.", {
        status: response.status
      });
    }
  }

  async getObject(key: string) {
    const signedUrl = await this.createDownloadUrl(key);
    const response = await fetch(signedUrl.url, {
      method: "GET"
    });

    if (!response.ok) {
      throw new AppError(502, "storage_download_failed", "Storage download failed.", {
        status: response.status
      });
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async deleteObject(key: string) {
    const signedUrl = this.presign("DELETE", key);
    const response = await fetch(signedUrl.url, {
      method: "DELETE"
    });

    if (!response.ok && response.status !== 404) {
      throw new AppError(502, "storage_delete_failed", "Storage delete failed.", {
        status: response.status
      });
    }
  }

  async headObject(key: string): Promise<StorageObjectMetadata> {
    const signedUrl = this.presign("HEAD", key);
    const response = await fetch(signedUrl.url, {
      method: "HEAD"
    });

    if (!response.ok) {
      throw new AppError(502, "storage_head_failed", "Storage metadata lookup failed.", {
        status: response.status
      });
    }

    const contentLength = response.headers.get("content-length");

    return {
      sizeBytes: contentLength ? Number(contentLength) : undefined,
      mimeType: response.headers.get("content-type") ?? undefined
    };
  }

  private presign(method: "DELETE" | "GET" | "HEAD" | "PUT", key: string): SignedStorageUrl {
    const now = new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = formatDateStamp(now);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const credential = `${this.accessKeyId}/${credentialScope}`;
    const url = this.objectUrl(key);
    const queryEntries: Array<[string, string]> = [
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD"],
      ["X-Amz-Credential", credential],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(this.config.signedUrlTtlSeconds)],
      ["X-Amz-SignedHeaders", "host"]
    ];
    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery(queryEntries),
      `host:${url.host}\n`,
      "host",
      "UNSIGNED-PAYLOAD"
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256(canonicalRequest)
    ].join("\n");
    const signingKey = this.signingKey(dateStamp);
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    queryEntries.push(["X-Amz-Signature", signature]);
    url.search = canonicalQuery(queryEntries);

    return {
      method,
      url: url.toString(),
      headers: {},
      expiresAt: new Date(now.getTime() + this.config.signedUrlTtlSeconds * 1000)
    };
  }

  private signingKey(dateStamp: string) {
    const dateKey = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, "s3");

    return hmac(serviceKey, "aws4_request");
  }

  private objectUrl(key: string) {
    const encodedKey = this.encodeKey(key);

    if (!this.config.forcePathStyle) {
      const virtualHostUrl = new URL(this.endpoint.toString());
      virtualHostUrl.hostname = `${this.bucket}.${virtualHostUrl.hostname}`;
      virtualHostUrl.pathname = `${trimSlashes(virtualHostUrl.pathname)}/${encodedKey}`;
      return virtualHostUrl;
    }

    const url = new URL(this.endpoint.toString());
    url.pathname = `${trimSlashes(url.pathname)}/${this.bucket}/${encodedKey}`;
    return url;
  }

  private encodeKey(key: string) {
    return key.split("/").map(encodeRfc3986).join("/");
  }
}

export function createStorageAdapter(config: S3StorageConfig): StorageAdapter {
  if (config.driver === "local") {
    return new LocalStorageAdapter(config);
  }

  if (config.driver === "s3") {
    return new S3StorageAdapter(config);
  }

  return new DisabledStorageAdapter();
}
