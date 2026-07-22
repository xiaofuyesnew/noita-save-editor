<script setup>
// 道具槽格子条:道具行 4 格(宝藏道具 + 药水/粉末袋容器),按游戏物品栏渲染:
// 原版格子底图(full_inventory_box 20→40px)+ 道具像素图标 2 倍整数缩放,
// hover 叠加原版高亮图,悬浮弹游戏风格 tooltip(容器附材料清单)。
// 空槽点击 → pick(槽位);已占点击 → edit(道具);拖拽(SortableJS Swap)→
// move(道具, 目标槽),槽位交换由后端完成。
// 游戏自产脏数据(重复/越界槽位)顺延为容量之外的附加格,标 ! 且不可作落点。
//
// 约束:v-for 必须直接写在格子 div 上(迭代根 = 普通元素)—— 否则 Sortable
// 搬动 DOM 后按锚点区间卸载会漏删,残留幽灵格;详见 SlotStrip.vue 顶部注释。
import { useSlotDrag } from '@/composables/useSlotDrag'
import { dictName, getLang } from '@/locales'
import { useDictStore } from '@/stores/dict'
import { useLogStore } from '@/stores/log'

const props = defineProps({
  capacity: { type: Number, default: 4 },
  items: { type: Array, required: true },
})
const emit = defineEmits(['pick', 'edit', 'move'])

const { t } = useI18n()
const logStore = useLogStore()
const dict = useDictStore()

// 道具描述来自物品目录(items.json 的 desc/descZh),按 itemName 关联
onMounted(() => dict.ensureItemsCatalog())
const catalogByItemName = computed(() =>
  new Map((dict.itemsCatalog ?? []).filter(x => x.itemName).map(x => [x.itemName, x])))
function descOf(it) {
  const d = catalogByItemName.value.get(it.itemName)
  if (!d)
    return ''
  return getLang() === 'zh' ? (d.descZh || d.desc) : (d.desc || d.descZh)
}

const stripEl = ref(null)
const renderKey = ref(0) // 拖拽后 DOM 由 Sortable 动过,bump 强制按状态重建

// 槽位 → 显示格:道具行是显式槽位(有空洞);重复/越界槽顺延为附加格
const cells = computed(() => {
  const out = Array.from({ length: props.capacity }).fill(null)
  const overflow = []
  const sorted = [...props.items].sort((a, b) => Number(a.slot) - Number(b.slot))
  for (const it of sorted) {
    const s = Number(it.slot)
    if (Number.isInteger(s) && s >= 0 && s < props.capacity && !out[s])
      out[s] = it
    else
      overflow.push(it)
  }
  return [...out, ...overflow]
})

// 字典 sprite 路径按 build-icons.js 的固定规则映射:'data/ui_gfx/' → '/icons/'
function iconOf(it) {
  return it.uiSprite?.startsWith('data/ui_gfx/')
    ? `/icons/${it.uiSprite.slice('data/ui_gfx/'.length)}`
    : ''
}
function nameOf(it) {
  return (it.nameZh || it.name)
    ? dictName({ name: it.name, nameZh: it.nameZh, id: it.itemName })
    : (it.itemName || t('item.unknown'))
}
function kindLabel(kind) {
  const key = `item.kind.${kind}`
  const label = t(key)
  return label === key ? kind : label
}
function matName(m) {
  return getLang() === 'zh' ? (m.nameZh || m.material) : m.material
}

function onCellClick(it, i) {
  if (!it) {
    emit('pick', i)
    return
  }
  emit('edit', it)
}

useSlotDrag(stripEl, (fromIdx, toIdx) => {
  const src = cells.value[fromIdx]
  renderKey.value++ // 丢弃 Sortable 的 DOM 改动,等状态刷新
  if (!src || fromIdx === toIdx)
    return
  if (toIdx >= props.capacity) {
    logStore.log(t('invbar.moveInvalid'), 'warn')
    return
  }
  emit('move', src, toIdx)
})
</script>

