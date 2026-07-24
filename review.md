# 最终检查：系统性薄弱点与功能缺陷评审

> 评审日期：2026-07-23 · 版本：v0.10.1 · 范围：服务端模型/路由/存档管理、前端 store/组件、测试与打包工具链
> 方法：逐文件通读 + 对真实存档快照的实测核对 + 运行测试。严重度分「高/中/低」。
> 结论摘要：**主干功能（happy path）完成度高、工程质量整齐；薄弱点系统性地集中在「异常路径、并发一致性、事务性、失败恢复」四个面上。** 没有阻断发布的致命缺陷，但有若干在特定操作序列下会**静默损坏存档或丢失编辑**的隐患，建议按下方 P0/P1 优先级收口。

---

## 0. 当前健康状态

- **测试**：555 通过 / 3 失败 / 558 总计。3 个失败全部是 **save00 真实快照漂移**导致（非回归）：
  - `listItems: 枚举非法杖道具…` 与 `freeItemSlots: 容器占用…` —— 快照当前快捷栏无药水/粉末袋容器；
  - `invincibility effect: 注入并撤销 PROTECTION_ALL…` —— 快照里 PROTECTION_ALL 已存在。
  - 这三项在 CI 的入库夹具（`test/fixtures/save00`）下应为绿；问题在于**测试对本机可变快照的内容有硬性假设**（见 §4.1）。
- **lint / build**：绿。
- **版本一致性**：`package.json` `0.10.1` = 最新 tag `v0.10.1`，一致。

---

## 1. 系统性薄弱点（跨模块、优先处理）

### S1【高】乐观锁形同虚设，防不住缓冲内并发索引漂移

现象与证据：
- `saveManager.version` **只在 `reload()` / `commit()` 递增**（`server/services/saveManager.js:72,275`），**任何缓冲编辑（markDirty）都不递增**。`server/model/wands.js:6` 与 `frontend/src/stores/wands.js:6` 的注释都印证了这一不变量。
- 各路由的版本校验是 **opt-in** 的：`Number(version) !== saveManager.version` 仅在客户端**主动带** `version`/`?v=` 时才比对（`server/routes/extras.js:41-47`、`server/routes/wands.js:39-40`、`server/routes/effects.js:26-27`）。缺省即无锁。
- 玩家三个写接口**根本不校验 version**：`PUT /api/player/basics`、`PUT /api/player/damage-multipliers`、`POST /api/player/invincibility`（`server/app.js:159-184`，`withPlayerTree` 无版本逻辑），前端对应 section 也不发送 version（`frontend/src/components/cards/sections/PlayerBasicsSection.vue:64`、`DamageSection.vue:46`、`InvincibilitySection.vue:20`）。

后果：所有寻址（法杖 `index`、法术 `idx`、道具 `index`、容器 `containerIndex`、效果 `idx`）都是**文档序下标**。两个标签页/两次操作在同一 version 下先后删改，第二次的下标已因第一次的结构变动而漂移，但版本校验通过 → **删/改到错误的对象**。这是本项目最本质的一致性风险。

改进方向：
- **短期**：所有写接口强制要求 `version`，缺失即 `400`；补齐玩家三接口的版本校验与前端发送。
- **根治**：改用**稳定实体 id** 寻址而非文档序下标；或每次结构性增删都递增 version 并要求前端逐操作对齐（代价是前端回放模型要跟着改，见 S6）。

### S2【高】缓冲修改非事务，中途抛错留下「半改且不标脏」的污染树

证据（两套范式并存，一半不安全）：
- **安全派（validate-then-apply，可作模板）**：`potions.js:90-114 applyContainerMaterials`（先全量校验进 `cleaned` 再 `replaceChildren`）、`wands.js:245-271 applyWandStatsBatch`（`structuredClone` 先试跑）。
- **不安全派（逐字段就地改、无回滚）**：`playerBasics.js:137-143 applyBasics`、`playerBasics.js:188-198 applyDamageMultipliers`、`wands.js:156-231 applyStatsToWand`（单杖端点 `routes/wands.js:96-101` 直连、**无 dry-run**）、`worldState.js:180-241 applyWorldState`、`perks.js:130-182 addPerk`。

