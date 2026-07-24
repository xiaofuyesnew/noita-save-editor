// 法杖 store:快捷栏法杖 + 背包散装法术。属性表单与法术操作都先改本地
// 暂存,统一经「应用」提交:
//  - 表单:编辑态/基线分离,应用时收集差异批量 PUT /wands/stats;
//  - 法术:加删改/拖拽先在 staged* 本地模拟(逻辑镜像 server/model/spells.js),
//    同时记入 spellOps 操作日志,应用时按暂存顺序回放到服务端缓冲。
// 写操作不递增 saveManager.version(仅 reload/commit 会),回放期间共用同一版本号。
import { api } from '@/api/client'
import { i18n } from '@/locales'
import { useDictStore } from './dict'
import { useLogStore } from './log'
import { useSaveStore } from './save'

// 属性表单字段(与服务端 readWand 字段同名);checkbox 单列
export const WAND_FORM_FIELDS = [
  ['uiName', 'text'],
  ['gunLevel', 'number'],
  ['manaMax', 'number'],
  ['mana', 'number'],
  ['manaChargeSpeed', 'number'],
  ['deckCapacity', 'number'],
  ['reloadTime', 'number'],
  ['fireRateWait', 'number'],
  ['actionsPerRound', 'number'],
  ['spreadDegrees', 'number'],
  ['speedMultiplier', 'number'],
  ['spriteFile', 'text'],
  ['shuffleDeckWhenEmpty', 'checkbox'],
]

const t = (...args) => i18n.global.t(...args)

// ---- 法术操作本地模拟(镜像 server/model/spells.js 语义) ----------------------
// 寻址用 idx(容器内文档序下标,服务端 listSpells 附带):真实存档中多张卡
// 可共享同一槽位(游戏自产),槽位号不可作寻址。add 追加 → idx = n;
// remove 后更大的 idx 左移;reorder 为 idx 排列,按序赋槽位 0..n-1。

function simAdd(list, params, capacity) {
  const used = new Set(list.map(s => s.slot))
  let slot
  if (params.slot === undefined || params.slot === null || params.slot === '') {
    slot = 0
    while (used.has(slot)) slot++
  }
  else {
    slot = Number(params.slot)
    if (used.has(slot))
      throw new Error(t('log.slotOccupied', { slot }))
  }
  if (capacity !== undefined && Number.isFinite(capacity) && slot >= capacity)
    throw new Error(t('log.slotOverCap', { slot, cap: capacity }))
  list.push({ actionId: params.actionId, slot, idx: list.length, usesRemaining: '-1', alwaysCast: false, staged: true })
}

function simUpdate(list, idx, patch) {
  const s = list.find(x => x.idx === Number(idx))
  if (!s)
    throw new Error(t('log.idxEmpty', { idx }))
  if (patch.usesRemaining !== undefined)
    s.usesRemaining = String(patch.usesRemaining)
  if (patch.alwaysCast !== undefined)
    s.alwaysCast = !!patch.alwaysCast
}

function simRemove(list, idx) {
  const n = Number(idx)
  const i = list.findIndex(x => x.idx === n)
  if (i < 0)
    throw new Error(t('log.idxEmpty', { idx }))
  list.splice(i, 1)
  for (const s of list) {
    if (s.idx > n)
      s.idx--
  }
}

function simReorder(list, order) {
  const given = order.map(Number).sort((a, b) => a - b)
  if (given.length !== list.length || given.some((v, i) => v !== i))
    throw new Error(t('log.badOrder'))
  const byIdx = new Map(list.map(s => [s.idx, s]))
  order.forEach((idx, i) => byIdx.get(Number(idx)).slot = i)
  list.sort((a, b) => a.slot - b.slot)
}