<template>
  <div ref="stripEl" class="slots">
    <div
      v-for="(it, i) in cells"
      :key="`${renderKey}-${i}-${it ? `${it.index}-${it.itemName}` : 'empty'}`"
      class="slot"
      :class="it ? ['filled', i >= capacity ? 'overflow' : ''] : 'empty'"
      :title="it ? undefined : t('invbar.emptySlot')"
      @click="onCellClick(it, i)"
    >
      <img class="slot-bg" src="/icons/inventory/full_inventory_box.png" alt="" draggable="false">
      <img class="slot-hl" src="/icons/inventory/full_inventory_box_highlight.png" alt="" draggable="false">
      <NPopover
        v-if="it"
        trigger="hover" raw :show-arrow="false" placement="top"
        :delay="150" :duration="60"
      >
        <template #trigger>
          <div class="slot-face">
            <img
              v-if="iconOf(it)"
              class="slot-icon" :src="iconOf(it)" :alt="it.itemName" draggable="false"
            >
            <span v-else class="slot-fallback">{{ nameOf(it) }}</span>
            <span v-if="i >= capacity" class="slot-dup">!</span>
          </div>
        </template>
        <div class="game-tt">
          <div class="tt-head">
            <img v-if="iconOf(it)" :src="iconOf(it)" alt="" class="tt-icon">
            <span class="tt-name">{{ nameOf(it) }}</span>
          </div>
          <div v-if="descOf(it)" class="tt-desc">
            {{ descOf(it) }}
          </div>
          <div class="tt-kindline">
            {{ kindLabel(it.kind) }}
          </div>
          <template v-if="it.isContainer">
            <div class="tt-cap">
              {{ t('potion.slotCap', { slot: it.slot ?? '?', cap: it.capacity ?? '?' }) }}
            </div>
            <div v-if="!it.materials?.length" class="tt-empty">
              {{ t('invbar.ttEmpty') }}
            </div>
            <div v-for="m in it.materials" :key="m.material" class="tt-mat">
              <span>{{ matName(m) }}</span>
              <span class="tt-count">× {{ m.count }}</span>
            </div>
            <div class="tt-hint">
              {{ t('invbar.ttEditHint') }}
            </div>
          </template>
          <div v-else class="tt-hint">
            {{ t('invbar.ttDeleteHint') }}
          </div>
          <div v-if="i >= capacity" class="tt-warn">
            {{ t('invbar.ttOverflow') }}
          </div>
          <div class="tt-id">
            {{ it.itemName || '?' }} · {{ t('wand.slotLabel', { slot: it.slot ?? '?' }) }}
          </div>
        </div>
      </NPopover>
      <span v-else class="slot-plus">+</span>
    </div>
  </div>
</template>

<style scoped>
/* 与 SlotStrip 同一套游戏化格子语言;类名 .slot/.empty/.slot-swap-target
   被 SortableJS 配置引用,勿改。底图/高亮 20→40px,道具图标 16→32px。 */
.slots { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
.slot {
  position: relative;
  width: 40px;
  height: 40px;
  cursor: pointer;
  user-select: none;
}
.slot-bg, .slot-hl, .slot-icon { image-rendering: pixelated; pointer-events: none; }
.slot-bg, .slot-hl { position: absolute; inset: 0; width: 40px; height: 40px; }
.slot-hl { opacity: 0; }
.slot:hover .slot-hl { opacity: 1; }
.slot.overflow .slot-bg { outline: 1px solid #ff6b5e; }
.slot-swap-target { outline: 1px dashed #d8a24a; }
.slot-face { position: absolute; inset: 0; }
.slot-icon { position: absolute; left: 4px; top: 4px; width: 32px; height: 32px; }
.slot-plus {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #565664;
}
.slot.empty:hover .slot-plus { color: #d8a24a; }
.slot-fallback {
  position: absolute;
  inset: 4px;
  overflow: hidden;
  font-size: 8px;
  line-height: 1.1;
  word-break: break-all;
  color: #ddd;
  text-shadow: 1px 1px 0 #000;
}
.slot-dup {
  position: absolute;
  left: 2px;
  top: 0;
  font-size: 11px;
  font-weight: 700;
  color: #ff6b5e;
  text-shadow: 1px 1px 0 #000;
}

/* tooltip 面板样式为全局 .game-tt(styles/game-tooltip.css);此处仅保留
   道具专属的类别行(与 .tt-kind 徽标语义不同,故独立命名) */
.tt-kindline { color: #b5aec6; margin-top: 4px; }
</style>
