// Vite 配置(M8):Vue SFC + UnoCSS + Naive 按需 + API 自动导入 + devtools。
// dev 模式下 /api 代理到本机 Hono 服务(pnpm dev 由 concurrently 同时拉起两者)。
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import VueDevTools from 'vite-plugin-vue-devtools'

export default defineConfig({
  plugins: [
    vue(),
    UnoCSS(),
    AutoImport({
      imports: ['vue', 'pinia', 'vue-i18n'],
      dts: false,
      // 生成 .eslintrc-auto-import.json 供 eslint.config.js 接入 globals
      eslintrc: { enabled: true, globalsPropValue: true },
    }),
    Components({ resolvers: [NaiveUiResolver()], dts: false }),
    VueDevTools(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5710',
      // noitamap 反代由 Hono 提供(server/routes/noitamap.js),dev 下同样转发过去
      '/noitamap': 'http://127.0.0.1:5710',
    },
  },
})
