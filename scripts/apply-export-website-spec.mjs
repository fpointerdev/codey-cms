import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specPath = path.resolve(
  root,
  process.env.CODEY_EXPORT_WEBSITE_SPEC_PATH || "codey/export/website-spec.json"
);
const markerPath = path.resolve(
  root,
  process.env.CODEY_EXPORT_APPLIED_MARKER_PATH || "storage/uploads/.codey-export-applied.json"
);
const runtime = resolveRuntime();
let prisma;

function resolveRuntime() {
  const distRoot = path.join(root, "dist", "src");
  if (existsSync(path.join(distRoot, "modules", "config", "website-spec.service.js"))) {
    return { root: distRoot, extension: "js" };
  }

  return { root: path.join(root, "src"), extension: "ts" };
}

async function importRuntime(relativePath) {
  return import(pathToFileURL(path.join(runtime.root, relativePath)).href);
}

async function loadRuntime() {
  const [configModule, prismaModule, loggerModule, websiteSpecModule] = await Promise.all([
    importRuntime(`config/index.${runtime.extension}`),
    importRuntime(`infrastructure/database/prisma.${runtime.extension}`),
    importRuntime(`infrastructure/logging/logger.${runtime.extension}`),
    importRuntime(`modules/config/website-spec.service.${runtime.extension}`)
  ]);

  prisma = prismaModule.prisma;
  return {
    config: configModule.config,
    prisma,
    logger: loggerModule.logger,
    applyWebsiteSpec: websiteSpecModule.applyWebsiteSpec
  };
}

async function userForAudit(prismaClient) {
  const email = process.env.CODEY_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const user = await prismaClient.user.findUnique({
    where: { email },
    select: { id: true }
  });

  return user ? { id: user.id } : undefined;
}

async function markerExists() {
  try {
    await access(markerPath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (process.env.CODEY_EXPORT_FORCE_APPLY !== "true" && await markerExists()) {
    console.log(JSON.stringify({
      source: "codey-export",
      applied: false,
      skipped: "already-applied"
    }));
    return;
  }

  const spec = JSON.parse(await readFile(specPath, "utf8"));
  const loaded = await loadRuntime();
  const result = await loaded.applyWebsiteSpec(
    { config: loaded.config, prisma: loaded.prisma, logger: loaded.logger },
    spec,
    await userForAudit(loaded.prisma)
  );
  await mkdir(path.dirname(markerPath), { recursive: true });
  const marker = {
    appliedAt: new Date().toISOString(),
    source: specPath,
    profile: result.plan.deploymentProfile,
    modules: result.plan.modules
  };
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);

  console.log(JSON.stringify({
    source: "codey-export",
    profile: result.plan.deploymentProfile,
    modules: result.plan.modules,
    applied: result.applied
  }));
}

main()
  .then(async () => {
    await prisma?.$disconnect();
  })
  .catch(async (error) => {
    console.error(error.message || error);
    await prisma?.$disconnect();
    process.exit(1);
  });
