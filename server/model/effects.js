// M3 特殊效果模型 —— 扫描/注入/移除玩家身上的 GameEffect 效果实体。
//
// 效果 = 玩家的直接子实体,内含 GameEffectComponent(effect 枚举 + frames);
// frames=-1 永久,>0 为剩余帧数(÷60=秒)。可选 UIIconComponent 让效果在 HUD 显示。
// 本工具注入的实体用 name=EDITOR_EFFECT_NAME 标记,便于识别与整体撤销。
//
// 原则同其他模型:数值按字符串搬运、只改白名单、不落盘。

import {
  docRoot,
  findComponent,
  getAttr,
  makeElement,
  appendChild,
  removeChild,
  childEntities,
  entityHasTag,
} from '../xml/query.js';
import { findEffect } from '../services/dict.js';

// 本工具注入的效果实体用 name 标记(与 M1 无敌功能一致,保持兼容)
export const EDITOR_EFFECT_NAME = 'save_editor_effect';

function playerRoot(playerTree) {
  const root = docRoot(playerTree, 'Entity');
  if (!root) throw new Error('player.xml 结构异常: 找不到根 Entity');
  return root;
}

/**
 * 生成永久/限时效果实体(方案附录 B 模板,参数化 effect/frames + 可选 HUD 图标)。
 * @param {string} effect GAME_EFFECT 枚举
 * @param {string|number} frames -1=永久,>0=帧数
 * @param {{x,y}} pos 实体位置(通常同玩家)
 * @param {{icon?:string,name?:string,description?:string}} [ui] 给定则附 UIIconComponent
 */
export function makeEffectEntity(effect, frames = '-1', pos = { x: '0', y: '0' }, ui) {
  const children = [
    makeElement('_Transform', {
      'position.x': pos.x, 'position.y': pos.y,
      rotation: '0', 'scale.x': '1', 'scale.y': '1',
    }),
    makeElement('GameEffectComponent', {
      _enabled: '1',
      caused_by_ingestion_status_effect: '0',
      caused_by_stains: '0',
      causing_status_effect: 'NONE',
      custom_effect_id: '',
      disable_movement: '0',
      effect: String(effect),
      exclusivity_group: '0',
      frames: String(frames),
      mCaster: '0',
      mCasterHerdId: '0',
      mCharmDisabledCameraBound: '0',
      mCharmEnabledTeleporting: '0',
      mCooldown: '0',
      mCounter: '0',
      mInvisible: '0',
      mIsExtension: '0',
      mIsSpent: '0',
      mSerializedData: '',
      no_heal_max_hp_cap: '3.40282e+038',
      polymorph_target: '',
      ragdoll_effect: 'NONE',
      ragdoll_effect_custom_entity_file: '',
      ragdoll_fx_custom_entity_apply_only_to_largest_body: '0',
      ragdoll_material: 'air',
      report_block_msg: '1',
      teleportation_delay_min_frames: '30',
      teleportation_probability: '600',
      teleportation_radius_max: '1024',
      teleportation_radius_min: '128',
      teleportations_num: '0',
    }),
    makeElement('InheritTransformComponent', {
      _enabled: '1', only_position: '0', parent_sprite_id: '-1', use_root_parent: '0',
    }, [
      makeElement('Transform', {
        'position.x': '0', 'position.y': '0', rotation: '0', 'scale.x': '1', 'scale.y': '1',
      }),
    ]),
  ];

  if (ui && ui.icon) {
    children.push(makeElement('UIIconComponent', {
      _enabled: '1',
      description: ui.description ?? '',
      display_above_head: '0',
      display_in_hud: '1',
      icon_sprite_file: ui.icon,
      is_perk: '0',
      name: ui.name ?? String(effect),
    }));
  }

  return makeElement('Entity', {
    _version: '1', name: EDITOR_EFFECT_NAME, serialize: '1', tags: '',
  }, children);
}

const FRAMES_PER_SECOND = 60;

/** 玩家上"带 GameEffectComponent 的直接子实体"列表(含游戏自带的效果实体)。 */
function effectEntities(root) {
  return childEntities(root).filter((e) => findComponent(e, 'GameEffectComponent'));
}

