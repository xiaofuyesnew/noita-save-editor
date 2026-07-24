# Noita 存档编辑器（Web 版）实现方案

> 状态：方案设计稿 v1.5（2026-07-17）——项目从 `editor/` 提升至仓库根（§10.8，工程①拆库路线作废）；v1.4：M6 桌面打包代码完成（Electron 封装 + 打包产物冒烟通过，见 §10.7）；v1.3：M5 评审落地代码完成（§10 全部条目 + i18n，UI 人工验收待做）；v1.2：新增 §10 评审落地方案；v1.1：Web 框架改用 Hono（最新 v4），全程纯 JavaScript、不使用 TypeScript
> 目标目录：仓库根即项目根（2026-07-17 起；此前为 `editor/` 子目录），操作对象为仓库根的 `save00/` 快照（不入库）及 `%USERPROFILE%\AppData\LocalLow\Nolla_Games_Noita\save00` 实时存档。
> 本方案基于网络资料 + 对本地 `save00/player.xml`（游戏 Build Jan 25 2025）的逐行实测分析写成，文中标注"实测"的字段均已在本地存档中核对。

---

## 1. 目标与范围

做一个 **Node.js 后端 + 浏览器 Web 界面** 的本地存档编辑器，功能覆盖：

| 模块 | 内容 | 优先级 |
|---|---|---|
| 存档管理 | 备份/恢复、从实时存档拉取/推送、游戏进程检测 | P0（安全基石） |
| 玩家基础 | 生命（×25 换算）、金币、氧气、飞行、移动速度、位置传送、伤害倍率、无敌 | P0 |
| 特殊效果 | 查看/添加/移除玩家身上的 GameEffect（88 种枚举，永久或限时） | P0 |
| 法杖编辑 | 法力、容量、施放延迟、充能时间、乱序、名称、外观、等级 | P0 |
| 法术编辑 | 法杖内法术的增/删/改/排序、次数、永久附加（Always Cast）；背包散装法术 | P0 |
| 天赋（Perk） | 效果型天赋注入（效果实体 + world_state 旗标） | P1 |
| 扩展 | 药水材料、吞服效果/聚合体免疫、世界状态（时间天气/真菌变换）、法术解锁旗标、遗骨法杖导入导出 | P2 |

不做：`.salakieli` 加密文件、`world/` 二进制区块的解析编辑（仅提供按官方指南删除特定区块文件的"场景重置"工具入口，P2 可选）。

---

## 2. 资料来源

