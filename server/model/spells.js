// M2 法术卡模型 —— 杖内/背包法术的枚举、注入、修改、删除、重排。
//
// 法术卡 = tags 含 card_action 的子实体(结构见方案附录 A);
// 注入模板参数化自本仓库 save00 实测的完整卡实体,sprite 与类型背景图
// 取自字典(data/spells.json / spell_types.json),不靠 id 猜路径。

import {
  findComponent,
  getAttr,
  setAttr,
  makeElement,
  appendChild,
  removeChild,
} from '../xml/query.js';
import { findSpell, itemBgForType } from '../services/dict.js';
import { cardEntities } from './wands.js';

function numStr(value, field) {
  const s = String(value).trim();
  if (s === '' || !Number.isFinite(Number(s))) {
    throw new Error(`字段 ${field} 不是有效数值: ${JSON.stringify(value)}`);
  }
  return s;
}

function cardItem(card) {
  const item = findComponent(card, 'ItemComponent');
  if (!item) throw new Error('法术卡缺少 ItemComponent');
  return item;
}

/** 读单张法术卡。 */
export function readCard(card) {
  const action = findComponent(card, 'ItemActionComponent');
  const item = findComponent(card, 'ItemComponent');
  return {
    actionId: action ? getAttr(action, 'action_id') : undefined,
    slot: item ? Number(getAttr(item, 'inventory_slot.x') ?? 0) : 0,
    usesRemaining: item ? getAttr(item, 'uses_remaining') : undefined,
    alwaysCast: item ? getAttr(item, 'permanently_attached') === '1' : false,
  };
}

/**
 * 容器(法杖实体或 inventory_full)内法术列表,按槽位升序;附字典信息。
 * idx = 卡在容器内的文档序下标 —— 修改/删除/重排的寻址标识。真实存档中
 * 多张卡可共享同一槽位(游戏自产),槽位号不可作寻址,idx 恒唯一。
 */
export function listSpells(container) {
  return cardEntities(container)
    .map((card, idx) => {
      const info = readCard(card);
      const dict = info.actionId ? findSpell(info.actionId) : undefined;
      return {
        ...info,
        idx,
        name: dict?.name,
        nameZh: dict?.nameZh,
        type: dict?.type,
      };
    })
    .sort((a, b) => a.slot - b.slot);
}

function cardAt(container, idx) {
  const i = Number(idx);
  const cards = cardEntities(container);
  if (!Number.isInteger(i) || i < 0 || i >= cards.length) {
    throw new Error(`序号 ${idx} 上没有法术`);
  }
  return cards[i];
}

function occupiedSlots(container) {
  return cardEntities(container).map((c) =>
    Number(getAttr(cardItem(c), 'inventory_slot.x') ?? 0));
}

/**
 * 生成法术卡实体(附录 A 模板,完整复刻实测卡结构)。
 * @param {object} dict 字典条目 {id, sprite, type}
 * @param {{slot: number, usesRemaining: string, alwaysCast: boolean, pos: {x,y}}} p
 */
