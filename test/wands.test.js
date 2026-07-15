// M2 法杖/法术模型单测 —— 在解析的 save00 夹具树上操作,不落盘。
// 夹具现状:inventory_quick 2 根法杖(杖0 LIGHT_BULLET / 杖1 ROCKET),
// inventory_full 为空。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SAVE_DIR } from './setup.js';
import { parseXml } from '../server/xml/parse.js';
import { serializeXml, countElements } from '../server/xml/serialize.js';
import { findComponent, getAttr } from '../server/xml/query.js';
import {
  listWands,
  wandAt,
  applyWandStats,
  applyStatsToWand,
  fullInventory,
  fullInventoryCapacity,
  cardEntities,
} from '../server/model/wands.js';
import {
  listSpells,
  addSpell,
  updateSpell,
  removeSpell,
  reorderSpells,
} from '../server/model/spells.js';
import { getDict, findSpell, findWandLook, itemBgForType } from '../server/services/dict.js';

const PLAYER = join(SAVE_DIR, 'player.xml');

function loadPlayer() {
  return parseXml(readFileSync(PLAYER, 'utf8'));
}

// ---- 字典 -------------------------------------------------------------------

test('dict: spells.json 422 条,含中英文名与 sprite', () => {
  const spells = getDict('spells');
  assert.equal(spells.length, 422);
  const lb = findSpell('LIGHT_BULLET');
  assert.equal(lb.name, 'Spark bolt');
  assert.equal(lb.nameZh, '火花弹');
  assert.equal(lb.sprite, 'data/ui_gfx/gun_actions/light_bullet.png');
  assert.equal(lb.type, 'projectile');
});

test('dict: 类型背景图映射,未知类型回退 other', () => {
  assert.equal(itemBgForType('modifier'), 'data/ui_gfx/inventory/item_bg_modifier.png');
  assert.equal(itemBgForType('bogus'), 'data/ui_gfx/inventory/item_bg_other.png');
});

test('dict: 未知字典名抛错', () => {
  assert.throws(() => getDict('nope'), /未知字典/);
});

test('dict: wands.json 1002 条外观,findWandLook 携带最终联动值(§12)', () => {
  const looks = getDict('wands');
  assert.equal(looks.length, 1002);
  // wands.lua: wand_0898 grip=(2,2)/tip=(10,2) → offset=grip、shoot_pos=tip−grip
  // (与 save00 遗骨 item921 实测一致)
  const look = findWandLook('data/items_gfx/wands/wand_0898.png');
  assert.deepEqual(
    [look.offsetX, look.offsetY, look.hotspotX, look.hotspotY, look.rectAnim],
    [2, 2, 8, 0, ''],
  );
  const handgun = findWandLook('data/items_gfx/handgun.xml');
  assert.deepEqual(
    [handgun.offsetX, handgun.offsetY, handgun.hotspotX, handgun.hotspotY, handgun.rectAnim],
    [0, 0, 8, -0.5, 'default'],
  );
  assert.equal(findWandLook('mods/foo/custom.png'), undefined);
});

// ---- 法杖读 ------------------------------------------------------------------
// 注意:save00 是玩家的真实存档快照,内容会随「从实时档拉取」变化,
// 断言一律与树中组件动态比对,不硬编码具体法杖/法术。

test('listWands: 枚举法杖并读出核心属性(与组件属性一致)', () => {
  const tree = loadPlayer();
  const wands = listWands(tree);
  assert.ok(wands.length >= 1, '夹具应至少有一根法杖');

  const w0 = wands[0];
  const wand = wandAt(tree, 0);
  const ability = findComponent(wand, 'AbilityComponent');
  assert.equal(w0.uiName, getAttr(ability, 'ui_name'));
  assert.equal(w0.manaMax, getAttr(ability, 'mana_max'));
  assert.equal(w0.manaChargeSpeed, getAttr(ability, 'mana_charge_speed'));
  const gunConfig = findComponent(ability, 'gun_config');
  assert.equal(w0.deckCapacity, getAttr(gunConfig, 'deck_capacity'));
  assert.equal(w0.reloadTime, getAttr(gunConfig, 'reload_time'));
  const gunaction = findComponent(ability, 'gunaction_config');
  assert.equal(w0.fireRateWait, getAttr(gunaction, 'fire_rate_wait'));
  assert.equal(w0.spellCount, cardEntities(wand).length);
  assert.ok('damage_projectile_add' in w0.advanced);
});

test('wandAt: 越界抛错', () => {
  const tree = loadPlayer();
  assert.throws(() => wandAt(tree, 5), /越界/);
  assert.throws(() => wandAt(tree, -1), /越界/);
});

