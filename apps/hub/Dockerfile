# Renaissance Hub: the one server-side process (runs as the TrueNAS custom app `renaissance-hub`).
# Build from the repository root:  docker build -f apps/hub/Dockerfile -t renaissance-hub .
# Run:  docker run --rm -p 8787:8787 -e RENAISSANCE_HUB_CORS_ORIGINS=https://music.example.com renaissance-hub
# Every setting is an environment variable (apps/hub/.env.example); there is nothing to mount.

FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 HUSKY=0 TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/hub/package.json apps/hub/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter hub...
COPY packages/core packages/core
COPY apps/hub apps/hub
RUN pnpm --filter hub build \
  && pnpm install --frozen-lockfile --ignore-scripts --prod --filter hub...

FROM node:22-alpine
ENV NODE_ENV=production RENAISSANCE_HUB_PORT=8787
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/core ./packages/core
COPY --from=build /repo/apps/hub/package.json ./apps/hub/package.json
COPY --from=build /repo/apps/hub/dist ./apps/hub/dist
USER node
WORKDIR /app/apps/hub
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.RENAISSANCE_HUB_PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
