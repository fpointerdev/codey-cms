import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = process.cwd();
const outputDirectory = resolve(root, "integrations/codey-cms-mcp/dist");
const outputFile = resolve(outputDirectory, "cli.mjs");
const packageDirectory = resolve(root, "integrations/codey-cms-mcp");
const packageJson = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8"));
const serverJson = JSON.parse(await readFile(resolve(packageDirectory, "server.json"), "utf8"));

if (packageJson.version !== serverJson.version) {
  throw new Error("MCP package.json and server.json versions must match.");
}
if (packageJson.mcpName !== serverJson.name) {
  throw new Error("MCP package.json mcpName and server.json name must match.");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [resolve(root, "src/mcp/cli.ts")],
  outfile: outputFile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  banner: {
    js: 'import { createRequire as __codeyCreateRequire } from "node:module"; const require = __codeyCreateRequire(import.meta.url);'
  },
  define: { CODEY_CMS_MCP_VERSION: JSON.stringify(packageJson.version) },
  minify: false,
  sourcemap: false,
  legalComments: "external"
});
await chmod(outputFile, 0o755);

const client = new Client({ name: "codey-cms-package-smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [outputFile] }));
const tools = await client.listTools();
await client.close();

if (tools.tools.length !== 6 || tools.tools.some((tool) => tool.annotations?.readOnlyHint !== true)) {
  throw new Error("The bundled MCP package did not expose the expected read-only tool contract.");
}

try {
  await promisify(execFile)(process.execPath, [outputFile, "--http", "--host", "0.0.0.0"]);
  throw new Error("The MCP package accepted a public bind without an explicit host allowlist.");
} catch (error) {
  const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
  if (!stderr.includes("CODEY_MCP_ALLOWED_HOSTS is required")) throw error;
}

const port = await new Promise((resolvePort, reject) => {
  const listener = createServer();
  listener.once("error", reject);
  listener.listen(0, "127.0.0.1", () => {
    const address = listener.address();
    if (!address || typeof address === "string") {
      listener.close();
      reject(new Error("Could not reserve an MCP smoke-test port."));
      return;
    }
    listener.close((error) => (error ? reject(error) : resolvePort(address.port)));
  });
});
const httpProcess = spawn(
  process.execPath,
  [outputFile, "--http", "--host", "0.0.0.0", "--port", String(port)],
  {
    env: { ...process.env, CODEY_MCP_ALLOWED_HOSTS: "usecodey.com" },
    stdio: ["ignore", "ignore", "pipe"]
  }
);
let httpStderr = "";
httpProcess.stderr.on("data", (chunk) => {
  httpStderr = `${httpStderr}${chunk}`.slice(-10_000);
});

try {
  let health;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (httpProcess.exitCode !== null) {
      throw new Error(`The MCP HTTP smoke test exited early.\n${httpStderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // The listener may still be starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  if (health?.status !== "ready" || health?.access !== "read-only") {
    throw new Error(`The MCP HTTP health contract failed.\n${httpStderr}`);
  }
} finally {
  if (httpProcess.exitCode === null) {
    httpProcess.kill("SIGTERM");
    await Promise.race([
      once(httpProcess, "exit"),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000))
    ]);
  }
  if (httpProcess.exitCode === null) httpProcess.kill("SIGKILL");
}

console.log(`Built and verified ${outputFile}`);