// ---- 法杖写 ------------------------------------------------------------------

test('applyWandStats: 白名单字段写入', () => {
  const tree = loadPlayer();
  // 容量不硬编码:真实快照的杖0可能已占到高槽位,取「最大占用槽位+1」保证合法
  const maxSlot = listSpells(wandAt(tree, 0)).reduce((m, s) => Math.max(m, s.slot), -1);
  const capacity = String(Math.max(10, maxSlot + 1));
  const r = applyWandStats(tree, 0, {
    uiName: '测试杖',
    manaMax: '1000',
    mana: '1000',
    deckCapacity: capacity,
    shuffleDeckWhenEmpty: '0',
    fireRateWait: '1',
  });
  assert.ok(r.changed);
  const ability = findComponent(wandAt(tree, 0), 'AbilityComponent');
  assert.equal(getAttr(ability, 'ui_name'), '测试杖');
  assert.equal(getAttr(ability, 'mana_max'), '1000');
  assert.equal(getAttr(findComponent(ability, 'gun_config'), 'deck_capacity'), capacity);
  assert.equal(getAttr(findComponent(ability, 'gunaction_config'), 'fire_rate_wait'), '1');
});

test('applyWandStats: reloadTime 同步 reload_time_frames', () => {
  const tree = loadPlayer();
  const r = applyWandStats(tree, 0, { reloadTime: '5' });
  assert.ok(r.fields.includes('reloadTimeFrames(auto)'));
  const ability = findComponent(wandAt(tree, 0), 'AbilityComponent');
  assert.equal(getAttr(findComponent(ability, 'gun_config'), 'reload_time'), '5');
  assert.equal(getAttr(ability, 'reload_time_frames'), '5');
});

// ---- 外观联动(§12)------------------------------------------------------------

function handSprite(wand) {
  return findComponent(wand, 'SpriteComponent', (n) =>
    (getAttr(n, '_tags') ?? '').includes('enabled_in_hand'));
}
function shootPos(wand) {
  return findComponent(wand, 'HotspotComponent', (n) =>
    (getAttr(n, '_tags') ?? '').includes('shoot_pos'));
}

test('applyWandStats: spriteFile 命中字典 → 贴图/握把/枪口三处联动', () => {
  const tree = loadPlayer();
  const r = applyWandStats(tree, 0, { spriteFile: 'data/items_gfx/wands/wand_0898.png' });
  assert.ok(r.fields.includes('spriteFile(SpriteComponent)'));
  assert.ok(r.fields.includes('spriteFile(grip)'));
  assert.ok(r.fields.includes('spriteFile(shoot_pos)'));

  const wand = wandAt(tree, 0);
  assert.equal(getAttr(findComponent(wand, 'AbilityComponent'), 'sprite_file'),
    'data/items_gfx/wands/wand_0898.png');
  const sprite = handSprite(wand);
  assert.ok(sprite, '夹具杖0应有手持 SpriteComponent');
  assert.equal(getAttr(sprite, 'image_file'), 'data/items_gfx/wands/wand_0898.png');
  assert.equal(getAttr(sprite, 'offset_x'), '2');
  assert.equal(getAttr(sprite, 'offset_y'), '2');
  assert.equal(getAttr(sprite, 'rect_animation'), '');
  assert.equal(getAttr(sprite, 'next_rect_animation'), '');
  const hotspot = shootPos(wand);
  assert.ok(hotspot, '夹具杖0应有 shoot_pos HotspotComponent');
  assert.equal(getAttr(hotspot, 'offset.x'), '8');
  assert.equal(getAttr(hotspot, 'offset.y'), '0');
});

test('applyWandStats: spriteFile 切初始杖(.xml 精灵)→ rect_animation 与枪口特例', () => {
  const tree = loadPlayer();
  applyWandStats(tree, 0, { spriteFile: 'data/items_gfx/wands/wand_0898.png' });
  applyWandStats(tree, 0, { spriteFile: 'data/items_gfx/handgun.xml' });
  const wand = wandAt(tree, 0);
  const sprite = handSprite(wand);
  assert.equal(getAttr(sprite, 'image_file'), 'data/items_gfx/handgun.xml');
  assert.equal(getAttr(sprite, 'offset_x'), '0');
  assert.equal(getAttr(sprite, 'offset_y'), '0');
  assert.equal(getAttr(sprite, 'rect_animation'), 'default');
  const hotspot = shootPos(wand);
  assert.equal(getAttr(hotspot, 'offset.x'), '8');
  assert.equal(getAttr(hotspot, 'offset.y'), '-0.5');
});

