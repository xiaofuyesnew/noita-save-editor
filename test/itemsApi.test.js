// 物品栏道具 API 集成测试 —— fetch 驱动 Hono app,只改内存缓冲不落盘。

import test from 'node:test';
import assert from 'node:assert/strict';

import { app } from '../server/index.js';

const JSON_REQ = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('GET /api/items/catalog', async () => {
  const res = await app.request('/api/items/catalog');
  assert.equal(res.status, 200);
  const { catalog } = await res.json();
  assert.ok(catalog.length >= 10);
  assert.ok(catalog.some((x) => x.id === 'evil_eye'));
  assert.ok(catalog.some((x) => x.id === 'potion' && x.group === 'container'));
  assert.ok(catalog.every((x) => x.entity === undefined), '目录视图不应带 entity');
});

test('物品栏:列出 → 补入邪王真眼 → 移除(capacity/freeSlots 随动)', async () => {
  let res = await app.request('/api/items');
  assert.equal(res.status, 200);
  let { items, version, capacity, freeSlots } = await res.json();
  assert.equal(capacity, 4);
  assert.ok(Number.isInteger(freeSlots) && freeSlots >= 0 && freeSlots <= capacity);

  // 快照道具行已满时:先验证服务端拒绝(UI 禁用的后端兜底),再腾一格
  if (freeSlots === 0) {
    res = await app.request('/api/items', JSON_REQ('POST', { id: 'evil_eye', version }));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /已满/);
    res = await app.request('/api/items/0', { method: 'DELETE' });
    assert.equal(res.status, 200);
    ({ items, version, capacity, freeSlots } = await (await app.request('/api/items')).json());
    assert.ok(freeSlots > 0);
  }
  const before = items.length;

  // 补入邪王真眼
  res = await app.request('/api/items', JSON_REQ('POST', { id: 'evil_eye', version }));
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.item.itemName, '$item_evil_eye');
  assert.equal(body.items.length, before + 1);
  assert.equal(body.freeSlots, freeSlots - 1);
  const addedIndex = body.item.index;

  // 移除刚补入的道具
  res = await app.request(`/api/items/${addedIndex}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.removed.itemName, '$item_evil_eye');
  assert.equal(body.items.length, before);
  assert.equal(body.freeSlots, freeSlots);
});

test('物品栏:版本不一致 → 409', async () => {
  const res = await app.request('/api/items', JSON_REQ('POST', { id: 'moon', version: 999999 }));
  assert.equal(res.status, 409);
});

test('物品栏:未知目录 id → 400', async () => {
  const res = await app.request('/api/items', JSON_REQ('POST', { id: 'not_a_real_item' }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /未知道具 id/);
});

test('物品栏:注入空药水 → 编辑材料 → 删除(统一/容器双索引空间)', async () => {
  let { version, freeSlots } = await (await app.request('/api/items')).json();
  if (freeSlots === 0) {
    await app.request('/api/items/0', { method: 'DELETE' });
    ({ version, freeSlots } = await (await app.request('/api/items')).json());
  }
  const potionsBefore = (await (await app.request('/api/items/potions')).json()).potions.length;

  // 注入空瓶
  let res = await app.request('/api/items', JSON_REQ('POST', { id: 'potion', version }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.item.isContainer, true);
  assert.deepEqual(body.item.materials, [], '新注入的药水应是空瓶');
  const { index, containerIndex } = body.item;

  // 容器索引空间可见新容器
  const { potions, version: v2 } = await (await app.request('/api/items/potions')).json();
  assert.equal(potions.length, potionsBefore + 1);

  // 编辑材料走容器索引
  res = await app.request(`/api/items/potions/${containerIndex}`, JSON_REQ('PUT', {
    version: v2,
    materials: [{ material: 'water', count: '500' }],
  }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).container.materials[0].material, 'water');

  // 删除走统一道具索引,容器索引空间随之收缩
  res = await app.request(`/api/items/${index}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal(
    (await (await app.request('/api/items/potions')).json()).potions.length,
    potionsBefore);
});

test('物品栏:换槽(移到空槽 / 越界 400 / 版本不一致 409)', async () => {
  let res = await app.request('/api/items/0/slot', JSON_REQ('PUT', { slot: 0, version: 999999 }));
  assert.equal(res.status, 409);

  let { items, version, freeSlots } = await (await app.request('/api/items')).json();
  if (freeSlots === 0) {
    await app.request('/api/items/0', { method: 'DELETE' });
    ({ items, version, freeSlots } = await (await app.request('/api/items')).json());
  }
  const it = items[0];
  const occupied = new Set(items.map((i) => Number(i.slot)));
  const free = [0, 1, 2, 3].find((s) => !occupied.has(s));

  res = await app.request(`/api/items/${it.index}/slot`, JSON_REQ('PUT', { slot: free, version }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.equal(String(body.items[it.index].slot), String(free));

  res = await app.request(`/api/items/${it.index}/slot`, JSON_REQ('PUT', { slot: 9 }));
  assert.equal(res.status, 400);
});
