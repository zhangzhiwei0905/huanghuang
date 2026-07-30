# 执行计划：排位匹配成功倒计时

## 步骤

1. 把 `RoundStartOverlay` 从 `apps/miniprogram/src/pages/room/index.tsx:245-258` 提炼成共享组件（含样式，从 `room/index.scss:1642-1721` 挪出来），接口加 `eyebrow`/`title` 两个文案 prop。
2. 房间页改为使用共享组件，`eyebrow="全员已准备"`、`title="游戏开始"`，确认行为/样式与之前完全一致（截图对比或本地跑一次好友房准备流程）。
3. 首页 `apps/miniprogram/src/pages/index/index.tsx`：
   - 新增 `pendingMatchNavigation` state（含 `navigationKey`/`room`/`matchFoundAt`）。
   - 改 `applyMatchmakingResponse`：`shouldOpenMatchmakingRoom` 为真时，写 `openedMatchRoomKeyRef` 但不立刻 navigate，改为 `setPendingMatchNavigation(...)`。
   - 新增一个 `setInterval`（250ms）驱动倒计时 UI，到时执行原有的 `matchedRoomOpeningRef` 锁定 + `setStorageSync` + `navigateTo` 逻辑。
   - `useDidShow` 里补上"存在 `pendingMatchNavigation` 且已到时"的立即跳转分支。
   - 渲染 `<RoundStartOverlay eyebrow="匹配成功" title="即将开局" countdown={remaining} />`（`pendingMatchNavigation !== null` 时展示）。
4. 确认与 [[07-30-matchmaking-socket-push]] 的 `matchedRoomOpeningRef`/`matchedRoomOpeningSinceRef` 心跳兜底逻辑接线一致（真正跳转那一步是共用代码路径，不要复制一份）。
5. 测试：
   - `roomTransitions.test.ts` 确认房间页行为不受重构影响（如果测试是针对旧组件内部实现的，跟着挪到共享组件的测试文件）。
   - 新增倒计时状态机的纯函数测试（如果把"是否该立即跳转"这类判断抽成纯函数，参考 `matchmakingRecovery.ts` 的风格）。
6. 手动验证：
   - 单人排位匹配成功 → 看到 3 秒"匹配成功"过渡 → 进房，样式与好友房倒计时视觉一致。
   - 匹配成功瞬间切到微信后台，几秒后切回，确认不会重新倒计时 3 秒或卡住，能正确进房。
   - 好友房原有"全员已准备"倒计时视觉/时序不受影响。

## 验证命令

```bash
cd apps/miniprogram && npm test
```

## 回滚点

- 步骤 1-2（组件提炼）与步骤 3-4（首页接线）可拆成两个 commit；如果首页倒计时有问题，可以只回滚步骤 3-4，保留组件提炼（房间页仍受益于更干净的组件结构）。