后果：不安全派在循环中途（`requireComponent`/`numStr`/未知字段）抛错时，前面的字段**已经改进内存树**；而路由的 `markDirty` 因抛错**未执行** → 树被污染却不标脏 → **后续任意一次成功编辑的 `commit` 会把这些半改一并写盘**。对跨文件一致性尤其致命（见下）。

改进方向：统一为「先在克隆/纯校验阶段验完，全部通过再一次性 apply」；或给缓冲层加快照/回滚原语，路由在异常时 `discard` 或回滚。

### S3【中】落盘非事务：`commit` 跨文件半提交

`commit()` 逐文件「序列化 → 自检 → tmp → rename → 清 dirty」在**同一个循环**里（`saveManager.js:260-274`）。若第 1 个文件已 `renameSync` 落盘、第 2 个文件在写入/自检时抛错（磁盘满、杀软锁文件、序列化 bug），则 **player.xml 落了新数据、world_state.xml 还是旧的** —— 与 perk 三件套、max_hp 双写这类需要两文件同步的编辑直接冲突。

改进方向：先对所有 dirty 文件完成「序列化 + 自检」，**全部成功后再统一 `rename`**（two-phase commit）。

### S4【中】数值校验分散、口径不一，且对「整数语义字段」过于宽松

- 每个模型各写一份 `numStr`/`numIntStr`，且**都返回原始字符串**：`playerBasics.js:23-29`、`effects.js:204-211`、`wands.js:98-104`、`spells.js`。
- `Number.isFinite(Number(s))` 会放行 `"1e3"`、`"0x10"`、`"3.7"`、`"+5"` 等 JS 可解析但**游戏整数解析器（atoi 类）会误读**的表示法。对 `money`、`invincibility_frames`、法术 `slot`、道具 `count` 等整数语义字段一路放行；且**无任何范围钳制**（负 `max_hp`、天文数字 `money`、`slot=99999` 都能写）。
- 前端全部数值字段用纯文本 `NInput`，**零 `NInputNumber`、零 min/max**；空串过滤还不一致（wands/basics 过滤，WorldCard/DamageSection 不过滤，清空即把 `''` 发给服务端）。
- 具体不对称示例：`spells.js:214-232 updateSpell` 移动槽位**不校验 deckCapacity 上界**，而 `addSpell:190-192` 校验了 → 可把法术 update 到远超弹匣容量的悬空槽；法术 `slot` 走 `numStr` 而非 `Number.isInteger`（`"2.5"` 可写成 `inventory_slot.x="2.5"`），而法杖/道具/效果的 index 都做了整数校验。

改进方向：抽公共校验层，明确区分「浮点原样搬运」与「整数十进制严格校验」，对关键字段加范围与整数约束；前端数值字段统一 `NInputNumber` 或提交前夹取。

> 说明：`numStr` 不做范围钳制在一定程度上是**有意为之**（Steam 攻略故意用 `invincibility_frames=400000000`、`hp=1e30`），这部分应保留自由度；需要收紧的是**整数语义字段的表示法**与**明显非法值**（`"abc"` 不会因 `NaN` 被挡下时的路径）。

### S5【中】前端异常/失败路径欠打磨（三个系统性缺口）