| 资料 | 用途 |
|---|---|
| [Steam 指南：Save manipulation/editing](https://steamcommunity.com/sharedfiles/filedetails/?id=2689688828) | player.xml 各字段含义：HP ×25、无敌 4 法、飞行/氧气/速度字段、传送坐标表、吞服效果槽位、装饰开关 |
| [Documentation: GameEffectComponent](https://noita.wiki.gg/wiki/Documentation:_GameEffectComponent) | 效果组件全部属性（frames=-1 永久、exclusivity_group 等） |
| [Modding: Enums — GAME_EFFECT](https://noita.wiki.gg/wiki/Modding:_Enums) | **88 个效果枚举值全表**（含含义标注） |
| [Documentation: AbilityComponent](https://noita.wiki.gg/wiki/Documentation:_AbilityComponent) | 法杖组件属性（mana/mana_max/mana_charge_speed/gun_level/ui_name/sprite_file） |
| [Documentation: ConfigGun](https://noita.wiki.gg/wiki/Documentation:_ConfigGun) | gun_config 4 字段（actions_per_round/deck_capacity/reload_time/shuffle_deck_when_empty） |
| [Documentation: ConfigGunActionInfo](https://noita.wiki.gg/wiki/Documentation:_ConfigGunActionInfo) | gunaction_config 全字段（fire_rate_wait/spread_degrees/speed_multiplier 及伤害加成组） |
| [Documentation: UIIconComponent](https://noita.wiki.gg/wiki/Documentation:_UIIconComponent) | 效果/天赋 HUD 图标组件（icon_sprite_file/name/description/is_perk） |
| [Modding: Spell IDs](https://noita.wiki.gg/wiki/Modding:Spell_IDs) | **422 个法术 action_id 全表**（按 8 类分组，名称↔ID 对照） |
| [Modding: Perk IDs](https://noita.wiki.gg/wiki/Modding:Perk_IDs) | 天赋 ID 表 |
| [Guide: Useful save modding](https://noita.wiki.gg/wiki/Guide:_Useful_save_modding) | 存档目录职责、bones_new 机制、world_pixel_scenes.bin 场景恢复、区块重置 |
| [Steam 讨论：手工加 Perk 的可靠方法](https://steamcommunity.com/app/881100/discussions/0/595136540368206624/) | 天赋在存档中 = 玩家子实体（GameEffectComponent+UIIconComponent），完整拷贝 Entity 块 |
| [Modding: Making a custom perk](https://noita.wiki.gg/wiki/Modding:_Making_a_custom_perk) | perk_pickup 会写入运行旗标 `PERK_PICKED_<ID>` 与 lua_globals 计数 |
| [Takiro/noita-savegame-editor](https://github.com/Takiro/noita-savegame-editor)（Python） | 先例：HP/金币/整杖导入导出；其"不做加法术"的原因（存储结构复杂）正是本项目要解决的 |
| [BrianTehOwnerer/noita-save-editor](https://github.com/BrianTehOwnerer/noita-save-editor)(Go) | 先例：world_state/进度类编辑思路 |
| [salinecitrine/noita-wand-simulator](https://github.com/salinecitrine/noita-wand-simulator)、[TheHorscht/EZWand](https://github.com/TheHorscht/EZWand) | 法杖数据模型与 UI 参考 |

数据字典原始来源：游戏本体 `data/scripts/gun/gun_actions.lua`（422 法术定义，含 sprite/mana/max_uses）、`data/scripts/perks/perk_list.lua`、`data/translations/common.csv`（含简体中文列，用于中文名）。见 §6。

---

## 3. 存档结构分析（实测）

### 3.1 目录职责

```
save00/
├── player.xml            玩家实体全量序列化 —— 本编辑器的主战场
├── world_state.xml       本局世界状态（旗标、lua_globals、天气时间、真菌变换）
├── mod_config.xml        模组开关
├── mod_settings.bin      二进制，不碰
├── session_numbers.salakieli  加密，不碰
├── persistent/           跨局进度
│   ├── flags/            旗标 = 文件存在性（action_*、card_unlocked_*、perk_picked_* 等，实测 191 个）
│   ├── orbs_new/         已收集魔球，文件名 = 球编号
│   └── bones_new/        遗骨法杖 item*.xml（完整法杖实体，可作导入模板库）
├── stats/                统计（只读展示即可）
└── world/                二进制区块（*.png_petri / *.bin），不解析
```

### 3.2 player.xml 实体树（实测行号，148 KB）

```
<Entity name="DEBUG_NAME:player" serialize="0" tags="...player_unit...">
 ├─ _Transform                    位置 position.x/y            (L6)
 ├─ ControlsComponent                                          (L~160)
 ├─ DamageModelComponent          生命/氧气/无敌/伤害          (L199)
 │   └─ <damage_multipliers .../> 15 类受伤倍率                (L257)
 ├─ CharacterDataComponent        飞行                         (L111)
 ├─ CharacterPlatformingComponent 移速（run_velocity 等）
 ├─ GenomeDataComponent           阵营                         (L311)
 ├─ Inventory2Component           背包尺寸/当前手持            (L415)
 ├─ MaterialInventoryComponent / MaterialSuckerComponent       (L509)
 ├─ StatusEffectDataComponent     污渍/吞服效果数组            (L1199)
 ├─ WalletComponent               金币 money                   (L1897)
 ├─ <Entity name="arm_r">、<Entity name="cape">               (L1904,1971)
 ├─ <Entity tags="...效果实体...">  ← 特殊效果/天赋挂在这里（0..n 个）(实测 L2036 有一个 NO_HEAL 样例)
 ├─ <Entity name="inventory_quick">  快捷栏（法杖/道具，0..4+）(L2216)
 │   └─ <Entity tags="teleportable_NOT,item,wand">  法杖实体
 │       ├─ AbilityComponent
 │       │   ├─ <gun_config .../>          ← 嵌套子元素（非属性！）
 │       │   └─ <gunaction_config .../>
 │       ├─ ItemComponent（inventory_slot.x = 快捷栏槽位）
 │       └─ <Entity tags="card_action">    法术卡（0..deck_capacity 个）
 │           ├─ ItemActionComponent action_id="LIGHT_BULLET"
 │           ├─ ItemComponent（inventory_slot.x = 杖内槽位, uses_remaining, permanently_attached）
 │           └─ SpriteComponent ×2 + HitboxComponent + SimplePhysicsComponent
 └─ <Entity name="inventory_full">   背包（散装法术卡，同 card_action 结构）(L4808)
```

### 3.3 关键字段速查（编辑器数据模型依据）

**生命 — DamageModelComponent（L199，实测）**
| 字段 | 实测值 | 说明 |
|---|---|---|
| `hp` / `max_hp` | 4 / 4 | **存档值 ×25 = 游戏显示值**（4 ↔ 100HP）。UI 必须做双向换算 |
| `air_in_lungs` / `air_in_lungs_max` | 7 / 7 | 氧气秒数 |
| `air_needed` | 1 | 置 0 = 水下永久呼吸 |
| `air_lack_of_damage` | 0.6 | 溺水每秒伤害（×25） |
| `invincibility_frames` | 0 | 无敌帧；指南实测上限 400000000 |
| `kill_now` / `is_on_fire` | 0 | 布尔态 |
| `materials_that_damage` + `materials_how_much_damage` | 20 项 CSV | **成对索引对齐**的材料伤害表，编辑时必须同步增删 |
| `<damage_multipliers>` 子元素 | explosion=0.35, holy=1.5, 其余=1 | 15 类受伤倍率；负值 = 受击回血 |

**飞行 — CharacterDataComponent（L111，实测）**：`fly_time_max="3"`（总量秒）、`fly_recharge_spd="0.4"`、`fly_recharge_spd_ground="6"`、`flying_needs_recharge="1"`（置 0 = 无限飞行）。
**移速 — CharacterPlatformingComponent**：`run_velocity`、`fly_velocity_x`、`fly_speed_max_up/down`、`velocity_max_x/y`（Steam 指南：翻倍需同调 velocity_max 与 run_velocity）。
**金币 — WalletComponent（L1897，实测）**：`money`（另有 `money_spent`、`mHasReachedInf`）。
**位置 — 根 `_Transform`**：`position.x/y`。内置传送预设表（取自 Steam 指南，如 月亮 (284.8, -26105)、圣山熔炉 Anvil (1525.88, 6062)、The Work (6401.84, 15144.6) 等，做成 `teleport_presets.json`）。

**无敌实现选项**（UI 提供单选 + 说明）：
1. `GameEffectComponent effect="PROTECTION_ALL" frames="-1"` —— **推荐**，干净可逆，即 Ambrosia 常驻；
2. `invincibility_frames=400000000`；
3. 负 HP（如 -1000，会红屏闪烁，回血超过 0 后失效；极端值如 -1e20 会出 bug）；
4. `hp=1e+030`（显示∞，但接触杀伤材料仍会死，需配合材料伤害清零）。

**法杖 — AbilityComponent（L2238 起，实测）**

编辑器暴露的字段（其余原样保留）：

| 字段 | 位置 | 实测值（新手杖） | 说明 |
|---|---|---|---|
| `ui_name` | AbilityComponent 属性 | "Bolt staff" | 名称，可中文 |
| `gun_level` | 同上 | 1 | 1–10 |
| `mana` / `mana_max` | 同上 | 129/129 | 当前/上限法力 |
| `mana_charge_speed` | 同上 | 25 | 法力恢复 |
| `sprite_file` | 同上 | data/items_gfx/handgun.xml | 外观；程序生成杖为 `data/items_gfx/wands/wand_0898.png`（bones 实测），提供预设下拉 + 自由填写 |
| `reload_time_frames` | 同上 | 0 | ⚠ 运行态镜像，指南要求与 gun_config.reload_time **保持同步**修改 |
| `actions_per_round` | `<gun_config>` | 1 | 每次施放法术数 |
| `deck_capacity` | `<gun_config>` | 2 | 容量（UI 软上限 26，允许更大但给警告） |
| `reload_time` | `<gun_config>` | 20 | 充能时间（帧，÷60=秒） |
| `shuffle_deck_when_empty` | `<gun_config>` | 0 | 乱序 |
| `fire_rate_wait` | `<gunaction_config>` | 9 | 施放延迟（帧） |
| `spread_degrees` | `<gunaction_config>` | 0 | 散射角 |
| `speed_multiplier` | `<gunaction_config>` | 1 | 隐藏弹速倍率 |

高级模式额外暴露 gunaction_config 的伤害加成组（`damage_projectile_add` 等 14 项）与 `damage_critical_chance`。

**法术卡（L2622 起，实测完整模板见附录 A）**
- 身份：`ItemActionComponent action_id="<ID>"`（422 个合法 ID）；
- 槽位：`ItemComponent inventory_slot.x`（0 起，杖内从左到右；背包内同理）；
- 次数：`ItemComponent uses_remaining`（-1 = 无限；配合 gunaction_config `action_max_uses` 语义）；
- **Always Cast**：`ItemComponent permanently_attached="1"`；
- 图标：`SpriteComponent image_file="data/ui_gfx/gun_actions/<sprite>.png"`（每个法术的 sprite 路径收录进字典，不能只靠小写 id 猜）。

**特殊效果实体（L2036 起有完整实测样例，见附录 B）**
- 挂为玩家直接子实体：`<Entity>` 内含 `GameEffectComponent effect="<GAME_EFFECT枚举>" frames="-1"`（-1 = 永久，>0 = 帧数）；
- 可选 `UIIconComponent`（icon_sprite_file/name/description/display_in_hud）让效果在 HUD 显示；效果图标一般在 `data/ui_gfx/status_indicators/`；
- 88 个枚举值全表已取得（NONE/ELECTROCUTION/…/PROTECTION_ALL/…/_LAST），入字典 `effects.json`，UI 按"防护/增益/减益/状态/特殊"分组，危险项（POLYMORPH、ON_FIRE、CESSATION 等）标红提示；
- `exclusivity_group`>0 的效果会顶替同组旧效果（原样保留默认 0 即可）。

**天赋（Perk）注入 = 三件套**（P1）：
1. 玩家子实体（GameEffectComponent + UIIconComponent，社区验证的"从捐赠存档拷完整 Entity 块"法 → 我们用字典里的配方直接生成）；
2. `world_state.xml` `<flags>` 加 `PERK_PICKED_<perk_id小写？实测为 flag 字符串>`（perk_pickup 用 GameAddFlagRun 写入）；
3. `lua_globals` 加 `PERK_PICKED_<ID>_PICKUP_COUNT`。
⚠ 数值修改型天赋（如 Extra HP）不走效果实体，而是直接改组件数值 —— 字典 `perks.json` 中每个天赋标注 `kind: "effect" | "stat" | "complex"`，第一期只放行 effect 型 + 少量映射清晰的 stat 型（breath_underwater→BREATH_UNDERWATER 等），complex 型（Lukki 腿等，指南明确警告会坏）禁用并说明原因。

**状态/吞服 — StatusEffectDataComponent（L1199，实测）**：`<stain_effects>` 与 `<ingestion_effects>` 是 `<primitive>` 文本数组（本版本 42 槽，与 `ingestion_effect_causes` CSV 等长；Steam 指南为 39，**长度必须动态读取，不能硬编码**）。值为剩余秒数；聚合体免疫在最后一槽。槽位含义表做成 `status_slots.json`（从 `status_list.lua` 提取）。P2 提供"清除所有污渍/添加吞服效果"。

**药水（L3925 潜行读取，实测）**：`MaterialInventoryComponent > <count_per_material_type> > <Material material="water" count="1000"/>`。编辑 = 改材料名与数量（材料字典 `materials.json`）。

**world_state.xml（实测）**：`day_count/time/rain/fog`（时间天气）、`perk_gold_is_forever` 等 6 个天赋旗标字段、`<flags>`（运行旗标）、`<lua_globals>`、`<changed_materials>`（真菌变换成对列表，P2 可编辑）、`<orbs_found_thisrun>`。另 `PlayerStatsComponent max_hp`（×25 同单位）建议与 player.xml 同步改（保守起见）。

### 3.4 XML 方言注意点（决定解析器选型）

实测特征：无 XML 声明头；属性每行一个、值后带尾随空格；重复同名子元素（多个 AudioLoopComponent/Entity）；带点属性名（`position.x`）；`<primitive>`/`<string>` 文本节点带换行缩进；attr 值含中文（stats）与逗号 CSV；`reference_frame_stains` 为 300+ 字符 base64。社区大量手工编辑案例证明**游戏解析器对格式宽容**（缺省属性走默认值、缩进无关），但我们仍按"最小惊讶"原则输出仿原生格式。

---

## 4. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 运行时 | Node.js ≥ 20，纯 ESM，**纯 JavaScript（不用 TypeScript，零构建/转译步骤）** | 用户指定 node + 纯 JS；20+ 自带 fetch/test runner，也是 @hono/node-server v2 的最低版本要求；复杂处可用 JSDoc 注释补类型提示 |
| 包管理器 | **pnpm**（`package.json` 的 `packageManager` 字段锁定版本，仅提交 `pnpm-lock.yaml`） | 用户指定；硬链接 store 节省磁盘、安装快、依赖解析严格；命令统一用 `pnpm install` / `pnpm start` / `pnpm test`，不使用 npm/yarn，也不提交 `package-lock.json` |
| Web 框架 | **Hono（最新 v4，实测 4.12.x）+ @hono/node-server（v2）** | 用户指定；基于 Web 标准 API、零依赖、路由快；Node 侧用 `serve()` 启动、`@hono/node-server/serve-static` 托管 web/ 静态文件；Hono 的 TS 类型对纯 JS 是可选增强，`import { Hono } from 'hono'` 直接可用 |
| XML 解析 | **fast-xml-parser v4**，`preserveOrder: true, ignoreAttributes: false, parseTagValue: false, trimValues: false` | 唯一能无损保序处理"重复同名子元素 + 属性顺序"的主流轻量库；全部值按字符串处理避免精度破坏（如 `3.40282e+038`、`-2147483648`） |
| XML 输出 | **自写序列化器（~60 行）** 仿 Noita 原生风格：属性各占一行 + 尾随空格、2 空格层级缩进、文本节点独立行 | 让写回文件与游戏自产文件 diff 最小，便于人工核对与回归测试 |
| 前端 | Vue 3（CDN 单文件引入，无构建链）+ 原生 fetch + 自写 CSS | 免 node_modules 前端依赖与打包；单 HTML + 若干 ES module 即可覆盖本工具复杂度 |
| 备份 | `fs.cp` 目录拷贝到 `backups/save00-<时间戳>/` | 不引压缩依赖；存档 <10 MB |
| 进程检测 | `tasklist /FI "IMAGENAME eq noita.exe" /FO CSV` | Windows 原生；封装成 service 留跨平台接口 |
| 测试 | node:test + 本工作区 save00 副本做 round-trip 夹具 | 解析→序列化→再解析，断言结构等价 |

无数据库；服务只绑定 `127.0.0.1`。

### 4.1 项目结构（2026-07-17 起项目即仓库根）

```
<仓库根>/
├── package.json              # hono + @hono/node-server + fast-xml-parser;electron 打包配置
├── pnpm-workspace.yaml       # pnpm 11 allowBuilds(放行 electron postinstall)
├── .npmrc                    # electron/electron-builder 二进制 npmmirror 镜像
├── .github/workflows/ci.yml  # windows-latest,fixtures 跑 node --test
├── save00/                   # 本机存档快照(不入库,编辑器默认工作区)
├── docs/                     # 本文档
├── electron/
│   └── main.js               # 桌面壳:随机端口起 Hono → BrowserWindow.loadURL
├── server/
│   ├── index.js              # CLI 启动壳(pnpm start);导出 app 供测试
│   ├── app.js                # createApp()/startServer()(M6 拆分,Electron 复用)
│   ├── config.js             # 存档路径(仓库根快照 & LocalLow 实时档)+ 数据目录
│   ├── xml/
│   │   ├── parse.js          # fast-xml-parser 封装(preserveOrder 配置)
│   │   ├── serialize.js      # Noita 风格序列化器
│   │   └── query.js          # 保序树工具:findComponent/findChildEntitiesByTag/attr get/set
│   ├── model/                # 领域模型(读写 preserveOrder 树 ↔ 干净 JSON)
│   │   ├── playerBasics.js   # hp/gold/air/fly/pos/damage_multipliers(含 ×25 换算)
│   │   ├── effects.js        # 效果实体扫描/注入/移除
│   │   ├── wands.js          # 法杖枚举与属性读写
│   │   ├── spells.js         # 法术卡 CRUD/排序/模板生成
│   │   ├── perks.js          # 天赋三件套(联动 world_state)
│   │   ├── potions.js
│   │   ├── bones.js          # 遗骨法杖预览/导入
│   │   ├── unlocks.js        # card_unlocked_* 旗标文件开关
│   │   └── worldState.js
│   ├── services/
│   │   ├── saveManager.js    # load/write(原子)/backup/restore/pull/push/游戏进程检测/互斥锁
│   │   └── dict.js           # 字典加载
│   └── routes/               # api 路由(wands/effects/extras)
├── data/                     # 预生成数据字典(JSON,随仓库提交)
│   ├── spells.json           # 422:{id, name_en, name_zh, type, mana, max_uses, sprite}
│   ├── effects.json          # 88 GAME_EFFECT:{id, name_zh, group, danger, icon?}
│   ├── perks.json            # {id, name_zh, kind: effect|stat|complex, recipe}
│   ├── materials.json        # 常用液体/材料
│   └── spell_types.json
├── tools/build-dict.js       # 从游戏数据文件重建字典(见 §6)
├── web/
│   ├── index.html            # Vue3 CDN 单页
│   ├── app.js + wands/effects/extras/ui.js  # 页面模块(ES module)
│   ├── i18n/                 # zh/en 字典 + 切换器
│   └── style.css
└── test/
    ├── setup.js              # 夹具目录解析(node --import 预加载)
    ├── fixtures/save00/      # 入库的最小夹具(CI 用)
    ├── roundtrip.test.js     # save00 夹具 round-trip 结构等价
    └── *.test.js             # 各模型/API 单测
```

### 4.2 XML round-trip 核心（风险最高点，最先做）

```js
// parse.js 关键配置
new XMLParser({
  preserveOrder: true,          // [{ Entity: [...], ':@': {attrs} }, ...]
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,         // 一切保持字符串："4"、"3.40282e+038"
  parseAttributeValue: false,
  trimValues: false,            // 保住 <primitive> 原始文本，序列化时再规范化
  processEntities: true,
});
// serialize.js：递归输出
// <Tag \n  attr="v" \n  attr2="v" >\n  children\n</Tag>，文本节点单独成行
```

验收标准：对本仓库 `save00/player.xml`、`world_state.xml`、全部 26 个 `bones_new/*.xml` 做 parse→serialize→parse，两棵树深度相等；序列化文本与原文件仅允许空白差异；**最终以游戏实测加载通过为准**（M1 结束时人工验证一次）。

### 4.3 写入安全（所有写操作强制走同一管道）

1. 检测 `noita.exe` 是否运行 → 运行中则拒绝写实时档（可强制覆盖需显式确认）；
2. 自动备份：写前把目标 save00 完整拷到 `backups/save00-YYYYMMDD-HHmmss/`（保留最近 20 份，可配置）；
3. 序列化 → 重新 parse 自检 → 写 `player.xml.tmp` → `fs.rename` 原子替换；
4. 内存互斥锁防并发写；
5. 所有修改在服务端内存的"工作副本"上累积，前端点【写入存档】才落盘（编辑缓冲模式，UI 常驻"未保存更改"标记）。

---

## 5. API 设计（REST，均为 JSON）

| 方法 & 路径 | 功能 |
|---|---|
| `GET /api/status` | 存档路径、游戏是否运行、未保存更改、最近备份 |
| `POST /api/save/reload` | 丢弃缓冲，重新读盘 |
| `POST /api/save/write` | 校验+备份+原子写入 |
| `GET /api/backups` / `POST /api/backups` / `POST /api/backups/:name/restore` / `DELETE /api/backups/:name` / `GET /api/backups/:name/export`(zip 下载) | 备份列表/手动备份/恢复/删除/导出 |
| `POST /api/sync/pull` / `POST /api/sync/push` | LocalLow 实时档 ⇄ 工作区快照（push 前强制备份+进程检测） |
| `GET/PUT /api/player/basics` | hp/maxHp(显示值)/money/air/fly/position/movement |
| `GET/PUT /api/player/damage-multipliers` | 15 类倍率 |
| `POST /api/player/invincibility` | {mode: effect\|frames\|negative\|huge} 四选一应用/撤销 |
| `GET /api/player/effects` | 扫描现有效果实体（含来源标注：本工具注入/游戏产生） |
| `POST /api/player/effects` | {effect, frames, withIcon} 注入 |
| `DELETE /api/player/effects/:idx` | 移除 |
| `GET /api/perks` / `POST /api/perks` / `DELETE /api/perks/:id` | 天赋三件套（联动 world_state.xml） |
| `GET /api/wands` | 快捷栏法杖列表（含槽位、法术摘要） |
| `PUT /api/wands/:i/stats` | AbilityComponent/gun_config/gunaction_config 白名单字段 |
| `GET /api/wands/:i/spells` | 杖内法术（按 inventory_slot.x 排序，附文档序 `idx`） |
| `POST /api/wands/:i/spells` | {actionId, slot, usesRemaining, alwaysCast} 从模板生成注入 |
| `PUT /api/wands/:i/spells/:idx` / `DELETE …/:idx` / `PUT …/order` | 改/删/重排（按卡片文档序 idx 寻址；order 为 idx 排列） |
| `GET/POST/DELETE /api/inventory/spells…` | 背包散装法术，同上 |
| `GET/PUT /api/items/potions/:i` | 药水材料与数量 |
| `GET /api/items/catalog` | 可注入的宝藏道具目录(邪王真眼/法术石/骰子等,静态) |
| `GET /api/items` / `POST /api/items` / `DELETE /api/items/:i` | 快捷栏道具枚举/注入目录道具到空槽/移除 |
| `GET/PUT /api/world/state` | 时间/天气/真菌变换/运行旗标（P2） |
| `GET/PUT /api/persistent/unlocks` | card_unlocked_* 旗标文件开关（P2） |
| `GET /api/bones` / `POST /api/wands/import-bones/:file` | 遗骨法杖预览/导入为新法杖（P2） |
| `GET /api/dict/:name` | spells/effects/perks/materials/status_slots/teleport_presets |

法杖/法术标识用"当前树内索引 + 快照版本号"（每次写盘/重载递增，防止索引漂移误改）。

---

## 6. 数据字典构建

`tools/build-dict.js` 输入优先级：
1. **本机游戏文件**（权威）：Steam 安装目录 `data.wak` 用社区提取器解包后指向其 `data/` 目录；解析 `gun_actions.lua`（正则/简单 Lua 表解析提取 id、sprite、mana、max_uses、type）、`perk_list.lua`、`translations/common.csv`（`zh-hans` 列 → 中文名，key 形如 `action_light_bullet`/`perk_...`）；
2. **Wiki 兜底**：抓取 [Spell IDs](https://noita.wiki.gg/wiki/Modding:Spell_IDs)（422 条 名称↔ID）与 [Perk IDs](https://noita.wiki.gg/wiki/Modding:Perk_IDs) 表格核对补漏。

生成的 JSON **直接提交进仓库**，运行时零依赖；`build-dict` 只在游戏版本更新时手动重跑。GAME_EFFECT 88 值已从 wiki 全量取得，直接写入 `effects.json`（本方案附录 C 收录全表）。

---

## 7. UI 设计

单页应用，左侧固定导航，顶部全局状态条：

```
┌──────────────────────────────────────────────────────────────┐
│ Noita 存档编辑器   [存档: D:\workspace\noita\save00]          │
│ ⚠ 检测到 Noita 正在运行  ● 有未保存更改  [写入存档] [备份]    │
├──────────┬───────────────────────────────────────────────────┤
│ 存档管理 │  <当前页内容>                                      │
│ 玩家属性 │                                                    │
│ 特殊效果 │   玩家属性页：生命 [100]/[100] (存档值 4, ×25)      │
│ 天赋     │   金币 [0]  氧气 [7]s ☑无限  飞行 [3]s ☑无限       │
│ 法杖法术 │   位置 x[227] y[-79] [传送预设▾]  无敌 [选项▾]      │
│ 背包法术 │   受伤倍率表(15项, 默认值高亮非1项)                 │
│ 药水     │                                                    │
│ 世界状态 │                                                    │
│ 进度解锁 │                                                    │
└──────────┴───────────────────────────────────────────────────┘
```

- **法杖页**：法杖卡片横排（名称/图标/核心数据），点开右侧属性表单 + 下方法术槽格子条（`deck_capacity` 个格子，空格虚线框）；法术格子支持拖拽排序、右键删除、点击弹出法术选择器（搜索框 + 8 类型标签页 + 中英文名 + 图标 + mana/次数信息），Always Cast 区独立显示（金色边框，Noita 惯例）；
- **特殊效果页**：现有效果列表（图标/名称/剩余时间或"永久"/移除按钮）+ 添加面板（分组下拉、frames 永久/秒数切换、危险效果红字警示）；
- 所有 ×25 换算只在 UI 层做，接口与存档层始终用存档原生单位并在字段旁标注原始值；
- 中文界面，法术/效果/天赋显示"中文名 (ENGLISH_ID)"。

---

## 8. 实施计划

| 里程碑 | 内容 | 验收 | 状态 |
|---|---|---|---|
| M0 XML 内核 | parse/serialize/query + saveManager（备份/原子写/进程检测） | round-trip 测试全绿；写回的 player.xml 游戏可正常加载（人工进游戏验证） | ✅ 完成（2026-07；422 测试绿，进游戏冒烟待做） |
| M1 玩家基础 | basics/damage-multipliers/invincibility API + 玩家属性页 + 存档管理页 | 改 HP/金币/飞行/传送并进游戏验证生效 | ✅ 代码完成（2026-07；438 测试绿，**进游戏验证待做**） |
| M2 法杖法术 | 字典构建 + wands/spells API + 法杖页（含拖拽与法术选择器） | 新增/删除/重排法术、改容量与充能，进游戏验证；给初始杖加 BLACK_HOLE 实测 | ✅ 代码完成（2026-07；462 测试绿，字典 422 法术自游戏数据镜像构建，**进游戏验证待做**） |
| M3 效果天赋 | effects/perks API + 两个页面 | 注入 PROTECTION_ALL、BREATH_UNDERWATER、EDIT_WANDS_EVERYWHERE 实测；效果 HUD 图标正确 | ✅ 代码完成（2026-07；effects.json 88 枚举 + perks.json 106 天赋（effect 型 37 放行），**进游戏验证待做**） |
| M4 扩展 | 药水/世界状态/进度解锁/bones 导入 | 按项验收 | ✅ 代码完成(2026-07;508 测试绿。药水材料编辑(materials.json 468 种,自游戏数据构建);世界状态 16 字段 + 运行旗标 + 真菌变换;card_unlocked_* 37 旗标文件开关(立即写盘,不走缓冲);遗骨法杖 51 根预览/导入。**进游戏验证待做**) |
| M5 评审落地 | docs/REVIEW.md 全部条目:状态面板 label-value 化 + 路径可配置、日志 card、card 脏标记、grid 全宽布局、按钮上移标题行、法杖统一应用、中英 i18n | 见 §10.5 验收清单 | ✅ 代码完成(2026-07-16;426 测试绿,含 config/paths 与 wands/stats 批量接口单测;**UI 三档宽度人工验收与进游戏冒烟待做**。实现偏差与附带修复见 §10.6) |
| M6 桌面打包 | Electron 封装(server 拆 createApp)+ 独立仓库拆分 | 产出 Windows 安装包与 portable exe;新仓库 CI 测试绿 | ✅ 代码完成(2026-07-17;NSIS 安装包 + portable exe 已产出且对产物做过 HTTP 冒烟,落地记录见 §10.7。"独立仓库拆分"随后被结构调整取代:项目就地提升至仓库根,本仓库即项目仓库,推送即验证 CI —— 见 §10.8) |
| M7 物品栏道具 | items 目录构建(build-items.js 从 data.wak 提取并摊平 <Base>)+ items API + 物品栏页 | 补入邪王真眼等宝藏道具到快捷栏空槽,进游戏验证 | ✅ 代码完成(2026-07-18;items.json 18 个可手持宝藏道具(邪王真眼/法术石/骰子等,自 data.wak 提取、递归展开 <Base>、common.csv 解析中英名);listItems/addItem/removeItem 沿用 bones 导入模式(深拷贝→规整在手态→挂 inventory_quick,道具行 4 格 0–3 空槽分配,满员 API 拒绝且 UI 禁用添加);交互为唯一的「下拉选择→添加」路径(邪王真眼为默认首项,同日按反馈移除了直加按钮);138 测试绿(新增 items/itemsApi 13 项),**进游戏验证待做**) |
| M8 前端工程化 | 前端迁移 Vite + Vue 3(纯 JS,明确不引入 TS)+ Pinia + Naive UI + UnoCSS;拖拽用 SortableJS(Swap);frontend/ 为 pnpm workspace 子包(方案见 §11) | 分四阶段(M8.0–M8.3)逐卡对照验收;服务端 API 契约与 138 项测试零改动;CI 加 lint+build;`pnpm dist` 冒烟 | ✅ 代码完成(2026-07-18;M8.0–M8.2 全量落地 + M8.3 部分收尾,实施记录与偏差见 §11.7。13 卡迁移,lint/build/138 测试三绿,dist 托管与 vite dev 已冒烟;**逐卡人工验收待做**,验收后删 web/ 双轨与 webSyntax 测试) |

每个里程碑结束：`node --test` 全绿 + 用本工作区快照做一次 push→进游戏冒烟。

M4 后仍开放的 P2 项(未纳入任何里程碑,按需追加):吞服效果/聚合体免疫与污渍清除(StatusEffectDataComponent,`status_slots.json` 字典待建)、`teleport_presets.json` 传送预设下拉、场景重置工具入口(按官方指南删除特定 world/ 区块文件)。

评审落地(docs/REVIEW.md,2026-07-16):功能 ①(实时档拉取/推送按钮移入顶栏)与功能 ②(备份改为顶栏【备份管理】弹窗,支持 创建/恢复/删除/导出 zip,导出用 Windows 自带 bsdtar,零 npm 依赖)已在评审前的迭代完成;其余全部条目的实现设计见 **§10**,统一归入 M5(桌面打包与拆库归 M6)。

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 序列化细节差异导致游戏拒载/异常 | M0 就做游戏实载验证；一切数值保持字符串原样搬运；缺省属性不主动增删 |
| 新增法术卡模板不完整（Takiro 编辑器因此放弃该功能） | 模板取自真实存档序列化结果（附录 A），仅参数化 action_id/sprite/槽位/uses；sprite 路径来自字典而非猜测 |
| 游戏版本更新字段变动 | 字典与模板集中在 data/ 与 model/templates；build-dict 可重跑；启动时校验存档内未知结构仅警告不阻断 |
| 误写实时档 | 双路径设计（默认操作工作区快照）、进程检测、写前强制备份、tmp+rename |
| 数值精度（1e+030、-2147483648） | 全字符串管道，UI 校验范围但不做浮点重格式化 |
| complex 型天赋（Lukki 腿）损坏角色 | perks.json 标注 kind，complex 默认禁用并展示指南原文警告 |

---

## 10. 评审落地方案（docs/REVIEW.md，2026-07-16）

评审共 12 条：功能 5、UI 4、i18n 1、工程 2。其中功能 ①② 在评审前的迭代已完成；其余条目的实现设计如下，代码工作归入 M5（打包与拆库归 M6）。

### 10.1 功能条目

**功能① 实时档同步移入 header —— ✅ 已完成**
拉取/推送按钮已在顶栏（`web/index.html` 的 btnPull/btnPush），不在任何配置 card 中。无遗留工作。

**功能② 备份管理独立弹窗 —— ✅ 已完成**
顶栏【备份管理】打开 `<dialog>`，已具备评审要求的全部操作：备份（创建）/恢复/删除/导出 zip。无遗留工作。

**功能③ 存档状态改 label-value 展示，路径可编辑**
- 前端：`#statusJson` 的 `<pre>` JSON 替换为 label-value 网格（复用 `.grid`），展示：存档路径（工作区快照）、实时路径（LocalLow）、游戏运行状态、缓冲脏标记、快照版本、备份数量、最近备份时间。
- 可编辑项：`存档路径`、`实时路径` 渲染为输入框，走该 card 的「应用」按钮（按 UI② 放标题行右侧）；其余为只读文本。
- 后端：新增 `GET/PUT /api/config/paths`。PUT 流程：校验目标目录存在且含 `player.xml` → 持久化到 `editor/config.local.json`（加入 .gitignore，启动时覆盖 `config.js` 默认值）→ 丢弃当前缓冲重新读盘（等价 `/save/reload`）→ 返回新 status。当前缓冲有未保存更改时拒绝，要求带 `force: true` 重发（前端弹确认）。

**功能④ 日志装入 card，逐条加时间戳**
`#log` 外包 `<section class="card">`（标题「日志」），固定 max-height + y 向滚动；`app.js` 的 `log()` 给每条前缀本地时间 `[HH:mm:ss]`。保留现有 ok/warn 着色与"新条目插入顶部"行为。

**功能⑤ card 内有未应用编辑时，标题标星号**
- 区分两级"脏"：① **card 级** —— 表单值 ≠ 上次加载值、尚未点「应用到缓冲」→ 该 card 标题显示 `*`；② **缓冲级** —— 已应用未落盘 → 顶栏「有未保存更改」（现有机制，不变）。
- 实现：公共注册器 `trackCardDirty(cardEl)` —— card 每次加载/渲染完成时对全部 input/select 拍初值快照，监听 input/change 事件比对，增删标题上的 `.dirty-star`；「应用到缓冲」成功回调里重拍快照清星。
- 边界：列表型操作（法术槽增删拖拽、效果/天赋/旗标的添加删除）是"点击即写缓冲"，不产生 card 级脏；只有留在表单里的字段参与比对。

### 10.2 UI 条目

**UI① grid 布局占满横向，card 独立滚动**
- `main` 去掉 `max-width: 900px`，改 `display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 16px; align-items: start` —— 横向占满，x 向最小宽度由 minmax 下限保证、最大 1fr 不限，列数随窗口宽度自适应（响应性由 auto-fill 提供）。
- `.card` 改为 `display: flex; flex-direction: column; max-height: 70vh`（可调），卡体内容区 `.card-body { overflow-y: auto }`；标题行（见 UI②）不随内容滚动。
- 宽内容 card（法杖与法术）用 `grid-column: 1 / -1`（或 span 2）占多列，窄窗口自动降为单列。

**UI② 「应用到缓冲」上移到 card 标题行最右侧，说明文字最小字号放标题下方**
统一 card 结构模板（同时为功能⑤ 的星号和 UI① 的滚动分区打底）：

```html
<section class="card">
  <header class="card-head">
    <div>
      <h2>玩家属性 <span class="dirty-star">*</span></h2>
      <p class="card-desc">改移速翻倍时建议同调 run_velocity 与最大速度。</p>
    </div>
    <button>应用到缓冲</button>
  </header>
  <div class="card-body">…</div>
</section>
```

`.card-head { display: flex; justify-content: space-between; align-items: flex-start }`；`.card-desc { font-size: 11px; color: var(--muted); margin: 2px 0 0 }`。涉及 card：玩家属性、受伤倍率、法杖与法术（见 UI③）、世界状态、进度解锁（「应用(立即写入)」同样上移）、存档状态（功能③ 新增的「应用」）。

**UI③ 法杖与法术统一一个「应用到缓冲」；背包法术提到 card 最上**
- 问题根因：每杖独立提交后 `loadWands()` 整卡重渲染，其余法杖表单里未提交的编辑被冲掉。
- 后端：新增批量接口 `PUT /api/wands/stats`，body `{version, wands: [{index, …白名单字段}]}`，服务端在一次缓冲事务里应用全部 patch —— 任一杖校验失败则整体拒绝并返回逐杖错误，杜绝"部分成功"。保留单杖接口向后兼容（现有测试继续覆盖）。
- 前端：删除每杖的「应用属性到缓冲」按钮，card 标题行一个「应用到缓冲」收集所有法杖表单一次提交，成功后统一重渲染。法术槽的增删改拖拽仍即时写缓冲；这类操作触发的重渲染要先暂存未提交的表单值、渲染后回填，避免同样的冲掉问题。
- 布局：`背包法术(inventory_full)` 区块移到 card 最上方，法杖列表其后。

**UI④ header 层级低于 info 图标**
根因：`.topbar` 有 `position: sticky` 但未设 z-index，而 `.info:hover::after`（tooltip）z-index 为 60，滚动后悬浮于顶栏之上。修复：`.topbar { z-index: 100 }`，一行 CSS，可先行合入。

### 10.3 i18n（中/英切换）

- 方案：无框架自写小型 i18n 模块（约 40 行）。`web/i18n/zh.js`、`web/i18n/en.js` 平面字典（key 形如 `card.player.hp`）；JS 动态文本走 `t(key, params?)`；静态 HTML 用 `data-i18n`（文本）/`data-i18n-tip`（tooltip 的 data-tip）属性，切换语言时全文档扫描替换。
- 语言状态：`localStorage.lang`，默认按 `navigator.language`（中文 → zh，其余 → en）；顶栏加「中 / EN」切换按钮，切换即时生效（动态模块暴露 rerender 钩子）。
- 数据字典复用：spells/effects/perks/materials 等字典已同时含 `name`（英文）与 `nameZh`，按当前语言选择显示字段即可，字典文件不动；法术/效果显示格式从「中文名 (ENGLISH_ID)」变为「当前语言名 (ID)」。
- 工作量主要在文案抽取：index.html 静态文案 + app/wands/effects/extras 四个模块内嵌中文（含长 tooltip、日志消息），预估 200+ 条，允许分两批（静态页 → 动态模块）。
- 服务端错误消息：routes 返回 `errorCode` + 参数，前端用字典渲染（无对应 code 时保底显示原文）。第二批做，量少。

### 10.4 工程条目

**工程① 代码是否搬出 editor/ —— 结论：短期保留，打包发布前再拆独立仓库**
> ⚠ 2026-07-17 更新：本条被 §10.8 的结构调整取代 —— 不拆新仓库，项目直接提升至本仓库根；以下原文保留作决策历史。
- 保留理由：`test/` 的 round-trip 与模型单测直接以本仓库 `save00/`（148 KB player.xml + 26 个 bones 等）为夹具，"真实存档回归"是本项目质量的核心保障；现在拆走就要复制/脱敏夹具，收益为零。
- 拆库时机与清单（与 M6 打包同期）：新建仓库 → 拷贝 editor/（剔除 backups/）→ 夹具最小化（player.xml、world_state.xml、3–5 个代表性 bones、若干 persistent/flags）入 `test/fixtures/` → CI 跑 `node --test` → 本仓库保留存档快照与文档，editor/ 留 README 指向新仓库。

**工程② 桌面打包选型：Tauri vs Electron —— 推荐 Electron**

| 维度 | Electron | Tauri v2 |
|---|---|---|
| 现有 Node 后端（Hono/fs/tasklist/bsdtar） | **零改动复用**：main 进程就是 Node，server/ 直接 import；可保留 127.0.0.1 Hono 或改 IPC | Webview 内无 Node API，二选一：用 Rust 重写全部 fs/XML/进程检测（纯 JS 资产作废，成本最高）；或把 Node 作为 sidecar 打包（node SEA/pkg 产物约 80 MB，体积优势基本丧失，还要管理 sidecar 生命周期） |
| 前端（无构建 ES module） | 原样作为 renderer 加载 | 原样作为 webview 资源加载 |
| 体积/内存 | 安装包约 90–110 MB，常驻内存较高 | 核心约 10 MB（但 sidecar 方案回到约 90 MB） |
| 工具链 | 仅 Node + electron-builder | 需 Rust 工具链；WebView2 运行时（Win10/11 自带） |
| 跨平台 | Win/macOS/Linux 成熟 | 同左 |
| 安全面 | 本地单机工具、仅绑定 127.0.0.1，差异不敏感 | 默认更收紧 |

- 决策依据：本项目的资产几乎全部在 Node 侧（保序 XML 管道、模型层、进程检测、bsdtar 导出），Electron 是唯一"零重写"路径；体积对本地单机工具不构成实际代价。
- 落地形态（M6）：先做一个小重构 —— `server/index.js` 拆出 `createApp()`（可注入端口/路径）与 CLI 启动壳，浏览器模式（`pnpm start`）保持可用；`electron/main.js` 里 import `createApp()` 起 Hono 于随机端口 → `BrowserWindow.loadURL`；electron-builder 出 NSIS 安装包 + portable exe。
- 备选记录：若未来体积成为硬需求，可评估 Node 22 SEA 单文件（无 GUI 壳，仍走浏览器打开）作为轻量发行方式；Tauri 仅在决定用 Rust 重写后端时再议。

### 10.5 实施顺序与验收（M5）

按依赖排序：
1. UI④（1 行 CSS，即时合入）
2. 功能④ 日志 card + 时间戳
3. UI② card 标题行结构统一（为功能⑤/UI③ 打底）
4. UI① grid 全宽布局 + card 内滚动
5. 功能③ 状态面板 label-value + `config/paths` 接口
6. UI③ 法杖批量应用 + 背包法术上移
7. 功能⑤ card 脏标记
8. i18n（文案抽取量大，允许跨批次收尾）

工程①② 为决策记录，代码动作归 M6。

验收：对照 REVIEW.md 逐条人工过 UI；`node --test` 全绿（新增 `config/paths` 与 `wands/stats` 批量接口单测）；窗口 1280/1920/2560 三档宽度检查 grid 响应与 card 独立滚动；编辑任一 card 字段出现星号、应用后消失；中英切换后全页无残留另一语言文案；修改存档路径指向一个备份目录后能正常加载编辑。

### 10.6 M5 落地记录（2026-07-16，代码完成）

按 §10.5 顺序全部实现，426 测试绿。与设计稿的偏差与附带修复：

- **tooltip 实现变更**：UI① 的 card 内滚动（`.card-body { overflow-y: auto }`）会裁剪 CSS `::after` 浮层，字段说明 tooltip 改为 JS 委托 + `position: fixed` 浮层（`ui.js initTooltips()`，样式 `.tooltip-float`），行为不变。
- **i18n 范围**：前端全量完成（静态 `data-i18n/-tip/-ph/-title` + 动态 `t()`，210 键中英对齐，`localStorage.lang` + 顶栏「中/EN」）。设计稿中的"服务端 errorCode 映射"未做（属计划允许的第二批）——服务端错误消息保底显示中文原文；天赋注入说明（perks.json `funcNote`）与效果中文名为字典数据，英文侧显示枚举 ID，不算界面残留。
- **M2 遗留缺陷修复（重复槽位）**：真实存档中同一法杖内多张法术卡可共享 `inventory_slot.x`（实测本快照初始杖两张 LIGHT_BULLET 都在 slot 0）。`reorderSpells` 原按"槽位唯一"查卡导致重排错乱，改为槽位多重集校验 + 逐个消费（同槽按文档序）；前端槽位条对重复槽位顺延显示、禁用单卡点击编辑（提示先拖拽重排规范化）。附合成夹具回归测试。
- **测试夹具动态化**：save00 不入库、随「从实时档拉取」漂移，遗骨数量（51→26）与法杖槽位等硬编码断言全部改为动态比对。
- **杂项**：`saveManager.status()` 新增 `backupsTotal`；`config.js` 支持 `config.local.json`（优先级:环境变量 > 本地文件 > 默认值，已加入 .gitignore）；药水 card 仍为按容器应用（评审仅要求法杖统一）。

### 10.7 M6 落地记录（2026-07-17，代码完成）

按 §10.4 落地形态实施，与设计稿的偏差与实测记录：

- **createApp 拆分**：新增 `server/app.js`（`createApp({webRoot})` + `startServer({port,host,app})`），`server/index.js` 退化为 CLI 壳并继续 `export { app }`（测试兼容）。静态托管 root 从相对 CWD 的 `./web` 改为基于 `import.meta.url` 的绝对路径 —— 打包(asar)与任意目录启动均可用（@hono/node-server 的 serveStatic 实测 `join(root, path)` 支持绝对 root 且自带路径穿越防护）。
- **可写数据目录**：`config.js` 新增 `dataDir`（`NOITA_EDITOR_DATA_DIR` 覆盖，默认 editorDir）——`config.local.json` 与默认备份目录挂 dataDir（asar 内只读）；`workspaceSave` 默认值改为退化链：仓库根 `save00/` 存在用之，否则 `dataDir/save00`（桌面版首次「从实时档拉取」创建）。
- **electron/main.js**：随机端口起服 → `loadURL`；启动先设 `NOITA_EDITOR_DATA_DIR=userData` 再动态 import 服务端（ESM 静态提升会让 config.js 先于赋值求值，必须动态 import）；单实例锁（双开的两份编辑缓冲会互相覆盖写盘）；`NOITA_SMOKE=1` 只起服务不开窗（产物自动化冒烟用）；无菜单 + F5/F12 保留 + 外链走系统浏览器。
- **打包实测**：electron 43.1.1 + electron-builder 26.15.3。两个坑：① pnpm 11 不再读 package.json 的 `pnpm` 字段，构建脚本放行要写 `pnpm-workspace.yaml` 的 `allowBuilds`（electron: true）；② 本网络直连 GitHub 下载被 TLS 断连，`editor/.npmrc` 配 npmmirror 镜像（electron_mirror + electron_builder_binaries_mirror，pnpm 脚本环境注入 npm_config_*），另 `build.electronDist` 指向 `node_modules/electron/dist` 复用已下载运行时。产出 `dist/Noita Save Editor-Setup-0.1.0.exe`（NSIS，99.8MB）与 `-Portable-0.1.0.exe`（99.6MB）。win-unpacked 产物 SMOKE 冒烟通过：/api/status（saveDir=userData\save00）、index.html 200（asar 静态）、/api/dict/spells（asar 字典）、POST /sync/pull → /api/wands 列出真实法杖，全链路 OK。图标未定制（Electron 默认）。
- **夹具最小化（工程①前置）**：`test/fixtures/save00/`（26 文件：player/world_state/mod_config + 4 遗骨 + 13 旗标(含 card_unlocked_paint,extrasApi 断言依赖) + 3 魔球 + stats 样张）入库；新增 `test/setup.js` 经 `node --import` 预加载统一解析夹具目录（env 显式 > 仓库根 save00 > fixtures），7 个直接读盘的测试文件改用它，API 型测试经 env 收敛到同一目录且不再受开发机 config.local.json 干扰。根 `.gitignore` 的裸 `save00` 改锚定 `/save00`（否则 fixtures 被忽略），新增 `editor/.gitignore`（拆库后即仓库根规则）。
- **CI/README**：`editor/.github/workflows/ci.yml`（windows-latest + pnpm/action-setup，拆库后自动生效）；`editor/README.md` 含运行/打包/夹具机制/拆库四步清单。
- **测试**：仓库根真实 save00 下 522 绿；仅 fixtures 下 124 绿（动态测试随夹具内容伸缩，两种来源均验证）。
- **遗留（需用户动作）**：~~新建远程仓库并按 README 清单拆库、推送后确认 CI 绿~~（已由 §10.8 结构调整取代，无需新仓库）；桌面产物进游戏冒烟与 M1–M5 悬置的进游戏验证同批做（桌面版与浏览器版共用同一写盘管道，无新增写盘逻辑）。

### 10.8 结构调整：editor/ 提升至仓库根（2026-07-17）

动因：编辑器项目已是本仓库唯一的代码资产，藏在 `editor/` 子目录不工程化；`save00/` 快照本就不入库，就地提升后本仓库即标准 Node 项目仓库，工程①的"拆独立仓库"路线（连同 M6 遗留的"新建远程仓库"动作）作废。

- **迁移**：已跟踪内容（`data/ server/ test/ tools/ web/ package.json pnpm-lock.yaml`）`git mv` 至根（保留历史）；未跟踪内容（`node_modules/ dist/ backups/ electron/ .github/ .npmrc pnpm-workspace.yaml README.md`）文件系统移动；两份 `.gitignore` 合并为根一份（`/save00/` 等锚定根，fixtures 不受影响）。
- **代码引用修正**（仅两处跨界引用）：`server/config.js` 删除 `repoRoot`，`workspaceDefault()` 改为 `join(projectDir, 'save00')`（`editorDir` 改名 `projectDir`）；`test/setup.js` 的仓库根 save00 探测改 `../save00/`。项目内部相对引用（`dict.js` 的 `../../data`、`electron/main.js` 的 `../server/app.js` 等）随整体平移不变。
- **文档同步**：CLAUDE.md 重写（仓库定位、根目录命令、修正陈旧的 `D:/workspace/noita/` 拷贝路径）；README 去拆库清单改仓库布局说明；§4.1 结构图更新为根布局；ci.yml 注释更新（迁移后对本仓库直接生效）。
- **验证**：`pnpm install`（虚拟 store 绝对路径随目录移动失效，重装自愈）→ 全量/fixtures 双模式测试、浏览器模式与 `pnpm dist` 重打包冒烟（结果见迁移当日记录）。

---

## 11. 前端工程化迁移方案:Vite + Vue 3 + Pinia + Naive UI + UnoCSS(M8,已规划未实施;2026-07-18 修订:明确不引入 TS,选型与工程基线按 Vue 生态最佳实践补全)

### 11.1 现状盘点与迁移动机

现状(2026-07-18):`web/` 11 个文件共约 2.9k 行 —— app.js 294 / extras.js 427 / wands.js 363 / effects.js 221 / items.js 147 / ui.js 97 / i18n 三件 754 / index.html 303 / style.css 323。纯 ES module 零框架零构建,服务端 `serveStatic` + 全量 no-store,改完 F5 即所见;Electron 壳同源 loadURL,无 preload/IPC。

规模虽小,但已积累一批"手写基础设施",它们正是框架要解决的问题:

| 手写设施 | 位置 | 痛点 | 迁移后由谁替代 |
|---|---|---|---|
| 全量重渲染 + 未提交编辑暂存回填 | wands.js `collectPendingEdits`/`restorePendingEdits` | 每次点击即写缓冲的操作都整卡重绘,表单编辑要先存后还,易漏 | Vue 响应式:表单状态住 store,服务端刷新只动基线,问题整体消失 |
| DOM 快照脏标记(card 星号) | ui.js `snapshotCard`/`trackCardDirty` | 基于 DOM 值快照 diff,时序敏感(必须渲染后拍照) | Pinia getter:编辑态 vs 服务端基线的纯数据对比 |
| position:fixed 手写 tooltip | ui.js(card-body overflow 会裁剪 CSS 浮层) | 手动定位/越界翻转 | Naive `n-tooltip`/`n-popover`(内置 teleport) |
| 64 行手写 i18n | i18n/index.js | 功能到顶(无复数/日期),扫描替换静态文案 | vue-i18n(平面键与 `{x}` 占位符语法完全同构,zh/en 各 345 行可 1:1 平移) |
| 原生 `<dialog>` 选择器/编辑器 | index.html + wands.js | 样式/焦点/滚动手工管理 | Naive `n-modal` + `n-select`/`n-input-number` |
| version 乐观锁分散维护 | wands/effects/extras/items 四处各存一份 `version` | 修 409 逻辑要改四处 | 单一 Pinia saveStore |

动机成立的前提:路线图上仍有待做功能(§8 的 P2:吞服效果 status_slots、传送预设、场景重置工具),组件化与集中状态的收益随卡片数量继续增长。若功能就此冻结,现状维护成本可接受,本迁移优先级可下调 —— 这是一次"值得但不紧急"的重构。

### 11.2 技术选型逐项分析

| 选型 | 作用 | 关键收益 | 代价/风险 | 结论 |
|---|---|---|---|---|
| Vite | 构建 + 开发服务器 | HMR 取代 F5;生产产物 hash/压缩 | 引入构建步骤,打破"零构建"哲学;dev 需代理 `/api` | 采用。dev 体验净提升,零构建哲学由"服务端零依赖"继承 |
| Vue 3(`<script setup>`,纯 JS) | 视图层 | 12 张 card 组件化;响应式消灭手动重渲染两大痛点 | 单人项目学习成本可忽略 | 采用。**明确不引入 TS**(决策见 11.6) |
| Pinia(setup-style store) | 状态管理 | version/dirty/字典缓存集中;跨卡联动(遗骨导入→法杖卡刷新)走 store 而非回调注入 | 极小 | 采用 |
| Naive UI | 组件库 | `darkTheme` 开箱贴合现有暗色 UI;Select/Modal/Popover/InputNumber 替换全部手写控件;`themeOverrides` 对齐现有配色(accent #d8a24a) | 按需后仍增 ~200-300KB 级产物(本地应用可接受);默认风格偏圆润需主题微调 | 采用,经 `unplugin-vue-components` NaiveUiResolver 按需引入 |
| UnoCSS | 原子 CSS | 替换 style.css 大部分工具类场景;shortcuts 表达 row/muted 等既有惯用法 | 一屏 5×3 `grid-template-areas` 布局原子类表达力差 | 采用,保留 ~60 行全局 CSS(见 11.4) |
| vue-i18n(legacy: false) | i18n | 现有 zh/en 字典对象直接作为 messages;`t(key, {x})` 占位符语法同构,1:1 平移 | 极小 | 采用 |
| SortableJS(+官方 Swap 插件) | 法术槽拖拽重排 | 替换手写 HTML5 DnD;Swap 语义天然匹配"槽位格互换";触屏支持与容器自动滚动白送 | Swap 插件需全局 mount 一次;与 v-model 列表语义需适配 | 采用。以 `useSlotDrag` composable 直挂实例为首选;`vuedraggable`(vue.draggable.next,同为 SortableJS 封装)作纯列表场景备选 |
| @vueuse/core | 组合式工具集 | `useLocalStorage`(语言持久化)、`useEventListener` 等替代手写胶水 | 极小 | 采用 |

**工程基线(配套,均为 Vue 生态惯例):**

- **脚手架**:`create-vue` 官方脚手架起步 —— 选 JavaScript + Pinia,不选 TS / Router / Vitest / ESLint(lint 不用其生成的手工组装配置,单独接入 antfu 预设,见下);
- **Lint**:`@antfu/eslint-config` 单包 flat config(`eslint.config.js` 仅 `export default antfu()` 一行起步)—— 内置 Vue/JSONC/YAML 支持与 stylistic 格式化,一并取代 eslint-plugin-vue 手工组装与 Prettier 的位置;与 UnoCSS、unplugin-* 同作者生态,约定天然一致。`pnpm lint` 入 CI。**作用域仅 `frontend/`**:antfu 风格(无分号/单引号/2 空格)只约束新前端代码,服务端存量风格不回改;
- **DX**:`vite-plugin-vue-devtools`(仅 dev)、`unplugin-auto-import`(vue/pinia/vue-i18n API 免导入,globals 声明产物接入 eslint 配置)、`unplugin-vue-components`(含 NaiveUiResolver);
- **无 TS 的提示基线**:`jsconfig.json` 配 `@ → src` 路径别名(与 vite alias 一致),编辑器跳转/补全可用;
- **多进程 dev**:`concurrently` 同时起 Hono 与 vite。

### 11.3 与现有架构的接缝(逐条约束与对策)

1. **服务端零改动原则**:REST 契约、编辑缓冲模型、version 乐观锁全部不动。唯一服务端改动 = `createApp({ webRoot })` 的默认值探测(该参数 M6 已为 Electron 预留):`frontend/dist/` 存在则用之,否则回退 `web/` —— 迁移期双轨、随时可切回。
2. **workspace 子包**:`pnpm-workspace.yaml`(现仅用 allowBuilds)增加 `packages: ['frontend']`;前端依赖(vue/vite/naive-ui/unocss 等 ~15 项)全部住 `frontend/package.json`,根 package.json 维持服务端运行时三依赖 —— 依赖面按运行时/构建期物理隔离,electron-builder `files` 只取 `frontend/dist/**`,前端 devDependencies 永不进包。单一 lockfile,CI 的 `pnpm install --frozen-lockfile` 命令不变。`.gitignore` 增 `/frontend/dist/`。
3. **脚本约定**(根 package.json):`pnpm dev` = concurrently 起 Hono(5710)+ `pnpm -C frontend dev`(5173,`server.proxy: { '/api': 'http://127.0.0.1:5710' }`);`pnpm build` = `pnpm -C frontend build`;`pnpm lint` = `pnpm -C frontend lint`;`pnpm start` 维持现语义(起服务托管产物,= 生产形态)。
4. **Electron**:主进程零改动(仍 loadURL 到 Hono 端口,渲染进程只是网页);electron-builder `files` 把 `"web/**"` 换成 `"frontend/dist/**"`(源码不进包)。可选加 `NOITA_DEV_URL` 让桌面壳加载 vite dev server(非必需,不纳入验收)。
5. **缓存策略**:现全量 no-store 是为无构建的模块缓存问题设的;迁移后 vite 产物带 hash,`index.html` 保留 no-store、其余可长缓存。本地应用带宽无压力,简单起见也可整体维持 no-store —— 实施时取简单方案。
6. **CI 与测试**:`ci.yml` 在 test 前加 `pnpm lint` 与 `pnpm build`(SFC/模板语法错误在构建期暴露,接替 webSyntax.test.js 的守卫职责,该测试随 `web/` 删除);服务端 138 项测试不受影响。
7. **网络环境**:`.npmrc` 已配 npmmirror(electron 二进制);vite/esbuild/rollup 平台二进制经 npm registry 由 pnpm 正常安装(本机 pnpm 生态已验证可用);若 registry 拉取慢,追加 `registry=https://registry.npmmirror.com` 即可。
8. **文档同步**:CLAUDE.md 现有「no-build Vue 3 frontend」表述与实情不符(实为 vanilla JS),迁移完成后改为真实的 Vue 3 + Vite 描述;package.json `description` 去掉 "no build step";§4.1 结构图更新。
9. **无 TS 的类型纪律**:`src/api/` 各函数与 store 公共 action 用 JSDoc(`@param`/`@returns`/`@typedef` 描述 API 响应形状)标注,编辑器悬停即文档;不开启 `checkJs`(避免全量类型噪音),类型正确性仍由服务端 API 测试兜底。

### 11.4 目录、状态与组件设计(旧→新映射)

**目录约定(vite 生态惯例):**

```
frontend/
├─ index.html  vite.config.js  uno.config.js  jsconfig.json  eslint.config.js  package.json
└─ src/
   ├─ main.js              # createApp + pinia + i18n + 'virtual:uno.css'
   ├─ App.vue              # n-config-provider(darkTheme + themeOverrides)→ AppShell
   ├─ api/                 # 原生 fetch 薄封装,按服务端路由域一一对应
   │   client.js(统一错误对象与 409 语义) save.js player.js wands.js items.js effects.js extras.js
   ├─ stores/              # Pinia setup-style
   │   save.js(status/version/dirty/paths/backups + act 收编) dict.js(全部字典惰性缓存) log.js + 领域 store
   ├─ composables/         # useDictName.js  useSlotDrag.js(SortableJS+Swap 封装)
   ├─ locales/             # zh.js en.js —— 自 web/i18n 平移,键值不动
   ├─ components/
   │   ├─ AppTopbar.vue
   │   ├─ cards/           # 13 张卡各一 SFC:Player/Invincibility/Damage/Wand/Effect/Perk/
   │   │                   # Potion/Item/World/Unlock/Bones/Status/Log
   │   │                   # WandCard 内拆 WandForm/SpellPickerModal/SpellEditModal
   │   └─ shared/          # FieldLabel.vue(label+tooltip) DirtyStar.vue SlotStrip.vue
   └─ styles/global.css    # 5×3 grid-template-areas 一屏布局与滚动约束(UI⑤)等
                           # UnoCSS 不适合表达的 ~60 行
```

**API 层**:不引 axios/ofetch —— 同源本地 API、无拦截器/重试/取消需求,原生 fetch + ~20 行封装(JSON 序列化、`ok:false` 抛错、409 识别为可刷新冲突)即是该场景下的最佳实践,依赖面最小。JSDoc 标注响应形状(见 11.3-9)。

**Pinia stores:**

- `useSaveStore` —— status/version/dirty/paths/backups;`act()`(错误包装 + 日志 + 刷新)收编为 action;写入/重载/拉推后统一触发各域重载(替代 app.js 手工按序 await 各 load*)
- `useDictStore` —— spells/spell_types/effects/perks/materials/items-catalog 惰性缓存(替代各模块自存 dict* 变量)
- `useLogStore` —— 日志卡数据源(替代 ui.js log())
- 领域各一个轻 store 或组件级 composable —— wands(含未提交编辑态与批量 diff)、items、effects、perks、potions、world、unlocks、bones;`version` 一律读 saveStore

**拖拽(SortableJS 方案)**:`useSlotDrag(elRef, { onSwap })` composable 挂 SortableJS 实例,应用启动时 `Sortable.mount(new Swap())` 一次;槽位格子条上 `filter` 限定仅 `.filled` 可拖、空格与已占格均为落点,swap 结束读取格子 DOM 序列换算新槽位序,调 `PUT …/order`(服务端压缩为 0..n-1 的既有语义不变)。相比手写 HTML5 DnD,触屏支持与容器边缘自动滚动为白送收益。`vuedraggable`(vue.draggable.next)留作未来纯列表重排场景的备选,同属 SortableJS 生态不增加心智。

**i18n**:`web/i18n/zh.js|en.js` 平移至 `frontend/src/locales/`,对象原样喂 vue-i18n(`legacy: false`);语言持久化用 `useLocalStorage('lang', …)`;`dictName`(按语言取 name/nameZh)改为 `useDictName` composable。静态 HTML 的 `data-i18n` 扫描机制废弃 —— 模板内直接 `$t()`。

**保持手写的部分**(框架不替代):5×3 grid 布局 CSS;409 冲突提示语义;满员禁用等业务规则(住领域 store)。

### 11.5 分阶段实施与验收(M8.0–M8.3,预估 3–4 人日)

| 阶段 | 内容 | 验收 |
|---|---|---|
| M8.0 脚手架(0.5d) | `create-vue` 起 `frontend/`(JS+Pinia);workspace 接入(`packages: ['frontend']`);`@antfu/eslint-config`/UnoCSS/Naive 按需/auto-import/devtools/jsconfig 就位;vite proxy;webRoot 双轨探测;AppShell + saveStore/logStore + 顶栏/日志卡/备份弹窗/状态卡 | 新页面完成 status 展示、写入/重载/拉推、备份增删恢复导出、路径切换全流程;`pnpm lint` 与 `pnpm build` 通过;旧页仍可用 |
| M8.1 简单卡(1d) | 玩家属性/无敌/受伤倍率/药水/物品栏/世界状态/进度解锁 七卡 | 与旧页逐卡功能对照清单打勾;物品栏满员禁用、解锁立即写盘提示等交互规则不回退 |
| M8.2 复杂卡(1–1.5d) | 法杖与法术(批量应用/槽位格/`useSlotDrag` SortableJS-Swap 拖拽重排/双弹窗)、特殊效果、天赋、遗骨导入 | 拖拽重排(含触屏)、409 刷新提示、批量校验整体拒绝(details 逐杖展示)、未提交编辑在服务端刷新后保留 —— 边界行为与旧页一致 |
| M8.3 收尾(0.5d) | 删 `web/` 与回退逻辑;webSyntax.test.js 移除(守卫职责移交 CI lint+build);electron-builder files → `frontend/dist/**`;`pnpm dist` + `NOITA_SMOKE=1` 冒烟;ci.yml 加 lint+build;CLAUDE.md/README/本文档同步 | 安装包与 portable 可用;CI 绿;文档与实情一致 |

**回退策略**:迁移全程 `web/` 不动,webRoot 探测顺序对调即回旧页;M8.3 才删除。

### 11.6 明确决策与暂缓项

- **TypeScript:明确不引入**(决策,非暂缓)。全部 `.vue`/`.js` 用纯 JS `<script setup>`;编辑器提示由 `jsconfig.json` 路径别名 + `src/api`/stores 关键层 JSDoc 承担,不开启 `checkJs`;类型正确性由服务端 138 项 API/模型测试兜底(前端消费的每个响应形状都有测试断言)。
- **vitest + @vue/test-utils 组件测试**:暂缓。当前质量守卫 = CI lint+build + 服务端测试(契约不变)+ M8.1/8.2 的逐卡人工对照清单;组件测试待复杂交互(拖拽/批量应用)出过回归再补。
- **路由/SSR**:不需要,单页看板形态维持。

### 11.7 实施记录(2026-07-18,M8.0–M8.2 代码完成 + M8.3 部分收尾)

**完成情况**:frontend/ 子包全量落地(13 张卡 + 顶栏/备份弹窗/共享件,~30 文件);`pnpm lint`/`pnpm build` 全绿;服务端双轨探测生效(dist 存在则托管,已冒烟验证 hash 资源与 API 同源可达);vite dev(HMR + /api 代理)启动验证通过;服务端 138 项测试绿(唯一改动:server.test.js 的 no-store 断言从旧 `/app.js` 改为 `index.html`,原前提"无构建"已失效)。CI 加 `pnpm build` + `pnpm lint`(build 在前,lint 依赖其生成的 auto-import globals);electron-builder files 增 `frontend/dist/**`,`pnpm dist`/`pack` 前置 `pnpm build`;CLAUDE.md 与 package.json description 同步。**待人工逐卡验收后执行**:删 `web/` 与双轨回退分支、移除 webSyntax.test.js、files 里去掉 `web/**`。

**关键实现细节**:

- **vue-i18n 平面键**:字典存在 `'player.hp'` 与 `'player.hp.tip'` 同前缀共存,不能用嵌套解析或 flatJson —— 用 `messageResolver: (obj, path) => obj[path] ?? null` 直查平面键,zh/en 字典逐字平移零改动。
- **语言切换简化**:vue-i18n locale 为响应式,全部模板文案与 dictName 自动重渲染,旧版"切语言全量重载各表单"的流程整体取消(服务端数据与语言无关)。
- **未提交编辑保留**:wands store 维护 forms(编辑态)/baselines(服务端基线)双层,load(preserveEdits) 仅覆盖未编辑字段 —— 旧 collectPendingEdits/restorePendingEdits 的响应式等价物;「写入存档」reloadAll(false) 保留编辑,重载/拉取/恢复/切路径 reloadAll(true) 丢弃(语义与旧版一致)。
- **拖拽**:useSlotDrag 挂 SortableJS + Swap 插件(swapClass 高亮),`draggable: '.slot'` + `filter: '.empty'`;onEnd 只上报显示位下标对,DOM 变更通过子节点 key(renderKey)重建丢弃,状态是唯一事实来源;换算 order = 互换后格子序列中已占格的槽位序,复用既有 `PUT …/order` 压缩语义。
- **dirty 星号**:全部改为纯数据 computed(表单值 vs 基线),DOM 快照/MutationObserver 机制废弃;即时应用卡(无敌/效果/天赋/物品/遗骨)无星号,与旧版一致。

**与方案的偏差**(均为实施时的务实取舍):

1. `src/api/` 未按域拆多文件 —— 仅 client.js 薄封装,路径就地写在卡片/store(规模下按域拆分是纯样板);
2. Naive UI 实际使用范围:NConfigProvider(darkTheme+主题微调)/NModal(备份、法术选择器与编辑)/NTooltip(字段说明)—— 密集表单控件保留原生 input/select + 平移 CSS,视觉零回归优先,InputNumber/NSelect 全面替换留待后续按需;
3. 保留的全局 CSS ~260 行(方案预估 ~60 行)—— 含 slot 格子、card 骨架、表单 grid 全套既有视觉,UnoCSS 仅用于新增零散布局;
4. `create-vue` 脚手架未实际运行 —— 依赖与配置手工搭建(等价文件集,避免生成物再删改),不影响任何验收项。

**M8 后 UI 调整(2026-07-19)——同源卡片合并**:13 卡 → 9 卡,网格 5×3 → 4×3。依据存档结构合并三组同源功能:①玩家属性+无敌+受伤倍率(同属 player.xml DamageModelComponent 簇)→「玩家属性」卡(跨 2 列),页签:基础属性/无敌/受伤倍率;②特殊效果+天赋(天赋在存档中即效果实体+旗标/计数)→「效果与天赋」卡;③物品栏道具+药水材料袋(同为 inventory_quick 非法杖物品,4 格容量共享)→「物品栏」卡。实现:旧卡逻辑原样抽为 `cards/sections/*Section.vue` 子组件(各自 load/apply/onReload 不变),聚合卡用 NTabs(`display-directive="show"` 全常驻挂载)收纳;「应用」按钮移入各页签内部;表单型页签 dirty 经 emit 汇总到卡标题星号,页签名旁另加 `*`,即时应用页签(无敌/效果/天赋/道具)照旧无星号。服务端 API 与测试零改动。

**图标资源提取（2026-07-19）**：新增 `tools/build-icons.js`（与 build-dict/build-items 同风格，自动探测 data.wak，二进制提取 PNG），把 `data/ui_gfx/` 下 5 类图标整目录提取到 `frontend/public/icons/`：gun_actions 638（法术）、perk_icons 124（天赋）、items 60（道具）、animal_icons 185（敌人/boss，含 11 个 `boss_*`，图鉴类功能备用）、status_indicators 93（状态效果），共 1100 张 / 668KB，PNG 签名全部校验通过。字典 sprite 路径 → URL 的映射规则固定为 `'data/ui_gfx/' 前缀替换成 '/icons/'`（如 spells.json 的 `data/ui_gfx/gun_actions/bomb.png` → `/icons/gun_actions/bomb.png`），vite 默认 publicDir 行为下 dev 与 build 产物均可直接访问，无需清单文件。脚本自带字典交叉校验：data/*.json 引用的 579 个 sprite 全部覆盖，出现缺漏时报错退出。曾考虑从 wiki 抓图，实测本网络 429 拒绝且文件名对不上游戏内部 id，弃用。原始图标为 16×16 像素图，前端放大展示需配 `image-rendering: pixelated`。

**法术槽图标化 + 游戏风格悬浮详情（2026-07-19）**：法杖/背包法术槽从"文字格子"改为游戏物品栏渲染 —— 类型底图（`item_bg_*.png` 20px）+ 法术像素图标(16px)按 2 倍整数缩放(40px 格,`image-rendering: pixelated`),右下角标剩余次数,AC 金框、重复槽位红色 `!` 标记保留;悬浮(NPopover raw,150ms 延迟)弹出仿原版深色像素描边面板:图标+名称、描述、统计行(原版 7×7 小图标 `icon_action_type/icon_action_max_uses/icon_mana_drain` 配类型/剩余次数(附字典最大次数)/法力消耗(蓝)/金币价格(金)/Always Cast),页脚 actionId·槽位;法术选择器行同步加 1 倍尺寸小图与描述行。配套:① `build-icons.js` 增提 `inventory` 类别(60 张,含 item_bg 底图与统计小图标,总计 1160 张);② `build-dict.js` 支持直读 data.wak(翻译 csv 回退安装目录散装文件,布局解析复用 build-icons)并新增解析 `description` → spells.json `desc`/`descZh` 字段(仅 FUNKY_SPELL 天生无描述;重跑后 perks/materials 与镜像源字节一致,验证了 wak 读取正确性);③ i18n 增 `wand.tt.*` 与 `spelltype.static_projectile` 键。交互(点击/拖拽/Sortable 类名契约)不变,服务端零改动;lint/build/474 测试全绿,Electron offscreen 截图验证渲染与 tooltip 实际效果。注意:服务端字典有内存缓存,重跑 build-dict 后需重启服务才能看到描述。

**法术槽拖拽幽灵格修复（2026-07-19）**：图标化改版引入回归 —— 拖法术到末格后条上多出一格且该法术看似被复制(数据层始终正常,纯渲染残留)。根因:改版把 `v-for` 从格子 div 挪到了 `<template v-for>` 上以并列 NPopover,**每格因此变成 fragment 迭代根**(生产环境锚点为空文本节点);SortableJS Swap 在 drop 时直接搬 DOM,格子被移出自身锚点区间后,Vue 按"锚点区间遍历"卸载 fragment 时漏删,`renderKey` 重建后残留为幽灵格;且「重新读取」因 key 未变走原地 patch、不触碰兄弟结构,也清不掉。修复两道防线:① `v-for` 移回格子 div(迭代根 = 普通元素,按引用卸载;NPopover 移入格内 `.slot-face`,filled/empty 由 class + 内部条件渲染区分);② `useSlotDrag` onEnd 先把 Swap 互换的两个节点换回原位(marker 三步互换)再上报索引,把与虚拟 DOM 一致的真实 DOM 交还 Vue。验证:Electron offscreen + 合成 HTML5 DnD 事件序列(pointerdown→dragstart→dragenter/over→drop→dragend)驱动真实 Sortable 流程,API 向缓冲种 3 个法术作夹具(不落盘):拖首格到末格后仍 16 格、无复制,刷新重挂载渲染一致,`.slots` childNodes 仅剩外层 v-for 两个锚点;474 测试/lint/build 全绿。教训:**Sortable 管的列表,子项必须是普通元素迭代根 —— fragment(template v-for / 多根组件)在外部脚本搬动 DOM 时会漏卸载**。

---

## 12. 法杖外观还原与选择（M9，2026-07-19 已查证方案，未实施）

### 12.1 查证结论：外观的存储机制与联动公式（全部实测）

**能否还原外观？能否选择更改？—— 都能。** 外观不是独立文件，而是法杖实体 XML 内三处字段的组合（player.xml 快捷栏法杖与 `persistent/bones_new/item*.xml` 遗骨杖同构）：

| 字段 | 位置 | 语义 | 实测样例（bones item921 = wand_0898） |
|---|---|---|---|
| `sprite_file` | `AbilityComponent` | 外观源（物品栏图标） | `data/items_gfx/wands/wand_0898.png` |
| `image_file` + `offset_x/offset_y` + `rect_animation` | `SpriteComponent`（`_tags` 含 `item`/`enabled_in_hand`） | 手持/掉落贴图；offset = **握把点 grip**；程序杖(.png) rect_animation 为空串、初始杖(.xml 精灵) 为 `default` | 同上；offset=(2,2)；`""` |
| `offset.x/.y` | `HotspotComponent`（`_tags="shoot_pos"`） | **枪口点 = tip − grip**（弹丸出射位置） | (8,0) |

游戏侧赋值逻辑（data.wak 内 `data/scripts/gun/procedural/gun_procedural.lua`）：

```lua
SetWandSprite( entity_id, ability_comp, wand.file,
               wand.grip_x, wand.grip_y,
               (wand.tip_x - wand.grip_x), (wand.tip_y - wand.grip_y) )
-- sprite_file / image_file ← file;SpriteComponent offset ← grip;shoot_pos ← tip − grip
```

外观全集与几何数据来源 = 同目录 `wands.lua`：**1000 条**（`file` 唯一，`wand_0000`–`wand_0999`），每条含 `grip_x/grip_y/tip_x/tip_y`（`name` 仅 24 个重复的开发用名，不是游戏内名称）。交叉验证：wand_0898 表值 grip=(2,2)/tip=(10,2) ↔ 存档实测 offset=(2,2)、hotspot=(8,0)，公式吻合。

本机 data.wak（`D:/games/Noita.v25.01.2025`，build-dict/build-icons 已在用）实测：`data/items_gfx/wands/` 下 1016 png + 10 xml；1000 张被 wands.lua 引用，其余 16 张为特殊杖（`custom/*` 与 wand_1000.png，由专属 lua/实体模板设置，v1 不入字典）。贴图为极小像素图（如 wand_0898 是 12×5），预览必须 `image-rendering: pixelated` 放大。

**初始杖**是特例：外观为精灵定义 XML（`data/items_gfx/handgun.xml`/`bomb_wand.xml`，单帧精灵表 12×6 / 13×7 @pos(1,1)，自带 offset(3,3)），此时实体 `SpriteComponent offset=(0,0)`、`rect_animation="default"`，枪口值取实体模板：handgun=(8,−0.5)、bomb_wand=(6,−0.5)（`starting_wand_rng.xml`/`starting_bomb_wand_rng.xml` 实测，与本仓库 save00 的两根在手杖逐字段吻合）。

**现状缺口**：`server/model/wands.js` 已有 `spriteFile` 白名单并同步 `SpriteComponent.image_file`，但**不同步 offset / shoot_pos / rect_animation** —— 现在改外观会得到错误的握把与枪口点（弹丸出射位置错位）；前端仅纯文本输入，无预览无选择。方案核心 = 字典携带每个外观的**最终写入值**，服务端写入时一次改齐三处。

### 12.2 数据与资源（工具层）

1. **build-dict.js 增产物 `data/wands.json`**：解析 wak 内 wands.lua（wak 读取/缓存/lua 文本解析机制全部复用现有），每条输出最终写入值（SetWandSprite 语义在构建期编码完，服务端零公式知识）：
   `{ id:"wand_0898", file:"data/items_gfx/wands/wand_0898.png", name:"Bolt stick", offsetX:2, offsetY:2, hotspotX:8, hotspotY:0, rectAnim:"" }`
   另注入 2 条初始杖：`{ id:"handgun", file:"data/items_gfx/handgun.xml", offsetX:0, offsetY:0, hotspotX:8, hotspotY:-0.5, rectAnim:"default" }` 与 bomb_wand(6,−0.5)。共 1002 条。模板统计值（fire_rate_wait 等）v1 不入库 —— 外观与数值解耦，将来做「按原版模板生成法杖」再扩展。
2. **build-icons.js 增类别**：`data/items_gfx/wands/` 整目录 png → `frontend/public/icons/wands/`（1016 张，含 custom/ 子目录，百 KB 级）；另复制 `data/items_gfx/handgun.png`/`bomb_wand.png` → 同目录（xml 外观的预览直接用整张精灵表，单帧仅 1px 边框差，避免引入 PNG 裁剪依赖）。URL 映射规则与 ui_gfx 条并列：`'data/items_gfx/wands/' → '/icons/wands/'`；两个根级 xml 特例 `data/items_gfx/(handgun|bomb_wand).xml → /icons/wands/$1.png`。
3. **交叉校验**：wands.json 每条 file 对应的预览图必须已提取，缺失报错退出（复用现有校验思路）。

### 12.3 服务端

1. `services/dict.js`：`DICT_NAMES` 增 `'wands'`（`/api/dict/wands` 经现有 `/dict/:name` 路由自动可达，零新端点）；增 `findWandLook(file)`。
2. `model/wands.js` `applyStatsToWand` 的 spriteFile 联动升级（唯一行为变更点）：
   - 现有保留：`AbilityComponent.sprite_file` + `SpriteComponent.image_file`；SpriteComponent 查找条件从 `enabled_in_hand` 放宽为 tags 含 `item` **或** `enabled_in_hand`（对齐游戏 `EntityGetFirstComponent(…, "item")`；两类存档实测均双标签，防御性放宽）；
   - 新增：spriteFile **命中字典** → 同步 `offset_x/offset_y`、`rect_animation`（含 `next_rect_animation` 置空）与 `HotspotComponent(shoot_pos).offset.x/.y`；**未命中**（模组/自定义路径）→ 维持现行为仅改 image_file，不碰几何字段；
   - 容错：无 SpriteComponent/HotspotComponent 时跳过对应联动，fields 如实记录（实测 player 与 bones 杖均齐备，防御性）。
3. bones：`listBones` 已返回 `spriteFile`，预览零服务端改动。遗骨杖不做外观编辑（现为只读+导入，导入后可在法杖卡改）。

### 12.4 前端

1. `stores/dict.js` 增 `ensureWands('/dict/wands')`；shared 增 `wandIconUrl(spriteFile)`（映射规则见 12.2，未知路径返回 null → 占位图标）。
2. **WandCard**：spriteFile 从纯文本升级为「预览 + 选择」组合控件 —— 表单值仍是字符串，forms/baselines/脏星号/批量应用管道零改动：
   - 字段旁常显当前外观预览（pixelated ~3×）；
   - 「选择…」按钮开 **WandLookPickerModal**（仿 SpellPickerModal）：按 id 搜索 + 网格预览（1002 条，懒加载或 NVirtualList），当前值高亮；选中 → 写 `forms[i].spriteFile` → 统一「应用」批量提交；
   - 文本输入保留（模组路径手填），与选择器互补。
3. **BonesCard**：每条遗骨杖加外观预览（读现成 spriteFile，纯展示）。
4. i18n：zh/en 增选择器键；`wand.f.spriteFile.tip` 更新为"选择后自动同步握把/枪口偏移"。

### 12.5 测试与验收

- 单测扩展（wands.test.js / wandsApi.test.js）：① 命中字典（wand_0898）→ sprite_file/image_file/offset/hotspot/rect_animation 全按期望；② 切到 handgun.xml → offset(0,0)、hotspot(8,−0.5)、rect_animation=default；③ 未知路径 → 仅 image_file 变、几何不动；④ 缺组件夹具不抛错；⑤ `/api/dict/wands` 可达。fixtures 需要时给最小杖补 png↔xml 双向切换用例。
- round-trip 全绿（改动均为白名单 setAttr，不触碰序列化）。
- 人工验收：改外观 → 写入 → 推送 live → 进游戏验证**手持贴图、物品栏图标、弹丸出射点**三者正确；初始杖 ↔ 程序杖双向切换无 rect_animation 残留。

### 12.6 边界与风险

- **外观 ≠ 数值**：只改贴图与几何点，法杖数值不动 —— 与游戏"生成时按数值就近选外观"的规则解耦，玩家可自由混搭；`sprite_file` 为持久字段，游戏读档不会回改。
- 模组贴图路径照旧可手填，不校验存在性（游戏缺图显示粉色方块，用户自担）。
- `sprite_hotspot_name` 实测全空，不处理；custom 特殊杖（chainsaw/leukaluu 等）v1 不入字典，手填路径时几何字段不动，属可接受降级。
- 字典/图标与本机游戏版本（v25.01.2025）绑定，与现有 build-dict/build-icons 一致，游戏更新重跑即可。

工作量预估：工具 0.5d + 服务端 0.5d + 前端 1d + 测试/验收 0.5d ≈ **2.5 人日**。

### 12.7 实施记录(2026-07-19,代码完成)

按 12.2–12.5 全量落地,与方案零偏差(仅两处实现细节的务实取舍,见下)。

- **工具**:build-dict.js 增 `parseWands`(最内层 `{}` 块解析 wands.lua,复用 stripLuaComments/wak 管道),产出 `data/wands.json` 1002 条(id 唯一性与数量下限校验;重跑后 spells/perks/materials 与既有产物字节一致)。build-icons.js 增 wands 提取(1016 png 含 custom/ 子目录 + 2 张初始杖精灵表 = 1018 张 / 1.3MB → `icons/wands/`)与 wands.json 全量预览交叉校验。
- **服务端**:dict.js 白名单增 `wands` + `findWandLook`;model/wands.js 外观联动按方案实现,fields 明细报 `spriteFile(SpriteComponent)/(grip)/(shoot_pos)` 三段,便于 API 侧断言与日志。
- **前端**:dict store 增 `ensureWands`;新 `ui/wandIcon.js`(映射规则收敛一处;仅 .png 走 wands/ 映射,custom xml 路径返回占位);WandCard spriteFile 升级为「预览 + 文本输入 + 选择」组合行(`col-span-full` 跨满 field-grid,表单/批量应用管道零改动);新 WandLookPickerModal(取舍①:1002 格全量渲染 + `loading="lazy"` 按需取图,未用虚拟列表 —— 实测 1002 个简单节点无压力;当前外观金框高亮);BonesCard 每条遗骨加只读预览;zh/en 增 `wand.lookPick`/`wandpicker.*` 并更新 spriteFile.tip(取舍②:搜索按编号/英文标签,外观无中文名可译)。
- **测试**:+6 项共 480 全绿 —— 字典条目与 findWandLook 最终值、命中字典三处联动(wand_0898 逐字段)、初始杖 .xml 特例(rect_animation/枪口)、未命中只改贴图、缺组件合成夹具容错、`/api/dict/wands` 与 PUT spriteFile 回显 fields。lint/build 绿。
- **端到端验证**(Electron offscreen,NOITA_EDITOR_PORT 独立实例):卡内两杖预览正确(handgun/bomb_wand);弹窗 1002 格、当前项高亮 `handgun · Starting wand`;点选 wand_0898 后表单值与卡内预览即时联动、卡标题出现脏星;API PUT 实测 fields 三段齐全,png↔xml 双向切换正常。**待人工进游戏验收**:改外观 → 写入 → 推送 live 后确认手持贴图/物品栏图标/弹丸出射点三者。
- 生成物 `data/wands.json` 与 `frontend/public/icons/wands/`(1018 张)按既有惯例提交仓库,CI 零游戏数据依赖。

---

## 13. 缺陷修复:天赋实体归属按图标名精确判定(2026-07-20)

**实测报障**:天赋页添加选中天赋后,列表凭空多出未选的天赋。

**根因**:字典里 4 组天赋共享同一 `gameEffect`(`PROTECTION_FIRE` 同为 PROTECTION_FIRE/FREEZE_FIELD/BLEED_OIL 的配方;爆炸=PROTECTION_EXPLOSION/EXPLODING_CORPSES(gameEffect2)、辐射=PROTECTION_RADIOACTIVITY/BLEED_GAS、电击=PROTECTION_ELECTRICITY/ELECTRICITY 同理)。`perkEntitiesOf` 图标名不匹配时回落按效果匹配,于是注入 A 的实体被姊妹天赋 B/C 认领,连锁三种症状:① `listPerks` 让 B/C 凭空上榜(报障场景);② 后续添加 B 被误判"已在位"而漏注入实体(只写旗标/计数);③ 移除幻影 B 反而串删 A 的实体。快照存档即为实证:12 个 PERK_PICKED 旗标只剩 8 个实体,缺的恰是四个保护系天赋(用户移除幻影时被串删)。

**修复**(`server/model/perks.js`,归属判定分两档):

- **owned(精确)**:带 `UIIconComponent` 的实体(编辑器合并实体/游戏 UI 实体)一律以图标名 `uiName` 为身份,名不符即不认领,绝不回落效果匹配。
- **effectOnly(模糊)**:无图标的游戏效果实体仍按配方效果匹配,但只用于"实体在位"标注与移除清理,不作为存在判据。
- `listPerks` 上榜条件改为旗标/计数/owned 三者之一;`addPerk` 去重只看 owned(游戏已给的天赋也不再叠注 HUD 重复图标);`removePerk` 删 owned + effectOnly 中无其它在位天赋认领同效果的实体(共享效果实体留给仍在位的姊妹)。
- 回归测试 +3(共 543 全绿):姊妹不串档/不漏注入/不串删、gameEffect2 重合、无图标游戏实体的认领与孤儿清理。

**遗留**:被旧逻辑损伤的存档(旗标在、实体缺,UI 显示"实体缺失")可在天赋页对该天赋先移除再添加即可修复。

---

## 14. 物品栏改版:道具+药水合并为游戏化槽位条(2026-07-20,代码完成)

**需求**:物品栏卡的"道具/药水"两页签合并为单一游戏可视化视图 —— 仿游戏道具行的 4 格槽位条(复用法杖卡 SlotStrip 的视觉语言),添加入口统一。已确认交互:支持拖拽换位;新药水为空瓶,点击再编辑。

**服务端**(`model/items.js` / `routes/extras.js`):

- `itemEntities` 统一枚举:非法杖 + 有 `ItemComponent` 即道具,不再排除材料容器 —— 顺带修复 `freeItemSlots` 不计药水占槽的双重分配 bug;`DELETE /items/:i` 自动覆盖容器删除。容器条目附 `isContainer/capacity/materials/containerIndex`(容器索引空间不变,材料编辑仍走 `PUT /items/potions/:containerIndex`)。
- `addItem` 容器规整:剥离所有 `script_source_file` 非空的 `LuaComponent`(原版 potion.xml 用其随机化初始材料,不剥离进游戏会覆盖内容;对照快照已拾取药水实体实测,只保留空 source 的事件钩子),确保空 `count_per_material_type`。
- 新增 `moveItemSlot` + `PUT /items/:i/slot`(目标槽被占则互换;脏数据槽位无效时拒绝交换)。现有接口零形状变更;legacy web/ 道具列表会多出药水行(索引偏移、可删除),接受此漂移。

**目录**(`tools/build-items.js` → `data/items.json`,18→20 条):CATALOG 增 `potion`/`powder_stash`(group `container`);新增 `dedupeTagAttrs` 修原版文件自带的开标签重复属性(powder_stash.xml 的 `leak_pressure_min` 写了两次,保留后值);wak 探测路径补本机 `E:/games/Noita/data/data.wak`。

**前端**:

- 新 `shared/ItemSlotStrip.vue`:40px 格子条,原版 `full_inventory_box`(20→40px)底图 + hover 高亮图 + 道具像素图标 2 倍缩放 + 游戏风 tooltip(容器附材料清单);空槽点击 → 选择器,已占点击 → 编辑/删除,拖拽(useSlotDrag)→ 换槽;重复/越界槽顺延为附加格标 `!`,可拖回空槽修复。
- 新 `ItemPickerModal.vue`(搜索 + 分组过滤 + 图标网格)、`PotionEditModal.vue`(原药水表单入弹窗 + 删除容器;dirty 基线汇总到卡标题星号)。
- `InventoryCard.vue` 去 NTabs 重写;删除 `sections/ItemSection.vue`、`sections/PotionSection.vue`;i18n 增 `invbar.*`/`itempicker.*`/容器类 key,删两页签遗留 key(zh/en 同步)。

**测试**:551 全绿(items 模型 +4:统一枚举与双索引对应、容器占槽、注入空瓶剥脚本、换槽;API +2:药水注入-编辑-删除 e2e、换槽含 409/400)。夹具注释修正:快照道具行现仅 1 瓶水,断言全部动态比对。

---

## 15. 效果与天赋改版:统一图标墙 + 游戏风 tooltip(2026-07-21,代码完成)

**需求**:效果/天赋卡在既有两页签合并(§展示层)之上再游戏化 —— 玩家当前"身上有什么"用统一图标墙展示(金框天赋 / 蓝框效果 / 红框危险),悬浮弹出游戏风格详情(名称/描述/计数或时长/来源/缺失说明),弹窗内可移除;两页签只保留各自添加面板。

**字典**(`tools/build-dict.js` → `data/perks.json`):

- perk 解析新增 `descKey`(`ui_description` 去 `$`),主流程经 common.csv 解出 `desc`/`descZh`(与法术描述同源);106 条天赋 descZh 零缺失。`uiDescription` 原始键保留不动。
- 重跑校验:spells/materials 与提交版逐字节一致(缓存镜像与原字典同源);wands.lua 因本网络屏蔽 GitHub 未重下,`wands.json` 保持提交版(脚本在写出前中止,无影响)。

**前端**:

- 新 `stores/effperk.js`:天赋+效果两列表的共享状态,聚合卡统一 `load()`(含 dict ensure + 双 GET + version 同步),页签添加、墙上移除后各自触发刷新;`save.onReload` 只在卡上注册一次。
- 新 `sections/EffectPerkWall.vue`:40px 格子墙(图标 16→32px 二倍像素缩放),天赋角标 `×n` 计数、限时效果角标秒数;tooltip 复用法术槽的深色像素面板视觉,天赋显示字典描述 + funcNote(major 红字)、实体在位/缺失,效果显示分组/时长/危险警示。效果无 HUD 图标时按 `gameEffect`/`gameEffect2` 反查同效果天赋 `uiIcon` 兜底,再无则文字占位格。
- `EffectSection.vue`/`PerkSection.vue` 瘦身为纯添加面板(列表/移除移入墙,数据走 effperk store);`EffectPerkCard.vue` 改为墙 + 页签结构。i18n 增 `effperk.*` 墙用 key(zh/en 同步)。

**测试**:551 全绿(无服务端形状变更);`pnpm lint` / `pnpm build` 通过。

**修订(2026-07-21 二轮)**:卡改名「天赋与效果」,交互从"点击即写缓冲"改为**本卡暂存**:

- 图标墙分两行:上排天赋 40px 格,下排效果 30px 小格(各自行标题 + 空态文案,替代原单墙混排)。
- 添加/移除只改 effperk store 暂存(`perkAdds`(计数可叠)/`perkRemovals`/`effectAdds`/`effectRemovals`),墙上与缓冲现状区分显示:绿虚线 + 角标「+」= 待添加,红虚线半透明 + 角标「×」= 待移除;tooltip 按钮对应 移除(暂存)/恢复/撤销添加。
- 暂存非空 → CardShell 标题星号;右上「应用到缓冲」(action 插槽)批量提交:先移除后添加,效果删除按索引降序防漂移;版本号仅 reload/commit 递增故批内共用,每步成功即出队,失败剩余可重试;完成后重拉列表并记一条汇总日志(`log.effperkApplied`)。`save.onReload` 的 `discardEdits=true`(重载/拉取/恢复)清空暂存,写入(false)保留。
- 页签顺序天赋在前,只保留添加面板,按钮文案「添加」;两个 NSelect 经 `:render-label` 渲染 16px 像素图标(效果选项同走天赋图标兜底)。图标路径映射抽公共 `ui/dictIcon.js`。

---

## 16. 法术卡改按文档序 idx 寻址 + 法杖弹窗「应用并关闭」(2026-07-21,代码完成)

**报障**:① 法杖弹窗底部按钮仍是「应用到缓冲」且不关弹窗;② 重复槽位的法术卡(游戏自产,多张卡同 `inventory_slot.x`)被禁止点击编辑,提示"先拖拽重排"。

**根因**:②源于按槽位号寻址 —— `cardAtSlot` 取"第一张匹配卡",槽位重复时寻址歧义,§10.6 的 M5 修复因此只能禁编辑绕行。本次根治:**编辑/删除/重排全部改按卡片文档序 `idx`(容器内 `cardEntities` 下标)寻址**,恒唯一,重复槽位卡可直接编辑。

- **服务端**(`model/spells.js` / `routes/wands.js`):`listSpells` 每项附 `idx`;`cardAt(container, idx)` 替代 `cardAtSlot`(越界抛错);`addSpell` 返回值附新卡 idx(append → idx=n−1);`reorderSpells` 的 `order` 语义从"槽位多重集"改为 **idx 排列**(0..n-1),按序赋槽压缩、校验简化;路由 `:slot` → `:idx`(法杖与背包两组,路径形状不变)。
- **前端 store**(`stores/wands.js`):本地模拟镜像新语义 —— `simAdd` 附 `idx: list.length`;`simUpdate/simRemove` 按 idx 查找,**remove 后更大的 idx 左移**(保证 op 日志顺序回放与服务端逐步一致);`simReorder` 校验 idx 排列;`spellOps`/`applyAll` 回放改用 idx。`applyAllLogged` 返回 `save.act` 的 promise(供弹窗按成败决定关闭)。
- **组件**:SlotStrip 去掉重复槽点击拦截与全部重复槽 UI 标记(`!` 角标、tooltip 警示,legacy web 的 dupMark 同删)—— 重复槽位卡与普通卡在交互上完全无差别,顺延显示保留;拖拽 reorder 上报 idx 顺序,`:key` 改用 idx;WandCard 编辑/删除回调传 `spell.idx`,tooltip 迷你图标 `:key` 撞 key 隐患顺带修复;**WandEditModal 底部按钮改「应用」(`common.applyNow`),应用成功即关闭弹窗**(失败留在原地,`save.act` 已记警告)。legacy `web/wands.js` 同步改 idx(M8 验收前仍是回退入口)。
- **i18n**:改 `wand.modalHint`,删 `wand.tt.dup`/`wand.dupMark`/`log.dupWarn`,`log.slotEmpty` → `log.idxEmpty`(zh/en 与 web/i18n 同步)。
- **测试**:554 全绿 —— 模型/API 用例改 idx 寻址;重复槽位用例重写并新增「按 idx 编辑/删除同槽卡互不影响、删除后 idx 左移」;lint 绿。

---

## 17. 物品栏改为「本地暂存 → 统一应用」(2026-07-21,代码完成)

**需求**:物品栏卡与法杖卡交互对齐 —— 加删/换槽/容器材料编辑先改本地暂存,卡右上「应用到缓冲」统一提交(原先是每个操作点击即写服务端缓冲)。纯前端改造,服务端接口零变更。

- **新 `stores/items.js`**(镜像 wands store 的"本地模拟 + 操作日志 + 顺序回放"):`stagedItems` 本地副本(不变式 `index === 下标`,与服务端树内顺序一致)+ `ops` 日志(add/remove/move/materials)。模拟逻辑镜像 `server/model/items.js`:add 首空槽/指定槽校验(0–3)、remove 后重编 index、move 换槽互换(含脏槽位拒换)、materials 仅容器。`containerIndex` 在每次成员变动后重算;**applyAll 回放材料操作时以服务端基线的影子副本逐步推进换算当步 containerIndex**(材料接口按容器索引寻址,与统一道具索引是两个空间)。失败保留剩余操作、重载后抛出;`freeSlots` 由暂存态计算。
- **InventoryCard**:改用 items store;CardShell `#action` 增「应用到缓冲」按钮(disabled=!dirty),卡标题星号 = 暂存非空;`save.onReload(discardEdits => load(!discardEdits))` 与法杖一致(写入保留暂存,重载/拉取丢弃)。
- **PotionEditModal**:去直连 API,改为纯本地编辑 —— 「保存」(common.save)把整表材料 emit 给父级写入暂存并关闭;「删除容器」同样只 emit 暂存删除。`container` prop 接暂存条目(重开可见暂存后的材料)。
- **i18n**:`invbar.desc` 更新为暂存语义;删 `log.itemAdded/itemRemoved/itemMoved/potionApplied`(前端不再逐操作记日志);增 `log.itemsApplied/noItemChanges/itemOpsDropped/itemGone/notContainer/itemSlotRange/itemBarFull/itemSwapInvalid`(zh/en 同步)。legacy `web/` 保持点击即写缓冲(API 未变,不受影响,M8 后删除)。
- **测试**:554 全绿(无服务端变更);lint / build 绿。

---

## 18. 详情增强:法术/天赋/效果/物品/材料的富详情 tooltip(2026-07-22,代码完成)

**需求**:图标化展示已就绪,但详情不足 —— 法术缺施法延迟/充能/散射/暴击/伤害等数值,天赋缺叠加规则等,效果缺描述与默认时长,物品缺描述。优先从游戏数据提取,wiki 仅作抽查校验(用户确认:法术函数体数值采用正则启发式 + 手工覆盖表;范围 = 四类 + 材料简要属性)。

**单位约定**(对照游戏文件验证):字典 JSON 存游戏内部单位,换算只在前端 `ui/format.js` 一处 —— 帧 ÷60 = 秒;伤害内部值 ×25 = 显示值(light_bullet.xml damage=0.12 → 游戏显示 3)。

- **工具**:新 `tools/lib/gamedata.js`(openWak + `<Base>` 展开从 build-items.js 抽出共享,展开链改 async 以兼容镜像下载);三个构建脚本的 WAK_GUESSES 补本机 `E:/games/Noita/data/data.wak`;新 `fetchOptional`(单文件缺失告警跳过,构建降级不中止)。
- **法术**(build-dict.js):action() 体正则启发式提取自引用增量(`c.fire_rate_wait`/`current_reload_time`(全局,非 c.reload_time)/spread/crit/`damage_*_add`/explosion_radius/bounces/lifetime_add/knockback/速度加与乘),同名多匹配求和(乘法求积);速度/爆炸半径钳制模板先剔除;「匹配位于首个 `if` 之后」或「存在未消费的数值赋值行」→ `statsApprox` 标记 + 构建日志清单。弹射物基础数值:`related_projectiles`(缺失回退函数体首个 `add_projectile*`)→ wak 读 XML → Base 展开 → ProjectileComponent(damage/speed/lifetime/damage_by_type)+ config_explosion(damage/radius),产出 `projectile{}`;186/219 命中(caster_cast.xml 游戏数据本身缺失)。新 `tools/spell-overrides.js` 人工覆盖表(26 → 4:挖掘/材料族充能 -10、巨型黑白洞、绝对赋值类、复制/汇集族「恢复现场」误报等;MONEY_MAGIC/BLOOD_TO_POWER/DAMAGE_RANDOM/DAMAGE_FOREVER 刻意保留 statsApprox = 动态数值)。
- **天赋**:补静态字段 stackableMax/maxInPool/stackableRare/oneOff/usableByEnemies/doNotRemove/removeOtherPerks(稀疏输出)。
- **效果**:新合并式构建段 —— status_list.lua(英文名/中英描述/有害/防火)+ effect_entity XML 的 `GameEffectComponent`(effect 属性桥接状态污渍 id ↔ GAME_EFFECT 枚举;frames → durationFrames,88 条补 72/含时长 70)。**只写生成键**(name/desc/descZh/durationFrames/protectsFromFire/isHarmful),策展字段(nameZh/group/danger/recommended/selectable/icon)永不覆写、不删不增条目、保持每条一行格式;测试断言策展字段存活。
- **物品/材料**:items.json 补英文 `desc`;materials.json 补 burnable/onFire/statusEffects(接触附着效果)/hp/dangerFire/dangerRadioactive/dangerPoison。注:可倒 `water` 本身不带 status_effects(WET 污渍硬编码),water_static/blood/lava 等才有。
- **前端**:四处复制的 tooltip 面板 CSS 收敛为全局 `styles/game-tooltip.css`(`.game-tt`+`.tt-*`,组件差异留 scoped 覆盖);新 `ui/format.js`(唯一换算点);新 `shared/SpellTooltip.vue`(数值行按字段稀疏渲染,原版统计小图标),SlotStrip 与 SpellPickerModal(行悬浮,placement=right)共用;EffectPerkWall 天赋补叠加/特性行、效果补描述/默认时长/有害/防火(已保存行同样接入字典);ItemSlotStrip/ItemPickerModal 补描述(目录按 itemName 关联)并把选择器原生 title 升级为同款面板;PotionEditModal 材料选项与详情行附简要属性标记(接触效果解析为效果显示名)。i18n 复用既有 `dmg.*` 伤害类型键族(`spell.tt.dmg` 参数化),新增 spell.tt/perk.tt/eff.tt/mat.* 键(zh/en)。
- **测试**:新 test/dicts.test.js(+6 项共 558 全绿):火花弹全字段(castDelay=3/spread=-1/crit=5/damage=0.12/速度/存在时间)、沉重一击(modifier 无 projectile)、覆盖表生效(DIGGER=-10 且无近似标记)、动态法术保留近似标记、全量 schema 扫描(有限数/伤害类型已知)、effects 策展字段存活 + WET 生成字段、材料/物品字段。lint / build 绿。
- **维护流程**(写入 build-dict.js 头注释):游戏更新重跑后看日志「近似值法术」清单 → 复核补 spell-overrides.js → 再跑;wiki 抽查样本 LIGHT_BULLET/BOMB/DIGGER/HEAVY_SHOT/SPEED/BOUNCE 等(本次网络受限未在线抽查,数值已对照游戏文件与既知 wiki 值核实)。

---

## 19. 应用图标:exe 预览图与运行时窗口图标对齐游戏像素风(2026-07-23,代码完成)

**需求**:打包产物(portable/NSIS exe)与运行时窗口此前均为 Electron 默认图标;要求资源管理器预览图与任务栏/标题栏图标风格尽量与游戏对齐。

- **设计**:原创像素画 —— 深色圆角底板上的紫袍兜帽巫师半身像(金色发光眼、金领扣)+ 手前金色药水圆底瓶;调色板逐色采样自仓库内游戏精灵图(`animal_icons/player.png` 袍紫三阶+腰带金、`items/potion.png` 玻璃灰、`items/goldnugget.png` 金三阶)。32×32 与 16×16 双母版,全部整数倍缩放保像素锐利(16/48 用 16 版,32/64/128/256 用 32 版)。
- **生成器**:新 `scripts/icon/`:`pnglib.mjs`(零依赖 PNG 编解码 + 最近邻缩放)、`icolib.mjs`(ICO 打包,≤64px 走 BMP 条目、128/256 走 PNG 条目)、`generate.mjs`(母版像素画,`--emit` 写正式产物;默认渲染深浅双底预览拼图到 `tools/.cache/` 供人工审阅)、`extract-exe-icon.ps1`(SHDefExtractIcon 从 exe 提取实际渲染帧,验收用)、`dump-colors.mjs`/`preview-refs.mjs`(采样辅助)。`pnpm icon` 一键重生成。
- **接线**:产物三份入库 —— `build/icon.ico`(electron-builder `win.icon` → 嵌入 portable/NSIS exe 资源)、`electron/icon.ico`(BrowserWindow `icon`,开发模式与窗口标题栏;打包后任务栏走 exe 资源)、`frontend/public/favicon.png`(浏览器模式标签页,index.html 挂 link)。
- **验收**:ICO 六条目结构解析正确;重打包 portable 后 SHDefExtractIcon 提取 256px 与设计稿一致;asar 内含 `electron/icon.ico` 与 `frontend/dist/favicon.png`;打包产物 NOITA_SMOKE 冒烟 `/api/status` 正常;lint 绿。测试 555/558:3 项失败为 save00 实时快照状态与夹具预期不符的既有问题(快捷栏无药水、PROTECTION_ALL 已存在),与本次无关。

---

## 20. 预设系统:坐标/天赋/法杖预设的保存与快速应用(2026-07-24,代码完成)

> **修订(2026-07-24,应用户反馈)**:法杖「应用」改为——在**法杖编辑页**把预设数据载入当前编辑的那支杖(覆盖其暂存属性表单 + 法术,再经编辑页「应用」提交到缓冲),**不再**像遗骨那样注入新杖 / 占用槽位。随之调整:③存储→结构化 JSON、④应用语义、⑤落位→编辑弹窗、API(删 `POST /wands/:id/apply`)、前端与测试;下文相关条目均已按此改写。
>
> **实现(2026-07-24,已完成)**:后端 `server/services/presets.js` + `routes/presets.js`(已注册 `app.route('/api', presetRoutes)`);前端 `stores/presets.js` + `shared/PresetListModal.vue`,接入 `WandEditModal`(存 / 载入)、`PlayerBasicsSection`+`MapPickerModal`(存当前位 / 填坐标 + 右键存点)、`EffectPerkCard`(存当前组 / 套用);`wandsStore.applyPresetToWand` 落地(容量取 max 规避缩容时序、法术紧凑重建)。i18n zh/en 同步。测试:`test/presets.test.js`(服务)+ `test/presetsApi.test.js`(路由)绿;`pnpm lint`/`pnpm build` 通过;全量 567/570(3 项失败为既有 save00 快照漂移,与本次无关)。**进游戏验证待做**。

**需求**:三类可复用预设,保存后可编辑标签、快速应用:
1. **坐标预设** —— 在地图上右键把玩家所在坐标存为预设;可编辑标签;一键传送(写玩家 `_Transform`)。
2. **天赋组合预设** —— 把当前一组天赋存为预设;一键套用整组。
3. **法杖预设** —— 把某支法杖(含法术/属性/外观)存为预设;在**法杖编辑页**一键把预设数据载入当前编辑的那支杖(覆盖其暂存表单 + 法术,不新增槽位 / 不插槽)。

**现状勘察结论**(并入设计约束):
- "地图"即 `MapPickerModal.vue`(noitamap.com iframe 反代);右键已读悬浮点 `(x,y)` 弹 `NDropdown` 做"填入坐标",预设入口即在此右键菜单加项。坐标落点走 `PUT /api/player/basics` patch `{position:{x,y}}` → `_Transform`(`model/playerBasics.js`)。
- 天赋走 `stores/effperk.js` 暂存层(`perkAdds`/`perkRemovals`)→ `POST/DELETE /api/perks`(`routes/effects.js`,player+world 双文件事务);仅 `kind==='effect'` 可注入,`complex`(Lua 驱动)拒绝。`listPerks` 出 `{id,name,nameZh,kind,count,source}`,`count` 即叠层数。
- 法杖编辑页(`WandEditModal.vue`)本就是**本地暂存编辑**:属性写 `wandsStore.forms[index]`、法术写 `stagedWandSpells[index]` 并记 `spellOps`,底部「应用」经 `applyAll` 批量提交到缓冲(属性 diff→`PUT /wands/stats`、容量调大先生效;法术操作逐条回放)。`readWand`+`listSpells`(`model/wands.js`/`spells.js`)把某支杖读为结构化对象——**存**预设取此结构,**应用**即反向写回上述暂存层。(遗骨导入 `model/bones.js` 走的是「深拷贝整 `<Entity>` → append 到 `inventory_quick`」注入链;本预设**不再复用**该链——见 ③④ 修订。)
- 唯一 app 级持久化是 `config.local.json`(`saveLocalConfig`/`loadLocalConfig`@`server/config.js`,锚定 `dataDir`:开发=仓库根、打包=Electron userData)。前端仅 `localStorage.lang`,无 Pinia 持久化插件 —— 预设权威态放服务端。

**待确认设计决策**(方括号内为推荐):
- ① 坐标来源:[右键存悬浮点(目的地书签)+ 一个"存当前玩家位"按钮(回程书签),两者都要] / 仅存当前玩家位 / 仅右键取点。
- ② 标签形态:[名称(必填)+ 可选多标签(用于过滤)] / 仅单一名称。
- ③ 法杖存储:[结构化 JSON —— 「编辑页载入」语义下的自然选择:只存法杖编辑器能编辑的字段(`WAND_FORM_FIELDS` 属性 + 法术数组 `{actionId,slot,usesRemaining,alwaysCast}`),载入即逐字段写回暂存层,保真范围与编辑器本身**完全一致**] / 原始 `<Entity>` XML 子树(字节保真,但本方案不再注入实体,载入时前端反需把 XML 反解成表单,徒增面;always-cast/自定义外观已在编辑器字段内,无额外收益)。
- ④ 应用语义(三类统一为「推入既有暂存层 + 复用现成提交链」,均**不新增**服务端 apply 端点):[坐标=直接传送(即写 basics,最少点击);天赋=推入 effperk 暂存(墙上显示待添加,由「应用到缓冲」提交);法杖=**在编辑页载入到当前编辑杖**——覆盖 `forms[index]`(属性,随「应用」的 `PUT /wands/stats` diff 提交、容量调大先生效)、把 `stagedWandSpells[index]` 重建为预设法术并生成等价 `spellOps`(清空现有 remove + 逐法术 add/update),由编辑页「应用」经 `applyAll` 回放提交]。法杖应用只**覆盖某支已存在的杖**(不建新杖、不插槽、无满栏问题);要新杖仍走遗骨导入等既有入口,再对其载入预设。
- ⑤ UI 落位:[贴合各自领域卡 + 共享 store/组件,不新增网格卡] —— 坐标在地图弹窗、天赋在"天赋与效果"卡、法杖在**法杖编辑弹窗内**(存当前杖 / 载入到当前杖,不再挂在卡上的套用列表);另有"独立预设总卡"备选(网格 4×3 现 9 卡,余 3 空位)。

**持久化**(新增 `server/services/presets.js`):独立 `presets.json`(不塞进 config.local.json,避免大体量法杖数据混入),路径 `join(dataDir, 'presets.json')`(仿 `backupsDir` 派生,自动跟随开发/打包目录);原子写(tmp→rename,仿 `saveManager.commit`);坏文件降级空。形如:
```json
{ "locations": [{ "id", "label", "tags": [], "x", "y", "createdAt" }],
  "perks":     [{ "id", "label", "tags": [], "perks": [{ "id", "count" }], "createdAt" }],
  "wands":     [{ "id", "label", "tags": [], "summary": { "uiName", "spellCount", "gunLevel" },
                 "attrs": { …WAND_FORM_FIELDS… },
                 "spells": [{ "actionId", "slot", "usesRemaining", "alwaysCast" }], "createdAt" }] }
```

**API**(新增 `server/routes/presets.js`,`app.route('/api', presetRoutes)`;三类同构):
```
GET    /api/presets                     → { locations, perks, wands }
POST   /api/presets/locations           { label, tags?, x, y }    → 新建
POST   /api/presets/perks               { label, tags?, perks? }  → 新建(perks 省略则抓当前 listPerks 中 kind==='effect' 项)
POST   /api/presets/wands               { label, tags?, index }   → 读缓冲第 index 支杖 → readWand 属性(WAND_FORM_FIELDS)+ listSpells 法术 → 结构化存(含摘要)
PUT    /api/presets/:cat/:id            { label?, tags? }         → 改标签(坐标类可含 x/y)
DELETE /api/presets/:cat/:id
# 法杖无 apply 端点 —— 「载入」是纯前端操作(写编辑暂存),提交复用法杖「应用」链(applyAll)
```
三类应用**均复用现有链、无新增 apply 端点**:坐标→前端直接 `PUT /api/player/basics` 后 `save.syncVersion`;天赋→逐条 `effperk.stagePerkAdd` 推入暂存,由用户"应用到缓冲";法杖→前端把预设写入 `wandsStore.forms[index]`+`stagedWandSpells[index]`(并生成等价 `spellOps`),由编辑页「应用」经 `applyAll` 提交到缓冲。

**前端**:
- 新 `stores/presets.js`:`load()`(单 GET 全量)+ CRUD(`create*/rename/remove`);**应用不在此** —— 由各宿主域自理(坐标走 basics、天赋走 effperk、法杖走 `wandsStore.applyPresetToWand(index, preset)`)。
- 新 `shared/PresetListModal.vue`(按 `category` 参数化:列表 + 标签过滤 + 重命名/删除 + 应用;「应用」经宿主回调注入语义——坐标=传送、天赋=推暂存、法杖=载入当前编辑杖;坐标类附"存当前玩家位")。
- `MapPickerModal.vue`:右键菜单加"存为坐标预设"(用悬浮点);内嵌预设列表(点→填表/传送)。
- `EffectPerkCard.vue`:加"预设"入口(存当前组 / 套用)。
- `WandEditModal.vue`:编辑页内加「存为预设」(存当前杖结构)与「载入预设」(开 `PresetListModal`,选中即调 `wandsStore.applyPresetToWand(index, preset)` 写 `forms[index]`+`stagedWandSpells[index]` 并记等价 `spellOps`,留待「应用」提交);`WandCard.vue` 可选保留每支杖快捷「存为预设」。
- i18n 增 `preset.*`(zh/en 同步):存/应用/改名/删/标签/空态/各类名/日志。

**测试**:
- `presets` service:load/save/原子写、CRUD、坏文件降级空。
- 路由:三类建/列/改标签/删;法杖建=`readWand`+`listSpells` 结构化往返一致、天赋建抓当前 effect 项。
- 前端(`stores/wands.js` `applyPresetToWand`):项目无前端单测运行器(未装 Vitest),此逻辑由 `pnpm build`/`pnpm lint` + 后端结构往返间接覆盖;运行行为(载入后 `forms[index]` 变脏、`spellOps` 等价重建、`applyAll` 后缓冲杖 `readWand`/`listSpells` 与预设一致)进游戏 / 手动验证。
- 保持 `pnpm test` 全绿、`pnpm lint`/`pnpm build` 通过。

**风险/边界**:
- 法杖预设存的是**存时已提交缓冲态**的结构化字段(须先把暂存「应用」到缓冲再存);只覆盖法杖编辑器可编辑的字段范围——编辑器触不到的高级/Lua 字段既不入预设、也不因载入而丢失(它们本就不在编辑面内);载入会**覆盖目标杖当前未提交的暂存编辑**。
- 坐标直接传送 bump 全局 version,与 PlayerCard 暂存表单潜在冲突 → apply 后 `save.syncVersion` + 提示。
- 天赋预设仅存可注入项;套用时字典缺失/complex 项跳过并记日志。
- `presets.json` 用户可手改 → load 宽松校验、坏项跳过。

---

## 附录 A：法术卡实体模板（实测提取，`{}` 为参数）

```xml
<Entity _version="1" name="" serialize="1" tags="card_action">
  <_Transform position.x="{PX}" position.y="{PY}" rotation="0" scale.x="1" scale.y="1"></_Transform>
  <HitboxComponent _enabled="0" _tags="enabled_in_world" aabb_max_x="4" aabb_max_y="3"
    aabb_min_x="-4" aabb_min_y="-3" damage_multiplier="1" is_enemy="1" is_item="0" is_player="0"
    offset.x="0" offset.y="0"></HitboxComponent>
  <ItemActionComponent _enabled="0" _tags="enabled_in_world" action_id="{ACTION_ID}"></ItemActionComponent>
  <ItemComponent _enabled="0" _tags="enabled_in_world" auto_pickup="0" drinkable="1"
    inventory_slot.x="{SLOT}" inventory_slot.y="0" is_identified="1" is_pickable="1"
    item_pickup_radius="14.1" permanently_attached="{ALWAYS_CAST:0|1}" play_hover_animation="0"
    play_spinning_animation="0" preferred_inventory="FULL" remove_on_death="0"
    uses_remaining="{USES:-1}" ></ItemComponent>
  <SimplePhysicsComponent _enabled="0" _tags="enabled_in_world" can_go_up="1"></SimplePhysicsComponent>
  <SpriteComponent _enabled="0" _tags="enabled_in_world,item_identified" alpha="1"
    image_file="{SPRITE:data/ui_gfx/gun_actions/light_bullet.png}" offset_x="8" offset_y="17"
    update_transform="1" update_transform_rotation="1" visible="1" z_index="0.595"></SpriteComponent>
  <SpriteComponent _enabled="0" _tags="enabled_in_world,item_unidentified" alpha="1"
    image_file="data/ui_gfx/gun_actions/unidentified.png" offset_x="8" offset_y="17"
    update_transform="1" update_transform_rotation="1" visible="1" z_index="0.595"></SpriteComponent>
</Entity>
```
（实现时以完整实测块为准 —— 生成器直接复用 parse 出的模板树深拷贝改参，避免手写遗漏；此处省略与实测一致的其余默认属性。）

## 附录 B：永久效果实体模板（实测 NO_HEAL 样例参数化）

```xml
<Entity _version="1" name="" serialize="1" tags="">
  <_Transform position.x="{玩家X}" position.y="{玩家Y}" rotation="0" scale.x="1" scale.y="1"></_Transform>
  <GameEffectComponent _enabled="1" caused_by_ingestion_status_effect="0" caused_by_stains="0"
    causing_status_effect="NONE" custom_effect_id="" disable_movement="0"
    effect="{GAME_EFFECT}" exclusivity_group="0" frames="{FRAMES:-1}" mCaster="0" mCasterHerdId="0"
    mCharmDisabledCameraBound="0" mCharmEnabledTeleporting="0" mCooldown="0" mCounter="0"
    mInvisible="0" mIsExtension="0" mIsSpent="0" mSerializedData=""
    no_heal_max_hp_cap="3.40282e+038" polymorph_target="" ragdoll_effect="NONE"
    ragdoll_effect_custom_entity_file="" ragdoll_fx_custom_entity_apply_only_to_largest_body="0"
    ragdoll_material="air" report_block_msg="1" teleportation_delay_min_frames="30"
    teleportation_probability="600" teleportation_radius_max="1024" teleportation_radius_min="128"
    teleportations_num="0"></GameEffectComponent>
  <InheritTransformComponent _enabled="1" only_position="0" parent_sprite_id="-1" use_root_parent="0">
    <Transform position.x="0" position.y="0" rotation="0" scale.x="1" scale.y="1"></Transform>
  </InheritTransformComponent>
  <!-- 可选 HUD 图标 -->
  <UIIconComponent icon_sprite_file="{ICON:data/ui_gfx/status_indicators/xxx.png}"
    name="{NAME}" description="{DESC}" display_above_head="0" display_in_hud="1" is_perk="0"></UIIconComponent>
</Entity>
```

## 附录 C：GAME_EFFECT 枚举（88 值，来源 wiki Modding: Enums）

NONE, ELECTROCUTION, FROZEN, ON_FIRE, POISON, BERSERK, CHARM, POLYMORPH, POLYMORPH_RANDOM, BLINDNESS, TELEPATHY, TELEPORTATION, REGENERATION, LEVITATION, MOVEMENT_SLOWER, FARTS, DRUNK, BREATH_UNDERWATER, RADIOACTIVE, WET, OILED, BLOODY, SLIMY, CRITICAL_HIT_BOOST, CONFUSION, MELEE_COUNTER, WORM_ATTRACTOR, WORM_DETRACTOR, FOOD_POISONING, FRIEND_THUNDERMAGE, FRIEND_FIREMAGE, INTERNAL_FIRE, INTERNAL_ICE, JARATE, KNOCKBACK, KNOCKBACK_IMMUNITY, MOVEMENT_SLOWER_2X, MOVEMENT_FASTER, STAINS_DROP_FASTER, SAVING_GRACE, DAMAGE_MULTIPLIER, HEALING_BLOOD, RESPAWN, PROTECTION_FIRE, PROTECTION_RADIOACTIVITY, PROTECTION_EXPLOSION, PROTECTION_MELEE, PROTECTION_ELECTRICITY, TELEPORTITIS, STAINLESS_ARMOUR, GLOBAL_GORE, EDIT_WANDS_EVERYWHERE, EXPLODING_CORPSE_SHOTS, EXPLODING_CORPSE, EXTRA_MONEY, EXTRA_MONEY_TRICK_KILL, HOVER_BOOST, PROJECTILE_HOMING, ABILITY_ACTIONS_MATERIALIZED, NO_DAMAGE_FLASH, NO_SLIME_SLOWDOWN, MOVEMENT_FASTER_2X, NO_WAND_EDITING, LOW_HP_DAMAGE_BOOST, FASTER_LEVITATION, STUN_PROTECTION_ELECTRICITY, STUN_PROTECTION_FREEZE, IRON_STOMACH, PROTECTION_ALL, INVISIBILITY, REMOVE_FOG_OF_WAR, MANA_REGENERATION, PROTECTION_DURING_TELEPORT, PROTECTION_POLYMORPH, PROTECTION_FREEZE, FROZEN_SPEED_UP, UNSTABLE_TELEPORTATION, POLYMORPH_UNSTABLE, CUSTOM, ALLERGY_RADIOACTIVE, RAINBOW_FARTS, WEAKNESS, PROTECTION_FOOD_POISONING, NO_HEAL, PROTECTION_EDGES, PROTECTION_PROJECTILE, POLYMORPH_CESSATION, _LAST

常用推荐（UI 置顶）：PROTECTION_ALL（完全免伤）、BREATH_UNDERWATER、MOVEMENT_FASTER(_2X)、FASTER_LEVITATION、HOVER_BOOST、PROJECTILE_HOMING、EDIT_WANDS_EVERYWHERE、REMOVE_FOG_OF_WAR、MANA_REGENERATION、EXTRA_MONEY、SAVING_GRACE、INVISIBILITY、REGENERATION。
