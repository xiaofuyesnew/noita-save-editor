// M3 效果/天赋模型单测 —— 在解析的 save00 夹具树上操作,不落盘。
// 夹具现状:玩家身上有一个游戏产生的 NO_HEAL 效果实体(肉类生物群系),
// world_state 无任何 PERK_PICKED 旗标。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SAVE_DIR } from './setup.js';
import { parseXml } from '../server/xml/parse.js';
import { serializeXml, countElements } from '../server/xml/serialize.js';
import {
  docRoot,
  findComponent,
  getAttr,
  setAttr,
  appendChild,
  childEntities,
} from '../server/xml/query.js';
import {
  listEffects,
  addEffect,
  removeEffect,
  makeEffectEntity,
  EDITOR_EFFECT_NAME,
} from '../server/model/effects.js';
import {
  listPerks,
  addPerk,
  removePerk,
  hasRunFlag,
  getLuaGlobal,
  EDITOR_PERK_NAME,
} from '../server/model/perks.js';
import { addRunFlag, setLuaGlobal } from '../server/model/worldState.js';
import { getDict, findEffect, findPerk } from '../server/services/dict.js';

const PLAYER = join(SAVE_DIR, 'player.xml');
const WORLD = join(SAVE_DIR, 'world_state.xml');

const loadPlayer = () => parseXml(readFileSync(PLAYER, 'utf8'));
const loadWorld = () => parseXml(readFileSync(WORLD, 'utf8'));

// ---- 字典 -------------------------------------------------------------------

test('dict: effects.json 88 个枚举,附录 C 顺序', () => {
  const effects = getDict('effects');
  assert.equal(effects.length, 88);
  assert.equal(effects[0].id, 'NONE');
  assert.equal(effects[effects.length - 1].id, '_LAST');
  const pa = findEffect('PROTECTION_ALL');
  assert.equal(pa.group, '防护');
  assert.ok(pa.icon.includes('protection_all'));
});

test('dict: perks.json 106 个天赋,kind 分类', () => {
  const perks = getDict('perks');
  assert.equal(perks.length, 106);
  const bu = findPerk('BREATH_UNDERWATER');
  assert.equal(bu.kind, 'effect');
  assert.equal(bu.gameEffect, 'BREATH_UNDERWATER');
  assert.equal(bu.uiName, '$perk_breath_underwater');
  assert.equal(bu.nameZh, '屏息静气');
  // Lukki 腿类纯 func 天赋是 complex
  const leggy = findPerk('LEGGY_FEET');
  assert.equal(leggy.kind, 'complex');
});

test('dict: 带脚本的 effect 型天赋有缺失说明与分级', () => {
  // major:招牌能力在脚本里,注入名不副实
  const freeze = findPerk('FREEZE_FIELD');
  assert.equal(freeze.funcImpact, 'major');
  assert.match(freeze.funcNote, /冰冻光环/);
  // cost:缺的是代价,注入比原版强
  assert.equal(findPerk('GLASS_CANNON').funcImpact, 'cost');
  // none:只差与神关系计数
  assert.equal(findPerk('SAVING_GRACE').funcImpact, 'none');
  // 无脚本的 effect 型没有说明
  const fire = findPerk('PROTECTION_FIRE');
  assert.equal(fire.hasFunc, false);
  assert.equal(fire.funcNote, '');
  // 所有带脚本的 effect 型都必须有说明(游戏更新兜底提示也算)
  for (const p of getDict('perks').filter((x) => x.kind === 'effect' && x.hasFunc)) {
    assert.ok(p.funcNote, `${p.id} 缺 funcNote`);
    assert.ok(['none', 'minor', 'cost', 'major'].includes(p.funcImpact), `${p.id} funcImpact 非法`);
  }
});

// ---- 效果 -------------------------------------------------------------------

test('listEffects: 识别游戏产生的 NO_HEAL 实体', () => {
  const effects = listEffects(loadPlayer());
  const noHeal = effects.find((e) => e.effect === 'NO_HEAL');
  assert.ok(noHeal, '夹具应有 NO_HEAL 效果');
  assert.equal(noHeal.source, 'game');
  assert.equal(noHeal.permanent, true);
});

