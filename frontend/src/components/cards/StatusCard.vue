<script setup>
// 存档状态卡:路径编辑 + 状态 label-value(功能③)。
// 路径输入只在用户未改动时跟随服务端值(watch status,untouched 才回填)。
import CardShell from '@/components/shared/CardShell.vue'
import FieldLabel from '@/components/shared/FieldLabel.vue'
import { useSubmit } from '@/composables/useSubmit'
import { useSaveStore } from '@/stores/save'

const save = useSaveStore()
const { t } = useI18n()
const { submitting, run: runSubmit } = useSubmit()

const saveDir = ref('')
const liveDir = ref('')
const serverSaveDir = ref('')
const serverLiveDir = ref('')

watch(() => save.status, (s) => {
  if (!s)
    return
  if (saveDir.value === '' || saveDir.value === serverSaveDir.value)
    saveDir.value = s.saveDir ?? ''
  if (liveDir.value === '' || liveDir.value === serverLiveDir.value)
    liveDir.value = s.liveDir ?? ''
  serverSaveDir.value = s.saveDir ?? ''
  serverLiveDir.value = s.liveDir ?? ''
}, { immediate: true })

const dirtyForm = computed(() =>
  saveDir.value !== serverSaveDir.value || liveDir.value !== serverLiveDir.value)

async function apply() {
  if (await save.applyPaths(saveDir.value.trim(), liveDir.value.trim())) {
    saveDir.value = serverSaveDir.value = save.status?.saveDir ?? ''
    liveDir.value = serverLiveDir.value = save.status?.liveDir ?? ''
  }
}

const lastBackup = computed(() => {
  const b = save.status?.backups?.[0]
  return b ? `${b.name}(${new Date(b.mtime).toLocaleString()})` : t('common.none')
})
</script>

<template>
  <CardShell
    id="statusCard" :title="t('status.title')" :desc="t('status.desc')" :dirty="dirtyForm"
  >
    <template #action>
      <NButton size="small" type="primary" secondary :disabled="!dirtyForm || submitting" :loading="submitting" @click="runSubmit(apply)">
        {{ t('common.applyNow') }}
      </NButton>
    </template>
    <NFlex vertical :size="2" class="mb-2">
      <FieldLabel :label="t('status.saveDir')" :tip="t('status.saveDir.tip')" />
      <NInput v-model:value="saveDir" size="tiny" :spellcheck="false" />
    </NFlex>
    <NFlex vertical :size="2" class="mb-3">
      <FieldLabel :label="t('status.liveDir')" :tip="t('status.liveDir.tip')" />
      <NInput v-model:value="liveDir" size="tiny" :spellcheck="false" />
    </NFlex>
    <NDescriptions label-placement="left" :column="1" size="small" separator=":">
      <NDescriptionsItem :label="t('status.game')">
        <NText :type="save.gameRunning ? 'warning' : 'success'" class="text-12px">
          {{ save.gameRunning ? t('st.running') : t('st.notRunning') }}
        </NText>
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('status.live')">
        {{ save.status?.liveExists ? t('st.exists') : t('st.missing') }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('status.buffer')">
        {{ save.dirty ? t('st.dirtyFiles', { files: (save.status?.dirtyFiles ?? []).join(', ') }) : t('st.clean') }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('status.version')">
        {{ save.version }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('status.managed')">
        {{ (save.status?.managedFiles ?? []).join(', ') || t('common.none') }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('status.backups')">
        {{ save.status?.backupsTotal ?? 0 }}
      </NDescriptionsItem>
      <NDescriptionsItem :label="t('status.lastBackup')">
        {{ lastBackup }}
      </NDescriptionsItem>
    </NDescriptions>
  </CardShell>
</template>
