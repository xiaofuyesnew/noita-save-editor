// M4 世界状态模型 —— world_state.xml 的 WorldStateComponent 读写:
// 时间/天气/进度类白名单字段、运行旗标 <flags>、真菌变换 <changed_materials>;
// <lua_globals> 与 <orbs_found_thisrun> 只读展示。
//
// world_state 树的通用工具(旗标/lua_globals 增删查)也集中在此,供 perks.js 复用。
// 原则同其他模型:数值按字符串搬运、只改白名单、不落盘。

import {
  docRoot,
  findChild,
  getAttr,
  setAttr,
  makeElement,
  appendChild,
  removeChild,
  elementChildren,
  textOf,
  setText,
  tagOf,
  walk,
} from '../xml/query.js';
import { findMaterial } from '../services/dict.js';

// ---- 通用 world_state 工具 -----------------------------------------------------

export function worldStateComponent(worldTree) {
  const root = docRoot(worldTree);
  if (!root) throw new Error('world_state.xml 结构异常');
  let found;
  walk(root, (node) => {
    if (found) return false;
    if (node.WorldStateComponent) {
      found = node;
      return false;
    }
  });
  if (!found) throw new Error('world_state.xml 缺少 WorldStateComponent');
  return found;
}

function flagsNode(worldTree) {
  const node = findChild(worldStateComponent(worldTree), 'flags');
  if (!node) throw new Error('world_state.xml 缺少 <flags>');
  return node;
}

function luaGlobalsNode(worldTree) {
  const node = findChild(worldStateComponent(worldTree), 'lua_globals');
  if (!node) throw new Error('world_state.xml 缺少 <lua_globals>');
  return node;
}

/** 运行旗标是否存在。 */
export function hasRunFlag(worldTree, flag) {
  return findChild(flagsNode(worldTree), 'string', (n) => textOf(n) === flag) !== undefined;
}

export function addRunFlag(worldTree, flag) {
  if (hasRunFlag(worldTree, flag)) return false;
  appendChild(flagsNode(worldTree), setText(makeElement('string'), flag));
  return true;
}

export function removeRunFlag(worldTree, flag) {
  const flags = flagsNode(worldTree);
  const node = findChild(flags, 'string', (n) => textOf(n) === flag);
  if (!node) return false;
  removeChild(flags, node);
  return true;
}

/** lua_global 取值(不存在返回 undefined)。 */
export function getLuaGlobal(worldTree, key) {
  const e = findChild(luaGlobalsNode(worldTree), 'E', (n) => getAttr(n, 'key') === key);
  return e ? getAttr(e, 'value') : undefined;
}

export function setLuaGlobal(worldTree, key, value) {
  const globals = luaGlobalsNode(worldTree);
  const e = findChild(globals, 'E', (n) => getAttr(n, 'key') === key);
  if (e) {
    setAttr(e, 'value', String(value));
  } else {
    appendChild(globals, makeElement('E', { key, value: String(value) }));
  }
}

export function removeLuaGlobal(worldTree, key) {
  const globals = luaGlobalsNode(worldTree);
  const e = findChild(globals, 'E', (n) => getAttr(n, 'key') === key);
  if (!e) return false;
  removeChild(globals, e);
  return true;
}

// ---- 字段白名单 ----------------------------------------------------------------

// API 字段 → WorldStateComponent 属性。全部按数值字符串校验后原样写入。
// time 为一天内的进度(0..1);rain/fog 及其 _target 为 0..1 强度;
// 布尔字段用 0/1(EVERYTHING_TO_GOLD 等 6 个天赋/事件旗标 + 全图去雾)。
const WORLD_FIELDS = {
  dayCount: 'day_count',
  time: 'time',
  timeDt: 'time_dt',
  rain: 'rain',
  rainTarget: 'rain_target',
  fog: 'fog',
  fogTarget: 'fog_target',
  windSpeed: 'wind_speed',
  everythingToGold: 'EVERYTHING_TO_GOLD',
  infiniteGoldHappening: 'INFINITE_GOLD_HAPPENING',
  openFogOfWarEverywhere: 'open_fog_of_war_everywhere',
};

function numStr(value, field) {
  const s = String(value).trim();
  if (s === '' || !Number.isFinite(Number(s))) {
    throw new Error(`字段 ${field} 不是有效数值: ${JSON.stringify(value)}`);
  }
  return s;
}

// ---- 读取 ----------------------------------------------------------------------

/** <changed_materials> 的 <string> 文本按序配对为 [{from, to}]。 */
function readChangedMaterials(comp) {
  const node = findChild(comp, 'changed_materials');
  const texts = node
    ? elementChildren(node).filter((n) => tagOf(n) === 'string').map(textOf)
    : [];
  const pairs = [];
  for (let i = 0; i + 1 < texts.length; i += 2) {
    pairs.push({ from: texts[i], to: texts[i + 1] });
  }
  // 防御:奇数个条目时保留尾巴,避免静默丢数据
  if (texts.length % 2 === 1) pairs.push({ from: texts[texts.length - 1], to: '' });
  return pairs;
}