1. **409 恢复路径从未落地**：`api/client.js:20` 设置了 `err.status`（含 409），但**全代码库无一处读取**它；文件头注释承诺的「409 提示刷新」没有实现。更糟的是 `save.act()` 的**失败分支只记日志、不 `refresh()`**（`stores/save.js:52-55`），成功分支才刷新 → 写操作 409 后 `save.version` 保持过期值 → **后续每次写都用同一过期 version → 永久 409**，直到用户手动「重新读取」，且无任何 UI 提示。`effperk.js:84-114 apply()` 甚至没有 try/catch、失败不 `load()`。
2. **加载失败卡片空白无重试**：9 张卡的 `onMounted(load)` **均无 try/catch**（仅 `AppShell.vue:26-31` 包了 `save.refresh`）。服务端未起/500/断网时 → 未捕获 rejection + 卡片空白，无错误态、无重试按钮。
3. **提交无并发锁**：所有「应用/导入」按钮只有 `:disabled="!dirty"`，**没有 in-flight 锁**（`submitting`）。应用期间 `dirty` 仍为真 → 快速双击触发两次并发 `applyAll`/`apply`；effperk 的 shift 出队在并发下会对同一队头 double-POST。
4. **弹窗未保存关闭静默丢弃**：`PotionEditModal.vue` 材料在本地 ref、有脏星号，但 NModal 默认叉/点遮罩关闭**不 emit、静默丢编辑、无二次确认**（`SpellEditModal` 同理，但有显式取消按钮，风险较小）。

改进方向：在 `CardShell` + 一个 `useSubmit` 组合式里统一解决「加载失败态/重试、提交并发锁、409 自动重同步」；给编辑型弹窗加 `:mask-closable="false"` 或关闭确认。

### S6【中】前后端「本地模拟 + 操作回放」强耦合，无契约测试守护

`stores/wands.js:31-82` 与 `stores/items.js:17-110` **手工镜像**了服务端 `model/spells.js`/`model/items.js` 的 idx/slot/containerIndex 语义（remove 后 idx 左移、reorder 赋槽 0..n-1、容器索引重算）。设计精巧（`shadow` 影子推进、失败 `slice(k)` 出队、单线程重试不会重复执行已成功 op），但它把两个服务端不变量硬编码进前端：(a) 缓冲写不递增 version；(b) idx/slot 语义逐行一致。**这两个假设没有任何契约/对拍测试**，一旦服务端演进就会静默产生「编辑到错杖/错法术」的数据损坏。

此外 `stores/wands.js:154-163 load(preserveEdits)` 的表单保留**纯按数组下标 `i` 对齐**、不校验法杖身份 —— 法杖数量变化（导入遗骨杖 / 游戏内增删后重载）时，未应用的编辑会被**错误覆盖到另一把杖上**（`w.index` 明明可用作身份键却没用于重对齐）。

改进方向：引入前后端对拍测试（同一 op 序列跑两套实现断言一致），或让服务端**回包带回权威 idx/version** 供后续 op 重定位；`load` 用 `w.index` 建 Map 做身份对齐，杖不存在则丢弃其 forms/ops。

---

## 2. 具体功能缺陷

