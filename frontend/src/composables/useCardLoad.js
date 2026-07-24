// 卡片加载生命周期:包裹 load()，暴露 loading/error 态并支持重试。
// 修复「初次加载失败(服务端未起/500/断网)→ 未捕获 rejection + 卡片空白、
// 无提示无重试」——CardShell 据此渲染错误条与「重试」按钮。
import { ref } from 'vue'

/**
 * @param {(...args: any[]) => Promise<void>} loadFn
 */
export function useCardLoad(loadFn) {
  const loading = ref(false)
  const error = ref(null)
  let lastArgs = []

  async function run(...args) {
    lastArgs = args
    loading.value = true
    error.value = null
    try {
      await loadFn(...args)
    }
    catch (e) {
      error.value = e?.message || String(e)
    }
    finally {
      loading.value = false
    }
  }

  /** 用上次的参数重试(供 CardShell 的重试按钮调用)。 */
  const retry = () => run(...lastArgs)

  return { loading, error, run, retry }
}
