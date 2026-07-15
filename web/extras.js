// M4 前端:药水材料 / 世界状态 / 进度解锁 / 遗骨法杖。由 app.js 注入依赖初始化。
//
//  - 药水:每个容器一张小卡,材料行(datalist 搜索 + 数量)增删改,按容器应用;
//  - 世界状态:白名单字段表单 + 运行旗标列表 + 真菌变换配对,整体应用到缓冲;
//  - 进度解锁:card_unlocked_* 复选框批量应用 —— 文件开关,立即写工作区快照,
//    不走【写入存档】;
//  - 遗骨法杖:bones_new 预览列表,一键导入快捷栏空槽(导入后刷新法杖页)。

import { labelText, snapshotCard } from './ui.js';
import { t, dictName, getLang } from './i18n/index.js';

/** 列表连接符:中文用顿号,英文用逗号。 */
const listSep = () => (getLang() === 'zh' ? '、' : ', ');

let api, act, reloadWands;
let dictMaterials = null;   // /api/dict/materials
let matById = new Map();
let version = 0;

// 本地编辑态(应用时整体提交)
let potionsState = [];      // [{index, capacity, kind, slot, materials:[{material,count}]}]
let worldFlags = [];        // 运行旗标
let worldShifts = [];       // 真菌变换 [{from,to}]
let unlockOriginal = new Map(); // flag → 磁盘状态(算 diff 用)

const $ = (id) => document.getElementById(id);
const JSON_REQ = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export function initExtras(deps) {
  api = deps.api;
  act = deps.act;
  reloadWands = deps.reloadWands;

  $('btnSaveWorld').onclick = onApplyWorld;
  $('btnAddWorldFlag').onclick = () => {
    const input = $('worldFlagNew');
    const flag = input.value.trim();
    if (!flag) return;
    if (!worldFlags.includes(flag)) worldFlags.push(flag);
    input.value = '';
    renderWorldFlags();
  };
  $('btnAddShift').onclick = () => {
    worldShifts.push({ from: '', to: '' });
    renderShifts();
  };
  $('btnUnlockAll').onclick = () => setAllUnlocks(true);
  $('btnUnlockNone').onclick = () => setAllUnlocks(false);
  $('btnApplyUnlocks').onclick = onApplyUnlocks;
  return loadExtras();
}

async function ensureDicts() {
  if (dictMaterials) return;
  dictMaterials = await api('/dict/materials');
  matById = new Map(dictMaterials.map((m) => [m.id, m]));
}

/** 材料 datalist 随语言重建:液体/粉末在前(可倒入容器),其余靠后备查。 */
function renderMatList() {
  const kindOrder = { liquid: 0, powder: 1, static: 2, gas: 3, fire: 4, solid: 5 };
  const sorted = [...dictMaterials].sort((a, b) =>
    (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) || a.id.localeCompare(b.id));
  const dl = $('matList');
  dl.innerHTML = '';
  for (const m of sorted) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.label = `${dictName(m)}(${m.kind})`;
    dl.append(opt);
  }
}

export async function loadExtras() {
  await ensureDicts();
  renderMatList();
  await Promise.all([loadPotions(), loadWorld(), loadUnlocks(), loadBones()]);
}

// ---- 药水 ---------------------------------------------------------------------

async function loadPotions() {
  const data = await api('/items/potions');
  version = data.version;
  potionsState = data.potions.map((p) => ({
    ...p,
    materials: p.materials.map((m) => ({ material: m.material, count: m.count })),
  }));
  renderPotions();
  snapshotCard(document.getElementById('potionCard'));
}

function kindLabel(kind) {
  const key = `potion.kind.${kind}`;
  const label = t(key);
  return label === key ? kind : label;
}

function renderPotions() {
  const root = $('potionList');
  root.innerHTML = '';
  if (potionsState.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = t('potion.none');
    root.append(p);
    return;
  }
  for (const p of potionsState) root.append(renderPotion(p));
}

