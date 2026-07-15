<script setup>
// 特殊效果页签:添加面板(分组/永久或秒数/HUD 图标/危险警示;选项带效果图标)。
// 「添加」只写本卡暂存(墙上以虚线展示),经卡顶「应用到缓冲」提交;
// 已有效果的展示/移除在上方图标墙(EffectPerkWall)。
import { h } from 'vue'
import FieldLabel from '@/components/shared/FieldLabel.vue'
import { getLang } from '@/locales'
import { useDictStore } from '@/stores/dict'
import { useEffPerkStore } from '@/stores/effperk'

const dict = useDictStore()
const effperk = useEffPerkStore()
const { t } = useI18n()

const GROUP_REC = '__rec__'

const group = ref(GROUP_REC)
const effectId = ref('')
const permanent = ref(true)
const seconds = ref('60')
const withIcon = ref(true)

const groups = computed(() =>
  [GROUP_REC, ...new Set((dict.effects ?? []).map(e => e.group))])

function groupLabel(g) {
  if (g === GROUP_REC)
    return t('eff.groupRec')
  const key = `effgroup.${g}`
  const label = t(key)
  return label === key ? g : label
}
function effLabel(e) {
  return getLang() === 'zh' && e.nameZh ? `${e.nameZh} (${e.id})` : e.id
}

const options = computed(() => (dict.effects ?? []).filter(e =>
  e.selectable !== false
  && (group.value === GROUP_REC ? e.recommended : e.group === group.value)))

const groupOptions = computed(() =>
  groups.value.map(g => ({ label: groupLabel(g), value: g })))
const effectOptions = computed(() =>
  options.value.map(e => ({
    label: effLabel(e) + (e.danger ? ' ⚠' : ''),
    value: e.id,
    icon: effperk.effectIconUrl(e.id),
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
  if (!opts.some(e => e.id === effectId.value))
    effectId.value = opts[0]?.id ?? ''
}, { immediate: true })

const dangerWarn = computed(() => {
  const e = (dict.effects ?? []).find(x => x.id === effectId.value)
  if (!e?.danger)
    return ''
  return t('eff.dangerWarn', { name: getLang() === 'zh' ? (e.nameZh || e.id) : e.id })
})

function add() {
  if (!effectId.value)
    return
  effperk.stageEffectAdd({
    effect: effectId.value,
    withIcon: withIcon.value,
    permanent: permanent.value,
    seconds: permanent.value ? undefined : (seconds.value || '60'),
  })
}
</script>

<template>
  <NText :depth="3" class="block text-11px lh-snug mb-2">
    {{ t('eff.desc') }}
  </NText>
  <NFlex align="center" :size="8">
    <NFlex vertical :size="2">
      <NText :depth="3" class="text-12px">
        {{ t('eff.group') }}
      </NText>
      <NSelect v-model:value="group" size="tiny" :options="groupOptions" class="w-36" />
    </NFlex>
    <NFlex vertical :size="2" class="flex-1 min-w-50">
      <NText :depth="3" class="text-12px">
        {{ t('eff.effect') }}
      </NText>
      <NSelect
        v-model:value="effectId" size="tiny" filterable
        :options="effectOptions" :render-label="renderOption"
      />
    </NFlex>
  </NFlex>
  <NFlex align="center" :size="12" class="mt-2">
    <NCheckbox v-model:checked="permanent" size="small">
      {{ t('eff.permanent') }}
    </NCheckbox>
    <NFlex align="center" :size="4" :wrap="false">
      <FieldLabel :label="t('eff.seconds')" :tip="t('eff.seconds.tip')" />
      <NInput v-model:value="seconds" size="tiny" :disabled="permanent" class="w-20" />
    </NFlex>
    <NCheckbox v-model:checked="withIcon" size="small">
      {{ t('eff.icon') }}
    </NCheckbox>
    <NButton size="small" type="primary" secondary @click="add">
      {{ t('eff.addBtn') }}
    </NButton>
  </NFlex>
  <NText v-if="dangerWarn" type="warning" class="block text-12px mt-2">
    {{ dangerWarn }}
  </NText>
</template>
