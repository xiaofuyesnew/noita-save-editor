import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { i18n } from './locales'
import 'virtual:uno.css'
import './styles/global.css'
import './styles/game-tooltip.css'

createApp(App).use(createPinia()).use(i18n).mount('#app')
