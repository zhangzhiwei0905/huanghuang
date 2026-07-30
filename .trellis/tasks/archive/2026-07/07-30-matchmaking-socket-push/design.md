# 设计：排位匹配成功 socket 推送 + 卡死兜底

## 关键发现：复用现成的 social 推送通道，不用新建 socket 基础设施

排查发现服务端已经有一套现成的"轻量推送 + 客户端自行拉取详情"机制，好友请求/房间邀请/在线状态都在用：

- 服务端：`apps/server/src/index.ts:128-135` 的 `socialChannel(sessionId)` + `notifySocial(sessionIds, reason)`，内部就是 `sockets.to(socialChannel(sessionId)).emit("social:update", { reason })`。
- 每个 socket 连接一建立就会 `join(socialChannel(sessionId))`（`index.ts:896`），与是否在房间里无关。
- 客户端：`apps/miniprogram/src/hooks/useSocial.ts` 已经在首页登录后（`identityState === "loggedIn"`）建立了一条独立于房间的 socket 连接（`apps/miniprogram/src/pages/index/index.tsx:291` `useSocial(identityState === "loggedIn" && identity !== null)`），监听 `social:update`，目前收到任何 reason 都只是重新拉取好友快照（`useSocial.ts:79-82`，`handleUpdate` 忽略了 reason）。

也就是说：**排队阶段客户端本来就已经建立了 socket 连接**（只是目前只用来同步好友列表），我们不需要为匹配单独起一条新连接、不需要改鉴权、不需要在 `useRoom.ts` 里提前建连——只需要：
1. 服务端匹配成功时，对涉及的 sessionId 广播一个新 reason（如 `"MATCHMAKING"`）。
2. `useSocial` 把收到的 reason 透传给调用方，让首页在收到 `"MATCHMAKING"` 时立即触发一次 matchmaking 状态拉取，而不是等下一次定时轮询。

这比"新起一条 matchmaking 专用 socket 通道"风险小得多：复用已验证的鉴权路径（`sockets.use` 中间件）、复用已验证的重连行为（`useSocial` 里 `reconnection: true` 配置），也不会和 `useRoom.ts` 的房间内 socket 产生两条连接互相干扰（`useSocial` 的连接在进房后依然可以继续存在，两者本来就是各自独立生命周期，互不影响）。

## 改动点

### 1. 服务端：匹配成功即推送

`apps/server/src/index.ts` 的 `tickMatchmaking()`（187-193 行）：

```ts
function tickMatchmaking() {
  const result = matchmaking.tick();
  if (result.changedSessionIds.length > 0) {
    notifySocial(result.changedSessionIds, "MATCHMAKING");
  }
  for (const room of rooms.reconcileTeamMatchQueues()) {
    void emitRoomProjection(room.id);
  }
  return result;
}
```

`changedSessionIds` 已经是 `matchmaking-service.ts` `tick()`（235-431 行）算好的、本轮所有状态发生变化的 sessionId（含刚匹配成功的和因异常被取消排队的），去重过（`[...new Set(changedSessionIds)]`），直接喂给现成的 `notifySocial` 即可，不需要新写筛选逻辑。

`notifySocial` 的 `reason` 参数目前是裸 `string`（`index.ts:132` `function notifySocial(sessionIds: readonly string[], reason: string)`），不需要改类型，直接传字符串字面量 `"MATCHMAKING"`。

### 2. 客户端：`useSocial` 透传 reason

`apps/miniprogram/src/hooks/useSocial.ts` 改动最小化：

```ts
export function useSocial(enabled: boolean, onUpdate?: (reason: string) => void): SocialController {
  ...
  const handleUpdate = (payload?: { reason?: string }) => {
    void refresh();
    if (payload?.reason !== undefined) onUpdate?.(payload.reason);
  };
  ...
}
```

用 `useRef` 包一层 `onUpdate` 存到 ref 里再在 effect 内读取，避免把 `onUpdate` 加入 effect 依赖数组导致每次首页重渲染都重建 socket（参考文件里其它回调已经用 `useCallback`/ref 规避依赖膨胀的写法）。

### 3. 首页：抽出可复用的"立即拉取一次状态"函数 + 挂到 push 回调上

