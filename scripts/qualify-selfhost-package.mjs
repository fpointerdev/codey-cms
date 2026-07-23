import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const releaseDirectory = path.resolve(readArg("release-dir") || process.env.CODEY_RELEASE_OUTPUT_DIR || path.join(root, ".release"));
const archive = path.join(releaseDirectory, `codey-cms-${version}.zip`);
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codey-selfhost-qualification-"));
const extractedRoot = path.join(temporaryRoot, `codey-cms-${version}`);
const project = `codey-cms-qualification-${process.pid}`;
const imageTag = `qualification-${version}-${process.pid}`;
const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const composeEnvironment = {
  ...process.env,
  API_PORT: String(port),
  APP_PUBLIC_URL: baseUrl,
  CORS_ORIGINS: baseUrl,
  CODEY_AUTO_UPDATE: "false",
  CODEY_CMS_IMAGE_TAG: imageTag
};
let composeStarted = false;

try {
  await run(process.execPath, [
    "scripts/verify-release.mjs",
    "--release-dir",
    releaseDirectory
  ], { cwd: root });

  const entries = (await capture("unzip", ["-Z1", archive], { cwd: root }))
    .split(/\r?\n/)
    .filter(Boolean);
  assertSafeArchiveEntries(entries, `codey-cms-${version}`);
  await run("unzip", ["-q", archive, "-d", temporaryRoot], { cwd: root });
  await assertPackage(extractedRoot, version);

  composeStarted = true;
  await compose(["up", "-d", "--build", "--wait", "--wait-timeout", "240"]);
  const installToken = (await compose([
    "run",
    "--rm",
    "--no-deps",
    "secrets",
    "node",
    "scripts/init-selfhost-secrets.mjs",
    "--print-install-token"
  ], { capture: true })).trim();
  if (installToken.length < 32) throw new Error("The package did not produce a valid installation token.");

  const initialStatus = await requestJson("/api/v1/install/status");
  if (initialStatus.response.status !== 200 || initialStatus.body.data?.installed !== false) {
    throw new Error("The extracted package did not start in first-run installation mode.");
  }

  const ownerEmail = `qualification-${process.pid}@example.com`;
  const ownerPassword = "QualificationOwner123!";
  const installation = await requestJson("/api/v1/install/complete", {
    method: "POST",
    body: JSON.stringify({
      claimToken: installToken,
      siteName: "CodeY Release Qualification",
      profile: "cms",
      searchIndexing: false,
      admin: {
        name: "Release Owner",
        email: ownerEmail,
        password: ownerPassword
      }
    })
  });
  if (installation.response.status !== 201) {
    throw new Error(`First-run installation failed: ${JSON.stringify(installation.body)}`);
  }

  const accessToken = await login(ownerEmail, ownerPassword);
  const slug = `release-recovery-${process.pid}`;
  const createPage = await requestJson("/api/v1/cms/pages", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      title: "Release recovery marker",
      slug,
      excerpt: "Created during self-host release qualification.",
      content: {},
      status: "PUBLISHED",
      sections: [{
        key: "content",
        label: "Content",
        blocks: [{
          key: "body",
          type: "RICH_TEXT",
          label: "Body",
          value: "<p>Verified self-host release content.</p>"
        }]
      }]
    })
  });
  if (createPage.response.status !== 201) {
    throw new Error(`Unable to create the recovery marker: ${JSON.stringify(createPage.body)}`);
  }

  await compose([
    "exec",
    "-T",
    "backend",
    "node",
    "scripts/run-with-runtime-secrets.mjs",
    "--",
    "node",
    "scripts/backup-runtime.mjs"
  ]);
  const latest = JSON.parse(await compose([
    "exec",
    "-T",
    "backend",
    "node",
    "--input-type=module",
    "--eval",
    "import {readFile} from 'node:fs/promises'; process.stdout.write(await readFile('/app/backups/latest.json','utf8'));"
  ], { capture: true }));
  if (latest.status !== "success" || !latest.encrypted || !latest.manifestFile) {
    throw new Error("The release package did not create a successful encrypted backup.");
  }

  const deletePage = await requestJson(`/api/v1/cms/pages/${slug}/archive`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: "{}"
  });
  if (deletePage.response.status !== 200) {
    throw new Error(`Unable to remove the recovery marker: ${JSON.stringify(deletePage.body)}`);
  }
  if ((await fetch(`${baseUrl}/${slug}`)).status !== 404) {
    throw new Error("The recovery marker remained public after deletion.");
  }

  await compose(["stop", "backend", "backup"]);
  await compose([
    "run",
    "--rm",
    "--no-deps",
    "-e",
    "ALLOW_PRODUCTION_RESTORE=true",
    "-e",
    "RESTORE_MEDIA=true",
    "-e",
    "RESTORE_REPLACE_MEDIA=true",
    "backend",
    "node",
    "scripts/run-with-runtime-secrets.mjs",
    "--",
    "node",
    "scripts/restore-runtime.mjs",
    `/app/backups/${latest.manifestFile}`
  ]);
  await compose(["start", "backend"]);
  await waitForHttp(`${baseUrl}/api/v1/health/ready`, 120_000);

  const restoredPage = await fetch(`${baseUrl}/${slug}`);
  if (restoredPage.status !== 200 || !await restoredPage.text().then((body) => body.includes("Verified self-host release content."))) {
    throw new Error("The restored self-host package did not recover its public CMS content.");
  }

  console.log(`Qualified CodeY CMS ${version} from its downloadable self-host ZIP.`);
  console.log(`First-run installation, encrypted backup, restore, and public recovery passed on port ${port}.`);
} finally {
  if (composeStarted) {
    await compose(["down", "-v", "--remove-orphans"], { allowFailure: true });
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function assertPackage(directory, expectedVersion) {
  const [runtime, packaged, license, notice, publicKey] = await Promise.all([
    readJson(path.join(directory, "codey-runtime.json")),
    readJson(path.join(directory, "package.json")),
    readFile(path.join(directory, "LICENSE"), "utf8"),
    readFile(path.join(directory, "NOTICE.md"), "utf8"),
    readFile(path.join(directory, "runtime-meta", "release-public-key.pem"), "utf8")
  ]);

  if (runtime?.version !== expectedVersion || runtime?.channel !== "stable") {
    throw new Error("The extracted runtime metadata does not match the release version.");
  }
  if (packaged?.version !== expectedVersion || packaged?.license !== "GPL-2.0-or-later") {
    throw new Error("The extracted package metadata is invalid.");
  }
  if (!license.includes("GNU GENERAL PUBLIC LICENSE") || !notice.includes("CodeY CMS Legal Notice")) {
    throw new Error("The extracted package is missing its legal notices.");
  }
  if (!publicKey.includes("BEGIN PUBLIC KEY") || publicKey.includes("PRIVATE KEY")) {
    throw new Error("The extracted package does not contain a safe release verification key.");
  }
}

function assertSafeArchiveEntries(entries, expectedRoot) {
  if (entries.length === 0) throw new Error("The self-host ZIP is empty.");

  for (const entry of entries) {
    const normalized = entry.replace(/\/$/, "");
    const segments = normalized.split("/");
    if (
      entry.includes("\\") ||
      path.posix.isAbsolute(entry) ||
      segments.includes("..") ||
      (normalized !== expectedRoot && !normalized.startsWith(`${expectedRoot}/`))
    ) {
      throw new Error(`The self-host ZIP contains an unsafe path: ${entry}`);
    }
  }
}

async function login(email, password) {
  const loginResponse = await requestJson("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  const accessToken = loginResponse.body.data?.tokens?.accessToken;
  if (loginResponse.response.status !== 200 || typeof accessToken !== "string") {
    throw new Error(`Release owner login failed: ${JSON.stringify(loginResponse.body)}`);
  }
  return accessToken;
}

async function requestJson(pathname, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function compose(args, options = {}) {
  return command(
    "docker",
    ["compose", "-p", project, "-f", "docker-compose.selfhost.yml", ...args],
    { ...options, cwd: extractedRoot, env: composeEnvironment }
  );
}

function run(commandName, args, options = {}) {
  return command(commandName, args, options).then(() => undefined);
}

function capture(commandName, args, options = {}) {
  return command(commandName, args, { ...options, capture: true });
}

function command(commandName, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: options.cwd || root,
      env: options.env || process.env,
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
      if (code === 0 || options.allowFailure) resolve(options.capture ? stdout : "");
      else reject(new Error(`${commandName} ${args.join(" ")} exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      lastStatus = response.status;
      if (response.ok) return;
    } catch {
      lastStatus = "unavailable";
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for ${url}; last status was ${lastStatus}.`);
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function readArg(name) {
  const exact = process.argv.indexOf(`--${name}`);
  if (exact >= 0) return process.argv[exact + 1];
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
