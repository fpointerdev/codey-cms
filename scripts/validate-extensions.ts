import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  discoverExtensions,
  readExtensionManifest,
  satisfiesCmsVersion
} from "../src/extensions/extension-registry.js";
import type { ExtensionValidationFailure } from "../src/extensions/extension-registry.js";
import type { ExtensionManifest } from "../src/extensions/extension-manifest.js";

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const targets = args.filter((argument) => !argument.startsWith("--"));
if (targets.length > 1) throw new Error("Validate one extension file or directory at a time.");

const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { version: string };
const { extensions, failures } = await validationTarget(targets[0]);
const incompatible = extensions.filter((extension) => (
  !satisfiesCmsVersion(packageJson.version, extension.requires.cms)
));
const result = {
  valid: failures.length === 0 && incompatible.length === 0,
  cmsVersion: packageJson.version,
  extensions: extensions.map((extension) => ({
    id: extension.id,
    version: extension.version,
    requiresCms: extension.requires.cms,
    contentModels: extension.contentModels.length
  })),
  failures,
  incompatible: incompatible.map((extension) => ({
    id: extension.id,
    requiresCms: extension.requires.cms
  }))
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else if (!result.valid) {
  for (const failure of failures) console.error(`${failure.directory}: ${failure.message}`);
  for (const extension of incompatible) {
    console.error(`${extension.id}: requires CodeY CMS ${extension.requires.cms}; current version is ${packageJson.version}.`);
  }
} else {
  console.log(`Validated ${extensions.length} declarative CodeY extension${extensions.length === 1 ? "" : "s"}.`);
}

if (!result.valid) process.exitCode = 1;

async function validationTarget(target?: string): Promise<{
  extensions: ExtensionManifest[];
  failures: ExtensionValidationFailure[];
}> {
  const resolved = path.resolve(target || "extensions");
  const metadata = await stat(resolved).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata) {
    return { extensions: [], failures: [{ directory: resolved, message: "Extension path does not exist." }] };
  }

  if (metadata.isFile()) return validateManifestFile(resolved);
  if (!metadata.isDirectory()) {
    return { extensions: [], failures: [{ directory: resolved, message: "Extension path must be a file or directory." }] };
  }

  const manifestPath = path.join(resolved, "codey-extension.json");
  if (await access(manifestPath).then(() => true).catch(() => false)) {
    return validateManifestFile(manifestPath);
  }
  return discoverExtensions(resolved);
}

async function validateManifestFile(manifestPath: string) {
  try {
    return { extensions: [await readExtensionManifest(manifestPath)], failures: [] };
  } catch (error) {
    return {
      extensions: [],
      failures: [{
        directory: path.dirname(manifestPath),
        message: error instanceof Error ? error.message : "Extension manifest is invalid."
      }]
    };
  }
}
