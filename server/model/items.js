// 物品栏道具模型 —— 枚举快捷栏顶层非法杖物品(宝藏道具 + 药水/粉末袋容器),
// 从目录(data/items.json)注入新道具,按索引删除/换槽。
//
// 设计对照:
//  - 注入沿用 bones.js 的做法:解析目录里的全展开实体 XML → 深拷贝 → 规整为
//    "已拾取在手"形态(补 _Transform、写 inventory_slot、解冻、去世界拾取态
//    tags)→ appendChild 到 inventory_quick;
//  - 枚举沿用 potions.js:遍历 inventory_quick 顶层子实体,识别道具类别。
//
// 槽位模型(实测 §save):游戏道具行固定 4 格。法杖占 wand 行(0–3),
// 非法杖道具(钥匙/石板/宝藏)共用一套 inventory_slot.x 编号,与法杖行
// 独立。这里只为"非法杖道具"分配空槽,范围 0–3;满 4 件拒绝注入。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { parseXml } from '../xml/parse.js';
import {
  docRoot,
  findComponent,
  findComponents,
  childEntities,
  entityHasTag,
  getAttr,
  setAttr,
  makeElement,
  appendChild,
  removeChild,
  tagOf,
} from '../xml/query.js';
import { quickInventory } from './wands.js';
import { containerEntities, readContainer, countPerMaterialNode } from './potions.js';

const dataDir = fileURLToPath(new URL('../../data', import.meta.url));
const ITEM_SLOTS = 4; // 游戏道具行 4 格(0–3)

let catalogCache = null;

/** 道具目录(data/items.json);首次读入后缓存。 */
export function itemCatalog() {
  if (!catalogCache) {
    catalogCache = JSON.parse(readFileSync(join(dataDir, 'items.json'), 'utf8'));
  }
  return catalogCache;
}

/** 目录中面向 UI 的精简视图(不含庞大的 entity 字段)。 */
export function listCatalog() {
  return itemCatalog().map(({ entity, ...meta }) => meta);
}

/** 按 id 取目录条目;查不到抛错。 */
function catalogEntry(id) {
  const hit = itemCatalog().find((x) => x.id === id);
  if (!hit) throw new Error(`未知道具 id: ${id}(不在 items.json 目录内)`);
  return hit;
}

/**
 * 快捷栏中的"非法杖道具"实体(树内顺序 = 对外索引)。
 * 带 ItemComponent 的非法杖顶层实体都算道具(钥匙、石板、邪王真眼、法术石、
 * 骰子……),含药水/粉末袋等材料容器 —— 它们与普通道具共用道具行 4 格,
 * 统一枚举才能正确计算槽位占用;材料编辑仍走 potions.js 的容器索引空间。
 */
export function itemEntities(playerTree) {
  return childEntities(quickInventory(playerTree), (e) =>
    !entityHasTag(e, 'wand') &&
    findComponent(e, 'ItemComponent') !== undefined);
}

/** 识别道具类别(与目录 group 对齐;存档原生道具尽量归类,兜底 other)。 */
function itemKind(entity) {
  if (findComponent(entity, 'MaterialInventoryComponent')) {
    if (entityHasTag(entity, 'potion')) return 'potion';
    if (entityHasTag(entity, 'powder_stash')) return 'powder_stash';
    return 'container';
  }
  if (entityHasTag(entity, 'evil_eye')) return 'staff';
  const item = findComponent(entity, 'ItemComponent');
  const name = item ? getAttr(item, 'item_name') ?? '' : '';
  const id = name.replace(/^\$item_/, '');
  const hit = itemCatalog().find((x) => x.itemName.replace(/^\$item_/, '') === id);
  if (hit) return hit.group;
  if (entityHasTag(entity, 'tablet')) return 'tablet';
  if (entityHasTag(entity, 'alchemist_key')) return 'key';
  return 'other';
}