test('addEffect: 永久注入 + HUD 图标', () => {
  const tree = loadPlayer();
  const e = addEffect(tree, { effect: 'PROTECTION_ALL', withIcon: true });
  assert.equal(e.effect, 'PROTECTION_ALL');
  assert.equal(e.permanent, true);
  assert.equal(e.source, 'editor');
  assert.equal(e.hasIcon, true);

  const root = docRoot(tree, 'Entity');
  const entity = childEntities(root, (n) => getAttr(n, 'name') === EDITOR_EFFECT_NAME)[0];
  const icon = findComponent(entity, 'UIIconComponent');
  assert.equal(getAttr(icon, 'icon_sprite_file'), 'data/ui_gfx/status_indicators/protection_all.png');
  assert.equal(getAttr(icon, 'display_in_hud'), '1');
});

test('addEffect: seconds 换算为帧', () => {
  const tree = loadPlayer();
  const e = addEffect(tree, { effect: 'MOVEMENT_FASTER', seconds: 90 });
  assert.equal(e.frames, '5400');
  assert.equal(e.seconds, '90');
  assert.equal(e.permanent, false);
});

test('addEffect: 未知/不可选枚举与非法时长抛错', () => {
  const tree = loadPlayer();
  assert.throws(() => addEffect(tree, { effect: 'BOGUS' }), /未知效果/);
  assert.throws(() => addEffect(tree, { effect: '_LAST' }), /不可用于注入/);
  assert.throws(() => addEffect(tree, { effect: 'WET', seconds: -5 }), /seconds 非法/);
});

test('removeEffect: 按索引移除(含游戏产生的)', () => {
  const tree = loadPlayer();
  addEffect(tree, { effect: 'INVISIBILITY' });
  const before = listEffects(tree);
  const inv = before.find((e) => e.effect === 'INVISIBILITY');
  const r = removeEffect(tree, inv.index);
  assert.equal(r.removed.effect, 'INVISIBILITY');
  assert.equal(listEffects(tree).length, before.length - 1);
  assert.throws(() => removeEffect(tree, 99), /越界/);
});

// ---- 天赋 -------------------------------------------------------------------

test('addPerk: 三件套注入(实体 + 旗标 + 计数)', () => {
  const player = loadPlayer();
  const world = loadWorld();
  const p = addPerk(player, world, { id: 'BREATH_UNDERWATER' });

  assert.equal(p.id, 'BREATH_UNDERWATER');
  assert.equal(p.flag, true);
  assert.equal(p.count, '1');
  assert.equal(p.entityCount, 1);
  assert.equal(p.source, 'editor');

  assert.ok(hasRunFlag(world, 'PERK_PICKED_BREATH_UNDERWATER'));
  assert.equal(getLuaGlobal(world, 'PERK_PICKED_BREATH_UNDERWATER_PICKUP_COUNT'), '1');

  // 真实快照可能已带游戏自产的 perk 实体,按 effect 精确定位编辑器注入的那个
  const root = docRoot(player, 'Entity');
  const entity = childEntities(root, (n) =>
    getAttr(n, 'name') === EDITOR_PERK_NAME
    && getAttr(findComponent(n, 'GameEffectComponent'), 'effect') === 'BREATH_UNDERWATER')[0];
  assert.ok(entity, '应能找到编辑器注入的天赋实体');
  assert.equal(getAttr(entity, 'tags'), 'perk_entity');
  const gec = findComponent(entity, 'GameEffectComponent');
  assert.equal(getAttr(gec, 'effect'), 'BREATH_UNDERWATER');
  assert.equal(getAttr(gec, '_tags'), 'perk_component');
  assert.equal(getAttr(gec, 'frames'), '-1');
  const icon = findComponent(entity, 'UIIconComponent');
  assert.equal(getAttr(icon, 'name'), '$perk_breath_underwater');
  assert.equal(getAttr(icon, 'is_perk'), '1');
});

test('addPerk: 重复注入只加计数不加实体', () => {
  const player = loadPlayer();
  const world = loadWorld();
  addPerk(player, world, { id: 'EXTRA_MONEY' });
  const p = addPerk(player, world, { id: 'EXTRA_MONEY' });
  assert.equal(p.count, '2');
  assert.equal(p.entityCount, 1);
});

