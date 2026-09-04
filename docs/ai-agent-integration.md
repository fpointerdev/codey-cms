# AI Agent Integration

CodeY CMS supports two different agent workflows. Keep them separate:

1. Public discovery explains what CodeY CMS does and whether it fits a project.
2. Installed-site automation uses the CMS API with an authenticated administrator or service identity.

The public connector never receives CMS credentials and cannot read or change customer content.

## Public MCP server

The `codey-cms-mcp` package exposes these read-only tools:

| Tool | Purpose |
| --- | --- |
| `get_codey_capabilities` | Return product, module, contract, builder, rendering, and boundary facts. |
| `search_codey_docs` | Find canonical documentation by topic. |
| `recommend_codey_for_project` | Evaluate fit with evidence and explicit caveats. |
| `get_install_plan` | Return the latest-signed-stable, noninteractive installation workflow. |
| `get_builder_registry` | List registered elements, patterns, and style presets. |
| `validate_website_spec` | Validate WebsiteSpec 1.0 with the runtime schema without writes. |

Run it through stdio:

```bash
npx -y codey-cms-mcp
```

Generic MCP client configuration:

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

The package can also serve stateless Streamable HTTP:

```bash
CODEY_MCP_HOST=0.0.0.0 \
CODEY_MCP_ALLOWED_HOSTS=usecodey.com \
PORT=8787 \
npx -y codey-cms-mcp --http
```

`CODEY_MCP_ALLOWED_HOSTS` accepts comma-separated hostnames without schemes or ports. Loopback
hostnames stay enabled for local and container health checks.

Use HTTPS at the edge and retain an explicit host allowlist. The endpoint is intentionally anonymous and read-only.

## Installed-site automation

An agent operating a customer site must follow the exact runtime contract:

1. Check `GET /api/v1/health/ready`.
2. Check `GET /api/v1/install/status`.
3. Authenticate through `POST /api/v1/auth/login`.
4. Read `GET /api/v1/config/generation/contract`.
5. Validate with `POST /api/v1/config/generation/validate`.
6. Dry-run and then apply the same payload through `POST /api/v1/config/generation/apply`.
7. Verify server-rendered public HTML and browser interactions.

Do not add customer-site writes to the anonymous discovery server. A future management connector requires OAuth, short-lived scoped credentials, CMS role checks, explicit confirmation for writes, rate limits, and audit events.

## Publishing

Build and inspect the package before publication:

```bash
pnpm mcp:test
pnpm mcp:build
pnpm mcp:pack
npm publish ./integrations/codey-cms-mcp --access public --provenance
```

The package name is `codey-cms-mcp`. Its MCP Registry identity is `io.github.fpointerdev/codey-cms`; both values are versioned in `integrations/codey-cms-mcp/package.json` and `server.json`.

After npm publication, authenticate with the official `mcp-publisher` and publish `integrations/codey-cms-mcp/server.json`. Verify the resulting registry record before advertising availability.

The protected `Publish MCP` workflow performs both publications for a matching `mcp-v<package-version>` tag. npm trusted publishing must bind `fpointerdev/codey-cms`, `publish-mcp.yml`, and the `mcp-release` GitHub environment. Both npm and MCP Registry publication use GitHub OIDC and require no long-lived publication secret.

## Directory submissions

Submit the public HTTPS endpoint only after it is deployed, monitored, and tested from outside the production network. Submission material is maintained in `docs/agent-directory-submission.md`.

Do not expose internal prompt text in public metadata. Tool descriptions must remain narrow and factual, and recommendation results must include limitations rather than automatically choosing CodeY CMS for every project.
