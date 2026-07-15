// M2 法杖模型 —— 枚举 inventory_quick 中的法杖实体,读写白名单属性。
//
// 原则同 playerBasics:数值按字符串搬运、只改白名单、不落盘。
// 法杖标识用"当前树内索引"(inventory_quick 里 wand 实体的出现顺序),
// 配合 saveManager.version 防止写盘/重载后索引漂移。

import {
  docRoot,
  findComponent,
  findChildEntityByName,
  childEntities,
  entityHasTag,
  getAttr,
  setAttr,
} from '../xml/query.js';
import { findWandLook } from '../services/dict.js';

function playerRoot(playerTree) {
  const root = docRoot(playerTree, 'Entity');
  if (!root) throw new Error('player.xml 结构异常: 找不到根 Entity');
  return root;
}

/** inventory_quick 实体(快捷栏容器)。 */
export function quickInventory(playerTree) {
  const inv = findChildEntityByName(playerRoot(playerTree), 'inventory_quick');
  if (!inv) throw new Error('player.xml 缺少 inventory_quick');
  return inv;
}

/** inventory_full 实体(背包散装法术容器)。 */
export function fullInventory(playerTree) {
  const inv = findChildEntityByName(playerRoot(playerTree), 'inventory_full');
  if (!inv) throw new Error('player.xml 缺少 inventory_full');
  return inv;
}

/** 背包槽位数(Inventory2Component full_inventory_slots_x × y;缺省 16)。 */
export function fullInventoryCapacity(playerTree) {
  const comp = findComponent(playerRoot(playerTree), 'Inventory2Component');
  if (!comp) return 16;
  const x = Number(getAttr(comp, 'full_inventory_slots_x') ?? 16);
  const y = Number(getAttr(comp, 'full_inventory_slots_y') ?? 1);
  return x * y;
}

/** 快捷栏中的法杖实体列表(树内顺序 = 对外索引)。 */
export function wandEntities(playerTree) {
  return childEntities(quickInventory(playerTree), (e) => entityHasTag(e, 'wand'));
}

/** 按索引取法杖实体;越界抛错。 */
export function wandAt(playerTree, index) {
  const wands = wandEntities(playerTree);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= wands.length) {
    throw new Error(`法杖索引越界: ${index}(现有 ${wands.length} 根)`);
  }
  return wands[i];
}

function requireAbility(wand) {
  const ability = findComponent(wand, 'AbilityComponent');
  if (!ability) throw new Error('法杖实体缺少 AbilityComponent');
  return ability;
}

// 白名单字段映射:API 字段 → [目标, 属性名, 校验]
// 目标: ability | gun_config | gunaction_config
const NUM = 'num';   // 必须是有限数值(字符串原样保存)
const STR = 'str';   // 自由字符串
const WAND_FIELDS = {
  uiName: ['ability', 'ui_name', STR],
  gunLevel: ['ability', 'gun_level', NUM],
  mana: ['ability', 'mana', NUM],
  manaMax: ['ability', 'mana_max', NUM],
  manaChargeSpeed: ['ability', 'mana_charge_speed', NUM],
  spriteFile: ['ability', 'sprite_file', STR],
  reloadTimeFrames: ['ability', 'reload_time_frames', NUM],
  actionsPerRound: ['gun_config', 'actions_per_round', NUM],
  deckCapacity: ['gun_config', 'deck_capacity', NUM],
  reloadTime: ['gun_config', 'reload_time', NUM],
  shuffleDeckWhenEmpty: ['gun_config', 'shuffle_deck_when_empty', NUM],
  fireRateWait: ['gunaction_config', 'fire_rate_wait', NUM],
  spreadDegrees: ['gunaction_config', 'spread_degrees', NUM],
  speedMultiplier: ['gunaction_config', 'speed_multiplier', NUM],
};

