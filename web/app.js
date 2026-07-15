// 前端入口:纯 ES module + fetch,无框架依赖。
import { initWands, loadWands } from './wands.js';
import { initEffects, loadEffects } from './effects.js';
import { initExtras, loadExtras } from './extras.js';
import { initItems, loadItems } from './items.js';
import { labelText, log, initTooltips, trackCardDirty, snapshotCard } from './ui.js';
import { t, getLang, setLang, applyStatic, onLangChange } from './i18n/index.js';

const $ = (id) => document.getElementById(id);

async function api(path, opts) {
  const res = await fetch('/api' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.data = data;
    throw err;
  }
  return data;
}

// ---- 顶栏与存档状态面板 --------------------------------------------------------

/** 路径输入框只在用户未改动时跟随服务端值,避免刷新清掉正在编辑的内容。 */
function syncPathInput(input, serverValue) {
  const untouched = input.value === '' || input.value === input.dataset.server;
  input.dataset.server = serverValue;
  if (untouched && document.activeElement !== input) input.value = serverValue;
}

function render(status) {
  $('savePath').textContent = status.saveDir;
  $('gameState').textContent = status.gameRunning ? t('top.gameRunning') : t('top.gameIdle');
  $('gameState').className = status.gameRunning ? 'warn' : 'ok';
  $('dirtyState').textContent = status.dirty ? t('top.dirty') : t('top.saved');
  $('dirtyState').className = status.dirty ? 'warn' : 'muted';
  $('btnWrite').disabled = !status.dirty;

  // 功能③: 存档状态 label-value 展示
  syncPathInput($('cfgSaveDir'), status.saveDir);
  syncPathInput($('cfgLiveDir'), status.liveDir);
  $('stGame').textContent = status.gameRunning ? t('st.running') : t('st.notRunning');
  $('stGame').className = 'value ' + (status.gameRunning ? 'warn' : 'ok');
  $('stLive').textContent = status.liveExists ? t('st.exists') : t('st.missing');
  $('stDirty').textContent = status.dirty
    ? t('st.dirtyFiles', { files: status.dirtyFiles.join(', ') }) : t('st.clean');
  $('stVersion').textContent = String(status.version);
  $('stManaged').textContent = status.managedFiles.join(', ') || t('common.none');
  $('stBackups').textContent = String(status.backupsTotal ?? 0);
  const last = status.backups?.[0];
  $('stLastBackup').textContent =
    last ? `${last.name}(${new Date(last.mtime).toLocaleString()})` : t('common.none');
}

async function refresh() {
  render(await api('/status'));
}

async function act(fn, okMsg) {
  try {
    await fn();
    if (okMsg) log(okMsg, 'ok');
    await refresh();
  } catch (e) {
    log(t('log.error', { msg: e.message }), 'warn');
  }
}

/** 全量重载(丢弃缓冲类操作后调用,法杖表单里未提交的编辑一并丢弃)。 */
async function reloadAll() {
  await loadPlayer();
  await loadWands({ preserveEdits: false });
  await loadEffects();
  await loadExtras();
  await loadItems();
}

$('btnWrite').onclick = () => act(async () => { await api('/save/write', { method: 'POST' }); await loadWands(); await loadEffects(); await loadExtras(); await loadItems(); }, t('log.written'));
$('btnReload').onclick = () => act(async () => { await api('/save/reload', { method: 'POST' }); await reloadAll(); }, t('log.reloaded'));
$('btnPull').onclick = () => act(async () => { await api('/sync/pull', { method: 'POST' }); await reloadAll(); }, t('log.pulled'));
$('btnPush').onclick = () => act(() => api('/sync/push', { method: 'POST' }), t('log.pushed'));

// 功能③: 应用存档/实时路径(缓冲有未保存更改时需确认 force)
$('btnSavePaths').onclick = () => act(async () => {
  const body = {
    saveDir: $('cfgSaveDir').value.trim(),
    liveDir: $('cfgLiveDir').value.trim(),
  };
  try {
    await api('/config/paths', JSON_POST('PUT', body));
  } catch (e) {
    if (!e.data?.requiresForce) throw e;
    if (!confirm(t('confirm.switchPaths'))) {
      throw new Error(t('log.pathsCancelled'));
    }
    await api('/config/paths', JSON_POST('PUT', { ...body, force: true }));
  }
  // 服务端已按新路径重新读盘;清空输入让其跟随服务端回显,并全量刷新前端
  $('cfgSaveDir').value = '';
  $('cfgLiveDir').value = '';
  await refresh();
  await reloadAll();
  snapshotCard($('statusCard'));
}, t('log.pathsApplied'));

// ---- 语言切换 -----------------------------------------------------------------

function updateLangBtn() {
  $('btnLang').textContent = getLang() === 'zh' ? 'EN' : '中文';
}
$('btnLang').onclick = () => setLang(getLang() === 'zh' ? 'en' : 'zh');
onLangChange(async () => {
  updateLangBtn();
  await refresh();
  await loadPlayer();
  await loadWands(); // 保留法杖表单未应用的编辑
  await loadEffects();
  await loadExtras();
  await loadItems();
  snapshotCard($('statusCard'));
  log(t('log.langSwitched'));
});

// ---- 备份管理弹窗 -------------------------------------------------------------

