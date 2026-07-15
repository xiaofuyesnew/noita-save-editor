// 物品目录构建工具 —— 从游戏数据生成 data/items.json,供「物品栏」功能注入
// 快捷栏可手持的宝藏道具(邪王真眼 / 各类法术石 / 月亮 / 骰子等)。
//
// 与 build-dict.js 同源同风格:结果直接提交仓库,运行时零依赖;仅在游戏
// 版本更新或增补道具时手动重跑。
//
// 输入优先级:
//   1. --wak <file>   本机 data.wak(权威;默认自动探测常见 Steam/本地路径)
//   2. --data <dir>   已解包的游戏 data/ 目录
//
// 关键处理:
//   - 每个道具实体递归展开 <Base file> include,得到与 player.xml 一致的
//     "全展开" 实体(player.xml 内 0 个 <Base>,注入前必须先摊平);
//   - 从 translations/common.csv 解析 item_name → {en, zh} 显示名;
//   - 输出的 entity 字段是可直接解析注入的实体 XML 文本(仍含 pickup 世界态
//     tags/组件,注入时由 model/items.js 规整为在手形态)。
//
// 用法(在仓库根目录下):
//   node tools/build-items.js
//   node tools/build-items.js --wak "D:/games/Noita/data/data.wak"
//   node tools/build-items.js --data "C:/games/noita-extracted/data"

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';
import { argv, exit } from 'node:process';

const toolsDir = fileURLToPath(new URL('.', import.meta.url));
const dataOutDir = join(toolsDir, '..', 'data');

// ---- 参数 -------------------------------------------------------------------

function argValue(flag) {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}
const wakArg = argValue('--wak');
const dataArg = argValue('--data');

// data.wak 常见位置(本机自动探测)
const WAK_GUESSES = [
  wakArg,
  'C:/Program Files (x86)/Steam/steamapps/common/Noita/data/data.wak',
  'D:/Steam/steamapps/common/Noita/data/data.wak',
  'D:/games/Noita.v25.01.2025/data/data.wak',
  'E:/games/Noita/data/data.wak',
].filter(Boolean);

// ---- data.wak 读取 -----------------------------------------------------------
//
// wak 布局(实测):16 字节头 [magic u32, numFiles u32, dataStart u32, 保留 u32],
// 随后 numFiles 条目 [offset u32, size u32, nameLen u32, name(latin1)],
// 之后是文件数据区。

function openWak(path) {
  const buf = readFileSync(path);
  let p = 0;
  const u32 = () => {
    const v = buf.readUInt32LE(p);
    p += 4;
    return v;
  };
  u32(); // magic
  const numFiles = u32();
  u32(); // dataStart
  u32(); // 保留
  const index = new Map();
  for (let i = 0; i < numFiles; i++) {
    const off = u32();
    const size = u32();
    const nl = u32();
    const name = buf.toString('latin1', p, p + nl);
    p += nl;
    index.set(name, { off, size });
  }
  return (relPath) => {
    const f = index.get(relPath);
    return f ? buf.toString('utf8', f.off, f.off + f.size) : null;
  };
}

