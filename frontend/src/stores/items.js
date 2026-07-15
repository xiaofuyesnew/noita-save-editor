// 物品栏 store:道具行 4 格(宝藏道具 + 药水/粉末袋容器)。加删/换槽/材料
// 编辑都先在 stagedItems 本地模拟(逻辑镜像 server/model/items.js),同时记入
// ops 操作日志,统一经「应用」按暂存顺序回放到服务端缓冲。
// 道具索引 = 树内顺序(list 保持 index === 下标);材料接口按容器索引寻址,
// 回放时以服务端基线的影子副本逐步推进换算 containerIndex。
import { api } from '@/api/client'
import { i18n } from '@/locales'
import { useDictStore } from './dict'
import { useLogStore } from './log'
import { useSaveStore } from './save'

const t = (...args) => i18n.global.t(...args)

// 目录容器的 barrel_size(data/items.json 实体内固定值,暂存展示用)
const CONTAINER_CAPACITY = { potion: '1000', powder_stash: '1500' }

// ---- 本地模拟(镜像 server/model/items.js 语义) --------------------------------

function occupiedSlots(list) {
  const slots = new Set()
  for (const it of list) {
    const s = Number(it.slot ?? -1)
    if (Number.isInteger(s) && s >= 0)
      slots.add(s)
  }
  return slots
}

function refreshIndexes(list) {
  let ci = 0
  list.forEach((it, i) => {
    it.index = i
    if (it.isContainer)
      it.containerIndex = ci++
  })
}

function simAdd(list, entry, slot, capacity) {
  const used = occupiedSlots(list)
  let s
  if (slot === undefined || slot === null || slot === '') {
    s = Array.from({ length: capacity }, (_, i) => i).find(x => !used.has(x))
    if (s === undefined)
      throw new Error(t('log.itemBarFull', { cap: capacity }))
  }
  else {
    s = Number(slot)
    if (!Number.isInteger(s) || s < 0 || s >= capacity)
      throw new Error(t('log.itemSlotRange', { max: capacity - 1, slot }))
    if (used.has(s))
      throw new Error(t('log.slotOccupied', { slot: s }))
  }
  const isContainer = entry.group === 'container'
  list.push({
    index: list.length,
    kind: isContainer ? entry.id : entry.group,
    catalogId: entry.id,
    itemName: entry.itemName,
    name: entry.name,
    nameZh: entry.nameZh,
    uiSprite: entry.uiSprite,
    slot: String(s),
    staged: true,
    ...(isContainer
      ? { isContainer: true, capacity: CONTAINER_CAPACITY[entry.id], materials: [] }
      : {}),
  })
  refreshIndexes(list)
}

function simRemove(list, index) {
  const i = Number(index)
  if (!list[i])
    throw new Error(t('log.itemGone', { i: index }))
  list.splice(i, 1)
  refreshIndexes(list)
}

/** 换槽,目标被占则互换;返回 false 表示原地不动(不必记操作)。 */
function simMove(list, index, slot, capacity) {
  const it = list[Number(index)]
  if (!it)
    throw new Error(t('log.itemGone', { i: index }))
  const to = Number(slot)
  if (!Number.isInteger(to) || to < 0 || to >= capacity)
    throw new Error(t('log.itemSlotRange', { max: capacity - 1, slot }))
  const from = Number(it.slot ?? -1)
  if (to === from)
    return false
  const other = list.find(x => x !== it && Number(x.slot ?? -1) === to)
  if (other && !(Number.isInteger(from) && from >= 0 && from < capacity))
    throw new Error(t('log.itemSwapInvalid', { to, from }))
  it.slot = String(to)
  if (other)
    other.slot = String(from)
  return true
}

function simMaterials(list, index, materials, matById) {
  const it = list[Number(index)]
  if (!it)
    throw new Error(t('log.itemGone', { i: index }))
  if (!it.isContainer)
    throw new Error(t('log.notContainer'))
  it.materials = materials.map(m => ({
    material: m.material,
    count: String(m.count),
    nameZh: matById.get(m.material)?.nameZh,
  }))
}

