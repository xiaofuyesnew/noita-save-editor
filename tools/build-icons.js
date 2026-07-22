// 图标资源提取工具 —— 从游戏数据提取 UI 图标 PNG,供前端展示法术/天赋/道具/
// 敌人(boss)/状态效果的原版像素图标。
//
// 与 build-dict.js / build-items.js 同源同风格:结果直接提交仓库,运行时零依赖;
// 仅在游戏版本更新或增补类别时手动重跑。
//
// 输入优先级:
//   1. --wak <file>   本机 data.wak(权威;默认自动探测常见 Steam/本地路径)
//   2. --data <dir>   已解包的游戏 data/ 目录
//
// 输出:frontend/public/icons/<类别>/<名称>.png(Vite 会把 public/ 原样并入
// dist,开发与构建两种模式下均以 /icons/... 提供)。字典里记录的 sprite 路径
// (如 data/ui_gfx/gun_actions/bomb.png)按固定规则映射到输出:
//   'data/ui_gfx/' 前缀 → '/icons/'
//   'data/items_gfx/wands/' 前缀 → '/icons/wands/'(法杖外观,§12)
//   'data/items_gfx/(handgun|bomb_wand).xml' → '/icons/wands/$1.png'(初始杖)
// 前端据此直接引用,无需额外清单文件。
//
// 提取完成后与 data/*.json 字典交叉校验:凡字典引用到而未提取出的路径逐条告警
// (说明游戏数据缺失或字典 sprite 字段有误);wands.json 每条外观同样校验预览图。
//
// 用法(在仓库根目录下):
//   node tools/build-icons.js
//   node tools/build-icons.js --wak "D:/games/Noita/data/data.wak"
//   node tools/build-icons.js --data "C:/games/noita-extracted/data"

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argv, exit } from 'node:process';

const toolsDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(toolsDir, '..');
const iconsOutDir = join(repoRoot, 'frontend', 'public', 'icons');

// 提取的类别(data/ui_gfx/ 下的子目录)。整目录提取而非只取字典引用到的文件,
// 后续字典增补(如敌人/boss 接入)无需重跑本工具。
const CATEGORIES = [
  'gun_actions', // 法术卡图标(spells.json sprite)
  'perk_icons', // 天赋图标(perks.json uiIcon)
  'items', // 道具图标(items.json uiSprite)
  'animal_icons', // 敌人/boss 图标(boss_* 等,进度/图鉴类功能备用)
  'status_indicators', // 状态效果 HUD 图标(effects.json icon)
  'inventory', // 物品栏 UI(法术类型底图 item_bg_*.png 等,spell_types.json itemBg)
];
const UI_GFX_PREFIX = 'data/ui_gfx/';

// 法杖外观贴图(§12):data/items_gfx/wands/ 整目录 → icons/wands/(保留 custom/
// 子目录),外加初始杖精灵表 handgun.png / bomb_wand.png。映射规则:
//   'data/items_gfx/wands/' 前缀 → '/icons/wands/'
//   'data/items_gfx/(handgun|bomb_wand).xml' → '/icons/wands/$1.png'(字典两条
//   .xml 外观的预览特例;单帧精灵表整图仅 1px 边框差,不引入 PNG 裁剪依赖)
const WANDS_GFX_PREFIX = 'data/items_gfx/wands/';
const WANDS_OUT_SUBDIR = 'wands';
const STARTER_SHEETS = ['data/items_gfx/handgun.png', 'data/items_gfx/bomb_wand.png'];

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

// ---- 资源枚举与读取 -----------------------------------------------------------
//
// wak 布局同 build-items.js:16 字节头 [magic, numFiles, dataStart, 保留],
// 随后 numFiles 条目 [offset u32, size u32, nameLen u32, name(latin1)]。
// 这里按二进制 Buffer 取数据(build-items.js 只需文本,此处是 PNG)。

/** 打开 wak,返回 { list(prefix) → 路径数组, read(relPath) → Buffer|null }。 */
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
  return {
    list: (prefix) => [...index.keys()].filter((n) => n.startsWith(prefix)),
    read: (relPath) => {
      const f = index.get(relPath);
      return f ? buf.subarray(f.off, f.off + f.size) : null;
    },
  };
}

