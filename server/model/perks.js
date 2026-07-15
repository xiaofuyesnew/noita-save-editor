// M3 天赋模型 —— 天赋"三件套"注入/移除,联动 world_state.xml。
//
// 游戏拾取天赋(perk.lua perk_pickup)在存档中留下:
//  1. 玩家子实体:GameEffectComponent(frames=-1,组件 _tags 含 perk_component,
//     实体 tags 含 perk_entity)+ 独立 UI 实体(UIIconComponent,name 为 $perk_* 键,
//     引擎显示时自行本地化);本工具合并为单个实体注入(社区验证做法);
//  2. world_state <flags> 运行旗标 PERK_PICKED_<ID>;
//  3. world_state <lua_globals> 计数 PERK_PICKED_<ID>_PICKUP_COUNT。
//
// 仅放行字典 kind="effect" 的天赋(注入 GameEffectComponent 即得核心收益);
// kind="complex"(纯 Lua func 改数值/生成实体,如 Lukki 腿)存档层无法可靠
// 复刻,直接拒绝 —— 指南明确警告手工注入会损坏角色。

import {
  docRoot,
  findComponent,
  findComponents,
  getAttr,
  setAttr,
  makeElement,
  appendChild,
  removeChild,
  childEntities,
  entityHasTag,
} from '../xml/query.js';
import { findPerk, getDict } from '../services/dict.js';
import { makeEffectEntity } from './effects.js';
import {
  hasRunFlag,
  addRunFlag,
  removeRunFlag,
  getLuaGlobal,
  setLuaGlobal,
  removeLuaGlobal,
} from './worldState.js';

// 世界状态工具已上移至 worldState.js(M4);这里保持 re-export 以稳住既有引用。
export { hasRunFlag, getLuaGlobal };

export const EDITOR_PERK_NAME = 'save_editor_perk';

const flagNameOf = (perkId) => `PERK_PICKED_${perkId}`;
const countKeyOf = (perkId) => `PERK_PICKED_${perkId}_PICKUP_COUNT`;

function playerRoot(playerTree) {
  const root = docRoot(playerTree, 'Entity');
  if (!root) throw new Error('player.xml 结构异常: 找不到根 Entity');
  return root;
}

// ---- 天赋实体 ------------------------------------------------------------------
//
// 实体 ↔ 天赋的归属判定分两档:
//  · 精确(owned):实体带 UIIconComponent 且图标名恰为该天赋的 uiName ——
//    编辑器合并实体与游戏 UI 实体都带图标,图标名是唯一身份。多个天赋可共享
//    同一 gameEffect(PROTECTION_FIRE 同为 PROTECTION_FIRE/FREEZE_FIELD/BLEED_OIL
//    的配方,爆炸/辐射/电击保护同理),因此带图标的实体一律以图标名为准,
//    绝不回落到效果匹配 —— 否则注入 A 会被姊妹天赋 B 认领:列表凭空多出天赋、
//    移除 B 反而串删 A 的实体。
//  · 模糊(effectOnly):无图标的游戏效果实体只能按配方效果匹配,天然可能歧义;
//    仅用于"效果实体在位"标注与移除时的清理,绝不作为"天赋存在"的判据。

/** 编辑器注入实体的图标名,同时是实体归属的身份键(与 addPerk 写入保持一致)。 */
const iconNameOf = (dict) => dict.uiName || dict.id;

/** 天赋配方涉及的全部游戏效果名。 */
const recipeEffectsOf = (dict) =>
  [dict.gameEffect, dict.gameEffect2].filter(Boolean);

/** 实体上带 perk_component 标签(编辑器实体豁免标签要求)的 GameEffectComponent 效果名。 */
function perkEffectNamesOf(entity) {
  const isEditor = getAttr(entity, 'name') === EDITOR_PERK_NAME;
  return findComponents(entity, 'GameEffectComponent')
    .filter((gec) => isEditor || (getAttr(gec, '_tags') ?? '').split(',').includes('perk_component'))
    .map((gec) => getAttr(gec, 'effect'))
    .filter(Boolean);
}

/** 玩家上与指定天赋相关的子实体,按归属置信度分档。 */
function perkEntitiesOf(root, dict) {
  const iconName = iconNameOf(dict);
  const recipe = recipeEffectsOf(dict);
  const owned = [];
  const effectOnly = [];
  for (const e of childEntities(root)) {
    if (!entityHasTag(e, 'perk_entity') && getAttr(e, 'name') !== EDITOR_PERK_NAME) continue;
    const icon = findComponent(e, 'UIIconComponent');
    if (icon) {
      // 带图标:图标名不符即属于别的天赋,效果再像也不认领
      if (getAttr(icon, 'name') === iconName) owned.push(e);
    } else if (perkEffectNamesOf(e).some((eff) => recipe.includes(eff))) {
      effectOnly.push(e);
    }
  }
  return { owned, effectOnly };
}

/**
 * 列出天赋。以 world_state 旗标/计数为主索引,并标注玩家实体是否在位。
 * 只有旗标/计数/精确实体三者之一在场才上榜 —— 模糊匹配的共享效果实体
 * 不算数,避免同效果姊妹天赋"凭空出现"。
 */
