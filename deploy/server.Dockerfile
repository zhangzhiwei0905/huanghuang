ARG NODE_IMAGE=public.ecr.aws/docker/library/node:24-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
RUN apk add --no-cache python3 make g++
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json eslint.config.js vitest.config.ts ./
# unofficial-builds.nodejs.org and GitHub release downloads are effectively
# unreachable from this host (observed <10KB/s / connection timeouts); route
# native-module builds through npmmirror.com and skip the doomed
# prebuild-install attempt against GitHub.
ENV npm_config_disturl=https://cdn.npmmirror.com/binaries/node \
    npm_config_build_from_source=true
RUN pnpm install --frozen-lockfile
RUN pnpm build

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
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
