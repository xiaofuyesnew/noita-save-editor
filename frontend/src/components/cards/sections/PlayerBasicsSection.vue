<script setup>
// 基础属性页签(原玩家属性卡):basics 表单 + 应用到缓冲。字段值一律字符串搬运。
// 位置 X/Y 可从 noitamap 选点弹窗右键回填(仍走「应用」按钮写入,不绕过表单)。
import { api } from '@/api/client'
import MapPickerModal from '@/components/cards/MapPickerModal.vue'
import FieldLabel from '@/components/shared/FieldLabel.vue'
import { useSaveStore } from '@/stores/save'

const emit = defineEmits(['update:dirty'])
const save = useSaveStore()
const { t } = useI18n()

// [表单键, i18n 键, 类型];表单键按 '_' 切分即 basics 补丁的嵌套路径
const FIELDS = [
  ['hp_current', 'player.hp', 'number'],
  ['hp_max', 'player.hpMax', 'number'],
  ['money', 'player.money', 'number'],
  ['air_inLungs', 'player.air', 'number'],
  ['position_x', 'player.posX', 'number'],
  ['position_y', 'player.posY', 'number'],
  ['fly_timeMax', 'player.fly', 'number'],
  ['movement_runVelocity', 'player.runVel', 'number'],
  ['movement_velocityMaxX', 'player.velMaxX', 'number'],
  ['movement_velocityMaxY', 'player.velMaxY', 'number'],
  ['air_needed', 'player.airNeeded', 'checkbox'],
  ['fly_needsRecharge', 'player.flyRecharge', 'checkbox'],
]

const form = reactive({})
const baseline = ref({})

function getIn(obj, parts) {
  return parts.reduce((o, k) => (o == null ? undefined : o[k]), obj)
}
function setIn(obj, parts, value) {
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++)
    cur = cur[parts[i]] ?? (cur[parts[i]] = {})
  cur[parts[parts.length - 1]] = value
}

async function load() {
  const basics = await api('/player/basics')
  save.syncVersion(basics.version)
  for (const [key, , type] of FIELDS) {
    const v = getIn(basics, key.split('_'))
    form[key] = type === 'checkbox' ? Number(v) !== 0 : String(v ?? '')
  }
  baseline.value = { ...form }
}

const dirty = computed(() => FIELDS.some(([key]) => form[key] !== baseline.value[key]))
watch(dirty, v => emit('update:dirty', v), { immediate: true })

function apply() {
  save.act(async () => {
    const patch = {}
    for (const [key, , type] of FIELDS) {
      if (type === 'checkbox')
        setIn(patch, key.split('_'), form[key] ? '1' : '0')
      else if (form[key] !== '')
        setIn(patch, key.split('_'), form[key])
    }
    await api('/player/basics', { method: 'PUT', body: patch })
    await load()
  }, t('log.basicsApplied'))
}

const mapShow = ref(false)

function onMapPick({ x, y }) {
  form.position_x = String(x)
  form.position_y = String(y)
}

onMounted(load)
save.onReload(load)
</script>

<template>
  <NFlex justify="space-between" align="flex-start" :wrap="false" class="mb-2">
    <NText :depth="3" class="text-11px lh-snug">
      {{ t('player.desc') }}
    </NText>
    <NFlex :size="6" :wrap="false">
      <NButton size="small" secondary @click="mapShow = true">
        {{ t('player.mapPick') }}
      </NButton>
      <NButton size="small" type="primary" secondary :disabled="!dirty" @click="apply">
        {{ t('common.apply') }}
      </NButton>
    </NFlex>
  </NFlex>
  <div class="field-grid">
    <template v-for="[key, i18nKey, type] in FIELDS" :key="key">
      <NCheckbox v-if="type === 'checkbox'" v-model:checked="form[key]" size="small">
        <FieldLabel :label="t(i18nKey)" :tip="t(`${i18nKey}.tip`)" />
      </NCheckbox>
      <NFlex v-else vertical :size="2">
        <FieldLabel :label="t(i18nKey)" :tip="t(`${i18nKey}.tip`)" />
        <NInput v-model:value="form[key]" size="tiny" />
      </NFlex>
    </template>
  </div>
  <MapPickerModal v-model:show="mapShow" @pick="onMapPick" />
</template>
