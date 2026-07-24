// Noita 风格 XML 序列化器 —— 目标:对未修改的树,输出与游戏原文件逐字节一致。
//
// 实测字节语法(save00 全部 XML 勘察结论,2026-07):
//  - 无 XML 声明头,UTF-8 无 BOM;
//  - 元素边界(开标签结束、闭标签、文本行)换行均为 "\r\r\n"
//    (游戏以文本模式写 "\r\n" 被 CRT 再转换的产物,必须原样复刻);
//  - multiline 风格:每个属性独占一行,前导 = " \r\n" + 缩进(标签层级+1),
//    如 player.xml / world_state.xml / bones_new/*.xml;
//  - inline 风格:属性同行,前导单空格,如 mod_config.xml / stats/*.xml;
//  - 有属性的开标签以 " >" 收尾(值尾随一个空格),无属性则紧跟 ">";
//  - 不使用自闭合,空元素也输出独立闭标签行;
//  - 文本节点独占一行,缩进 = 父标签层级+1;
//  - 缩进单位 2 空格;原文件不含任何实体转义。
//
// 空白策略:解析时保留的空白文本节点在此被忽略(trim 后为空),全部
// 空白按上述规则重新生成 —— 因此对树的任何结构性修改无需维护空白。

const BOUNDARY = '\r\r\n';
const ATTR_NEWLINE = ' \r\n';
const INDENT_UNIT = '  ';

function pad(level) {
  return INDENT_UNIT.repeat(level);
}

function escAttr(value) {
  // 结构性字符 & < " 转义;另把控制字符(换行/回车/制表)写成数值实体 ——
  // 否则用户自由文本(法杖名/材料名等)里的换行会破坏"一属性一行"布局,
  // 且 XML 规范会在读取时把它们规范化为空格,造成写入值 ≠ 游戏读到的值。
  // Noita 原生文件的属性值不含控制字符,故不影响未修改文件的逐字节还原。
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;')
    .replace(/\t/g, '&#9;');
}

function escText(value) {
  // 文本节点只需转义 & 与 <(> 在文本里是合法字符,转义它会破坏对
  // 原生文件的逐字节还原;原生文本节点不含控制字符)。
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** 取元素节点的标签名(':@' 之外的第一个键)。 */
export function tagOf(node) {
  for (const key of Object.keys(node)) {
    if (key !== ':@') return key;
  }
  return undefined;
}

/**
 * 序列化保序树为 Noita 风格 XML 文本。
 * @param {Array<object>} tree preserveOrder 文档节点数组
 * @param {{style?: 'multiline'|'inline'}} [options]
 * @returns {string}
 */
export function serializeXml(tree, { style = 'multiline' } = {}) {
  const out = [];
  for (const node of tree) emitNode(out, node, 0, style);
  return out.join('');
}

function emitNode(out, node, level, style) {
  const tag = tagOf(node);
  if (tag === undefined) return;

  if (tag === '#text') {
    const text = String(node['#text']).trim();
    if (text) out.push(pad(level) + escText(text) + BOUNDARY);
    return;
  }
  if (tag === '#comment') {
    const inner = (node['#comment'] ?? [])
      .map((c) => String(c['#text'] ?? ''))
      .join('');
    out.push(`${pad(level)}<!--${inner}-->${BOUNDARY}`);
    return;
  }
  if (tag === '#cdata') {
    const inner = (node['#cdata'] ?? [])
      .map((c) => String(c['#text'] ?? ''))
      .join('');
    out.push(`${pad(level)}<![CDATA[${inner}]]>${BOUNDARY}`);
    return;
  }

  const attrs = node[':@'] ?? {};
  const names = Object.keys(attrs);
  let open = pad(level) + '<' + tag;
  for (const name of names) {
    const lead = style === 'multiline' ? ATTR_NEWLINE + pad(level + 1) : ' ';
    open += `${lead}${name}="${escAttr(attrs[name])}"`;
  }

  if (tag.startsWith('?')) {
    // 处理指令(Noita 存档不出现,兜底输出)
    out.push(open + '?>' + BOUNDARY);
    return;
  }

  open += names.length > 0 ? ' >' : '>';
  out.push(open + BOUNDARY);

  for (const child of node[tag] ?? []) emitNode(out, child, level + 1, style);
  out.push(`${pad(level)}</${tag}>${BOUNDARY}`);
}

/** 统计树中元素节点总数(写盘自检用)。 */
export function countElements(tree) {
  let n = 0;
  for (const node of tree ?? []) {
    const tag = tagOf(node);
    if (tag === undefined || tag.startsWith('#')) continue;
    n += 1 + countElements(node[tag]);
  }
  return n;
}

/**
 * 归一化保序树为可比较的规范结构:丢弃纯空白文本节点、trim 有意义文本、
 * 保留标签/属性(含顺序)/嵌套。用于写盘自检 —— 比 countElements 更强,
 * 能捕获属性值/文本被序列化损坏(元素数不变但内容变了)的情形。
 * @param {Array<object>} tree
 * @returns {Array<object>}
 */
export function canonicalizeTree(tree) {
  const out = [];
  for (const node of tree ?? []) {
    const tag = tagOf(node);
    if (tag === undefined) continue;
    if (tag === '#text') {
      const t = String(node['#text']).trim();
      if (t) out.push({ t });
      continue;
    }
    if (tag.startsWith('#')) {
      const inner = (node[tag] ?? []).map((c) => String(c['#text'] ?? '')).join('');
      out.push({ [tag]: inner });
      continue;
    }
    out.push({ tag, a: { ...(node[':@'] ?? {}) }, c: canonicalizeTree(node[tag] ?? []) });
  }
  return out;
}
