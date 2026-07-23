// ICO 打包:将多尺寸 RGBA 图组装为 Windows .ico。
// ≤64px 用经典 BMP 条目(兼容性最好),更大尺寸用 PNG 条目(Vista+ 支持,控制体积)。
import { encodePng } from './pnglib.mjs';

function bmpEntry(img) {
  const { width: w, height: h, data } = img;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(w, 4);
  header.writeInt32LE(h * 2, 8); // XOR + AND 两段
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bpp
  const xor = Buffer.alloc(w * h * 4);
  const andStride = Math.ceil(w / 32) * 4; // 1bpp 行按 4 字节对齐
  const and = Buffer.alloc(andStride * h);
  for (let y = 0; y < h; y++) {
    const srcRow = h - 1 - y; // BMP 自下而上
    for (let x = 0; x < w; x++) {
      const si = (srcRow * w + x) * 4;
      const di = (y * w + x) * 4;
      xor[di] = data[si + 2]; // BGRA
      xor[di + 1] = data[si + 1];
      xor[di + 2] = data[si];
      xor[di + 3] = data[si + 3];
      if (data[si + 3] < 128) and[y * andStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  header.writeUInt32LE(xor.length + and.length, 20); // biSizeImage
  return Buffer.concat([header, xor, and]);
}

/** images: [{ img, format: 'bmp' | 'png' }],按尺寸升序传入 */
export function encodeIco(images) {
  const blobs = images.map(({ img, format }) => (format === 'png' ? encodePng(img) : bmpEntry(img)));
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  images.forEach(({ img }, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    e.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(blobs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += blobs[i].length;
    entries.push(e);
  });
  return Buffer.concat([dir, ...entries, ...blobs]);
}
