// 预设 store(§20):坐标 / 天赋 / 法杖三类预设的读取与 CRUD,各卡共享。
// 权威态在服务端 presets.json;本 store 只做一次全量 load + 本地增量维护。
//
// 「应用」不在此:各宿主域自理 —— 坐标走 basics 表单、天赋走 effperk 暂存、
// 法杖走 wandsStore.applyPresetToWand。故本 store 只负责 load + create/update/remove。
import { api } from '@/api/client'
import { i18n } from '@/locales'
import { useLogStore } from './log'

const t = (...args) => i18n.global.t(...args)

export const usePresetsStore = defineStore('presets', () => {
  const locations = ref([])
  const perks = ref([])
  const wands = ref([])
  const loaded = ref(false)

  const listRef = cat => ({ locations, perks, wands })[cat]

  async function load() {
    const data = await api('/presets')
    locations.value = data.locations ?? []
    perks.value = data.perks ?? []
    wands.value = data.wands ?? []
    loaded.value = true
  }
  async function ensureLoaded() {
    if (!loaded.value)
      await load()
  }

  /** 新建;成功把返回的预设并入本地列表并记日志,失败记警告。返回预设或 null。 */
  async function create(cat, payload) {
    try {
      const { preset } = await api(`/presets/${cat}`, { method: 'POST', body: payload })
      listRef(cat).value.push(preset)
      useLogStore().log(t('preset.saved', { label: preset.label }), 'ok')
      return preset
    }
    catch (e) {
      useLogStore().log(t('log.error', { msg: e.message }), 'warn')
      return null
    }
  }
  const createLocation = payload => create('locations', payload)
  const createPerk = payload => create('perks', payload)
  const createWand = payload => create('wands', payload)

  /** 改标签(patch 可含 tags;坐标类可含 x/y)。 */
  async function update(cat, id, patch) {
    try {
      const { preset } = await api(`/presets/${cat}/${id}`, { method: 'PUT', body: patch })
      const list = listRef(cat).value
      const i = list.findIndex(p => p.id === id)
      if (i !== -1)
        list[i] = preset
      useLogStore().log(t('preset.renamed', { label: preset.label }), 'ok')
      return preset
    }
    catch (e) {
      useLogStore().log(t('log.error', { msg: e.message }), 'warn')
      return null
    }
  }
  const rename = (cat, id, label) => update(cat, id, { label })

  async function remove(cat, id) {
    try {
      await api(`/presets/${cat}/${id}`, { method: 'DELETE' })
      const list = listRef(cat)
      list.value = list.value.filter(p => p.id !== id)
      useLogStore().log(t('preset.removed'), 'ok')
      return true
    }
    catch (e) {
      useLogStore().log(t('log.error', { msg: e.message }), 'warn')
      return false
    }
  }

  return {
    locations,
    perks,
    wands,
    loaded,
    load,
    ensureLoaded,
    create,
    createLocation,
    createPerk,
    createWand,
    update,
    rename,
    remove,
  }
})