test('applyWandStats: spriteFile 未命中字典 → 仅改贴图,几何字段不动', () => {
  const tree = loadPlayer();
  applyWandStats(tree, 0, { spriteFile: 'data/items_gfx/wands/wand_0898.png' });
  const r = applyWandStats(tree, 0, { spriteFile: 'mods/foo/custom_wand.png' });
  assert.ok(r.fields.includes('spriteFile(SpriteComponent)'));
  assert.ok(!r.fields.includes('spriteFile(grip)'));
  assert.ok(!r.fields.includes('spriteFile(shoot_pos)'));

  const wand = wandAt(tree, 0);
  const sprite = handSprite(wand);
  assert.equal(getAttr(sprite, 'image_file'), 'mods/foo/custom_wand.png');
  // 保持上一次 wand_0898 的几何
  assert.equal(getAttr(sprite, 'offset_x'), '2');
  assert.equal(getAttr(sprite, 'offset_y'), '2');
  assert.equal(getAttr(shootPos(wand), 'offset.x'), '8');
  assert.equal(getAttr(shootPos(wand), 'offset.y'), '0');
});

test('applyStatsToWand: 缺 Sprite/Hotspot 组件时跳过联动不抛错', () => {
  const bare = docRoot(parseXml(`<Entity tags="wand">
  <AbilityComponent sprite_file="a" ui_name="x">
    <gun_config deck_capacity="1"></gun_config>
    <gunaction_config fire_rate_wait="1"></gunaction_config>
  </AbilityComponent>
</Entity>`), 'Entity');
  const r = applyStatsToWand(bare, { spriteFile: 'data/items_gfx/wands/wand_0898.png' });
  assert.ok(r.changed);
  assert.ok(!r.fields.includes('spriteFile(SpriteComponent)'));
  assert.ok(!r.fields.includes('spriteFile(grip)'));
  assert.ok(!r.fields.includes('spriteFile(shoot_pos)'));
  assert.equal(getAttr(findComponent(bare, 'AbilityComponent'), 'sprite_file'),
    'data/items_gfx/wands/wand_0898.png');
});

test('applyWandStats: 容量低于已占用槽位抛错', () => {
  const tree = loadPlayer();
  const maxSlot = listSpells(wandAt(tree, 0)).reduce((m, s) => Math.max(m, s.slot), -1);
  if (maxSlot >= 0) {
    assert.throws(() => applyWandStats(tree, 0, { deckCapacity: String(maxSlot) }), /小于已占用/);
  }
  applyWandStats(tree, 0, { deckCapacity: String(maxSlot + 1) });
});

test('applyWandStats: 未知高级字段/非数值抛错', () => {
  const tree = loadPlayer();
  assert.throws(() => applyWandStats(tree, 0, { advanced: { bogus: '1' } }), /未知的高级字段/);
  assert.throws(() => applyWandStats(tree, 0, { manaMax: 'abc' }), /有效数值/);
});

// ---- 杖内法术 -----------------------------------------------------------------

test('listSpells: 与卡实体一致,按槽位升序,带字典信息与文档序 idx', () => {
  const tree = loadPlayer();
  const wand = wandAt(tree, 0);
  const spells = listSpells(wand);
  assert.equal(spells.length, cardEntities(wand).length);
  assert.ok(spells.length >= 1, '夹具杖0应至少有一张法术卡');
  for (const s of spells) {
    assert.ok(findSpell(s.actionId), `字典应含 ${s.actionId}`);
    assert.equal(s.nameZh, findSpell(s.actionId).nameZh);
  }
  for (let i = 1; i < spells.length; i++) {
    assert.ok(spells[i].slot >= spells[i - 1].slot, '应按槽位非降序(真实存档存在重复槽位)');
  }
  assert.deepEqual([...spells.map((s) => s.idx)].sort((a, b) => a - b),
    spells.map((_, i) => i), 'idx 应恰为 0..n-1');
});

