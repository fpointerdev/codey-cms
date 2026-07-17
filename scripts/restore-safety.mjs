import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export function backupArtifactPath(directory, filename) {
  if (
    typeof filename !== "string" ||
    !filename ||
    filename === "." ||
    filename === ".." ||
    filename.includes("\\") ||
    filename.includes("\0") ||
    path.basename(filename) !== filename
  ) {
    throw new Error("Backup manifest contains an invalid artifact path.");
  }

  return path.join(directory, filename);
}

export async function verifyBackupArtifact(filePath, details) {
  if (!Number.isSafeInteger(details?.sizeBytes) || details.sizeBytes < 0) {
    throw new Error("Backup manifest contains an invalid artifact size.");
  }
  if (typeof details?.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(details.sha256)) {
    throw new Error("Backup manifest contains an invalid artifact checksum.");
  }

  const fileStats = await lstat(filePath);
  if (!fileStats.isFile()) {
    throw new Error(`Backup artifact is not a regular file: ${path.basename(filePath)}.`);
  }
  if (fileStats.size !== details.sizeBytes) {
    throw new Error(`Backup size check failed for ${path.basename(filePath)}.`);
  }
  if (await sha256File(filePath) !== details.sha256.toLowerCase()) {
    throw new Error(`Backup checksum failed for ${path.basename(filePath)}.`);
  }
}

export function assertSafeTarEntries(output) {
  for (const entry of output.split(/\r?\n/).filter(Boolean)) {
    const normalized = entry.replace(/^\.\//, "");
    if (path.isAbsolute(normalized) || normalized.split(/[\\/]/).includes("..")) {
      throw new Error("Media archive contains an unsafe path.");
    }
  }
}

export function assertSafeTarEntryTypes(output) {
  for (const entry of output.split(/\r?\n/).filter(Boolean)) {
    if (!["-", "d"].includes(entry[0])) {
      throw new Error("Media archive contains a link or unsupported file type.");
    }
  }
}

export async function assertSafeMediaTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const entryStats = await lstat(entryPath);

    if (entryStats.isSymbolicLink()) {
      throw new Error("Media archive contains a symbolic link.");
    }
    if (entryStats.isDirectory()) {
      await assertSafeMediaTree(entryPath);
      continue;
    }
    if (!entryStats.isFile()) {
      throw new Error("Media archive contains an unsupported file type.");
    }
  }
}
