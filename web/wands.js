// M2 前端:法杖与法术页。由 app.js 注入 api/act 依赖并初始化。
//
// 交互模型:
//  - 每根法杖一张小卡:属性表单 + 法术槽格子条;表单不再各自提交,由 card
//    标题行的「应用到缓冲」统一批量提交(UI③,任一杖校验失败服务端整体拒绝);
//  - 空槽点击 → 法术选择器(搜索 + 类型过滤);
//  - 已占槽点击 → 编辑面板(次数 / Always Cast / 删除);
//  - 拖拽已占槽到其他槽 → 重排(服务端压缩槽位为 0..n-1);
//  - 背包(inventory_full)散装法术同一套格子交互;
//  - 所有写操作携带 version,409 时提示刷新。

let api, act;
let dictSpells = null;   // /api/dict/spells
let dictTypes = null;    // /api/dict/spell_types
let version = 0;

import { labelText, log, snapshotCard } from './ui.js';
import { t, dictName, getLang } from './i18n/index.js';

const $ = (id) => document.getElementById(id);
const JSON_REQ = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** 法术类型显示名:zh 用字典 nameZh,en 用 i18n 键(spell_types 字典无英文名)。 */
function typeLabel(type) {
  if (getLang() === 'zh') {
    return dictTypes?.find((x) => x.type === type)?.nameZh ?? type ?? '?';
  }
  return type ? t('spelltype.' + type) : '?';
}

export function initWands(deps) {
  api = deps.api;
  act = deps.act;
  $('spellSearch').oninput = renderPickerList;
  $('spellTypeFilter').onchange = renderPickerList;
  $('spellPickerClose').onclick = () => $('spellPicker').close();
  $('spellEditClose').onclick = () => $('spellEdit').close();
  $('btnSaveWands').onclick = onApplyAllWands;
  return loadWands({ preserveEdits: false });
}

async function ensureDicts() {
  if (dictSpells) return;
  dictSpells = await api('/dict/spells');
  dictTypes = await api('/dict/spell_types');
}

/** 类型过滤下拉随语言重建(保留当前选中值)。 */
function refreshTypeFilter() {
  const sel = $('spellTypeFilter');
  const selected = sel.value;
  // 第一个 option(全部类型)由 data-i18n 静态管理,只重建类型项
  while (sel.options.length > 1) sel.remove(1);
  for (const { type } of dictTypes) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = typeLabel(type);
    sel.append(opt);
  }
  sel.value = selected;
}

/**
 * 重新渲染法杖页。preserveEdits(默认 true):法术槽增删拖拽等"点击即写缓冲"
 * 的操作会整卡重渲染,渲染前暂存各杖表单里尚未应用的编辑、渲染后回填,
 * 避免被服务端值冲掉;丢弃缓冲类操作(重新读取/拉取/恢复备份)传 false。
 */
export async function loadWands({ preserveEdits = true } = {}) {
  await ensureDicts();
  refreshTypeFilter();
  const pending = preserveEdits ? collectPendingEdits() : null;

  const data = await api('/wands');
  version = data.version;
  const root = $('wandList');
  root.innerHTML = '';
  for (const w of data.wands) root.append(renderWand(w));

  const inv = await api('/inventory/spells');
  renderSlotStrip($('invSpells'), {
    capacity: Math.max(inv.capacity, inv.spells.length),
    spells: inv.spells,
    base: '/inventory/spells',
  });

  // 功能⑤: 先以服务端状态为基线拍快照,再回填未提交编辑(回填触发 input
  // 事件 → 星号亮起,提示仍有未应用的修改)
  snapshotCard($('wandCard'));
  restorePendingEdits(pending);
}

// ---- UI③: 未提交编辑的暂存与回填 -----------------------------------------------

function collectPendingEdits() {
  const edits = new Map();
  for (const input of $('wandList').querySelectorAll('input[data-field]')) {
    const cur = input.type === 'checkbox' ? (input.checked ? '1' : '0') : input.value;
    if (cur !== input.dataset.orig) {
      edits.set(`${input.closest('.wand').dataset.index}:${input.dataset.field}`, cur);
    }
  }
  return edits;
}

