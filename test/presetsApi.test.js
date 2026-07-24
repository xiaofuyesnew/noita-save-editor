// §20 预设 API 集成测试 —— fetch 驱动 Hono app 操作内存缓冲 + presets.json。
// presets.json 落在 dataDir(测试=仓库根);仿 configApi.test.js:先记原内容,
// 结束(after 钩子)恢复原状,避免污染本机/其他测试。

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app } from '../server/index.js';
import { config } from '../server/config.js';

const presetsPath = join(config.dataDir, 'presets.json');
const original = existsSync(presetsPath) ? readFileSync(presetsPath, 'utf8') : null;

after(() => {
  if (original === null) rmSync(presetsPath, { force: true });
  else writeFileSync(presetsPath, original, 'utf8');
});

const JSON_REQ = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const getAll = async () => (await (await app.request('/api/presets')).json());

test('GET /api/presets 返回三类数组', async () => {
  const body = await getAll();
  assert.ok(Array.isArray(body.locations));
  assert.ok(Array.isArray(body.perks));
  assert.ok(Array.isArray(body.wands));
});

test('坐标预设:建/列/改标签/删', async () => {
  let res = await app.request('/api/presets/locations',
    JSON_REQ('POST', { label: '月亮', tags: ['传送'], x: 284.8, y: -26105 }));
  assert.equal(res.status, 200);
  const { preset } = await res.json();
  assert.ok(preset.id);
  assert.equal(preset.label, '月亮');
  assert.deepEqual(preset.tags, ['传送']);
  assert.equal(preset.x, '284.8');
  assert.equal(preset.y, '-26105');

  // 出现在列表
  assert.ok((await getAll()).locations.some((p) => p.id === preset.id));

  // 改标签 + 坐标
  res = await app.request(`/api/presets/locations/${preset.id}`,
    JSON_REQ('PUT', { label: '月球基地', x: 1, y: 2 }));
  assert.equal(res.status, 200);
  const updated = (await res.json()).preset;
  assert.equal(updated.label, '月球基地');
  assert.equal(updated.x, '1');
  assert.equal(updated.y, '2');

  // 删除
  res = await app.request(`/api/presets/locations/${preset.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.ok(!(await getAll()).locations.some((p) => p.id === preset.id));
});

test('坐标预设:缺名称 / 坐标非数值 → 400', async () => {
  let res = await app.request('/api/presets/locations', JSON_REQ('POST', { x: 1, y: 2 }));
  assert.equal(res.status, 400);
  res = await app.request('/api/presets/locations', JSON_REQ('POST', { label: 'x', x: 'NaN', y: 2 }));
  assert.equal(res.status, 400);
});

test('法杖预设:读第 0 支杖为结构化(属性 + 法术往返一致)', async () => {
  const wand0 = (await (await app.request('/api/wands')).json()).wands[0];

  const res = await app.request('/api/presets/wands',
    JSON_REQ('POST', { label: '起手杖', index: 0 }));
  assert.equal(res.status, 200);
  const { preset } = await res.json();

  // 属性覆盖 WAND_ATTR_KEYS,值与 readWand 一致
  for (const k of ['uiName', 'manaMax', 'deckCapacity', 'spriteFile', 'shuffleDeckWhenEmpty']) {
    assert.equal(preset.attrs[k], wand0[k], `attrs.${k} 应与法杖一致`);
  }
  // 法术数组与 listSpells 的四字段一致
  assert.equal(preset.spells.length, wand0.spells.length);
  preset.spells.forEach((s, i) => {
    assert.equal(s.actionId, wand0.spells[i].actionId);
    assert.equal(s.slot, wand0.spells[i].slot);
    assert.equal(s.usesRemaining, wand0.spells[i].usesRemaining);
    assert.equal(s.alwaysCast, wand0.spells[i].alwaysCast);
  });
  assert.equal(preset.summary.spellCount, wand0.spells.length);
  assert.equal(preset.summary.uiName, wand0.uiName);

  await app.request(`/api/presets/wands/${preset.id}`, { method: 'DELETE' });
});

test('法杖预设:索引越界 → 400', async () => {
  const res = await app.request('/api/presets/wands',
    JSON_REQ('POST', { label: 'x', index: 999 }));
  assert.equal(res.status, 400);
});

test('天赋预设:显式 perks 原样存;省略则抓当前 effect 天赋', async () => {
  // 显式
  let res = await app.request('/api/presets/perks',
    JSON_REQ('POST', { label: '手动组', perks: [{ id: 'PROTECTION_FIRE', count: 2 }] }));
  assert.equal(res.status, 200);
  let preset = (await res.json()).preset;
  assert.deepEqual(preset.perks, [{ id: 'PROTECTION_FIRE', count: 2 }]);
  await app.request(`/api/presets/perks/${preset.id}`, { method: 'DELETE' });

  // 省略 → 抓当前缓冲 effect 天赋(夹具可能为空,断言结构即可)
  res = await app.request('/api/presets/perks', JSON_REQ('POST', { label: '当前组' }));
  assert.equal(res.status, 200);
  preset = (await res.json()).preset;
  assert.ok(Array.isArray(preset.perks));
  for (const p of preset.perks) {
    assert.equal(typeof p.id, 'string');
    assert.ok(Number.isFinite(p.count) && p.count > 0);
  }
  await app.request(`/api/presets/perks/${preset.id}`, { method: 'DELETE' });
});

test('未知分类 / 不存在的 id → 400', async () => {
  let res = await app.request('/api/presets/nope/xxx', JSON_REQ('PUT', { label: 'a' }));
  assert.equal(res.status, 400);
  res = await app.request('/api/presets/locations/does-not-exist', { method: 'DELETE' });
  assert.equal(res.status, 400);
});

test('导出:带格式头的全量 JSON,可作为导入输入', async () => {
  const res = await app.request('/api/presets/export');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment/);
  const body = await res.json();
  assert.equal(body.format, 'noita-save-editor-presets');
  assert.equal(body.version, 1);
  assert.ok(Array.isArray(body.locations));
});

test('导入:合并 + 内容去重 + 重发 id;缺格式头 → 400', async () => {
  const file = {
    format: 'noita-save-editor-presets',
    version: 1,
    locations: [{ id: 'ext-1', label: '外部点', tags: ['来自朋友'], x: '10', y: '20' }],
    perks: [],
    wands: [],
  };

  let res = await app.request('/api/presets/import', JSON_REQ('POST', file));
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.imported.locations, 1);
  const entry = body.locations.find((p) => p.label === '外部点');
  assert.ok(entry);
  assert.notEqual(entry.id, 'ext-1'); // 重发 id

  // 同一份再导入 → 全部按内容指纹跳过
  res = await app.request('/api/presets/import', JSON_REQ('POST', file));
  body = await res.json();
  assert.equal(body.imported.locations, 0);
  assert.equal(body.skipped, 1);
  assert.equal(body.locations.filter((p) => p.label === '外部点').length, 1);

  await app.request(`/api/presets/locations/${entry.id}`, { method: 'DELETE' });

  // 缺格式头
  res = await app.request('/api/presets/import', JSON_REQ('POST', { locations: [] }));
  assert.equal(res.status, 400);
});
