FROM node:24-alpine AS base

WORKDIR /app

RUN apk add --no-cache openssl postgresql16-client \
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

RUN mkdir -p storage/uploads backups backups-mirror /runtime \
  && chown -R api:nodejs storage backups backups-mirror /runtime

USER api

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-production.mjs"]
