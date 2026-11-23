FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS builder

WORKDIR /source
RUN corepack enable && corepack prepare pnpm@11.29.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY integrations/codey-cms-mcp ./integrations/codey-cms-mcp
COPY scripts/build-mcp-package.mjs ./scripts/build-mcp-package.mjs
COPY src/mcp ./src/mcp
COPY src/modules/builder ./src/modules/builder
COPY src/modules/cms/custom-code.ts ./src/modules/cms/custom-code.ts
COPY src/modules/config/website-spec.schemas.ts ./src/modules/config/website-spec.schemas.ts
COPY src/modules/manifest.ts ./src/modules/manifest.ts
COPY src/core/types ./src/core/types
COPY src/runtime/release.ts ./src/runtime/release.ts
RUN pnpm run mcp:build

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx \
  /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
ENV NODE_ENV=production
ENV PORT=8787

LABEL org.opencontainers.image.title="CodeY CMS MCP" \
  org.opencontainers.image.source="https://github.com/fpointerdev/codey-cms" \
  org.opencontainers.image.licenses="GPL-2.0-or-later" \
  io.modelcontextprotocol.server.name="io.github.fpointerdev/codey-cms"

COPY --from=builder --chown=node:node /source/integrations/codey-cms-mcp/dist ./dist

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/healthz').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "dist/cli.mjs"]
CMD ["--http", "--host", "0.0.0.0", "--port", "8787"]