function renderPotion(p) {
  const box = document.createElement('div');
  box.className = 'wand';
  const title = document.createElement('h3');
  title.append(
    document.createTextNode(`${kindLabel(p.kind)} #${p.index}`),
    Object.assign(document.createElement('span'), {
      className: 'muted',
      textContent: ' ' + t('potion.slotCap', { slot: p.slot ?? '?', cap: p.capacity ?? '?' }),
    }),
  );
  box.append(title);

  const rows = document.createElement('div');
  box.append(rows);
  const renderRows = () => {
    rows.innerHTML = '';
    p.materials.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      const matInput = document.createElement('input');
      matInput.setAttribute('list', 'matList');
      matInput.placeholder = t('potion.matPh');
      matInput.value = m.material;
      matInput.className = 'mat-input';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'muted';
      const syncName = () => {
        const d = matById.get(matInput.value);
        nameSpan.textContent = d ? `${dictName(d)} · ${d.kind}` : t('potion.unknownMat');
        nameSpan.classList.toggle('warn', !d);
        m.material = matInput.value;
      };
      matInput.oninput = syncName;
      syncName();
      const countInput = document.createElement('input');
      countInput.type = 'number';
      countInput.min = '0';
      countInput.value = m.count;
      countInput.className = 'count-input';
      countInput.oninput = () => { m.count = countInput.value; };
      const del = document.createElement('button');
      del.textContent = t('common.delete');
      del.onclick = () => { p.materials.splice(i, 1); renderRows(); };
      row.append(matInput, nameSpan, countInput, del);
      rows.append(row);
    });
  };
  renderRows();

  const actions = document.createElement('div');
  actions.className = 'row';
  const add = document.createElement('button');
  add.textContent = t('potion.addMat');
  add.onclick = () => { p.materials.push({ material: '', count: '1000' }); renderRows(); };
  const apply = document.createElement('button');
  apply.textContent = t('common.apply');
  apply.onclick = () => act(async () => {
    await api(`/items/potions/${p.index}`, JSON_REQ('PUT', {
      version,
      materials: p.materials.filter((m) => m.material.trim() !== ''),
    }));
    await loadPotions();
  }, t('log.potionApplied', { i: p.index }));
  const hint = document.createElement('span');
  hint.className = 'muted';
  hint.textContent = t('potion.hint');
  actions.append(add, apply, hint);
  box.append(actions);
  return box;
}

// ---- 世界状态 -----------------------------------------------------------------

// 字段定义:[api字段, 类型 number|check];文案键 world.f.<字段>[.tip]
const WORLD_FIELD_DEFS = [
  ['dayCount', 'number'],
  ['time', 'number'],
  ['timeDt', 'number'],
  ['rain', 'number'],
  ['rainTarget', 'number'],
  ['fog', 'number'],
  ['fogTarget', 'number'],
  ['windSpeed', 'number'],
  ['everythingToGold', 'check'],
  ['infiniteGoldHappening', 'check'],
  ['openFogOfWarEverywhere', 'check'],
];

async function loadWorld() {
  const data = await api('/world/state');
  version = data.version;
  worldFlags = [...data.flags];
  worldShifts = data.changedMaterials.map((p) => ({ ...p }));

  const grid = $('worldFieldGrid');
  grid.innerHTML = '';
  for (const [field, type] of WORLD_FIELD_DEFS) {
    const wrap = document.createElement('label');
    const input = document.createElement('input');
    input.dataset.field = field;
    const label = t(`world.f.${field}`);
    const tip = t(`world.f.${field}.tip`);
    if (type === 'check') {
      wrap.className = 'check';
      input.type = 'checkbox';
      input.checked = Number(data.fields[field]) !== 0;
      wrap.append(input, labelText(label, `${tip} ${t('world.checkTip')}`));
    } else {
      input.type = 'number';
      input.step = 'any';
      input.value = data.fields[field] ?? '';
      wrap.append(labelText(label, tip), input);
    }
    grid.append(wrap);
  }

  renderWorldFlags();
  renderShifts();

  $('worldRaw').textContent = JSON.stringify({
    lua_globals: Object.fromEntries(data.luaGlobals.map((g) => [g.key, g.value])),
    orbs_found_thisrun: data.orbsFoundThisrun,
  }, null, 2);
  snapshotCard(document.getElementById('worldCard'));
}

function renderWorldFlags() {
  const ul = $('worldFlagList');
  ul.innerHTML = '';
  if (worldFlags.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = t('world.noFlags');
    ul.append(li);
  }
  worldFlags.forEach((flag, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = t('common.delete');
    btn.onclick = () => { worldFlags.splice(i, 1); renderWorldFlags(); };
    li.append(document.createTextNode(flag + ' '), btn);
    ul.append(li);
  });
}

function renderShifts() {
  const root = $('shiftList');
  root.innerHTML = '';
  if (worldShifts.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = t('world.noShifts');
    root.append(p);
  }
  worldShifts.forEach((pair, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    const mk = (key, placeholder) => {
      const input = document.createElement('input');
      input.setAttribute('list', 'matList');
      input.placeholder = placeholder;
      input.value = pair[key];
      input.className = 'mat-input';
      input.oninput = () => { pair[key] = input.value; };
      return input;
    };
    const del = document.createElement('button');
    del.textContent = t('common.delete');
    del.onclick = () => { worldShifts.splice(i, 1); renderShifts(); };
    row.append(
      mk('from', t('world.from')), document.createTextNode('→'),
      mk('to', t('world.to')), del);
    root.append(row);
  });
}

