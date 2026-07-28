## Bug Analysis: 碰牌/放赖尾延迟与长局语音退化

### 1. Root Cause Category

- **Category**: B - Cross-Layer Contract；D - Test Coverage Gap；E - Implicit Assumption
- **Specific Cause**: 动画时长只覆盖服务端 effect deadline，没有覆盖
  `ACK → HTTP GET`、`room:update → HTTP GET` 和每次特效前的异步布局查询。
  音频修复又把“不能排历史队列”误等同为 latest-wins，忽略了用户更重要的
  “当前短语音完整念完”要求；逐条创建/销毁 native context 还让长局资源抖动。

### 2. Why Fixes Failed (if applicable)

1. **仅缩短时长**：修掉了 400–450ms 的明确空锁，却没有检查点击到首帧、末帧到
   完成投影的完整链路，属于 surface fix。
2. **latest-wins**：单测证明“新提示会抢占旧提示”，但这正是听感退化本身；测试
   验证了实现，而没有验证产品约束。
3. **只跑单元/类型检查**：无法代表微信 native audio 的长局资源行为，也没有真实
   交互时间线断言。

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Architecture | ACK 和 effect 完成事件直接携带目标成员的权威投影 | DONE |
| P0 | Architecture | 恢复预热后的固定双音频槽；忙时丢新提示，不抢占、不排队 | DONE |
| P0 | Test Coverage | 覆盖双槽完成、第三条丢弃、timeout 复用和监听器清理 | DONE |
| P1 | Documentation | 在前后端规范记录音频池、定向投影和同步 anchor 契约 | DONE |
| P1 | Process | 交互性能修复必须画出点击到首帧、末帧到可操作态两段时间线 | DONE |
| P1 | Runtime | 微信开发者工具/真机做连续快速出牌的主观听感回归 | TODO |

### 4. Systematic Expansion

- **Similar Issues**: 其他 HTTP 房间操作仍使用广播版本提示后 GET；它们不在本次
  动画关键路径，但若出现明显反馈延迟，应复用“目标成员私有投影直推”模式。
- **Design Improvement**: `CommandResult` 继续作为持久化去重结果，私有投影只在
  Socket 传输边界附加，避免污染领域与存储契约。
- **Process Improvement**: 体验回归不能只以“测试通过”表述；需明确区分自动化验证、
  开发者工具验证和真机验证。

### 5. Knowledge Capture

- [x] 更新 `.trellis/spec/frontend/miniprogram.md`
- [x] 更新 `.trellis/spec/backend/quality-guidelines.md`
- [x] 更新 `.trellis/spec/guides/cross-layer-thinking-guide.md`
- [x] 更新当前任务 PRD / design / implement
- [ ] 真机听感由可访问微信环境时完成