/** 读单个道具(展示用摘要;容器附材料/容量与容器索引)。 */
export function readItem(entity, index, containerIndex) {
  const item = findComponent(entity, 'ItemComponent');
  const itemName = item ? getAttr(item, 'item_name') ?? '' : '';
  const dictId = itemName.replace(/^\$item_/, '');
  const dict = itemCatalog().find(
    (x) => x.itemName.replace(/^\$item_/, '') === dictId);
  const base = {
    index,
    kind: itemKind(entity),
    itemName,
    slot: item ? getAttr(item, 'inventory_slot.x') : undefined,
    uiSprite: item ? getAttr(item, 'ui_sprite') : undefined,
    name: dict?.name,
    nameZh: dict?.nameZh,
    catalogId: dict?.id,
  };
  if (findComponent(entity, 'MaterialInventoryComponent')) {
    const c = readContainer(entity, containerIndex ?? -1);
    return {
      ...base,
      isContainer: true,
      capacity: c.capacity,
      materials: c.materials,
      containerIndex,
    };
  }
  return base;
}

/** 快捷栏道具列表(统一索引;容器条目附 containerIndex 供材料编辑接口用)。 */
export function listItems(playerTree) {
  const containers = containerEntities(playerTree);
  return itemEntities(playerTree).map((e, i) => {
    const ci = containers.indexOf(e);
    return readItem(e, i, ci === -1 ? undefined : ci);
  });
}

/** 按索引取道具实体;越界抛错。 */
export function itemAt(playerTree, index) {
  const items = itemEntities(playerTree);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= items.length) {
    throw new Error(`道具索引越界: ${index}(现有 ${items.length} 个)`);
  }
  return items[i];
}

/** 快捷栏中"非法杖道具"已占用的槽位集合。 */
function occupiedItemSlots(playerTree) {
  const slots = new Set();
  for (const e of itemEntities(playerTree)) {
    const item = findComponent(e, 'ItemComponent');
    const s = Number(getAttr(item, 'inventory_slot.x') ?? -1);
    if (Number.isInteger(s) && s >= 0) slots.add(s);
  }
  return slots;
}

/** 道具行(0–3)剩余空槽数;UI 用它在满员时禁用添加。 */
export function freeItemSlots(playerTree) {
  const occupied = occupiedItemSlots(playerTree);
  let free = 0;
  for (let s = 0; s < ITEM_SLOTS; s++) if (!occupied.has(s)) free++;
  return free;
}

/** 玩家实体的世界位置(注入道具的 _Transform 落点)。 */
function playerPos(playerTree) {
  const root = docRoot(playerTree, 'Entity');
  const tf = root ? findComponent(root, '_Transform') : undefined;
  return {
    x: (tf && getAttr(tf, 'position.x')) || '0',
    y: (tf && getAttr(tf, 'position.y')) || '0',
  };
}

/** 把实体的第一个子节点确保为 _Transform(pickup 实体通常没有,补一个)。 */
function ensureTransform(entity, pos) {
  let tf = findComponent(entity, '_Transform');
  if (!tf) {
    tf = makeElement('_Transform');
    // 放到子节点最前(与游戏内实体顺序一致,非强制)
    const tag = tagOf(entity);
    entity[tag] = [tf, ...(entity[tag] ?? [])];
  }
  setAttr(tf, 'position.x', pos.x);
  setAttr(tf, 'position.y', pos.y);
  setAttr(tf, 'rotation', '0');
  setAttr(tf, 'scale.x', '1');
  setAttr(tf, 'scale.y', '1');
  return tf;
}

/**
 * 注入目录道具到快捷栏。
 * @param {string} id 目录条目 id(如 evil_eye)
 * @param {{slot?: number|string}} [opts] 指定槽位(0–3,须空闲);缺省取第一个空槽
 * @returns {{slot: number, index: number, item: object}}
 */
