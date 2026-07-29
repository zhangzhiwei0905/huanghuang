# Production uses the Docker 28 built-in Dockerfile frontend. Do not add an
# external docker/dockerfile syntax image without checking mirror support: the
# current Aliyun accelerator rejects that auxiliary repository with HTTP 403.
# Docker Hub pulls are routed through the daemon's configured registry mirror
# on production. Keeping the canonical image name also works on local machines.
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
RUN apk add --no-cache python3 make g++
RUN corepack enable

# Dependency metadata changes far less often than application source. Keep the
# expensive native dependency build reusable across ordinary code-only deploys.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/game-engine/package.json ./packages/game-engine/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
# unofficial-builds.nodejs.org and GitHub release downloads are effectively
# unreachable from this host (observed <10KB/s / connection timeouts); route
# native-module builds through npmmirror.com and skip the doomed
# prebuild-install attempt against GitHub.
ENV npm_config_disturl=https://cdn.npmmirror.com/binaries/node \
    npm_config_build_from_source=true
RUN --mount=type=cache,id=huanghuang-pnpm-store,target=/pnpm/store,sharing=locked \
    --mount=type=cache,id=huanghuang-build-cache,target=/root/.cache,sharing=locked \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --prefer-offline

COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json eslint.config.js vitest.config.ts ./

# The revision deliberately invalidates only the application build layer. It
# must never sit above dependency installation or every deploy would rebuild
# better-sqlite3 again.
ARG APP_REVISION=unknown
RUN --mount=type=cache,id=huanghuang-build-cache,target=/root/.cache,sharing=locked \
    echo "Building revision ${APP_REVISION}" && pnpm build
RUN date -u +%Y-%m-%dT%H:%M:%SZ > /app/BUILD_TIME

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/BUILD_TIME ./BUILD_TIME
ARG APP_REVISION=unknown
ENV APP_REVISION=${APP_REVISION}
LABEL org.opencontainers.image.revision=${APP_REVISION}
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
