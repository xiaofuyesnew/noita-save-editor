<script setup>
// 顶栏:存档路径 + 游戏/缓冲状态标签 + 写入/重载/拉推/备份/语言按钮。
import { getLang, setLang } from '@/locales'
import { useSaveStore } from '@/stores/save'

const save = useSaveStore()
const { t } = useI18n()

const showBackups = defineModel('showBackups', { type: Boolean, default: false })

const langBtn = computed(() => getLang() === 'zh' ? 'EN' : '中文')
function toggleLang() {
  setLang(getLang() === 'zh' ? 'en' : 'zh')
}
function openBackups() {
  showBackups.value = true
}
</script>

<template>
  <NFlex align="center" :size="12" :wrap="false" class="h-full px-4">
    <NText strong class="whitespace-nowrap">
      {{ t('app.title') }}
    </NText>
    <NText :depth="3" class="text-12px truncate min-w-0">
      {{ save.status?.saveDir }}
    </NText>
    <div class="flex-1" />
    <NTag size="small" :bordered="false" :type="save.gameRunning ? 'warning' : 'success'">
      {{ save.gameRunning ? t('top.gameRunning') : t('top.gameIdle') }}
    </NTag>
    <NTag size="small" :bordered="false" :type="save.dirty ? 'warning' : 'default'">
      {{ save.dirty ? t('top.dirty') : t('top.saved') }}
    </NTag>
    <NButton size="small" type="primary" secondary :disabled="!save.dirty" @click="save.write()">
      {{ t('top.write') }}
    </NButton>
    <NButton size="small" @click="save.reload()">
      {{ t('top.reload') }}
    </NButton>
    <NTooltip trigger="hover">
      <template #trigger>
        <NButton size="small" @click="save.pull()">
          {{ t('top.pull') }}
        </NButton>
      </template>
      {{ t('top.pull.tip') }}
    </NTooltip>
    <NTooltip trigger="hover">
      <template #trigger>
        <NButton size="small" @click="save.push()">
          {{ t('top.push') }}
        </NButton>
      </template>
      {{ t('top.push.tip') }}
    </NTooltip>
    <NButton size="small" @click="openBackups">
      {{ t('top.backups') }}
    </NButton>
    <NButton size="small" quaternary @click="toggleLang">
      {{ langBtn }}
    </NButton>
  </NFlex>
</template>
