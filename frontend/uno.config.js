// UnoCSS:presetUno 工具类 + 项目惯用法 shortcuts。
// 页面骨架与控件全部为 Naive UI 组件;此处只放布局类工具组合。
import { defineConfig, presetUno } from 'unocss'

export default defineConfig({
  presets: [presetUno()],
  shortcuts: {
    // 一屏 5×3 网格的单元:填满所在行高,超出内容由卡内 NScrollbar 接管。
    // 行高由 AppShell 的 grid-rows-3(1fr)均分容器高度,任何窗口尺寸都不产生页面滚动条
    'card-cell': 'h-full min-h-0',
    // 密集表单网格(自适应列宽,替代旧 .grid);短数字输入居多,列宽下限压小以多分列
    'field-grid': 'grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-3 gap-y-2',
  },
})
