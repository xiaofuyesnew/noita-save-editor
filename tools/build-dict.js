// 数据字典构建工具(§6):从游戏数据生成 data/ 下的 spells.json / perks.json /
// materials.json / wands.json,并向手工维护的 effects.json 合并"生成字段"
// (描述/默认时长等;策展字段永不覆写)。
// 生成结果直接提交仓库,运行时零依赖;仅在游戏版本更新时手动重跑。
// 法术数值提取采用正则启发式,复杂函数体由 tools/spell-overrides.js 人工补值;
// 每次重跑后按日志的「近似值法术」清单复核覆盖表,并对照 noita.wiki.gg 抽查
// 样本(LIGHT_BULLET / BOMB / DIGGER / HEAVY_SHOT / SPEED / BOUNCE 等)。
//
// 输入优先级:
//   1. --data <dir>   本机解包的游戏 data/ 目录(权威;内含 scripts/gun/gun_actions.lua
//                     与 translations/common.csv)
//   2. --wak <file>   本机 data.wak(默认自动探测常见路径,同 build-icons.js);
//                     翻译 csv 不在 wak 内,回退读 wak 同目录的 translations/ 散装文件
//   3. GitHub 上的游戏数据镜像(--mirror <owner/repo>,默认 oshinop/noita-data;
//      下载缓存在 tools/.cache/,删除后重新下载)
//
// 用法(在仓库根目录下):
//   node tools/build-dict.js
//   node tools/build-dict.js --data "C:/games/noita-extracted/data"
//   node tools/build-dict.js --wak "D:/games/Noita/data/data.wak"

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argv, exit } from 'node:process';
import { XMLParser } from 'fast-xml-parser';
import { flattenEntity, openWak } from './lib/gamedata.js';
import { SPELL_STAT_OVERRIDES } from './spell-overrides.js';

const toolsDir = fileURLToPath(new URL('.', import.meta.url));
const dataOutDir = join(toolsDir, '..', 'data');
const cacheDir = join(toolsDir, '.cache');

// ---- 参数 -------------------------------------------------------------------

function argValue(flag) {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}
const localData = argValue('--data');
const mirror = argValue('--mirror') || 'oshinop/noita-data';

// data.wak 常见位置(与 build-icons.js 同一份探测表)
const WAK_GUESSES = [
  argValue('--wak'),
  'C:/Program Files (x86)/Steam/steamapps/common/Noita/data/data.wak',
  'D:/Steam/steamapps/common/Noita/data/data.wak',
  'D:/games/Noita.v25.01.2025/data/data.wak',
  'E:/games/Noita/data/data.wak',
].filter(Boolean);

// ---- 源文件获取 --------------------------------------------------------------
// wak 读取逻辑在 tools/lib/gamedata.js(与 build-items.js 共享)。

let wakSource; // { read, dir } 惰性初始化
function tryWak() {
  if (wakSource === undefined) {
    const path = WAK_GUESSES.find((p) => existsSync(p));
    wakSource = path ? { read: openWak(path), dir: dirname(path) } : null;
    if (path) console.log(`读取 data.wak: ${path}`);
  }
  return wakSource;
}

