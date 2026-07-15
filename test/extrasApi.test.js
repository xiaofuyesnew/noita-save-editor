// M4 API 集成测试 —— fetch 驱动 Hono app,XML 类操作只改内存缓冲不落盘。
// 进度解锁是真实文件开关,这里只测只读列表与校验失败路径(不动 save00);
// 完整读写覆盖在 extras.test.js 用临时目录完成。

import test from 'node:test';
import assert from 'node:assert/strict';

import { app } from '../server/index.js';

const JSON_REQ = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('GET /api/dict/materials', async () => {
  const res = await app.request('/api/dict/materials');
  assert.equal(res.status, 200);
  const materials = await res.json();
  assert.ok(materials.length > 400);
  assert.ok(materials.some((m) => m.id === 'water'));
});

test('药水:列出与替换材料', async () => {
  let res = await app.request('/api/items/potions');
  assert.equal(res.status, 200);
  const { potions, version } = await res.json();
  assert.ok(Array.isArray(potions));

  if (potions.length === 0) {
    // 真实快照当前没有容器:替换请求应以「越界」拒绝
    res = await app.request('/api/items/potions/0', JSON_REQ('PUT', {
      version,
      materials: [{ material: 'lava', count: '500' }],
    }));
    assert.equal(res.status, 400);
    return;
  }

  res = await app.request('/api/items/potions/0', JSON_REQ('PUT', {
    version,
    materials: [{ material: 'lava', count: '500' }],
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.container.materials[0].material, 'lava');

  // 未知材料 → 400
  res = await app.request('/api/items/potions/0', JSON_REQ('PUT', {
    materials: [{ material: 'bogus_xx', count: '1' }],
  }));
  assert.equal(res.status, 400);
});

test('世界状态:读取与补丁', async () => {
  let res = await app.request('/api/world/state');
  assert.equal(res.status, 200);
  const state = await res.json();
  assert.match(state.fields.dayCount, /^\d+$/);
  assert.ok(Array.isArray(state.flags));

  res = await app.request('/api/world/state', JSON_REQ('PUT', {
    version: state.version,
    fields: { openFogOfWarEverywhere: '1' },
    changedMaterials: [{ from: 'water', to: 'magic_liquid_hp_regeneration' }],
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.state.fields.openFogOfWarEverywhere, '1');
  assert.deepEqual(body.state.changedMaterials,
    [{ from: 'water', to: 'magic_liquid_hp_regeneration' }]);

  // 未知字段 → 400
  res = await app.request('/api/world/state', JSON_REQ('PUT', { fields: { hax: '1' } }));
  assert.equal(res.status, 400);
});

test('进度解锁:列表与非法旗标校验(只读,不改 save00)', async () => {
  let res = await app.request('/api/persistent/unlocks');
  assert.equal(res.status, 200);
  const { unlocks } = await res.json();
  assert.ok(unlocks.length >= 37);
  const paint = unlocks.find((u) => u.flag === 'card_unlocked_paint');
  assert.equal(paint.unlocked, true); // 夹具已解锁
  assert.ok(paint.spells.length > 0);

  res = await app.request('/api/persistent/unlocks', JSON_REQ('PUT', {
    changes: { 'perk_picked_evil': true },
  }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /旗标名非法/);
});

test('遗骨法杖:列表 + 导入 + 版本冲突', async () => {
  let res = await app.request('/api/bones');
  assert.equal(res.status, 200);
  const { bones, version } = await res.json();
  assert.ok(bones.length >= 1, '夹具 bones_new 应至少有一根遗骨');
  assert.ok(bones[0].file);

  const wandsBefore = (await (await app.request('/api/wands')).json()).wands.length;

  // 版本不一致 → 409
  res = await app.request(`/api/wands/import-bones/${bones[0].file}`,
    JSON_REQ('POST', { version: version + 999 }));
  assert.equal(res.status, 409);

  // 正常导入(内存缓冲);真实快照快捷栏可能已满 → 满员拒绝
  res = await app.request(`/api/wands/import-bones/${bones[0].file}`,
    JSON_REQ('POST', { version }));
  if (wandsBefore >= 4) {
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /已满/);
  } else {
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    assert.ok(Number.isInteger(body.slot));

    // 导入后法杖列表 +1
    res = await app.request('/api/wands');
    const wands = (await res.json()).wands;
    assert.equal(wands.length, wandsBefore + 1);
  }

  // 非法文件名 → 400
  res = await app.request('/api/wands/import-bones/..%2Fplayer.xml', JSON_REQ('POST', {}));
  assert.equal(res.status, 400);
});
