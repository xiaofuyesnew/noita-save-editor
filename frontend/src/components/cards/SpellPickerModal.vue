<script setup>
// 法术选择器弹窗:搜索 + 类型过滤,点击行即添加到目标槽位;行悬浮弹出
// 与法术槽同款的游戏风格详情面板(SpellTooltip)。
import SpellTooltip from '@/components/shared/SpellTooltip.vue'
import { dictName, getLang } from '@/locales'
import { useDictStore } from '@/stores/dict'

const emit = defineEmits(['select'])
const show = defineModel('show', { type: Boolean, default: false })
const { t } = useI18n()
const dict = useDictStore()

const search = ref('')
const typeFilter = ref('')

watch(show, (v) => {
  if (v) {
    search.value = ''
    typeFilter.value = ''
  }
})

function typeLabel(type) {
  if (getLang() === 'zh')
    return dict.spellTypes?.find(x => x.type === type)?.nameZh ?? type ?? '?'
  return type ? t(`spelltype.${type}`) : '?'
}

// 字典 sprite 路径按 build-icons.js 的固定规则映射:'data/ui_gfx/' → '/icons/'
function iconUrl(spritePath) {
  return spritePath?.startsWith('data/ui_gfx/')
    ? `/icons/${spritePath.slice('data/ui_gfx/'.length)}`
    : ''
}
function bgUrl(type) {
  const bg = (dict.spellTypes ?? []).find(x => x.type === type)?.itemBg
    ?? 'data/ui_gfx/inventory/item_bg_other.png'
  return iconUrl(bg)
}
function descOf(s) {
  return getLang() === 'zh' ? (s.descZh || s.desc) : (s.desc || s.descZh)
}

const typeOptions = computed(() => [
  { label: t('picker.allTypes'), value: '' },
  ...(dict.spellTypes ?? []).map(ty => ({ label: typeLabel(ty.type), value: ty.type })),
])

const hits = computed(() => {
  const q = search.value.trim().toLowerCase()
  return (dict.spells ?? []).filter(s =>
    (!typeFilter.value || s.type === typeFilter.value)
    && (!q
      || s.id.toLowerCase().includes(q)
      || (s.name && s.name.toLowerCase().includes(q))
      || (s.nameZh && s.nameZh.includes(q))))
})

function pick(s) {
  show.value = false
  emit('select', s)
}
</script>

<template>
  <NModal
    v-model:show="show" preset="card" :title="t('picker.title')"
    :style="{ width: '640px', maxWidth: '90vw' }" size="small"
  >
    <NFlex align="center" :size="8" :wrap="false">
      <NInput
        v-model:value="search" size="tiny" clearable class="flex-1"
        :placeholder="t('picker.searchPh')"
      />
      <NSelect v-model:value="typeFilter" size="tiny" :options="typeOptions" class="!w-40" />
    </NFlex>
    <NText :depth="3" class="block text-12px mt-2">
      {{ t('picker.matches', { n: hits.length }) + (hits.length > 80 ? t('picker.matchesCap') : '') }}
    </NText>
    <NScrollbar class="max-h-[50vh] mt-2">
      <NPopover
        v-for="s in hits.slice(0, 80)" :key="s.id"
        trigger="hover" raw :show-arrow="false" placement="right"
        :delay="150" :duration="60"
      >
        <template #trigger>
          <NFlex
            justify="space-between" align="center" :wrap="false"
            class="px-2 py-1 rounded cursor-pointer hover:bg-white/8"
            @click="pick(s)"
          >
            <NFlex align="center" :size="8" :wrap="false" class="min-w-0">
              <span class="spell-chip">
                <img class="chip-bg" :src="bgUrl(s.type)" alt="">
                <img v-if="iconUrl(s.sprite)" class="chip-icon" :src="iconUrl(s.sprite)" :alt="s.id">
              </span>
              <div class="min-w-0">
                <NText class="text-13px block truncate">
                  {{ dictName(s) }} ({{ s.id }})
                </NText>
                <NText v-if="descOf(s)" :depth="3" class="text-12px block truncate">
                  {{ descOf(s) }}
                </NText>
              </div>
            </NFlex>
            <NText :depth="3" class="text-12px whitespace-nowrap">
              {{ `${typeLabel(s.type)} · ${t('picker.mana', { mana: s.mana })}${
                s.maxUses !== '-1' ? ` · ${t('picker.uses', { n: s.maxUses })}` : ''}` }}
            </NText>
          </NFlex>
        </template>
        <SpellTooltip :entry="s" />
      </NPopover>
    </NScrollbar>
  </NModal>
</template>

<style scoped>
/* 行内法术小图:原版像素图 1 倍尺寸(底图 20px + 图标 16px 居中),缩放会糊故不放大 */
.spell-chip { position: relative; width: 20px; height: 20px; flex: none; }
.chip-bg, .chip-icon { position: absolute; image-rendering: pixelated; }
.chip-bg { inset: 0; width: 20px; height: 20px; }
.chip-icon { left: 2px; top: 2px; width: 16px; height: 16px; }
</style>
