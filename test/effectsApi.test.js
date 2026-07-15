// M3 API 集成测试 —— 直接用 fetch 驱动 Hono app,操作内存缓冲,不落盘。

import test from 'node:test';
import assert from 'node:assert/strict';

import { app } from '../server/index.js';

const JSON_REQ = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('GET /api/dict/effects 与 perks', async () => {
  const effects = await (await app.request('/api/dict/effects')).json();
  assert.equal(effects.length, 88);
  const perks = await (await app.request('/api/dict/perks')).json();
  assert.equal(perks.length, 106);
});

test('特殊效果:列出/注入/移除全流程', async () => {
  let res = await app.request('/api/player/effects');
  assert.equal(res.status, 200);
  const before = (await res.json()).effects.length;

  res = await app.request('/api/player/effects',
    JSON_REQ('POST', { effect: 'MANA_REGENERATION', withIcon: true }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.effect.effect, 'MANA_REGENERATION');
  assert.equal(body.effects.length, before + 1);

  res = await app.request(`/api/player/effects/${body.effect.index}`, { method: 'DELETE' });
  const del = await res.json();
  assert.ok(del.ok);
  assert.equal(del.effects.length, before);
});

test('特殊效果:非法枚举返回 400', async () => {
  const res = await app.request('/api/player/effects',
    JSON_REQ('POST', { effect: 'BOGUS' }));
  assert.equal(res.status, 400);
});

test('天赋:注入/列出/移除全流程', async () => {
  // 真实快照可能已带该天赋,计数按「已有值 +1」动态比对
  const before = (await (await app.request('/api/perks')).json()).perks
    .find((p) => p.id === 'PROTECTION_FIRE');
  const expectedCount = String((before ? Number(before.count) : 0) + 1);

  let res = await app.request('/api/perks', JSON_REQ('POST', { id: 'PROTECTION_FIRE' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.perk.flag, true);
  assert.equal(body.perk.count, expectedCount);

  res = await app.request('/api/perks');
  const list = (await res.json()).perks;
  assert.ok(list.some((p) => p.id === 'PROTECTION_FIRE'));

  res = await app.request('/api/perks/PROTECTION_FIRE', { method: 'DELETE' });
  const del = await res.json();
  assert.ok(del.ok);
  assert.ok(!del.perks.some((p) => p.id === 'PROTECTION_FIRE'));
});

test('天赋:complex 型返回 400 并带说明', async () => {
  const res = await app.request('/api/perks', JSON_REQ('POST', { id: 'ALWAYS_CAST' }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /complex 型/);
});
