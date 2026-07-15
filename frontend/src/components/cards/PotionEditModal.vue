<script setup>
// 容器材料编辑弹窗:材料行增删改(NSelect 可搜可自定义)。只改本地编辑态,
// 「保存」把整表材料上报父级写入 items store 暂存(卡上「应用」统一提交);
// 「删除容器」同样只上报暂存删除。dirty 以打开时的材料快照为基线。
import { dictName } from '@/locales'
import { useDictStore } from '@/stores/dict'

const props = defineProps({
  // items store 暂存条目:index(统一道具索引)/ kind / slot / capacity / materials
  container: { type: Object, default: null },
})
const emit = defineEmits(['save', 'remove'])
const show = defineModel('show', { type: Boolean, default: false })

const dict = useDictStore()
const { t } = useI18n()

const materials = ref([])
const baseline = ref('')

watch(show, (v) => {
  if (v) {
    dict.ensureMaterials()
    materials.value = (props.container?.materials ?? [])
      .map(m => ({ material: m.material, count: m.count }))
    baseline.value = JSON.stringify(materials.value)
  }
})

const dirty = computed(() =>
  show.value && JSON.stringify(materials.value) !== baseline.value)

const matById = computed(() => new Map((dict.materials ?? []).map(m => [m.id, m])))

// 材料选项:液体/粉末在前(可倒入容器),其余靠后备查
const matOptions = computed(() => {
  const kindOrder = { liquid: 0, powder: 1, static: 2, gas: 3, fire: 4, solid: 5 }
  return [...(dict.materials ?? [])].sort((a, b) =>
    (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) || a.id.localeCompare(b.id))
})
const matSelectOptions = computed(() =>
  matOptions.value.map(m => ({ label: `${dictName(m)}(${m.kind})`, value: m.id })))

function kindLabel(kind) {
  const key = `potion.kind.${kind}`
  const label = t(key)
  return label === key ? kind : label
}
function matInfo(id) {
  const d = matById.value.get(id)
  return d ? `${dictName(d)} · ${d.kind}` : t('potion.unknownMat')
}

const title = computed(() => props.container
  ? `${t('potion.editorTitle')} · ${kindLabel(props.container.kind)}`
  : t('potion.editorTitle'))

function onSave() {
  show.value = false
  emit('save', materials.value.filter(m => (m.material ?? '').trim() !== ''))
}

function onRemove() {
  show.value = false
  emit('remove')
}
</script>

<template>
  <NModal
    v-model:show="show" preset="card" :title="title + (dirty ? ' *' : '')"
    :style="{ width: '520px', maxWidth: '90vw' }" size="small"
  >
    <NText v-if="container" :depth="3" class="block text-12px mb-2">
      {{ t('potion.slotCap', { slot: container.slot ?? '?', cap: container.capacity ?? '?' }) }}
    </NText>
    <NFlex v-for="(m, i) in materials" :key="i" align="center" :size="8" class="mb-1.5">
      <NSelect
        v-model:value="m.material" size="tiny" filterable tag clearable
        :options="matSelectOptions" :placeholder="t('potion.matPh')" class="!w-60"
      />
      <NText :depth="3" :type="matById.get(m.material) ? 'default' : 'warning'" class="text-12px flex-1">
        {{ matInfo(m.material) }}
      </NText>
      <NInput v-model:value="m.count" size="tiny" class="!w-24" />
      <NButton size="tiny" secondary @click="materials.splice(i, 1)">
        {{ t('common.delete') }}
      </NButton>
    </NFlex>
    <NButton size="small" class="mb-2" @click="materials.push({ material: '', count: '1000' })">
      {{ t('potion.addMat') }}
    </NButton>
    <NText :depth="3" class="block text-12px mb-2">
      {{ t('potion.hint') }}
    </NText>
    <NFlex justify="space-between" align="center">
      <NPopconfirm @positive-click="onRemove">
        <template #trigger>
          <NButton size="small" type="error" secondary>
            {{ t('potion.deleteBtn') }}
          </NButton>
        </template>
        {{ container ? t('invbar.deleteConfirm', { name: kindLabel(container.kind) }) : '' }}
      </NPopconfirm>
      <NButton size="small" type="primary" secondary :disabled="!dirty" @click="onSave">
        {{ t('common.save') }}
      </NButton>
    </NFlex>
  </NModal>
</template>