export function listPerks(playerTree, worldTree) {
  const root = playerRoot(playerTree);
  const out = [];
  for (const dict of getDict('perks')) {
    const flag = hasRunFlag(worldTree, flagNameOf(dict.id));
    const count = getLuaGlobal(worldTree, countKeyOf(dict.id));
    const { owned, effectOnly } = perkEntitiesOf(root, dict);
    if (!flag && count === undefined && owned.length === 0) continue;
    out.push({
      id: dict.id,
      name: dict.name,
      nameZh: dict.nameZh,
      kind: dict.kind,
      flag,
      count: count ?? '0',
      entityCount: owned.length + effectOnly.length,
      source: owned.some((e) => getAttr(e, 'name') === EDITOR_PERK_NAME) ? 'editor' : 'game',
    });
  }
  return out;
}

/**
 * 注入天赋三件套。仅 kind="effect";重复注入 = 计数+1(可堆叠语义),
 * 但同名效果实体只保留一个(避免同效果叠实体)。
 * @param {{id: string}} params
 */
export function addPerk(playerTree, worldTree, params) {
  const { id } = params;
  if (!id) throw new Error('缺少天赋 id');
  const dict = findPerk(id);
  if (!dict) throw new Error(`未知天赋: ${id}`);
  if (dict.kind !== 'effect') {
    throw new Error(
      `天赋 ${id}(${dict.nameZh})是 ${dict.kind} 型:由游戏 Lua 脚本改写组件数值或生成实体,` +
      '存档层无法可靠复刻,本工具不支持注入(指南警告手工注入会损坏角色)。',
    );
  }

  const root = playerRoot(playerTree);

  // 1. 玩家子实体:该天赋自己的实体(按图标名精确判定,编辑器合并实体或
  //    游戏 UI 实体均算)已在位则不重复注入,只叠计数 —— 避免同效果叠实体
  //    与 HUD 重复图标;姊妹天赋共享 gameEffect 的实体不算"已在位"。
  const { owned } = perkEntitiesOf(root, dict);
  if (owned.length === 0) {
    const tf = findComponent(root, '_Transform');
    const pos = {
      x: (tf && getAttr(tf, 'position.x')) || '0',
      y: (tf && getAttr(tf, 'position.y')) || '0',
    };
    const entity = makeEffectEntity(dict.gameEffect, '-1', pos);
    setAttr(entity, 'name', EDITOR_PERK_NAME);
    setAttr(entity, 'tags', 'perk_entity');
    const gec = findComponent(entity, 'GameEffectComponent');
    setAttr(gec, '_tags', 'perk_component');
    if (dict.gameEffect2) {
      const gec2 = findComponent(makeEffectEntity(dict.gameEffect2, '-1', pos), 'GameEffectComponent');
      setAttr(gec2, '_tags', 'perk_component');
      appendChild(entity, gec2);
    }
    appendChild(entity, makeElement('UIIconComponent', {
      _enabled: '1',
      description: dict.uiDescription ?? '',
      display_above_head: '0',
      display_in_hud: '1',
      icon_sprite_file: dict.uiIcon ?? '',
      is_perk: '1',
      name: iconNameOf(dict),
    }));
    appendChild(root, entity);
  }

  // 2. 运行旗标 + 3. 拾取计数
  addRunFlag(worldTree, flagNameOf(id));
  const prev = Number(getLuaGlobal(worldTree, countKeyOf(id)) ?? '0');
  setLuaGlobal(worldTree, countKeyOf(id), Number.isFinite(prev) ? prev + 1 : 1);

  return listPerks(playerTree, worldTree).find((p) => p.id === id);
}

/**
 * 移除天赋:删除全部相关玩家子实体 + 旗标 + 计数(不区分堆叠层数)。
 * 游戏产生的天赋同样可移除:精确实体(图标名匹配)一律删;无图标的共享
 * 效果实体只有在没有其它在位天赋(旗标/计数/精确实体任一在场)认领同一
 * 效果时才删,避免移除 A 顺手删掉姊妹天赋 B 的效果。
 */
export function removePerk(playerTree, worldTree, id) {
  const dict = findPerk(id);
  if (!dict) throw new Error(`未知天赋: ${id}`);

  const root = playerRoot(playerTree);
  const { owned, effectOnly } = perkEntitiesOf(root, dict);
  let removable = effectOnly;
  if (effectOnly.length > 0) {
    const claimed = new Set();
    for (const other of getDict('perks')) {
      if (other.id === dict.id) continue;
      const present = hasRunFlag(worldTree, flagNameOf(other.id))
        || getLuaGlobal(worldTree, countKeyOf(other.id)) !== undefined
        || perkEntitiesOf(root, other).owned.length > 0;
      if (!present) continue;
      for (const eff of recipeEffectsOf(other)) claimed.add(eff);
    }
    removable = effectOnly.filter((e) => !perkEffectNamesOf(e).some((eff) => claimed.has(eff)));
  }

  const entities = [...owned, ...removable];
  for (const e of entities) removeChild(root, e);
  const flagRemoved = removeRunFlag(worldTree, flagNameOf(id));
  const countRemoved = removeLuaGlobal(worldTree, countKeyOf(id));

  if (entities.length === 0 && !flagRemoved && !countRemoved) {
    throw new Error(`存档中没有天赋 ${id} 的痕迹`);
  }
  return { removed: { id, entities: entities.length, flagRemoved, countRemoved } };
}
