// M3 前端:特殊效果页 + 天赋页。由 app.js 注入 api/act 依赖并初始化。
//
//  - 特殊效果:现有效果列表(名称/剩余时间或永久/来源/移除)+ 添加面板
//    (分组下拉、永久或秒数切换、HUD 图标开关、危险效果红字警示);
//  - 天赋:已有天赋列表(旗标/计数/实体在位/移除)+ 添加选择器
//    (仅 effect 型可选,complex 型灰显并说明原因);
//  - 下拉选项随语言重建(effects 字典仅中文名,英文侧显示枚举 ID)。

import { t, dictName, getLang } from './i18n/index.js';

let api, act;
let dictEffects = null; // /api/dict/effects
let dictPerks = null;   // /api/dict/perks
let version = 0;

const GROUP_REC = '__rec__'; // 「推荐」分组哨兵值(语言无关)

const $ = (id) => document.getElementById(id);
const JSON_REQ = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** 效果显示名:zh「中文名 (ID)」,en 仅 ID(effects 字典没有英文名)。 */
function effLabel(e) {
  return getLang() === 'zh' && e.nameZh ? `${e.nameZh} (${e.id})` : e.id;
}

/** 分组显示名(字典分组值为中文,经 i18n 键翻译;未知分组原样)。 */
function groupLabel(g) {
  if (g === GROUP_REC) return t('eff.groupRec');
  const key = 'effgroup.' + g;
  const label = t(key);
  return label === key ? g : label;
}

export function initEffects(deps) {
  api = deps.api;
  act = deps.act;

  $('effGroup').onchange = renderEffectOptions;
  $('effPermanent').onchange = () => {
    $('effSeconds').disabled = $('effPermanent').checked;
  };
  $('btnAddEffect').onclick = onAddEffect;
  $('btnAddPerk').onclick = onAddPerk;
  return loadEffects();
}

async function ensureDicts() {
  if (dictEffects) return;
  [dictEffects, dictPerks] = await Promise.all([
    api('/dict/effects'), api('/dict/perks'),
  ]);
}

