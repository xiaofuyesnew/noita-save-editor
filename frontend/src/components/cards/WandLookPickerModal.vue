<script setup>
// 法杖外观选择器弹窗(§12):搜索 + 网格像素预览,点击即回填 spriteFile 表单值。
// 1002 条全量渲染,预览图 loading="lazy" 按需加载。
import { useDictStore } from '@/stores/dict'
import { wandIconUrl } from '@/ui/wandIcon'

defineProps({ current: { type: String, default: '' } })
const emit = defineEmits(['select'])
const show = defineModel('show', { type: Boolean, default: false })
const { t } = useI18n()
const dict = useDictStore()

const search = ref('')

watch(show, (v) => {
  if (v) {
    search.value = ''
    dict.ensureWands()
  }
})

const hits = computed(() => {
  const q = search.value.trim().toLowerCase()
  return (dict.wands ?? []).filter(w =>
    !q || w.id.toLowerCase().includes(q) || (w.name && w.name.toLowerCase().includes(q)))
})

function pick(w) {
  show.value = false
  emit('select', w)
}
</script>

<template>
  <NModal
    v-model:show="show" preset="card" :title="t('wandpicker.title')"
    :style="{ width: '720px', maxWidth: '92vw' }" size="small"
  >
    <NInput
      v-model:value="search" size="tiny" clearable
      :placeholder="t('wandpicker.searchPh')"
    />
    <NText :depth="3" class="block text-12px mt-2">
      {{ t('picker.matches', { n: hits.length }) }}
    </NText>
    <NScrollbar class="max-h-[55vh] mt-2">
      <div class="look-grid">
        <div
          v-for="w in hits" :key="w.id"
          class="look-cell" :class="{ current: w.file === current }"
          :title="w.name ? `${w.id} · ${w.name}` : w.id"
          @click="pick(w)"
        >
          <img class="look-img" loading="lazy" :src="wandIconUrl(w.file)" :alt="w.id">
          <span class="look-id">{{ w.id.replace(/^wand_/, '') }}</span>
        </div>
      </div>
    </NScrollbar>
  </NModal>
</template>

<style scoped>
.look-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(68px, 1fr)); gap: 4px; }
.look-cell {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 6px 2px 3px; border-radius: 4px; cursor: pointer;
  border: 1px solid transparent;
}
.look-cell:hover { background: rgba(255, 255, 255, 0.08); }
.look-cell.current { border-color: #d8a24a; }
/* 原版像素图尺寸不一(约 10–30px 宽),统一 30px 高 contain 缩放 */
.look-img { image-rendering: pixelated; height: 30px; max-width: 60px; object-fit: contain; }
.look-id { font-size: 11px; opacity: 0.65; }
</style>