/** 本工具注入的、可选按 effect 过滤的效果实体列表。 */
export function editorEffectEntities(root, effect) {
  return childEntities(root, (e) => {
    if (getAttr(e, 'name') !== EDITOR_EFFECT_NAME) return false;
    const gec = findComponent(e, 'GameEffectComponent');
    return gec !== undefined && (!effect || getAttr(gec, 'effect') === effect);
  });
}

/**
 * 列出玩家身上的效果。index 为在"效果实体子集"中的序号(供 DELETE 使用)。
 * source: 'editor'(本工具注入)| 'game'(游戏产生)。
 */
export function listEffects(playerTree) {
  const root = playerRoot(playerTree);
  return effectEntities(root).map((e, index) => {
    const gec = findComponent(e, 'GameEffectComponent');
    const effect = getAttr(gec, 'effect');
    const frames = getAttr(gec, 'frames');
    const dict = findEffect(effect);
    const framesNum = Number(frames);
    return {
      index,
      effect,
      nameZh: dict?.nameZh,
      group: dict?.group,
      danger: dict?.danger ?? false,
      frames,
      permanent: frames === '-1',
      seconds: Number.isFinite(framesNum) && framesNum > 0
        ? String(framesNum / FRAMES_PER_SECOND)
        : undefined,
      source: getAttr(e, 'name') === EDITOR_EFFECT_NAME ? 'editor' : 'game',
      hasIcon: findComponent(e, 'UIIconComponent') !== undefined,
    };
  });
}

/**
 * 注入效果。
 * @param {{effect:string, frames?:string|number, seconds?:number, withIcon?:boolean}} params
 *   frames 优先;否则 seconds×60;都缺省为 -1(永久)。
 * @returns 新效果的读值
 */
export function addEffect(playerTree, params) {
  const { effect, withIcon = false } = params;
  if (!effect) throw new Error('缺少 effect');
  const dict = findEffect(effect);
  if (!dict) throw new Error(`未知效果枚举: ${effect}`);
  if (dict.selectable === false) throw new Error(`效果 ${effect} 不可用于注入`);

  let frames;
  if (params.frames !== undefined && params.frames !== null && params.frames !== '') {
    frames = numIntStr(params.frames, 'frames');
  } else if (params.seconds !== undefined && params.seconds !== null && params.seconds !== '') {
    const sec = Number(params.seconds);
    if (!Number.isFinite(sec) || sec <= 0) throw new Error(`seconds 非法: ${params.seconds}`);
    frames = String(Math.round(sec * FRAMES_PER_SECOND));
  } else {
    frames = '-1';
  }

  const root = playerRoot(playerTree);
  const tf = findComponent(root, '_Transform');
  const pos = {
    x: (tf && getAttr(tf, 'position.x')) || '0',
    y: (tf && getAttr(tf, 'position.y')) || '0',
  };
  const ui = withIcon && dict.icon
    ? { icon: dict.icon, name: effect, description: dict.nameZh ?? '' }
    : undefined;

  const entity = makeEffectEntity(effect, frames, pos, ui);
  appendChild(root, entity);

  // 返回新实体在列表中的读值
  const all = listEffects(playerTree);
  return all[all.length - 1];
}

/** 按 listEffects 的 index 移除效果实体。 */
export function removeEffect(playerTree, index) {
  const root = playerRoot(playerTree);
  const entities = effectEntities(root);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= entities.length) {
    throw new Error(`效果索引越界: ${index}(现有 ${entities.length} 个)`);
  }
  const target = entities[i];
  const gec = findComponent(target, 'GameEffectComponent');
  const effect = getAttr(gec, 'effect');
  removeChild(root, target);
  return { removed: { index: i, effect } };
}

function numIntStr(value, field) {
  const s = String(value).trim();
  const n = Number(s);
  if (!Number.isInteger(n)) {
    throw new Error(`字段 ${field} 必须是整数: ${JSON.stringify(value)}`);
  }
  return s;
}