/** 添加面板的分组/效果/天赋下拉,随语言重建(保留当前选中)。 */
function renderSelectors() {
  // 效果分组(推荐组置顶)
  const sel = $('effGroup');
  const keepGroup = sel.value;
  sel.innerHTML = '';
  for (const g of [GROUP_REC, ...new Set(dictEffects.map((e) => e.group))]) {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = groupLabel(g);
    sel.append(opt);
  }
  if ([...sel.options].some((o) => o.value === keepGroup)) sel.value = keepGroup;
  renderEffectOptions();

  // 天赋下拉:effect 型可选(按缺失程度标注),complex 型灰显
  const perkSel = $('perkSelect');
  const keepPerk = perkSel.value;
  perkSel.innerHTML = '';
  const markerOf = (p) => {
    if (p.kind !== 'effect') return t('perk.unsupported');
    if (p.funcImpact === 'major') return t('perk.majorMark');
    if (p.funcImpact === 'cost') return t('perk.costMark');
    if (p.funcImpact === 'minor') return t('perk.minorMark');
    return ''; // none 或无脚本:注入等同拾取
  };
  const order = { effect: 0, complex: 1 };
  const sorted = [...dictPerks].sort((a, b) =>
    (order[a.kind] - order[b.kind]) ||
    ((a.funcImpact === 'major' ? 1 : 0) - (b.funcImpact === 'major' ? 1 : 0)));
  for (const p of sorted) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${dictName(p)} (${p.id})` + markerOf(p);
    opt.disabled = p.kind !== 'effect';
    perkSel.append(opt);
  }
  if ([...perkSel.options].some((o) => o.value === keepPerk)) perkSel.value = keepPerk;
  perkSel.onchange = onPerkSelected;
  onPerkSelected();
}

/** 选中天赋时,在下方显示该天赋注入后具体缺什么(说明文案来自字典,仅中文)。 */
function onPerkSelected() {
  const p = dictPerks.find((x) => x.id === $('perkSelect').value);
  const note = $('perkNote');
  if (!p || p.kind !== 'effect' || !p.funcNote) {
    note.textContent = p && p.kind === 'effect' ? t('perk.equiv') : '';
    note.className = 'muted';
    return;
  }
  note.textContent = p.funcNote;
  note.className = p.funcImpact === 'major' ? 'warn' : 'muted';
}

function renderEffectOptions() {
  const g = $('effGroup').value;
  const sel = $('effSelect');
  sel.innerHTML = '';
  const hits = dictEffects.filter((e) =>
    e.selectable !== false && (g === GROUP_REC ? e.recommended : e.group === g));
  for (const e of hits) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = effLabel(e) + (e.danger ? ' ⚠' : '');
    sel.append(opt);
  }
  onEffectSelected();
  sel.onchange = onEffectSelected;
}

function onEffectSelected() {
  const e = dictEffects.find((x) => x.id === $('effSelect').value);
  const warn = $('effDanger');
  if (e?.danger) {
    warn.textContent = t('eff.dangerWarn', {
      name: getLang() === 'zh' ? (e.nameZh || e.id) : e.id,
    });
  } else {
    warn.textContent = '';
  }
}

export async function loadEffects() {
  await ensureDicts();
  renderSelectors();

  const data = await api('/player/effects');
  version = data.version;
  const list = $('effectList');
  list.innerHTML = '';
  if (data.effects.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = t('eff.none');
    list.append(li);
  }
  for (const e of data.effects) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    const name = getLang() === 'zh' && e.nameZh ? `${e.nameZh} (${e.effect})` : e.effect;
    label.textContent =
      `${name} — ${e.permanent ? t('eff.permanentTag') : t('eff.secondsTag', { n: e.seconds })}` +
      ` · ${e.source === 'editor' ? t('eff.srcEditor') : t('eff.srcGame')}` +
      (e.hasIcon ? ` · ${t('eff.hasIcon')}` : '');
    if (e.danger) label.className = 'warn';
    const btn = document.createElement('button');
    btn.textContent = t('common.remove');
    btn.onclick = () => act(async () => {
      await api(`/player/effects/${e.index}?v=${version}`, { method: 'DELETE' });
      await loadEffects();
    }, t('log.effectRemoved', { id: e.effect }));
    li.append(label, document.createTextNode(' '), btn);
    list.append(li);
  }

  const perkData = await api('/perks');
  const plist = $('perkList');
  plist.innerHTML = '';
  if (perkData.perks.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = t('perk.none');
    plist.append(li);
  }
  for (const p of perkData.perks) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent =
      `${dictName(p)} (${p.id}) — ${t('perk.count', { n: p.count })}` +
      ` · ${t('perk.entity')} ${p.entityCount > 0 ? t('perk.entityOk') : t('perk.entityMissing')}` +
      ` · ${p.source === 'editor' ? t('perk.srcEditor') : t('perk.srcGame')}`;
    const btn = document.createElement('button');
    btn.textContent = t('common.remove');
    btn.onclick = () => act(async () => {
      await api(`/perks/${encodeURIComponent(p.id)}?v=${version}`, { method: 'DELETE' });
      await loadEffects();
    }, t('log.perkRemoved', { id: p.id }));
    li.append(label, document.createTextNode(' '), btn);
    plist.append(li);
  }
}

function onAddEffect() {
  const effect = $('effSelect').value;
  if (!effect) return;
  const body = { effect, withIcon: $('effIcon').checked, version };
  if (!$('effPermanent').checked) {
    body.seconds = $('effSeconds').value || '60';
  }
  act(async () => {
    await api('/player/effects', JSON_REQ('POST', body));
    await loadEffects();
  }, t('log.effectAdded', { id: effect }));
}

function onAddPerk() {
  const id = $('perkSelect').value;
  if (!id) return;
  act(async () => {
    await api('/perks', JSON_REQ('POST', { id, version }));
    await loadEffects();
  }, t('log.perkAdded', { id }));
}