async function fetchSource(relPath) {
  if (localData) {
    const p = join(localData, relPath);
    if (!existsSync(p)) throw new Error(`本机游戏数据缺少文件: ${p}`);
    return readFileSync(p, 'utf8');
  }
  const w = tryWak();
  if (w) {
    // wak 内条目带 data/ 前缀;翻译 csv 等散装文件在 wak 同目录下
    const inWak = w.read(`data/${relPath}`);
    if (inWak !== null) return inWak;
    const loose = join(w.dir, relPath);
    if (existsSync(loose)) return readFileSync(loose, 'utf8');
    throw new Error(`data.wak 与安装目录均无此文件: ${relPath}`);
  }
  const cached = join(cacheDir, relPath.replaceAll('/', '__'));
  if (existsSync(cached)) return readFileSync(cached, 'utf8');
  const url = `https://raw.githubusercontent.com/${mirror}/main/${relPath}`;
  console.log(`下载 ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  const text = await res.text();
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, text, 'utf8');
  return text;
}

// 逐文件读取的增强数据(弹射物/效果实体 XML)用可失败版本:单个文件缺失时
// 告警跳过,构建降级(缺该法术/效果的数值),而不是整体中止。
// quiet 用于"探测性"读取(文件很可能不存在),失败不计入告警。
const fetchFailures = [];
async function fetchOptional(relPath, quiet = false) {
  try {
    return await fetchSource(relPath);
  } catch (e) {
    if (!quiet) fetchFailures.push(relPath);
    return null;
  }
}

// ---- gun_actions.lua 解析 ----------------------------------------------------

// ACTION_TYPE_* 枚举(gun_enums.lua)→ 字典中的类型名
const ACTION_TYPES = [
  'projectile', 'static_projectile', 'modifier', 'draw_many',
  'material', 'other', 'utility', 'passive',
];

/** 去掉 Lua 块注释与整行注释(字段行内的尾注释由字段正则容忍)。 */
function stripLuaComments(lua) {
  return lua
    .replace(/--\[\[[\s\S]*?\]\](--)?/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

// ---- action() 函数体数值提取 --------------------------------------------------
//
// 法术对施法参数的修改写在 action() 函数体里,形式高度统一:
//   c.fire_rate_wait = c.fire_rate_wait + 20      (自引用增量;求和)
//   c.speed_multiplier = c.speed_multiplier * 0.75(自引用乘法;求积)
//   current_reload_time = current_reload_time + 40(充能是全局变量,非 c.reload_time)
// 用正则启发式提取;无法覆盖的复杂写法(条件分支内的增量、含常量表达式等)
// 标记 statsApprox 并打印,由 tools/spell-overrides.js 人工补值。

const STAT_DELTA_PATTERNS = [
  ['castDelay', /c\.fire_rate_wait\s*=\s*c\.fire_rate_wait\s*([+-])\s*([\d.]+)/g],
  ['rechargeTime', /current_reload_time\s*=\s*current_reload_time\s*([+-])\s*([\d.]+)/g],
  ['spreadDegrees', /c\.spread_degrees\s*=\s*c\.spread_degrees\s*([+-])\s*([\d.]+)/g],
  ['critChance', /c\.damage_critical_chance\s*=\s*c\.damage_critical_chance\s*([+-])\s*([\d.]+)/g],
  ['explosionRadius', /c\.explosion_radius\s*=\s*c\.explosion_radius\s*([+-])\s*([\d.]+)/g],
  ['bounces', /c\.bounces\s*=\s*c\.bounces\s*([+-])\s*([\d.]+)/g],
  ['lifetimeAdd', /c\.lifetime_add\s*=\s*c\.lifetime_add\s*([+-])\s*([\d.]+)/g],
  ['knockback', /c\.knockback_force\s*=\s*c\.knockback_force\s*([+-])\s*([\d.]+)/g],
  ['speedAdd', /c\.speed_multiplier\s*=\s*c\.speed_multiplier\s*([+-])\s*([\d.]+)/g],
];
const DMG_MOD_RE = /c\.damage_([a-z]+)_add\s*=\s*c\.damage_\1_add\s*([+-])\s*([\d.]+)/g;
const SPEED_MUL_RE = /c\.speed_multiplier\s*=\s*c\.speed_multiplier\s*\*\s*([\d.]+)/g;
// 近似判定用:所有"与数值相关"的赋值行(未被上面模式消费 → 静态解析不了)
const STAT_ASSIGN_RE = /(?:c\.(?:fire_rate_wait|spread_degrees|damage_critical_chance|damage_[a-z]+_add|explosion_radius|bounces|lifetime_add|speed_multiplier|knockback_force)|current_reload_time)\s*=/g;
// 速度/爆炸半径钳制模板(增量之后的边界处理,遍布投射物法术,剔除后再做近似判定)
const CLAMP_RES = [
  /if\s*\(\s*c\.speed_multiplier\s*>=\s*20\s*\)\s*then[\s\S]*?\bend\b/g,
  /if\s*\(\s*c\.explosion_radius\s*<\s*0\s*\)\s*then[\s\S]*?\bend\b/g,
];

const round3 = (v) => Math.round(v * 1000) / 1000;

function extractSpellStats(body) {
  let cleaned = body;
  for (const re of CLAMP_RES) cleaned = cleaned.replace(re, '');
  const firstIf = cleaned.search(/\bif\b/);
  const inIf = (idx) => firstIf !== -1 && idx > firstIf;
  const stats = {};
  let approx = false;
  let consumed = 0;
  for (const [key, re] of STAT_DELTA_PATTERNS) {
    for (const m of cleaned.matchAll(re)) {
      stats[key] = round3((stats[key] ?? 0) + (m[1] === '-' ? -1 : 1) * Number(m[2]));
      consumed++;
      if (inIf(m.index)) approx = true; // 条件分支内的增量不一定生效
    }
  }
  for (const m of cleaned.matchAll(DMG_MOD_RE)) {
    stats.damageMods = stats.damageMods ?? {};
    stats.damageMods[m[1]] = round3((stats.damageMods[m[1]] ?? 0) + (m[2] === '-' ? -1 : 1) * Number(m[3]));
    consumed++;
    if (inIf(m.index)) approx = true;
  }
  for (const m of cleaned.matchAll(SPEED_MUL_RE)) {
    stats.speedMultiplier = round3((stats.speedMultiplier ?? 1) * Number(m[1]));
    consumed++;
    if (inIf(m.index)) approx = true;
  }
  const relevant = cleaned.match(STAT_ASSIGN_RE) ?? [];
  if (relevant.length > consumed) approx = true;
  // 净零值不输出(信息量为零,JSON 保持稀疏)
  for (const k of Object.keys(stats)) {
    if (stats[k] === 0 || (k === 'speedMultiplier' && stats[k] === 1)) delete stats[k];
  }
  if (stats.damageMods) {
    for (const k of Object.keys(stats.damageMods)) {
      if (stats.damageMods[k] === 0) delete stats.damageMods[k];
    }
    if (Object.keys(stats.damageMods).length === 0) delete stats.damageMods;
  }
  return { stats, approx };
}

function parseGunActions(lua) {
  const text = stripLuaComments(lua);
  // 以 id = "XXX" 为界切分各法术定义块
  const idRe = /\bid\s*=\s*"([A-Z0-9_]+)"/g;
  const marks = [];
  for (let m; (m = idRe.exec(text)); ) marks.push({ id: m[1], start: m.index });
  const spells = [];
  for (let i = 0; i < marks.length; i++) {
    const chunk = text.slice(marks[i].start, marks[i + 1]?.start ?? text.length);
    const field = (re) => chunk.match(re)?.[1];
    const nameKey = field(/\bname\s*=\s*"\$?([a-z0-9_]+)"/);
    const descKey = field(/\bdescription\s*=\s*"\$?([a-z0-9_]+)"/);
    // \bsprite 会匹配 sprite_unidentified,用前置断言排除
    const sprite = field(/(?<![_a-z])sprite\s*=\s*"([^"]+)"/);
    const typeName = field(/\btype\s*=\s*ACTION_TYPE_([A-Z_]+)/);
    const mana = field(/(?<![_a-z])mana\s*=\s*(-?[\d.]+)/);
    const maxUses = field(/\bmax_uses\s*=\s*(-?\d+)/);
    const price = field(/\bprice\s*=\s*(-?\d+)/);
    // 解锁旗标(persistent/flags/ 下的文件名);多数法术无此字段 = 天生解锁
    const unlockFlag = field(/\bspawn_requires_flag\s*=\s*"([a-z0-9_]+)"/);
    // 弹射物实体:related_projectiles 元数据优先,缺失时回退函数体首个 add_projectile*()
    const body = chunk.match(/\baction\s*=\s*function\s*\([^)]*\)([\s\S]*)$/)?.[1] ?? '';
    const projFile = field(/\brelated_projectiles\s*=\s*\{\s*"([^"]+)"/)
      ?? body.match(/\badd_projectile[a-z_]*\(\s*"([^"]+)"/)?.[1] ?? '';
    const { stats, approx } = extractSpellStats(body);
    spells.push({
      id: marks[i].id,
      key: nameKey ?? '',
      descKey: descKey ?? '',
      type: typeName ? typeName.toLowerCase() : 'other',
      sprite: sprite ?? '',
      mana: mana ?? '10', // gun.lua: ACTION_MANA_DRAIN_DEFAULT = 10
      maxUses: maxUses ?? '-1', // 未定义 = 无限
      price: price ?? '',
      unlockFlag: unlockFlag ?? '',
      projFile,
      ...stats,
      ...(approx ? { statsApprox: true } : {}),
    });
  }
  return spells;
}

// ---- perk_list.lua 解析 ------------------------------------------------------

/**
 * effect 型天赋附带 Lua func 时,注入效果实体复刻不了脚本部分。
 * 逐个核对 perk_list.lua 源码后的缺失说明(手工维护;impact 分级:
 *   none  = 只影响"与神关系"计数,可忽略
 *   minor = 缺外观/微调,核心收益完整
 *   cost  = 缺的是天赋的"代价",注入后比原版更强
 *   major = 缺招牌能力本体,注入后名不副实)。
 * 游戏更新出现未收录的 func 天赋时,回退为通用提示。
 */
const FUNC_NOTES = {
  BREATH_UNDERWATER: { impact: 'minor', note: '缺:游泳浮力/阻力微调。核心的水下呼吸完整生效。' },
  FASTER_LEVITATION: { impact: 'minor', note: '缺:下落重力微调(×1.4)。悬浮加速本体完整生效。' },
  EXPLODING_CORPSES: { impact: 'none', note: '缺:「与神的关系」计数 -1。尸爆与爆炸免疫完整生效。' },
  SAVING_GRACE: { impact: 'none', note: '缺:「与神的关系」计数 +1。免死保留 1 HP 完整生效。' },
  GLOBAL_GORE: { impact: 'none', note: '缺:「与神的关系」计数 -1。效果完整生效。' },
  RESPAWN: { impact: 'none', note: '缺:「与神的关系」计数 +1。死亡复活完整生效。' },
  VAMPIRISM: { impact: 'cost', note: '缺:血上限 -25% 的代价。吸血与食物中毒免疫生效 —— 注入后比原版天赋更强。' },
  GLASS_CANNON: { impact: 'cost', note: '缺:血上限锁定 50 的代价。5 倍伤害生效 —— 注入后比原版天赋更强。' },
  NO_WAND_EDITING: { impact: 'minor', note: '缺:+20% 敌人掉落血钱几率。注意:「禁止编辑法杖」的负面效果会生效,这是换取收益的诅咒类天赋。' },
  FREEZE_FIELD: { impact: 'major', note: '缺:冰冻光环本体(由脚本生成的子实体)。注入只获得附带的火焰免疫,拿不到招牌能力。' },
  ELECTRICITY: { impact: 'major', note: '缺:电击光环本体(由脚本生成的子实体)。注入只获得附带的电击免疫,拿不到招牌能力。' },
  BLEED_SLIME: { impact: 'minor', note: '缺:血液变粘液的外观与 25% 投射物减伤。「粘液不减速」生效。' },
  BLEED_OIL: { impact: 'minor', note: '缺:血液变油的外观。「火焰免疫」生效。' },
  BLEED_GAS: { impact: 'minor', note: '缺:血液变毒气的外观。「毒素免疫」生效。' },
  WORM_SMALLER_HOLES: { impact: 'major', note: '缺:缩小蠕虫洞的脚本(天赋主体)。注入只获得附带的驱虫效果。' },
};

/**
 * 解析 perk_list.lua。天赋 kind 分类(方案 §3.3):
 *  - effect:带 game_effect(注入 GameEffectComponent 即可获得核心收益);
 *  - complex:纯 func 实现(改组件数值/生成实体,存档层无法可靠复刻),默认禁用。
 * hasFunc 标记带 Lua func 的 effect 型天赋,缺失说明见 FUNC_NOTES。
 */
function parsePerkList(lua) {
  const text = stripLuaComments(lua);
  const idRe = /\bid\s*=\s*"([A-Z0-9_]+)"/g;
  const marks = [];
  for (let m; (m = idRe.exec(text)); ) marks.push({ id: m[1], start: m.index });
  const perks = [];
  for (let i = 0; i < marks.length; i++) {
    const chunk = text.slice(marks[i].start, marks[i + 1]?.start ?? text.length);
    const field = (re) => chunk.match(re)?.[1];
    const uiName = field(/\bui_name\s*=\s*"\$?([a-z0-9_]+)"/);
    const gameEffect = field(/\bgame_effect\s*=\s*"([A-Z0-9_]+)"/);
    const gameEffect2 = field(/\bgame_effect2\s*=\s*"([A-Z0-9_]+)"/);
    const hasFunc = /\bfunc\s*=\s*function/.test(chunk);
    const id = marks[i].id;
    const funcInfo = gameEffect && hasFunc
      ? FUNC_NOTES[id] ?? { impact: 'minor', note: '附带 Lua 脚本未收录说明,注入后收益可能不完整。' }
      : undefined;
    // 叠加/池子等静态元数据(稀疏输出:false/缺失不写)
    const stackableMax = field(/\bstackable_maximum\s*=\s*(\d+)/);
    const maxInPool = field(/\bmax_in_perk_pool\s*=\s*(\d+)/);
    const removeOther = chunk.match(/\bremove_other_perks\s*=\s*\{([^}]*)\}/)?.[1];
    perks.push({
      id,
      key: uiName ?? '',
      descKey: field(/\bui_description\s*=\s*"\$?([a-z0-9_]+)"/) ?? '',
      uiName: uiName ? `$${uiName}` : '',
      uiDescription: field(/\bui_description\s*=\s*"(\$?[a-z0-9_]+)"/) ?? '',
      uiIcon: field(/\bui_icon\s*=\s*"([^"]+)"/) ?? '',
      gameEffect: gameEffect ?? '',
      gameEffect2: gameEffect2 ?? '',
      stackable: /\bstackable\s*=\s*STACKABLE_YES/.test(chunk),
      kind: gameEffect ? 'effect' : 'complex',
      hasFunc,
      funcImpact: funcInfo?.impact ?? '',
      funcNote: funcInfo?.note ?? '',
      ...(stackableMax ? { stackableMax: Number(stackableMax) } : {}),
      ...(maxInPool ? { maxInPool: Number(maxInPool) } : {}),
      ...(/\bstackable_is_rare\s*=\s*true/.test(chunk) ? { stackableRare: true } : {}),
      ...(/\bone_off_effect\s*=\s*true/.test(chunk) ? { oneOff: true } : {}),
      ...(/\busable_by_enemies\s*=\s*true/.test(chunk) ? { usableByEnemies: true } : {}),
      ...(/\bdo_not_remove\s*=\s*true/.test(chunk) ? { doNotRemove: true } : {}),
      ...(removeOther
        ? { removeOtherPerks: [...removeOther.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]) }
        : {}),
    });
  }
  return perks;
}

// ---- common.csv 解析(取 en 与 zh-cn 列) -------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function buildTranslations(csvText) {
  const rows = parseCsv(csvText);
  const header = rows[0];
  const enCol = header.indexOf('en');
  const zhCol = header.indexOf('zh-cn');
  if (enCol === -1 || zhCol === -1) throw new Error('common.csv 缺少 en / zh-cn 列');
  const map = new Map();
  for (const r of rows.slice(1)) {
    if (r[0]) map.set(r[0], { en: r[enCol] ?? '', zh: r[zhCol] ?? '' });
  }
  return map;
}

// ---- 主流程 ------------------------------------------------------------------

const [gunActionsLua, perkListLua, commonCsv] = await Promise.all([
  fetchSource('scripts/gun/gun_actions.lua'),
  fetchSource('scripts/perks/perk_list.lua'),
  fetchSource('translations/common.csv'),
]);

const spells = parseGunActions(gunActionsLua);
const i18n = buildTranslations(commonCsv);

let missingZh = 0;
for (const s of spells) {
  const t = i18n.get(s.key);
  s.name = t?.en || s.id;
  s.nameZh = t?.zh || '';
  if (!s.nameZh) missingZh++;
  // 游戏内 tooltip 的描述文本(如 $actiondesc_bomb)
  const d = i18n.get(s.descKey);
  s.desc = d?.en || '';
  s.descZh = d?.zh || '';
  if (!ACTION_TYPES.includes(s.type)) {
    console.warn(`⚠ 未知法术类型 ${s.type}(${s.id}),按 other 处理`);
    s.type = 'other';
  }
  delete s.key;
  delete s.descKey;
}

// ---- 弹射物基础数值(damage / speed / lifetime / 爆炸)-------------------------
//
// gun_actions.lua 只写"对施法参数的增量";法术自身的基础伤害等在弹射物实体
// XML(related_projectiles 指向)里。逐个读取、展开 <Base> 后取
// ProjectileComponent 与其 config_explosion 子元素的数值。数值保持游戏内部
// 单位(伤害 ×25 = 游戏显示值,帧 ÷60 = 秒),换算只在前端 format.js 做。

const entParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
});
const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const projCache = new Map();
async function projectileStats(file) {
  if (projCache.has(file)) return projCache.get(file);
  let stats = null;
  try {
    const xml = await flattenEntity(file, (f) => fetchOptional(f.replace(/^data\//, '')));
    const ent = entParser.parse(xml).Entity ?? {};
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const out = {};
    for (const pc of asArray(ent.ProjectileComponent)) {
      out.damage ??= num(pc.damage);
      out.speedMin ??= num(pc.speed_min);
      out.speedMax ??= num(pc.speed_max);
      out.lifetime ??= num(pc.lifetime);
      const ce = asArray(pc.config_explosion)[0] ?? asArray(pc.ConfigExplosion)[0];
      if (ce) {
        out.explosionDamage ??= num(ce.damage);
        out.explosionRadius ??= num(ce.explosion_radius);
      }
      // 部分弹射物按类型分伤害(如近战/切割),单独归到 damageByType
      const dbt = asArray(pc.damage_by_type)[0];
      if (dbt) {
        for (const [k, v] of Object.entries(dbt)) {
          const n = num(v);
          if (n !== undefined && n !== 0) {
            out.damageByType = out.damageByType ?? {};
            out.damageByType[k] ??= n;
          }
        }
      }
    }
    for (const k of Object.keys(out)) {
      if (out[k] === undefined) delete out[k];
    }
    if (Object.keys(out).length > 0) stats = out;
  } catch {
    fetchFailures.push(file);
  }
  projCache.set(file, stats);
  return stats;
}

const withProjFile = spells.filter((s) => s.projFile).length;
let projHit = 0;
for (const s of spells) {
  if (s.projFile) {
    const st = await projectileStats(s.projFile);
    if (st) {
      s.projectile = { file: s.projFile, ...st };
      projHit++;
    }
  }
  delete s.projFile;
  // 手工覆盖表:人工核对的最终值;覆盖后视为已核实,清除近似标记
  const ov = SPELL_STAT_OVERRIDES[s.id];
  if (ov) {
    for (const [k, v] of Object.entries(ov)) {
      if (v === null) delete s[k];
      else s[k] = v;
    }
    delete s.statsApprox;
  }
}
console.log(`ℹ 弹射物数值:${projHit}/${withProjFile} 个法术取到基础数值`);
const approxIds = spells.filter((s) => s.statsApprox).map((s) => s.id);
if (approxIds.length) {
  console.warn(
    `⚠ ${approxIds.length} 个法术数值为近似(复核后补入 tools/spell-overrides.js):\n  ${approxIds.join(', ')}`,
  );
}

// 完整性检查
const noSprite = spells.filter((s) => !s.sprite);
if (spells.length < 400) {
  console.error(`✗ 法术数量异常: ${spells.length}(预期 ≈422),中止写出`);
  exit(1);
}
if (noSprite.length > 0) {
  console.warn(`⚠ ${noSprite.length} 个法术缺 sprite: ${noSprite.map((s) => s.id).join(', ')}`);
}

mkdirSync(dataOutDir, { recursive: true });
const outPath = join(dataOutDir, 'spells.json');
writeFileSync(outPath, JSON.stringify(spells, null, 2) + '\n', 'utf8');
console.log(`✓ 写出 ${outPath}: ${spells.length} 个法术(${missingZh} 个缺中文名)`);

// ---- perks.json --------------------------------------------------------------

const perks = parsePerkList(perkListLua);
let perkMissingZh = 0;
for (const p of perks) {
  const t = i18n.get(p.key);
  p.name = t?.en || p.id;
  p.nameZh = t?.zh || '';
  if (!p.nameZh) perkMissingZh++;
  // 游戏内 tooltip 的描述文本(如 $perkdesc_critical_hit)
  const d = i18n.get(p.descKey);
  p.desc = d?.en || '';
  p.descZh = d?.zh || '';
  delete p.key;
  delete p.descKey;
}
if (perks.length < 100) {
  console.error(`✗ 天赋数量异常: ${perks.length}(预期 ≈157),中止写出`);
  exit(1);
}
const perksPath = join(dataOutDir, 'perks.json');
writeFileSync(perksPath, JSON.stringify(perks, null, 2) + '\n', 'utf8');
const effectKind = perks.filter((p) => p.kind === 'effect').length;
console.log(
  `✓ 写出 ${perksPath}: ${perks.length} 个天赋` +
  `(effect 型 ${effectKind} / complex 型 ${perks.length - effectKind};${perkMissingZh} 个缺中文名)`,
);

// ---- materials.json ------------------------------------------------------------

// materials.xml:<CellData> 定义材料,<CellDataChild _parent="x"> 继承父项属性。
// kind 分类(供 UI 分组,由 cell_type + liquid_* 细分得来):
//   liquid = 可倒液体;powder = 粉末(liquid_sand);static = 静态液体(liquid_static,
//   如冰/岩浆凝固物);gas / fire / solid 直接沿用 cell_type。
function parseMaterials(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseTagValue: false,
    parseAttributeValue: false,
  });
  const root = parser.parse(xmlText).Materials ?? {};
  const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const defs = [...asArray(root.CellData), ...asArray(root.CellDataChild)];
  const byName = new Map(defs.map((a) => [a.name, a]));
  // 沿 _parent 链取首个非空属性(深度上限防环)
  const inherited = (attrs, key) => {
    for (let a = attrs, depth = 0; a && depth < 10; a = byName.get(a._parent), depth++) {
      if (a[key] !== undefined) return a[key];
    }
    return undefined;
  };
  const materials = [];
  for (const attrs of defs) {
    if (!attrs.name || typeof attrs.name !== 'string') continue;
    const cellType = inherited(attrs, 'cell_type') ?? 'solid';
    let kind = cellType;
    if (cellType === 'liquid') {
      if (inherited(attrs, 'liquid_sand') === '1') kind = 'powder';
      else if (inherited(attrs, 'liquid_static') === '1') kind = 'static';
    }
    // 简要属性(药水/材料详情用;稀疏输出:false/缺失不写)
    const flag = (key) => inherited(attrs, key) === '1';
    const statusEffects = inherited(attrs, 'status_effects');
    const hp = Number(inherited(attrs, 'hp'));
    materials.push({
      id: attrs.name,
      kind,
      uiKey: (inherited(attrs, 'ui_name') ?? '').replace(/^\$/, ''),
      ...(flag('burnable') ? { burnable: true } : {}),
      ...(flag('on_fire') ? { onFire: true } : {}),
      ...(statusEffects ? { statusEffects } : {}),
      ...(Number.isFinite(hp) && hp > 0 ? { hp } : {}),
      ...(flag('danger_fire') ? { dangerFire: true } : {}),
      ...(flag('danger_radioactive') ? { dangerRadioactive: true } : {}),
      ...(flag('danger_poison') ? { dangerPoison: true } : {}),
    });
  }
  return materials;
}

const materials = parseMaterials(await fetchSource('materials.xml'));
let matMissingZh = 0;
for (const m of materials) {
  const t = m.uiKey ? i18n.get(m.uiKey) : undefined;
  m.name = t?.en || m.id;
  m.nameZh = t?.zh || '';
  if (!m.nameZh) matMissingZh++;
  delete m.uiKey;
}
if (materials.length < 200) {
  console.error(`✗ 材料数量异常: ${materials.length}(预期 ≈400+),中止写出`);
  exit(1);
}
const materialsPath = join(dataOutDir, 'materials.json');
writeFileSync(materialsPath, JSON.stringify(materials, null, 2) + '\n', 'utf8');
const kindCount = {};
for (const m of materials) kindCount[m.kind] = (kindCount[m.kind] ?? 0) + 1;
console.log(
  `✓ 写出 ${materialsPath}: ${materials.length} 种材料` +
  `(${Object.entries(kindCount).map(([k, n]) => `${k} ${n}`).join(' / ')};${matMissingZh} 个缺中文名)`,
);

// ---- effects.json 增强(合并式;手工字段永不覆写)------------------------------
//
// data/effects.json 以 GAME_EFFECT 枚举为准、手工维护(nameZh/group/danger/
// recommended/selectable/icon 为策展字段,永不生成覆写)。这里从游戏数据补
// "生成字段"(GENERATED_EFFECT_KEYS):
//   status_list.lua → 英文名 + 中英描述 + 有害/防火;
//   效果实体 XML(GameEffectComponent)→ effect 枚举 id(桥接)+ frames 默认时长。
// 合并规则:只写生成键,不删条目、不自动新增条目,条目顺序保持不变。

const GENERATED_EFFECT_KEYS = ['name', 'desc', 'descZh', 'durationFrames', 'protectsFromFire', 'isHarmful'];

function parseStatusList(lua) {
  const text = stripLuaComments(lua);
  const idRe = /\bid\s*=\s*"([A-Z0-9_]+)"/g;
  const marks = [];
  for (let m; (m = idRe.exec(text)); ) marks.push({ id: m[1], start: m.index });
  const entries = [];
  for (let i = 0; i < marks.length; i++) {
    const chunk = text.slice(marks[i].start, marks[i + 1]?.start ?? text.length);
    const field = (re) => chunk.match(re)?.[1];
    entries.push({
      id: marks[i].id,
      key: field(/\bui_name\s*=\s*"\$?([a-z0-9_]+)"/) ?? '',
      descKey: field(/\bui_description\s*=\s*"\$?([a-z0-9_]+)"/) ?? '',
      effectEntity: field(/\beffect_entity\s*=\s*"([^"]+)"/) ?? '',
      protectsFromFire: /\bprotects_from_fire\s*=\s*true/.test(chunk),
      isHarmful: /\bis_harmful\s*=\s*true/.test(chunk),
    });
  }
  return entries;
}

/** 读效果实体 XML,取 GameEffectComponent 的 effect 枚举 id 与 frames。 */
async function gameEffectInfo(file, quiet = false) {
  try {
    const xml = await flattenEntity(file, (f) => fetchOptional(f.replace(/^data\//, ''), quiet));
    const ent = entParser.parse(xml).Entity ?? {};
    for (const ge of asArray(ent.GameEffectComponent)) {
      const frames = Number(ge.frames);
      return { effectId: ge.effect ?? '', frames: Number.isFinite(frames) ? frames : undefined };
    }
  } catch {
    if (!quiet) fetchFailures.push(file);
  }
  return null;
}

const statusEntries = parseStatusList(await fetchSource('scripts/status_effects/status_list.lua'));
// GAME_EFFECT 枚举 id → 生成字段。status_list 条目 id 是"状态污渍" id
// (WET/POISONED...),与 GAME_EFFECT 枚举不完全同名;真正的桥接是 effect_entity
// XML 里 GameEffectComponent 的 effect 属性。两个键都登记,同名者兜底。
const genByEffect = new Map();
for (const st of statusEntries) {
  const t = i18n.get(st.key);
  const d = i18n.get(st.descKey);
  const info = st.effectEntity ? await gameEffectInfo(st.effectEntity) : null;
  const gen = {
    name: t?.en || '',
    desc: d?.en || '',
    descZh: d?.zh || '',
    ...(info?.frames > 0 ? { durationFrames: info.frames } : {}),
    ...(st.protectsFromFire ? { protectsFromFire: true } : {}),
    ...(st.isHarmful ? { isHarmful: true } : {}),
  };
  if (info?.effectId && info.effectId !== 'CUSTOM') genByEffect.set(info.effectId, gen);
  if (!genByEffect.has(st.id)) genByEffect.set(st.id, gen);
}

const effectsPath = join(dataOutDir, 'effects.json');
const effects = JSON.parse(readFileSync(effectsPath, 'utf8'));
const effectIdSet = new Set(effects.map((e) => e.id));
let effEnriched = 0;
let effWithDuration = 0;
for (const e of effects) {
  let gen = genByEffect.get(e.id);
  if (!gen) {
    // 无 status_list 桥接的枚举:按命名惯例探测效果实体 XML,至少补默认时长
    const info = await gameEffectInfo(`data/entities/misc/effect_${e.id.toLowerCase()}.xml`, true);
    if (info?.frames > 0) gen = { durationFrames: info.frames };
  }
  if (!gen) continue;
  for (const k of GENERATED_EFFECT_KEYS) {
    if (gen[k] !== undefined && gen[k] !== '') e[k] = gen[k];
  }
  effEnriched++;
  if (e.durationFrames) effWithDuration++;
}
const statusOrphans = statusEntries.filter((s) => !effectIdSet.has(s.id)).map((s) => s.id);
// 保持原文件"每条一行"的紧凑格式,便于人工维护与 diff 审查
const fmtEffect = (e) =>
  '  { ' + Object.entries(e).map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(', ') + ' }';
writeFileSync(effectsPath, '[\n' + effects.map(fmtEffect).join(',\n') + '\n]\n', 'utf8');
console.log(
  `✓ 合并 ${effectsPath}: ${effects.length} 条(补生成字段 ${effEnriched} 条,含默认时长 ${effWithDuration} 条)`,
);
if (statusOrphans.length) {
  console.log(`ℹ status_list 中存在但 effects.json 未收录(仅提示,不自动新增): ${statusOrphans.join(', ')}`);
}

// ---- wands.json(法杖外观字典,§12)---------------------------------------------

// wands.lua:1000 条外观模板 {name, file, grip_x/grip_y(握把), tip_x/tip_y(杖尖)}。
// 游戏赋值逻辑(gun_procedural.lua 的 SetWandSprite 调用点):
//   AbilityComponent.sprite_file / SpriteComponent.image_file ← file;
//   SpriteComponent.offset_x/offset_y ← grip;
//   HotspotComponent(shoot_pos).offset ← tip − grip。
// 构建期把公式算成"最终写入值",服务端零公式知识。name 是开发用标签(仅 24 个
// 去重值,非游戏内名称),UI 作次要展示。
function parseWands(lua) {
  const text = stripLuaComments(lua);
  const wands = [];
  // 条目为最内层 {} 块(条目内无嵌套表);无 file 字段的块(如别的顶层表)跳过
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    const block = m[1];
    const field = (re) => block.match(re)?.[1];
    const file = field(/\bfile\s*=\s*"([^"]+)"/);
    if (!file) continue;
    const num = (key) => {
      const v = field(new RegExp(`\\b${key}\\s*=\\s*(-?[\\d.]+)`));
      if (v === undefined) throw new Error(`wands.lua 条目缺 ${key}: ${file}`);
      return Number(v);
    };
    const gripX = num('grip_x');
    const gripY = num('grip_y');
    wands.push({
      id: file.replace(/^.*\//, '').replace(/\.[a-z]+$/, ''),
      file,
      name: field(/\bname\s*=\s*"([^"]*)"/) ?? '',
      offsetX: gripX,
      offsetY: gripY,
      hotspotX: num('tip_x') - gripX,
      hotspotY: num('tip_y') - gripY,
      rectAnim: '',
    });
  }
  return wands;
}

const wandLooks = parseWands(await fetchSource('scripts/gun/procedural/wands.lua'));
// 初始杖(精灵定义 xml):实体上 SpriteComponent offset=(0,0)(偏移由精灵 xml 自带),
// rect_animation="default";枪口取实体模板 starting_wand_rng.xml /
// starting_bomb_wand_rng.xml 实测值(§12.1,与本仓库 save00 在手杖逐字段吻合)。
wandLooks.push(
  {
    id: 'handgun', file: 'data/items_gfx/handgun.xml', name: 'Starting wand',
    offsetX: 0, offsetY: 0, hotspotX: 8, hotspotY: -0.5, rectAnim: 'default',
  },
  {
    id: 'bomb_wand', file: 'data/items_gfx/bomb_wand.xml', name: 'Starting bomb wand',
    offsetX: 0, offsetY: 0, hotspotX: 6, hotspotY: -0.5, rectAnim: 'default',
  },
);
const wandDupes = wandLooks.length - new Set(wandLooks.map((w) => w.file)).size;
if (wandLooks.length < 900 || wandDupes > 0) {
  console.error(`✗ 法杖外观数量异常: ${wandLooks.length} 条 / file 重复 ${wandDupes}(预期 1002 / 0),中止写出`);
  exit(1);
}
const wandsPath = join(dataOutDir, 'wands.json');
writeFileSync(wandsPath, JSON.stringify(wandLooks, null, 2) + '\n', 'utf8');
console.log(`✓ 写出 ${wandsPath}: ${wandLooks.length} 个法杖外观(含 2 个初始杖)`);

// ---- 汇总:法术解锁旗标 ---------------------------------------------------------

const unlockFlags = new Set(spells.map((s) => s.unlockFlag).filter(Boolean));
console.log(`ℹ 法术解锁旗标 ${unlockFlags.size} 个(spells.json unlockFlag 字段)`);

if (fetchFailures.length) {
  const uniq = [...new Set(fetchFailures)];
  console.warn(`⚠ ${uniq.length} 个增强数据文件读取失败(对应数值缺失):\n  ${uniq.join('\n  ')}`);
}
