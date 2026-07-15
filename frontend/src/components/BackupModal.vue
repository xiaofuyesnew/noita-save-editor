<script setup>
// 备份管理弹窗:NModal preset=card;删除确认用 NPopconfirm。
import { useSaveStore } from '@/stores/save'

const show = defineModel('show', { type: Boolean, default: false })
const save = useSaveStore()
const { t } = useI18n()

watch(show, (v) => {
  if (v)
    save.loadBackups()
})
</script>

<template>
  <NModal
    v-model:show="show" preset="card" :title="t('backup.title')"
    :style="{ width: '720px', maxWidth: '90vw' }" size="small"
  >
    <NFlex align="center" :size="8" :wrap="false">
      <NButton size="small" type="primary" secondary @click="save.createBackup()">
        {{ t('backup.create') }}
      </NButton>
      <NText :depth="3" class="text-12px">
        {{ t('backup.hint') }}
      </NText>
    </NFlex>
    <NScrollbar class="max-h-[55vh] mt-3">
      <NEmpty v-if="save.backups.length === 0" size="small" :description="t('backup.none')" />
      <NFlex
        v-for="b in save.backups" :key="b.name"
        align="center" :size="8" :wrap="false"
        class="py-1 border-b border-b-solid border-white/8 last:border-b-0"
      >
        <NText class="text-13px flex-1 truncate min-w-0">
          {{ b.name }}
        </NText>
        <NText :depth="3" class="text-12px whitespace-nowrap">
          {{ new Date(b.mtime).toLocaleString() }}
        </NText>
        <NButton size="tiny" secondary @click="save.restoreBackup(b.name)">
          {{ t('common.restore') }}
        </NButton>
        <NButton size="tiny" secondary @click="save.exportBackup(b.name)">
          {{ t('common.export') }}
        </NButton>
        <NPopconfirm
          :positive-text="t('common.delete')" :negative-text="t('common.cancel')"
          @positive-click="save.deleteBackup(b.name)"
        >
          <template #trigger>
            <NButton size="tiny" type="error" secondary>
              {{ t('common.delete') }}
            </NButton>
          </template>
          {{ t('confirm.deleteBackup', { name: b.name }) }}
        </NPopconfirm>
      </NFlex>
    </NScrollbar>
  </NModal>
</template>
