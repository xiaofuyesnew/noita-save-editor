# Changelog

## [0.11.0] - 2026-07-24

### 安全性改进
- **序列化器**：转义控制字符 (\r\n\t) 防止 XML 属性值损坏
- **路径校验**：liveDir/saveDir 必须存在且含 player.xml，防止误操作
- **CSRF 防护**：Host/Origin 校验 + DNS rebinding 防护（仅允许 127.0.0.1/localhost）
- **乐观锁补全**：玩家基础属性/伤害倍率/无敌接口增加 version 校验

### 健壮性改进
- **事务提交**：saveManager 两阶段提交（全部自检成功后统一 rename），防止跨文件半提交
- **缓冲事务**：所有 apply* 函数增加 dry-run 保护（structuredClone 或 validate-then-apply）
- **原子操作**：pull/restore 串行化（校验→备份→rm→cp），失败自动回滚
- **文件删除容错**：unlocks 使用 rmSync force:true，防止 TOCTOU 竞态

### 前端改进
- **409 冲突自动恢复**：捕获版本冲突后自动 refresh，避免永久 409 循环
- **加载失败重试**：卡片加载失败显示错误状态和重试按钮（新增 useCardLoad 组合式）
- **提交并发锁**：防止双击重复提交（新增 useSubmit 组合式，submitting 状态）
- **内存泄漏修复**：onReload 支持注销，组件卸载时清理钩子
- **身份对齐修复**：wandsStore preserveEdits 按 w.index 重对齐，防止法杖数量变化时错位
- **数值输入改进**：使用 NInputNumber 替代 NInput，带 min/max/precision 校验
- **未保存提示**：药水材料编辑弹窗增加关闭确认

### 新增
- **LICENSE**：MIT 许可证
- **review.md**：完整的代码审计报告（服务端/前端/测试覆盖，含优先级路线图）

### 测试
- 555/558 通过（3 个失败为快照漂移，非回归缺陷）

---

## [0.10.1] - 2026-07-23

### 功能
- Noita 风格像素应用图标（exe/窗口/favicon）

---

## [0.10.0] - 2026-07-22

### 功能
- 法术/天赋/效果/道具/材料详细工具提示

---

## [0.9.2] - 2026-07-21

### 修复
- 通过根 postinstall 下载 electron 运行时（electron 43+ 无 postinstall）

---

## [0.9.1] - 2026-07-20

### 修复
- 依赖更新和构建优化

---

## [0.9.0] - 2026-07-19

### 功能
- 初始发布
- 完整的存档编辑功能（法杖/法术/道具/天赋/效果/进度）
- Electron 桌面应用
- 中英双语支持
