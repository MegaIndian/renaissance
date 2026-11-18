# Renaissance Hub: the one server-side process (runs as the TrueNAS custom app `renaissance-hub`).
# Build from the repository root:  docker build -f apps/hub/Dockerfile -t renaissance-hub .
# Run:  docker run --rm -p 8787:8787 -e RENAISSANCE_HUB_CORS_ORIGINS=https://music.example.com renaissance-hub
# Every setting is an environment variable (apps/hub/.env.example); there is nothing to mount.

# node:22-alpine, pinned to its digest (22.23.5-alpine3.24 today); Dependabot moves it.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
ENV HUSKY=0 TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# pnpm at exactly the version `packageManager` pins, from npm; corepack is not relied on (node images
# past 24 ship without it).
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
COPY apps/hub/package.json apps/hub/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter hub...
COPY apps/hub apps/hub
RUN pnpm --filter hub build \
  && pnpm install --frozen-lockfile --ignore-scripts --prod --filter hub...

# Same digest as the build stage.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
ENV NODE_ENV=production RENAISSANCE_HUB_PORT=8787
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/hub/package.json ./apps/hub/package.json
COPY --from=build /repo/apps/hub/dist ./apps/hub/dist
USER node
WORKDIR /app/apps/hub
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.RENAISSANCE_HUB_PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
