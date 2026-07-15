// M1 玩家基础属性模型 —— 读写 player.xml 保序树(必要时联动 world_state.xml)。
//
// 原则:
//  - 数值全部按字符串搬运,不做浮点重格式化;唯一换算是 HP(存档值×25=显示值)。
//  - 只改白名单字段,其余属性原样保留。
//  - 本模块不落盘,只改内存树;调用方负责 saveManager.markDirty()。

import {
  docRoot,
  findComponent,
  getAttr,
  setAttr,
  makeElement,
  appendChild,
  removeChild,
  childEntities,
  walk,
} from '../xml/query.js';

const HP_UNIT = 25; // 存档 1 单位 = 显示 25 HP

/** 校验并原样返回数值字符串(接受 number/string;非有限数抛错)。 */
function numStr(value, field) {
  const s = String(value).trim();
  if (s === '' || !Number.isFinite(Number(s))) {
    throw new Error(`字段 ${field} 不是有效数值: ${JSON.stringify(value)}`);
  }
  return s;
}

/** 显示 HP → 存档内部值(÷25)。 */
function toInternalHp(display, field) {
  const n = Number(numStr(display, field));
  return String(n / HP_UNIT);
}

/** 存档内部值 → 显示 HP(×25)。非数值(理论不该出现)原样返回。 */
function toDisplayHp(internal) {
  const n = Number(internal);
  return Number.isFinite(n) ? String(n * HP_UNIT) : internal;
}

function playerRoot(playerTree) {
  const root = docRoot(playerTree, 'Entity');
  if (!root) throw new Error('player.xml 结构异常: 找不到根 Entity');
  return root;
}

function requireComponent(root, tag) {
  const comp = findComponent(root, tag);
  if (!comp) throw new Error(`player.xml 缺少组件: ${tag}`);
  return comp;
}

// ---- basics ----------------------------------------------------------------

// 字段映射表:API 字段 → [组件标签, 属性名]。HP 相关单独处理。
const FIELD_MAP = {
  money: ['WalletComponent', 'money'],
  'air.inLungs': ['DamageModelComponent', 'air_in_lungs'],
  'air.max': ['DamageModelComponent', 'air_in_lungs_max'],
  'air.needed': ['DamageModelComponent', 'air_needed'],
  'air.lackOfDamage': ['DamageModelComponent', 'air_lack_of_damage'],
  invincibilityFrames: ['DamageModelComponent', 'invincibility_frames'],
  'position.x': ['_Transform', 'position.x'],
  'position.y': ['_Transform', 'position.y'],
  'fly.timeMax': ['CharacterDataComponent', 'fly_time_max'],
  'fly.needsRecharge': ['CharacterDataComponent', 'flying_needs_recharge'],
  'fly.rechargeSpd': ['CharacterDataComponent', 'fly_recharge_spd'],
  'fly.rechargeSpdGround': ['CharacterDataComponent', 'fly_recharge_spd_ground'],
  'movement.runVelocity': ['CharacterPlatformingComponent', 'run_velocity'],
  'movement.velocityMaxX': ['CharacterPlatformingComponent', 'velocity_max_x'],
  'movement.velocityMaxY': ['CharacterPlatformingComponent', 'velocity_max_y'],
  'movement.flyVelocityX': ['CharacterPlatformingComponent', 'fly_velocity_x'],
  'movement.flySpeedMaxUp': ['CharacterPlatformingComponent', 'fly_speed_max_up'],
  'movement.flySpeedMaxDown': ['CharacterPlatformingComponent', 'fly_speed_max_down'],
};

/** 读取玩家基础属性(HP 为显示值,其余为存档原始字符串)。 */
export function readBasics(playerTree) {
  const root = playerRoot(playerTree);
  const dmg = requireComponent(root, 'DamageModelComponent');

  const out = {
    hp: {
      current: toDisplayHp(getAttr(dmg, 'hp')),
      max: toDisplayHp(getAttr(dmg, 'max_hp')),
    },
  };
  for (const [field, [tag, attr]] of Object.entries(FIELD_MAP)) {
    const comp = findComponent(root, tag);
    const value = comp ? getAttr(comp, attr) : undefined;
    setPath(out, field, value); // 'air.inLungs' → out.air.inLungs

  }
  return out;
}

function setPath(obj, dotted, value) {
  const path = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur[path[i]] ?? (cur[path[i]] = {});
  }
  cur[path[path.length - 1]] = value;
}