export function addItem(playerTree, id, opts = {}) {
  const entry = catalogEntry(id);
  const source = parseXml(entry.entity);
  const sourceRoot = docRoot(source, 'Entity');
  if (!sourceRoot) throw new Error(`目录条目 ${id} 的实体 XML 结构异常`);

  const occupied = occupiedItemSlots(playerTree);
  let slot;
  if (opts.slot !== undefined && opts.slot !== null && opts.slot !== '') {
    slot = Number(opts.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= ITEM_SLOTS) {
      throw new Error(`槽位必须是 0–${ITEM_SLOTS - 1}: ${JSON.stringify(opts.slot)}`);
    }
    if (occupied.has(slot)) throw new Error(`槽位 ${slot} 已被其他道具占用`);
  } else {
    slot = Array.from({ length: ITEM_SLOTS }, (_, i) => i).find((s) => !occupied.has(s));
    if (slot === undefined) {
      throw new Error(`快捷栏道具槽(0–${ITEM_SLOTS - 1})已满,请先移除一个道具`);
    }
  }

  const entity = structuredClone(sourceRoot);
  // 规整为"已拾取在手"形态
  ensureTransform(entity, playerPos(playerTree));

  // 容器规整:原版 pickup 的 potion.xml 用带脚本源的 LuaComponent 在入世时
  // 随机化初始材料,直接注入会导致进游戏后内容被覆盖 —— 对照快照中已拾取
  // 药水实体的形态,剥离所有 script_source_file 非空的 LuaComponent(保留
  // script_item_picked_up / script_death 等事件钩子),并确保存在空的
  // count_per_material_type(空瓶,内容由药水编辑填充)。
  if (findComponent(entity, 'MaterialInventoryComponent')) {
    for (const lua of findComponents(entity, 'LuaComponent')) {
      if ((getAttr(lua, 'script_source_file') ?? '') !== '') {
        removeChild(entity, lua);
      }
    }
    countPerMaterialNode(entity);
  }

  const item = findComponent(entity, 'ItemComponent');
  if (!item) throw new Error(`目录条目 ${id} 缺少 ItemComponent,无法放入快捷栏`);
  setAttr(item, 'inventory_slot.x', String(slot));
  setAttr(item, 'inventory_slot.y', '0');
  setAttr(item, 'has_been_picked_by_player', '1');
  setAttr(item, 'is_frozen', '0');
  setAttr(item, 'is_pickable', '1');
  setAttr(item, 'next_frame_pickable', '0');
  setAttr(item, 'npc_next_frame_pickable', '0');

  appendChild(quickInventory(playerTree), entity);

  const items = itemEntities(playerTree);
  const containers = containerEntities(playerTree);
  const index = items.indexOf(entity);
  const ci = containers.indexOf(entity);
  return { slot, index, item: readItem(entity, index, ci === -1 ? undefined : ci) };
}

/** 按索引删除快捷栏道具(含药水/粉末袋容器)。 */
export function removeItem(playerTree, index) {
  const entity = itemAt(playerTree, index);
  const ci = containerEntities(playerTree).indexOf(entity);
  const removed = readItem(entity, Number(index), ci === -1 ? undefined : ci);
  removeChild(quickInventory(playerTree), entity);
  return { removed };
}

/**
 * 移动道具到指定槽位(拖拽换位)。目标槽被其他道具占用时两者交换。
 * @returns {{changed: boolean, from: number, to: number}}
 */
export function moveItemSlot(playerTree, index, slot) {
  const entity = itemAt(playerTree, index);
  const to = Number(slot);
  if (!Number.isInteger(to) || to < 0 || to >= ITEM_SLOTS) {
    throw new Error(`槽位必须是 0–${ITEM_SLOTS - 1}: ${JSON.stringify(slot)}`);
  }
  const item = findComponent(entity, 'ItemComponent');
  const from = Number(getAttr(item, 'inventory_slot.x') ?? -1);
  if (to === from) return { changed: false, from, to };

  const other = itemEntities(playerTree).find((e) => {
    if (e === entity) return false;
    const c = findComponent(e, 'ItemComponent');
    return Number(getAttr(c, 'inventory_slot.x') ?? -1) === to;
  });
  // 游戏自产脏数据兜底:当前槽位无效时不能把无效值换给对方
  if (other && !(Number.isInteger(from) && from >= 0 && from < ITEM_SLOTS)) {
    throw new Error(`目标槽 ${to} 已占用,且当前道具槽位(${from})无效,无法交换`);
  }
  setAttr(item, 'inventory_slot.x', String(to));
  if (other) setAttr(findComponent(other, 'ItemComponent'), 'inventory_slot.x', String(from));
  return { changed: true, from, to };
}

export { ITEM_SLOTS };
