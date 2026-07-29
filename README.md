# 晃晃数字麻将

四人数字麻将 Web 与微信小程序游戏。微信小程序支持持久微信账号、单人/组队竞技匹配、长期段位和竞技成就；好友房支持真人与机器人混合入座，人机模式由一位真人与三位机器人对战。项目暂不包含金币钱包、充值、赛季、排行榜或回放。

## 已实现的 MVP

- 108 张万、条、筒；随机庄家、亮牌和顺位赖子。
- 仅自摸、禁止吃与点炮；标准四组一对胡牌。
- 硬胡、软胡、多赖子禁胡及“赖子与任意摸牌成将”禁胡。
- 普通碰、明杠、暗杠、补杠、亮牌特殊碰杠和独立杠分。
- 回合内放赖、补牌、个人倍率和逐付款人结算。
- 四位邀请房（兼容活动中的旧六位码）、固定四座等待房、每局重新准备和独立人机入口。
- 好友房房主可增删机器人；进行中加入的真人先观战，局末按顺序替换机器人。
- 创建房间可选择 20/25/30 秒出牌和高低机器人难度；支持 5 秒响应、断线托管与重连取回。
- 准备/取消准备、房主转让、仅房主修改底分、即时解散和 SQLite 恢复。
- 好友房等待 3 分钟未开局自动解散，关闭通知后从内存和 SQLite 回收。
- 好友对战支持 60 字以内的临时房间聊天，消息显示在发送者头像旁并在约 3 秒内渐隐移除。
- 人机对战每局结束后由玩家确认继续或退出，不自动续局。
- 微信账号支持单人排位与 2–4 人组队排位：队伍全员准备后由房主开始匹配，队伍不可拆分，空位由单排玩家或其他队伍补齐。
- 竞技对局固定底分 2、20 秒出牌，按等待时间逐步放宽段位范围，单小局结算后可继续匹配。
- 竞技段位从黑铁Ⅴ到雀神等级，统一展示段位徽章和完整文字；胡牌与实际赔付倍率决定升降，晋升时播放段位晋升动画。
- 快速匹配永久累计明杠、碰亮牌、补杠和暗杠成就；主页、等待房和对局中点击头像均可查看积分、段位与成就。
- 段位、牌桌分和未来金币是三个独立账本；当前没有金币余额或充值接口。
- 同一套横屏牌桌支持“低调”和“精美”两套主题，默认低调且静音。
- iOS 动态地址栏与安全区适配，并支持安装为横屏独立窗口 PWA。

## 本地运行

需要 Node.js 24 和 pnpm 11。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

浏览器打开 `http://localhost:5173`。开发命令会启动 Vite，并在 3000 端口启动服务端；服务端开发进程在改代码后需要手动重启，避免 macOS 文件监听数量限制。

### 微信小程序（开发中 · `miniprogram` 分支）

Taro 4 + React 客户端在 `apps/miniprogram`。鉴权说明见 `docs/miniprogram-auth.md`，包内说明见 `apps/miniprogram/README.md`。

```bash
pnpm --filter @huanghuang/miniprogram build:weapp
# 微信开发者工具导入 apps/miniprogram（miniprogramRoot=dist）
# 默认连接生产 API；本地联调才显式覆盖：
TARO_APP_API_BASE=http://127.0.0.1:3000 pnpm --filter @huanghuang/miniprogram build:weapp
```

iPhone/iPad 使用 Safari 打开 HTTPS 生产地址后，可通过“分享 → 添加到主屏幕”安装；从主屏幕启动会使用独立横屏窗口。普通 Safari 访问也会跟随地址栏高度和设备安全区动态调整。

生产构建与本地启动：

```bash
pnpm build
DATABASE_PATH=./data/huanghuang.sqlite PORT=3000 node apps/server/dist/index.js
```

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose -f deploy/compose.yaml config
```

测试覆盖胡牌、双对子赖子软胡、动作限制、杠与自摸结算、机器人难度、好友房生命周期、快速匹配窗口与心跳、竞技房托管、段位/保护卡边界、成就去重、终局幂等、冷启动恢复和结算房回收。

## 阿里云部署

现有 2 核 4 GB 服务器足够本项目供个人与少量朋友使用。当前匹配队列、Socket presence 和房间调度明确只支持单个应用实例，不要扩展应用容器副本数；横向扩容前必须引入共享锁、Socket.IO adapter 和房间单写者机制。将域名 A 记录指向服务器公网 IP，并在安全组开放 80、443 端口。

> **实际生产架构**：应用容器由手动 `docker build` + `docker run` 启动（不经过 Docker Compose），反向代理是宿主机原生安装的 `nginx.service`（不是容器化的 Caddy）。仓库里的 `deploy/compose.yaml` + `Caddyfile`（app+Caddy 全容器方案）目前**未在生产使用**，见下方「备用方案」。以下步骤描述当前实际使用的流程。

### 首次搭建反向代理（仅需一次）

TLS 证书通过 `deploy/enable-domain.sh` 一次性申请；nginx 配置文件模板在 `deploy/nginx/`：

```bash
sudo bash deploy/enable-domain.sh
```

该脚本会：将 `deploy/nginx/huanghuang.http.conf` 装到 `/etc/nginx/conf.d/huanghuang.conf` 并 reload nginx，用 certbot webroot 方式签发证书，再把 `deploy/nginx/huanghuang.conf`（80→443 跳转 + TLS + `proxy_pass http://127.0.0.1:13000`）换上去并再次 reload。后续更新反向代理规则时，直接编辑 `deploy/nginx/huanghuang.conf`，`cp` 到 `/etc/nginx/conf.d/huanghuang.conf` 后 `sudo nginx -t && sudo systemctl reload nginx` 即可，不需要重新申请证书。

