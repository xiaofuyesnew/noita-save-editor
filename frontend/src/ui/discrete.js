// setup 上下文之外(Pinia store 等)可用的 Naive discrete API。
import { createDiscreteApi, darkTheme } from 'naive-ui'
import { themeOverrides } from './theme'

const { dialog } = createDiscreteApi(['dialog'], {
  configProviderProps: { theme: darkTheme, themeOverrides },
})

/**
 * Promise 化确认框(替代 window.confirm)。
 * @returns {Promise<boolean>} 用户是否点了确认
 */
export function confirmDialog({ title, content, positiveText, negativeText }) {
  return new Promise((resolve) => {
    dialog.warning({
      title,
      content,
      positiveText,
      negativeText,
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
      onMaskClick: () => resolve(false),
      onEsc: () => resolve(false),
    })
  })
}
