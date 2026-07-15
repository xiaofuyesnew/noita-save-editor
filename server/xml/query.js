// 保序树查询/编辑工具 —— 供领域模型层(model/)使用。
//
// 约定:所有函数操作 fast-xml-parser preserveOrder 节点
//   元素节点 { Tag: [children], ':@': {attrs} }
//   文本节点 { '#text': 'raw' }
// 子节点数组中夹杂的空白文本节点(解析残留)一律跳过;
// 序列化时空白整体重新生成,因此增删子节点无需维护空白节点。

import { tagOf } from './serialize.js';

export { tagOf };

/** 元素的原始子节点数组(含空白文本节点);无子返回空数组。 */
export function rawChildren(node) {
  const tag = tagOf(node);
  if (tag === undefined || tag.startsWith('#')) return [];
  return node[tag] ?? [];
}

/** 元素类子节点(过滤 #text/#comment 等)。 */
export function elementChildren(node) {
  return rawChildren(node).filter((c) => {
    const t = tagOf(c);
    return t !== undefined && !t.startsWith('#');
  });
}

/** 文档(节点数组)中的第一个元素节点;tag 给定时要求标签匹配。 */
export function docRoot(tree, tag) {
  for (const node of tree ?? []) {
    const t = tagOf(node);
    if (t === undefined || t.startsWith('#')) continue;
    if (tag === undefined || t === tag) return node;
  }
  return undefined;
}

/** 读属性(字符串;不存在返回 undefined)。 */
export function getAttr(node, name) {
  return node[':@']?.[name];
}

/**
 * 写属性。值一律转字符串。已存在的属性保持原有位置;
 * 新属性追加到末尾(游戏解析器不关心属性顺序)。
 */
export function setAttr(node, name, value) {
  if (!node[':@']) node[':@'] = {};
  node[':@'][name] = String(value);
}

/** 删除属性;返回是否确实删除。 */
export function removeAttr(node, name) {
  if (node[':@'] && name in node[':@']) {
    delete node[':@'][name];
    return true;
  }
  return false;
}

/** 第一个满足条件的指定标签子元素。 */
export function findChild(node, tag, predicate) {
  for (const child of elementChildren(node)) {
    if (tagOf(child) === tag && (!predicate || predicate(child))) return child;
  }
  return undefined;
}

/** 全部指定标签子元素。 */
export function findChildren(node, tag, predicate) {
  return elementChildren(node).filter(
    (c) => tagOf(c) === tag && (!predicate || predicate(c)),
  );
}

/** 实体节点上的组件(= 指定标签的直接子元素)。 */
export const findComponent = findChild;
export const findComponents = findChildren;

/** 直接子实体(<Entity>)。 */
export function childEntities(node, predicate) {
  return findChildren(node, 'Entity', predicate);
}

/** 实体 tags 属性(CSV)中是否含有 tag。 */
export function entityHasTag(node, tag) {
  const tags = getAttr(node, 'tags');
  if (!tags) return false;
  return tags.split(',').includes(tag);
}

/** 按 name 属性查找直接子实体(如 inventory_quick / inventory_full)。 */
export function findChildEntityByName(node, name) {
  return findChild(node, 'Entity', (e) => getAttr(e, 'name') === name);
}

/** 元素的文本值(全部 #text 拼接后 trim;无文本返回 '')。 */
export function textOf(node) {
  return rawChildren(node)
    .filter((c) => tagOf(c) === '#text')
    .map((c) => String(c['#text']))
    .join('')
    .trim();
}

/** 设置元素文本值:清除原 #text 子节点后写入单个文本节点。 */
export function setText(node, value) {
  const tag = tagOf(node);
  if (tag === undefined || tag.startsWith('#')) {
    throw new Error('setText: 不是元素节点');
  }
  const kept = (node[tag] ?? []).filter((c) => tagOf(c) !== '#text');
  kept.push({ '#text': String(value) });
  node[tag] = kept;
  return node;
}

/** 构造新元素节点。 */
export function makeElement(tag, attrs = {}, children = []) {
  const node = { [tag]: children };
  if (Object.keys(attrs).length > 0) {
    node[':@'] = Object.fromEntries(
      Object.entries(attrs).map(([k, v]) => [k, String(v)]),
    );
  }
  return node;
}

/** 追加子节点(到末尾)。 */
export function appendChild(parent, child) {
  const tag = tagOf(parent);
  if (!node_isElement(tag)) throw new Error('appendChild: 不是元素节点');
  if (!parent[tag]) parent[tag] = [];
  parent[tag].push(child);
  return child;
}

/**
 * 在"第 index 个元素子节点"之前插入(index 按元素计,忽略空白文本节点;
 * index 超界等价追加)。
 */
export function insertChildAt(parent, child, index) {
  const tag = tagOf(parent);
  if (!node_isElement(tag)) throw new Error('insertChildAt: 不是元素节点');
  if (!parent[tag]) parent[tag] = [];
  const raw = parent[tag];
  let seen = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = tagOf(raw[i]);
    if (t !== undefined && !t.startsWith('#')) {
      if (seen === index) {
        raw.splice(i, 0, child);
        return child;
      }
      seen++;
    }
  }
  raw.push(child);
  return child;
}

/** 按对象身份移除子节点;返回是否移除。 */
export function removeChild(parent, child) {
  const tag = tagOf(parent);
  if (!node_isElement(tag)) return false;
  const raw = parent[tag] ?? [];
  const i = raw.indexOf(child);
  if (i === -1) return false;
  raw.splice(i, 1);
  return true;
}

/** 深度优先遍历元素节点;visitor 返回 false 时不深入该子树。 */
export function walk(node, visitor) {
  const tag = tagOf(node);
  if (tag === undefined || tag.startsWith('#')) return;
  if (visitor(node) === false) return;
  for (const child of elementChildren(node)) walk(child, visitor);
}

function node_isElement(tag) {
  return tag !== undefined && !tag.startsWith('#');
}
