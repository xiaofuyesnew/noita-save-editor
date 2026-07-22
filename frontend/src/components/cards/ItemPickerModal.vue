<script setup>
// 道具选择器弹窗:搜索 + 分组过滤 + 像素图标网格,点击即注入到目标空槽。
// 目录含宝藏道具与药水/粉末袋空容器(container 组,注入后点槽位编辑材料)。
import { dictName, getLang } from '@/locales'
import { useDictStore } from '@/stores/dict'

const emit = defineEmits(['select'])
const show = defineModel('show', { type: Boolean, default: false })
const { t } = useI18n()
const dict = useDictStore()

const search = ref('')
const groupFilter = ref('')

watch(show, (v) => {
  if (v) {
    search.value = ''
    groupFilter.value = ''
    dict.ensureItemsCatalog()
  }
})

function groupLabel(group) {
  const key = `item.group.${group}`
  const label = t(key)
  return label === key ? group : label
}

// 字典 sprite 路径按 build-icons.js 的固定规则映射:'data/ui_gfx/' → '/icons/'
function iconUrl(spritePath) {
  return spritePath?.startsWith('data/ui_gfx/')
    ? `/icons/${spritePath.slice('data/ui_gfx/'.length)}`
    : ''
}
function descOf(it) {
  return getLang() === 'zh' ? (it.descZh || it.desc) : (it.desc || it.descZh)
}

const groupOptions = computed(() => {
  const groups = [...new Set((dict.itemsCatalog ?? []).map(x => x.group))]
  return [
    { label: t('picker.allTypes'), value: '' },
    ...groups.map(g => ({ label: groupLabel(g), value: g })),
  ]
})

const hits = computed(() => {
  const q = search.value.trim().toLowerCase()
  return (dict.itemsCatalog ?? []).filter(it =>
    (!groupFilter.value || it.group === groupFilter.value)
    && (!q
      || it.id.toLowerCase().includes(q)
      || (it.name && it.name.toLowerCase().includes(q))
      || (it.nameZh && it.nameZh.includes(q))))
})

function pick(it) {
  show.value = false
  emit('select', it)
}
</script>

<template>
  <NModal
    v-model:show="show" preset="card" :title="t('itempicker.title')"
    :style="{ width: '560px', maxWidth: '90vw' }" size="small"
  >
    <NFlex align="center" :size="8" :wrap="false">
      <NInput
        v-model:value="search" size="tiny" clearable class="flex-1"
        :placeholder="t('itempicker.searchPh')"
      />
      <NSelect v-model:value="groupFilter" size="tiny" :options="groupOptions" class="!w-40" />
    </NFlex>
    <NText :depth="3" class="block text-12px mt-2">
      {{ t('picker.matches', { n: hits.length }) }}
    </NText>
    <NScrollbar class="max-h-[55vh] mt-2">
      <div class="item-grid">
        <NPopover
          v-for="it in hits" :key="it.id"
          trigger="hover" raw :show-arrow="false" placement="top"
          :delay="150" :duration="60"
        >
          <template #trigger>
            <div class="item-cell" @click="pick(it)">
              <img
                v-if="iconUrl(it.uiSprite)"
                class="item-img" loading="lazy" :src="iconUrl(it.uiSprite)" :alt="it.id"
              >
              <span v-else class="item-img item-noicon">?</span>
              <span class="item-name">{{ dictName({ name: it.name, nameZh: it.nameZh, id: it.id }) }}</span>
              <span class="item-group">{{ groupLabel(it.group) }}</span>
            </div>
          </template>
          <div class="game-tt">
            <div class="tt-head">
              <img v-if="iconUrl(it.uiSprite)" :src="iconUrl(it.uiSprite)" alt="" class="tt-icon">
              <span class="tt-name">{{ dictName({ name: it.name, nameZh: it.nameZh, id: it.id }) }}</span>
            </div>
            <div v-if="descOf(it)" class="tt-desc">
              {{ descOf(it) }}
            </div>
            <div class="tt-kindline">
              {{ groupLabel(it.group) }}
            </div>
            <div class="tt-id">
              {{ it.id }}
            </div>
          </div>
        </NPopover>
      </div>
    </NScrollbar>
  </NModal>
</template>

<style scoped>
.item-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 4px; }
.item-cell {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 8px 4px 5px; border-radius: 4px; cursor: pointer;
  border: 1px solid transparent;
}
.item-cell:hover { background: rgba(255, 255, 255, 0.08); border-color: #d8a24a; }
/* 原版像素图 16px,2 倍整数缩放 */
.item-img { image-rendering: pixelated; width: 32px; height: 32px; object-fit: contain; }
.item-noicon { display: flex; align-items: center; justify-content: center; opacity: 0.5; }
.item-name { font-size: 12px; text-align: center; line-height: 1.2; }
.item-group { font-size: 11px; opacity: 0.55; }
/* tooltip 面板样式为全局 .game-tt;类别行与 ItemSlotStrip 同款独立命名 */
.tt-kindline { color: #b5aec6; margin-top: 4px; }
</style>