| # | 严重度 | 位置 | 问题 | 改进方向 |
|---|---|---|---|---|
| F1 | 中 | `saveManager.js:292-320 setPaths` / `234-243 push` | **`liveDir` 完全不校验**（`if (changingLive) this.liveDir = nextLive`），而 `push` 会 `backup(liveDir)` 后 `cpSync(saveDir, liveDir)`。用户误把实时路径设成任意目录（如 `C:\Windows`）→ push 先递归备份该目录（灾难性慢/大）再把存档覆盖写入。saveDir 有 player.xml 护栏，liveDir 一道都没有。 | liveDir 也要求「存在且像 save00（含 player.xml）」或至少限制在允许根目录下；push 前二次确认目标路径。 |
| F2 | 中 | `saveManager.js:222-231 pull` / `208-217 restore` | 先 `rmSync(saveDir, {recursive,force})` 再 `cpSync`，**非原子**。若拷贝中途失败，saveDir 已被删成空/半 目录（prepull 备份能救数据，但当前工作区已破坏、缓冲仍是旧树）。且经 env `NOITA_WORKSPACE_SAVE`/`config.local.json` 配置的 saveDir **无 player.xml 护栏**，误配即整目录强删。 | 先拷到临时目录再原子替换；对可配置 saveDir 统一加护栏。 |
| F3 | 中 | `worldState.js:192-211 applyWorldState` | `patch.flags` 是**全量替换**（`replaceChildren`）。前端若「读→改一项→回传」时漏带其余运行旗标，会**静默删除所有未回传的旗标**（可能连带游戏进度旗标）。 | 改为增量 patch（add/remove 指定项），或服务端合并而非替换。 |
| F4 | 中 | `unlocks.js:80-92 applyUnlocks` | 立即写盘的第二个循环**运行时 I/O 无保护**：若第 3 条 `unlinkSync` 抛 ENOENT/权限错，前两条已落盘 → **部分应用**，与注释「不做部分应用」矛盾；`unlinkSync`（:89）删除前无 `existsSync`/TOCTOU 兜底。 | `rmSync(path,{force:true})` 吞 ENOENT；失败时返回已应用/未应用清单而非丢弃 `applied[]`。 |
| F5 | 中 | `serialize.js:26-31 escAttr` | 属性转义处理 `& < "`（**结构性注入被挡住**，无法闭合属性/注入标签），但**不转义 `\r` `\n` `\t`**。法杖 `uiName`/`spriteFile`、材料名等自由文本含换行时会原样写入属性 → XML 属性值规范化使游戏读到的值 ≠ 写入值，且破坏「一属性一行」与「逐字节一致」。而 `commit` 自检只比元素数（下条），发现不了。 | `escAttr` 追加 `\r`→`&#13;`、`\n`→`&#10;`、`\t`→`&#9;`；或在写入侧拒绝含控制字符的字符串字段。 |
| F6 | 中 | `saveManager.js:263-266 commit 自检` | 写盘自检只 `countElements` 比对**元素数量**，捕获不了**属性级/文本级损坏**（呼应 F5）。序列化 bug 若只改坏属性值、不改结构，会通过自检正常落盘。 | 自检升级为「重解析后对关键属性/文本做深比对」，或对未改动子树做序列化幂等断言。 |
| F7 | 中 | `electron/main.js:74-76 window-all-closed` | 关窗直接 `app.quit()`，**对未保存的编辑缓冲（服务端内存）零提示**。用户「应用到缓冲」但未点「写入存档」就关窗 → 编辑静默丢失。**无 autosave、无崩溃恢复**（缓冲纯内存，进程崩溃即全丢）。 | 关窗前经 IPC/HTTP 查 `status.dirty`，脏则弹「有未保存更改」确认；可选把缓冲定期落到 userData 临时文件做崩溃恢复。 |
| F8 | 中高 | `playerBasics.js:146-153` | max_hp 双写把**同一个 ÷25 内部值**写进 world_state `PlayerStatsComponent.max_hp`。**实测已确认单位正确**（快照 player `max_hp="10"` / world `max_hp="8"` 都是 ÷25 小整数，CLAUDE.md 无误）——但两值在真实存档中**本就不相等**（250 vs 200），说明游戏把二者当独立量（world 侧疑为运行起始/加天赋前基准）。编辑器强制二者相等，可能覆盖游戏本应保留的差异。 | 复核 world 侧 max_hp 语义；若确为独立基准，改为不强制同步或提供可选开关，而非默认覆盖。 |
| F9 | 低 | `app.js:180-184` | invincibility 恒 `markDirty('player.xml')`，即使 `applyInvincibility` 实际未改任何值（重复 disable）也标脏 → 无谓备份/写盘。 | 依 `applyInvincibility` 是否真的变更返回值决定 markDirty。 |
| F10 | 低 | `noitamap.js:40 redirect:'follow'` | 固定上游反代（SSRF 主机改写已被 `/noitamap/*` 前缀结构性阻断，见 §3 正面项），但 `redirect:'follow'` 会跟随上游 3xx 到任意地址，理论上可被上游重定向到内网。仅绑 127.0.0.1 + 上游可信使风险低。 | 改 `redirect:'manual'` 或校验重定向目标 host 属 noitamap.com。 |

---

## 3. 安全性（localhost 单机工具语境）

