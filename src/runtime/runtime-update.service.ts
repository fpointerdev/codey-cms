import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { pathToFileURL } from "node:url";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config/index.js";
import { AppError } from "../core/errors/app-error.js";
import type { AppLogger } from "../infrastructure/logging/logger.js";
import { runtimeVersion } from "./release.js";

const maximumFeedBytes = 1024 * 1024;
const maximumArtifactBytes = 1024 * 1024 * 1024;
const abandonedStageAgeMs = 30 * 60 * 1000;
const activeUpdateStatuses = ["STAGED", "APPLYING"] as const;

type ReleasePayload = {
  schemaVersion: number;
  product: "codey-cms";
  version: string;
  channel: "stable";
  releasedAt: string;
  artifact: {
    file: string;
    url: string;
    sizeBytes: number;
    sha256: string;
  };
};

type ReleaseEnvelope = {
  schemaVersion: number;
  payload: ReleasePayload;
  signature: unknown;
};

type ReleaseContract = {
  compareSemver: (left: string, right: string) => number;
  verifyReleaseEnvelope: (
    envelope: ReleaseEnvelope,
    publicKey: string,
    options?: { allowUnsigned?: boolean }
  ) => ReleasePayload;
};

export class RuntimeUpdateService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly logger: AppLogger
  ) {}

  async status() {
    const [installation, latestUpdate, supervisor] = await Promise.all([
      this.prisma.runtimeInstallation.findUnique({ where: { id: "primary" } }),
      this.prisma.runtimeUpdate.findFirst({ orderBy: { createdAt: "desc" } }),
      this.readSupervisorStatus()
    ]);

    return {
      enabled: this.config.updates.enabled,
      automatic: this.config.updates.autoApply,
      channel: "stable",
      currentVersion: installation?.runtimeVersion ?? runtimeVersion,
      latestUpdate,
      supervisor
    };
  }

  async check() {
    this.assertEnabled();
    const release = await this.readStableRelease();
    const installation = await this.prisma.runtimeInstallation.findUnique({
      where: { id: "primary" }
    });
    const currentVersion = installation?.runtimeVersion ?? runtimeVersion;
    const contract = await loadReleaseContract();

    return {
      channel: "stable",
      currentVersion,
      latestVersion: release.payload.version,
      updateAvailable: contract.compareSemver(release.payload.version, currentVersion) > 0,
      releasedAt: release.payload.releasedAt,
      artifactSizeBytes: release.payload.artifact.sizeBytes
    };
  }

  async stageLatest(requestedByUserId?: string) {
    this.assertEnabled();
    const installation = await this.prisma.runtimeInstallation.findUnique({
      where: { id: "primary" }
    });
    if (installation?.status !== "COMPLETE") {
      throw new AppError(409, "installation_required", "Complete installation before applying runtime updates.");
    }

    const activeUpdate = await this.prisma.runtimeUpdate.findFirst({
      where: { status: { in: [...activeUpdateStatuses] } },
      orderBy: { createdAt: "desc" }
    });
    if (activeUpdate && !await this.recoverAbandonedStage(activeUpdate)) {
      throw new AppError(409, "runtime_update_active", "A runtime update is already staged or applying.");
    }

    const release = await this.readStableRelease();
    const contract = await loadReleaseContract();
    const currentVersion = installation.runtimeVersion || runtimeVersion;
    if (contract.compareSemver(release.payload.version, currentVersion) <= 0) {
      return {
        staged: false,
        currentVersion,
        latestVersion: release.payload.version,
        message: "CodeY CMS is up to date."
      };
    }

    let update;
    try {
      update = await this.prisma.runtimeUpdate.create({
        data: {
          fromVersion: currentVersion,
          toVersion: release.payload.version,
          status: "STAGED",
          releaseManifest: release.envelope as unknown as Prisma.InputJsonValue,
          requestedByUserId
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(409, "runtime_update_active", "A runtime update is already staged or applying.");
      }
      throw error;
    }

    const updateDirectory = path.resolve(
      this.config.updates.directory,
      `${release.payload.version}-${update.id}`
    );
    const artifactPath = path.join(updateDirectory, release.payload.artifact.file);
    const manifestPath = path.join(updateDirectory, "release-manifest.json");

    try {
      await mkdir(updateDirectory, { recursive: true, mode: 0o700 });
      await this.downloadArtifact(release.payload, artifactPath);
      await writeJsonAtomic(manifestPath, release.envelope);
      await writeJsonAtomic(path.resolve(this.config.updates.controlFile), {
        schemaVersion: 1,
        updateId: update.id,
        fromVersion: currentVersion,
        toVersion: release.payload.version,
        artifactPath,
        manifestPath,
        requestedAt: new Date().toISOString()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.runtimeUpdate.update({
        where: { id: update.id },
        data: {
          status: "FAILED",
          error: message.slice(0, 2000),
          completedAt: new Date()
        }
      }).catch((statusError) => {
        this.logger.error({ err: statusError, updateId: update.id }, "Unable to record staging failure");
      });
      await rm(updateDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    this.logger.info(
      { updateId: update.id, fromVersion: currentVersion, toVersion: release.payload.version },
      "Runtime update staged for the supervisor"
    );

    return {
      staged: true,
      updateId: update.id,
      currentVersion,
      latestVersion: release.payload.version
    };
  }

  private assertEnabled() {
    if (!this.config.updates.enabled) {
      throw new AppError(409, "runtime_updates_disabled", "Runtime updates are disabled for this installation.");
    }
  }

  private async recoverAbandonedStage(update: {
    id: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    if (update.status !== "STAGED") return false;
    const lastChangedAt = update.updatedAt || update.createdAt;
    if (Date.now() - lastChangedAt.getTime() < abandonedStageAgeMs) return false;

    try {
      await readFile(path.resolve(this.config.updates.controlFile), "utf8");
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }

    const result = await this.prisma.runtimeUpdate.updateMany({
      where: { id: update.id, status: "STAGED" },
      data: {
        status: "FAILED",
        error: "Update staging was interrupted before the supervisor request was created.",
        completedAt: new Date()
      }
    });
    if (result.count === 0) return false;

    this.logger.warn({ updateId: update.id }, "Recovered an abandoned runtime update stage");
    return true;
  }

  private async readStableRelease() {
    const feedUrl = new URL(this.config.updates.feedUrl);
    if (this.config.isProduction && feedUrl.protocol !== "https:") {
      throw new AppError(502, "release_feed_insecure", "The stable release feed must use HTTPS.");
    }
    let response: Response;
    try {
      response = await fetch(this.config.updates.feedUrl, {
        headers: { accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000)
      });
    } catch {
      throw new AppError(502, "release_feed_unavailable", "The stable release feed could not be reached.");
    }
    if (!response.ok) {
      throw new AppError(502, "release_feed_unavailable", `The stable release feed returned ${response.status}.`);
    }
    if (this.config.isProduction && response.url && new URL(response.url).protocol !== "https:") {
      throw new AppError(502, "release_feed_insecure", "The stable release feed redirected to an insecure URL.");
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maximumFeedBytes) {
      throw new AppError(502, "release_feed_invalid", "The stable release feed is too large.");
    }
    const source = await readResponseText(response, maximumFeedBytes);

    let stable: { channel?: string; version?: string; manifest?: ReleaseEnvelope };
    try {
      stable = JSON.parse(source);
    } catch {
      throw new AppError(502, "release_feed_invalid", "The stable release feed is not valid JSON.");
    }
    if (stable.channel !== "stable" || !stable.manifest) {
      throw new AppError(502, "release_feed_invalid", "The stable release feed has an invalid channel or manifest.");
    }

    const publicKey = await this.readReleasePublicKey();
    const contract = await loadReleaseContract();
    let payload: ReleasePayload;
    try {
      payload = contract.verifyReleaseEnvelope(stable.manifest, publicKey);
    } catch (error) {
      throw new AppError(
        502,
        "release_signature_invalid",
        error instanceof Error ? error.message : "The release signature is invalid."
      );
    }
    if (stable.version !== payload.version) {
      throw new AppError(502, "release_feed_invalid", "The stable pointer and signed manifest versions do not match.");
    }

    return { envelope: stable.manifest, payload };
  }

  private async readReleasePublicKey() {
    if (this.config.updates.publicKey) return this.config.updates.publicKey;

    try {
      return await readFile(path.resolve(this.config.updates.publicKeyFile), "utf8");
    } catch {
      throw new AppError(
        503,
        "release_key_missing",
        "The stable release public key is not installed. Reinstall from an official signed package."
      );
    }
  }

  private async downloadArtifact(payload: ReleasePayload, artifactPath: string) {
    const temporaryPath = `${artifactPath}.${process.pid}.tmp`;
    const url = new URL(payload.artifact.url);
    if (this.config.isProduction && url.protocol !== "https:") {
      throw new AppError(502, "release_artifact_insecure", "Release artifacts must use HTTPS.");
    }
    if (payload.artifact.sizeBytes > maximumArtifactBytes) {
      throw new AppError(502, "release_artifact_too_large", "The release artifact exceeds the maximum supported size.");
    }

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(120_000)
      });
    } catch {
      throw new AppError(502, "release_artifact_unavailable", "The release artifact could not be downloaded.");
    }

    try {
      if (!response.ok || !response.body) {
        throw new AppError(502, "release_artifact_unavailable", `The release artifact returned ${response.status}.`);
      }
      if (this.config.isProduction && new URL(response.url).protocol !== "https:") {
        throw new AppError(502, "release_artifact_insecure", "The release artifact redirected to an insecure URL.");
      }
      const responseLength = Number(response.headers.get("content-length") || 0);
      if (responseLength && responseLength !== payload.artifact.sizeBytes) {
        throw new AppError(502, "release_artifact_invalid", "The release artifact size does not match its manifest.");
      }

      let receivedBytes = 0;
      const sizeLimit = new Transform({
        transform(chunk, _encoding, callback) {
          receivedBytes += chunk.length;
          if (receivedBytes > payload.artifact.sizeBytes || receivedBytes > maximumArtifactBytes) {
            callback(new AppError(502, "release_artifact_invalid", "The release artifact exceeds its signed size."));
            return;
          }
          callback(null, chunk);
        }
      });

      await pipeline(
        Readable.fromWeb(response.body as never),
        sizeLimit,
        createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 })
      );
      const fileStats = await stat(temporaryPath);
      if (fileStats.size !== payload.artifact.sizeBytes) {
        throw new AppError(502, "release_artifact_invalid", "The release artifact size does not match its manifest.");
      }
      if (await sha256(temporaryPath) !== payload.artifact.sha256) {
        throw new AppError(502, "release_artifact_invalid", "The release artifact checksum does not match its manifest.");
      }
      await rename(temporaryPath, artifactPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private async readSupervisorStatus() {
    const statusPath = path.join(path.dirname(path.resolve(this.config.updates.controlFile)), "update-status.json");
    try {
      return JSON.parse(await readFile(statusPath, "utf8"));
    } catch {
      return null;
    }
  }
}

let releaseContractPromise: Promise<ReleaseContract> | undefined;

function loadReleaseContract() {
  releaseContractPromise ??= import(
    pathToFileURL(path.resolve(process.cwd(), "scripts/release-contract.mjs")).href
  ) as Promise<ReleaseContract>;
  return releaseContractPromise;
}

async function sha256(filePath: string) {
  const hash = createHash("sha256");
  const file = await import("node:fs").then(({ createReadStream }) => createReadStream(filePath));
  for await (const chunk of file) hash.update(chunk);
  return hash.digest("hex");
}

async function readResponseText(response: Response, maximumBytes: number) {
  if (!response.body) {
    throw new AppError(502, "release_feed_invalid", "The stable release feed has no response body.");
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of Readable.fromWeb(response.body as never)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > maximumBytes) {
      throw new AppError(502, "release_feed_invalid", "The stable release feed is too large.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}
