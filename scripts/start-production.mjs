import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

run(process.execPath, ["scripts/build-prisma-schema.mjs"]);
run(process.execPath, [
  "node_modules/prisma/build/index.js",
  "migrate",
  "deploy",
  "--schema",
  "prisma/generated/schema.prisma"
]);

const exportSpecPath = path.resolve(
  root,
  process.env.CODEY_EXPORT_WEBSITE_SPEC_PATH || "codey/export/website-spec.json"
);
const exportApplyScript = path.join(root, "scripts", "apply-export-website-spec.mjs");

if (
  process.env.CODEY_EXPORT_APPLY_ON_START !== "false" &&
  existsSync(exportSpecPath) &&
  existsSync(exportApplyScript)
) {
  run(process.execPath, [exportApplyScript]);
}

const serverEntry = path.join(root, "dist", "src", "server.js");

if (!existsSync(serverEntry)) {
  throw new Error(`Compiled server entry was not found at ${path.relative(root, serverEntry)}.`);
}

await import(pathToFileURL(serverEntry).href);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${[command, ...args].join(" ")} exited with code ${result.status}.`);
  }
}
