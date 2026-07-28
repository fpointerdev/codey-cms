import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSignedRelease,
  createUnsignedRelease,
  releasePublicKey,
  releaseSchemaVersion,
  sha256File
} from "./release-contract.mjs";
import { assertProductionSbom, createProductionSbom } from "./sbom.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const outputDir = path.resolve(readArg("output") || process.env.CODEY_RELEASE_OUTPUT_DIR || path.join(root, ".release"));
const allowUnsigned = hasArg("allow-unsigned") || process.env.CODEY_RELEASE_ALLOW_UNSIGNED === "true";
const allowDirty = hasArg("allow-dirty") || process.env.CODEY_RELEASE_ALLOW_DIRTY === "true";
const releasedAt = releaseTimestamp();
const gitSha = gitOutput(["rev-parse", "HEAD"]) || "unknown";
const baseUrl = (readArg("base-url") || process.env.CODEY_RELEASE_BASE_URL ||
  `https://github.com/fpointerdev/codey-cms/releases/download/v${version}`).replace(/\/$/, "");

assertTagMatchesVersion();

if (!allowDirty && gitOutput(["status", "--porcelain"])) {
  throw new Error("Release builds require a clean working tree. Commit changes or pass --allow-dirty for local verification.");
}

const migrations = (await readdir(path.join(root, "prisma", "migrations"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
  .map((entry) => entry.name)
  .sort();
const artifactFile = `codey-cms-${version}.tar.gz`;
const downloadFile = `codey-cms-${version}.zip`;
const manifestFile = `codey-cms-${version}.manifest.json`;
const sbomFile = `codey-cms-${version}.sbom.cdx.json`;
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codey-cms-release-"));
const stageRoot = path.join(temporaryRoot, `codey-cms-${version}`);
const containerImages = JSON.parse(await readFile(path.join(root, "runtime-meta", "container-images.json"), "utf8"));

try {
  assertSafeOutputDirectory();
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(stageRoot, { recursive: true });

  for (const item of releaseFiles()) {
    const source = path.join(root, item);
    const target = path.join(stageRoot, item);
    await cp(source, target, { recursive: true, dereference: true });
  }

  if (process.env.CODEY_RELEASE_PRIVATE_KEY?.trim()) {
    await mkdir(path.join(stageRoot, "runtime-meta"), { recursive: true });
    await writeFile(
      path.join(stageRoot, "runtime-meta", "release-public-key.pem"),
      releasePublicKey(process.env.CODEY_RELEASE_PRIVATE_KEY),
      "utf8"
    );
  }

  const runtimeManifest = {
    schemaVersion: releaseSchemaVersion,
    product: "codey-cms",
    version,
    channel: "stable",
    gitSha,
    releasedAt,
    contracts: {
      websiteSpec: "1.0",
      builder: "1.0",
      exportedSiteAcceptance: "1.0",
      operationalDiagnostics: "1.0",
      offsiteBackupReadiness: "1.0",
      supplyChain: "1.0"
    },
    requirements: {
      node: ">=24 <25",
      pnpm: ">=11 <12",
      postgres: ">=16",
      containerRuntime: "Docker Compose v2"
    },
    migrations: {
      count: migrations.length,
      latest: migrations.at(-1) || null
    },
    entrypoints: {
      compose: "docker-compose.selfhost.yml",
      installer: "/install",
      admin: "/cy-admin",
      readiness: "/api/v1/health/ready"
    },
    supplyChain: {
      source: {
        repository: "https://github.com/fpointerdev/codey-cms",
        commit: gitSha
      },
      containerImages: {
        node: containerImages.node,
        postgres: containerImages.postgres
      },
      sbom: "SBOM.cdx.json"
    }
  };
  await writeJson(path.join(stageRoot, "codey-runtime.json"), runtimeManifest);

  const sbom = createProductionSbom({
    name: packageJson.name,
    version,
    timestamp: releasedAt,
    commit: gitSha
  }, root);
  assertProductionSbom(sbom, { name: packageJson.name, version, commit: gitSha });
  const sbomPath = path.join(outputDir, sbomFile);
  await writeJson(sbomPath, sbom);
  await cp(sbomPath, path.join(stageRoot, "SBOM.cdx.json"));

  const artifactPath = path.join(outputDir, artifactFile);
  run("tar", ["-czf", artifactPath, "-C", temporaryRoot, path.basename(stageRoot)]);
  const artifactStats = await stat(artifactPath);
  const downloadPath = path.join(outputDir, downloadFile);
  run("zip", ["-qr", downloadPath, path.basename(stageRoot)], temporaryRoot);
  const downloadStats = await stat(downloadPath);
  const sbomStats = await stat(sbomPath);
  const payload = {
    ...runtimeManifest,
    artifact: {
      file: artifactFile,
      url: `${baseUrl}/${artifactFile}`,
      sizeBytes: artifactStats.size,
      sha256: await sha256File(artifactPath)
    },
    downloads: {
      selfHostedZip: {
        file: downloadFile,
        url: `${baseUrl}/${downloadFile}`,
        sizeBytes: downloadStats.size,
        sha256: await sha256File(downloadPath)
      }
    },
    supplyChain: {
      ...runtimeManifest.supplyChain,
      sbom: {
        file: sbomFile,
        url: `${baseUrl}/${sbomFile}`,
        sizeBytes: sbomStats.size,
        sha256: await sha256File(sbomPath)
      }
    }
  };

  let envelope;
  let publicKey;
  if (process.env.CODEY_RELEASE_PRIVATE_KEY?.trim()) {
    ({ envelope, publicKey } = createSignedRelease(payload, process.env.CODEY_RELEASE_PRIVATE_KEY));
  } else if (allowUnsigned) {
    envelope = createUnsignedRelease(payload);
  } else {
    throw new Error("CODEY_RELEASE_PRIVATE_KEY is required. Use --allow-unsigned only for local qualification.");
  }

  await writeJson(path.join(outputDir, manifestFile), envelope);
  await writeJson(path.join(outputDir, "stable.json"), {
    schemaVersion: releaseSchemaVersion,
    channel: "stable",
    version,
    releasedAt,
    manifestUrl: `${baseUrl}/${manifestFile}`,
    manifest: envelope
  });
  await writeFile(
    path.join(outputDir, "SHA256SUMS"),
    `${payload.artifact.sha256}  ${artifactFile}\n${payload.downloads.selfHostedZip.sha256}  ${downloadFile}\n${payload.supplyChain.sbom.sha256}  ${sbomFile}\n`,
    "utf8"
  );
  if (publicKey) await writeFile(path.join(outputDir, "release-public-key.pem"), publicKey, "utf8");

  console.log(`Release ${version} built in ${path.relative(root, outputDir) || "."}.`);
  console.log(`${artifactFile}  ${payload.artifact.sha256}`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function releaseFiles() {
  return [
    ".env.production.example",
    ".dockerignore",
    "Dockerfile",
    "LICENSE",
    "NOTICE.md",
    "README.md",
    "apps/web",
    "dist",
    "docker-compose.prod.yml",
    "docker-compose.selfhost.yml",
    "docs",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "prisma",
    "runtime-meta",
    "scripts",
    "start-codey.cmd",
    "start-codey.sh",
    "src",
    "tsconfig.build.json",
    "tsconfig.json"
  ];
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}.`);
}

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function releaseTimestamp() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) return new Date(Number(epoch) * 1000).toISOString();
  return new Date().toISOString();
}

function assertTagMatchesVersion() {
  const tag = process.env.GITHUB_REF_NAME?.trim();
  if (tag?.startsWith("v") && tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} does not match package version ${version}.`);
  }
}

function assertSafeOutputDirectory() {
  if (outputDir === root || outputDir === path.parse(outputDir).root) {
    throw new Error("Release output must use a dedicated directory, not the repository root.");
  }
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

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
