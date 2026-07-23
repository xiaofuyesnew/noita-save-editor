// 开发辅助:把游戏参照精灵放大拼成对照表,便于确认配色与风格(输出到 tools/.cache,不入库)。
import fs from 'node:fs';
import path from 'node:path';
import { blit, createCanvas, decodePng, encodePng, scaleNearest } from './pnglib.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const refs = [
  'frontend/public/icons/animal_icons/player.png',
  'frontend/public/icons/items/potion.png',
  'frontend/public/icons/items/goldnugget.png',
  'frontend/public/icons/wands/wand_0005.png',
  'frontend/public/icons/items/orb.png',
  'frontend/public/icons/items/sampo.png',
];

const imgs = refs.map((p) => {
  const img = decodePng(fs.readFileSync(path.join(root, p)));
  console.log(`${p}: ${img.width}x${img.height}`);
  return scaleNearest(img, Math.max(1, Math.floor(160 / Math.max(img.width, img.height))));
});

const pad = 16;
const sheetW = imgs.reduce((s, i) => s + i.width + pad, pad);
const sheetH = Math.max(...imgs.map(i => i.height)) + pad * 2;
const sheet = createCanvas(sheetW, sheetH, [40, 36, 44, 255]);
let x = pad;
for (const img of imgs) {
  blit(sheet, img, x, Math.floor((sheetH - img.height) / 2));
  x += img.width + pad;
}
const out = path.join(root, 'tools/.cache/icon-refs.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(sheet));
console.log(`written: ${out}`);
