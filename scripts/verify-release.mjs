import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sha256File,
  verifyReleaseEnvelope
} from "./release-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const releaseDir = path.resolve(readArg("release-dir") || process.env.CODEY_RELEASE_OUTPUT_DIR || path.join(root, ".release"));
const manifestPath = path.resolve(readArg("manifest") || path.join(releaseDir, `codey-cms-${packageJson.version}.manifest.json`));
const envelope = JSON.parse(await readFile(manifestPath, "utf8"));
const publicKey = await readPublicKey();
const payload = verifyReleaseEnvelope(envelope, publicKey, {
  allowUnsigned: hasArg("allow-unsigned") || process.env.CODEY_RELEASE_ALLOW_UNSIGNED === "true"
});
const artifactPath = path.resolve(readArg("artifact") || path.join(path.dirname(manifestPath), payload.artifact.file));
const checksum = await verifyFile(artifactPath, payload.artifact, "Release artifact");

if (!readArg("artifact") && payload.downloads?.selfHostedZip) {
  const downloadPath = path.join(path.dirname(manifestPath), payload.downloads.selfHostedZip.file);
  await verifyFile(downloadPath, payload.downloads.selfHostedZip, "Self-hosted ZIP");
}

console.log(`Verified CodeY CMS ${payload.version} (${payload.channel}).`);
console.log(`${payload.artifact.file}  ${checksum}`);

async function verifyFile(filePath, expected, label) {
  const fileStats = await stat(filePath);
  if (fileStats.size !== expected.sizeBytes) {
    throw new Error(`${label} size mismatch: expected ${expected.sizeBytes}, received ${fileStats.size}.`);
  }

  const fileChecksum = await sha256File(filePath);
  if (fileChecksum !== expected.sha256) {
    throw new Error(`${label} SHA-256 does not match the signed manifest.`);
  }
  return fileChecksum;
}

async function readPublicKey() {
  const configured = process.env.CODEY_RELEASE_PUBLIC_KEY?.trim();
  if (configured) return configured;

  const publicKeyPath = readArg("public-key") || path.join(path.dirname(manifestPath), "release-public-key.pem");
  return readFile(publicKeyPath, "utf8").catch((error) => {
    if (envelope.signature) throw error;
    return undefined;
  });
}

function readArg(name) {
  const exact = process.argv.indexOf(`--${name}`);
  if (exact >= 0) return process.argv[exact + 1];
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function hasArg(name) {
  return process.argv.includes(`--${name}`);
}
