import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanner = "aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb";
const directory = path.join(root, ".release/container-security");
await mkdir(directory, { recursive: true });

run(["build", "--target", "production", "-t", "codey-cms:security", "."]);
run(["build", "-f", "integrations/codey-cms-mcp/Dockerfile", "-t", "codey-cms-mcp:security", "."]);
run(["build", "-f", "Dockerfile.postgres", "-t", "codey-cms-postgres:security", "."]);
run(["build", "-f", "Dockerfile.caddy", "-t", "codey-cms-caddy:security", "."]);

let failed = false;
const cache = `codey-security-scan-${randomUUID()}`;
run(["volume", "create", "--label", "com.codey.security-scan=true", cache]);
try {
  for (const [name, image] of Object.entries({ cms: "codey-cms:security", mcp: "codey-cms-mcp:security", postgres: "codey-cms-postgres:security", caddy: "codey-cms-caddy:security" })) {
    const result = run([
      "run", "--rm", "--volume", "/var/run/docker.sock:/var/run/docker.sock:ro",
      "--volume", `${cache}:/root/.cache`, "--volume", `${directory}:/reports`, scanner, "image",
      "--scanners", "vuln", "--severity", "HIGH,CRITICAL", "--exit-code", "1", "--no-progress",
      "--format", "json", "--output", `/reports/${name}.json`, image
    ], true);
    if (result.status !== 0) failed = true;
  }
} finally {
  run(["volume", "rm", cache]);
}
if (failed) throw new Error("Container vulnerability qualification failed. Review .release/container-security/*.json; scanner errors also block release.");
console.log("All shipped container images passed the high/critical vulnerability gate.");

function run(args, allowFailure = false) {
  const result = spawnSync("docker", args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) throw new Error(`Docker ${args[0]} failed (${result.status}).`);
  return result;
}
