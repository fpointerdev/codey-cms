FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS base

WORKDIR /app

ENV COREPACK_HOME=/runtime/corepack
ENV PNPM_HOME=/runtime/pnpm
ENV XDG_CACHE_HOME=/runtime/xdg-cache
ENV XDG_CONFIG_HOME=/runtime/xdg-config
ENV XDG_DATA_HOME=/runtime/xdg-data

RUN apk add --no-cache openssl=3.5.7-r0 postgresql16-client=16.15-r0 \
  && corepack enable \
  && corepack prepare pnpm@11.3.0 --activate

FROM base AS development

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 4000
CMD ["pnpm", "dev"]

FROM base AS builder

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM base AS production

ENV NODE_ENV=production
ENV PORT=4000

LABEL org.opencontainers.image.title="CodeY CMS" \
  org.opencontainers.image.authors="Fatlum Prekadini and CodeY CMS contributors" \
  org.opencontainers.image.source="https://github.com/fpointerdev/codey-cms" \
  org.opencontainers.image.licenses="GPL-2.0-or-later"

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 api

COPY --from=builder --chown=api:nodejs /app/package.json ./package.json
COPY --from=builder --chown=api:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder --chown=api:nodejs /app/LICENSE ./LICENSE
COPY --from=builder --chown=api:nodejs /app/NOTICE.md ./NOTICE.md
COPY --from=builder --chown=api:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=api:nodejs /app/dist ./dist
COPY --from=builder --chown=api:nodejs /app/apps/web ./apps/web
COPY --from=builder --chown=api:nodejs /app/prisma ./prisma
COPY --from=builder --chown=api:nodejs /app/scripts ./scripts
COPY --from=builder --chown=api:nodejs /app/runtime-meta ./runtime-meta

RUN mkdir -p storage/uploads backups backups-mirror /runtime/corepack /runtime/pnpm /runtime/xdg-cache /runtime/xdg-config /runtime/xdg-data \
  && chown -R api:nodejs storage backups backups-mirror /runtime

USER api

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-production.mjs"]
