// 功能③ API 集成测试:GET/PUT /api/config/paths。
// 注意:操作的是 saveManager 单例,切换路径的用例在 finally 里恢复原路径
// 并删除 config.local.json,避免污染其他测试与本机配置。

import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { app } from '../server/index.js';
import { localConfigPath } from '../server/config.js';

// 本机可能已有用户自己的 config.local.json:先记内容,测试结束恢复原状
const originalLocalConfig = existsSync(localConfigPath)
  ? readFileSync(localConfigPath, 'utf8')
  : null;

function restoreLocalConfig() {
  if (originalLocalConfig === null) rmSync(localConfigPath, { force: true });
  else writeFileSync(localConfigPath, originalLocalConfig, 'utf8');
}

const JSON_REQ = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('GET /api/config/paths 返回当前双路径', async () => {
  const res = await app.request('/api/config/paths');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.saveDir, 'string');
  assert.equal(typeof body.liveDir, 'string');
});

test('PUT: 空 body 无变化,不写 config.local.json', async () => {
  const res = await app.request('/api/config/paths', JSON_REQ('PUT', {}));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.changed, false);
  if (originalLocalConfig === null) {
    assert.ok(!existsSync(localConfigPath), '未变化不应写 config.local.json');
  }
});

test('PUT: 目录不存在 / 缺 player.xml → 400', async () => {
  let res = await app.request('/api/config/paths',
    JSON_REQ('PUT', { saveDir: 'Z:\\definitely\\not\\here' }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /不存在/);

  const empty = mkdtempSync(join(tmpdir(), 'noita-empty-'));
  try {
    res = await app.request('/api/config/paths', JSON_REQ('PUT', { saveDir: empty }));
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /player\.xml/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('PUT: 脏缓冲需 force;切换后重新读盘并持久化', async () => {
  const original = await (await app.request('/api/config/paths')).json();

  // 造一个最小有效 save00(player.xml + world_state.xml)
  const alt = mkdtempSync(join(tmpdir(), 'noita-alt-'));
  mkdirSync(alt, { recursive: true });
  cpSync(join(original.saveDir, 'player.xml'), join(alt, 'player.xml'));
  cpSync(join(original.saveDir, 'world_state.xml'), join(alt, 'world_state.xml'));

  try {
    // 弄脏缓冲
    let res = await app.request('/api/player/basics',
      JSON_REQ('PUT', { money: '4321' }));
    assert.equal(res.status, 200);

    // 不带 force → 409 + requiresForce
    res = await app.request('/api/config/paths', JSON_REQ('PUT', { saveDir: alt }));
    assert.equal(res.status, 409);
    let body = await res.json();
    assert.equal(body.requiresForce, true);

    // force → 切换成功,缓冲已丢弃重读
    res = await app.request('/api/config/paths',
      JSON_REQ('PUT', { saveDir: alt, force: true }));
    assert.equal(res.status, 200);
    body = await res.json();
    assert.ok(body.ok);
    assert.equal(body.saveDir, alt);
    assert.equal(body.status.dirty, false, '切换路径应丢弃缓冲');
    assert.ok(existsSync(localConfigPath), '变更应持久化到 config.local.json');

    // 新目录下的 player.xml 可正常使用
    res = await app.request('/api/wands');
    assert.equal(res.status, 200);
    assert.ok((await res.json()).wands.length >= 1);
  } finally {
    // 恢复原路径 + 还原本机 config.local.json + 清理临时目录
    await app.request('/api/config/paths',
      JSON_REQ('PUT', { saveDir: original.saveDir, liveDir: original.liveDir, force: true }));
    restoreLocalConfig();
    rmSync(alt, { recursive: true, force: true });
  }
});
