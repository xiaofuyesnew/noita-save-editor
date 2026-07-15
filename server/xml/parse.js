// XML 解析封装 —— fast-xml-parser preserveOrder 模式。
//
// 树结构（preserveOrder）：文档 = 节点数组；元素节点形如
//   { TagName: [子节点...], ':@': { attr: 'value', ... } }
// 文本节点形如 { '#text': '原始文本' }。
// 全部值保持字符串（parseTagValue/parseAttributeValue 均关），避免
// 破坏 "3.40282e+038"、"-2147483648" 这类数值的原样表示。
// trimValues:false 保留元素间空白文本节点；serialize.js 会按 Noita
// 规则整体重新生成空白，因此这些节点在输出时被忽略（见 serialize.js）。

import { XMLParser, XMLValidator } from 'fast-xml-parser';

const PARSER_OPTIONS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  commentPropName: '#comment',
  cdataPropName: '#cdata',
};

/**
 * 解析 XML 文本为保序树。解析失败抛出带定位信息的 Error。
 * @param {string} xmlText
 * @returns {Array<object>} preserveOrder 文档节点数组
 */
export function parseXml(xmlText) {
  const check = XMLValidator.validate(xmlText);
  if (check !== true) {
    const { msg, line, col } = check.err;
    throw new Error(`XML 校验失败: ${msg} (line ${line}, col ${col})`);
  }
  return new XMLParser(PARSER_OPTIONS).parse(xmlText);
}

/**
 * 检测文件的属性布局风格。
 * Noita 有两种序列化输出：
 *  - multiline：属性每行一个（player.xml / world_state.xml / bones 法杖）
 *  - inline：属性同行以单空格分隔（mod_config.xml / stats）
 * 依据：multiline 文件中开标签名后是 " \r\n" 直接换行。
 * @param {string} xmlText
 * @returns {'multiline'|'inline'}
 */
export function detectStyle(xmlText) {
  return /<[A-Za-z_][^\s>]* \r?\n/.test(xmlText) ? 'multiline' : 'inline';
}

/**
 * 便捷入口：解析并附带风格检测结果。
 * @param {string} xmlText
 * @returns {{ tree: Array<object>, style: 'multiline'|'inline' }}
 */
export function loadXml(xmlText) {
  return { tree: parseXml(xmlText), style: detectStyle(xmlText) };
}