`apps/miniprogram/src/pages/index/index.tsx` 371-401 行的轮询 effect里，把 `poll` 函数内部真正干活的部分（`competitiveApi.status()` → `applyMatchmakingResponse` → 错误处理）抽成一个不依赖 `timer`/`disposed` 局部变量的独立函数（例如 `refreshMatchmakingStatus`，用 `useCallback` 包裹，或者存成 ref 里的函数供其它 effect 调用），使其能被两处调用：
- 原有的轮询 effect（仍然保留 setTimeout 链式调度和 `nextMatchmakingPollDelayMs` 的动态延迟逻辑，作为兜底，不删除、不改变节奏）。
- 新的 push 回调：`useSocial(enabled, (reason) => { if (reason === "MATCHMAKING") void refreshMatchmakingStatus(); })`，一收到推送立刻拉一次最新状态，不等定时器。

两者最终都走同一个 `applyMatchmakingResponse`，不会产生两条平行的跳转逻辑或竞态——`shouldOpenMatchmakingRoom` 的去重判断（`matchedRoomOpeningRef`/`openedMatchRoomKeyRef`）本来就是幂等的，谁先触发都行。

### 4. `matchedRoomOpeningRef` 永久锁死 → 加超时强制复位

现状：`index.tsx:338-351`，`matchedRoomOpeningRef.current = true` 只在 `Taro.navigateTo(...).finally()` 里复位；如果这个 Promise 不 settle，永久锁死，且 `openedMatchRoomKeyRef.current` 在跳转发起前就已写入同一个 key（339 行），导致连重试都被挡住。

修法：记录锁定开始时间，加一个独立的、不依赖轮询 effect 生命周期的心跳（`setInterval`，例如每 2 秒跑一次，作为一个新的小 effect，只在 `matchmaking.status !== "IDLE"` 时启用），检查"锁定超过 N 秒（建议 8 秒，明显大于 `Taro.navigateTo` 正常耗时）"就强制复位：

```ts
const matchedRoomOpeningSinceRef = useRef<number | null>(null);
// 在设置 matchedRoomOpeningRef.current = true 的同时：
matchedRoomOpeningSinceRef.current = Date.now();
// 心跳 effect：
useEffect(() => {
  const interval = setInterval(() => {
    const since = matchedRoomOpeningSinceRef.current;
    if (since !== null && Date.now() - since > 8_000) {
      matchedRoomOpeningRef.current = false;
      matchedRoomOpeningSinceRef.current = null;
      // 强制允许重试同一个 match：清掉 openedMatchRoomKeyRef，让下一次
      // status 拉取（无论是轮询还是 push 触发）能重新走 navigateTo。
      openedMatchRoomKeyRef.current = null;
      void refreshMatchmakingStatus();
    }
  }, 2_000);
  return () => clearInterval(interval);
}, []);
```

这个心跳用 `setInterval` 而不是链式 `setTimeout`，且逻辑本身只依赖 `Date.now()` 差值，不依赖任何前一次调用是否成功——即使前面的轮询/push 全部失效，这个心跳也能独立发现"锁死超时"并自愈。这就是 PRD 里要求的"独立心跳/存活检测"，不需要再单独为轮询链本身加一层心跳包装（现有轮询的 try/catch 本身已经能在异常后正确重新调度，真正的风险点是这个永久锁，不是轮询链本身）。

### 5. 房间页兜底核实（次要，防御性）

`apps/miniprogram/src/pages/room/index.tsx` 挂载时，如果是通过 `wx.getStorageSync("huanghuang_open_room")` 拿到的房间数据（而不是普通的"从大厅点进已知房间"路径），可以在挂载时额外拉一次 `competitiveApi.status()` 核实服务端权威状态是否和拿到的房间数据一致（不一致则用服务端返回的为准）。这一条优先级低于第 3、4 点——第 3、4 点已经从根上堵住了"首页永远不跳转"的死锁，本条只是双保险，实现时如果时间/风险预算不够可以先跳过，不影响核心验收标准。

## 兼容性

- `social:update` 事件的 payload 新增取值范围（多了 `"MATCHMAKING"` 这个 reason），旧客户端如果还没升级，收到这个 reason 时 `handleUpdate` 里现有逻辑只是 `void refresh()`（拉好友快照），不会报错，是安全的向前兼容。
- 不改协议 schema（`packages/protocol`），`notifySocial` 的 reason 本来就是裸字符串，不需要类型层面的改动。
- 不影响 `useRoom.ts` 的房间内 socket 逻辑，两条连接生命周期完全独立。

## 回滚

- 服务端改动是一行新增（`notifySocial` 调用），可单独回滚且不影响其它已有推送。
- 客户端改动集中在 `useSocial.ts`（加可选回调参数，向后兼容）+ `index/index.tsx`（抽函数 + 加心跳 effect），无数据结构变化，回滚只需 revert 对应 commit。
