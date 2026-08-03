import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const releaseDirectory = path.resolve(readArg("release-dir") || process.env.CODEY_RELEASE_OUTPUT_DIR || path.join(root, ".release"));
const archive = path.join(releaseDirectory, `codey-cms-${version}.zip`);
const releaseManifestPath = path.join(releaseDirectory, `codey-cms-${version}.manifest.json`);
const websiteSpecPath = path.resolve(
  readArg("website-spec") || path.join(root, "scripts", "fixtures", "exported-site-website-spec.json")
);
const reportPath = readArg("report") ? path.resolve(readArg("report")) : undefined;
const websiteSpec = await readJson(websiteSpecPath);
const generatedPage = websiteSpec.pages?.[0];
if (websiteSpec.version !== "1.0" || !generatedPage?.slug) {
  throw new Error("The acceptance WebsiteSpec must use version 1.0 and contain at least one page.");
}
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "codey-selfhost-qualification-"));
const extractedRoot = path.join(temporaryRoot, `codey-cms-${version}`);
const project = `codey-cms-qualification-${process.pid}`;
const imageTag = `qualification-${version}-${process.pid}`;
const acceptanceOverrideFile = ".codey-acceptance.override.yml";
const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const composeEnvironment = {
  ...process.env,
  API_PORT: String(port),
  APP_PUBLIC_URL: baseUrl,
  CORS_ORIGINS: baseUrl,
  CODEY_AUTO_UPDATE: "false",
  CODEY_CMS_IMAGE_TAG: imageTag,
  CODEY_COMPOSE_OVERRIDE_FILE: acceptanceOverrideFile,
  COMPOSE_PROJECT_NAME: project
};
let composeStarted = false;
let signatureVerified = false;

