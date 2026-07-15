// 字典 store:/api/dict/* 与道具目录的惰性缓存(替代旧各模块自存 dict* 变量)。
import { api } from '@/api/client'

export const useDictStore = defineStore('dict', () => {
  const spells = ref(null)
  const spellTypes = ref(null)
  const effects = ref(null)
  const perks = ref(null)
  const materials = ref(null)
  const wands = ref(null)
  const itemsCatalog = ref(null)

  async function ensure(refVal, path, pick = d => d) {
    if (refVal.value === null)
      refVal.value = pick(await api(path))
    return refVal.value
  }

  return {
    spells,
    spellTypes,
    effects,
    perks,
    materials,
    wands,
    itemsCatalog,
    ensureSpells: () => ensure(spells, '/dict/spells'),
    ensureSpellTypes: () => ensure(spellTypes, '/dict/spell_types'),
    ensureEffects: () => ensure(effects, '/dict/effects'),
    ensurePerks: () => ensure(perks, '/dict/perks'),
    ensureMaterials: () => ensure(materials, '/dict/materials'),
    ensureWands: () => ensure(wands, '/dict/wands'),
    ensureItemsCatalog: () => ensure(itemsCatalog, '/items/catalog', d => d.catalog),
  }
})
