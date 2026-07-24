// M4 路由:药水材料 / 世界状态 / 进度解锁 / 遗骨法杖。挂载于 /api(见 index.js)。
//
// 前三类沿用编辑缓冲模型(改内存树 + markDirty,【写入存档】才落盘);
// 进度解锁是 persistent/flags/ 的文件存在性开关,直接写工作区快照文件系统
// (精确可逆),不经过缓冲 —— 响应与 UI 均对此显式说明。

import { Hono } from 'hono';
import { join } from 'node:path';

import { saveManager } from '../services/saveManager.js';
import { listContainers, applyContainerMaterials } from '../model/potions.js';
import {
  listItems, addItem, removeItem, moveItemSlot, listCatalog, freeItemSlots, ITEM_SLOTS,
} from '../model/items.js';
import { readWorldState, applyWorldState } from '../model/worldState.js';
import { listUnlocks, applyUnlocks } from '../model/unlocks.js';
import { listBones, importBones } from '../model/bones.js';

export const extraRoutes = new Hono();

const flagsDir = () => join(saveManager.saveDir, 'persistent', 'flags');
const bonesDir = () => join(saveManager.saveDir, 'persistent', 'bones_new');

// 统一:按需取树 + 版本乐观校验 + 错误包装 + 写操作事务化(同 effects.js 模式)
function handler(fn, { player = false, world = false } = {}) {
  return async (c) => {
    const trees = {};
    if (player) {
      trees.playerTree = saveManager.getTree('player.xml');
      if (!trees.playerTree) return c.json({ ok: false, error: '未找到 player.xml' }, 404);
    }
    if (world) {
      trees.worldTree = saveManager.getTree('world_state.xml');
      if (!trees.worldTree) return c.json({ ok: false, error: '未找到 world_state.xml' }, 404);
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
      // 涉及内存树的写操作事务化(unlocks 直写文件系统、无树,files 为空即无快照)
      const files = [];
      if (player) files.push('player.xml');
      if (world) files.push('world_state.xml');
      if (isWrite && files.length > 0) {
        return saveManager.mutate(files, () => fn(c, { ...trees, body }));
      }
      return await fn(c, { ...trees, body });
    } catch (e) {
      return c.json({ ok: false, error: String(e.message || e) }, 400);
    }
  };
}

// ---- 药水/材料容器 -------------------------------------------------------------

extraRoutes.get('/items/potions', handler((c, { playerTree }) =>
  c.json({ version: saveManager.version, potions: listContainers(playerTree) }),
  { player: true }));

extraRoutes.put('/items/potions/:i', handler((c, { playerTree, body }) => {
  const result = applyContainerMaterials(playerTree, c.req.param('i'), body?.materials);
  saveManager.markDirty('player.xml');
  return c.json({ ok: true, ...result });
}, { player: true }));

// ---- 物品栏道具(邪王真眼 / 法术石 / 骰子等宝藏道具) -----------------------------

// 道具目录(静态,不校验版本):供 UI 选择器列出可注入的道具
extraRoutes.get('/items/catalog', (c) => c.json({ catalog: listCatalog() }));

extraRoutes.get('/items', handler((c, { playerTree }) =>
  c.json({
    version: saveManager.version,
    capacity: ITEM_SLOTS,
    freeSlots: freeItemSlots(playerTree),
    items: listItems(playerTree),
  }),
  { player: true }));

extraRoutes.post('/items', handler((c, { playerTree, body }) => {
  const result = addItem(playerTree, body?.id, { slot: body?.slot });
  saveManager.markDirty('player.xml');
  return c.json({
    ok: true,
    ...result,
    capacity: ITEM_SLOTS,
    freeSlots: freeItemSlots(playerTree),
    items: listItems(playerTree),
  });
}, { player: true }));

extraRoutes.delete('/items/:i', handler((c, { playerTree }) => {
  const result = removeItem(playerTree, c.req.param('i'));
  saveManager.markDirty('player.xml');
  return c.json({
    ok: true,
    ...result,
    capacity: ITEM_SLOTS,
    freeSlots: freeItemSlots(playerTree),
    items: listItems(playerTree),
  });
}, { player: true }));

// 道具换槽(拖拽换位):目标槽被占用时与占用者交换
extraRoutes.put('/items/:i/slot', handler((c, { playerTree, body }) => {
  const result = moveItemSlot(playerTree, c.req.param('i'), body?.slot);
  if (result.changed) saveManager.markDirty('player.xml');
  return c.json({
    ok: true,
    ...result,
    capacity: ITEM_SLOTS,
    freeSlots: freeItemSlots(playerTree),
    items: listItems(playerTree),
  });
}, { player: true }));

// ---- 世界状态 ------------------------------------------------------------------

extraRoutes.get('/world/state', handler((c, { worldTree }) =>
  c.json({ version: saveManager.version, ...readWorldState(worldTree) }),
  { world: true }));

extraRoutes.put('/world/state', handler((c, { worldTree, body }) => {
  const result = applyWorldState(worldTree, body ?? {});
  if (result.changed) saveManager.markDirty('world_state.xml');
  return c.json({ ok: true, ...result, state: readWorldState(worldTree) });
}, { world: true }));

// ---- 进度解锁(persistent/flags 文件开关,立即生效) ------------------------------

extraRoutes.get('/persistent/unlocks', handler((c) =>
  c.json({
    version: saveManager.version,
    flagsDir: flagsDir(),
    unlocks: listUnlocks(flagsDir()),
  })));

extraRoutes.put('/persistent/unlocks', handler((c, { body }) => {
  const result = applyUnlocks(flagsDir(), body?.changes);
  return c.json({
    ok: true,
    ...result,
    note: '旗标为文件开关,已直接写入工作区快照(不经过【写入存档】)',
    unlocks: listUnlocks(flagsDir()),
  });
}));

// ---- 遗骨法杖 ------------------------------------------------------------------

extraRoutes.get('/bones', handler((c) =>
  c.json({ version: saveManager.version, bones: listBones(bonesDir()) })));

extraRoutes.post('/wands/import-bones/:file', handler((c, { playerTree, body }) => {
  const result = importBones(playerTree, bonesDir(), c.req.param('file'), {
    slot: body?.slot,
  });
  saveManager.markDirty('player.xml');
  return c.json({ ok: true, ...result });
}, { player: true }));
