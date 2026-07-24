// 存档 store:status/version/dirty + 顶栏动作(写入/重载/拉推/备份/路径)。
// act() 收编旧 app.js 的错误包装 + 日志 + 状态刷新;领域 store 经 onReload
// 注册重载钩子,丢弃缓冲类操作(写入/重载/拉取/恢复)后统一触发。
import { api } from '@/api/client'
import { i18n } from '@/locales'
import { confirmDialog } from '@/ui/discrete'
import { useLogStore } from './log'

export const useSaveStore = defineStore('save', () => {
  const status = ref(null)
  const version = computed(() => status.value?.version ?? 0)
  const dirty = computed(() => status.value?.dirty ?? false)
  const gameRunning = computed(() => status.value?.gameRunning ?? false)
  const backups = ref([])

  const reloadHooks = []
  /** 领域 store 注册重载钩子;钩子收到 discardEdits(丢弃缓冲类操作为 true)。返回注销函数。 */
  function onReload(fn) {
    reloadHooks.push(fn)
    return () => {
      const idx = reloadHooks.indexOf(fn)
      if (idx !== -1)
        reloadHooks.splice(idx, 1)
    }
  }
  async function reloadAll(discardEdits = true) {
    // allSettled:单张卡重载失败(如某接口 500)不连累其余卡与顶栏操作结果。
    const results = await Promise.allSettled(reloadHooks.map(fn => fn(discardEdits)))
    const failed = results.filter(r => r.status === 'rejected')
    if (failed.length) {
      const logStore = useLogStore()
      logStore.log(i18n.global.t('log.reloadPartial', { n: failed.length }), 'warn')
    }
  }

  async function refresh() {
    status.value = await api('/status')
  }

  /** 领域 GET 响应携带的 version 同步进全局状态(写操作以此做乐观校验)。 */
  function syncVersion(v) {
    if (typeof v !== 'number')
      return
    if (status.value)
      status.value.version = v
    else
      status.value = { version: v }
  }

  /**
   * 操作包装:执行 → 成功记日志 → (无论成败)刷新状态重同步 version。
   * 关键:失败(尤其 409 版本冲突)后也必须 refresh,否则 version 永远过期、
   * 后续每次写都 409。刷新自身失败不掩盖主操作结果。
   * @returns {Promise<boolean>} 是否成功
   */
  async function act(fn, okMsg) {
    const logStore = useLogStore()
    try {
      await fn()
      if (okMsg)
        logStore.log(okMsg, 'ok')
      return true
    }
    catch (e) {
      const msg = e?.status === 409 ? i18n.global.t('log.conflict') : e.message
      logStore.log(i18n.global.t('log.error', { msg }), 'warn')
      return false
    }
    finally {
      await refresh().catch(() => {})
    }
  }

  const t = (...args) => i18n.global.t(...args)

  // ---- 顶栏动作 ----
  // 写入不丢弃未应用的表单编辑(旧版行为);重载/拉取/恢复/切路径丢弃。
  const write = () => act(async () => {
    await api('/save/write', { method: 'POST' })
    await reloadAll(false)
  }, t('log.written'))

  const reload = () => act(async () => {
    await api('/save/reload', { method: 'POST' })
    await reloadAll()
  }, t('log.reloaded'))

  const pull = () => act(async () => {
    await api('/sync/pull', { method: 'POST' })
    await reloadAll()
  }, t('log.pulled'))

  const push = () => act(() => api('/sync/push', { method: 'POST' }), t('log.pushed'))

  // ---- 备份 ----
  async function loadBackups() {
    backups.value = (await api('/backups')).backups
  }
  const createBackup = () => act(async () => {
    await api('/backups', { method: 'POST' })
    await loadBackups()
  }, t('log.backupCreated'))
  const restoreBackup = name => act(async () => {
    await api(`/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' })
    await reloadAll()
    await loadBackups()
  }, t('log.restored', { name }))
  const deleteBackup = name => act(async () => {
    await api(`/backups/${encodeURIComponent(name)}`, { method: 'DELETE' })
    await loadBackups()
  }, t('log.backupDeleted', { name }))
  const exportBackup = name =>
    window.open(`/api/backups/${encodeURIComponent(name)}/export`)

  // ---- 路径配置(缓冲有未保存更改时需 force 确认) ----
  const applyPaths = (saveDir, liveDir) => act(async () => {
    const body = { saveDir, liveDir }
    try {
      await api('/config/paths', { method: 'PUT', body })
    }
    catch (e) {
      if (!e.data?.requiresForce)
        throw e
      const ok = await confirmDialog({
        title: t('confirm.title'),
        content: t('confirm.switchPaths'),
        positiveText: t('common.continue'),
        negativeText: t('common.cancel'),
      })
      if (!ok)
        throw new Error(t('log.pathsCancelled'))
      await api('/config/paths', { method: 'PUT', body: { ...body, force: true } })
    }
    await refresh()
    await reloadAll()
  }, t('log.pathsApplied'))

  return {
    status,
    version,
    dirty,
    gameRunning,
    backups,
    onReload,
    reloadAll,
    refresh,
    syncVersion,
    act,
    write,
    reload,
    pull,
    push,
    loadBackups,
    createBackup,
    restoreBackup,
    deleteBackup,
    exportBackup,
    applyPaths,
  }
})
