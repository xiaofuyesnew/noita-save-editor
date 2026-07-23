// 应用图标生成器:手绘像素母版(32×32 与 16×16)→ 多尺寸整数倍放大 →
//   build/icon.ico(exe 资源/资源管理器预览,electron/icon.ico 为其运行时副本)
//   + frontend/public/favicon.png(浏览器模式标签页图标)
// 题材与配色对齐游戏本体:紫袍兜帽巫师 + 金色药水瓶,调色板取自仓库内的
// 游戏精灵图(animal_icons/player.png、items/potion.png、items/goldnugget.png)。
//
// 用法:node scripts/icon/generate.mjs [--emit]
//   默认只渲染预览拼图到 tools/.cache/icon-draft.png(供人工审阅)
//   --emit 额外写出上述三个正式产物
import fs from 'node:fs';
import path from 'node:path';
import { encodeIco } from './icolib.mjs';
import { blit, createCanvas, encodePng, scaleNearest } from './pnglib.mjs';

const root = path.resolve(import.meta.dirname, '../..');

// ---------- 调色板(采样自游戏精灵) ----------
const hex = (s, a = 255) => [Number.parseInt(s.slice(1, 3), 16), Number.parseInt(s.slice(3, 5), 16), Number.parseInt(s.slice(5, 7), 16), a];
const PALETTE = {
  'h': hex('#9b6f9a'), // 袍·亮(player.png)
  'm': hex('#7f5476'), // 袍·中
  'd': hex('#594354'), // 袍·暗
  'k': hex('#272125'), // 兜帽阴影/脸部暗面(player.png)
  'e': hex('#f5de91'), // 发光眼/金高光(player.png 腰带高光)
  'g': hex('#d19b3d'), // 金·中(player.png 腰带)
  'y': hex('#b07e13'), // 金·深(goldnugget.png)
  'Y': hex('#fae27e'), // 金·浅(goldnugget.png)
  'W': hex('#ffffff'), // 气泡/星光
  'c': hex('#c3c3c3'), // 玻璃·亮(potion.png)
  's': hex('#959595'), // 玻璃·中
  'w': hex('#777777'), // 玻璃·暗
};

// ---------- 母版像素画 ----------
// 32×32:巫师半身像(金眼、金领扣)+ 金色药水瓶,左上两点星光
const ART32 = [
  '................................',
  '................................',
  '................mm..............',
  '..............mhhm..............',
  '.............mhhhm..............',
  '.....g......mhhhhm..............',
  '....e......mhhhhhhm.............',
  '..........mhhhhhhddm............',
  '.........mhhhhhhhhddm...........',
  '........mhhhhhhhhhhddm..........',
  '........mhhddddddddhdm....g.....',
  '.......mhhdkkkkkkkkdhdm.........',
  '.......mhhdkeekkeekdhdm.........',
  '.......mhhdkgkkkkgkdhdm.........',
  '.......mhhdkkkkkkkkdhdm.........',
  '.......mhhddkkkkkkddhdm.........',
  '.......mhhhdddddddddhdccssw.....',
  '......mhhhmmmmggmmmmdddcsw......',
  '.....mhhhhmmmmmmmmmddddcsw......',
  '....mhhhhhmmmmmmmmmdddccssw.....',
  '...mhhhhhmmmmmmmmmdddccssssw....',
  '...mhhhhhmmmmmmmmdddccssssssw...',
  '...mhhhhhmmmmmmmmdddccssssssw...',
  '...mhhhhhmmmmmmmdddcYYYYYYYYyw..',
  '...mhhhhhmmmmmmmdddcgggWggggyw..',
  '...mhhhhhmmmmmmmdddcgggggggyyw..',
  '...mhhhhhmmmmmmmddddcgggggyyw...',
  '...mhhhhhmmmmmmmdddd.cyyyyyw....',
  '...mhhhhhmmmmmmmdddd.swwww......',
  '...mhhhhhmmmmmmmdddd............',
  '...dddddddddddddddddd...........',
  '................................',
];

// 16×16:仅巫师头像 + 领扣(小尺寸下药瓶会糊,舍去)
const ART16 = [
  '................',
  '........mm......',
  '......mhhm......',
  '.....mhhhhm.....',
  '....mhhhhhdm....',
  '...mhddddddhm...',
  '...mhkekkekhm...',
  '...mhkgkkgkhm...',
  '...mhdkkkkdhm...',
  '...mhhddddhhm...',
  '..mhhmmggmmddm..',
  '.mhhhmmmmmmdddm.',
  '.mhhhmmmmmmdddm.',
  '.mhhhmmmmmmdddm.',
  '.mhhhmmmmmmdddm.',
  '.dddddddddddddd.',
];