test('addSpell: 注入 BLACK_HOLE 到第一个空槽,结构完整', () => {
  const tree = loadPlayer();
  const wand = wandAt(tree, 0);
  const before = listSpells(wand);
  const used = new Set(before.map((s) => s.slot));
  let expectedSlot = 0;
  while (used.has(expectedSlot)) expectedSlot++;

  const spell = addSpell(wand, { actionId: 'BLACK_HOLE' }, { capacity: expectedSlot + 1 });
  assert.equal(spell.slot, expectedSlot);
  assert.equal(spell.usesRemaining, '-1');

  const spells = listSpells(wand);
  assert.equal(spells.length, before.length + 1);
  assert.ok(spells.some((s) => s.actionId === 'BLACK_HOLE'));

  // 新卡关键组件与 sprite 来自字典
  const card = cardEntities(wand).find(
    (c) => getAttr(findComponent(c, 'ItemActionComponent'), 'action_id') === 'BLACK_HOLE');
  assert.ok(card, '找不到注入的卡实体');
  const idSprite = findComponent(card, 'SpriteComponent', (n) =>
    (getAttr(n, '_tags') ?? '').includes('item_identified'));
  assert.equal(getAttr(idSprite, 'image_file'), 'data/ui_gfx/gun_actions/black_hole.png');
  const bgSprite = findComponent(card, 'SpriteComponent', (n) =>
    (getAttr(n, '_tags') ?? '').includes('item_bg'));
  assert.equal(getAttr(bgSprite, 'image_file'), 'data/ui_gfx/inventory/item_bg_projectile.png');
  assert.ok(findComponent(card, 'VelocityComponent'));
  assert.equal(getAttr(findComponent(card, 'ItemComponent'), 'is_identified'), '1');
});

test('addSpell: 槽位占用/超容量/未知法术抛错', () => {
  const tree = loadPlayer();
  const wand = wandAt(tree, 0);
  const occupied = listSpells(wand)[0].slot;
  assert.throws(() => addSpell(wand, { actionId: 'BOMB', slot: occupied }), /已被占用/);
  assert.throws(() => addSpell(wand, { actionId: 'BOMB', slot: 30 }, { capacity: 26 }), /超出容量/);
  assert.throws(() => addSpell(wand, { actionId: 'NOT_A_SPELL' }), /未知法术/);
});

test('updateSpell: 次数/AlwaysCast/移动槽位(按 idx 寻址)', () => {
  const tree = loadPlayer();
  const wand = wandAt(tree, 0);
  const spells = listSpells(wand);
  const used = new Set(spells.map((s) => s.slot));
  let to = 0;
  while (used.has(to)) to++;

  const s = updateSpell(wand, spells[0].idx, { usesRemaining: '99', alwaysCast: true, slot: to });
  assert.equal(s.usesRemaining, '99');
  assert.equal(s.alwaysCast, true);
  assert.equal(s.slot, to);
  // 越界序号抛错
  assert.throws(() => updateSpell(wand, listSpells(wand).length, {}), /没有法术/);
  assert.throws(() => updateSpell(wand, -1, {}), /没有法术/);
});

test('removeSpell + reorderSpells: 删除与重排压缩槽位(按 idx 寻址)', () => {
  const tree = loadPlayer();
  const wand = wandAt(tree, 0);
  applyWandStats(tree, 0, { deckCapacity: '26' });
  addSpell(wand, { actionId: 'BOMB' });
  addSpell(wand, { actionId: 'BLACK_HOLE' });

  // 逆序重排:order 为 idx 排列,槽位压缩为 0..n-1,顺序整体反转
  const before = listSpells(wand);
  const after = reorderSpells(wand, before.map((s) => s.idx).reverse());
  assert.deepEqual(after.map((s) => s.actionId), before.map((s) => s.actionId).reverse());
  assert.deepEqual(after.map((s) => s.slot), after.map((_, i) => i));
  assert.throws(() => reorderSpells(wand, [0]), /排列/);

  // 删除槽1 上的卡(按其 idx),其余保持不变
  const victim = after.find((s) => s.slot === 1);
  const kept = after.filter((s) => s.slot !== 1).map((s) => s.actionId);
  removeSpell(wand, victim.idx);
  assert.deepEqual(listSpells(wand).map((s) => s.actionId), kept);
  assert.throws(() => removeSpell(wand, listSpells(wand).length), /没有法术/);
});

// ---- 背包散装法术 --------------------------------------------------------------

test('inventory_full: 容量读取与法术注入/枚举', () => {
  const tree = loadPlayer();
  assert.ok(fullInventoryCapacity(tree) >= 1);
  const inv = fullInventory(tree);
  const before = listSpells(inv).length;
  addSpell(inv, { actionId: 'HEAL_BULLET', usesRemaining: '20' });
  const spells = listSpells(inv);
  assert.equal(spells.length, before + 1);
  const injected = spells.find((s) => s.actionId === 'HEAL_BULLET' && s.usesRemaining === '20');
  assert.ok(injected, '应能读回注入的 HEAL_BULLET');
});

// ---- 序列化健全性 --------------------------------------------------------------