export function makeSpellCardEntity(dict, { slot, usesRemaining, alwaysCast, pos }) {
  const spriteAttrs = {
    _enabled: '0',
    additive: '0', alpha: '1', emissive: '0', fog_of_war_hole: '0',
    has_special_scale: '0', is_text_sprite: '0',
    kill_entity_after_finished: '0', never_ragdollify_on_death: '0',
    next_rect_animation: '',
    'offset_animator_offset.x': '0', 'offset_animator_offset.y': '0',
    rect_animation: '', smooth_filtering: '0',
    special_scale_x: '1', special_scale_y: '1', text: '',
    'transform_offset.x': '0', 'transform_offset.y': '0',
    ui_is_parent: '0', update_transform: '1', update_transform_rotation: '1',
    visible: '1', z_index: '0.595',
  };
  const spriteAnimator = (id) => makeElement('SpriteOffsetAnimatorComponent', {
    _enabled: '0', _tags: 'enabled_in_world', sprite_id: String(id),
    x_amount: '0', x_phase: '16', x_phase_offset: '0', x_speed: '0',
    y_amount: '1', y_speed: '2.5',
  });

  return makeElement('Entity', { _version: '1', name: '', serialize: '1', tags: 'card_action' }, [
    makeElement('_Transform', {
      'position.x': pos.x, 'position.y': pos.y,
      rotation: '0', 'scale.x': '1', 'scale.y': '1',
    }),
    makeElement('HitboxComponent', {
      _enabled: '0', _tags: 'enabled_in_world',
      aabb_max_x: '4', aabb_max_y: '3', aabb_min_x: '-4', aabb_min_y: '-3',
      damage_multiplier: '1', is_enemy: '1', is_item: '0', is_player: '0',
      'offset.x': '0', 'offset.y': '0',
    }),
    makeElement('ItemActionComponent', {
      _enabled: '0', _tags: 'enabled_in_world', action_id: dict.id,
    }),
    makeElement('ItemComponent', {
      _enabled: '0', _tags: 'enabled_in_world',
      always_use_item_name_in_ui: '0', auto_pickup: '0',
      camera_max_distance: '50', camera_smooth_speed_multiplier: '1',
      collect_nondefault_actions: '0', custom_pickup_string: '',
      drinkable: '1', enable_orb_hacks: '0', has_been_picked_by_player: '1',
      'inventory_slot.x': String(slot), 'inventory_slot.y': '0',
      is_all_spells_book: '0', is_consumable: '0', is_equipable_forced: '0',
      is_frozen: '0', is_hittable_always: '0', is_identified: '1',
      is_pickable: '1', is_stackable: '0', item_name: '',
      item_pickup_radius: '14.1', mFramePickedUp: '0', max_child_items: '0',
      next_frame_pickable: '0', npc_next_frame_pickable: '0',
      permanently_attached: alwaysCast ? '1' : '0',
      play_hover_animation: '0', play_pick_sound: '1',
      play_spinning_animation: '0', preferred_inventory: 'FULL',
      remove_default_child_actions_on_death: '0', remove_on_death: '0',
      remove_on_death_if_empty: '0',
      'spawn_pos.x': pos.x, 'spawn_pos.y': pos.y,
      stats_count_as_item_pick_up: '1', ui_description: '',
      ui_display_description_on_pick_up_hint: '0', ui_sprite: '',
      uses_remaining: usesRemaining,
    }),
    makeElement('SimplePhysicsComponent', {
      _enabled: '0', _tags: 'enabled_in_world', can_go_up: '1',
    }),
    makeElement('SpriteComponent', {
      ...spriteAttrs, _tags: 'enabled_in_world,item_identified',
      image_file: dict.sprite, offset_x: '8', offset_y: '17',
    }),
    makeElement('SpriteComponent', {
      ...spriteAttrs, _tags: 'enabled_in_world,item_unidentified',
      image_file: 'data/ui_gfx/gun_actions/unidentified.png',
      offset_x: '8', offset_y: '17',
    }),
    makeElement('SpriteComponent', {
      ...spriteAttrs, _tags: 'enabled_in_world,item_bg',
      image_file: itemBgForType(dict.type), offset_x: '10', offset_y: '19',
    }),
    spriteAnimator(0), spriteAnimator(1), spriteAnimator(2), spriteAnimator(3),
    makeElement('VelocityComponent', {
      _enabled: '0', _tags: 'enabled_in_world',
      affect_physics_bodies: '0', air_friction: '0.55',
      apply_terminal_velocity: '1', displace_liquid: '1',
      gravity_x: '0', gravity_y: '400', limit_to_max_velocity: '1',
      liquid_death_threshold: '0', liquid_drag: '1',
      'mVelocity.x': '0', 'mVelocity.y': '0', mass: '0.05',
      terminal_velocity: '1000', updates_velocity: '1',
    }),
  ]);
}

