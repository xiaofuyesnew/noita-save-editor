// M3 路由:特殊效果 + 天赋。挂载于 /api(见 index.js)。
// 天赋操作同时改 player.xml 与 world_state.xml,分别标记 dirty。

import { Hono } from 'hono';

import { saveManager } from '../services/saveManager.js';
import { listEffects, addEffect, removeEffect } from '../model/effects.js';
import { listPerks, addPerk, removePerk } from '../model/perks.js';

export const effectRoutes = new Hono();

function handler(fn, { needWorld = false } = {}) {
  return async (c) => {
    const playerTree = saveManager.getTree('player.xml');
    if (!playerTree) return c.json({ ok: false, error: '未找到 player.xml' }, 404);
    const worldTree = saveManager.getTree('world_state.xml');
    if (needWorld && !worldTree) {
      return c.json({ ok: false, error: '未找到 world_state.xml' }, 404);
    }

    const isWrite = c.req.method === 'POST' || c.req.method === 'PUT' || c.req.method === 'DELETE';
    let body;
    if (c.req.method === 'POST' || c.req.method === 'PUT') {
      body = await c.req.json().catch(() => ({}));
    }
    const version = body?.version ?? c.req.query('v');
    if (version !== undefined && Number(version) !== saveManager.version) {
      return c.json({
        ok: false,
        error: `版本不一致(客户端 ${version},服务端 ${saveManager.version}),请刷新后重试`,
      }, 409);
    }

    try {
      // 天赋三件套跨 player.xml + world_state.xml,写操作整体事务化:
      // 任一文件改到一半抛错则两棵树一起回滚,不留孤儿实体/旗标。
      if (isWrite) {
        return saveManager.mutate(['player.xml', 'world_state.xml'],
          () => fn(c, { playerTree, worldTree, body }));
      }
      return await fn(c, { playerTree, worldTree, body });
    } catch (e) {
      return c.json({ ok: false, error: String(e.message || e) }, 400);
    }
  };
}

// ---- 特殊效果 -------------------------------------------------------------------

effectRoutes.get('/player/effects', handler((c, { playerTree }) =>
  c.json({ version: saveManager.version, effects: listEffects(playerTree) })));

effectRoutes.post('/player/effects', handler((c, { playerTree, body }) => {
  const effect = addEffect(playerTree, body);
  saveManager.markDirty('player.xml');
  return c.json({ ok: true, effect, effects: listEffects(playerTree) });
}));

effectRoutes.delete('/player/effects/:idx', handler((c, { playerTree }) => {
  const result = removeEffect(playerTree, c.req.param('idx'));
  saveManager.markDirty('player.xml');
  return c.json({ ok: true, ...result, effects: listEffects(playerTree) });
}));

// ---- 天赋 ----------------------------------------------------------------------

effectRoutes.get('/perks', handler((c, { playerTree, worldTree }) =>
  c.json({ version: saveManager.version, perks: listPerks(playerTree, worldTree) }),
  { needWorld: true }));

effectRoutes.post('/perks', handler((c, { playerTree, worldTree, body }) => {
  const perk = addPerk(playerTree, worldTree, body ?? {});
  saveManager.markDirty('player.xml');
  saveManager.markDirty('world_state.xml');
  return c.json({ ok: true, perk, perks: listPerks(playerTree, worldTree) });
}, { needWorld: true }));

effectRoutes.delete('/perks/:id', handler((c, { playerTree, worldTree }) => {
  const result = removePerk(playerTree, worldTree, c.req.param('id'));
  saveManager.markDirty('player.xml');
  saveManager.markDirty('world_state.xml');
  return c.json({ ok: true, ...result, perks: listPerks(playerTree, worldTree) });
}, { needWorld: true }));
