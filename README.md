# 晃晃 Web 游戏

四人邀请制数字麻将 Web 游戏。好友房与人机对战相互独立：好友房坐满四位真人并在每局重新准备后开局；人机模式由一位真人与三位机器人对战，每局结束后由玩家决定是否继续。项目不包含账号、匹配、历史记录或回放。

## 已实现的 MVP

- 108 张万、条、筒；随机庄家、亮牌和顺位赖子。
- 仅自摸、禁止吃与点炮；标准四组一对胡牌。
- 硬胡、软胡、多赖子禁胡及“赖子与任意摸牌成将”禁胡。
- 普通碰、明杠、暗杠、补杠、亮牌特殊碰杠和独立杠分。
- 回合内放赖、补牌、个人倍率和逐付款人结算。
- 六位邀请房、固定四座等待房、每局重新准备和独立人机入口。
- 15 秒出牌、5 秒响应、机器人行动、断线托管与重连取回。
- 准备/取消准备、房主转让、仅房主修改底分、即时解散和 SQLite 恢复。
- 好友房等待 3 分钟未开局自动解散，关闭通知后从内存和 SQLite 回收。
- 好友对战支持 60 字以内的临时房间聊天，消息显示在发送者头像旁并在约 3 秒内渐隐移除。
- 人机对战每局结束后由玩家确认继续或退出，不自动续局。
- 同一套横屏牌桌支持“低调”和“精美”两套主题，默认低调且静音。
- iOS 动态地址栏与安全区适配，并支持安装为横屏独立窗口 PWA。

## 本地运行

需要 Node.js 24 和 pnpm 11。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

浏览器打开 `http://localhost:5173`。开发命令会启动 Vite，并在 3000 端口启动服务端；服务端开发进程在改代码后需要手动重启，避免 macOS 文件监听数量限制。

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

测试覆盖胡牌、赖子、动作限制、杠与自摸结算、机器人轮转、好友房入座与准备取消、局间回房、人机续局、房主转让、底分权限、离房重入、断线托管、解散原因和聊天校验。

## 阿里云部署

现有 2 核 4 GB 服务器足够本项目供个人与少量朋友使用。推荐安装 Docker 与 Docker Compose，并将域名 A 记录指向服务器公网 IP，同时在安全组开放 80、443 端口。

```bash
cp deploy/.env.example deploy/.env
# 修改 deploy/.env 中的 DOMAIN
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps
```

Caddy 自动申请和续期 HTTPS 证书。应用数据位于 Docker 命名卷 `deploy_game_data`；更新应用前应备份此卷。

停止写入后进行一致性备份：

```bash
docker compose -f deploy/compose.yaml stop app
docker run --rm -v deploy_game_data:/data -v "$PWD/backups:/backup" alpine \
  cp /data/huanghuang.sqlite /backup/huanghuang-$(date +%Y%m%d-%H%M%S).sqlite
docker compose -f deploy/compose.yaml start app
```

恢复时先停止应用，将备份文件覆盖回卷内的 `/data/huanghuang.sqlite`，删除同目录残留的 `-wal`、`-shm` 文件后再启动应用。上线前可先通过 `/health/live` 和 `/health/ready` 检查进程。

## 项目结构

```text
apps/web                 React 横屏游戏界面
apps/server              Fastify、Socket.IO、SQLite 房间服务
packages/protocol        跨层命令、投影与运行时 schema
packages/game-engine     无网络依赖的纯规则引擎
deploy                   Docker Compose、Caddy 与镜像配置
.trellis/tasks           PRD、设计文档与实施计划
```

完整产品规则与架构见 `.trellis/tasks/archive/2026-07/07-15-huanghuang-web-game-plan/`。