try {
  await run(process.execPath, [
    "scripts/verify-release.mjs",
    "--release-dir",
    releaseDirectory
  ], { cwd: root });
  const releaseEnvelope = await readJson(releaseManifestPath);
  signatureVerified = Boolean(releaseEnvelope.signature);

  const entries = (await capture("unzip", ["-Z1", archive], { cwd: root }))
    .split(/\r?\n/)
    .filter(Boolean);
  assertSafeArchiveEntries(entries, `codey-cms-${version}`);
  await run("unzip", ["-q", archive, "-d", temporaryRoot], { cwd: root });
  await assertPackage(extractedRoot, version, signatureVerified);
  await prepareWebsiteSpec(extractedRoot, websiteSpecPath, acceptanceOverrideFile);

  composeStarted = true;
  await run("sh", ["start-codey.sh", "--no-open"], {
    cwd: extractedRoot,
    env: composeEnvironment,
    capture: true
  });
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

  const initialReadiness = await requestJson("/api/v1/health/ready");
  if (initialReadiness.response.status !== 200 || initialReadiness.body.data?.status !== "ready") {
    throw new Error(`The extracted package did not report readiness: ${JSON.stringify(initialReadiness.body)}`);
  }

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
  const generatedEdit = await editGeneratedContent(
    accessToken,
    generatedPage.slug,
    websiteSpec.project?.locale || "en"
  );

  await compose(["restart", "backend"]);
  await waitForHttp(`${baseUrl}/api/v1/health/ready`, 120_000);

  const readinessAfterRestart = await requestJson("/api/v1/health/ready");
  if (readinessAfterRestart.response.status !== 200 || readinessAfterRestart.body.data?.status !== "ready") {
    throw new Error(`The restarted package did not report readiness: ${JSON.stringify(readinessAfterRestart.body)}`);
  }
  const installationAfterRestart = await requestJson("/api/v1/install/status");
  if (
    installationAfterRestart.response.status !== 200 ||
    installationAfterRestart.body.data?.installed !== true ||
    installationAfterRestart.body.data?.ownerAvailable !== true
  ) {
    throw new Error(`Installation state did not survive restart: ${JSON.stringify(installationAfterRestart.body)}`);
  }

  const generatedPublicPath = `/${generatedPage.slug}`;
  const generatedPublicPage = await fetch(`${baseUrl}${generatedPublicPath}`);
  const generatedPublicHtml = await generatedPublicPage.text();
  if (
    generatedPublicPage.status !== 200 ||
    !generatedPublicHtml.includes('data-server-rendered="true"') ||
    !generatedPublicHtml.includes(generatedEdit.marker)
  ) {
    throw new Error("The restarted package did not server-render the edited generated content.");
  }

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

  const restoredGeneratedPage = await fetch(`${baseUrl}${generatedPublicPath}`);
  const restoredGeneratedHtml = await restoredGeneratedPage.text();
  if (
    restoredGeneratedPage.status !== 200 ||
    !restoredGeneratedHtml.includes('data-server-rendered="true"') ||
    !restoredGeneratedHtml.includes(generatedEdit.marker)
  ) {
    throw new Error("The encrypted restore did not preserve the edited generated content.");
  }

  const report = {
    schemaVersion: 1,
    contract: "codey-cms.exported-site-acceptance",
    status: signatureVerified ? "passed" : "passed-local-unsigned",
    release: {
      version,
      channel: "stable",
      signatureVerified,
      archive: path.basename(archive)
    },
    launcher: {
      entrypoint: "start-codey.sh",
      compose: "docker-compose.selfhost.yml"
    },
    readiness: {
      initial: initialReadiness.body.data,
      afterRestart: readinessAfterRestart.body.data
    },
    installation: {
      initial: initialStatus.body.data,
      completed: installation.body.data,
      afterRestart: installationAfterRestart.body.data
    },
    websiteSpec: {
      version: websiteSpec.version,
      source: path.basename(websiteSpecPath),
      atomic: true,
      pageSlug: generatedPage.slug
    },
    admin: {
      login: "passed",
      edit: generatedEdit
    },
    publicPage: {
      path: generatedPublicPath,
      status: generatedPublicPage.status,
      serverRendered: true,
      editedContentAfterRestart: true
    },
    recovery: {
      encryptedBackup: true,
      restoredGeneratedEdit: true,
      restoredRecoveryMarker: true
    }
  };

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(`Qualified CodeY CMS ${version} from its downloadable self-host ZIP.`);
  console.log(`Generated import, admin edit, restart SSR, encrypted backup, and restore passed on port ${port}.`);
  console.log(JSON.stringify(report));
} catch (error) {
  if (composeStarted) {
    const diagnostics = [
      await compose(["ps", "-a"], { capture: true, allowFailure: true }),
      await compose(
        ["logs", "--no-color", "--tail", "200", "secrets", "postgres", "backend", "backup"],
        { capture: true, allowFailure: true }
      )
    ].filter(Boolean).join("\n");
    if (diagnostics) {
      console.error(diagnostics);
      if (reportPath) {
        const diagnosticsPath = path.join(path.dirname(reportPath), "qualification-diagnostics.log");
        await mkdir(path.dirname(diagnosticsPath), { recursive: true });
        await writeFile(diagnosticsPath, diagnostics, "utf8");
      }
    }
  }
  throw error;
} finally {
  if (composeStarted) {
    await compose(["down", "-v", "--remove-orphans"], { allowFailure: true });
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function prepareWebsiteSpec(directory, sourcePath, overrideFile) {
  const targetPath = path.join(directory, "codey", "export", "website-spec.json");
  await mkdir(path.dirname(targetPath), { recursive: true });
  if (sourcePath !== targetPath) await copyFile(sourcePath, targetPath);

  await writeFile(path.join(directory, overrideFile), [
    "services:",
    "  backend:",
    "    environment:",
    '      CODEY_EXPORT_APPLY_ON_START: "true"',
    "      CODEY_EXPORT_WEBSITE_SPEC_PATH: /codey-export/website-spec.json",
    "      CODEY_EXPORT_APPLIED_MARKER_PATH: /app/storage/uploads/.codey-export-applied.json",
    "    volumes:",
    "      - type: bind",
    "        source: ./codey/export/website-spec.json",
    "        target: /codey-export/website-spec.json",
    "        read_only: true",
    ""
  ].join("\n"), "utf8");
}

async function editGeneratedContent(accessToken, pageSlug, locale) {
  const authorization = { authorization: `Bearer ${accessToken}` };
  const localeQuery = `?locale=${encodeURIComponent(locale)}`;
  const pageResponse = await requestJson(
    `/api/v1/cms/pages/${encodeURIComponent(pageSlug)}${localeQuery}`,
    { headers: authorization }
  );
  const page = pageResponse.body.data?.page;
  if (pageResponse.response.status !== 200 || !page) {
    throw new Error(`The generated page was not imported: ${JSON.stringify(pageResponse.body)}`);
  }

  const blocks = Array.isArray(page.sections)
    ? page.sections.flatMap((section) => Array.isArray(section.blocks) ? section.blocks : [])
    : [];
  const textBlock = blocks.find((block) =>
    block.editable !== false && ["TEXT", "RICH_TEXT"].includes(block.type)
  );
  const marker = "CodeY exported edit persisted after restart.";

  if (textBlock) {
    const edit = await requestJson(
      `/api/v1/cms/pages/${encodeURIComponent(pageSlug)}/blocks/${encodeURIComponent(textBlock.key)}${localeQuery}`,
      {
        method: "PATCH",
        headers: authorization,
        body: JSON.stringify({
          value: textBlock.type === "RICH_TEXT" ? `<p>${marker}</p>` : marker
        })
      }
    );
    if (edit.response.status !== 200) {
      throw new Error(`Unable to edit generated content: ${JSON.stringify(edit.body)}`);
    }

    return {
      kind: "content-block",
      pageSlug,
      blockKey: textBlock.key,
      marker
    };
  }

  const edit = await requestJson(`/api/v1/cms/pages/${encodeURIComponent(pageSlug)}${localeQuery}`, {
    method: "PATCH",
    headers: authorization,
    body: JSON.stringify({
      title: marker,
      content: {
        ...(page.content && typeof page.content === "object" ? page.content : {}),
        hideTitle: false
      }
    })
  });
  if (edit.response.status !== 200) {
    throw new Error(`Unable to edit the generated page: ${JSON.stringify(edit.body)}`);
  }

  return {
    kind: "page-title",
    pageSlug,
    marker
  };
}

async function assertPackage(directory, expectedVersion, requirePublicKey) {
  const [runtime, packaged, license, notice, publicKey, caddyfile, publicCompose] = await Promise.all([
    readJson(path.join(directory, "codey-runtime.json")),
    readJson(path.join(directory, "package.json")),
    readFile(path.join(directory, "LICENSE"), "utf8"),
    readFile(path.join(directory, "NOTICE.md"), "utf8"),
    readFile(path.join(directory, "runtime-meta", "release-public-key.pem"), "utf8")
      .catch((error) => {
        if (!requirePublicKey && error.code === "ENOENT") return "";
        throw error;
      }),
    readFile(path.join(directory, "Caddyfile"), "utf8"),
    readFile(path.join(directory, "docker-compose.public.yml"), "utf8")
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
  if (
    (requirePublicKey && !publicKey.includes("BEGIN PUBLIC KEY")) ||
    publicKey.includes("PRIVATE KEY")
  ) {
    throw new Error("The extracted package does not contain a safe release verification key.");
  }
  if (
    runtime.contracts?.automaticTls !== "1.0" ||
    runtime.entrypoints?.publicCompose !== "docker-compose.public.yml" ||
    !caddyfile.includes("reverse_proxy backend:4000") ||
    !publicCompose.includes(runtime.supplyChain?.containerImages?.caddy || "missing-caddy-image")
  ) {
    throw new Error("The extracted package does not satisfy the automatic HTTPS contract.");
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
