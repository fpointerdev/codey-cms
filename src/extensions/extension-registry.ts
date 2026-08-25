import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../core/errors/app-error.js";
import { extensionCatalogSchema, type ExtensionCatalog } from "./extension-catalog.js";
import { extensionManifestSha256 } from "./extension-integrity.js";
import {
  extensionSemverPattern,
  extensionManifestSchema,
  type ExtensionManifest
} from "./extension-manifest.js";

export type ExtensionValidationFailure = {
  directory: string;
  message: string;
};

export type DiscoveredExtension = {
  manifest: ExtensionManifest;
  provenance: {
    source: "catalog" | "operator";
    catalogVerified: boolean;
    manifestSha256: string;
  };
};

type Version = [number, number, number];
type SemanticVersion = {
  numbers: Version;
  prerelease: string[] | null;
};

function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = extensionSemverPattern.exec(value.trim());
  return match ? {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? null
  } : null;
}

function compareVersion(left: Version, right: Version) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function compareSemanticVersions(left: string, right: string) {
  const leftVersion = parseSemanticVersion(left);
  const rightVersion = parseSemanticVersion(right);
  if (!leftVersion || !rightVersion) return null;
  const numberComparison = compareVersion(leftVersion.numbers, rightVersion.numbers);
  if (numberComparison !== 0) return numberComparison;
  if (!leftVersion.prerelease) return rightVersion.prerelease ? 1 : 0;
  if (!rightVersion.prerelease) return -1;

  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function satisfiesCmsVersion(version: string, range: string) {
  const currentVersion = parseSemanticVersion(version);
  if (!currentVersion) return false;
  const current = currentVersion.numbers;
  const clauses = range.trim().split(/\s+/).filter(Boolean);
  if (!clauses.length) return false;

  return clauses.every((clause) => {
    const match = /^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+)$/.exec(clause);
    if (!match) return false;
    const targetVersion = parseSemanticVersion(match[2]);
    if (!targetVersion) return false;
    const target = targetVersion.numbers;
    const comparison = compareSemanticVersions(version, match[2]);
    if (comparison === null) return false;
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

export async function readExtensionCatalog(catalogPath: string) {
  const raw = JSON.parse(await readFile(catalogPath, "utf8"));
  return extensionCatalogSchema.parse(raw);
}

export async function discoverExtensions(directory = extensionsDirectory()) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const extensions: DiscoveredExtension[] = [];
  const failures: ExtensionValidationFailure[] = [];
  const catalogPath = path.join(directory, "catalog.json");
  let catalog: ExtensionCatalog | null = null;
  try {
    catalog = await readExtensionCatalog(catalogPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return {
        extensions,
        failures: [{
          directory: ".",
          message: error instanceof Error ? `Extension catalog is invalid: ${error.message}` : "Extension catalog is invalid."
        }]
      };
    }
  }
  const catalogByDirectory = new Map(catalog?.extensions.map((entry) => [entry.directory, entry]) ?? []);
  const discoveredDirectories = new Set<string>();

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    discoveredDirectories.add(entry.name);
    const manifestPath = path.join(directory, entry.name, "codey-extension.json");
    try {
      const manifest = await readExtensionManifest(manifestPath);
      const manifestSha256 = extensionManifestSha256(manifest);
      const catalogEntry = catalogByDirectory.get(entry.name);
      if (catalog && (
        !catalogEntry ||
        catalogEntry.id !== manifest.id ||
        catalogEntry.version !== manifest.version ||
        catalogEntry.manifestSha256 !== manifestSha256
      )) {
        throw new Error("Manifest identity or checksum does not match the extension catalog.");
      }
      extensions.push({
        manifest,
        provenance: {
          source: catalog ? "catalog" : "operator",
          catalogVerified: Boolean(catalogEntry),
          manifestSha256
        }
      });
    } catch (error) {
      failures.push({
        directory: entry.name,
        message: error instanceof Error ? error.message : "Extension manifest is invalid."
      });
    }
  }

  for (const entry of catalog?.extensions ?? []) {
    if (!discoveredDirectories.has(entry.directory)) {
      failures.push({
        directory: entry.directory,
        message: "Catalog entry does not have a matching extension directory."
      });
    }
  }

  return { extensions, failures };
}

export async function getExtension(extensionId: string, directory = extensionsDirectory()) {
  const { extensions } = await discoverExtensions(directory);
  const extension = extensions.find((item) => item.manifest.id === extensionId);
  if (!extension) throw new AppError(404, "extension_not_found", "Extension not found.");
  return extension;
}
