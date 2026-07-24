<script setup>
// 进度解锁卡:card_unlocked_* 旗标文件开关,批量应用(立即写盘,不走缓冲)。
import { api } from '@/api/client'
import CardShell from '@/components/shared/CardShell.vue'
import FieldLabel from '@/components/shared/FieldLabel.vue'
import { useCardLoad } from '@/composables/useCardLoad'
import { useSubmit } from '@/composables/useSubmit'
import { dictName } from '@/locales'
import { useSaveStore } from '@/stores/save'

const save = useSaveStore()
const { t } = useI18n()
const { submitting, run: runSubmit } = useSubmit()

const unlocks = ref([]) // [{flag, unlocked(编辑态), known, spells}]
const original = ref(new Map())

async function load() {
  const data = await api('/persistent/unlocks')
  save.syncVersion(data.version)
  unlocks.value = data.unlocks.map(u => ({ ...u }))
  original.value = new Map(data.unlocks.map(u => [u.flag, u.unlocked]))
}

const pending = computed(() =>
  unlocks.value.filter(u => u.unlocked !== original.value.get(u.flag)))
const onCount = computed(() => unlocks.value.filter(u => u.unlocked).length)

function setAll(state) {
  for (const u of unlocks.value) u.unlocked = state
}

function shortName(flag) {
  return flag.replace(/^card_unlocked_/, '')
}
function tipOf(u) {
  return u.known
    ? t('unlock.knownTip', {
        names: u.spells.map(s => dictName(s) || s.id).join(', '),
        ids: u.spells.map(s => s.id).join(', '),
      })
    : t('unlock.unknownTip')
}

function apply() {
  const changes = Object.fromEntries(pending.value.map(u => [u.flag, u.unlocked]))
  if (Object.keys(changes).length === 0)
    return
  return save.act(async () => {
    await api('/persistent/unlocks', { method: 'PUT', body: { changes } })
    await load()
  }, t('log.unlocksApplied', { n: Object.keys(changes).length }))
}

const { error, run: runLoad, retry } = useCardLoad(load)
onMounted(runLoad)
const unsubscribe = save.onReload(load)
onBeforeUnmount(unsubscribe)
</script>

<template>
  <CardShell
    id="unlockCard" :title="t('unlock.title')" :desc="t('unlock.desc')"
    :dirty="pending.length > 0" :load-error="error" @retry="retry"
  >
    <template #action>
      <NButton size="small" type="primary" secondary :disabled="pending.length === 0 || submitting" :loading="submitting" @click="runSubmit(apply)">
        {{ t('unlock.apply') }}
      </NButton>
    </template>
    <NFlex align="center" :size="8" class="mb-2">
      <NButton size="small" @click="setAll(true)">
        {{ t('unlock.all') }}
      </NButton>
      <NButton size="small" @click="setAll(false)">
        {{ t('unlock.none') }}
      </NButton>
      <NText :depth="3" class="text-12px">
        {{ t('unlock.stats', { on: onCount, total: unlocks.length })
          + (pending.length ? t('unlock.pending', { n: pending.length }) : '') }}
      </NText>
    </NFlex>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-3 gap-y-1">
      <NCheckbox v-for="u in unlocks" :key="u.flag" v-model:checked="u.unlocked" size="small">
        <FieldLabel :label="shortName(u.flag) + (u.known ? '' : ' ?')" :tip="tipOf(u)" />
      </NCheckbox>
    </div>
  </CardShell>
</template>