- **【中】无 CSRF / Origin / Host 校验，无请求体大小限制**（grep 零命中 cors/csrf/bodyLimit）。服务虽仅绑 `127.0.0.1`，但：
  - 破坏性接口 `POST /api/sync/push?force=1`、`PUT /api/config/paths` **无需请求体**，可被用户浏览器里的**恶意网页以简单跨域 POST（无预检）**触发，把工作区推覆盖实时档、或把路径重指到攻击者可控目录（结合 F1 放大）。
  - **DNS-rebinding** 是更利的版本：恶意页面把自身域名重绑到 `127.0.0.1` 后即与编辑器同源，可**读**响应、完整驱动 API。当前无 Host 白名单，此路不通防。
  - 改进：加一道轻量中间件校验 `Host` ∈ {`127.0.0.1:<port>`, `localhost:<port>`} 且（对写接口）`Origin`/`Sec-Fetch-Site` 合规；或要求写接口带一个页面启动时注入的自定义头（simple-request 无法伪造带自定义头的跨域请求）。
- **【正面】路径穿越白名单到位**：`unlocks.js:21 UNLOCK_FLAG_RE`（`^card_unlocked_[a-z0-9_]+$`）、`bones.js:23 BONES_FILE_RE`（`^[\w\-]+\.xml$`）、`saveManager.js:170 #backupPath`（`^save00-[\w.\-]+$`）均不含 `/ \ ..`，文件名/旗标名/备份名的穿越被彻底阻断。
- **【正面】noitamap 反代**：上游硬编码 + `/noitamap/*` 前缀保证 `rest` 必以 `/` 开头 → 无法用 `@`/`//` 改写 host；请求/响应头按白名单透传，天然丢弃 CSP/上报头。

---

## 4. 测试与工程

### 4.1 测试对可变夹具的隐含假设（当前 3 个失败的根因）

`test/setup.js` 的夹具解析顺序是 `env > 仓库根 save00 > fixtures`。仓库根 `save00/` 是**会随「从实时档拉取」漂移的真实快照**，而多个测试对它的**具体内容**有硬断言：
- `test/items.test.js` 断言「夹具应含药水容器」；
- `test/playerBasics.test.js` 断言注入 PROTECTION_ALL 后效果实体数 +1（快照里已存在则期望 2 实得 1）。

后果：本机全量模式下这些测试**随快照内容红绿不定**，掩盖真实回归信号。改进：把这类用例改为**对合成夹具**（就地构造最小 XML）断言，或先归一化快照状态再断言，让全量模式也稳定绿（CI 的 fixtures 模式已绿）。

### 4.2 测试盲区