/** 递归枚举解包目录下某相对目录里的全部文件(返回 data/ 开头的相对路径)。 */
function listDiskDir(rootDir, relDir) {
  const abs = join(rootDir, relDir.replace(/^data\//, ''));
  if (!existsSync(abs)) return [];
  const out = [];
  for (const ent of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${relDir}${ent.name}`;
    if (ent.isDirectory()) out.push(...listDiskDir(rootDir, `${rel}/`));
    else out.push(rel);
  }
  return out;
}

/** 构造统一取源:{ list(prefix), read(relPath) → Buffer|null }。 */
function makeSource() {
  if (dataArg) {
    return {
      list: (prefix) => listDiskDir(dataArg, prefix),
      read: (relPath) => {
        const p = join(dataArg, relPath.replace(/^data\//, ''));
        return existsSync(p) ? readFileSync(p) : null;
      },
    };
  }
  const wak = WAK_GUESSES.find((p) => existsSync(p));
  if (!wak) {
    console.error('找不到 data.wak,请用 --wak <文件> 或 --data <解包目录> 指定游戏数据。');
    console.error('探测过的路径:\n  ' + WAK_GUESSES.join('\n  '));
    exit(1);
  }
  console.log(`读取 data.wak: ${wak}`);
  return openWak(wak);
}

// ---- 字典交叉校验 -------------------------------------------------------------

/** 收集 data/*.json 字典引用到的全部 sprite 路径。 */
function collectDictSprites() {
  const readDict = (name) => {
    const p = join(repoRoot, 'data', name);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
  };
  const paths = new Set();
  for (const s of readDict('spells.json')) s.sprite && paths.add(s.sprite);
  for (const k of readDict('perks.json')) k.uiIcon && paths.add(k.uiIcon);
  for (const i of readDict('items.json')) i.uiSprite && paths.add(i.uiSprite);
  for (const e of readDict('effects.json')) e.icon && paths.add(e.icon);
  return paths;
}

// ---- 构建 --------------------------------------------------------------------

function build() {
  const source = makeSource();

  let total = 0;
  const extracted = new Set();
  for (const cat of CATEGORIES) {
    const prefix = `${UI_GFX_PREFIX}${cat}/`;
    const files = source.list(prefix).filter((n) => n.toLowerCase().endsWith('.png'));
    let count = 0;
    for (const relPath of files) {
      const data = source.read(relPath);
      if (!data) {
        console.warn(`✗ 读取失败: ${relPath}`);
        continue;
      }
      const outPath = join(iconsOutDir, relPath.slice(UI_GFX_PREFIX.length));
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, data);
      extracted.add(relPath);
      count++;
    }
    total += count;
    console.log(`✓ ${cat.padEnd(18)} ${count} 张`);
  }

  // 法杖外观贴图(§12):items_gfx/wands/ 整目录 + 初始杖精灵表
  const wandOut = new Set(); // icons/wands/ 下的相对路径(交叉校验用)
  let wandCount = 0;
  const putWand = (relOut, data) => {
    const outPath = join(iconsOutDir, WANDS_OUT_SUBDIR, relOut);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, data);
    wandOut.add(relOut);
    wandCount++;
  };
  for (const relPath of source.list(WANDS_GFX_PREFIX).filter((n) => n.toLowerCase().endsWith('.png'))) {
    const data = source.read(relPath);
    if (!data) {
      console.warn(`✗ 读取失败: ${relPath}`);
      continue;
    }
    putWand(relPath.slice(WANDS_GFX_PREFIX.length), data);
  }
  for (const sheet of STARTER_SHEETS) {
    const data = source.read(sheet);
    if (!data) {
      console.warn(`✗ 读取失败: ${sheet}`);
      continue;
    }
    putWand(sheet.replace(/^.*\//, ''), data);
  }
  total += wandCount;
  console.log(`✓ ${'wands'.padEnd(18)} ${wandCount} 张`);
  console.log(`\n提取 ${total} 张图标 → ${iconsOutDir}`);

  // 字典引用覆盖校验
  const referenced = collectDictSprites();
  const missing = [...referenced].filter((p) => !extracted.has(p));
  if (missing.length) {
    console.warn(`\n${missing.length} 个字典引用的图标未提取到(检查类别或 sprite 字段):`);
    for (const p of missing) console.warn(`  - ${p}`);
    exit(1);
  }
  console.log(`字典引用交叉校验通过(${referenced.size} 个引用全部覆盖)。`);

  // wands.json 交叉校验:每条外观的预览图必须已提取
  // (png 条目 → wands/<相对路径>;初始杖 xml 条目 → wands/<id>.png)
  const wandsDictPath = join(repoRoot, 'data', 'wands.json');
  if (existsSync(wandsDictPath)) {
    const previewRel = (file) => {
      if (file.startsWith(WANDS_GFX_PREFIX)) return file.slice(WANDS_GFX_PREFIX.length);
      const m = file.match(/^data\/items_gfx\/(handgun|bomb_wand)\.xml$/);
      return m ? `${m[1]}.png` : null;
    };
    const wandDict = JSON.parse(readFileSync(wandsDictPath, 'utf8'));
    const missingWand = wandDict.filter((e) => {
      const rel = previewRel(e.file);
      return !rel || !wandOut.has(rel);
    });
    if (missingWand.length) {
      console.warn(`\n${missingWand.length} 个法杖外观的预览图未提取到(检查 wands.json file 字段):`);
      for (const e of missingWand.slice(0, 20)) console.warn(`  - ${e.file}`);
      exit(1);
    }
    console.log(`法杖外观交叉校验通过(${wandDict.length} 条预览全部覆盖)。`);
  }
}

build();
