import { readFileSync } from "node:fs";
import path from "node:path";

type RuntimePackage = {
  version?: string;
};

function readRuntimeVersion() {
  const configuredVersion = process.env.CODEY_CMS_VERSION?.trim();
  if (configuredVersion) return configuredVersion;

  try {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
    ) as RuntimePackage;

    if (packageJson.version) return packageJson.version;
  } catch {
    // Packaged runtimes can provide CODEY_CMS_VERSION when package metadata is external.
  }

  return "0.0.0";
}

export const runtimeVersion = readRuntimeVersion();
export const runtimeReleaseChannel = "stable";
export const websiteSpecContractVersion = "1.0";
export const builderContractVersion = "1.0";
export const exportedSiteAcceptanceContractVersion = "1.0";
