# 历史战绩入口失败态提示

## Goal

个人信息弹窗（`PlayerProfileModal`）里"历史战绩"按钮依赖 `competitiveProfile !== null` 才会渲染。当 `/api/competitive/profile` 请求失败（最常见原因：账号未绑定微信身份，返回 `WECHAT_LINK_REQUIRED`）时，前端仅记录 `matchmakingError`，`competitiveProfile` 停留在初始值 `null`，按钮直接消失且用户看不到任何提示，容易被误认为"功能没做"。目标是让"无战绩"和"加载失败/未绑定微信"两种状态在 UI 上可区分，用户能看懂原因。

## Requirements

- 首页拉取 `competitiveApi.profile()` 失败时，除了设置 `matchmakingError`，还需要传递一个可被 `PlayerProfileModal` 消费的错误状态（不能只是 console 报错）。
- `PlayerProfileModal.tsx` 现有"无永久竞技战绩"分支（约第 101-103 行）旁增加一个"加载失败"分支：区分"确实没有竞技档案"（请求成功但为空）与"请求失败/未绑定微信"两种情况，展示不同文案。
- 未绑定微信身份的情况需要给出明确、友好的中文提示（例如引导去绑定微信，而不是技术错误码）。
- 不改变已有"有战绩且请求成功"路径的行为，"历史战绩"按钮在该路径下的展示逻辑保持不变。

## Acceptance Criteria

- [x] 模拟 `/api/competitive/profile` 请求失败（如未绑定微信返回 403 `WECHAT_LINK_REQUIRED`），个人信息弹窗展示明确的失败态提示文案，而不是静默隐藏按钮。
- [x] 模拟请求成功但确实无竞技档案（正常新用户）时，展示原有"无永久竞技战绩"文案，不受本次改动影响。
- [x] 正常有竞技档案时，"历史战绩"按钮正常展示并可点击打开 `MatchHistoryModal`，行为不变。
- [x] TypeScript 编译通过，无新增 lint 错误。

## Notes

- 根因排查见对话记录：`index.tsx` 中 `Promise.all([competitiveApi.profile(), competitiveApi.status()])` 的 `.catch` 只 `setMatchmakingError`，未更新任何可供 `PlayerProfileModal` 判断"加载失败"的状态。
- 涉及文件：`apps/miniprogram/src/pages/index/index.tsx`（约 407-419 行请求逻辑）、`apps/miniprogram/src/components/PlayerProfileModal.tsx`（约 101-103, 150-154 行）。
- 轻量任务，PRD-only 即可，不需要 design.md/implement.md。
