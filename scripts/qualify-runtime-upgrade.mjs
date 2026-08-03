import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:net";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareSemver,
  createSignedRelease,
  sha256File
} from "./release-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const releaseDirectory = path.resolve(readArg("release-dir") || path.join(root, ".release"));
const candidateManifest = JSON.parse(await readFile(
  path.join(releaseDirectory, `codey-cms-${version}.manifest.json`),
  "utf8"
));
const candidateArtifact = path.join(releaseDirectory, candidateManifest.payload.artifact.file);
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codey-upgrade-qualification-"));
const previousArchive = path.join(temporaryRoot, "previous.zip");
const previousRoot = path.join(temporaryRoot, "previous");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

try {
  const previousRelease = await resolvePreviousRelease();
  if (compareSemver(previousRelease.version, version) >= 0) {
    throw new Error(`Previous release ${previousRelease.version} must be older than candidate ${version}.`);
  }
  await download(previousRelease.archiveUrl, previousArchive);
  await mkdir(previousRoot, { recursive: true });
  await run("unzip", ["-q", previousArchive, "-d", previousRoot]);
  const extractedPreviousRoot = path.join(previousRoot, `codey-cms-${previousRelease.version}`);
  const previousPackage = JSON.parse(await readFile(path.join(extractedPreviousRoot, "package.json"), "utf8"));
  if (previousPackage.version !== previousRelease.version) {
    throw new Error("Previous release ZIP contains unexpected package metadata.");
  }

  const successFixture = await createCandidateFixture("success", candidateArtifact, candidateManifest.payload);
  const rollbackFixture = await createCandidateFixture("rollback", candidateArtifact, candidateManifest.payload, true);
  const success = await qualifyScenario({
    name: "success",
    previousRoot: extractedPreviousRoot,
    previousVersion: previousRelease.version,
    fixture: successFixture,
    expectedStatus: "succeeded"
  });
  const rollback = await qualifyScenario({
    name: "rollback",
    previousRoot: extractedPreviousRoot,
    previousVersion: previousRelease.version,
    fixture: rollbackFixture,
    expectedStatus: "rolled_back"
  });

  const report = {
    schemaVersion: 1,
    contract: "codey-cms.runtime-upgrade-acceptance",
    status: "passed",
    previousVersion: previousRelease.version,
    candidateVersion: version,
    signature: "ephemeral-qualification-key",
    successfulUpdate: success,
    forcedFailureRollback: rollback
  };
  const reportPath = path.resolve(readArg("report") || path.join(releaseDirectory, "upgrade-qualification-report.json"));
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Qualified runtime update ${previousRelease.version} -> ${version}, including forced rollback.`);
  console.log(JSON.stringify(report));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function resolvePreviousRelease() {
  const requestedTag = readArg("previous-tag") || process.env.CODEY_PREVIOUS_RELEASE_TAG?.trim();
  const endpoint = requestedTag
    ? `https://api.github.com/repos/fpointerdev/codey-cms/releases/tags/${encodeURIComponent(requestedTag)}`
    : "https://api.github.com/repos/fpointerdev/codey-cms/releases/latest";
  const response = await fetch(endpoint, {
    headers: { accept: "application/vnd.github+json", "user-agent": "codey-cms-release-qualifier" },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Unable to resolve previous stable release (${response.status}).`);
  const release = await response.json();
  const previousVersion = String(release.tag_name || "").replace(/^v/, "");
  const assetName = `codey-cms-${previousVersion}.zip`;
  const asset = release.assets?.find((item) => item.name === assetName);
  if (!asset?.browser_download_url) throw new Error(`Previous release is missing ${assetName}.`);
  return { version: previousVersion, archiveUrl: asset.browser_download_url };
}

async function createCandidateFixture(name, sourceArtifact, payload, breakRuntime = false) {
  const directory = path.join(temporaryRoot, `candidate-${name}`);
  const artifactPath = path.join(directory, payload.artifact.file);
  await mkdir(directory, { recursive: true });

  if (breakRuntime) {
    const extracted = path.join(directory, "extracted");
    await mkdir(extracted, { recursive: true });
    await run("tar", ["-xzf", sourceArtifact, "-C", extracted]);
    const serverEntry = path.join(extracted, `codey-cms-${version}`, "dist", "src", "server.js");
    await writeFile(serverEntry, 'throw new Error("Forced runtime qualification failure");\n', "utf8");
    await run("tar", ["-czf", artifactPath, "-C", extracted, `codey-cms-${version}`]);
    await rm(extracted, { recursive: true, force: true });
  } else {
    await cp(sourceArtifact, artifactPath);
  }

  const artifactStats = await stat(artifactPath);
  const fixturePayload = structuredClone(payload);
  fixturePayload.artifact = {
    ...fixturePayload.artifact,
    sizeBytes: artifactStats.size,
    sha256: await sha256File(artifactPath)
  };
  const { envelope } = createSignedRelease(fixturePayload, privateKey);
  const manifestPath = path.join(directory, `codey-cms-${version}.manifest.json`);
  await writeFile(manifestPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  await writeFile(path.join(directory, "release-public-key.pem"), publicKeyPem, "utf8");

  return { directory, artifactPath, manifestPath };
}

async function qualifyScenario({ name, previousRoot, previousVersion, fixture, expectedStatus }) {
  const scenarioRoot = path.join(temporaryRoot, `scenario-${name}`);
  await cp(previousRoot, scenarioRoot, { recursive: true });
  const port = await availablePort();
  const project = `codey-upgrade-${name}-${process.pid}`;
  const overrideFile = ".codey-upgrade.override.yml";
  const baseUrl = `http://127.0.0.1:${port}`;
  const marker = `Upgrade ${name} marker ${process.pid}`;
  const imageTag = `upgrade-from-${previousVersion}`;
  const environment = {
    ...process.env,
    API_PORT: String(port),
    APP_PUBLIC_URL: baseUrl,
    CORS_ORIGINS: baseUrl,
    CODEY_AUTO_UPDATE: "false",
    CODEY_CMS_IMAGE_TAG: imageTag,
    CODEY_COMPOSE_OVERRIDE_FILE: overrideFile,
    COMPOSE_PROJECT_NAME: project
  };
  let started = false;

  await writeFile(path.join(scenarioRoot, overrideFile), [
    "services:",
    "  backend:",
    "    environment:",
    "      CODEY_AUTO_UPDATE: \"false\"",
    "      CODEY_RELEASE_PUBLIC_KEY_FILE: /qualification/release-public-key.pem",
    "      COREPACK_HOME: /runtime/corepack",
    "      PNPM_HOME: /runtime/pnpm",
    "      XDG_CACHE_HOME: /runtime/xdg-cache",
    "      XDG_CONFIG_HOME: /runtime/xdg-config",
    "      XDG_DATA_HOME: /runtime/xdg-data",
    "    volumes:",
    "      - type: bind",
    `        source: ${JSON.stringify(fixture.directory)}`,
    "        target: /qualification",
    "        read_only: true",
    ""
  ].join("\n"), "utf8");

  const compose = (args, options = {}) => command(
    "docker",
    ["compose", "-p", project, "-f", "docker-compose.selfhost.yml", "-f", overrideFile, ...args],
    { cwd: scenarioRoot, env: environment, ...options }
  );

  try {
    started = true;
    await command("sh", ["start-codey.sh", "--no-open"], {
      cwd: scenarioRoot,
      env: environment,
      capture: true
    });
    const installToken = (await compose([
      "run", "--rm", "--no-deps", "secrets", "node", "scripts/init-selfhost-secrets.mjs", "--print-install-token"
    ], { capture: true })).trim();
    const email = `upgrade-${name}-${process.pid}@example.com`;
    const password = "UpgradeQualification123!";
    const installation = await requestJson(baseUrl, "/api/v1/install/complete", {
      method: "POST",
      body: JSON.stringify({
        claimToken: installToken,
        siteName: `Upgrade qualification ${name}`,
        profile: "cms",
        searchIndexing: false,
        admin: { name: "Upgrade Owner", email, password }
      })
    });
    if (installation.response.status !== 201) throw new Error(`Previous release installation failed: ${JSON.stringify(installation.body)}`);
    const accessToken = await login(baseUrl, email, password);
    const slug = `upgrade-${name}-${process.pid}`;
    const created = await requestJson(baseUrl, "/api/v1/cms/pages", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        title: marker,
        slug,
        content: {},
        status: "PUBLISHED",
        sections: [{ key: "content", label: "Content", blocks: [{
          key: "body",
          type: "RICH_TEXT",
          label: "Body",
          value: `<p>${marker}</p>`
        }] }]
      })
    });
    if (created.response.status !== 201) throw new Error(`Unable to create upgrade marker: ${JSON.stringify(created.body)}`);

    const stageScript = [
      "import { PrismaClient } from '@prisma/client';",
      "import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';",
      "const prisma = new PrismaClient();",
      `const artifactName = ${JSON.stringify(path.basename(fixture.artifactPath))};`,
      `const manifestName = ${JSON.stringify(path.basename(fixture.manifestPath))};`,
      "const updateDir = '/runtime/updates/qualification';",
      "await mkdir(updateDir, { recursive: true });",
      "await copyFile(`/qualification/${artifactName}`, `${updateDir}/${artifactName}`);",
      "await copyFile(`/qualification/${manifestName}`, `${updateDir}/${manifestName}`);",
      "const envelope = JSON.parse(await readFile(`${updateDir}/${manifestName}`, 'utf8'));",
      `const update = await prisma.runtimeUpdate.create({ data: { fromVersion: ${JSON.stringify(previousVersion)}, toVersion: ${JSON.stringify(version)}, status: 'STAGED', releaseManifest: envelope } });`,
      "await mkdir('/runtime/control', { recursive: true });",
      `await writeFile('/runtime/control/pending-update.json', JSON.stringify({ schemaVersion: 1, updateId: update.id, fromVersion: ${JSON.stringify(previousVersion)}, toVersion: ${JSON.stringify(version)}, artifactPath: updateDir + '/' + artifactName, manifestPath: updateDir + '/' + manifestName, requestedAt: new Date().toISOString() }));`,
      "await prisma.$disconnect();"
    ].join("\n");
    await compose([
      "exec", "-T", "backend",
      "node", "scripts/run-with-runtime-secrets.mjs", "--",
      "node", "--input-type=module", "--eval", stageScript
    ]);

    const status = await waitForUpdate(compose, expectedStatus, 180_000);
    await waitForHttp(`${baseUrl}/api/v1/health/ready`, 120_000);
    const publicPage = await fetch(`${baseUrl}/${slug}`);
    const publicHtml = await publicPage.text();
    if (publicPage.status !== 200 || !publicHtml.includes(marker) || !publicHtml.includes('data-server-rendered="true"')) {
      throw new Error(`Content did not survive the ${name} update scenario.`);
    }
    const currentPackageVersion = (await compose([
      "exec", "-T", "backend", "node", "--input-type=module", "--eval",
      "import {readFile} from 'node:fs/promises'; import {readlink} from 'node:fs/promises'; const target=await readlink('/runtime/current'); process.stdout.write(JSON.parse(await readFile(`/runtime/${target}/package.json`,'utf8')).version);"
    ], { capture: true })).trim();
    const expectedVersion = expectedStatus === "succeeded" ? version : previousVersion;
    if (currentPackageVersion !== expectedVersion) {
      throw new Error(`Expected active runtime ${expectedVersion}, received ${currentPackageVersion}.`);
    }

    return {
      status: status.status,
      activeVersion: currentPackageVersion,
      databaseRestored: expectedStatus === "rolled_back",
      serverRenderedContentPreserved: true
    };
  } catch (error) {
    const logs = await compose(["logs", "--no-color", "backend"], {
      capture: true,
      allowFailure: true
    });
    if (logs.trim()) console.error(logs.slice(-12_000));
    throw error;
  } finally {
    if (started) await compose(["down", "-v", "--remove-orphans"], { allowFailure: true });
  }
}

