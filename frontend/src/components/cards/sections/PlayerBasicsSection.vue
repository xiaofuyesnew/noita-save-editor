<script setup>
// 基础属性页签(原玩家属性卡):basics 表单 + 应用到缓冲。字段值一律字符串搬运。
// 位置 X/Y 可从 noitamap 选点弹窗右键回填(仍走「应用」按钮写入,不绕过表单)。
import { api } from '@/api/client'
import MapPickerModal from '@/components/cards/MapPickerModal.vue'
import FieldLabel from '@/components/shared/FieldLabel.vue'
import PresetListModal from '@/components/shared/PresetListModal.vue'
import { useSubmit } from '@/composables/useSubmit'
import { usePresetsStore } from '@/stores/presets'
import { useSaveStore } from '@/stores/save'

const emit = defineEmits(['update:dirty'])
const save = useSaveStore()
const presets = usePresetsStore()
const { t } = useI18n()
const { submitting, run: runSubmit } = useSubmit()

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
    form[key] = type === 'checkbox' ? Number(v) !== 0 : (type === 'number' ? Number(v) : String(v ?? ''))
  }
  baseline.value = { ...form }
}

const dirty = computed(() => FIELDS.some(([key]) => form[key] !== baseline.value[key]))
watch(dirty, v => emit('update:dirty', v), { immediate: true })

function apply() {
  return save.act(async () => {
    const patch = { version: save.version }
    for (const [key, , type] of FIELDS) {
      if (type === 'checkbox')
        setIn(patch, key.split('_'), form[key] ? '1' : '0')
      else if (type === 'number' && form[key] != null)
        setIn(patch, key.split('_'), String(form[key]))
    }
    await api('/player/basics', { method: 'PUT', body: patch })
    await load()
  }, t('log.basicsApplied'))
}

const mapShow = ref(false)

// 位置字段是 NInputNumber(v-model 需 number);写 number 而非 String(x),
// 否则组件收到字符串会显示为空(载入坐标预设 / 地图选点均经此)。
function onMapPick({ x, y }) {
  form.position_x = Number(x)
  form.position_y = Number(y)
}

// ---- 坐标预设(§20):存当前位 / 应用即填表(仍走「应用」写入,与地图选点同链) ----
const showLocPresets = ref(false)
function onSaveLoc({ label, tags }) {
  presets.createLocation({ label, tags, x: form.position_x, y: form.position_y })
}
function onApplyLoc(preset) {
  onMapPick({ x: preset.x, y: preset.y })
}
// 地图右键「存为坐标预设」:先把悬浮点填进表单,再开预设面板命名(存的即该点)
function onMapSavePreset(point) {
  onMapPick(point)
  showLocPresets.value = true
}

onMounted(load)
const unsubscribe = save.onReload(load)
onBeforeUnmount(unsubscribe)
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
      <NButton size="small" secondary @click="showLocPresets = true">
        {{ t('preset.entry') }}
      </NButton>
      <NButton size="small" type="primary" secondary :disabled="!dirty || submitting" :loading="submitting" @click="runSubmit(apply)">
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
        <NInputNumber v-model:value="form[key]" size="tiny" :show-button="false" />
      </NFlex>
    </template>
  </div>
  <MapPickerModal v-model:show="mapShow" @pick="onMapPick" @save-preset="onMapSavePreset" />
  <PresetListModal
    v-model:show="showLocPresets" category="locations"
    :save-text="t('preset.saveCurrentPos')"
    @save="onSaveLoc" @apply="onApplyLoc"
  />
</template>
