<script setup>
// 天赋页签:添加选择器(effect 型可选,complex 灰显;选项带天赋图标)。
// 「添加」只写本卡暂存(墙上以虚线展示),经卡顶「应用到缓冲」提交;
// 已有天赋的展示/移除在上方图标墙(EffectPerkWall)。
import { h } from 'vue'
import { dictName } from '@/locales'
import { useDictStore } from '@/stores/dict'
import { useEffPerkStore } from '@/stores/effperk'
import { uiGfxIconUrl } from '@/ui/dictIcon'

const dict = useDictStore()
const effperk = useEffPerkStore()
const { t } = useI18n()

const selected = ref('')

function markerOf(p) {
  if (p.kind !== 'effect')
    return t('perk.unsupported')
  if (p.funcImpact === 'major')
    return t('perk.majorMark')
  if (p.funcImpact === 'cost')
    return t('perk.costMark')
  if (p.funcImpact === 'minor')
    return t('perk.minorMark')
  return ''
}

const options = computed(() => {
  const order = { effect: 0, complex: 1 }
  return [...(dict.perks ?? [])].sort((a, b) =>
    (order[a.kind] - order[b.kind])
    || ((a.funcImpact === 'major' ? 1 : 0) - (b.funcImpact === 'major' ? 1 : 0)))
})

const perkOptions = computed(() => options.value.map(p => ({
  label: `${dictName(p)} (${p.id})${markerOf(p)}`,
  value: p.id,
  disabled: p.kind !== 'effect',
  icon: uiGfxIconUrl(p.uiIcon),
})))

// 选项/选中值渲染:16px 像素图标 + 文本(菜单传送至 body,样式须内联)
const OPT_ICON_STYLE = {
  width: '16px',
  height: '16px',
  objectFit: 'contain',
  imageRendering: 'pixelated',
  flex: 'none',
}
function renderOption(o) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 } }, [
    o.icon ? h('img', { src: o.icon, style: OPT_ICON_STYLE }) : h('span', { style: OPT_ICON_STYLE }),
    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, o.label),
  ])
}

watch(options, (opts) => {
  if (!selected.value && opts.length)
    selected.value = opts.find(p => p.kind === 'effect')?.id ?? ''
}, { immediate: true })

const note = computed(() => {
  const p = (dict.perks ?? []).find(x => x.id === selected.value)
  if (!p || p.kind !== 'effect' || !p.funcNote)
    return { text: p && p.kind === 'effect' ? t('perk.equiv') : '', warn: false }
  return { text: p.funcNote, warn: p.funcImpact === 'major' }
})

function add() {
  if (selected.value)
    effperk.stagePerkAdd(selected.value)
}
</script>

<template>
  <NText :depth="3" class="block text-11px lh-snug mb-2">
    {{ t('perk.desc') }}
  </NText>
  <NFlex align="center" :size="8" :wrap="false">
    <NSelect
      v-model:value="selected" size="tiny" filterable
      :options="perkOptions" :render-label="renderOption" class="flex-1"
    />
    <NButton size="small" type="primary" secondary @click="add">
      {{ t('perk.addBtn') }}
    </NButton>
  </NFlex>
  <NText :type="note.warn ? 'warning' : 'default'" :depth="note.warn ? undefined : 3" class="block text-12px mt-2">
    {{ note.text }}
  </NText>
  <NText :depth="3" class="block text-12px mt-2">
    {{ t('perk.legend') }}
  </NText>
</template>
