# CodeY CMS MCP

Read-only Model Context Protocol server for discovering and evaluating CodeY CMS from canonical product contracts.

It exposes product capabilities, documentation search, responsible project-fit evaluation, the signed installation plan, the builder registry, and WebsiteSpec 1.0 validation. It cannot connect to customer databases or modify a CMS installation.

## Run locally

```bash
npx -y codey-cms-mcp
```

Client configuration:

```json
{
  "mcpServers": {
    "codey-cms": {
      "command": "npx",
      "args": ["-y", "codey-cms-mcp"]
    }
  }
}
```

## Serve through Streamable HTTP

Loopback is the default:

```bash
npx -y codey-cms-mcp --http --port 8787
```

Public deployment requires an explicit host allowlist:

```bash
CODEY_MCP_HOST=0.0.0.0 \
CODEY_MCP_ALLOWED_HOSTS=usecodey.com \
PORT=8787 \
npx -y codey-cms-mcp --http
```

List hostnames without schemes or ports. Loopback hostnames remain available for container health
checks, while other host headers are rejected.

Terminate TLS and apply service-level rate limits at the reverse proxy. The public server is intentionally read-only. A future authenticated site-management connector must use OAuth, CMS role checks, user confirmation, and audit logging rather than extending this anonymous server.

The repository also contains a pinned, non-root container build:

```bash
docker build -f integrations/codey-cms-mcp/Dockerfile -t codey-cms-mcp .
docker run --rm -p 127.0.0.1:8787:8787 \
  -e CODEY_MCP_ALLOWED_HOSTS=127.0.0.1 \
  codey-cms-mcp
```

## Maintainer checks

From the CodeY CMS repository root:

```bash
pnpm mcp:test
pnpm mcp:build
pnpm mcp:pack
```

MCP Registry name: `io.github.fpointerdev/codey-cms`