async function waitForUpdate(compose, expectedStatus, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    const output = await compose([
      "exec", "-T", "backend", "node", "--input-type=module", "--eval",
      "import {readFile} from 'node:fs/promises'; process.stdout.write(await readFile('/runtime/control/update-status.json','utf8').catch(()=>''));"
    ], { capture: true, allowFailure: true });
    if (output.trim()) {
      latest = JSON.parse(output);
      if (latest.status === expectedStatus) return latest;
      if (["failed", "rolled_back", "succeeded"].includes(latest.status)) {
        throw new Error(`Update ended with ${latest.status}, expected ${expectedStatus}: ${latest.error || "no error"}`);
      }
    }
    await wait(1_000);
  }
  throw new Error(`Timed out waiting for ${expectedStatus}: ${JSON.stringify(latest)}`);
}

async function login(baseUrl, email, password) {
  const result = await requestJson(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  const accessToken = result.body.data?.tokens?.accessToken;
  if (result.response.status !== 200 || !accessToken) throw new Error("Upgrade owner login failed.");
  return accessToken;
}

async function requestJson(baseUrl, pathname, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  return { response, body: await response.json().catch(() => ({})) };
}

async function download(url, target) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "codey-cms-release-qualifier" },
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok) throw new Error(`Unable to download previous release (${response.status}).`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

function run(commandName, args, options = {}) {
  return command(commandName, args, options).then(() => undefined);
}

function command(commandName, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: options.cwd || root,
      env: { ...(options.env || process.env), COPYFILE_DISABLE: "1" },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) resolve(stdout);
      else reject(new Error(`${commandName} ${args.join(" ")} exited with code ${code}: ${stderr.slice(-3000)}`));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
    } catch {
      // The runtime is expected to be unavailable while the supervisor switches releases.
    }
    await wait(1_000);
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readArg(name) {
  const exact = process.argv.indexOf(`--${name}`);
  if (exact >= 0) return process.argv[exact + 1];
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
