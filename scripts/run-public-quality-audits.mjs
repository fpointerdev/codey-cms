import { spawn } from "node:child_process";
import { runCommand } from "./test-runtime.mjs";

const externalUrl = process.env.PUBLIC_AUDIT_URL?.replace(/\/+$/g, "");
const baseUrl = externalUrl || "http://127.0.0.1:4173";
let server;

async function waitForServer(url, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Quality server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${url}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${url}.`);
}

try {
  if (!externalUrl) {
    server = spawn(process.execPath, ["--import", "tsx", "scripts/start-lighthouse-server.mjs"], {
      env: process.env,
      stdio: "inherit"
    });
    await waitForServer(baseUrl, server);
  }

  await runCommand(process.execPath, ["scripts/audit-public-site.mjs", baseUrl], process.env);
  await runCommand("pnpm", ["run", "audit:lighthouse"], {
    ...process.env,
    LIGHTHOUSE_URL: `${baseUrl}/`
  });
} finally {
  if (server && server.exitCode === null && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("close", resolve));
  }
}