function getPath(obj, dotted) {
  return dotted
    .split('.')
    .reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

/**
 * 写入玩家基础属性(patch 为 readBasics 同构的部分对象;HP 为显示值)。
 * maxHp 同步写 world_state.xml 的 PlayerStatsComponent。
 * @returns {{playerChanged: boolean, worldChanged: boolean, fields: string[]}}
 */
export function applyBasics(playerTree, worldTree, patch) {
  const root = playerRoot(playerTree);
  const fields = [];

  const hpCur = getPath(patch, 'hp.current');
  const hpMax = getPath(patch, 'hp.max');
  if (hpCur !== undefined || hpMax !== undefined) {
    const dmg = requireComponent(root, 'DamageModelComponent');
    if (hpCur !== undefined) {
      setAttr(dmg, 'hp', toInternalHp(hpCur, 'hp.current'));
      fields.push('hp.current');
    }
    if (hpMax !== undefined) {
      setAttr(dmg, 'max_hp', toInternalHp(hpMax, 'hp.max'));
      fields.push('hp.max');
    }
  }

  for (const [field, [tag, attr]] of Object.entries(FIELD_MAP)) {
    const value = getPath(patch, field);
    if (value === undefined) continue;
    const comp = requireComponent(root, tag);
    setAttr(comp, attr, numStr(value, field));
    fields.push(field);
  }

  // max_hp 联动 world_state.xml(同 ×25 单位;保守起见与 player.xml 同步)
  let worldChanged = false;
  if (hpMax !== undefined && worldTree) {
    const stats = findPlayerStats(worldTree);
    if (stats) {
      setAttr(stats, 'max_hp', toInternalHp(hpMax, 'hp.max'));
      worldChanged = true;
    }
  }

  return { playerChanged: fields.length > 0, worldChanged, fields };
}

function findPlayerStats(worldTree) {
  const root = docRoot(worldTree);
  let found;
  if (root) {
    walk(root, (node) => {
      if (found) return false;
      if (node.PlayerStatsComponent) {
        found = node;
        return false;
      }
    });
  }
  return found;
}

// ---- damage multipliers ------------------------------------------------------

function multipliersNode(playerTree) {
  const dmg = requireComponent(playerRoot(playerTree), 'DamageModelComponent');
  const node = findComponent(dmg, 'damage_multipliers');
  if (!node) throw new Error('player.xml 缺少 <damage_multipliers>');
  return node;
}

/** 读取 15 类受伤倍率(原始字符串 map)。 */
export function readDamageMultipliers(playerTree) {
  return { ...(multipliersNode(playerTree)[':@'] ?? {}) };
}

/** 写入受伤倍率(只允许改已存在的键,防拼写错误引入新属性)。 */
export function applyDamageMultipliers(playerTree, patch) {
  const node = multipliersNode(playerTree);
  const existing = node[':@'] ?? {};
  const fields = [];
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!(key in existing)) throw new Error(`未知的伤害类型: ${key}`);
    setAttr(node, key, numStr(value, `damage_multipliers.${key}`));
    fields.push(key);
  }
  return { changed: fields.length > 0, fields };
}

// ---- invincibility -----------------------------------------------------------

// 效果实体模板与标记迁移至 effects.js(M3);此处 re-export 保持兼容
import { makeEffectEntity, EDITOR_EFFECT_NAME } from './effects.js';
export { makeEffectEntity, EDITOR_EFFECT_NAME };

const INVINCIBILITY_FRAMES_ON = '400000000';

/** 本工具注入的、带指定 effect 的子实体列表。 */
function editorEffectEntities(root, effect) {
  return childEntities(root, (e) => {
    if (getAttr(e, 'name') !== EDITOR_EFFECT_NAME) return false;
    const gec = findComponent(e, 'GameEffectComponent');
    return gec !== undefined && (!effect || getAttr(gec, 'effect') === effect);
  });
}

/** 读取当前无敌状态(各模式是否生效)。 */
export function readInvincibility(playerTree) {
  const root = playerRoot(playerTree);
  const dmg = requireComponent(root, 'DamageModelComponent');
  const hp = Number(getAttr(dmg, 'hp'));
  return {
    effect: editorEffectEntities(root, 'PROTECTION_ALL').length > 0,
    frames: Number(getAttr(dmg, 'invincibility_frames')) >= Number(INVINCIBILITY_FRAMES_ON),
    negative: Number.isFinite(hp) && hp < 0,
    huge: Number.isFinite(hp) && hp >= 1e20,
  };
}

/**
 * 应用/撤销无敌。mode ∈ effect|frames|negative|huge, enable 布尔。
 * 撤销 negative/huge 时把 hp 恢复为 max_hp。
 * @returns {{mode: string, enable: boolean, state: object}}
 */
export function applyInvincibility(playerTree, { mode, enable = true }) {
  const root = playerRoot(playerTree);
  const dmg = requireComponent(root, 'DamageModelComponent');

  switch (mode) {
    case 'effect': {
      const existing = editorEffectEntities(root, 'PROTECTION_ALL');
      if (enable && existing.length === 0) {
        const tf = findComponent(root, '_Transform');
        appendChild(root, makeEffectEntity('PROTECTION_ALL', '-1', {
          x: getAttr(tf, 'position.x') ?? '0',
          y: getAttr(tf, 'position.y') ?? '0',
        }));
      } else if (!enable) {
        for (const e of existing) removeChild(root, e);
      }
      break;
    }
    case 'frames':
      setAttr(dmg, 'invincibility_frames', enable ? INVINCIBILITY_FRAMES_ON : '0');
      break;
    case 'negative':
      setAttr(dmg, 'hp', enable ? '-1000' : getAttr(dmg, 'max_hp'));
      break;
    case 'huge':
      setAttr(dmg, 'hp', enable ? '1e+030' : getAttr(dmg, 'max_hp'));
      break;
    default:
      throw new Error(`未知无敌模式: ${mode}(可选 effect|frames|negative|huge)`);
  }
  return { mode, enable, state: readInvincibility(playerTree) };
}
