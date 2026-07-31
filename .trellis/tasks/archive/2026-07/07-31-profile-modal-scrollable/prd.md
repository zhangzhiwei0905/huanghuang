# 个人信息与历史战绩弹窗可滚动

## Goal

`PlayerProfileModal`（个人信息弹窗，展示硬来由/软来由等成就）与 `MatchHistoryModal`（历史战绩弹窗）在小程序真机/开发者工具中内容展示不全时无法用手指滑动查看。根因：容器用 Taro `<View>` + CSS `max-height + overflow-y: auto`，编译到微信小程序端是原生 `<view>`，原生 view 不支持通过 CSS overflow 触发手势滚动，只会裁切内容。目标：让这两个弹窗在内容超出可视高度时可以正常手势滚动查看完整内容。

## Requirements

- 将 `PlayerProfileModal.tsx` 中承载可滚动内容的容器（当前 `className="profile-modal"` 的 `<View>`，约第63行）替换为 Taro 的 `<ScrollView scrollY enhanced showScrollbar={false}>`，或者将可滚动范围收窄到 `.profile-modal__achievements` 成就展示区单独包一层 `ScrollView`（视觉可控性更好，二选一，以改动完成后实际观感为准）。
- `MatchHistoryModal.tsx` 中对应容器（当前 `className="history-modal"` 的 `<View>`，约第87行）做同样处理，历史战绩列表条数多时也需要能滚动。
- 保留原有 `max-height: calc(100vh - 6vmin)` 等尺寸限制，`overflow-y: auto` 可保留作为 H5 编译目标的兜底，不需要删除。
- 参考项目内已有正确用法：`FriendsPanel.tsx`（约第205行）好友面板使用 `<ScrollView className="friends-panel__scroll" scrollY enhanced showScrollbar={false}>` 的模式。
- 不改变弹窗其他交互（关闭按钮、遮罩点击关闭等）行为。

## Acceptance Criteria

- [x] 在微信开发者工具的小程序模拟器（非 H5 预览）中，个人信息弹窗内容超出可视高度时可以用鼠标拖拽模拟手势正常滚动，能看到"硬来由""软来由"等全部成就项。
- [x] 历史战绩弹窗在战绩条数较多时同样可以正常滚动查看全部记录。
- [x] 弹窗内其他交互（关闭、点击遮罩关闭）不受影响。
- [x] TypeScript 编译通过，无新增 lint 错误。

## Notes

- 根因与修复方向排查见对话记录，这是微信小程序原生渲染的已知坑（CSS overflow 在原生 view 上不支持触摸滚动），不是本项目独有 bug。
- 涉及文件：`apps/miniprogram/src/components/PlayerProfileModal.tsx`/`.scss`、`apps/miniprogram/src/components/MatchHistoryModal.tsx`/`.scss`。
- 轻量任务，PRD-only 即可。
