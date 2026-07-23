// 开发辅助:打印精灵图的唯一颜色(hex + 出现次数),用于采样原版调色板。
import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from './pnglib.mjs';

const root = path.resolve(import.meta.dirname, '../..');
for (const rel of process.argv.slice(2)) {
  const img = decodePng(fs.readFileSync(path.join(root, rel)));
  const counts = new Map();
  for (let i = 0; i < img.width * img.height; i++) {
    const [r, g, b, a] = img.data.subarray(i * 4, i * 4 + 4);
    if (a === 0) continue;
    const key = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}${a !== 255 ? `/${a}` : ''}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  console.log(`${rel}:`);
  for (const [c, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${c} x${n}`);
}
