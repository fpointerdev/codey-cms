import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../core/errors/app-error.js";
import {
  extensionManifestSchema,
  type ExtensionManifest
} from "./extension-manifest.js";

export type ExtensionValidationFailure = {
  directory: string;
  message: string;
};

type Version = [number, number, number];

function versionTuple(value: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersion(left: Version, right: Version) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function satisfiesCmsVersion(version: string, range: string) {
  const current = versionTuple(version);
  if (!current) return false;
  const clauses = range.trim().split(/\s+/).filter(Boolean);
  if (!clauses.length) return false;

  return clauses.every((clause) => {
    const match = /^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+)$/.exec(clause);
    if (!match) return false;
    const target = versionTuple(match[2]);
    if (!target) return false;
    const comparison = compareVersion(current, target);
    switch (match[1] || "=") {
      case ">=": return comparison >= 0;
      case "<=": return comparison <= 0;
      case ">": return comparison > 0;
      case "<": return comparison < 0;
      case "^":
        if (comparison < 0 || current[0] !== target[0]) return false;
        if (target[0] > 0) return true;
        if (current[1] !== target[1]) return false;
        return target[1] > 0 || current[2] === target[2];
      case "~": return current[0] === target[0] && current[1] === target[1] && comparison >= 0;
      default: return comparison === 0;
    }
  });
}

export function extensionsDirectory() {
  return path.resolve(process.env.CODEY_EXTENSIONS_DIR?.trim() || path.join(process.cwd(), "extensions"));
}

export async function readExtensionManifest(manifestPath: string) {
  const raw = JSON.parse(await readFile(manifestPath, "utf8"));
  return extensionManifestSchema.parse(raw);
}

export async function discoverExtensions(directory = extensionsDirectory()) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const extensions: ExtensionManifest[] = [];
  const failures: ExtensionValidationFailure[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const manifestPath = path.join(directory, entry.name, "codey-extension.json");
    try {
      extensions.push(await readExtensionManifest(manifestPath));
    } catch (error) {
      failures.push({
        directory: entry.name,
        message: error instanceof Error ? error.message : "Extension manifest is invalid."
      });
    }
  }

  return { extensions, failures };
}

export async function getExtension(extensionId: string, directory = extensionsDirectory()) {
  const { extensions } = await discoverExtensions(directory);
  const extension = extensions.find((item) => item.id === extensionId);
  if (!extension) throw new AppError(404, "extension_not_found", "Extension not found.");
  return extension;
}
