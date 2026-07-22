// 游戏数据读取共用库 —— build-dict.js 与 build-items.js 共享的 data.wak 读取
// 与实体 <Base> 展开逻辑(从 build-items.js 抽取,行为不变)。

import { readFileSync } from 'node:fs';

// wak 布局(实测):16 字节头 [magic u32, numFiles u32, dataStart u32, 保留 u32],
// 随后 numFiles 条目 [offset u32, size u32, nameLen u32, name(latin1)],
// 之后是文件数据区。
/** 打开 data.wak,返回 read(relPath) → 文本 | null(relPath 含 data/ 前缀)。 */
export function openWak(path) {
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

// ---- <Base> 展开 -------------------------------------------------------------
//
// Noita 实体用 <Base file="..."> 引入模板,子实体可覆盖/追加组件。展开为
// 结构无关的"文本级"内联:把 <Base file="X"> ... </Base>(或自闭合)替换为
// X 的 <Entity> 内层内容,再把 Base 标签自身携带的内层子节点续在其后(游戏
// 语义:Base 的子节点追加到被引入实体上)。递归处理嵌套 Base。
// read 允许返回 Promise(build-dict 走镜像下载时为异步),因此整条链为 async。

/** 取 xml 文本里根 <Entity ...> ... </Entity> 的内层内容(去掉最外层标签)。 */
export function innerOfEntity(xml) {
  const open = xml.match(/<Entity\b[^>]*>/);
  if (!open) throw new Error('实体 XML 缺少 <Entity> 根');
  const start = open.index + open[0].length;
  const end = xml.lastIndexOf('</Entity>');
  if (end === -1) throw new Error('实体 XML 缺少 </Entity> 闭合');
  return xml.slice(start, end);
}

/** 展开一段内层内容里的全部 <Base>,read(file) 用于取被引入文件(可异步)。 */
export async function expandBases(inner, read, seen = []) {
  const BASE_RE = /<Base\b([^>]*)\bfile="([^"]+)"([^>]*)(\/>|>([\s\S]*?)<\/Base>)/g;
  let out = '';
  let last = 0;
  for (const m of inner.matchAll(BASE_RE)) {
    const [full, _a, file, _b, tail, baseInner] = m;
    out += inner.slice(last, m.index);
    last = m.index + full.length;
    if (seen.includes(file)) throw new Error(`Base 循环引用: ${file}`);
    const xml = await read(file);
    if (xml == null) throw new Error(`Base 引入的文件缺失: ${file}`);
    const importedInner = await expandBases(innerOfEntity(xml), read, [...seen, file]);
    // 被引入实体内容 + Base 标签自身的内层子节点(追加语义)
    const extra = tail === '/>' ? '' : (baseInner ?? '');
    out += importedInner + '\n' + (await expandBases(extra, read, seen));
  }
  out += inner.slice(last);
  return out;
}

/**
 * 去除元素开标签内的重复属性(个别原版文件自带,如 powder_stash.xml 的
 * MaterialInventoryComponent 写了两次 leak_pressure_min;游戏解析器宽容,
 * 我们的严格解析器会拒绝)。保留最后一次出现的值(与"后写覆盖"语义一致),
 * 属性顺序按首次出现;无重复的标签保持原文不动。
 */
export function dedupeTagAttrs(xml) {
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

/** 读实体 XML 并全展开为独立 <Entity> XML(不含任何 <Base>)。 */
export async function flattenEntity(relPath, read) {
  const xml = await read(relPath);
  if (!xml) throw new Error(`实体文件缺失: ${relPath}`);
  const open = xml.match(/<Entity\b[^>]*>/)[0];
  const inner = await expandBases(innerOfEntity(xml), read, [relPath]);
  return dedupeTagAttrs(`${open}\n${inner}\n</Entity>\n`);
}
