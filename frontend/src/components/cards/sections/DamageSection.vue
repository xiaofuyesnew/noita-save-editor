<script setup>
// 受伤倍率页签(原受伤倍率卡):15 类倍率动态表单 + 应用。
import { api } from '@/api/client'
import FieldLabel from '@/components/shared/FieldLabel.vue'
import { useSaveStore } from '@/stores/save'

const emit = defineEmits(['update:dirty'])
const save = useSaveStore()
const { t } = useI18n()

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
  entries.value = Object.entries(dmg).map(([key, value]) => ({ key, value: String(value) }))
  baseline.value = Object.fromEntries(entries.value.map(e => [e.key, e.value]))
}

const dirty = computed(() => entries.value.some(e => e.value !== baseline.value[e.key]))
watch(dirty, v => emit('update:dirty', v), { immediate: true })

const label = key => KNOWN.includes(key) ? `${t(`dmg.${key}`)} (${key})` : key

function apply() {
  save.act(async () => {
    const patch = Object.fromEntries(entries.value.map(e => [e.key, e.value]))
    await api('/player/damage-multipliers', { method: 'PUT', body: patch })
    await load()
  }, t('log.dmgApplied'))
}

onMounted(load)
save.onReload(load)
</script>

<template>
  <NFlex justify="space-between" align="flex-start" :wrap="false" class="mb-2">
    <NText :depth="3" class="text-11px lh-snug">
      {{ t('dmg.desc') }}
    </NText>
    <NButton size="small" type="primary" secondary :disabled="!dirty" @click="apply">
      {{ t('common.apply') }}
    </NButton>
  </NFlex>
  <div class="field-grid">
    <NFlex v-for="e in entries" :key="e.key" vertical :size="2">
      <FieldLabel :label="label(e.key)" :tip="t('dmg.tip')" />
      <NInput v-model:value="e.value" size="tiny" />
    </NFlex>
  </div>
</template>