test('addPerk: complex 型拒绝并说明', () => {
  const player = loadPlayer();
  const world = loadWorld();
  assert.throws(() => addPerk(player, world, { id: 'LEGGY_FEET' }), /complex 型/);
  // 无限法术没有 GameEffect，核心逻辑完全由 perk Lua func 实现，不能通用注入。
  assert.equal(findPerk('UNLIMITED_SPELLS').gameEffect, '');
  assert.equal(findPerk('UNLIMITED_SPELLS').hasFunc, true);
  assert.throws(() => addPerk(player, world, { id: 'UNLIMITED_SPELLS' }), /complex 型/);
  assert.throws(() => addPerk(player, world, { id: 'NOPE' }), /未知天赋/);
});

test('removePerk: 撤销全部三件套', () => {
  const player = loadPlayer();
  const world = loadWorld();
  // 真实快照可能本就带有该天赋(游戏自产实体),removePerk 会一并清除,
  // 断言与「移除后不再存在该天赋、其余天赋不受影响」动态比对
  const others = listPerks(player, world).filter((p) => p.id !== 'EDIT_WANDS_EVERYWHERE');
  addPerk(player, world, { id: 'EDIT_WANDS_EVERYWHERE' });
  const r = removePerk(player, world, 'EDIT_WANDS_EVERYWHERE');
  assert.ok(r.removed.entities >= 1);
  assert.equal(r.removed.flagRemoved, true);
  assert.equal(r.removed.countRemoved, true);
  const after = listPerks(player, world);
  assert.equal(after.length, others.length);
  assert.ok(!after.some((p) => p.id === 'EDIT_WANDS_EVERYWHERE'));
  assert.throws(() => removePerk(player, world, 'EDIT_WANDS_EVERYWHERE'), /没有天赋/);
});

// PROTECTION_FIRE / FREEZE_FIELD / BLEED_OIL 共享 gameEffect=PROTECTION_FIRE
// (爆炸/辐射/电击保护组同理),归属只能认 UIIconComponent 图标名。
// 旧逻辑按效果回落匹配,导致:添加 A 后姊妹天赋凭空上榜、后续添加姊妹被
// 误判"已在位"而漏注入、移除姊妹串删 A 的实体。以下为回归测试。

/** 清除天赋在存档中的全部痕迹(本就没有则忽略),让断言不依赖快照现状。 */
function scrubPerks(player, world, ids) {
  for (const id of ids) {
    try {
      removePerk(player, world, id);
    } catch { /* 无痕迹 */ }
  }
}

test('perk 归属:共享 gameEffect 的姊妹天赋不串档', () => {
  const player = loadPlayer();
  const world = loadWorld();
  assert.equal(findPerk('FREEZE_FIELD').gameEffect, findPerk('PROTECTION_FIRE').gameEffect);
  scrubPerks(player, world, ['PROTECTION_FIRE', 'FREEZE_FIELD', 'BLEED_OIL']);
  const base = new Set(listPerks(player, world).map((p) => p.id));

  // 添加 PROTECTION_FIRE:列表只能多出它自己,同效果姊妹不得凭空出现
  addPerk(player, world, { id: 'PROTECTION_FIRE' });
  const added = listPerks(player, world).map((p) => p.id).filter((x) => !base.has(x));
  assert.deepEqual(added, ['PROTECTION_FIRE']);

  // 再添加 FREEZE_FIELD:必须注入它自己的实体,而非被同效果实体顶掉
  addPerk(player, world, { id: 'FREEZE_FIELD' });
  const root = docRoot(player, 'Entity');
  const editorIcons = childEntities(root, (n) => getAttr(n, 'name') === EDITOR_PERK_NAME)
    .map((n) => getAttr(findComponent(n, 'UIIconComponent'), 'name'));
  assert.ok(editorIcons.includes('$perk_protection_fire'));
  assert.ok(editorIcons.includes('$perk_freeze_field'));
  const ff = listPerks(player, world).find((p) => p.id === 'FREEZE_FIELD');
  assert.equal(ff.entityCount, 1);
  assert.equal(ff.count, '1');

  // 移除 FREEZE_FIELD:PROTECTION_FIRE 的实体必须原地不动
  removePerk(player, world, 'FREEZE_FIELD');
  const after = listPerks(player, world);
  assert.ok(!after.some((p) => p.id === 'FREEZE_FIELD'));
  const pf = after.find((p) => p.id === 'PROTECTION_FIRE');
  assert.equal(pf.flag, true);
  assert.equal(pf.entityCount, 1, '移除姊妹天赋不得串删 PROTECTION_FIRE 的实体');
});

