// 日志 store:日志卡数据源(替代旧 ui.js log()),新条目置顶。
export const useLogStore = defineStore('log', () => {
  const lines = ref([])

  function log(msg, cls = '') {
    const d = new Date()
    const p = n => String(n).padStart(2, '0')
    lines.value.unshift({
      time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
      msg,
      cls,
    })
    if (lines.value.length > 200)
      lines.value.length = 200
  }

  return { lines, log }
})
