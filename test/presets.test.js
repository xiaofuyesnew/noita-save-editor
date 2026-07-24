// §20 预设服务单测 —— 用临时文件,不碰 dataDir。覆盖 load/原子写/CRUD/坏文件降级。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PresetStore } from '../server/services/presets.js';

function tempPath() {
  return join(mkdtempSync(join(tmpdir(), 'noita-presets-')), 'presets.json');
}

test('无文件时 all() 返回空三类结构', () => {
  const p = tempPath();
  try {
    const store = new PresetStore(p);
    assert.deepEqual(store.all(), { locations: [], perks: [], wands: [] });
  } finally {
    rmSync(join(p, '..'), { recursive: true, force: true });
  }
});

test('create 落盘(原子写),另一实例可读回', () => {
  const p = tempPath();
  try {
    const a = new PresetStore(p);
    const entry = a.create('locations', { label: '月亮', x: '1', y: '2' });
    assert.ok(entry.id);
    assert.ok(entry.createdAt);

    // 新实例从磁盘读回(证明 tmp→rename 生效)
    const b = new PresetStore(p);
    assert.equal(b.all().locations.length, 1);
    assert.equal(b.all().locations[0].label, '月亮');

    // 文件是合法 JSON
    JSON.parse(readFileSync(p, 'utf8'));
  } finally {
    rmSync(join(p, '..'), { recursive: true, force: true });
  }
});

test('update 改标签/坐标;remove 删除;缺失 id 抛错', () => {
  const p = tempPath();
  try {
    const store = new PresetStore(p);
    const e = store.create('locations', { label: 'a', x: '1', y: '2' });
    store.update('locations', e.id, { label: 'b', tags: ['x'], x: '9' });
    const got = store.all().locations[0];
    assert.equal(got.label, 'b');
    assert.deepEqual(got.tags, ['x']);
    assert.equal(got.x, '9');
    assert.equal(got.y, '2');

    store.remove('locations', e.id);
    assert.equal(store.all().locations.length, 0);
    assert.throws(() => store.remove('locations', e.id), /不存在/);
    assert.throws(() => store.update('locations', 'nope', { label: 'z' }), /不存在/);
  } finally {
    rmSync(join(p, '..'), { recursive: true, force: true });
  }
});

test('空名称拒绝;未知分类抛错', () => {
  const p = tempPath();
  try {
    const store = new PresetStore(p);
    assert.throws(() => store.create('wands', { label: '   ' }), /名称/);
    assert.throws(() => store.create('bogus', { label: 'a' }), /未知预设分类/);
  } finally {
    rmSync(join(p, '..'), { recursive: true, force: true });
  }
});

test('坏文件降级空;缺 id 的项补 UUID、坏项跳过', () => {
  const p = tempPath();
  try {
    // 坏 JSON → 空
    writeFileSync(p, '{ this is not json', 'utf8');
    assert.deepEqual(new PresetStore(p).all(), { locations: [], perks: [], wands: [] });

    // 合法但含坏项:非对象跳过,缺 id 补全,tags 规整
    writeFileSync(p, JSON.stringify({
      locations: [{ label: '无id', x: '1', y: '2' }, 42, null],
      perks: 'not-an-array',
    }), 'utf8');
    const store = new PresetStore(p);
    const locs = store.all().locations;
    assert.equal(locs.length, 1);
    assert.ok(locs[0].id, '缺 id 应补全');
    assert.deepEqual(locs[0].tags, []);
    assert.deepEqual(store.all().perks, []);
  } finally {
    rmSync(join(p, '..'), { recursive: true, force: true });
  }
});