test('perk 归属:gameEffect2 与他人主效果重合同样不串档', () => {
  const player = loadPlayer();
  const world = loadWorld();
  assert.equal(findPerk('EXPLODING_CORPSES').gameEffect2, findPerk('PROTECTION_EXPLOSION').gameEffect);
  scrubPerks(player, world, ['EXPLODING_CORPSES', 'PROTECTION_EXPLOSION']);
  const base = new Set(listPerks(player, world).map((p) => p.id));

  addPerk(player, world, { id: 'EXPLODING_CORPSES' });
  const added = listPerks(player, world).map((p) => p.id).filter((x) => !base.has(x));
  assert.deepEqual(added, ['EXPLODING_CORPSES']);

  addPerk(player, world, { id: 'PROTECTION_EXPLOSION' });
  const pe = listPerks(player, world).find((p) => p.id === 'PROTECTION_EXPLOSION');
  assert.equal(pe.entityCount, 1);
  assert.equal(pe.count, '1');
});

test('perk 归属:无图标的游戏效果实体不被姊妹天赋认领', () => {
  const player = loadPlayer();
  const world = loadWorld();
  scrubPerks(player, world, ['PROTECTION_FIRE', 'BLEED_OIL']);

  // 模拟游戏拾取 PROTECTION_FIRE 留下的无图标效果实体 + 旗标/计数
  const root = docRoot(player, 'Entity');
  const gameEntity = makeEffectEntity('PROTECTION_FIRE', '-1');
  setAttr(gameEntity, 'tags', 'perk_entity');
  setAttr(findComponent(gameEntity, 'GameEffectComponent'), '_tags', 'perk_component');
  appendChild(root, gameEntity);
  addRunFlag(world, 'PERK_PICKED_PROTECTION_FIRE');
  setLuaGlobal(world, 'PERK_PICKED_PROTECTION_FIRE_PICKUP_COUNT', 1);

  // 共享效果的 BLEED_OIL 不得上榜;移除它应报"无痕迹"而非串删火免实体
  assert.ok(!listPerks(player, world).some((p) => p.id === 'BLEED_OIL'));
  assert.throws(() => removePerk(player, world, 'BLEED_OIL'), /没有天赋/);
  let pf = listPerks(player, world).find((p) => p.id === 'PROTECTION_FIRE');
  assert.equal(pf.entityCount, 1);
  assert.equal(pf.source, 'game');

  // 编辑器补加 BLEED_OIL 后移除 PROTECTION_FIRE:共享效果实体留给仍在位的姊妹
  addPerk(player, world, { id: 'BLEED_OIL' });
  const r = removePerk(player, world, 'PROTECTION_FIRE');
  assert.equal(r.removed.entities, 0);
  assert.equal(r.removed.flagRemoved, true);
  assert.ok(!listPerks(player, world).some((p) => p.id === 'PROTECTION_FIRE'));

  // 最后移除 BLEED_OIL:自己的合并实体 + 无人认领的孤儿效果实体一并清除
  const r2 = removePerk(player, world, 'BLEED_OIL');
  assert.equal(r2.removed.entities, 2);
});

// ---- 序列化健全性 --------------------------------------------------------------

test('注入效果与天赋后双文件 round-trip 自检通过', () => {
  const player = loadPlayer();
  const world = loadWorld();
  addEffect(player, { effect: 'PROTECTION_ALL', withIcon: true });
  addPerk(player, world, { id: 'BREATH_UNDERWATER' });

  for (const tree of [player, world]) {
    const text = serializeXml(tree);
    const reparsed = parseXml(text);
    assert.equal(countElements(reparsed), countElements(tree));
  }

  // 重解析后仍能读出
  const reWorld = parseXml(serializeXml(world));
  assert.ok(hasRunFlag(reWorld, 'PERK_PICKED_BREATH_UNDERWATER'));
  const rePlayer = parseXml(serializeXml(player));
  assert.ok(listEffects(rePlayer).some((e) => e.effect === 'PROTECTION_ALL'));
});
