# Noita 存档编辑器

Noita（Nolla Games）`save00` 存档的本地编辑器：Node.js（Hono）后端 + Vite/Vue 3 前端，浏览器/Electron 桌面双形态。纯 JavaScript（无 TypeScript）；XML 管道保序保字节（对游戏自产文件 round-trip 逐字节一致）。

功能：存档管理（备份/恢复/实时档拉取推送/进程检测）、玩家属性（HP ×25 换算/金币/氧气/飞行/传送/受伤倍率/无敌）、法杖与法术编辑（含拖拽重排、法术选择器）、特殊效果（88 种 GAME_EFFECT）与天赋注入、药水材料、世界状态、进度解锁旗标、遗骨法杖导入、天赋/传送位置预设，界面中英双语。设计与实现记录见 `docs/save-editor-plan.md`，版本历史见 `CHANGELOG.md`。

## 运行

要求 Node ≥ 20、pnpm ≥ 11（版本由 `packageManager` 字段锁定）。

```sh
pnpm install
pnpm start            # 浏览器模式:http://127.0.0.1:5710
pnpm start:desktop    # Electron 桌面模式(需 devDependencies 装好)
pnpm test             # node --test
```

存档路径解析优先级：环境变量（`NOITA_WORKSPACE_SAVE` / `NOITA_LIVE_SAVE`）→ `config.local.json`（UI 里改路径时写入）→ 默认值（仓库根 `save00/`，不存在时为数据目录下 `save00/`；实时档为 `%USERPROFILE%\AppData\LocalLow\Nolla_Games_Noita\save00`）。

## 桌面打包（M6）

```sh
pnpm dist             # dist/ 下产出 NSIS 安装包 + portable exe
pnpm pack             # 只出 dist/win-unpacked/(调试)
```

- 架构：`electron/main.js` 在 `127.0.0.1` 随机端口起 Hono 服务（`server/app.js` 的 `createApp()`/`startServer()`），`BrowserWindow.loadURL` 加载，前端与浏览器模式同源复用，无 IPC。
- 打包后 `config.local.json` 与默认备份目录落在 Electron `userData`（asar 只读，见 `NOITA_EDITOR_DATA_DIR`）；默认工作区为 `userData/save00`，首次点「从实时档拉取」建立。
- 本仓库 `.npmrc` 配置了 electron 运行时与 electron-builder 工具二进制的 npmmirror 镜像（直连 GitHub 受网络限制时用）；`pnpm-workspace.yaml` 的 `allowBuilds` 放行 electron 的 postinstall。
- `build.electronDist` 指向 `node_modules/electron/dist`，打包复用已下载的运行时，零重复下载。
- 冒烟：`NOITA_SMOKE=1 NOITA_EDITOR_PORT=5721 "dist/win-unpacked/Noita Save Editor.exe"` 只起服务不开窗，`curl http://127.0.0.1:5721/api/status` 验证。
- 应用图标为 Noita 风格像素图（`build/icon.ico`，`pnpm icon` 生成），exe/窗口/favicon 复用。

## 测试与夹具

`pnpm test` 经 `test/setup.js`（`node --import` 预加载）解析存档夹具目录：

1. `NOITA_WORKSPACE_SAVE` 显式指定；
2. 仓库根 `save00/`（本机真实存档快照，不入库——全量回归，测试数随内容伸缩）;
3. `test/fixtures/save00/`（入库的最小夹具：player/world_state/mod_config + 4 根遗骨 + 代表性旗标/魔球/统计——CI 的默认）。

## 仓库布局

项目即仓库根（原 `editor/` 子目录已于 2026-07-17 迁移提升）。`save00/` 是本机存档快照（`.gitignore` 忽略，「从实时档拉取」的目标）；`docs/` 存设计文档；CI（`.github/workflows/ci.yml`，windows-latest）在无 `save00/` 的检出环境自动用 fixtures 跑测试。
