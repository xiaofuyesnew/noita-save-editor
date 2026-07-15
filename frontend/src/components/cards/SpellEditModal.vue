<script setup>
// 已占槽法术编辑弹窗:剩余次数 / Always Cast / 删除。
import FieldLabel from '@/components/shared/FieldLabel.vue'
import { dictName } from '@/locales'
import { useDictStore } from '@/stores/dict'

const props = defineProps({
  spell: { type: Object, default: null },
})
const emit = defineEmits(['save', 'remove'])
const show = defineModel('show', { type: Boolean, default: false })
const { t } = useI18n()
const dict = useDictStore()

const uses = ref('-1')
const alwaysCast = ref(false)

watch(show, (v) => {
  if (v && props.spell) {
    uses.value = props.spell.usesRemaining ?? '-1'
    alwaysCast.value = props.spell.alwaysCast
  }
})

const title = computed(() => {
  if (!props.spell)
    return ''
  const d = (dict.spells ?? []).find(x => x.id === props.spell.actionId)
  const name = dictName({ ...props.spell, id: props.spell.actionId, name: d?.name }) || props.spell.actionId
  return `${name}(${t('wand.slotLabel', { slot: props.spell.slot })})`
})

function onSave() {
  show.value = false
  emit('save', { usesRemaining: uses.value, alwaysCast: alwaysCast.value })
}
function onRemove() {
  show.value = false
  emit('remove')
}
</script>

<template>
  <NModal
    v-model:show="show" preset="card" :title="title"
    :style="{ width: '480px', maxWidth: '90vw' }" size="small"
  >
    <NFlex align="center" :size="16">
      <NFlex vertical :size="2">
        <FieldLabel :label="t('spellEdit.uses')" :tip="t('spellEdit.uses.tip')" />
        <NInput v-model:value="uses" size="tiny" class="!w-32" />
      </NFlex>
      <NCheckbox v-model:checked="alwaysCast" size="small">
        {{ t('spellEdit.ac') }}
      </NCheckbox>
    </NFlex>
    <template #footer>
      <NFlex :size="8">
        <NButton size="small" type="primary" secondary @click="onSave">
          {{ t('common.save') }}
        </NButton>
        <NButton size="small" type="error" secondary @click="onRemove">
          {{ t('spellEdit.delete') }}
        </NButton>
        <NButton size="small" @click="show = false">
          {{ t('common.cancel') }}
        </NButton>
      </NFlex>
    </template>
  </NModal>
</template>
