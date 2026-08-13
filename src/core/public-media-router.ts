import { readFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Application, NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config/index.js";
import { AppError } from "./errors/app-error.js";
import { createStorageAdapter } from "../infrastructure/storage/s3-storage.js";
import type { StorageAdapter } from "../infrastructure/storage/storage.types.js";
import {
  isOptimizableImageKey,
  optimizedImageStorageKey,
  requestedImageWidth
} from "../modules/cms/media-optimizer.js";
import { publicMediaResponsePolicy } from "../modules/cms/media-policy.js";

export function normalizePublicMediaStorageKey(value: string, keyPrefix: string) {
  try {
    const key = decodeURIComponent(value).replace(/^\/+/, "");
    const keyParts = key.split("/");
    const normalizedPrefix = keyPrefix.replace(/^\/+|\/+$/g, "");

    if (!key || keyParts.includes("..")) return "";
    if (normalizedPrefix && key !== normalizedPrefix && !key.startsWith(`${normalizedPrefix}/`)) return "";

    return key;
  } catch {
    return "";
  }
}

function acceptsWebp(req: Request) {
  return /\bimage\/webp\b/i.test(req.header("accept") || "");
}

async function fetchStorageObject(storage: StorageAdapter, key: string) {
  const download = await storage.createDownloadUrl(key);
  return fetch(download.url);
}

function setPublicUploadHeaders(
  res: Response,
  varyAccept = false,
  disposition: "attachment" | "inline" = "inline",
  filename?: string
) {
  if (varyAccept) res.setHeader("vary", "Accept");
  res.setHeader("cache-control", "public, max-age=31536000, immutable");
  res.setHeader("content-security-policy", "default-src 'none'; sandbox");
  res.setHeader("x-content-type-options", "nosniff");
  if (filename) {
    const safeFilename = basename(filename).replace(/[^a-z0-9._-]+/gi, "-");
    res.setHeader("content-disposition", `${disposition}; filename="${safeFilename || "download"}"`);
  }
}

async function sendBufferResponse(
  res: Response,
  body: Buffer,
  contentType: string | null | undefined,
  varyAccept = false,
  disposition: "attachment" | "inline" = "inline",
  filename?: string
) {
  if (contentType) res.type(contentType);
  res.setHeader("content-length", String(body.byteLength));
  setPublicUploadHeaders(res, varyAccept, disposition, filename);
  res.send(body);
}

async function sendStorageResponse(
  res: Response,
  storageResponse: globalThis.Response,
  options: {
    contentType?: string;
    disposition?: "attachment" | "inline";
    filename?: string;
    varyAccept?: boolean;
  } = {}
) {
  const contentType = options.contentType ?? storageResponse.headers.get("content-type");
  const contentLength = storageResponse.headers.get("content-length");

  if (contentType) res.type(contentType);
  if (contentLength) res.setHeader("content-length", contentLength);
  setPublicUploadHeaders(
    res,
    options.varyAccept ?? false,
    options.disposition ?? "inline",
    options.filename
  );

  if (!storageResponse.body) {
    res.end();
    return;
  }

  await new Promise<void>((resolveStream, rejectStream) => {
    const stream = Readable.fromWeb(storageResponse.body! as unknown as NodeReadableStream<Uint8Array>);

    stream.on("error", rejectStream);
    res.on("error", rejectStream);
    res.on("finish", resolveStream);
    stream.pipe(res);
  });
}

async function serveOptimizedUpload(
  req: Request,
  res: Response,
  storage: StorageAdapter,
  key: string,
  config: AppConfig
) {
  if (!acceptsWebp(req) || !isOptimizableImageKey(key)) return false;

  const width = requestedImageWidth(req.query.w, config.storage.imageVariantWidths);
  if (!width) return false;

  const variantResponse = await fetchStorageObject(storage, optimizedImageStorageKey(key, width));
  if (!variantResponse.ok) return false;

  await sendStorageResponse(res, variantResponse, {
    contentType: "image/webp",
    varyAccept: true
  });
  return true;
}

function createS3UploadProxy(config: AppConfig) {
  const storage = createStorageAdapter(config.storage);

  return async function proxyS3Upload(req: Request, res: Response, next: NextFunction) {
    try {
      const key = normalizePublicMediaStorageKey(req.params[0] || "", config.storage.keyPrefix);
      const responsePolicy = publicMediaResponsePolicy(key);
      if (!key || !responsePolicy) {
        res.status(404).end();
        return;
      }

      if (await serveOptimizedUpload(req, res, storage, key, config)) return;

      const storageResponse = await fetchStorageObject(storage, key);
      if (!storageResponse.ok) {
        res.status(storageResponse.status === 404 ? 404 : 502).end();
        return;
      }

      await sendStorageResponse(res, storageResponse, {
        contentType: responsePolicy.mimeType,
        disposition: responsePolicy.disposition,
        filename: key
      });
    } catch (error) {
      next(error);
    }
  };
}

function createLocalUploadVariantProxy(root: string, config: AppConfig) {
  return async function proxyLocalUploadVariant(req: Request, res: Response, next: NextFunction) {
    try {
      const key = normalizePublicMediaStorageKey(req.params[0] || "", config.storage.keyPrefix);
      const width = requestedImageWidth(req.query.w, config.storage.imageVariantWidths);
      if (!key || !width || !acceptsWebp(req) || !isOptimizableImageKey(key)) {
        next();
        return;
      }

      const variantPath = resolve(root, optimizedImageStorageKey(key, width));
      const relativePath = relative(root, variantPath);
      if (!relativePath || relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) {
        next();
        return;
      }

      try {
        await sendBufferResponse(res, await readFile(variantPath), "image/webp", true);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          next();
          return;
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  };
}

function createLocalUploadProxy(
  root: string,
  config: AppConfig,
  options: { continueWhenMissing?: boolean } = {}
) {
  return async function proxyLocalUpload(req: Request, res: Response, next: NextFunction) {
    try {
      const key = normalizePublicMediaStorageKey(req.params[0] || "", config.storage.keyPrefix);
      const responsePolicy = publicMediaResponsePolicy(key);
      if (!key || !responsePolicy) {
        res.status(404).end();
        return;
      }

      const objectPath = resolve(root, key);
      const relativePath = relative(root, objectPath);
      if (!relativePath || relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) {
        res.status(404).end();
        return;
      }

      try {
        await sendBufferResponse(
          res,
          await readFile(objectPath),
          responsePolicy.mimeType,
          false,
          responsePolicy.disposition,
          key
        );
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          if (options.continueWhenMissing) next();
          else res.status(404).end();
          return;
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  };
}

function createManagedUploadProxy(
  storage: StorageAdapter,
  runtimeStorage: () => AppConfig["storage"]
) {
  return async function proxyManagedUpload(req: Request, res: Response, next: NextFunction) {
    try {
      const active = runtimeStorage();
      const key = normalizePublicMediaStorageKey(req.params[0] || "", active.keyPrefix);
      const responsePolicy = publicMediaResponsePolicy(key);
      if (!key || !responsePolicy || active.driver === "disabled") {
        res.status(404).end();
        return;
      }

      const width = requestedImageWidth(req.query.w, active.imageVariantWidths);
      if (acceptsWebp(req) && width && isOptimizableImageKey(key)) {
        const variantKey = optimizedImageStorageKey(key, width);
        try {
          if (active.driver === "local") {
            await sendBufferResponse(res, await storage.getObject(variantKey), "image/webp", true);
          } else {
            const variantResponse = await fetchStorageObject(storage, variantKey);
            if (!variantResponse.ok) throw new AppError(404, "storage_object_not_found", "Variant not found.");
            await sendStorageResponse(res, variantResponse, {
              contentType: "image/webp",
              varyAccept: true
            });
          }
          return;
        } catch (error) {
          if (!(error instanceof AppError && error.statusCode === 404)) throw error;
        }
      }

      if (active.driver === "local") {
        await sendBufferResponse(
          res,
          await storage.getObject(key),
          responsePolicy.mimeType,
          false,
          responsePolicy.disposition,
          key
        );
        return;
      }

      const storageResponse = await fetchStorageObject(storage, key);
      if (!storageResponse.ok) {
        res.status(storageResponse.status === 404 ? 404 : 502).end();
        return;
      }
      await sendStorageResponse(res, storageResponse, {
        contentType: responsePolicy.mimeType,
        disposition: responsePolicy.disposition,
        filename: key
      });
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) {
        res.status(404).end();
        return;
      }
      next(error);
    }
  };
}

export function registerPublicMediaRoutes(
  app: Application,
  config: AppConfig,
  localStorageRoot: string,
  managed?: {
    adapter: StorageAdapter;
    getRuntimeConfig: () => AppConfig["storage"];
  }
) {
  if (managed) {
    if (config.storage.driver === "local") {
      const legacyLocalStorage = {
        ...config,
        storage: {
          ...config.storage,
          keyPrefix: ""
        }
      };
      app.get("/uploads/*", createLocalUploadVariantProxy(localStorageRoot, legacyLocalStorage));
      app.get(
        "/uploads/*",
        createLocalUploadProxy(localStorageRoot, legacyLocalStorage, { continueWhenMissing: true })
      );
    }
    app.get("/uploads/*", createManagedUploadProxy(managed.adapter, managed.getRuntimeConfig));
    return;
  }

  if (config.storage.driver === "local") {
    app.get("/uploads/*", createLocalUploadVariantProxy(localStorageRoot, config));
    app.get("/uploads/*", createLocalUploadProxy(localStorageRoot, config));
  } else if (config.storage.driver === "s3") {
    app.get("/uploads/*", createS3UploadProxy(config));
  }
}
