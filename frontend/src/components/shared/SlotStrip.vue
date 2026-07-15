<script setup>
// 法术槽格子条:法杖内/背包通用。空槽点击 → pick;已占点击 → edit;
// 拖拽(SortableJS Swap)→ reorder(上报新顺序的卡片序号 idx 数组)。
// 重复槽位(游戏自产)顺延到下一空格显示;寻址用 idx,与普通卡无差别,
// 直接编辑即可,UI 不作任何提示。
// 格子按游戏物品栏渲染:类型底图(item_bg_*)+ 法术像素图标 2 倍整数缩放;
// 悬浮弹出游戏风格 tooltip(名称/描述/类型/次数/法力/价格,配原版统计小图标)。
//
// 约束:v-for 必须直接写在格子 div 上(迭代根 = 普通元素,Vue 按引用卸载)。
// 不能用 <template v-for> 或让 NPopover 当迭代根 —— 那会把每格包成 fragment,
// 锚点(生产环境为空文本节点)留在原位而 Sortable 把格子移走,按锚点区间
// 卸载就会漏删,残留幽灵格(表现:拖到末格后多出一格、法术看似被复制)。
import { useSlotDrag } from '@/composables/useSlotDrag'
import { dictName, getLang } from '@/locales'
import { useDictStore } from '@/stores/dict'

const props = defineProps({
  capacity: { type: Number, default: 0 },
  spells: { type: Array, required: true },
})
const emit = defineEmits(['pick', 'edit', 'reorder'])

const { t } = useI18n()
const dict = useDictStore()

const stripEl = ref(null)
const renderKey = ref(0) // 拖拽后 DOM 由 Sortable 动过,bump 强制按状态重建

// 槽位 → 显示格:冲突的顺延到下一空格(与旧 renderSlotStrip 相同)
const cells = computed(() => {
  const sorted = [...props.spells].sort((a, b) => a.slot - b.slot)
  const out = []
  for (const s of sorted) out[Math.max(s.slot, out.length)] = s
  const count = Math.max(props.capacity, out.length, 0)
  out.length = count
  return [...out]
})

// ---- 字典与图标 --------------------------------------------------------------
// 字典 sprite 路径按 build-icons.js 的固定规则映射:'data/ui_gfx/' → '/icons/'
function iconUrl(spritePath) {
  return spritePath?.startsWith('data/ui_gfx/')
    ? `/icons/${spritePath.slice('data/ui_gfx/'.length)}`
    : ''
}

const spellById = computed(() => new Map((dict.spells ?? []).map(s => [s.id, s])))

function dictOf(spell) {
  return spellById.value.get(spell.actionId)
}
function bgUrl(spell) {
  const type = dictOf(spell)?.type
  const bg = (dict.spellTypes ?? []).find(x => x.type === type)?.itemBg
    ?? 'data/ui_gfx/inventory/item_bg_other.png'
  return iconUrl(bg)
}
function spellIconUrl(spell) {
  return iconUrl(dictOf(spell)?.sprite)
}
function nameOf(spell) {
  const d = dictOf(spell)
  return dictName({ ...spell, id: spell.actionId, name: d?.name }) || spell.actionId
}
function descOf(spell) {
  const d = dictOf(spell)
  if (!d)
    return ''
  return getLang() === 'zh' ? (d.descZh || d.desc) : (d.desc || d.descZh)
}
function typeLabel(spell) {
  const type = dictOf(spell)?.type
  return type ? t(`spelltype.${type}`) : '?'
}
function usesLabel(spell) {
  return spell.usesRemaining === '-1' ? t('wand.tt.unlimited') : spell.usesRemaining
}

function onCellClick(spell, displaySlot) {
  if (!spell) {
    emit('pick', displaySlot)
    return
  }
  emit('edit', spell)
}

useSlotDrag(stripEl, (fromIdx, toIdx) => {
  const arranged = [...cells.value];
  [arranged[fromIdx], arranged[toIdx]] = [arranged[toIdx], arranged[fromIdx]]
  const order = arranged.filter(Boolean).map(s => s.idx)
  renderKey.value++ // 丢弃 Sortable 的 DOM 改动,等状态刷新
  if (order.length > 0)
    emit('reorder', order)
})
</script>