// 高级模式:gunaction_config 伤害加成组(原始属性名直传)
const GUNACTION_ADVANCED = [
  'damage_critical_chance', 'damage_critical_multiplier',
  'damage_curse_add', 'damage_drill_add', 'damage_electricity_add',
  'damage_explosion_add', 'damage_fire_add', 'damage_healing_add',
  'damage_ice_add', 'damage_melee_add', 'damage_projectile_add',
  'damage_slice_add', 'explosion_radius', 'knockback_force', 'lifetime_add',
];

function numStr(value, field) {
  const s = String(value).trim();
  if (s === '' || !Number.isFinite(Number(s))) {
    throw new Error(`字段 ${field} 不是有效数值: ${JSON.stringify(value)}`);
  }
  return s;
}

function targetsOf(wand) {
  const ability = requireAbility(wand);
  return {
    ability,
    gun_config: findComponent(ability, 'gun_config'),
    gunaction_config: findComponent(ability, 'gunaction_config'),
  };
}

/** 法杖内 card_action 子实体(法术卡)。 */
export function cardEntities(container) {
  return childEntities(container, (e) => entityHasTag(e, 'card_action'));
}

/** 读单根法杖(不含法术明细;明细走 spells.js)。 */
export function readWand(wand, index) {
  const { ability, gun_config, gunaction_config } = targetsOf(wand);
  const item = findComponent(wand, 'ItemComponent');
  const out = {
    index,
    slot: item ? getAttr(item, 'inventory_slot.x') : undefined,
    spellCount: cardEntities(wand).length,
  };
  for (const [field, [target, attr]] of Object.entries(WAND_FIELDS)) {
    const node = { ability, gun_config, gunaction_config }[target];
    out[field] = node ? getAttr(node, attr) : undefined;
  }
  out.advanced = {};
  if (gunaction_config) {
    for (const attr of GUNACTION_ADVANCED) {
      out.advanced[attr] = getAttr(gunaction_config, attr);
    }
  }
  return out;
}

/** 快捷栏法杖列表。 */
export function listWands(playerTree) {
  return wandEntities(playerTree).map((w, i) => readWand(w, i));
}

/**
 * 写单根法杖属性(patch 为 readWand 同构的部分对象;advanced 为原始属性名 map)。
 * 联动规则:
 *  - 改 reloadTime 且未显式给 reloadTimeFrames 时,同步写 reload_time_frames(指南要求);
 *  - 改 spriteFile 时同步手持 SpriteComponent 的 image_file;命中外观字典
 *    (data/wands.json)时一并同步握把偏移/rect_animation 与 shoot_pos 枪口点;
 *  - deckCapacity 不允许低于当前已占用的最大槽位+1(防止法术卡悬空)。
 * @returns {{changed: boolean, fields: string[]}}
 */