function onApplyWorld() {
  const fields = {};
  for (const input of $('worldFieldGrid').querySelectorAll('input')) {
    fields[input.dataset.field] =
      input.type === 'checkbox' ? (input.checked ? '1' : '0') : input.value;
  }
  act(async () => {
    await api('/world/state', JSON_REQ('PUT', {
      version,
      fields,
      flags: worldFlags,
      changedMaterials: worldShifts.filter((p) => p.from.trim() || p.to.trim()),
    }));
    await loadWorld();
  }, t('log.worldApplied'));
}

// ---- 进度解锁 -----------------------------------------------------------------

async function loadUnlocks() {
  const data = await api('/persistent/unlocks');
  unlockOriginal = new Map(data.unlocks.map((u) => [u.flag, u.unlocked]));

  const grid = $('unlockGrid');
  grid.innerHTML = '';
  for (const u of data.unlocks) {
    const wrap = document.createElement('label');
    wrap.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = u.unlocked;
    input.dataset.flag = u.flag;
    input.onchange = updateUnlockStats;
    const short = u.flag.replace(/^card_unlocked_/, '');
    const tip = u.known
      ? t('unlock.knownTip', {
          names: u.spells.map((s) => dictName(s) || s.id).join(listSep()),
          ids: u.spells.map((s) => s.id).join(', '),
        })
      : t('unlock.unknownTip');
    wrap.append(input, labelText(short + (u.known ? '' : ' ?'), tip));
    grid.append(wrap);
  }
  updateUnlockStats();
  snapshotCard(document.getElementById('unlockCard'));
}

function setAllUnlocks(state) {
  for (const input of $('unlockGrid').querySelectorAll('input')) input.checked = state;
  updateUnlockStats();
}

function unlockDiff() {
  const changes = {};
  for (const input of $('unlockGrid').querySelectorAll('input')) {
    if (input.checked !== unlockOriginal.get(input.dataset.flag)) {
      changes[input.dataset.flag] = input.checked;
    }
  }
  return changes;
}

function updateUnlockStats() {
  const inputs = [...$('unlockGrid').querySelectorAll('input')];
  const on = inputs.filter((i) => i.checked).length;
  const pending = Object.keys(unlockDiff()).length;
  $('unlockStats').textContent =
    t('unlock.stats', { on, total: inputs.length }) +
    (pending ? t('unlock.pending', { n: pending }) : '');
}

function onApplyUnlocks() {
  const changes = unlockDiff();
  if (Object.keys(changes).length === 0) return;
  act(async () => {
    await api('/persistent/unlocks', JSON_REQ('PUT', { changes }));
    await loadUnlocks();
  }, t('log.unlocksApplied', { n: Object.keys(changes).length }));
}

// ---- 遗骨法杖 -----------------------------------------------------------------

async function loadBones() {
  const data = await api('/bones');
  version = data.version;
  const root = $('bonesList');
  root.innerHTML = '';
  if (data.bones.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = t('bones.none');
    root.append(p);
    return;
  }
  for (const b of data.bones) {
    const row = document.createElement('div');
    row.className = 'bones-row';
    if (b.error) {
      const err = document.createElement('span');
      err.className = 'warn';
      err.textContent = `${b.file}: ${b.error}`;
      row.append(err);
      root.append(row);
      continue;
    }
    const label = document.createElement('div');
    label.className = 'bones-info';
    const strong = document.createElement('strong');
    strong.textContent = b.uiName || t('bones.noName');
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = t('bones.summary', {
      file: b.file, level: b.gunLevel, cap: b.deckCapacity,
      mana: b.manaMax, charge: b.manaChargeSpeed, apr: b.actionsPerRound,
    });
    const spellsDiv = document.createElement('div');
    spellsDiv.className = 'muted bones-spells';
    const spellsText = b.spells
      .map((s) => dictName(s) || s.actionId)
      .join(listSep()) || t('bones.empty');
    spellsDiv.textContent = t('bones.spells', { n: b.spellCount, list: spellsText });
    label.append(strong, meta, spellsDiv);
    const btn = document.createElement('button');
    btn.textContent = t('bones.import');
    btn.onclick = () => act(async () => {
      const r = await api(`/wands/import-bones/${encodeURIComponent(b.file)}`,
        JSON_REQ('POST', { version }));
      if (reloadWands) await reloadWands();
      await loadBones(); // 刷新 version
      return r;
    }, t('log.bonesImported', { name: b.uiName || b.file }));
    row.append(label, btn);
    root.append(row);
  }
}
