import test from 'node:test';
import assert from 'node:assert/strict';

import { app } from '../server/index.js';

// Hono app 可直接用 fetch 驱动,无需监听端口。

test('GET /api/status returns shape', async () => {
  const res = await app.request('/api/status');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.gameRunning, 'boolean');
  assert.ok(Array.isArray(body.managedFiles));
});

test('GET /api/backups returns list', async () => {
  const res = await app.request('/api/backups');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.backups));
});

test('static index.html is served', async () => {
  const res = await app.request('/index.html');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Noita 存档编辑器/);
});

test('static files are served with no-store (本地应用取简单方案:全量 no-store)', async () => {
  // M8 后前端为 vite 构建产物(存在 frontend/dist 时托管之,否则回退旧 web/),
  // 两种形态下 index.html 都必须 no-store,防止升级后浏览器用旧入口。
  const res = await app.request('/index.html');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('GET /api/player/basics returns hp/money/version', async () => {
  const res = await app.request('/api/player/basics');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.hp && typeof body.hp.current === 'string');
  assert.equal(typeof body.money, 'string');
  assert.equal(typeof body.version, 'number');
});

test('PUT /api/player/basics validates and echoes back', async () => {
  const res = await app.request('/api/player/basics', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ money: '999' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok);
  assert.equal(body.basics.money, '999');
});

test('PUT /api/player/basics rejects non-numeric', async () => {
  const res = await app.request('/api/player/basics', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ money: 'nope' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
});

test('GET /api/player/damage-multipliers returns map', async () => {
  const res = await app.request('/api/player/damage-multipliers');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.explosion, 'string');
});

test('POST /api/player/invincibility toggles effect', async () => {
  const on = await app.request('/api/player/invincibility', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'effect', enable: true }),
  });
  assert.equal(on.status, 200);
  const body = await on.json();
  assert.ok(body.ok && body.state.effect);
  // 撤销,避免污染后续读取(注:测试间共享同一内存缓冲)
  await app.request('/api/player/invincibility', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'effect', enable: false }),
  });
});
