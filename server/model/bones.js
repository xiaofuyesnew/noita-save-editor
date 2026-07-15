// M4 遗骨法杖模型 —— persistent/bones_new/item*.xml 的预览与导入。
//
// bones_new 存放历局阵亡时的法杖完整实体 XML(世界态:tags 带 trap_wand、
// 倒置 scale 等)。导入 = 深拷贝实体树 → 规整为快捷栏在手形态(tags/位置/
// 槽位/解冻)→ 挂到 inventory_quick。法术卡子实体随深拷贝原样带入。
//
// 快捷栏法杖槽固定 0–3(游戏常量);全满时拒绝导入。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseXml } from '../xml/parse.js';
import {
  docRoot,
  findComponent,
  getAttr,
  setAttr,
  appendChild,
} from '../xml/query.js';
import { quickInventory, wandEntities, readWand } from './wands.js';
import { listSpells } from './spells.js';

const BONES_FILE_RE = /^[\w\-]+\.xml$/;
const WAND_SLOTS = 4;

/** 解析单个 bones 文件为法杖实体根节点;结构不对抛错。 */
function loadBonesWand(bonesDir, file) {
  if (!BONES_FILE_RE.test(file)) throw new Error(`文件名非法: ${JSON.stringify(file)}`);
  const path = join(bonesDir, file);
  if (!existsSync(path)) throw new Error(`遗骨文件不存在: ${file}`);
  const tree = parseXml(readFileSync(path, 'utf8'));
  const root = docRoot(tree, 'Entity');
  if (!root || !findComponent(root, 'AbilityComponent')) {
    throw new Error(`${file} 不是法杖实体 XML`);
  }
  return root;
}

/**
 * 列出全部遗骨法杖(按文件名内数字排序)。
 * 单个文件解析失败不阻断整体,以 error 字段返回。
 */
export function listBones(bonesDir) {
  if (!existsSync(bonesDir)) return [];
  const files = readdirSync(bonesDir)
    .filter((n) => n.endsWith('.xml'))
    .sort((a, b) => {
      const na = Number(a.replace(/\D/g, '')) || 0;
      const nb = Number(b.replace(/\D/g, '')) || 0;
      return na - nb || a.localeCompare(b);
    });
  return files.map((file) => {
    try {
      const wand = loadBonesWand(bonesDir, file);
      const summary = readWand(wand, -1);
      delete summary.index;
      delete summary.slot; // 世界态槽位无意义
      return { file, ...summary, spells: listSpells(wand) };
    } catch (e) {
      return { file, error: String(e.message || e) };
    }
  });
}

/** 快捷栏已被法杖占用的槽位集合。 */
function occupiedWandSlots(playerTree) {
  const slots = new Set();
  for (const w of wandEntities(playerTree)) {
    const item = findComponent(w, 'ItemComponent');
    const s = Number(getAttr(item, 'inventory_slot.x') ?? 0);
    if (Number.isInteger(s)) slots.add(s);
  }
  return slots;
}

/**
 * 导入遗骨法杖到快捷栏。
 * @param {{slot?: number|string}} [opts] 指定槽位(0–3,须空闲);缺省取第一个空槽
 * @returns {{slot: number, wand: object, spells: Array}}
 */
export function importBones(playerTree, bonesDir, file, opts = {}) {
  const source = loadBonesWand(bonesDir, file);

  const occupied = occupiedWandSlots(playerTree);
  let slot;
  if (opts.slot !== undefined && opts.slot !== null && opts.slot !== '') {
    slot = Number(opts.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= WAND_SLOTS) {
      throw new Error(`槽位必须是 0–${WAND_SLOTS - 1}: ${JSON.stringify(opts.slot)}`);
    }
    if (occupied.has(slot)) throw new Error(`槽位 ${slot} 已被其他法杖占用`);
  } else {
    slot = [0, 1, 2, 3].find((s) => !occupied.has(s));
    if (slot === undefined) {
      throw new Error('快捷栏法杖槽(0–3)已满,请先移除一根法杖再导入');
    }
  }

  // 深拷贝并规整为"已拾取在手"形态
  const wand = structuredClone(source);
  setAttr(wand, 'tags', 'teleportable_NOT,wand,item');

  const playerRoot = docRoot(playerTree, 'Entity');
  const playerTf = playerRoot ? findComponent(playerRoot, '_Transform') : undefined;
  const tf = findComponent(wand, '_Transform');
  if (tf) {
    setAttr(tf, 'position.x', (playerTf && getAttr(playerTf, 'position.x')) || '0');
    setAttr(tf, 'position.y', (playerTf && getAttr(playerTf, 'position.y')) || '0');
    setAttr(tf, 'rotation', '0');
    setAttr(tf, 'scale.x', '1');
    setAttr(tf, 'scale.y', '1'); // 遗骨常见 scale.y=-1(倒置),导入时摆正
  }

  const item = findComponent(wand, 'ItemComponent');
  if (!item) throw new Error(`${file} 缺少 ItemComponent,无法放入快捷栏`);
  setAttr(item, 'inventory_slot.x', String(slot));
  setAttr(item, 'inventory_slot.y', '0');
  setAttr(item, 'is_frozen', '0'); // 陈列冻结态法杖导入后应可用

  appendChild(quickInventory(playerTree), wand);

  const index = wandEntities(playerTree).length - 1;
  return { slot, wand: readWand(wand, index), spells: listSpells(wand) };
}