// ---------- 底板(深色圆角方块,微弱纵向渐变 + 近黑描边) ----------
const PLATE = {
  top: hex('#251b28'),
  bottom: hex('#120c13'),
  outline: hex('#07050a'),
};

function lerp(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function renderPlate(size, radius) {
  const img = createCanvas(size, size);
  const r = radius - 0.5;
  const inside = (x, y) => {
    const cx = x < radius ? radius - 0.5 : x > size - 1 - radius ? size - 0.5 - radius : x;
    const cy = y < radius ? radius - 0.5 : y > size - 1 - radius ? size - 0.5 - radius : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.25;
  };
  for (let y = 0; y < size; y++) {
    const fill = lerp(PLATE.top, PLATE.bottom, y / (size - 1));
    for (let x = 0; x < size; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const [cr, cg, cb, ca] = edge ? PLATE.outline : fill;
      const i = (y * size + x) * 4;
      img.data[i] = cr;
      img.data[i + 1] = cg;
      img.data[i + 2] = cb;
      img.data[i + 3] = ca;
    }
  }
  return img;
}

function renderArt(rows) {
  const size = rows.length;
  rows.forEach((row, i) => {
    if (row.length !== size) throw new Error(`row ${i} length ${row.length} != ${size}`);
  });
  const img = createCanvas(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      const color = PALETTE[ch];
      if (!color) throw new Error(`unknown palette char '${ch}' at ${x},${y}`);
      img.data.set(color, (y * size + x) * 4);
    }
  }
  return img;
}

function compose(size, radius, rows) {
  const img = renderPlate(size, radius);
  blit(img, renderArt(rows), 0, 0);
  return img;
}

// ---------- 渲染各尺寸 ----------
const base32 = compose(32, 3, ART32);
const base16 = compose(16, 2, ART16);
const sizes = {
  16: base16,
  32: base32,
  48: scaleNearest(base16, 3),
  64: scaleNearest(base32, 2),
  128: scaleNearest(base32, 4),
  256: scaleNearest(base32, 8),
};

// ---------- 预览拼图(人工审阅用,不入库) ----------
{
  const pad = 12;
  const tiles = [sizes[256], scaleNearest(base32, 4), scaleNearest(base16, 8), scaleNearest(base16, 3), scaleNearest(base32, 1)];
  const sheetW = tiles.reduce((s, t) => s + t.width + pad, pad);
  const sheetH = Math.max(...tiles.map(t => t.height)) + pad * 2;
  // 左半深色底、右半浅色底,检验两种资源管理器主题下的观感
  const sheet = createCanvas(sheetW, sheetH, [58, 58, 64, 255]);
  for (let y = 0; y < sheetH; y++) {
    for (let x = Math.floor(sheetW / 2); x < sheetW; x++) {
      sheet.data.set([225, 225, 228, 255], (y * sheetW + x) * 4);
    }
  }
  let x = pad;
  for (const t of tiles) {
    blit(sheet, t, x, Math.floor((sheetH - t.height) / 2));
    x += t.width + pad;
  }
  const out = path.join(root, 'tools/.cache/icon-draft.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, encodePng(sheet));
  console.log(`preview: ${out}`);
}

// ---------- 正式产物 ----------
if (process.argv.includes('--emit')) {
  const ico = encodeIco([
    { img: sizes[16], format: 'bmp' },
    { img: sizes[32], format: 'bmp' },
    { img: sizes[48], format: 'bmp' },
    { img: sizes[64], format: 'bmp' },
    { img: sizes[128], format: 'png' },
    { img: sizes[256], format: 'png' },
  ]);
  const outIco = path.join(root, 'build/icon.ico');
  fs.mkdirSync(path.dirname(outIco), { recursive: true });
  fs.writeFileSync(outIco, ico);
  fs.writeFileSync(path.join(root, 'electron/icon.ico'), ico); // 运行时窗口图标(随 electron/** 打进 asar)
  fs.writeFileSync(path.join(root, 'frontend/public/favicon.png'), encodePng(sizes[32]));
  console.log('emitted: build/icon.ico, electron/icon.ico, frontend/public/favicon.png');
}
