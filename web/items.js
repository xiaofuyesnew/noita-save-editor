// 物品栏道具页 —— 由 app.js 注入依赖初始化。
//
//  - 列出快捷栏顶层宝藏道具(邪王真眼/法术石/骰子等,法杖与药水另有专页),
//    每项一行,可移除;
//  - 唯一的添加路径:下拉选择道具(邪王真眼为默认第一项)→ 点「添加到缓冲」;
//    道具行 4 格(0–3)满员时添加按钮禁用,并显示满员提示;
//  - 添加/移除即时写编辑缓冲,携带 version,409 时提示刷新。

import { t, dictName } from './i18n/index.js';

let api, act;
let catalog = null;   // /api/items/catalog
let version = 0;

const $ = (id) => document.getElementById(id);
const JSON_REQ = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** 道具目录分组显示名(i18n 键 item.group.<group>;未知分组原样)。 */
function groupLabel(group) {
  const key = 'item.group.' + group;
  const label = t(key);
  return label === key ? group : label;
}

export function initItems(deps) {
  api = deps.api;
  act = deps.act;
  $('btnAddItem').onclick = () => {
    const id = $('itemAddSelect').value;
    if (id) addItem(id);
  };
  return loadItems();
}

async function ensureCatalog() {
  if (catalog) return;
  const data = await api('/items/catalog');
  catalog = data.catalog;
}

/** 目录下拉随语言重建(按分组归类,保留当前选中)。 */
function renderAddSelect() {
  const sel = $('itemAddSelect');
  const keep = sel.value;
  sel.innerHTML = '';
  const byGroup = new Map();
  for (const it of catalog) {
    if (!byGroup.has(it.group)) byGroup.set(it.group, []);
    byGroup.get(it.group).push(it);
  }
  for (const [group, list] of byGroup) {
    const og = document.createElement('optgroup');
    og.label = groupLabel(group);
    for (const it of list) {
      const opt = document.createElement('option');
      opt.value = it.id;
      opt.textContent = dictName(it);
      og.append(opt);
    }
    sel.append(og);
  }
  if ([...sel.querySelectorAll('option')].some((o) => o.value === keep)) sel.value = keep;
}

export async function loadItems() {
  await ensureCatalog();
  renderAddSelect();
  const data = await api('/items');
  version = data.version;
  renderList(data.items);
  updateAddState(data);
}

/** 满员时禁用添加按钮并提示;未满显示剩余空槽数。 */
function updateAddState({ capacity, freeSlots }) {
  const full = freeSlots <= 0;
  $('btnAddItem').disabled = full;
  const hint = $('itemAddHint');
  hint.textContent = full
    ? t('item.full', { cap: capacity })
    : t('item.freeSlots', { n: freeSlots, cap: capacity });
  hint.className = full ? 'warn' : 'muted';
}

function renderList(items) {
  const root = $('itemList');
  root.innerHTML = '';
  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = t('item.none');
    root.append(p);
    return;
  }
  for (const it of items) root.append(renderRow(it));
}

function renderRow(it) {
  const row = document.createElement('div');
  row.className = 'bones-row';

  const info = document.createElement('div');
  info.className = 'bones-info';
  const strong = document.createElement('strong');
  // 目录内道具显示本地化名;存档原生道具(钥匙/石板)无目录条目,回退 itemName
  strong.textContent = it.nameZh || it.name
    ? dictName({ name: it.name, nameZh: it.nameZh, id: it.itemName })
    : (it.itemName || t('item.unknown'));
  const meta = document.createElement('span');
  meta.className = 'muted';
  meta.textContent = t('item.rowMeta', {
    slot: it.slot ?? '?',
    kind: kindLabel(it.kind),
    name: it.itemName || '?',
  });
  info.append(strong, meta);

  const del = document.createElement('button');
  del.className = 'danger';
  del.textContent = t('common.delete');
  del.onclick = () => act(async () => {
    await api(`/items/${it.index}?v=${version}`, { method: 'DELETE' });
    await loadItems();
  }, t('log.itemRemoved', { name: it.nameZh || it.name || it.itemName }));

  row.append(info, del);
  return row;
}

function kindLabel(kind) {
  const key = 'item.kind.' + kind;
  const label = t(key);
  return label === key ? kind : label;
}

function addItem(id) {
  const entry = (catalog || []).find((x) => x.id === id);
  const name = entry ? dictName(entry) : id;
  act(async () => {
    await api('/items', JSON_REQ('POST', { id, version }));
    await loadItems();
  }, t('log.itemAdded', { name }));
}
