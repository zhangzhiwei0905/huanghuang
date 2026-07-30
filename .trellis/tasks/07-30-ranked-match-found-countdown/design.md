# 设计：排位匹配成功倒计时

## 复用 `RoundStartOverlay`，而不是复制一份

`apps/miniprogram/src/pages/room/index.tsx:245-258` 的 `RoundStartOverlay` 目前是房间页文件内部的一个私有函数组件，只接受 `countdown: number`，文案（"全员已准备"/"游戏开始"）写死在组件里。把它提炼成共享组件：

- 新建 `apps/miniprogram/src/components/RoundStartOverlay/index.tsx`（或放进 `src/components/` 下现有的共享组件目录，跟随项目既有约定），接口改为：
  ```ts
  type RoundStartOverlayProps = {
    eyebrow: string;   // 原来写死的"全员已准备"
    title: string;     // 原来写死的"游戏开始"
    countdown: number;
  };
  ```
- 样式 `apps/miniprogram/src/pages/room/index.scss:1642-1721` 的 `round-start-overlay*` 类名整体挪到组件自己的 scss 文件，房间页和首页都 import 这个组件，不重复写样式。
- 房间页改为 `<RoundStartOverlay eyebrow="全员已准备" title="游戏开始" countdown={roundStartCountdown} />`，行为完全不变。
- 首页新增 `<RoundStartOverlay eyebrow="匹配成功" title="即将开局" countdown={matchFoundCountdown} />`（文案可再调整，两处 eyebrow/title 不同即可，倒计时秒数逻辑复用同一组件）。

## 触发时机：在 `applyMatchmakingResponse` 里插入一段"待跳转"状态，而不是直接 navigate

现状 `apps/miniprogram/src/pages/index/index.tsx:316-352`：`shouldOpenMatchmakingRoom` 判定为真后，立刻 `matchedRoomOpeningRef.current = true` + `Taro.setStorageSync` + `Taro.navigateTo`。

改法：拆成两段状态机，用一个新的 state 记录"匹配成功但还在倒计时，尚未跳转"：

```ts
const [pendingMatchNavigation, setPendingMatchNavigation] = useState<{
  navigationKey: string;
  room: RoomProjection;
  matchFoundAt: number; // Date.now()，用真实时间戳而不是纯递减计数器
} | null>(null);
```

`applyMatchmakingResponse` 里，`shouldOpenMatchmakingRoom` 判定为真时：
1. 立刻 `openedMatchRoomKeyRef.current = navigationKey`（沿用现状写法，防止倒计时期间的后续轮询/push 重复触发倒计时或重复跳转——这一步不变，仍然在检测到的第一时间就"认领"这个 match）。
2. **不**立刻设置 `matchedRoomOpeningRef.current = true` / 调 `navigateTo`，而是 `setPendingMatchNavigation({ navigationKey, room: response.room, matchFoundAt: Date.now() })`，展示 `RoundStartOverlay`。
3. 一个新的 effect 依赖 `pendingMatchNavigation`，用 `setInterval`（沿用 [[07-30-matchmaking-socket-push]] 里"用 setInterval 而非链式 setTimeout"的同一理由）每 250ms 重新计算 `elapsed = Date.now() - matchFoundAt`，算出 `remaining = Math.max(0, 3 - Math.floor(elapsed / 1000))` 驱动 `RoundStartOverlay` 的 `countdown` 显示；当 `elapsed >= 3000` 时，执行原来的"设置 `matchedRoomOpeningRef.current = true` + `Taro.setStorageSync` + `Taro.navigateTo`"那一段（原样保留，含 [[07-30-matchmaking-socket-push]] 里新增的超时兜底心跳——两者共用同一套 `matchedRoomOpeningRef`/`matchedRoomOpeningSinceRef` 机制），并清空 `pendingMatchNavigation`。

用真实时间戳而不是每秒 `setState` 递减计数，是为了让"切后台再切回"天然正确：

## 切后台再切回的处理

`useDidShow`（`index.tsx:407-418`）里，如果存在 `pendingMatchNavigation`，直接按当前 `Date.now() - matchFoundAt` 重新计算一次 `remaining`——如果已经 ≥3000ms（用户切后台切回来的时候倒计时早就该结束了），直接跳过倒计时视觉、立即执行跳转；如果还没到，就让 UI 按真实剩余时间继续显示（不用重新从 3 开始）。这样不会出现"倒计时卡住不动"或"回来后重新倒计时 3 秒导致进房变慢"的问题。

`useDidHide` 不需要特殊处理——`pendingMatchNavigation` 状态和 `matchFoundAt` 时间戳在页面隐藏期间保持不变，只要 JS 定时器在隐藏时暂停/继续都不影响最终结果（回来时用真实时间差重算，不依赖定时器在隐藏期间是否继续 tick）。

## 与现有去重机制的关系

`shouldOpenMatchmakingRoom` 的四个入参（`pageVisible`/`navigationInFlight`/`navigationKey`/`openedNavigationKey`）语义不变；只是"认领"（写 `openedMatchRoomKeyRef`）和"真正跳转"（写 `matchedRoomOpeningRef` + `navigateTo`）两个时间点之间多了一段 3 秒的倒计时展示窗口，`matchmakingRoomNavigationKey`/`shouldOpenMatchmakingRoom` 函数本身不用改。

## 依赖 [[07-30-matchmaking-socket-push]] 的部分

倒计时的触发信号最终应该来自该任务新增的 `"MATCHMAKING"` push 事件（更快发现匹配结果，倒计时才有意义——如果还是靠 1s 轮询发现，"匹配成功"和真实匹配完成之间已经有随机的 0-1s 延迟，体验打折扣）。如果推送任务还没合并，本任务先接入现有轮询发现的 `MATCHED` 状态即可正常工作（`applyMatchmakingResponse` 的改动跟触发源无关），后续推送任务合并后自动获得更快的触发时机，不需要再改倒计时这部分代码。

## 回滚

- `RoundStartOverlay` 提炼成共享组件是纯重构，房间页行为不变，可单独一个 commit、单独验证不回归。
- 首页倒计时是新增状态机，不改变匹配失败/取消排队等其它分支，可整体回滚到"MATCHED 直接 navigate"的旧行为。
