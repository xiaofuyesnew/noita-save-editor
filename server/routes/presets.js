// §20 预设路由:坐标 / 天赋 / 法杖三类的建/列/改标签/删。挂载于 /api(见 app.js)。
//
// 持久化走 services/presets.js;本文件负责把「当前存档缓冲」读成结构化预设:
//  - 坐标:直接收 {x,y}(来源是地图悬浮点或玩家当前位,前端给值);
//  - 天赋:perks 省略时抓当前缓冲里 kind==='effect' 的天赋(id+叠层数);
//  - 法杖:读第 index 支杖 → readWand 属性(WAND_ATTR_KEYS)+ listSpells 法术。
//
// 三类均不改存档缓冲(只读),故无 version 乐观锁、无 mutate 事务。
// 应用(传送/推暂存/载入编辑器)都在前端复用现有链完成,故无 apply 端点。

import { Hono } from 'hono';

import { saveManager } from '../services/saveManager.js';
import { presets } from '../services/presets.js';
import { wandAt, readWand } from '../model/wands.js';
import { listSpells } from '../model/spells.js';
import { listPerks } from '../model/perks.js';

export const presetRoutes = new Hono();

// 法杖预设存的属性键 —— 镜像前端 stores/wands.js 的 WAND_FORM_FIELDS
// (法杖编辑器可编辑的字段范围;载入即写回这些表单字段)。
const WAND_ATTR_KEYS = [
  'uiName', 'gunLevel', 'manaMax', 'mana', 'manaChargeSpeed', 'deckCapacity',
  'reloadTime', 'fireRateWait', 'actionsPerRound', 'spreadDegrees',
  'speedMultiplier', 'spriteFile', 'shuffleDeckWhenEmpty',
];

function playerTree() {
  const tree = saveManager.getTree('player.xml');
  if (!tree) throw Object.assign(new Error('未找到 player.xml'), { status: 404 });
  return tree;
}

function worldTree() {
  const tree = saveManager.getTree('world_state.xml');
  if (!tree) throw Object.assign(new Error('未找到 world_state.xml'), { status: 404 });
  return tree;
}

async function readBody(c) {
  return c.req.json().catch(() => ({}));
}

function fail(c, e) {
  return c.json({ ok: false, error: String(e.message || e) }, e.status || 400);
}

function requireLabel(body) {
  const label = String(body?.label ?? '').trim();
  if (!label) throw new Error('预设名称不能为空');
  return label;
}

const tagsOf = (body) => (Array.isArray(body?.tags) ? body.tags.map(String) : []);

// ---- 读取全部 --------------------------------------------------------------

presetRoutes.get('/presets', (c) => c.json(presets.all()));

// ---- 导出 / 导入(跨客户端传递) ---------------------------------------------
// 导出:全量三类 + 格式头,前端存成 .json 文件;导入:合并(内容去重、重发 id)。

const EXPORT_FORMAT = 'noita-save-editor-presets';

presetRoutes.get('/presets/export', (c) => {
  const body = JSON.stringify({ format: EXPORT_FORMAT, version: 1, ...presets.all() }, null, 2);
  c.header('content-type', 'application/json; charset=utf-8');
  c.header('content-disposition', 'attachment; filename="noita-presets.json"');
  return c.body(body);
});

presetRoutes.post('/presets/import', async (c) => {
  try {
    const body = await readBody(c);
    if (body?.format !== EXPORT_FORMAT) {
      throw new Error('不是本编辑器导出的预设文件(缺少格式标识)');
    }
    const result = presets.importData(body);
    return c.json({ ok: true, ...result, ...presets.all() });
  } catch (e) {
    return fail(c, e);
  }
});

// ---- 新建:坐标 ------------------------------------------------------------

presetRoutes.post('/presets/locations', async (c) => {
  try {
    const body = await readBody(c);
    const label = requireLabel(body);
    const x = Number(body?.x);
    const y = Number(body?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('坐标 x/y 必须是数值');
    const entry = presets.create('locations', { label, tags: tagsOf(body), x: String(x), y: String(y) });
    return c.json({ ok: true, preset: entry });
  } catch (e) {
    return fail(c, e);
  }
});

// ---- 新建:天赋组(perks 省略则抓当前 effect 天赋) --------------------------

presetRoutes.post('/presets/perks', async (c) => {
  try {
    const body = await readBody(c);
    const label = requireLabel(body);
    let perks;
    if (Array.isArray(body?.perks)) {
      perks = body.perks
        .filter((p) => p && p.id)
        .map((p) => ({ id: String(p.id), count: Number(p.count) > 0 ? Number(p.count) : 1 }));
    } else {
      // 抓当前缓冲里 kind==='effect' 的天赋(complex 型不可注入,不入预设)
      perks = listPerks(playerTree(), worldTree())
        .filter((p) => p.kind === 'effect')
        .map((p) => ({ id: p.id, count: Number(p.count) > 0 ? Number(p.count) : 1 }));
    }
    const entry = presets.create('perks', { label, tags: tagsOf(body), perks });
    return c.json({ ok: true, preset: entry });
  } catch (e) {
    return fail(c, e);
  }
});

// ---- 新建:法杖(读第 index 支杖为结构化) ----------------------------------

presetRoutes.post('/presets/wands', async (c) => {
  try {
    const body = await readBody(c);
    const label = requireLabel(body);
    const wand = wandAt(playerTree(), body?.index);
    const full = readWand(wand, Number(body.index));
    const attrs = {};
    for (const k of WAND_ATTR_KEYS) attrs[k] = full[k];
    const spells = listSpells(wand).map((s) => ({
      actionId: s.actionId,
      slot: s.slot,
      usesRemaining: s.usesRemaining,
      alwaysCast: s.alwaysCast,
    }));
    const summary = { uiName: full.uiName, spellCount: spells.length, gunLevel: full.gunLevel };
    const entry = presets.create('wands', { label, tags: tagsOf(body), summary, attrs, spells });
    return c.json({ ok: true, preset: entry });
  } catch (e) {
    return fail(c, e);
  }
});

// ---- 改标签 / 删除(三类同构) ---------------------------------------------

presetRoutes.put('/presets/:cat/:id', async (c) => {
  try {
    const body = await readBody(c);
    const entry = presets.update(c.req.param('cat'), c.req.param('id'), body);
    return c.json({ ok: true, preset: entry });
  } catch (e) {
    return fail(c, e);
  }
});

presetRoutes.delete('/presets/:cat/:id', (c) => {
  try {
    return c.json({ ok: true, ...presets.remove(c.req.param('cat'), c.req.param('id')) });
  } catch (e) {
    return fail(c, e);
  }
});