<template>
  <div ref="stripEl" class="slots">
    <div
      v-for="(spell, i) in cells"
      :key="`${renderKey}-${i}-${spell ? spell.idx : 'empty'}`"
      class="slot"
      :class="spell ? ['filled', spell.alwaysCast ? 'ac' : ''] : 'empty'"
      :title="spell ? undefined : t('wand.addSpell')"
      @click="onCellClick(spell, i)"
    >
      <NPopover
        v-if="spell"
        trigger="hover" raw :show-arrow="false" placement="top"
        :delay="150" :duration="60"
      >
        <template #trigger>
          <div class="slot-face">
            <img class="slot-bg" :src="bgUrl(spell)" alt="" draggable="false">
            <img
              v-if="spellIconUrl(spell)"
              class="slot-icon" :src="spellIconUrl(spell)" :alt="spell.actionId" draggable="false"
            >
            <span v-else class="slot-fallback">{{ spell.actionId }}</span>
            <span v-if="spell.usesRemaining !== '-1'" class="slot-uses">{{ spell.usesRemaining }}</span>
          </div>
        </template>
        <div class="spell-tt">
          <div class="tt-head">
            <img v-if="spellIconUrl(spell)" :src="spellIconUrl(spell)" alt="" class="tt-icon">
            <span class="tt-name">{{ nameOf(spell) }}</span>
          </div>
          <div v-if="descOf(spell)" class="tt-desc">
            {{ descOf(spell) }}
          </div>
          <div class="tt-stats">
            <div class="tt-row">
              <span class="tt-lbl"><img src="/icons/inventory/icon_action_type.png" alt="">{{ t('wand.tt.type') }}</span>
              <span>{{ typeLabel(spell) }}</span>
            </div>
            <div class="tt-row">
              <span class="tt-lbl"><img src="/icons/inventory/icon_action_max_uses.png" alt="">{{ t('wand.tt.uses') }}</span>
              <span>{{ usesLabel(spell) }}<template v-if="dictOf(spell) && dictOf(spell).maxUses !== '-1'">
                / {{ dictOf(spell).maxUses }}</template></span>
            </div>
            <div class="tt-row">
              <span class="tt-lbl"><img src="/icons/inventory/icon_mana_drain.png" alt="">{{ t('wand.tt.mana') }}</span>
              <span class="tt-mana">{{ dictOf(spell)?.mana ?? '?' }}</span>
            </div>
            <div v-if="dictOf(spell)?.price" class="tt-row">
              <span class="tt-lbl"><span class="tt-lbl-pad" />{{ t('wand.tt.price') }}</span>
              <span class="tt-gold">{{ dictOf(spell).price }}</span>
            </div>
            <div v-if="spell.alwaysCast" class="tt-row tt-ac">
              <span class="tt-lbl"><img src="/icons/inventory/icon_gun_permanent_actions.png" alt=""></span>
              <span>{{ t('wand.tt.ac') }}</span>
            </div>
          </div>
          <div class="tt-id">
            {{ spell.actionId }} · {{ t('wand.slotLabel', { slot: spell.slot }) }}
          </div>
        </div>
      </NPopover>
      <template v-else>
        +
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 法术槽格子是游戏化的自定义拖拽 UI,Naive 没有对应组件;
   类名 .slot/.empty/.slot-swap-target 被 SortableJS 配置引用,勿改。
   尺寸取原版像素图的 2 倍整数缩放:底图 20→40px,法术图标 16→32px。 */
.slots { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
.slot {
  position: relative;
  width: 40px;
  height: 40px;
  cursor: pointer;
  user-select: none;
}
.slot.empty {
  border: 1px solid #3a3a45;
  background: #0d0d12;
  box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.8);
  color: #565664;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}
.slot.empty:hover { border-color: #d8a24a; color: #d8a24a; }
.slot.filled:hover .slot-bg { filter: brightness(1.25); }
.slot.filled.ac { box-shadow: 0 0 5px rgba(216, 162, 74, 0.7); }
.slot.filled.ac .slot-bg { outline: 1px solid #d8a24a; }
.slot-swap-target { outline: 1px dashed #d8a24a; }
.slot-face { position: absolute; inset: 0; }
.slot-bg, .slot-icon { image-rendering: pixelated; pointer-events: none; }
.slot-bg { position: absolute; inset: 0; width: 40px; height: 40px; }
.slot-icon { position: absolute; left: 4px; top: 4px; width: 32px; height: 32px; }
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
.slot-uses {
  position: absolute;
  right: 2px;
  bottom: 0;
  font-size: 10px;
  color: #ffe9a8;
  text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000;
}

/* ---- 游戏风格 tooltip(仿原版深色面板 + 浅色像素描边) ---- */
.spell-tt {
  background: rgba(14, 12, 18, 0.96);
  border: 2px solid #b8b4c0;
  outline: 2px solid #17131f;
  padding: 10px 12px;
  min-width: 200px;
  max-width: 300px;
  color: #e8e4da;
  font-size: 12px;
  line-height: 1.5;
}
.tt-head { display: flex; align-items: center; gap: 8px; }
.tt-icon { width: 24px; height: 24px; image-rendering: pixelated; }
.tt-name { font-size: 14px; font-weight: 600; color: #fff; }
.tt-desc { color: #b5aec6; margin: 6px 0 2px; }
.tt-stats { margin-top: 6px; }
.tt-row { display: flex; align-items: center; gap: 8px; line-height: 20px; }
.tt-lbl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 92px;
  flex: none;
  color: #9e97ad;
}
.tt-lbl img { width: 14px; height: 14px; image-rendering: pixelated; }
.tt-lbl-pad { width: 14px; height: 14px; }
.tt-mana { color: #8faef5; }
.tt-gold { color: #ffd75e; }
.tt-ac { color: #d8a24a; }
.tt-id { margin-top: 6px; color: #6d6680; font-size: 11px; }
</style>
