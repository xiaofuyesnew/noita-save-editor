<script setup>
// 世界状态卡:白名单字段表单 + 运行旗标 + 真菌变换 + 只读 lua_globals。
import { api } from '@/api/client'
import CardShell from '@/components/shared/CardShell.vue'
import FieldLabel from '@/components/shared/FieldLabel.vue'
import { dictName } from '@/locales'
import { useDictStore } from '@/stores/dict'
import { useSaveStore } from '@/stores/save'

const save = useSaveStore()
const dict = useDictStore()
const { t } = useI18n()

const FIELD_DEFS = [
  ['dayCount', 'number'],
  ['time', 'number'],
  ['timeDt', 'number'],
  ['rain', 'number'],
  ['rainTarget', 'number'],
  ['fog', 'number'],
  ['fogTarget', 'number'],
  ['windSpeed', 'number'],
  ['everythingToGold', 'check'],
  ['infiniteGoldHappening', 'check'],
  ['openFogOfWarEverywhere', 'check'],
]

const form = reactive({})
const flags = ref([])
const shifts = ref([])
const newFlag = ref('')
const raw = ref('')
const baseline = ref('')

// 真菌变换的材料选择项(可搜可自定义 id)
const matSelectOptions = computed(() =>
  (dict.materials ?? []).map(m => ({ label: `${dictName(m)}(${m.kind})`, value: m.id })))

const snapshot = () => JSON.stringify([form, flags.value, shifts.value])

async function load() {
  await dict.ensureMaterials()
  const data = await api('/world/state')
  save.syncVersion(data.version)
  for (const [field, type] of FIELD_DEFS) {
    form[field] = type === 'check'
      ? Number(data.fields[field]) !== 0
      : String(data.fields[field] ?? '')
  }
  flags.value = [...data.flags]
  shifts.value = data.changedMaterials.map(p => ({ ...p }))
  raw.value = JSON.stringify({
    lua_globals: Object.fromEntries(data.luaGlobals.map(g => [g.key, g.value])),
    orbs_found_thisrun: data.orbsFoundThisrun,
  }, null, 2)
  baseline.value = snapshot()
}

const dirty = computed(() => snapshot() !== baseline.value)

function addFlag() {
  const flag = newFlag.value.trim()
  if (flag && !flags.value.includes(flag))
    flags.value.push(flag)
  newFlag.value = ''
}

function apply() {
  save.act(async () => {
    const fields = {}
    for (const [field, type] of FIELD_DEFS)
      fields[field] = type === 'check' ? (form[field] ? '1' : '0') : form[field]
    await api('/world/state', {
      method: 'PUT',
      body: {
        version: save.version,
        fields,
        flags: flags.value,
        changedMaterials: shifts.value.filter(p => (p.from ?? '').trim() || (p.to ?? '').trim()),
      },
    })
    await load()
  }, t('log.worldApplied'))
}

onMounted(load)
save.onReload(load)
</script>

<template>
  <CardShell id="worldCard" :title="t('world.title')" :desc="t('world.desc')" :dirty="dirty">
    <template #action>
      <NButton size="small" type="primary" secondary :disabled="!dirty" @click="apply">
        {{ t('common.apply') }}
      </NButton>
    </template>
    <div class="field-grid">
      <template v-for="[field, type] in FIELD_DEFS" :key="field">
        <NCheckbox v-if="type === 'check'" v-model:checked="form[field]" size="small">
          <FieldLabel :label="t(`world.f.${field}`)" :tip="`${t(`world.f.${field}.tip`)} ${t('world.checkTip')}`" />
        </NCheckbox>
        <NFlex v-else vertical :size="2">
          <FieldLabel :label="t(`world.f.${field}`)" :tip="t(`world.f.${field}.tip`)" />
          <NInput v-model:value="form[field]" size="tiny" />
        </NFlex>
      </template>
    </div>
    <NDivider title-placement="left" class="!my-2 !text-13px">
      {{ t('world.flags') }}
    </NDivider>
    <NEmpty v-if="flags.length === 0" size="small" :description="t('world.noFlags')" />
    <NFlex
      v-for="(flag, i) in flags" :key="flag"
      justify="space-between" align="center" :wrap="false" class="py-0.5"
    >
      <NText class="text-12px min-w-0">
        {{ flag }}
      </NText>
      <NButton size="tiny" secondary @click="flags.splice(i, 1)">
        {{ t('common.delete') }}
      </NButton>
    </NFlex>
    <NInputGroup class="mt-2">
      <NInput v-model:value="newFlag" size="tiny" :placeholder="t('world.flagPh')" @keyup.enter="addFlag" />
      <NButton size="tiny" @click="addFlag">
        {{ t('world.addFlag') }}
      </NButton>
    </NInputGroup>
    <NDivider title-placement="left" class="!my-2 !text-13px">
      {{ t('world.shifts') }}
    </NDivider>
    <NText v-if="shifts.length === 0" :depth="3" class="block text-12px">
      {{ t('world.noShifts') }}
    </NText>
    <NFlex v-for="(pair, i) in shifts" :key="i" align="center" :size="8" :wrap="false" class="mb-1.5">
      <NSelect
        v-model:value="pair.from" size="tiny" filterable tag clearable
        :options="matSelectOptions" :placeholder="t('world.from')"
      />
      <NText :depth="3">
        →
      </NText>
      <NSelect
        v-model:value="pair.to" size="tiny" filterable tag clearable
        :options="matSelectOptions" :placeholder="t('world.to')"
      />
      <NButton size="tiny" secondary @click="shifts.splice(i, 1)">
        {{ t('common.delete') }}
      </NButton>
    </NFlex>
    <NButton size="small" class="mt-1" @click="shifts.push({ from: '', to: '' })">
      {{ t('world.addShift') }}
    </NButton>
    <NCollapse class="mt-3">
      <NCollapseItem :title="t('world.raw')">
        <pre class="m-0 text-12px whitespace-pre-wrap break-all max-h-65 overflow-auto">{{ raw }}</pre>
      </NCollapseItem>
    </NCollapse>
  </CardShell>
</template>