export function readWorldState(worldTree) {
  const comp = worldStateComponent(worldTree);
  const fields = {};
  for (const [field, attr] of Object.entries(WORLD_FIELDS)) {
    fields[field] = getAttr(comp, attr);
  }
  const flags = elementChildren(flagsNode(worldTree))
    .filter((n) => tagOf(n) === 'string')
    .map(textOf);
  const luaGlobals = elementChildren(luaGlobalsNode(worldTree))
    .filter((n) => tagOf(n) === 'E')
    .map((n) => ({ key: getAttr(n, 'key'), value: getAttr(n, 'value') }));
  const orbsNode = findChild(comp, 'orbs_found_thisrun');
  const orbs = orbsNode ? elementChildren(orbsNode).map(textOf) : [];
  return {
    fields,
    flags,
    changedMaterials: readChangedMaterials(comp),
    luaGlobals,
    orbsFoundThisrun: orbs,
  };
}

// ---- 写入 ----------------------------------------------------------------------

const FLAG_RE = /^[\w.\-]+$/;
const MATERIAL_RE = /^[a-z0-9_]+$/;

/** 用新的元素子节点数组整体替换 node 的子节点(丢弃解析残留的空白文本)。 */
function replaceChildren(node, children) {
  node[tagOf(node)] = children;
}

/**
 * 应用补丁 { fields?, flags?, changedMaterials? }。
 *  - fields:白名单内数值字段的部分补丁;
 *  - flags:运行旗标全量替换(数组,去重保序);
 *  - changedMaterials:真菌变换全量替换([{from,to}],材料名须在字典内)。
 * @returns {{changed: boolean, fields: string[], flagsReplaced: boolean, changedMaterialsReplaced: boolean}}
 */
export function applyWorldState(worldTree, patch = {}) {
  const comp = worldStateComponent(worldTree);
  const changedFields = [];

  for (const [field, value] of Object.entries(patch.fields ?? {})) {
    const attr = WORLD_FIELDS[field];
    if (!attr) throw new Error(`未知的世界状态字段: ${field}`);
    if (value === undefined || value === null) continue;
    setAttr(comp, attr, numStr(value, field));
    changedFields.push(field);
  }

  let flagsReplaced = false;
  let flagsRemoved = [];
  let flagsAdded = [];
  if (patch.flags !== undefined) {
    if (!Array.isArray(patch.flags)) throw new Error('flags 必须是字符串数组');
    const seen = new Set();
    const clean = [];
    for (const raw of patch.flags) {
      const flag = String(raw).trim();
      if (flag === '') continue;
      if (!FLAG_RE.test(flag)) throw new Error(`旗标名非法: ${JSON.stringify(raw)}`);
      if (!seen.has(flag)) {
        seen.add(flag);
        clean.push(flag);
      }
    }
    // flags 是全量替换语义:显式算出增删,让"丢旗标"可被响应/日志审计,
    // 而非静默发生(调用方漏带某些旗标会在 flagsRemoved 里暴露)。
    const before = elementChildren(flagsNode(worldTree))
      .filter((n) => tagOf(n) === 'string').map(textOf);
    const beforeSet = new Set(before);
    flagsRemoved = before.filter((f) => !seen.has(f));
    flagsAdded = clean.filter((f) => !beforeSet.has(f));
    replaceChildren(
      flagsNode(worldTree),
      clean.map((f) => setText(makeElement('string'), f)),
    );
    flagsReplaced = true;
  }

  let changedMaterialsReplaced = false;
  if (patch.changedMaterials !== undefined) {
    if (!Array.isArray(patch.changedMaterials)) {
      throw new Error('changedMaterials 必须是 [{from,to}] 数组');
    }
    const texts = [];
    for (const pair of patch.changedMaterials) {
      for (const key of ['from', 'to']) {
        const mat = String(pair?.[key] ?? '').trim();
        if (!MATERIAL_RE.test(mat)) {
          throw new Error(`真菌变换材料名非法(${key}): ${JSON.stringify(pair?.[key])}`);
        }
        if (!findMaterial(mat)) throw new Error(`未知材料: ${mat}`);
        texts.push(mat);
      }
    }
    const node = findChild(comp, 'changed_materials');
    if (!node) throw new Error('world_state.xml 缺少 <changed_materials>');
    replaceChildren(node, texts.map((t) => setText(makeElement('string'), t)));
    changedMaterialsReplaced = true;
  }

  return {
    changed: changedFields.length > 0 || flagsReplaced || changedMaterialsReplaced,
    fields: changedFields,
    flagsReplaced,
    flagsRemoved,
    flagsAdded,
    changedMaterialsReplaced,
  };
}
