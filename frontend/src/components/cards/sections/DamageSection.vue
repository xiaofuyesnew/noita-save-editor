<script setup>
// 受伤倍率页签(原受伤倍率卡):15 类倍率动态表单 + 应用。
import { api } from '@/api/client'
import FieldLabel from '@/components/shared/FieldLabel.vue'
import { useSubmit } from '@/composables/useSubmit'
import { useSaveStore } from '@/stores/save'

const emit = defineEmits(['update:dirty'])
const save = useSaveStore()
const { t } = useI18n()
const { submitting, run: runSubmit } = useSubmit()

const KNOWN = [
  'melee',
  'projectile',
  'explosion',
  'electricity',
  'fire',
  'drill',
  'slice',
  'ice',
  'healing',
  'physics_hit',
  'radioactive',
  'poison',
  'overeating',
  'curse',
  'holy',
]

const entries = ref([]) // [{key, value}]
const baseline = ref({})

async function load() {
  const dmg = await api('/player/damage-multipliers')
  save.syncVersion(dmg.version)
  entries.value = Object.entries(dmg)
    .filter(([key]) => key !== 'version' && key !== 'ok')
    .map(([key, value]) => ({ key, value: Number(value) }))
  baseline.value = Object.fromEntries(entries.value.map(e => [e.key, e.value]))
}

const dirty = computed(() => entries.value.some(e => e.value !== baseline.value[e.key]))
watch(dirty, v => emit('update:dirty', v), { immediate: true })

const label = key => KNOWN.includes(key) ? `${t(`dmg.${key}`)} (${key})` : key

function apply() {
  return save.act(async () => {
    const patch = { version: save.version }
    for (const e of entries.value) patch[e.key] = String(e.value)
    await api('/player/damage-multipliers', { method: 'PUT', body: patch })
    await load()
  }, t('log.dmgApplied'))
}

onMounted(load)
const unsubscribe = save.onReload(load)
onBeforeUnmount(unsubscribe)
</script>

<template>
  <NFlex justify="space-between" align="flex-start" :wrap="false" class="mb-2">
    <NText :depth="3" class="text-11px lh-snug">
      {{ t('dmg.desc') }}
    </NText>
    <NButton size="small" type="primary" secondary :disabled="!dirty || submitting" :loading="submitting" @click="runSubmit(apply)">
      {{ t('common.apply') }}
    </NButton>
  </NFlex>
  <div class="field-grid">
    <NFlex v-for="e in entries" :key="e.key" vertical :size="2">
      <FieldLabel :label="label(e.key)" :tip="t('dmg.tip')" />
      <NInputNumber v-model:value="e.value" size="tiny" :show-button="false" />
    </NFlex>
  </div>
</template>
