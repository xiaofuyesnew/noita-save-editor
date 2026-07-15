<script setup>
// 日志卡:useLogStore 的行列表(新条目置顶,由 store 保证)。
import CardShell from '@/components/shared/CardShell.vue'
import { useLogStore } from '@/stores/log'

const logStore = useLogStore()
const { t } = useI18n()

const TYPE_OF = { ok: 'success', warn: 'warning' }
</script>

<template>
  <CardShell id="logCard" :title="t('logcard.title')">
    <div
      v-for="(line, i) in logStore.lines" :key="logStore.lines.length - i"
      class="text-12px lh-relaxed"
    >
      <NText :type="TYPE_OF[line.cls] ?? 'default'" :depth="line.cls ? undefined : 3" class="text-12px">
        [{{ line.time }}] {{ line.msg }}
      </NText>
    </div>
  </CardShell>
</template>