export const useWandsStore = defineStore('wands', () => {
  const save = useSaveStore()
  const wands = ref([]) // 服务端数据(含 spells)
  const forms = ref([]) // 每杖表单编辑态 {field: string|bool}
  const baselines = ref([]) // 每杖表单基线(服务端值)
  const invSpells = ref({ capacity: 0, spells: [] })

  // 法术暂存视图(UI 展示用)+ 操作日志(应用时回放)
  const stagedWandSpells = ref([]) // 按 wands 下标,每项为法术数组的本地副本
  const stagedInvSpells = ref([])
  const spellOps = ref([]) // { target: 'inv'|下标, kind: 'add'|'update'|'remove'|'reorder', ... }

  function formOf(w) {
    const f = {}
    for (const [field, kind] of WAND_FORM_FIELDS) {
      f[field] = kind === 'checkbox' ? Number(w[field]) !== 0 : (kind === 'number' ? Number(w[field]) : String(w[field] ?? ''))
    }
    return f
  }

  function cloneSpells(list) {
    return (list ?? []).map(s => ({ ...s }))
  }
  function stagedListOf(target) {
    return target === 'inv' ? stagedInvSpells.value : stagedWandSpells.value[target]
  }
  function capacityOf(target) {
    if (target === 'inv')
      return Number(invSpells.value.capacity)
    return Number(forms.value[target]?.deckCapacity ?? wands.value[target]?.deckCapacity)
  }

  function simOp(op) {
    const list = stagedListOf(op.target)
    if (!list)
      throw new Error('no target')
    if (op.kind === 'add')
      simAdd(list, op, capacityOf(op.target))
    else if (op.kind === 'update')
      simUpdate(list, op.idx, op.patch)
    else if (op.kind === 'remove')
      simRemove(list, op.idx)
    else
      simReorder(list, op.order)
  }

  /** 暂存一个法术操作:本地模拟成功才记日志;失败写警告日志并返回 false。 */
  function stageSpellOp(op) {
    try {
      simOp(op)
      spellOps.value.push(op)
      return true
    }
    catch (e) {
      useLogStore().log(t('log.error', { msg: e.message }), 'warn')
      return false
    }
  }

  /**
   * 拉取法杖与背包法术。preserveEdits(默认 true):保留"改了但没应用"的
   * 表单字段与法术暂存操作(重新模拟,失效的丢弃);丢弃缓冲类操作
   * (重载/拉取/恢复)后由 onReload 以 false 调用。
   */
  async function load(preserveEdits = true) {
    const data = await api('/wands')
    save.syncVersion(data.version)
    const prevForms = forms.value
    const prevBaselines = baselines.value
    const prevWands = wands.value
    wands.value = data.wands

    // 按法杖的 index 属性建立身份映射，而非数组位置
    const prevFormsByIndex = new Map(prevWands.map((w, i) => [w.index, { form: prevForms[i], baseline: prevBaselines[i] }]))

    forms.value = data.wands.map((w) => {
      const fresh = formOf(w)
      if (!preserveEdits)
        return fresh
      const prev = prevFormsByIndex.get(w.index)
      if (!prev?.form)
        return fresh
      // 恢复未应用的编辑（脏字段）
      for (const [field] of WAND_FORM_FIELDS) {
        if (prev.form[field] !== prev.baseline?.[field])
          fresh[field] = prev.form[field]
      }
      return fresh
    })
    baselines.value = data.wands.map(w => formOf(w))

    const inv = await api('/inventory/spells')
    invSpells.value = { capacity: inv.capacity, spells: inv.spells }

    // 重建法术暂存视图;保留编辑时对新基线重放操作日志,失效的丢弃
    stagedWandSpells.value = data.wands.map(w => cloneSpells(w.spells))
    stagedInvSpells.value = cloneSpells(inv.spells)
    if (preserveEdits && spellOps.value.length > 0) {
      const kept = []
      for (const op of spellOps.value) {
        try {
          simOp(op)
          kept.push(op)
        }
        catch {}
      }
      if (kept.length < spellOps.value.length)
        useLogStore().log(t('log.opsDropped', { n: spellOps.value.length - kept.length }), 'warn')
      spellOps.value = kept
    }
    else {
      spellOps.value = []
    }
  }

  const formDirtyCount = computed(() => forms.value.filter((f, i) =>
    WAND_FORM_FIELDS.some(([field]) => f[field] !== baselines.value[i]?.[field])).length)
  const dirty = computed(() => formDirtyCount.value > 0 || spellOps.value.length > 0)

  /**
   * 应用全部暂存:先批量提交属性差异(容量调大先生效),再按暂存顺序回放
   * 法术操作。任一操作失败:保留剩余操作、对新基线重放后抛出。
   */
  async function applyAll() {
    const patches = []
    forms.value.forEach((f, i) => {
      const patch = {}
      for (const [field, kind] of WAND_FORM_FIELDS) {
        const cur = kind === 'checkbox' ? (f[field] ? '1' : '0') : (kind === 'number' ? String(f[field]) : f[field])
        const base = kind === 'checkbox'
          ? (baselines.value[i]?.[field] ? '1' : '0')
          : (kind === 'number' ? String(baselines.value[i]?.[field]) : baselines.value[i]?.[field])
        if (cur !== base && cur !== '' && cur !== 'NaN')
          patch[field] = cur
      }
      if (Object.keys(patch).length > 0)
        patches.push({ index: wands.value[i].index, ...patch })
    })
    if (patches.length === 0 && spellOps.value.length === 0)
      return { skipped: true }
    if (patches.length > 0)
      await api('/wands/stats', { method: 'PUT', body: { version: save.version, wands: patches } })

    const ops = [...spellOps.value]
    for (let k = 0; k < ops.length; k++) {
      const op = ops[k]
      const base = op.target === 'inv'
        ? '/inventory/spells'
        : `/wands/${wands.value[op.target].index}/spells`
      try {
        if (op.kind === 'add')
          await api(base, { method: 'POST', body: { actionId: op.actionId, slot: op.slot, version: save.version } })
        else if (op.kind === 'update')
          await api(`${base}/${op.idx}`, { method: 'PUT', body: { ...op.patch, version: save.version } })
        else if (op.kind === 'remove')
          await api(`${base}/${op.idx}?v=${save.version}`, { method: 'DELETE' })
        else
          await api(`${base}/order`, { method: 'PUT', body: { order: op.order, version: save.version } })
      }
      catch (e) {
        spellOps.value = ops.slice(k) // 已成功的出队,失败及之后的保留
        await load()
        throw e
      }
    }
    spellOps.value = []
    await load()
    return { n: patches.length, ops: ops.length }
  }

  function applyAllLogged() {
    if (!dirty.value) {
      useLogStore().log(t('log.noWandChanges'))
      return Promise.resolve()
    }
    const n = formDirtyCount.value
    const m = spellOps.value.length
    return save.act(() => applyAll(), t('log.wandsApplied', { n, m }))
  }

  // ---- 法术暂存入口(WandCard / WandEditModal 调用) ----
  const stageAdd = (target, actionId, slot) => stageSpellOp({ target, kind: 'add', actionId, slot })
  const stageUpdate = (target, idx, patch) => stageSpellOp({ target, kind: 'update', idx, patch })
  const stageRemove = (target, idx) => stageSpellOp({ target, kind: 'remove', idx })
  const stageReorder = (target, order) => stageSpellOp({ target, kind: 'reorder', order })

  /**
   * 载入法杖预设到第 index 支杖的编辑暂存(§20):覆盖属性表单 + 重建法术暂存,
   * 不改服务端、不新增槽位 —— 由编辑页「应用」经 applyAll 提交到缓冲。
   *  - 属性:逐字段写 forms[index](类型对齐 formOf);deckCapacity 取
   *    max(当前, 预设, 法术数),规避应用时「容量调小于占用槽」的时序冲突
   *    (applyAll 属性 diff 先于法术回放,不会自动缩容到比当前更小)。
   *  - 法术:先清空现有(高 idx→低,idx 稳定),再按槽位序**紧凑**追加(不带
   *    显式槽,避开重复槽冲突),非默认的 usesRemaining/alwaysCast 再补一条 update。
   *    产生的 spellOps 由 applyAll 回放到缓冲。
   * @returns {boolean} 是否载入成功
   */
  function applyPresetToWand(index, preset) {
    const form = forms.value[index]
    if (!form || !preset)
      return false
    const attrs = preset.attrs ?? {}
    for (const [field, kind] of WAND_FORM_FIELDS) {
      if (attrs[field] === undefined)
        continue
      form[field] = kind === 'checkbox'
        ? Number(attrs[field]) !== 0
        : (kind === 'number' ? Number(attrs[field]) : String(attrs[field] ?? ''))
    }
    const spells = [...(preset.spells ?? [])].sort((a, b) => Number(a.slot) - Number(b.slot))
    const curCap = Number(baselines.value[index]?.deckCapacity)
    const presetCap = Number(attrs.deckCapacity)
    form.deckCapacity = Math.max(
      Number.isFinite(curCap) ? curCap : 0,
      Number.isFinite(presetCap) ? presetCap : 0,
      spells.length,
    )

    // 清空现有暂存法术(降序移除,idx 稳定)
    const n = (stagedWandSpells.value[index] ?? []).length
    for (let idx = n - 1; idx >= 0; idx--)
      stageRemove(index, idx)

    // 紧凑追加预设法术;字典缺失的法术跳过并记日志(与天赋一致)
    const known = new Set((useDictStore().spells ?? []).map(s => s.id))
    let added = 0
    for (const s of spells) {
      if (known.size && !known.has(s.actionId)) {
        useLogStore().log(t('preset.spellSkipped', { id: s.actionId }), 'warn')
        continue
      }
      if (!stageAdd(index, s.actionId))
        continue
      const patch = {}
      if (s.usesRemaining !== undefined && String(s.usesRemaining) !== '-1')
        patch.usesRemaining = s.usesRemaining
      if (s.alwaysCast)
        patch.alwaysCast = true
      if (Object.keys(patch).length)
        stageUpdate(index, added, patch)
      added++
    }
    useLogStore().log(t('preset.wandLoaded', { label: preset.label, n: added }), 'ok')
    return true
  }

  return {
    wands,
    forms,
    baselines,
    invSpells,
    stagedWandSpells,
    stagedInvSpells,
    spellOps,
    dirty,
    load,
    applyAll,
    applyAllLogged,
    stageAdd,
    stageUpdate,
    stageRemove,
    stageReorder,
    applyPresetToWand,
  }
})
