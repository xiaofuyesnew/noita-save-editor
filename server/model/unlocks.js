// M4 进度解锁模型 —— persistent/flags/ 下 card_unlocked_* 旗标文件的开关。
//
// 旗标 = 文件存在性(内容是游戏写的彩蛋字符串,与语义无关)。已知旗标清单
// 取自 spells.json 的 unlockFlag 字段(spawn_requires_flag);磁盘上存在但
// 字典未收录的 card_unlocked_* 文件(如模组法术)同样列出。
//
// 注意:与 XML 编辑缓冲不同,这里的开关直接写工作区快照的文件系统
// (创建/删除空旗标文件,精确可逆),不经过【写入存档】按钮。

import {
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { getDict } from '../services/dict.js';

// 仅放行法术解锁旗标;同时天然阻断路径穿越(不含 / \ .)
const UNLOCK_FLAG_RE = /^card_unlocked_[a-z0-9_]+$/;
// 游戏自产旗标文件的内容(persistent/flags/* 实测,CRLF 结尾共 26 字节)
export const FLAG_FILE_CONTENT = 'why are you looking here\r\n';

/** 字典中的解锁旗标 → 受其控制的法术列表。 */
function knownUnlockFlags() {
  const map = new Map();
  for (const s of getDict('spells')) {
    if (!s.unlockFlag) continue;
    if (!map.has(s.unlockFlag)) map.set(s.unlockFlag, []);
    map.get(s.unlockFlag).push({ id: s.id, name: s.name, nameZh: s.nameZh });
  }
  return map;
}

/** 磁盘上现存的 card_unlocked_* 旗标文件名集合。 */
function diskUnlockFlags(flagsDir) {
  if (!existsSync(flagsDir)) return new Set();
  return new Set(readdirSync(flagsDir).filter((n) => UNLOCK_FLAG_RE.test(n)));
}

/**
 * 列出全部已知/在盘的解锁旗标及状态。
 * @returns {Array<{flag: string, unlocked: boolean, known: boolean, spells: Array}>}
 */
export function listUnlocks(flagsDir) {
  const known = knownUnlockFlags();
  const onDisk = diskUnlockFlags(flagsDir);
  const flags = [...new Set([...known.keys(), ...onDisk])].sort();
  return flags.map((flag) => ({
    flag,
    unlocked: onDisk.has(flag),
    known: known.has(flag),
    spells: known.get(flag) ?? [],
  }));
}

/**
 * 批量应用开关。changes = { 旗标名: 目标状态布尔 }。
 * 已处于目标状态的条目跳过;非法旗标名整体拒绝(不做部分应用)。
 * @returns {{applied: Array<{flag, unlocked}>, skipped: string[]}}
 */
export function applyUnlocks(flagsDir, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new Error('changes 必须是 { 旗标名: true|false } 对象');
  }
  const entries = Object.entries(changes);
  for (const [flag, enable] of entries) {
    if (!UNLOCK_FLAG_RE.test(flag)) {
      throw new Error(`旗标名非法(仅允许 card_unlocked_*): ${JSON.stringify(flag)}`);
    }
    if (typeof enable !== 'boolean') {
      throw new Error(`旗标 ${flag} 的目标状态必须是布尔值`);
    }
  }

  const onDisk = diskUnlockFlags(flagsDir);
  const applied = [];
  const skipped = [];
  for (const [flag, enable] of entries) {
    if (enable === onDisk.has(flag)) {
      skipped.push(flag);
      continue;
    }
    if (enable) {
      mkdirSync(flagsDir, { recursive: true });
      writeFileSync(join(flagsDir, flag), FLAG_FILE_CONTENT, 'utf8');
    } else {
      unlinkSync(join(flagsDir, flag));
    }
    applied.push({ flag, unlocked: enable });
  }
  return { applied, skipped };
}
