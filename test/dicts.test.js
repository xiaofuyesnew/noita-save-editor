// 字典增强字段单测(详情 tooltip 数据层)—— 直接读 data/*.json 断言 schema 与
// 关键数值。数值基准:游戏内部单位(伤害 ×25 = 显示值,帧 ÷60 = 秒),
// 对照 gun_actions.lua / 弹射物 XML / wiki 三方核实。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dataDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'data');
const load = name => JSON.parse(readFileSync(join(dataDir, `${name}.json`), 'utf8'));

const DMG_TYPES = new Set([
  'projectile', 'explosion', 'electricity', 'fire', 'ice', 'slice',
  'melee', 'drill', 'healing', 'holy', 'curse', 'physics_hit',
  'radioactive', 'poison', 'overeating',
]);

test('spells: 数量与关键法术的解析数值', () => {
  const spells = load('spells');
  assert.ok(spells.length >= 400, `法术数 ${spells.length}`);

  // 火花弹:wiki 显示 伤害3 / 施法延迟+0.05s / 散射-1° / 暴击+5%
  const lb = spells.find(s => s.id === 'LIGHT_BULLET');
  assert.equal(lb.castDelay, 3);
  assert.equal(lb.spreadDegrees, -1);
  assert.equal(lb.critChance, 5);
  assert.equal(lb.projectile.damage, 0.12); // ×25 = 3
  assert.equal(lb.projectile.speedMin, 750);
  assert.equal(lb.projectile.speedMax, 850);
  assert.equal(lb.projectile.lifetime, 40);

  // 沉重一击(modifier):伤害+1.75(×25=43.75)/ 速度×0.3 / 施法延迟+10 帧
  const hs = spells.find(s => s.id === 'HEAVY_SHOT');
  assert.equal(hs.damageMods.projectile, 1.75);
  assert.equal(hs.speedMultiplier, 0.3);
  assert.equal(hs.castDelay, 10);
  assert.equal(hs.projectile, undefined); // 修正类无弹射物

  // 覆盖表生效:挖掘魔弹充能 -10 帧,且近似标记被清除
  const dg = spells.find(s => s.id === 'DIGGER');
  assert.equal(dg.rechargeTime, -10);
  assert.equal(dg.statsApprox, undefined);

  // 动态数值法术保留近似标记
  const mm = spells.find(s => s.id === 'MONEY_MAGIC');
  assert.equal(mm.statsApprox, true);
});

test('spells: 数值字段 schema 合法(有限数、伤害类型已知)', () => {
  const spells = load('spells');
  const NUM_FIELDS = [
    'castDelay', 'rechargeTime', 'spreadDegrees', 'critChance', 'explosionRadius',
    'bounces', 'lifetimeAdd', 'knockback', 'speedAdd', 'speedMultiplier',
  ];
  for (const s of spells) {
    for (const f of NUM_FIELDS) {
      if (s[f] !== undefined)
        assert.ok(Number.isFinite(s[f]), `${s.id}.${f} = ${s[f]}`);
    }
    for (const [k, v] of Object.entries(s.damageMods ?? {})) {
      assert.ok(DMG_TYPES.has(k), `${s.id} 未知伤害类型 ${k}`);
      assert.ok(Number.isFinite(v), `${s.id}.damageMods.${k}`);
    }
    if (s.projectile) {
      assert.ok(s.projectile.file, `${s.id}.projectile 缺 file`);
      for (const [k, v] of Object.entries(s.projectile.damageByType ?? {}))
        assert.ok(DMG_TYPES.has(k), `${s.id} 未知 damageByType ${k}(${v})`);
    }
  }
});

test('perks: 叠加/池子等静态字段', () => {
  const perks = load('perks');
  assert.ok(perks.length >= 100);
  assert.ok(perks.some(p => p.stackableMax !== undefined), '应有 stackable_maximum 天赋');
  assert.ok(perks.some(p => p.oneOff), '应有 one_off_effect 天赋');
  const ids = new Set(perks.map(p => p.id));
  for (const p of perks) {
    for (const rid of p.removeOtherPerks ?? [])
      assert.ok(ids.has(rid), `${p.id}.removeOtherPerks 含未知天赋 ${rid}`);
  }
});

test('effects: 生成字段已合并且手工字段无损', () => {
  const effects = load('effects');
  assert.equal(effects.length, 88);
  // 手工策展字段在重建后必须原样保留
  const el = effects.find(e => e.id === 'ELECTROCUTION');
  assert.equal(el.group, '减益');
  assert.equal(el.danger, true);
  for (const e of effects)
    assert.ok(e.nameZh, `${e.id} 丢失 nameZh`);
  // 生成字段:WET 描述 + 默认时长 600 帧(10 秒)
  const wet = effects.find(e => e.id === 'WET');
  assert.ok(wet.desc);
  assert.ok(wet.descZh);
  assert.equal(wet.durationFrames, 600);
  assert.equal(wet.protectsFromFire, true);
});

test('materials: 简要属性字段', () => {
  const materials = load('materials');
  assert.ok(materials.length >= 200);
  const oil = materials.find(m => m.id === 'oil');
  assert.equal(oil.burnable, true);
  // 注:可倒的 water 本身不带 status_effects(WET 污渍由游戏机制硬编码),
  // 带该属性的是 water_static / blood / lava 等
  const ws = materials.find(m => m.id === 'water_static');
  assert.equal(ws.statusEffects, 'WET');
  const blood = materials.find(m => m.id === 'blood');
  assert.equal(blood.statusEffects, 'BLOODY');
  const lava = materials.find(m => m.id === 'lava');
  assert.equal(lava.statusEffects, 'ON_FIRE');
  assert.equal(lava.dangerFire, true);
});

test('items: 中英描述齐备', () => {
  const items = load('items');
  assert.equal(items.length, 20);
  for (const it of items) {
    assert.equal(typeof it.desc, 'string', `${it.id}.desc`);
    assert.equal(typeof it.descZh, 'string', `${it.id}.descZh`);
  }
  const eye = items.find(i => i.id === 'evil_eye');
  assert.ok(eye.desc);
  assert.ok(eye.descZh);
});