export const useItemsStore = defineStore('items', () => {
  const save = useSaveStore()
  const dict = useDictStore()

  const items = ref([]) // 服务端数据
  const capacity = ref(4)
  const stagedItems = ref([]) // 本地暂存视图(UI 展示用)
  const ops = ref([]) // { kind: 'add'|'remove'|'move'|'materials', ... }

  const matById = computed(() => new Map((dict.materials ?? []).map(m => [m.id, m])))

  function cloneItems(list) {
    return (list ?? []).map(it => ({
      ...it,
      ...(it.materials ? { materials: it.materials.map(m => ({ ...m })) } : {}),
    }))
  }

  function simOp(list, op) {
    if (op.kind === 'add')
      return simAdd(list, op.entry, op.slot, capacity.value)
    if (op.kind === 'remove')
      return simRemove(list, op.index)
    if (op.kind === 'move')
      return simMove(list, op.index, op.slot, capacity.value)
    return simMaterials(list, op.index, op.materials, matById.value)
  }

  /** 暂存一个操作:本地模拟成功才记日志;失败写警告日志并返回 false。 */
  function stageOp(op) {
    try {
      if (simOp(stagedItems.value, op) === false)
        return true // 原地换槽等空操作:不记日志
      ops.value.push(op)
      return true
    }
    catch (e) {
      useLogStore().log(t('log.error', { msg: e.message }), 'warn')
      return false
    }
  }

  const dirty = computed(() => ops.value.length > 0)
  const freeSlots = computed(() => {
    const used = occupiedSlots(stagedItems.value)
    let free = 0
    for (let s = 0; s < capacity.value; s++) {
      if (!used.has(s))
        free++
    }
    return free
  })

  /**
   * 拉取道具行。preserveEdits(默认 true):对新基线重放暂存操作,失效的
   * 丢弃;丢弃缓冲类操作(重载/拉取/恢复)后由 onReload 以 false 调用。
   */
  async function load(preserveEdits = true) {
    const data = await api('/items')
    save.syncVersion(data.version)
    items.value = data.items
    capacity.value = data.capacity
    stagedItems.value = cloneItems(data.items)
    if (preserveEdits && ops.value.length > 0) {
      const kept = []
      for (const op of ops.value) {
        try {
          simOp(stagedItems.value, op)
          kept.push(op)
        }
        catch {}
      }
      if (kept.length < ops.value.length)
        useLogStore().log(t('log.itemOpsDropped', { n: ops.value.length - kept.length }), 'warn')
      ops.value = kept
    }
    else {
      ops.value = []
    }
  }

  /**
   * 应用全部暂存:按暂存顺序回放到服务端缓冲。材料操作以基线影子推进换算
   * 当步 containerIndex。任一操作失败:保留失败及之后的操作,重载后抛出。
   */
  async function applyAll() {
    if (ops.value.length === 0)
      return { skipped: true }
    const shadow = cloneItems(items.value)
    const list = [...ops.value]
    for (let k = 0; k < list.length; k++) {
      const op = list[k]
      try {
        if (op.kind === 'add') {
          await api('/items', { method: 'POST', body: { id: op.entry.id, slot: op.slot, version: save.version } })
        }
        else if (op.kind === 'remove') {
          await api(`/items/${op.index}?v=${save.version}`, { method: 'DELETE' })
        }
        else if (op.kind === 'move') {
          await api(`/items/${op.index}/slot`, { method: 'PUT', body: { slot: op.slot, version: save.version } })
        }
        else {
          const ci = shadow[Number(op.index)]?.containerIndex
          if (ci === undefined)
            throw new Error(t('log.notContainer'))
          await api(`/items/potions/${ci}`, { method: 'PUT', body: { materials: op.materials, version: save.version } })
        }
        simOp(shadow, op)
      }
      catch (e) {
        ops.value = list.slice(k) // 已成功的出队,失败及之后的保留
        await load()
        throw e
      }
    }
    ops.value = []
    await load()
    return { n: list.length }
  }

  function applyAllLogged() {
    if (!dirty.value) {
      useLogStore().log(t('log.noItemChanges'))
      return Promise.resolve()
    }
    const n = ops.value.length
    return save.act(() => applyAll(), t('log.itemsApplied', { n }))
  }

  // ---- 暂存入口(InventoryCard 调用) ----
  const stageAdd = (entry, slot) => stageOp({
    kind: 'add',
    slot,
    entry: {
      id: entry.id,
      group: entry.group,
      itemName: entry.itemName,
      name: entry.name,
      nameZh: entry.nameZh,
      uiSprite: entry.uiSprite,
    },
  })
  const stageRemove = index => stageOp({ kind: 'remove', index })
  const stageMove = (index, slot) => stageOp({ kind: 'move', index, slot })
  const stageMaterials = (index, materials) => stageOp({ kind: 'materials', index, materials })

  return {
    items,
    capacity,
    stagedItems,
    ops,
    dirty,
    freeSlots,
    load,
    applyAll,
    applyAllLogged,
    stageAdd,
    stageRemove,
    stageMove,
    stageMaterials,
  }
})