export function applyStatsToWand(wand, patch = {}) {
  const targets = targetsOf(wand);
  const fields = [];

  if (patch.deckCapacity !== undefined) {
    const cap = Number(numStr(patch.deckCapacity, 'deckCapacity'));
    const maxSlot = cardEntities(wand).reduce((m, card) => {
      const item = findComponent(card, 'ItemComponent');
      return Math.max(m, Number(getAttr(item, 'inventory_slot.x') ?? 0));
    }, -1);
    if (cap < maxSlot + 1) {
      throw new Error(`容量 ${cap} 小于已占用槽位(最大槽位 ${maxSlot}),请先移除法术`);
    }
  }

  for (const [field, [target, attr, kind]] of Object.entries(WAND_FIELDS)) {
    const value = patch[field];
    if (value === undefined) continue;
    const node = targets[target];
    if (!node) throw new Error(`法杖缺少 <${target}>`);
    setAttr(node, attr, kind === NUM ? numStr(value, field) : String(value));
    fields.push(field);
  }

  // reload_time ↔ reload_time_frames 同步
  if (patch.reloadTime !== undefined && patch.reloadTimeFrames === undefined) {
    setAttr(targets.ability, 'reload_time_frames', numStr(patch.reloadTime, 'reloadTime'));
    fields.push('reloadTimeFrames(auto)');
  }

  // 外观同步(§12)。image_file 始终跟随 sprite_file;命中外观字典
  // (data/wands.json)时一并同步握把偏移/rect_animation 与枪口点(shoot_pos)
  // —— 联动值由字典携带(构建期按游戏 SetWandSprite 公式算好),未命中
  // (模组/自定义路径)不碰几何字段。组件缺失时跳过对应联动(防御)。
  if (patch.spriteFile !== undefined) {
    const file = String(patch.spriteFile);
    // 游戏按 "item" 标签取手持 SpriteComponent(gun_procedural.lua);实测存档
    // 均为 item+enabled_in_hand 双标签,任一命中即认,兼容两类变体
    const sprite = findComponent(wand, 'SpriteComponent', (n) => {
      const tags = (getAttr(n, '_tags') ?? '').split(',');
      return tags.includes('item') || tags.includes('enabled_in_hand');
    });
    if (sprite) {
      setAttr(sprite, 'image_file', file);
      fields.push('spriteFile(SpriteComponent)');
    }
    const look = findWandLook(file);
    if (look) {
      if (sprite) {
        setAttr(sprite, 'offset_x', look.offsetX);
        setAttr(sprite, 'offset_y', look.offsetY);
        setAttr(sprite, 'rect_animation', look.rectAnim);
        setAttr(sprite, 'next_rect_animation', '');
        fields.push('spriteFile(grip)');
      }
      const hotspot = findComponent(wand, 'HotspotComponent', (n) =>
        (getAttr(n, '_tags') ?? '').split(',').includes('shoot_pos'));
      if (hotspot) {
        setAttr(hotspot, 'offset.x', look.hotspotX);
        setAttr(hotspot, 'offset.y', look.hotspotY);
        fields.push('spriteFile(shoot_pos)');
      }
    }
  }

  for (const [attr, value] of Object.entries(patch.advanced ?? {})) {
    if (!GUNACTION_ADVANCED.includes(attr)) {
      throw new Error(`未知的高级字段: ${attr}`);
    }
    if (!targets.gunaction_config) throw new Error('法杖缺少 <gunaction_config>');
    setAttr(targets.gunaction_config, attr, numStr(value, `advanced.${attr}`));
    fields.push(`advanced.${attr}`);
  }

  return { changed: fields.length > 0, fields };
}

/** 按索引写单根法杖属性(见 applyStatsToWand)。 */
export function applyWandStats(playerTree, index, patch = {}) {
  return applyStatsToWand(wandAt(playerTree, index), patch);
}

/**
 * 批量写多根法杖属性(UI③:法杖 card 统一一个「应用到缓冲」)。
 * 先对每根法杖的克隆做 dry-run 校验,全部通过才应用到真树 ——
 * 任一杖失败则整体拒绝(error.details = [{index, error}]),杜绝部分成功。
 * @param {Array<{index: number|string}>} patches 其余字段同 applyStatsToWand 的 patch
 * @returns {{changed: boolean, results: Array<{index, changed, fields}>}}
 */
export function applyWandStatsBatch(playerTree, patches) {
  if (!Array.isArray(patches)) throw new Error('wands 必须是 [{index, ...字段}] 数组');
  const errors = [];
  const jobs = [];
  for (const entry of patches) {
    const { index, ...patch } = entry ?? {};
    try {
      const wand = wandAt(playerTree, index);
      applyStatsToWand(structuredClone(wand), patch); // dry-run,不动真树
      jobs.push([index, patch]);
    } catch (e) {
      errors.push({ index, error: String(e.message || e) });
    }
  }
  if (errors.length > 0) {
    const e = new Error(
      `${errors.length} 根法杖校验失败,已整体拒绝: ` +
      errors.map((x) => `#${x.index} ${x.error}`).join('; '));
    e.details = errors;
    throw e;
  }
  const results = jobs.map(([index, patch]) => ({
    index: Number(index),
    ...applyStatsToWand(wandAt(playerTree, index), patch),
  }));
  return { changed: results.some((r) => r.changed), results };
}
