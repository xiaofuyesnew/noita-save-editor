<script setup>
// 预设列表弹窗(§20 共享):按 category 参数化,三类通用。
//  - 顶部「存为预设」行:输入名称(+ 可选逗号分隔标签)→ emit('save') 交宿主建预设
//    (宿主提供领域上下文:法杖 index / 玩家坐标 / 当前天赋组);
//  - 列表:标签过滤 + 每条「应用/重命名/删除」。应用经 emit('apply') 交宿主注入语义
//    (坐标=填表、天赋=推暂存、法杖=载入编辑器),应用后关闭弹窗。
// 重命名/删除是通用持久化,直接走 presets store。
import { usePresetsStore } from '@/stores/presets'
import { confirmDialog } from '@/ui/discrete'

const props = defineProps({
  category: { type: String, required: true }, // locations | perks | wands
  defaultLabel: { type: String, default: '' },
  savable: { type: Boolean, default: true },
  saveText: { type: String, default: '' }, // 覆盖存储按钮文案(如坐标类「存当前玩家位」)
})
const emit = defineEmits(['save', 'apply'])
const show = defineModel('show', { type: Boolean, default: false })
const { t } = useI18n()
const presets = usePresetsStore()

const list = computed(() => presets[props.category] ?? [])

// ---- 过滤 ----
const filter = ref('')
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q)
    return list.value
  return list.value.filter(p =>
    (p.label ?? '').toLowerCase().includes(q)
    || (p.tags ?? []).some(tag => tag.toLowerCase().includes(q)))
})

// ---- 存为预设 ----
const label = ref('')
const tagsText = ref('')
function parseTags(text) {
  return text.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
}
function onSave() {
  const name = label.value.trim()
  if (!name)
    return
  emit('save', { label: name, tags: parseTags(tagsText.value) })
  label.value = ''
  tagsText.value = ''
}

// ---- 应用 ----
function onApply(preset) {
  emit('apply', preset)
  show.value = false
}

// ---- 重命名(行内) ----
const editingId = ref(null)
const editLabel = ref('')
function startRename(preset) {
  editingId.value = preset.id
  editLabel.value = preset.label
}
async function confirmRename(preset) {
  const name = editLabel.value.trim()
  if (name && name !== preset.label)
    await presets.rename(props.category, preset.id, name)
  editingId.value = null
}

// ---- 删除 ----
async function onDelete(preset) {
  const ok = await confirmDialog({
    title: t('preset.deleteTitle'),
    content: t('preset.deleteConfirm', { label: preset.label }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
  })
  if (ok)
    await presets.remove(props.category, preset.id)
}

// ---- 每条摘要文案 ----
function summary(p) {
  if (props.category === 'locations')
    return `(${p.x}, ${p.y})`
  if (props.category === 'wands')
    return t('preset.summaryWand', { n: p.summary?.spellCount ?? p.spells?.length ?? 0, lv: p.summary?.gunLevel ?? '?' })
  return t('preset.summaryPerks', { n: p.perks?.length ?? 0 })
}
const applyText = computed(() => t(`preset.apply.${props.category}`))

watch(show, async (v) => {
  if (v) {
    filter.value = ''
    editingId.value = null
    label.value = props.defaultLabel ?? ''
    tagsText.value = ''
    await presets.ensureLoaded()
  }
})
</script>

<template>
  <NModal
    v-model:show="show" preset="card" :title="t(`preset.title.${category}`)"
    :style="{ width: '520px', maxWidth: '94vw' }" size="small"
  >
    <!-- 存为预设 -->
    <NFlex v-if="savable" :size="6" align="center" :wrap="false" class="mb-2">
      <NInput
        v-model:value="label" size="small" class="flex-1"
        :placeholder="t('preset.labelPlaceholder')" @keyup.enter="onSave"
      />
      <NInput
        v-model:value="tagsText" size="small" style="width: 120px"
        :placeholder="t('preset.tagsPlaceholder')" @keyup.enter="onSave"
      />
      <NButton size="small" type="primary" secondary :disabled="!label.trim()" @click="onSave">
        {{ saveText || t('preset.save') }}
      </NButton>
    </NFlex>

    <!-- 过滤 -->
    <NInput
      v-model:value="filter" size="tiny" clearable class="mb-2"
      :placeholder="t('preset.filter')"
    />

    <!-- 列表 -->
    <NEmpty v-if="!filtered.length" :description="t('preset.empty')" class="my-4" />
    <NScrollbar v-else style="max-height: 46vh">
      <NFlex vertical :size="4">
        <div v-for="p in filtered" :key="p.id" class="preset-row">
          <div class="preset-main">
            <template v-if="editingId === p.id">
              <NInput
                v-model:value="editLabel" size="tiny" autofocus
                @keyup.enter="confirmRename(p)" @blur="confirmRename(p)"
              />
            </template>
            <template v-else>
              <div class="preset-label">
                {{ p.label }}
              </div>
              <div class="preset-meta">
                <span class="preset-summary">{{ summary(p) }}</span>
                <NTag v-for="tag in p.tags" :key="tag" size="tiny" :bordered="false" round>
                  {{ tag }}
                </NTag>
              </div>
            </template>
          </div>
          <NFlex :size="4" :wrap="false" class="preset-actions">
            <NButton size="tiny" type="primary" secondary @click="onApply(p)">
              {{ applyText }}
            </NButton>
            <NButton size="tiny" quaternary @click="startRename(p)">
              {{ t('preset.rename') }}
            </NButton>
            <NButton size="tiny" quaternary type="error" @click="onDelete(p)">
              {{ t('common.delete') }}
            </NButton>
          </NFlex>
        </div>
      </NFlex>
    </NScrollbar>
  </NModal>
</template>

<style scoped>
.preset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
}
.preset-main { flex: 1; min-width: 0; }
.preset-label { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preset-meta { display: flex; align-items: center; gap: 4px; margin-top: 1px; flex-wrap: wrap; }
.preset-summary { font-size: 11px; color: var(--n-text-color-disabled, #888); }
.preset-actions { flex: none; }
</style>
