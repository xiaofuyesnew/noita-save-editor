// M2 API 集成测试 —— 直接用 fetch 驱动 Hono app,操作内存缓冲,不落盘。

import test from 'node:test';
import assert from 'node:assert/strict';

import { app } from '../server/index.js';

const JSON_REQ = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('GET /api/dict/spells 与 spell_types', async () => {
  const res = await app.request('/api/dict/spells');
  assert.equal(res.status, 200);
  const spells = await res.json();
  assert.equal(spells.length, 422);

  const res2 = await app.request('/api/dict/spell_types');
  assert.equal((await res2.json()).length, 8);

  const bad = await app.request('/api/dict/nope');
  assert.equal(bad.status, 404);
});

test('GET /api/dict/wands 外观字典(§12)', async () => {
  const res = await app.request('/api/dict/wands');
  assert.equal(res.status, 200);
  const looks = await res.json();
  assert.equal(looks.length, 1002);
  assert.ok(looks.every((w) =>
    w.id && w.file && Number.isFinite(w.offsetX) && Number.isFinite(w.hotspotX)
    && typeof w.rectAnim === 'string'));
});

test('PUT /api/wands/:i/stats 改 spriteFile 命中字典并回显', async () => {
  const res = await app.request('/api/wands/0/stats',
    JSON_REQ('PUT', { spriteFile: 'data/items_gfx/wands/wand_0898.png' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.wand.spriteFile, 'data/items_gfx/wands/wand_0898.png');
  assert.ok(body.fields.includes('spriteFile(grip)'));
  assert.ok(body.fields.includes('spriteFile(shoot_pos)'));
});

test('GET /api/wands 返回法杖列表与法术摘要', async () => {
  const res = await app.request('/api/wands');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.version, 'number');
  assert.ok(body.wands.length >= 1, '夹具应至少有一根法杖');
  const w0 = body.wands[0];
  assert.equal(typeof w0.uiName, 'string');
  assert.ok(Array.isArray(w0.spells));
  for (const s of w0.spells) {
    assert.equal(typeof s.actionId, 'string');
    assert.equal(typeof s.slot, 'number');
    assert.equal(typeof s.idx, 'number');
  }
});

test('PUT /api/wands/:i/stats 写入并回显', async () => {
  const res = await app.request('/api/wands/1/stats',
    JSON_REQ('PUT', { manaMax: '600', manaChargeSpeed: '999' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.wand.manaMax, '600');
  assert.equal(body.wand.manaChargeSpeed, '999');
});

test('PUT stats: 版本不一致返回 409', async () => {
  const res = await app.request('/api/wands/0/stats',
    JSON_REQ('PUT', { manaMax: '100', version: 999999 }));
  assert.equal(res.status, 409);
});

test('杖内法术:增改排删全流程(按 idx 寻址)', async () => {
  // 扩容后注入
  await app.request('/api/wands/0/stats', JSON_REQ('PUT', { deckCapacity: '26' }));
  let res = await app.request('/api/wands/0/spells',
    JSON_REQ('POST', { actionId: 'BLACK_HOLE', usesRemaining: '5' }));
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.spell.actionId, 'BLACK_HOLE');
  assert.equal(body.spell.usesRemaining, '5');
  const idx = body.spell.idx;
  assert.equal(typeof idx, 'number');

  // 修改
  res = await app.request(`/api/wands/0/spells/${idx}`,
    JSON_REQ('PUT', { alwaysCast: true }));
  body = await res.json();
  assert.equal(body.spell.alwaysCast, true);

  // 逆序重排(order 为 idx 排列)→ 槽位压缩为 0..n-1,顺序反转
  res = await app.request('/api/wands/0/spells');
  const before = (await res.json()).spells;
  res = await app.request('/api/wands/0/spells/order',
    JSON_REQ('PUT', { order: before.map((s) => s.idx).reverse() }));
  body = await res.json();
  assert.ok(body.ok);
  assert.deepEqual(body.spells.map((s) => s.actionId),
    before.map((s) => s.actionId).reverse());
  assert.deepEqual(body.spells.map((s) => s.slot), body.spells.map((_, i) => i));

  // 删除注入的 BLACK_HOLE
  const bh = body.spells.find((s) => s.actionId === 'BLACK_HOLE' && s.alwaysCast);
  res = await app.request(`/api/wands/0/spells/${bh.idx}`, { method: 'DELETE' });
  body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.spells.length, before.length - 1);
});

test('杖内法术:未知法术/占用槽位返回 400', async () => {
  const res = await app.request('/api/wands/0/spells',
    JSON_REQ('POST', { actionId: 'NOT_A_SPELL' }));
  assert.equal(res.status, 400);
});

test('背包法术:注入与删除(按 idx 寻址)', async () => {
  let res = await app.request('/api/inventory/spells');
  const before = (await res.json()).spells.length;

  res = await app.request('/api/inventory/spells',
    JSON_REQ('POST', { actionId: 'BOMB' }));
  assert.equal(res.status, 200);
  const { spell } = await res.json();
  assert.equal(spell.actionId, 'BOMB');

  res = await app.request(`/api/inventory/spells/${spell.idx}`, { method: 'DELETE' });
  const body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.spells.length, before);
});

// ---- UI③ 批量法杖属性 ----------------------------------------------------------

test('PUT /api/wands/stats 批量:一次应用多根法杖', async () => {
  const wands = (await (await app.request('/api/wands')).json()).wands;
  const last = wands.length - 1;
  const res = await app.request('/api/wands/stats', JSON_REQ('PUT', {
    wands: [
      { index: 0, manaMax: '777' },
      { index: last, manaChargeSpeed: '55' },
    ],
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.ok(body.changed);
  assert.equal(body.wands[0].manaMax, '777');
  assert.equal(body.wands[last].manaChargeSpeed, '55');
});

test('PUT /api/wands/stats 批量:任一杖校验失败整体拒绝', async () => {
  const before = (await (await app.request('/api/wands')).json()).wands[0].manaMax;
  const res = await app.request('/api/wands/stats', JSON_REQ('PUT', {
    wands: [
      { index: 0, manaMax: '999' },           // 合法
      { index: 0, gunLevel: 'not-a-number' }, // 非法数值
      { index: 99, manaMax: '1' },            // 越界索引
    ],
  }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(Array.isArray(body.details));
  assert.equal(body.details.length, 2);

  const after = (await (await app.request('/api/wands')).json()).wands[0].manaMax;
  assert.equal(after, before, '合法的杖 0 也不应被写入(整体拒绝、无部分成功)');
});

test('PUT /api/wands/stats 批量:版本不一致返回 409', async () => {
  const res = await app.request('/api/wands/stats',
    JSON_REQ('PUT', { version: 999999, wands: [{ index: 0, manaMax: '1' }] }));
  assert.equal(res.status, 409);
});
