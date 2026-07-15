// @antfu/eslint-config 单包 flat config(内置 Vue 支持与 stylistic 格式化)。
// 作用域仅本前端子包;服务端存量代码风格不受影响。
// .eslintrc-auto-import.json 由 vite 的 unplugin-auto-import 生成(build/dev 时),
// 为自动导入的 vue/pinia/vue-i18n API 提供 globals 声明。
import antfu from '@antfu/eslint-config'
import autoImport from './.eslintrc-auto-import.json' with { type: 'json' }

export default antfu(
  {},
  { languageOptions: { globals: autoImport.globals } },
)
