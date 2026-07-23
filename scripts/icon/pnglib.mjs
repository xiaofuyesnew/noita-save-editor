// 极小 PNG 编解码 + 最近邻缩放工具。仅覆盖图标流水线所需子集:
// 编码固定输出 8-bit RGBA;解码支持 8-bit 灰度/RGB/索引/RGBA(游戏精灵图均在此范围)。
import zlib from 'node:zlib';

// ---------- CRC32(PNG 块校验) ----------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA 像素缓冲 { width, height, data: Buffer(w*h*4) } → PNG 文件字节 */
export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: None
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** PNG 文件字节 → { width, height, data: Buffer(RGBA) }。仅支持 8-bit 非隔行。 */
export function decodePng(buf) {
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error(`unsupported png: depth=${data[8]} interlace=${data[12]}`);
      colorType = data[9];
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      trns = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    }
    off += 12 + len;
  }
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (bpp == null) throw new Error(`unsupported color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      cur[x] = v & 0xFF;
    }
  }
  // 统一展开为 RGBA
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (colorType === 6) {
      px.copy(out, i * 4, i * 4, i * 4 + 4);
    } else if (colorType === 2) {
      out[i * 4] = px[i * 3];
      out[i * 4 + 1] = px[i * 3 + 1];
      out[i * 4 + 2] = px[i * 3 + 2];
      out[i * 4 + 3] = 255;
    } else if (colorType === 3) {
      const p = px[i];
      out[i * 4] = palette[p * 3];
      out[i * 4 + 1] = palette[p * 3 + 1];
      out[i * 4 + 2] = palette[p * 3 + 2];
      out[i * 4 + 3] = trns && p < trns.length ? trns[p] : 255;
    } else if (colorType === 0) {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = px[i];
      out[i * 4 + 3] = 255;
    } else if (colorType === 4) {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = px[i * 2];
      out[i * 4 + 3] = px[i * 2 + 1];
    }
  }
  return { width, height, data: out };
}

/** 最近邻整数倍放大 */
export function scaleNearest(img, factor) {
  const w = img.width * factor;
  const h = img.height * factor;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < w; x++) {
      const sx = Math.floor(x / factor);
      img.data.copy(out, (y * w + x) * 4, (sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4);
    }
  }
  return { width: w, height: h, data: out };
}

/** 新建纯色画布(默认透明) */
export function createCanvas(width, height, rgba = [0, 0, 0, 0]) {
  const data = Buffer.alloc(width * height * 4);
  if (rgba[3] !== 0) {
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = rgba[0];
      data[i * 4 + 1] = rgba[1];
      data[i * 4 + 2] = rgba[2];
      data[i * 4 + 3] = rgba[3];
    }
  }
  return { width, height, data };
}

/** 将 src 粘贴到 dst 的 (dx,dy),非透明像素直接覆盖 */
export function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const a = src.data[(y * src.width + x) * 4 + 3];
      if (a === 0) continue;
      const tx = dx + x;
      const ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
      src.data.copy(dst.data, (ty * dst.width + tx) * 4, (y * src.width + x) * 4, (y * src.width + x) * 4 + 4);
    }
  }
}
