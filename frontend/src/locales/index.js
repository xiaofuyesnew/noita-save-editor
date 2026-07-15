// vue-i18n 组装:平面键字典(键含 '.',用自定义 messageResolver 直查,
// 不做嵌套解析 —— 因为存在 'player.hp' 与 'player.hp.tip' 同前缀共存)。
// 语言持久化沿用旧版约定 localStorage.lang,默认按 navigator.language。
import { createI18n } from 'vue-i18n'
import { en } from './en'
import { zh } from './zh'

const stored = localStorage.getItem('lang')
const auto = String(navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'

export const i18n = createI18n({
  legacy: false,
  locale: stored && ['zh', 'en'].includes(stored) ? stored : auto,
  fallbackLocale: 'zh',
  messages: { zh, en },
  messageResolver: (obj, path) => obj[path] ?? null,
  missingWarn: false,
  fallbackWarn: false,
})

export function getLang() {
  return i18n.global.locale.value
}

export function setLang(lang) {
  if (!['zh', 'en'].includes(lang))
    return
  i18n.global.locale.value = lang
  localStorage.setItem('lang', lang)
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
}

/** 数据字典条目显示名:zh 用 nameZh,en 用 name;缺失逐级回退到 id。 */
export function dictName(entry) {
  if (!entry)
    return ''
  const name = i18n.global.locale.value === 'zh'
    ? (entry.nameZh || entry.name)
    : (entry.name || entry.nameZh)
  return name || entry.id || ''
}
