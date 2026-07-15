// 存档路径与全局配置。双路径设计:
//  - workspace 快照(默认操作对象,安全):本仓库的 save00/
//  - live 实时档:游戏实际读写的 LocalLow 目录(仅 pull/push 时接触)
//
// 覆盖优先级:环境变量 > <数据目录>/config.local.json(UI 里改路径时持久化,
// 不入库) > 默认值。环境变量:NOITA_WORKSPACE_SAVE / NOITA_LIVE_SAVE /
// NOITA_EDITOR_PORT / NOITA_EDITOR_DATA_DIR。
//
// 数据目录(dataDir):config.local.json 与默认备份目录的落脚点。
// 默认 = 仓库根;桌面打包(M6)后项目位于只读 asar 内,
// Electron 主进程会在启动时把 NOITA_EDITOR_DATA_DIR 指到 userData。

import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const projectDir = fileURLToPath(new URL('..', import.meta.url)); // 仓库根
const dataDir = process.env.NOITA_EDITOR_DATA_DIR || projectDir;

export const localConfigPath = join(dataDir, 'config.local.json');

function loadLocalConfig() {
  try {
    return JSON.parse(readFileSync(localConfigPath, 'utf8'));
  } catch {
    return {};
  }
}

/** 合并写入 config.local.json(UI 修改路径时调用)。 */
export function saveLocalConfig(patch) {
  const next = { ...loadLocalConfig(), ...patch };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(localConfigPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

function liveDefault() {
  // Windows: %USERPROFILE%\AppData\LocalLow\Nolla_Games_Noita\save00
  const base = process.env.USERPROFILE || homedir();
  return join(base, 'AppData', 'LocalLow', 'Nolla_Games_Noita', 'save00');
}

function workspaceDefault() {
  // 仓库根的 save00/ 快照(与项目同级,不入库);不存在(桌面打包等)时
  // 退到数据目录下的 save00 —— 首次「从实时档拉取」会创建它。
  const repoSave = join(projectDir, 'save00');
  return existsSync(repoSave) ? repoSave : join(dataDir, 'save00');
}

const local = loadLocalConfig();

export const config = {
  projectDir,
  dataDir,
  // 编辑器默认操作的存档目录(工作区快照)
  workspaceSave:
    process.env.NOITA_WORKSPACE_SAVE || local.workspaceSave || workspaceDefault(),
  // 游戏实时档
  liveSave: process.env.NOITA_LIVE_SAVE || local.liveSave || liveDefault(),
  // 备份根目录
  backupsDir: process.env.NOITA_BACKUPS_DIR || join(dataDir, 'backups'),
  // 备份保留份数
  keepBackups: Number(process.env.NOITA_KEEP_BACKUPS || 20),
  // 服务端口 & 绑定地址(仅本机)
  port: Number(process.env.NOITA_EDITOR_PORT || 5710),
  host: '127.0.0.1',
  // 游戏进程名(Windows)
  processName: 'noita.exe',
};
