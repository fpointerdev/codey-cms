import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCommand } from "./test-runtime.mjs";

const auditDirectory = await mkdtemp(path.join(tmpdir(), "codey-cms-production-audit-"));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

try {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  // These dependencies ship in MCP/browser bundles, not server node_modules.
  for (const name of ["@modelcontextprotocol/sdk", "motion", "three"]) {
    packageJson.dependencies[name] = packageJson.devDependencies[name];
  }
  delete packageJson.devDependencies;
  delete packageJson.scripts;
  await writeFile(
    path.join(auditDirectory, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`
  );
  await copyFile("pnpm-lock.yaml", path.join(auditDirectory, "pnpm-lock.yaml"));
  await copyFile("pnpm-workspace.yaml", path.join(auditDirectory, "pnpm-workspace.yaml"));
  await runCommand(pnpm, [
    "--dir",
    auditDirectory,
    "install",
    "--prod",
    "--lockfile-only",
    "--ignore-scripts",
  ]);
  await runCommand(pnpm, ["--dir", auditDirectory, "audit", "--prod", "--audit-level", "high"]);
} finally {
  await rm(auditDirectory, { recursive: true, force: true });
}