function restorePendingEdits(edits) {
  if (!edits || edits.size === 0) return;
  for (const input of $('wandList').querySelectorAll('input[data-field]')) {
    const key = `${input.closest('.wand').dataset.index}:${input.dataset.field}`;
    if (!edits.has(key)) continue;
    const v = edits.get(key);
    if (input.type === 'checkbox') input.checked = v === '1';
    else input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** UI③: 收集全部法杖表单的差异,一次批量提交(任一杖校验失败服务端整体拒绝)。 */
function onApplyAllWands() {
  const patches = [];
  for (const wandDiv of $('wandList').querySelectorAll('.wand')) {
    const patch = {};
    for (const input of wandDiv.querySelectorAll('input[data-field]')) {
      const cur = input.type === 'checkbox' ? (input.checked ? '1' : '0') : input.value;
      if (cur !== input.dataset.orig && cur !== '') patch[input.dataset.field] = cur;
    }
    if (Object.keys(patch).length > 0) {
      patches.push({ index: Number(wandDiv.dataset.index), ...patch });
    }
  }
  if (patches.length === 0) {
    log(t('log.noWandChanges'));
    return;
  }
  act(async () => {
    await api('/wands/stats', JSON_REQ('PUT', { version, wands: patches }));
    await loadWands();
  }, t('log.wandsApplied', { n: patches.length }));
}

// ---- 法杖卡片 ----------------------------------------------------------------

// 属性表单字段:[字段名, 控件类型 text|number|checkbox];文案键 wand.f.<字段名>[.tip]
const WAND_FORM = [
  ['uiName', 'text'],
  ['gunLevel', 'number'],
  ['manaMax', 'number'],
  ['mana', 'number'],
  ['manaChargeSpeed', 'number'],
  ['deckCapacity', 'number'],
  ['reloadTime', 'number'],
  ['fireRateWait', 'number'],
  ['actionsPerRound', 'number'],
  ['spreadDegrees', 'number'],
  ['speedMultiplier', 'number'],
  ['spriteFile', 'text'],
  ['shuffleDeckWhenEmpty', 'checkbox'],
];

function renderWand(w) {
  const div = document.createElement('div');
  div.className = 'wand';
  div.dataset.index = w.index;

  const head = document.createElement('h3');
  head.textContent = t('wand.head', { i: w.index, name: w.uiName || t('wand.unnamed') });
  const summary = document.createElement('span');
  summary.className = 'muted';
  summary.textContent = t('wand.summary', {
    slot: w.slot, mana: w.mana, manaMax: w.manaMax, cap: w.deckCapacity, n: w.spellCount,
  });
  head.append(summary);
  div.append(head);

  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const [field, kind] of WAND_FORM) {
    const lab = document.createElement('label');
    const input = document.createElement('input');
    input.dataset.field = field;
    const label = t(`wand.f.${field}`);
    const tip = t(`wand.f.${field}.tip`);
    if (kind === 'checkbox') {
      lab.className = 'check';
      input.type = 'checkbox';
      input.checked = Number(w[field]) !== 0;
      input.dataset.orig = input.checked ? '1' : '0';
      lab.append(input, labelText(label, tip));
    } else {
      input.type = kind;
      input.step = 'any';
      input.value = w[field] ?? '';
      input.dataset.orig = input.value;
      lab.append(labelText(label, tip), input);
    }
    grid.append(lab);
  }
  div.append(grid);

  const strip = document.createElement('div');
  renderSlotStrip(strip, {
    capacity: Number(w.deckCapacity),
    spells: w.spells,
    base: `/wands/${w.index}/spells`,
  });
  div.append(strip);
  return div;
}

// ---- 法术槽格子条 --------------------------------------------------------------

/** ctx = {capacity, spells, base};base 如 /wands/0/spells 或 /inventory/spells */
function renderSlotStrip(rootEl, ctx) {
  rootEl.innerHTML = '';
  rootEl.className = 'slots';
  // 真实存档可能出现重复槽位(多张卡同 slot,游戏自产数据):按槽位顺序放格,
  // 冲突的顺延到下一个空格显示。编辑/删除/重排按卡片文档序 idx 寻址,
  // 同槽卡互不影响、无需先重排;拖拽重排会把槽位规范化为 0..n-1。
  const sorted = [...ctx.spells].sort((a, b) => a.slot - b.slot);
  const cells = [];
  for (const s of sorted) cells[Math.max(s.slot, cells.length)] = s;
  const count = Math.max(ctx.capacity, cells.length, 0);

  for (let slot = 0; slot < count; slot++) {
    const spell = cells[slot];
    const cell = document.createElement('div');
    cell.dataset.slot = slot;
    if (spell) {
      cell.className = 'slot filled' + (spell.alwaysCast ? ' ac' : '');
      const name = document.createElement('div');
      name.className = 'slot-name';
      name.textContent = dictName(spell) || spell.actionId;
      const meta = document.createElement('div');
      meta.className = 'slot-meta';
      meta.textContent =
        (spell.usesRemaining === '-1' ? '∞' : `×${spell.usesRemaining}`) +
        (spell.alwaysCast ? t('wand.acMark') : '');
      cell.title = `${spell.actionId}(${typeLabel(spell.type)})`;
      cell.append(name, meta);
      cell.draggable = true;
      cell.ondragstart = (e) => e.dataTransfer.setData('text/plain', String(spell.idx));
      cell.onclick = () => openSpellEditor(ctx, spell);
    } else {
      cell.className = 'slot empty';
      cell.textContent = '+';
      cell.title = t('wand.addSpell');
      cell.onclick = () => openSpellPicker(ctx, slot);
    }
    cell.ondragover = (e) => e.preventDefault();
    cell.ondrop = (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (Number.isInteger(from) && from !== (spell ? spell.idx : -1)) dropReorder(ctx, from, slot);
    };
    rootEl.append(cell);
  }
}

/** 拖拽重排:把 idx=from 的卡移动到 to 显示槽位置(重排后槽位压缩为 0..n-1)。 */
function dropReorder(ctx, from, to) {
  act(async () => {
    const sorted = [...ctx.spells].sort((a, b) => a.slot - b.slot);
    const fromPos = sorted.findIndex((s) => s.idx === from);
    if (fromPos === -1) return;
    const [card] = sorted.splice(fromPos, 1);
    // 目标为空槽/靠后 → 尽量落在 to 对应的顺序位
    const toPos = sorted.filter((s) => s.slot < to).length;
    sorted.splice(toPos, 0, card);
    await api(`${ctx.base}/order`, JSON_REQ('PUT', { order: sorted.map((s) => s.idx), version }));
    await loadWands();
  }, t('log.reordered'));
}

// ---- 法术选择器 ----------------------------------------------------------------

let pickerCtx = null; // {ctx, slot}

function openSpellPicker(ctx, slot) {
  pickerCtx = { ctx, slot };
  $('spellSearch').value = '';
  $('spellTypeFilter').value = '';
  renderPickerList();
  $('spellPicker').showModal();
  $('spellSearch').focus();
}

function renderPickerList() {
  const q = $('spellSearch').value.trim().toLowerCase();
  const type = $('spellTypeFilter').value;
  const list = $('spellList');
  list.innerHTML = '';
  if (!dictSpells) return;

  const hits = dictSpells.filter((s) =>
    (!type || s.type === type) &&
    (!q ||
      s.id.toLowerCase().includes(q) ||
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.nameZh && s.nameZh.includes(q))));

  $('spellListInfo').textContent =
    t('picker.matches', { n: hits.length }) + (hits.length > 80 ? t('picker.matchesCap') : '');
  for (const s of hits.slice(0, 80)) {
    const row = document.createElement('div');
    row.className = 'spell-row';
    const name = document.createElement('span');
    name.textContent = `${dictName(s)} (${s.id})`;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent =
      `${typeLabel(s.type)} · ${t('picker.mana', { mana: s.mana })}` +
      (s.maxUses !== '-1' ? ` · ${t('picker.uses', { n: s.maxUses })}` : '');
    row.append(name, meta);
    row.onclick = () => {
      $('spellPicker').close();
      const { ctx, slot } = pickerCtx;
      act(async () => {
        await api(ctx.base, JSON_REQ('POST', { actionId: s.id, slot, version }));
        await loadWands();
      }, t('log.spellAdded', { name: dictName(s) || s.id }));
    };
    list.append(row);
  }
}

// ---- 已占槽编辑 ----------------------------------------------------------------

function openSpellEditor(ctx, spell) {
  const dlg = $('spellEdit');
  $('spellEditTitle').textContent =
    `${dictName(spell) || spell.actionId}(${t('wand.slotLabel', { slot: spell.slot })})`;
  $('spellEditUses').value = spell.usesRemaining ?? '-1';
  $('spellEditAC').checked = spell.alwaysCast;

  $('spellEditSave').onclick = () => {
    dlg.close();
    act(async () => {
      await api(`${ctx.base}/${spell.idx}`, JSON_REQ('PUT', {
        usesRemaining: $('spellEditUses').value,
        alwaysCast: $('spellEditAC').checked,
        version,
      }));
      await loadWands();
    }, t('log.spellUpdated'));
  };
  $('spellEditDelete').onclick = () => {
    dlg.close();
    act(async () => {
      await api(`${ctx.base}/${spell.idx}?v=${version}`, { method: 'DELETE' });
      await loadWands();
    }, t('log.spellDeleted'));
  };
  dlg.showModal();
}