- **无并发/索引漂移测试**：S1（乐观锁）这一头号风险**完全没有测试**覆盖。
- **无事务/半改回滚测试**：S2/S3（缓冲半改、commit 跨文件半提交）无异常注入测试（磁盘满/权限失败/序列化 bug 路径）。
- **`noitamap.js` 路由零测试**（唯一对外发起请求的代理，无任何用例）。
- **前端零自动化测试**（vitest + @vue/test-utils 已知暂缓）——S5/S6 全部前端缺陷都无回归网。
- **round-trip 覆盖良好**：player/world_state/mod_config + bones_new/*.xml + stats/*.xml 全量 parse→serialize→parse 结构等价（`test/roundtrip.test.js`），是当前最可靠的质量基石。

### 4.3 CI 覆盖面

`ci.yml` 在 `windows-latest` 跑 `build → lint → test`，但检出环境**无仓库根 save00 → 走 fixtures**，测试数从本机全量的 558 骤降到约 124。**CI 实际覆盖的是最小夹具**，真实存档的全量回归只在开发者本机发生。改进：把有代表性的边界存档（含容器道具、多法术共享槽、多种 perk）沉淀进 fixtures，抬高 CI 覆盖下限。

### 4.4 打包与工具链

- **`web/` 死代码仍随包发布**：`frontend/dist` 已存在，`server/app.js:32` 的双轨探测永远选 dist，`web/`（2919 行）**从不被托管**，但 `package.json:43 files[]` 仍含 `"web/**"` → 被打进 Electron 包做无用负重；且 legacy `web/` 与新前端**已语义漂移**（物品栏改造时明确接受了 web/ 的药水行漂移）。M8.3 收尾（删 web/ + 双轨回退 + `webSyntax.test.js`）**尚未执行**。建议：完成人工逐卡验收后按计划删除。
- **构建脚本硬绑游戏版本与本机路径**：`tools/build-dict.js`/`build-items.js`/`build-icons.js` 的 `WAK_GUESSES` 内联了 `D:/games/Noita.v25.01.2025`、`E:/games/Noita` 等本机路径，字典与图标与 `v25.01.2025` data.wak 绑定。游戏更新需手动重跑并复核（`spell-overrides.js` 近似值清单）。属可接受的「离线预生成」策略，但**换机/换版本无自动探测兜底**。
- **备份体积无上限**：`commit` 每次 `edit` 备份都**整目录拷贝**（含 `world/` ~3MB 二进制、stats），即使只改了 player.xml。`keepBackups=20` 是**份数**上限而非大小 → 实测 `backups/` 已达 **106MB/20 份**。改进：按大小/总量也做上限；或备份只针对受管 XML（world/ 二进制不随 XML 编辑变化，无需每次全拷）。
- **无 LICENSE 文件**：README/package.json 署名 "contributors" 但仓库无 LICENSE，发布二进制的授权状态不明。建议补一个明确许可证。
- **散落文件**：`save00/` 与实时档里都有手工副本 `player - 副本.xml`，`push`/`pull` **无差别整目录拷贝**会把它一并搬运（无害但反映拷贝不加筛选）。

---

## 5. 改进优先级建议（roadmap）

**P0（数据安全 / 一致性，优先）**
1. S2/S3：把不安全的 `apply*` 统一为 validate-then-apply；`commit` 改两阶段（全部序列化+自检成功后再统一 rename）。
2. S1：所有写接口强制 `version`，补齐玩家三接口；中期评估改稳定 id 寻址。
3. F1/F2：liveDir 校验 + push 目标确认；pull/restore 改「临时目录 + 原子替换」。
4. F7：Electron 关窗对脏缓冲弹确认，堵住「未写入即关窗丢编辑」。

**P1（健壮性 / 失败恢复）**
5. S5：`CardShell` + `useSubmit` 统一「加载失败重试 / 提交并发锁 / 409 自动重同步」；`save.act` 失败分支也 `refresh()`；消费 `err.status===409` 给出刷新引导。
6. F3：world_state flags 改增量语义，杜绝静默丢旗标。
7. F4：unlocks 立即写盘的 I/O 失败兜底与部分应用回报。
8. F5/F6：`escAttr` 转义控制字符；`commit` 自检升级为深比对。
9. §3：加 Host/Origin 校验中间件，堵 CSRF/DNS-rebinding。

**P2（工程债 / 可维护性）**
10. §4.1：漂移测试改用合成夹具，让全量模式稳定绿。
11. §4.2：补 S1 并发、S3 事务、noitamap 路由、前端关键交互的测试；引入 wands/items 前后端对拍测试（S6）。
12. §4.4：执行 M8.3 删 web/ 双轨；备份体积上限；补 LICENSE。
13. F8：复核并放开 max_hp 强制同步。

---

## 6. 结语

整体判断：**这是一个完成度高、主干可靠、注释与工程规范整齐的项目**——round-trip 字节保真、路径穿越白名单、拖拽幽灵格的双防线等都做得扎实。它的薄弱点**不在功能覆盖，而在「异常路径与并发/事务一致性」的打磨**：乐观锁的语义空洞（S1）、缓冲与落盘的非事务性（S2/S3）、前端失败恢复的缺口（S5）是三条最值得优先收口的主线，其余为围绕它们的具体缺陷与工程债。按上表 P0→P2 推进即可把「happy path 打磨好、异常路径欠打磨」的当前状态补齐为可放心长期维护的形态。