/**
 * 向容器注入法术卡。
 * @param {object} container 法杖实体或 inventory_full 实体
 * @param {{actionId: string, slot?: number, usesRemaining?: string|number, alwaysCast?: boolean}} params
 * @param {{capacity?: number}} [opts] 给定时校验槽位 < capacity
 * @returns 新卡的读值
 */
export function addSpell(container, params, opts = {}) {
  const { actionId, alwaysCast = false } = params;
  const dict = findSpell(actionId);
  if (!dict) throw new Error(`未知法术 action_id: ${actionId}`);

  const used = new Set(occupiedSlots(container));
  let slot;
  if (params.slot === undefined || params.slot === null || params.slot === '') {
    slot = 0;
    while (used.has(slot)) slot++; // 第一个空槽
  } else {
    slot = Number(numStr(params.slot, 'slot'));
    if (used.has(slot)) throw new Error(`槽位 ${slot} 已被占用`);
  }
  if (opts.capacity !== undefined && slot >= opts.capacity) {
    throw new Error(`槽位 ${slot} 超出容量 ${opts.capacity}`);
  }

  const usesRemaining =
    params.usesRemaining === undefined || params.usesRemaining === null || params.usesRemaining === ''
      ? '-1'
      : numStr(params.usesRemaining, 'usesRemaining');

  const tf = findComponent(container, '_Transform');
  const pos = {
    x: (tf && getAttr(tf, 'position.x')) || '0',
    y: (tf && getAttr(tf, 'position.y')) || '0',
  };

  const card = makeSpellCardEntity(dict, { slot, usesRemaining, alwaysCast, pos });
  appendChild(container, card);
  return { ...readCard(card), idx: cardEntities(container).length - 1 };
}

/**
 * 修改序号 idx 上的法术卡(usesRemaining / alwaysCast / slot 移动)。
 * @returns 修改后的读值
 */
export function updateSpell(container, idx, patch = {}) {
  const card = cardAt(container, idx);
  const item = cardItem(card);
  if (patch.usesRemaining !== undefined) {
    setAttr(item, 'uses_remaining', numStr(patch.usesRemaining, 'usesRemaining'));
  }
  if (patch.alwaysCast !== undefined) {
    setAttr(item, 'permanently_attached', patch.alwaysCast ? '1' : '0');
  }
  const curSlot = Number(getAttr(item, 'inventory_slot.x') ?? 0);
  if (patch.slot !== undefined && Number(patch.slot) !== curSlot) {
    const target = Number(numStr(patch.slot, 'slot'));
    if (occupiedSlots(container).includes(target)) {
      throw new Error(`槽位 ${target} 已被占用`);
    }
    setAttr(item, 'inventory_slot.x', String(target));
  }
  return readCard(card);
}

/** 删除序号 idx 上的法术卡。 */
export function removeSpell(container, idx) {
  const card = cardAt(container, idx);
  removeChild(container, card);
  return { removed: readCard(card) };
}

/**
 * 重排:order 为全部卡片序号(文档序 idx)的排列(0..n-1,不多不少),
 * 按 order 顺序给各卡赋槽位 0..n-1 —— 压缩槽位,顺带消除重复。
 *
 * 真实存档中同一容器内多张卡可共享同一槽位(游戏自产数据,实测本仓库
 * save00 初始杖两张 LIGHT_BULLET 都在 slot 0),因此以 idx 而非槽位号
 * 作寻址标识,排列校验与解析都无歧义。
 */
export function reorderSpells(container, order) {
  if (!Array.isArray(order)) throw new Error('order 必须是序号数组');
  const cards = cardEntities(container);
  const given = order.map((s) => Number(numStr(s, 'order[]'))).sort((a, b) => a - b);
  if (given.length !== cards.length || given.some((v, i) => v !== i)) {
    throw new Error(`order 必须是全部卡片序号 0..${cards.length - 1} 的排列`);
  }
  order.forEach((idx, i) =>
    setAttr(cardItem(cards[Number(idx)]), 'inventory_slot.x', String(i)));
  return listSpells(container);
}
