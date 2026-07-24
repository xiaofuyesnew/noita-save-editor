# Changelog

## [0.13.0] - 2026-07-24

### 新增
- **预设导出 / 导入**：用于在不同客户端之间传递预设
  - 顶栏新增全局「预设」下拉按钮：导出（下载全量三类预设为带格式标识的 JSON 文件）、导入（选择文件合并到本地）
  - 后端 `GET /api/presets/export` + `POST /api/presets/import`：导入按内容指纹去重（同一份文件重复导入不产生副本）、每条重新分配 id、无效项跳过并计数
  - i18n 中英同步

### 测试
- `test/presetsApi.test.js` 新增导出格式、导入合并/去重/重发 id、缺格式头拒绝用例
- 3 项预存在失败为 save00 快照漂移（items/playerBasics），非本次回归

---

## [0.12.0] - 2026-07-24

### 新增
- **预设系统（§20）**：三类可复用预设，保存后可编辑标签、快速应用
  - **坐标预设**：地图选点弹窗右键「存为预设」；玩家属性卡存当前坐标、一键回填传送
  - **天赋组合预设**：把当前一组天赋存为预设，一键套用整组（字典缺失/复杂项跳过并记日志）
  - **法杖预设**：把某支法杖（属性/法术/外观）存为预设；在法杖编辑页一键载入当前编辑杖（覆盖暂存表单 + 紧凑重建法术，不新增槽位）
  - 后端 `services/presets.js` + `routes/presets.js`（`presets.json` 持久化，用户可手改、坏项宽松跳过）
  - 前端 `stores/presets.js` + 共享 `PresetListModal.vue`，i18n 中英同步
- `wandsStore.applyPresetToWand`：deckCapacity 取 max 规避缩容时序冲突

### 文档
- 删除临时文档（`review.md` / `RELEASE_SUMMARY.md` / `docs/REVIEW.md`），更正 README 过时说明

### 测试
- 服务层 `test/presets.test.js` + 路由层 `test/presetsApi.test.js`
- 569/570 通过（1 项失败为 save00 快照漂移，非回归）

---

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