async function loadBackups() {
  const { backups } = await api('/backups');
  const root = $('backupRows');
  root.innerHTML = '';
  if (backups.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = t('backup.none');
    root.append(p);
    return;
  }
  const mkBtn = (text, fn, cls = '') => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.className = cls;
    btn.onclick = fn;
    return btn;
  };
  for (const b of backups) {
    const row = document.createElement('div');
    row.className = 'backup-row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = b.name;
    const time = document.createElement('span');
    time.className = 'muted';
    time.textContent = new Date(b.mtime).toLocaleString();
    row.append(
      name,
      time,
      mkBtn(t('common.restore'), () => act(async () => {
        await api(`/backups/${encodeURIComponent(b.name)}/restore`, { method: 'POST' });
        await reloadAll();
        await loadBackups();
      }, t('log.restored', { name: b.name }))),
      mkBtn(t('common.export'), () => window.open(`/api/backups/${encodeURIComponent(b.name)}/export`)),
      mkBtn(t('common.delete'), () => {
        if (!confirm(t('confirm.deleteBackup', { name: b.name }))) return;
        act(async () => {
          await api(`/backups/${encodeURIComponent(b.name)}`, { method: 'DELETE' });
          await loadBackups();
        }, t('log.backupDeleted', { name: b.name }));
      }, 'danger'),
    );
    root.append(row);
  }
}

$('btnBackups').onclick = () => {
  $('backupDlg').showModal();
  loadBackups().catch((e) => log(t('log.error', { msg: e.message }), 'warn'));
};
$('backupDlgClose').onclick = () => $('backupDlg').close();
$('btnBackupCreate').onclick = () => act(async () => {
  await api('/backups', { method: 'POST' });
  await loadBackups();
}, t('log.backupCreated'));

// ---- M1 玩家属性 ------------------------------------------------------------

// 表单字段 id 后缀 ↔ basics 补丁路径("_"分隔 → 嵌套对象)
const BASIC_FIELDS = [
  'hp_current', 'hp_max', 'money',
  'air_inLungs', 'air_needed',
  'position_x', 'position_y',
  'fly_timeMax', 'fly_needsRecharge',
  'movement_runVelocity', 'movement_velocityMaxX', 'movement_velocityMaxY',
];

function getIn(obj, parts) {
  return parts.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setIn(obj, parts, value) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] ?? (cur[parts[i]] = {});
  cur[parts[parts.length - 1]] = value;
}

const JSON_POST = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const DMG_KEYS = [
  'melee', 'projectile', 'explosion', 'electricity', 'fire', 'drill', 'slice',
  'ice', 'healing', 'physics_hit', 'radioactive', 'poison', 'overeating',
  'curse', 'holy',
];

async function loadPlayer() {
  const basics = await api('/player/basics');
  for (const f of BASIC_FIELDS) {
    const v = getIn(basics, f.split('_'));
    if (v === undefined) continue;
    const el = $('f_' + f);
    // 0/1 字段用 checkbox 呈现
    if (el.type === 'checkbox') el.checked = Number(v) !== 0;
    else el.value = v;
  }
  const inv = await api('/player/invincibility');
  $('inv_effect').checked = inv.effect;
  $('inv_frames').checked = inv.frames;

  const dmg = await api('/player/damage-multipliers');
  const grid = $('dmgGrid');
  grid.innerHTML = '';
  for (const [key, value] of Object.entries(dmg)) {
    const label = document.createElement('label');
    label.append(labelText(
      DMG_KEYS.includes(key) ? `${t('dmg.' + key)} (${key})` : key, t('dmg.tip')));
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.05';
    input.value = value;
    input.dataset.key = key;
    label.append(input);
    grid.append(label);
  }
  snapshotCard($('playerCard'));
  snapshotCard($('dmgCard'));
}

$('btnSaveBasics').onclick = () => act(async () => {
  const patch = {};
  for (const f of BASIC_FIELDS) {
    const el = $('f_' + f);
    if (el.type === 'checkbox') setIn(patch, f.split('_'), el.checked ? '1' : '0');
    else if (el.value !== '') setIn(patch, f.split('_'), el.value);
  }
  await api('/player/basics', JSON_POST('PUT', patch));
  snapshotCard($('playerCard'));
}, t('log.basicsApplied'));

for (const [id, mode] of [['inv_effect', 'effect'], ['inv_frames', 'frames']]) {
  $(id).onchange = (e) => act(
    () => api('/player/invincibility', JSON_POST('POST', { mode, enable: e.target.checked })),
    t('log.invToggled', { mode, state: e.target.checked ? t('log.on') : t('log.off') }),
  );
}

$('btnSaveDmg').onclick = () => act(async () => {
  const patch = {};
  for (const input of $('dmgGrid').querySelectorAll('input')) {
    patch[input.dataset.key] = input.value;
  }
  await api('/player/damage-multipliers', JSON_POST('PUT', patch));
  snapshotCard($('dmgCard'));
}, t('log.dmgApplied'));

// ---- 启动 ---------------------------------------------------------------------

applyStatic();
updateLangBtn();
initTooltips();
refresh()
  .then(loadPlayer)
  .then(() => initWands({ api, act }))
  .then(() => initEffects({ api, act }))
  .then(() => initExtras({ api, act, reloadWands: loadWands }))
  .then(() => initItems({ api, act }))
  .then(() => {
    // 功能⑤: 注册 card 脏跟踪(此刻各表单已完成首次渲染,快照即基线)
    for (const id of [
      'playerCard', 'dmgCard', 'wandCard', 'potionCard',
      'itemCard', 'worldCard', 'unlockCard', 'statusCard',
    ]) trackCardDirty($(id));
  })
  .catch((e) => log(t('log.initFailed', { msg: e.message }), 'warn'));
