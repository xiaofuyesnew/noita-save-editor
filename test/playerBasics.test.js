// M1 玩家基础属性模型单测 —— 直接在解析的 save00 夹具树上操作,不落盘。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { SAVE_DIR } from './setup.js';
import { parseXml } from '../server/xml/parse.js';
import { docRoot, findComponent, getAttr, childEntities } from '../server/xml/query.js';
import {
  readBasics,
  applyBasics,
  readDamageMultipliers,
  applyDamageMultipliers,
  readInvincibility,
  applyInvincibility,
  EDITOR_EFFECT_NAME,
} from '../server/model/playerBasics.js';

const PLAYER = join(SAVE_DIR, 'player.xml');
const WORLD = join(SAVE_DIR, 'world_state.xml');

function loadPlayer() {
  return parseXml(readFileSync(PLAYER, 'utf8'));
}
function loadWorld() {
  return existsSync(WORLD) ? parseXml(readFileSync(WORLD, 'utf8')) : undefined;
}

function dmg(tree) {
  return findComponent(docRoot(tree, 'Entity'), 'DamageModelComponent');
}

test('readBasics: HP 按 ×25 换算为显示值', () => {
  const tree = loadPlayer();
  const b = readBasics(tree);
  const internal = Number(getAttr(dmg(tree), 'hp'));
  assert.equal(b.hp.current, String(internal * 25));
  assert.equal(typeof b.money, 'string');
  assert.equal(typeof b.fly.timeMax, 'string');
});

test('applyBasics: 写显示 HP → 存档内部值 ÷25', () => {
  const tree = loadPlayer();
  const r = applyBasics(tree, undefined, { hp: { current: '100', max: '100' } });
  assert.ok(r.playerChanged);
  assert.equal(getAttr(dmg(tree), 'hp'), '4');
  assert.equal(getAttr(dmg(tree), 'max_hp'), '4');
});

test('applyBasics: maxHp 联动 world_state PlayerStatsComponent', () => {
  const tree = loadPlayer();
  const world = loadWorld();
  const r = applyBasics(tree, world, { hp: { max: '250' } });
  assert.ok(r.worldChanged);
});

test('applyBasics: 金币与位置写入原样字符串', () => {
  const tree = loadPlayer();
  applyBasics(tree, undefined, { money: '123456', position: { x: '10.5', y: '-20' } });
  const root = docRoot(tree, 'Entity');
  assert.equal(getAttr(findComponent(root, 'WalletComponent'), 'money'), '123456');
  assert.equal(getAttr(findComponent(root, '_Transform'), 'position.x'), '10.5');
});

test('applyBasics: 非数值抛错', () => {
  const tree = loadPlayer();
  assert.throws(() => applyBasics(tree, undefined, { money: 'abc' }), /有效数值/);
});

test('damage-multipliers: 读回全部键并可改', () => {
  const tree = loadPlayer();
  const m = readDamageMultipliers(tree);
  assert.ok('explosion' in m);
  applyDamageMultipliers(tree, { explosion: '0', holy: '2' });
  const m2 = readDamageMultipliers(tree);
  assert.equal(m2.explosion, '0');
  assert.equal(m2.holy, '2');
});

test('damage-multipliers: 未知伤害类型抛错', () => {
  const tree = loadPlayer();
  assert.throws(() => applyDamageMultipliers(tree, { bogus: '1' }), /未知的伤害类型/);
});

test('invincibility effect: 注入并撤销 PROTECTION_ALL 子实体', () => {
  const tree = loadPlayer();
  const root = docRoot(tree, 'Entity');
  const before = childEntities(root, (e) => getAttr(e, 'name') === EDITOR_EFFECT_NAME).length;

  const on = applyInvincibility(tree, { mode: 'effect', enable: true });
  assert.ok(on.state.effect);
  const mid = childEntities(root, (e) => getAttr(e, 'name') === EDITOR_EFFECT_NAME).length;
  assert.equal(mid, before + 1);

  const off = applyInvincibility(tree, { mode: 'effect', enable: false });
  assert.equal(off.state.effect, false);
  const after = childEntities(root, (e) => getAttr(e, 'name') === EDITOR_EFFECT_NAME).length;
  assert.equal(after, before);
});

test('invincibility effect: 重复注入不产生第二个实体', () => {
  const tree = loadPlayer();
  const root = docRoot(tree, 'Entity');
  applyInvincibility(tree, { mode: 'effect', enable: true });
  applyInvincibility(tree, { mode: 'effect', enable: true });
  const count = childEntities(root, (e) => getAttr(e, 'name') === EDITOR_EFFECT_NAME).length;
  assert.equal(count, 1);
});

test('invincibility frames: 置大值再清零', () => {
  const tree = loadPlayer();
  applyInvincibility(tree, { mode: 'frames', enable: true });
  assert.equal(getAttr(dmg(tree), 'invincibility_frames'), '400000000');
  applyInvincibility(tree, { mode: 'frames', enable: false });
  assert.equal(getAttr(dmg(tree), 'invincibility_frames'), '0');
});

test('invincibility 未知模式抛错', () => {
  const tree = loadPlayer();
  assert.throws(() => applyInvincibility(tree, { mode: 'x' }), /未知无敌模式/);
});