test('注入法术后 round-trip 自检通过', () => {
  const tree = loadPlayer();
  const wand = wandAt(tree, 0);
  applyWandStats(tree, 0, { deckCapacity: '26' });
  addSpell(wand, { actionId: 'BLACK_HOLE' });
  addSpell(fullInventory(tree), { actionId: 'BOMB' });
  const expected = listSpells(wand).map((s) => s.actionId);

  const text = serializeXml(tree);
  const reparsed = parseXml(text);
  assert.equal(countElements(reparsed), countElements(tree));

  // 重解析后的树同样能读出注入的法术
  const spells = listSpells(wandAt(reparsed, 0));
  assert.deepEqual(spells.map((s) => s.actionId), expected);
  assert.ok(spells.some((s) => s.actionId === 'BLACK_HOLE'));
});

// ---- 重复槽位(真实存档会出现,如两张卡同在 slot 0) ------------------------------

import { docRoot } from '../server/xml/query.js';

function dupSlotContainer() {
  // 合成夹具:BOMB@0、LIGHT_BULLET@0(重复)、BLACK_HOLE@1
  const card = (id, slot) => `
  <Entity tags="card_action">
    <ItemActionComponent action_id="${id}"></ItemActionComponent>
    <ItemComponent inventory_slot.x="${slot}" inventory_slot.y="0"
      permanently_attached="0" uses_remaining="-1"></ItemComponent>
  </Entity>`;
  const xml = `<Entity name="w" tags="">
  <_Transform position.x="0" position.y="0"></_Transform>
  ${card('BOMB', 0)}${card('LIGHT_BULLET', 0)}${card('BLACK_HOLE', 1)}
</Entity>`;
  return docRoot(parseXml(xml), 'Entity');
}

test('重复槽位:listSpells 全部可见并带 idx,addSpell 避开占用槽', () => {
  const c = dupSlotContainer();
  const spells = listSpells(c);
  assert.deepEqual(spells.map((s) => s.actionId), ['BOMB', 'LIGHT_BULLET', 'BLACK_HOLE']);
  assert.deepEqual(spells.map((s) => s.slot), [0, 0, 1]);
  assert.deepEqual(spells.map((s) => s.idx), [0, 1, 2], 'idx 为文档序,同槽卡各自唯一');

  const added = addSpell(c, { actionId: 'HEAL_BULLET' });
  assert.equal(added.slot, 2, '首个空槽应跳过重复占用的 0 和 1');
  assert.equal(added.idx, 3, '新卡追加到文档末尾');
});

test('重复槽位:按 idx 可直接编辑/删除同槽卡,互不影响', () => {
  const c = dupSlotContainer();
  // 编辑同槽第二张(LIGHT_BULLET,idx=1),第一张(BOMB)不受影响
  const s = updateSpell(c, 1, { usesRemaining: '5', alwaysCast: true });
  assert.equal(s.actionId, 'LIGHT_BULLET');
  let spells = listSpells(c);
  assert.equal(spells.find((x) => x.actionId === 'LIGHT_BULLET').usesRemaining, '5');
  assert.equal(spells.find((x) => x.actionId === 'BOMB').usesRemaining, '-1');

  // 删除同槽第一张(BOMB,idx=0),LIGHT_BULLET 保留且 idx 左移
  const { removed } = removeSpell(c, 0);
  assert.equal(removed.actionId, 'BOMB');
  spells = listSpells(c);
  assert.deepEqual(spells.map((x) => x.actionId), ['LIGHT_BULLET', 'BLACK_HOLE']);
  assert.deepEqual(spells.map((x) => x.idx), [0, 1]);
});

test('重复槽位:reorderSpells 按 idx 排列压缩为 0..n-1', () => {
  const c = dupSlotContainer();
  const before = listSpells(c);
  // 逆序:order=[2,1,0] —— BLACK_HOLE、LIGHT_BULLET、BOMB 依次得槽 0/1/2
  const after = reorderSpells(c, before.map((s) => s.idx).reverse());
  assert.deepEqual(after.map((s) => s.actionId), ['BLACK_HOLE', 'LIGHT_BULLET', 'BOMB']);
  assert.deepEqual(after.map((s) => s.slot), [0, 1, 2], '重排后槽位应压缩且不再重复');
});

test('重复槽位:order 不是 idx 排列时报错', () => {
  const c = dupSlotContainer();
  assert.throws(() => reorderSpells(c, [0, 1, 1]), /排列/);
  assert.throws(() => reorderSpells(c, [0, 1]), /排列/);
  assert.throws(() => reorderSpells(c, [0, 1, 3]), /排列/);
});
