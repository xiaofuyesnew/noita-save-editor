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
import { flattenEntity, openWak } from './lib/gamedata.js';

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
// wak 读取与 <Base> 展开逻辑在 tools/lib/gamedata.js(与 build-dict.js 共享)。

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

async function build() {
  const read = makeReader();
  const translations = parseTranslations(read);

  const items = [];
  const failed = [];
  for (const { id, group } of CATALOG) {
    const relPath = `data/entities/items/pickup/${id}.xml`;
    try {
      const entity = await flattenEntity(relPath, read);
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
        desc: uiDesc ? desc.en : '',
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

await build();
