// M2 路由:法杖/法术/背包法术/字典。挂载于 /api(见 index.js)。
//
// 法杖标识 = 当前树内索引;所有修改端点支持传 version(body 或 ?v=)做
// 乐观校验 —— 与 saveManager.version 不符返回 409,防止写盘/重载后索引漂移。

import { Hono } from 'hono';

import { saveManager } from '../services/saveManager.js';
import { getDict } from '../services/dict.js';
import {
  listWands,
  readWand,
  wandAt,
  fullInventory,
  fullInventoryCapacity,
  applyWandStats,
  applyWandStatsBatch,
} from '../model/wands.js';
import {
  listSpells,
  addSpell,
  updateSpell,
  removeSpell,
  reorderSpells,
} from '../model/spells.js';

export const wandRoutes = new Hono();

// 统一:取 player 树 + 错误包装 + 版本乐观校验
function handler(fn) {
  return async (c) => {
    const tree = saveManager.getTree('player.xml');
    if (!tree) return c.json({ ok: false, error: '未找到 player.xml' }, 404);

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
      return await fn(c, tree, body);
    } catch (e) {
      const payload = { ok: false, error: String(e.message || e) };
      if (e.details) payload.details = e.details;
      return c.json(payload, 400);
    }
  };
}

function dirty() {
  saveManager.markDirty('player.xml');
}

// ---- 字典 -------------------------------------------------------------------

wandRoutes.get('/dict/:name', (c) => {
  try {
    return c.json(getDict(c.req.param('name')));
  } catch (e) {
    return c.json({ ok: false, error: String(e.message || e) }, 404);
  }
});

// ---- 法杖 -------------------------------------------------------------------

wandRoutes.get('/wands', handler((c, tree) => c.json({
  version: saveManager.version,
  wands: listWands(tree).map((w) => ({
    ...w,
    spells: listSpells(wandAt(tree, w.index)),
  })),
})));

// 批量写法杖属性(UI③):一次事务应用全部 patch,任一杖校验失败整体拒绝并
// 返回逐杖错误(details)。必须先于 /wands/:i/stats 注册。
wandRoutes.put('/wands/stats', handler((c, tree, body) => {
  const result = applyWandStatsBatch(tree, body?.wands);
  if (result.changed) dirty();
  return c.json({
    ok: true,
    ...result,
    wands: listWands(tree).map((w) => ({
      ...w,
      spells: listSpells(wandAt(tree, w.index)),
    })),
  });
}));

wandRoutes.put('/wands/:i/stats', handler((c, tree, body) => {
  const i = c.req.param('i');
  const result = applyWandStats(tree, i, body);
  if (result.changed) dirty();
  return c.json({ ok: true, ...result, wand: readWand(wandAt(tree, i), Number(i)) });
}));

// ---- 杖内法术 ----------------------------------------------------------------

wandRoutes.get('/wands/:i/spells', handler((c, tree) =>
  c.json({ version: saveManager.version, spells: listSpells(wandAt(tree, c.req.param('i'))) })));

wandRoutes.post('/wands/:i/spells', handler((c, tree, body) => {
  const wand = wandAt(tree, c.req.param('i'));
  const capacity = Number(readWand(wand, 0).deckCapacity);
  const spell = addSpell(wand, body, { capacity: Number.isFinite(capacity) ? capacity : undefined });
  dirty();
  return c.json({ ok: true, spell, spells: listSpells(wand) });
}));

// 注意:/order 必须先于 /:idx 注册
wandRoutes.put('/wands/:i/spells/order', handler((c, tree, body) => {
  const wand = wandAt(tree, c.req.param('i'));
  const spells = reorderSpells(wand, body?.order);
  dirty();
  return c.json({ ok: true, spells });
}));

wandRoutes.put('/wands/:i/spells/:idx', handler((c, tree, body) => {
  const wand = wandAt(tree, c.req.param('i'));
  const spell = updateSpell(wand, c.req.param('idx'), body);
  dirty();
  return c.json({ ok: true, spell, spells: listSpells(wand) });
}));

wandRoutes.delete('/wands/:i/spells/:idx', handler((c, tree) => {
  const wand = wandAt(tree, c.req.param('i'));
  const result = removeSpell(wand, c.req.param('idx'));
  dirty();
  return c.json({ ok: true, ...result, spells: listSpells(wand) });
}));

// ---- 背包散装法术 -------------------------------------------------------------

wandRoutes.get('/inventory/spells', handler((c, tree) => c.json({
  version: saveManager.version,
  capacity: fullInventoryCapacity(tree),
  spells: listSpells(fullInventory(tree)),
})));

wandRoutes.post('/inventory/spells', handler((c, tree, body) => {
  const inv = fullInventory(tree);
  const spell = addSpell(inv, body, { capacity: fullInventoryCapacity(tree) });
  dirty();
  return c.json({ ok: true, spell, spells: listSpells(inv) });
}));

wandRoutes.put('/inventory/spells/order', handler((c, tree, body) => {
  const spells = reorderSpells(fullInventory(tree), body?.order);
  dirty();
  return c.json({ ok: true, spells });
}));

wandRoutes.put('/inventory/spells/:idx', handler((c, tree, body) => {
  const inv = fullInventory(tree);
  const spell = updateSpell(inv, c.req.param('idx'), body);
  dirty();
  return c.json({ ok: true, spell, spells: listSpells(inv) });
}));

wandRoutes.delete('/inventory/spells/:idx', handler((c, tree) => {
  const inv = fullInventory(tree);
  const result = removeSpell(inv, c.req.param('idx'));
  dirty();
  return c.json({ ok: true, ...result, spells: listSpells(inv) });
}));
