// 天赋/效果共享状态:服务端缓冲列表 + 本卡暂存变更。
// 添加/移除只改本地暂存(与缓冲现状区分显示),经卡顶「应用到缓冲」批量提交:
// 先移除(效果按索引降序防漂移)后添加;版本号仅在 reload/commit 递增,批内共用,
// 每步成功即出队,失败时剩余暂存保留可重试。
// 另集中提供字典查询与图标 URL(效果无 HUD 图标时经 gameEffect 反查天赋图标兜底)。
import { api } from '@/api/client'
import { uiGfxIconUrl } from '@/ui/dictIcon'
import { useDictStore } from './dict'
import { useSaveStore } from './save'

export const useEffPerkStore = defineStore('effperk', () => {
  const save = useSaveStore()
  const dict = useDictStore()

  const perks = ref([])
  const effects = ref([])

  // ---- 暂存变更(应用前不触服务端) ----
  const perkAdds = ref([]) // [{ id, count }]
  const perkRemovals = ref([]) // [perkId]
  const effectAdds = ref([]) // [{ effect, withIcon, permanent, seconds? }]
  const effectRemovals = ref([]) // [effects 列表 index]

  const pendingCount = computed(() =>
    perkAdds.value.reduce((n, p) => n + p.count, 0)
    + perkRemovals.value.length
    + effectAdds.value.length
    + effectRemovals.value.length)
  const dirty = computed(() => pendingCount.value > 0)

  function clearPending() {
    perkAdds.value = []
    perkRemovals.value = []
    effectAdds.value = []
    effectRemovals.value = []
  }

  async function load(discardEdits = true) {
    if (discardEdits)
      clearPending()
    await Promise.all([dict.ensurePerks(), dict.ensureEffects()])
    const [p, e] = await Promise.all([api('/perks'), api('/player/effects')])
    save.syncVersion(p.version)
    save.syncVersion(e.version)
    perks.value = p.perks
    effects.value = e.effects
  }

  // ---- 暂存操作 ----
  function stagePerkAdd(id) {
    const cur = perkAdds.value.find(p => p.id === id)
    if (cur)
      cur.count++
    else
      perkAdds.value.push({ id, count: 1 })
  }
  function unstagePerkAdd(id) {
    const i = perkAdds.value.findIndex(p => p.id === id)
    if (i !== -1 && --perkAdds.value[i].count <= 0)
      perkAdds.value.splice(i, 1)
  }
  function stagePerkRemoval(id) {
    if (!perkRemovals.value.includes(id))
      perkRemovals.value.push(id)
  }
  function unstagePerkRemoval(id) {
    perkRemovals.value = perkRemovals.value.filter(x => x !== id)
  }
  function stageEffectAdd(params) {
    effectAdds.value.push(params)
  }
  function unstageEffectAdd(i) {
    effectAdds.value.splice(i, 1)
  }
  function stageEffectRemoval(index) {
    if (!effectRemovals.value.includes(index))
      effectRemovals.value.push(index)
  }
  function unstageEffectRemoval(index) {
    effectRemovals.value = effectRemovals.value.filter(x => x !== index)
  }

  /** 批量提交暂存变更到服务端缓冲,完成后重新拉取列表。 */
  async function apply() {
    const v = save.version
    while (perkRemovals.value.length > 0) {
      const id = perkRemovals.value[0]
      await api(`/perks/${encodeURIComponent(id)}?v=${v}`, { method: 'DELETE' })
      perkRemovals.value.shift()
    }
    effectRemovals.value.sort((a, b) => b - a)
    while (effectRemovals.value.length > 0) {
      const idx = effectRemovals.value[0]
      await api(`/player/effects/${idx}?v=${v}`, { method: 'DELETE' })
      effectRemovals.value.shift()
    }
    while (perkAdds.value.length > 0) {
      const p = perkAdds.value[0]
      while (p.count > 0) {
        await api('/perks', { method: 'POST', body: { id: p.id, version: v } })
        p.count--
      }
      perkAdds.value.shift()
    }
    while (effectAdds.value.length > 0) {
      const e = effectAdds.value[0]
      const body = { effect: e.effect, withIcon: e.withIcon, version: v }
      if (!e.permanent)
        body.seconds = e.seconds
      await api('/player/effects', { method: 'POST', body })
      effectAdds.value.shift()
    }
    await load()
  }

  // ---- 字典查询与图标 ----
  const perkById = computed(() => new Map((dict.perks ?? []).map(p => [p.id, p])))
  const effById = computed(() => new Map((dict.effects ?? []).map(e => [e.id, e])))

  // 效果 id → 同效果天赋的 uiIcon(状态图标缺失时的兜底)
  const perkIconByEffect = computed(() => {
    const m = new Map()
    for (const p of dict.perks ?? []) {
      for (const ge of [p.gameEffect, p.gameEffect2]) {
        if (ge && p.uiIcon && !m.has(ge))
          m.set(ge, p.uiIcon)
      }
    }
    return m
  })

  const perkDict = id => perkById.value.get(id)
  const effectDict = id => effById.value.get(id)
  const perkIconUrl = id => uiGfxIconUrl(perkById.value.get(id)?.uiIcon)
  const effectIconUrl = id =>
    uiGfxIconUrl(effById.value.get(id)?.icon) || uiGfxIconUrl(perkIconByEffect.value.get(id))

  return {
    perks,
    effects,
    perkAdds,
    perkRemovals,
    effectAdds,
    effectRemovals,
    pendingCount,
    dirty,
    load,
    apply,
    stagePerkAdd,
    unstagePerkAdd,
    stagePerkRemoval,
    unstagePerkRemoval,
    stageEffectAdd,
    unstageEffectAdd,
    stageEffectRemoval,
    unstageEffectRemoval,
    perkDict,
    effectDict,
    perkIconUrl,
    effectIconUrl,
  }
})
