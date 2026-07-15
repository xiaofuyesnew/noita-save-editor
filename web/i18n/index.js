// 无框架 i18n(约 60 行):平面字典 + t(key, params) + 静态 HTML 扫描替换。
//  - 静态文案:元素标 data-i18n(textContent)/data-i18n-tip(tooltip 的
//    data-tip)/data-i18n-ph(placeholder)/data-i18n-title(title);
//  - 动态文案:模块渲染时调 t(),切换语言后由 onLangChange 注册的钩子重渲染;
//  - 字典条目显示名(法术/材料/天赋等)按语言选 name/nameZh 字段(dictName);
//  - 语言状态存 localStorage.lang,默认按 navigator.language。

import { zh } from './zh.js';
import { en } from './en.js';

const DICTS = { zh, en };

let lang = localStorage.getItem('lang')
  || (String(navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
if (!DICTS[lang]) lang = 'en';

let rerender = null;

export function getLang() {
  return lang;
}

/** 取文案;{x} 占位符用 params.x 替换。缺 key 时回退 zh,再退 key 本身。 */
export function t(key, params) {
  let s = DICTS[lang][key] ?? DICTS.zh[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** 数据字典条目显示名:zh 用 nameZh,en 用 name;缺失逐级回退到 id。 */
export function dictName(entry) {
  if (!entry) return '';
  const name = lang === 'zh'
    ? (entry.nameZh || entry.name)
    : (entry.name || entry.nameZh);
  return name || entry.id || '';
}

/** 全文档扫描替换静态文案(切换语言与首次加载时调用)。 */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-tip]')) el.dataset.tip = t(el.dataset.i18nTip);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = t('app.title');
}

/** 注册语言切换后的动态重渲染钩子(app.js 传入全量刷新)。 */
export function onLangChange(fn) {
  rerender = fn;
}

export async function setLang(next) {
  if (next === lang || !DICTS[next]) return;
  lang = next;
  localStorage.setItem('lang', lang);
  applyStatic();
  if (rerender) await rerender();
}
