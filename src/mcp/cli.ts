#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createCodeyCmsMcpServer } from "./codey-cms-server.js";

const loopbackBindHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const loopbackAllowedHosts = ["127.0.0.1", "localhost", "[::1]"];

function option(name: string) {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function httpConfiguration() {
  const host = option("--host") ?? process.env.CODEY_MCP_HOST?.trim() ?? "127.0.0.1";
  const rawPort = option("--port") ?? process.env.PORT ?? "8787";
  const port = Number(rawPort);
  const allowedHosts = (process.env.CODEY_MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("The MCP HTTP port must be an integer between 1 and 65535.");
  }
  if (!loopbackBindHosts.has(host) && allowedHosts.length === 0) {
    throw new Error(
      "CODEY_MCP_ALLOWED_HOSTS is required when the MCP server binds outside loopback."
    );
  }

  return {
    host,
    port,
    allowedHosts: allowedHosts.length
      ? [...new Set([...loopbackAllowedHosts, ...allowedHosts])]
      : undefined
  };
}

async function serveHttp() {
  const { host, port, allowedHosts } = httpConfiguration();
  const app = createMcpExpressApp({ host, allowedHosts });

  app.get("/healthz", (_req, res) => {
    res.setHeader("cache-control", "no-store");
    res.json({ status: "ready", service: "codey-cms-mcp", access: "read-only" });
  });
  app.post("/mcp", async (req, res) => {
    const server = createCodeyCmsMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("CodeY CMS MCP request failed", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        });
      }
    }
  });
  app.all("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null
    });
  });

  app.listen(port, host, () => {
    console.error(`CodeY CMS read-only MCP server listening on http://${host}:${port}/mcp`);
  });
}

async function main() {
  if (process.argv.includes("--http")) {
    await serveHttp();
    return;
  }

  const server = createCodeyCmsMcpServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "CodeY CMS MCP failed to start.");
  process.exitCode = 1;
});