### 构建与启动应用容器

生产镜像已按增量部署优化：Dockerfile 先复制 workspace 的 `package.json` 与锁文件并安装依赖，之后才复制源代码。普通代码更新会复用包含 `better-sqlite3` 的依赖层，只重新执行应用构建。BuildKit 还会持久缓存 pnpm 包、Corepack 和 node-gyp 下载；依赖变化时也不需要重新下载全部内容。

当前 2 核 4 GB 生产机实测：首次建立新缓存的完整构建约 322 秒，依赖不变的增量构建约 51 秒。修改锁文件或任一 workspace 的 `package.json` 时仍会重新安装依赖；执行 `docker builder prune`、`docker build --no-cache` 或更换 Builder 后也会失去这部分加速。

服务器可在 `/etc/docker/daemon.json` 配置阿里云 Docker Hub 镜像加速器：

```json
{
  "registry-mirrors": ["https://<你的专属地址>.mirror.aliyuncs.com"]
}
```

配置后需要在维护窗口重启 Docker 才会生效。当前生产服务器已经配置并启用专属加速器，无需重复操作。镜像加速器只影响 `node:24-alpine` 等 Docker Hub 镜像拉取，不会加速 pnpm 包下载或 `better-sqlite3` 的本地 C/C++ 编译。

构建时将提交号只注入应用构建层：

```bash
APP_REVISION=$(git rev-parse --short HEAD)
docker build \
  --build-arg APP_REVISION="$APP_REVISION" \
  -t "huanghuang-app:$APP_REVISION" \
  -f deploy/server.Dockerfile .
```

启动前把旧容器改名保留为回滚快照（约定命名 `huanghuang-app-rollback-<旧提交号>-<时间戳>`），再启动新容器：

```bash
docker rename huanghuang-app "huanghuang-app-rollback-$(docker inspect huanghuang-app --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')-$(date +%Y%m%d-%H%M%S)" || true

docker run -d \
  --name huanghuang-app \
  --restart unless-stopped \
  -p 127.0.0.1:13000:3000 \
  -v huanghuang_game_data:/data \
  --env-file deploy/.env \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DATABASE_PATH=/data/huanghuang.sqlite \
  "huanghuang-app:$APP_REVISION"
```

上线前可先通过容器日志或 `/health/live`、`/health/ready` 检查进程是否正常，再确认 `https://<域名>/` 可访问。`GET /api/version` 返回 `{ version, builtAt, updatedAt, revision }`：`version` 是持久化的语义化版本号，每次真正重新部署（`APP_REVISION` 与上次记录不同）自动 patch +1，单纯重启容器不会 +1；忘记在构建前计算 `APP_REVISION` 时该值固定为 `unknown`，版本号也就永远不会跳动（不影响服务，只是看不出部署是否生效）。应用数据位于命名卷 `huanghuang_game_data`；更新应用前应备份此卷（见下）。回滚快照容器保持 `Exited` 状态即可，不必立刻清理；定期清理陈旧快照以释放磁盘。

回滚时：`docker stop huanghuang-app`（占用了 13000 端口，必须先停）、将其改名为 `huanghuang-app-broken-<提交号>-<时间戳>` 保留现场，再把目标回滚快照 `docker start` 起来（不必改回原名，端口映射固定在容器启动参数里，与容器名无关；只要保证同一时刻只有一个容器绑定 `127.0.0.1:13000`）。

### 备份与恢复

停止写入后进行一致性备份：

```bash
docker stop huanghuang-app
docker run --rm -v huanghuang_game_data:/data -v "$PWD/backups:/backup" alpine \
  cp /data/huanghuang.sqlite /backup/huanghuang-$(date +%Y%m%d-%H%M%S).sqlite
docker start huanghuang-app
```

恢复时先停止应用，将备份文件覆盖回卷内的 `/data/huanghuang.sqlite`，删除同目录残留的 `-wal`、`-shm` 文件后再启动应用。

### 备用方案（当前未在生产使用）

`deploy/compose.yaml` + `Caddyfile` 定义了一套 app + Caddy 全容器化方案（Caddy 自动申请和续期 HTTPS 证书，容器数据卷为 Compose 项目下的 `game_data`）：

```bash
cp deploy/.env.example deploy/.env
# 修改 deploy/.env 中的 DOMAIN
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps
```

这套方案在当前生产服务器上未被验证、未在使用（生产用的是上面的原生 nginx + 手动 `docker run`），仅作为不想自行安装配置 nginx 时的替代起点保留。`deploy/compose.nginx.yaml` 是一个部分 override（仅覆盖 `app` 服务的端口映射），单独使用时不完整，需配合 `-f deploy/compose.yaml -f deploy/compose.nginx.yaml` 并只启动 `app` 服务；同样未在生产验证过。

## 项目结构

```text
apps/web                 React 横屏游戏界面
apps/server              Fastify、Socket.IO、SQLite 房间服务
packages/protocol        跨层命令、投影与运行时 schema
packages/game-engine     无网络依赖的纯规则引擎
deploy                   镜像 Dockerfile、nginx/证书脚本，及未在生产使用的 Compose+Caddy 备用方案
.trellis/tasks           PRD、设计文档与实施计划
```

完整产品规则与架构见 `.trellis/tasks/archive/2026-07/07-15-huanghuang-web-game-plan/`。