/** 构造 read(relPath) → 文本|null 的取源函数(wak 或解包目录)。 */
function makeReader() {
  if (dataArg) {
    return (relPath) => {
      const p = join(dataArg, relPath.replace(/^data\//, ''));
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    };
  }
  const wak = WAK_GUESSES.find((p) => existsSync(p));
  if (!wak) {
    console.error('找不到 data.wak,请用 --wak <文件> 或 --data <解包目录> 指定游戏数据。');
    console.error('探测过的路径:\n  ' + WAK_GUESSES.join('\n  '));
    exit(1);
  }
  console.log(`读取 data.wak: ${wak}`);
  const fromWak = openWak(wak);
  // 部分资源(如 translations/common.csv)不在 wak 内,与 wak 同级放在磁盘
  // 的 data/ 目录里 —— wak 命中失败时回退磁盘。
  const diskDataDir = dirname(wak); // .../Noita/data
  return (relPath) => {
    const hit = fromWak(relPath);
    if (hit !== null) return hit;
    const p = join(diskDataDir, relPath.replace(/^data\//, ''));
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
}

// ---- <Base> 展开 -------------------------------------------------------------
//
// Noita 实体用 <Base file="..."> 引入模板,子实体可覆盖/追加组件。player.xml
// 存的是全展开结果,因此注入前必须把 Base 摊平。这里做的是结构无关的"文本级"
// 内联:把 <Base file="X"> ... </Base>(或自闭合)替换为 X 的 <Entity> 内层
// 内容,再把 Base 标签自身携带的内层子节点续在其后(游戏语义:Base 的子节点
// 追加到被引入实体上)。递归处理嵌套 Base。

/** 取 xml 文本里根 <Entity ...> ... </Entity> 的内层内容(去掉最外层标签)。 */
function innerOfEntity(xml) {
  const open = xml.match(/<Entity\b[^>]*>/);
  if (!open) throw new Error('实体 XML 缺少 <Entity> 根');
  const start = open.index + open[0].length;
  const end = xml.lastIndexOf('</Entity>');
  if (end === -1) throw new Error('实体 XML 缺少 </Entity> 闭合');
  return xml.slice(start, end);
}

/** 展开一段内层内容里的全部 <Base>,read 用于取被引入文件。 */
function expandBases(inner, read, seen = []) {
  const BASE_RE = /<Base\b([^>]*)\bfile="([^"]+)"([^>]*)(\/>|>([\s\S]*?)<\/Base>)/g;
  return inner.replace(BASE_RE, (_m, _a, file, _b, tail, baseInner) => {
    if (seen.includes(file)) throw new Error(`Base 循环引用: ${file}`);
    const xml = read(file);
    if (!xml) throw new Error(`Base 引入的文件缺失: ${file}`);
    const importedInner = expandBases(innerOfEntity(xml), read, [...seen, file]);
    // 被引入实体内容 + Base 标签自身的内层子节点(追加语义)
    const extra = tail === '/>' ? '' : (baseInner ?? '');
    return importedInner + '\n' + expandBases(extra, read, seen);
  });
}

/** 读道具 pickup 实体并全展开为独立 <Entity> XML(不含任何 <Base>)。 */
function flattenEntity(relPath, read) {
  const xml = read(relPath);
  if (!xml) throw new Error(`道具实体缺失: ${relPath}`);
  const open = xml.match(/<Entity\b[^>]*>/)[0];
  const inner = expandBases(innerOfEntity(xml), read, [relPath]);
  return dedupeTagAttrs(`${open}\n${inner}\n</Entity>\n`);
}

/**
 * 去除元素开标签内的重复属性(个别原版文件自带,如 powder_stash.xml 的
 * MaterialInventoryComponent 写了两次 leak_pressure_min;游戏解析器宽容,
 * 我们的严格解析器会拒绝)。保留最后一次出现的值(与"后写覆盖"语义一致),
 * 属性顺序按首次出现;无重复的标签保持原文不动。
 */
function dedupeTagAttrs(xml) {
  return xml.replace(/<[A-Za-z_][^<>]*>/g, (tag) => {
    const values = new Map();
    let count = 0;
    for (const m of tag.matchAll(/([\w.]+)="([^"]*)"/g)) {
      count++;
      values.set(m[1], m[2]);
    }
    if (count === values.size) return tag;
    const name = tag.match(/^<([\w.]+)/)[1];
    const attrs = [...values.entries()].map(([k, v]) => `${k}="${v}"`).join(' ');
    const close = /\/>\s*$/.test(tag) ? ' />' : ' >';
    return `<${name} ${attrs}${close}`;
  });
}

// ---- 翻译 --------------------------------------------------------------------

/** 解析 common.csv,返回 key → {en, zh}。列:0=key,1=en,9=zh-cn。 */
function parseTranslations(read) {
  const csv = read('data/translations/common.csv');
  const map = new Map();
  if (!csv) return map;
  for (const line of csv.split(/\r?\n/)) {
    if (!line || line.startsWith(',')) continue;
    const cols = line.split(',');
    const key = cols[0];
    if (!key) continue;
    map.set(key, { en: (cols[1] || '').trim(), zh: (cols[9] || '').trim() });
  }
  return map;
}

/** item_name(形如 $item_evil_eye 或 item_evil_eye)→ 显示名。 */
function resolveName(itemName, translations) {
  const key = String(itemName || '').replace(/^\$/, '');
  const hit = translations.get(key);
  return {
    en: hit?.en || key || '',
    zh: hit?.zh || hit?.en || key || '',
  };
}

// ---- 目录定义 ----------------------------------------------------------------
//
// 精选"可手持、单实体、放快捷栏有意义"的宝藏道具,外加药水瓶/粉末袋空容器
// (注入时由 model/items.js 剥离随机化脚本并置空,内容走药水编辑)。刻意排除:
// 纯拾取即触发类(心/血钱/金块/perk/spell_refresh)、法术卡(random_card,
// 归法术功能)、宝箱(chest_*,拾取即开)。
// group 用于 UI 分组;id 即 pickup 文件名(不含扩展名)。

const CATALOG = [
  // —— 眼与法术石(手持持续发射) ——
  { id: 'evil_eye', group: 'staff' },
  { id: 'thunderstone', group: 'staff' },
  { id: 'brimstone', group: 'staff' },
  { id: 'waterstone', group: 'staff' },
  { id: 'beamstone', group: 'staff' },
  { id: 'musicstone', group: 'staff' },
  { id: 'poopstone', group: 'staff' },
  { id: 'stonestone', group: 'staff' },
  { id: 'wandstone', group: 'staff' },
  { id: 'moon', group: 'staff' },
  { id: 'broken_wand', group: 'staff' },
  { id: 'safe_haven', group: 'staff' },
  // —— 神秘物件 ——
  { id: 'physics_die', group: 'curio' },
  { id: 'physics_greed_die', group: 'curio' },
  { id: 'egg_purple', group: 'curio' },
  { id: 'egg_slime', group: 'curio' },
  { id: 'egg_monster', group: 'curio' },
  { id: 'gourd', group: 'curio' },
  // —— 药水瓶与粉末袋(空容器) ——
  { id: 'potion', group: 'container' },
  { id: 'powder_stash', group: 'container' },
];

// ---- 构建 --------------------------------------------------------------------

function build() {
  const read = makeReader();
  const translations = parseTranslations(read);

  const items = [];
  const failed = [];
  for (const { id, group } of CATALOG) {
    const relPath = `data/entities/items/pickup/${id}.xml`;
    try {
      const entity = flattenEntity(relPath, read);
      const rawItemName = entity.match(/item_name="([^"]*)"/)?.[1] || '';
      const uiSprite = entity.match(/ui_sprite="([^"]*)"/)?.[1] || '';
      const uiDesc = entity.match(/ui_description="([^"]*)"/)?.[1] || '';
      const { en, zh } = resolveName(rawItemName, translations);
      const desc = resolveName(uiDesc, translations);
      items.push({
        id,
        group,
        itemName: rawItemName,
        name: en,
        nameZh: zh,
        descZh: uiDesc ? desc.zh : '',
        uiSprite,
        entity,
      });
      if (posix.basename(relPath)) {
        console.log(`✓ ${id.padEnd(18)} ${zh} / ${en}`);
      }
    } catch (e) {
      failed.push({ id, error: String(e.message || e) });
      console.warn(`✗ ${id}: ${e.message}`);
    }
  }

  mkdirSync(dataOutDir, { recursive: true });
  const outPath = join(dataOutDir, 'items.json');
  writeFileSync(outPath, JSON.stringify(items, null, 2) + '\n', 'utf8');
  console.log(`\n写入 ${items.length} 个道具 → ${outPath}`);
  if (failed.length) {
    console.warn(`${failed.length} 个失败: ${failed.map((f) => f.id).join(', ')}`);
  }
}

build();
