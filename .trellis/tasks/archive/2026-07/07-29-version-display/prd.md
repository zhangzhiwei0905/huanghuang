# 版本号展示（轻量任务）

## Goal

用户需要能一眼确认「小程序前端」和「后端服务」是否都跑在最新代码上——尤其是每次手动部署后端之后。当前部署完全手动（`docker compose ... up -d --build`），没有 CI/CD，且该命令的文档化默认路径从未真正传递 `APP_REVISION` 构建参数（只有 README 里的备用手动 `docker build` 命令传了），导致每次默认部署镜像标签都是 `unknown`。

## Why now

用户今天验证了一批后端改动（五项优化）后发现没有生效，怀疑是后端没部署。核实结论：确实没有自动部署机制，Claude 无法访问生产服务器，这批改动目前只存在于本地 git 仓库。需要一个机制让用户自己就能确认"线上到底跑的是哪个版本"，而不必每次都靠猜或者去问。

## Scope

### 后端

- `GET /api/version` 返回 `{ revision: string, builtAt: string }`。
  - `revision`：git short sha，来自已存在的 `APP_REVISION` Docker build arg——当前只被写进 OCI LABEL，运行时进程读不到，需要在 runtime stage 补一个 `ENV APP_REVISION=${APP_REVISION}`。
  - `builtAt`：镜像构建时刻的 UTC ISO 时间戳，在 Dockerfile build stage 里用 `date -u` 写入一个文件，runtime stage 复制过去，启动时读取一次并缓存，不需要外部传参。
  - 都读不到时输出 `"unknown"`，不是抛错。
- `deploy/compose.yaml` 默认部署路径（`docker compose ... up -d --build`）目前完全不传 `APP_REVISION`，永远是 `unknown`。修 README 里那条文档化命令，让它在执行 compose 前先 `export APP_REVISION=$(git rev-parse --short HEAD)`，和现有手动 `docker build` 备用命令的做法保持一致。

### 小程序前端

- 复用现有 `defineConstants`（`config/index.ts` 里 `TARO_APP_API_BASE` 那套机制）新增一个 `TARO_APP_REVISION`，构建时注入 git short sha。
- 首页新增一个极简「关于」入口（角落小图标或文字链接），点击弹出一个只显示版本信息的小弹窗：前端版本（构建时注入的 revision）+ 后端版本（首页加载时调 `/api/version` 拿到的 revision + builtAt）。
- 不引入任何其他设置项，不新建独立设置页面——范围严格限定在版本信息展示。

## Non-goals

- 不做自动部署/CI，不做版本一致性自动校验或告警。
- 不新建通用设置页面（音效开关等现有偏好保持原样，不迁移进这个弹窗）。
- 不改动房间内已有的游戏内设置面板。

## Acceptance Criteria

- [ ] `curl /api/version` 在容器内返回真实 `revision`/`builtAt`（不是 `unknown`），本地未设置 `APP_REVISION` 时优雅降级为 `"unknown"` 而不是 500。
- [ ] 首页出现「关于」入口，点击后弹窗展示前端版本 + 后端版本（含 builtAt）。
- [ ] README 部署命令更新为会正确传递 `APP_REVISION`。
- [ ] `pnpm test`、`pnpm run typecheck`、`pnpm run lint` 全绿。
- [ ] 不新增其他设置项，不新建独立设置页面。
