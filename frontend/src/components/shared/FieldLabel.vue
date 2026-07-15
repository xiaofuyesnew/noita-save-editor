<script setup>
// 「文本 + ⓘ」字段标签:tooltip 由 Naive 接管。
defineProps({
  label: { type: String, required: true },
  tip: { type: String, default: '' },
})
</script>

<template>
  <span class="inline-flex items-center gap-1 text-12px">
    <NText :depth="2" class="text-12px">{{ label }}</NText>
    <NTooltip v-if="tip" trigger="hover" :style="{ maxWidth: '300px' }">
      <template #trigger>
        <NText :depth="3" class="cursor-help text-12px hover:text-[#d8a24a]">ⓘ</NText>
      </template>
      {{ tip }}
    </NTooltip>
  </span>
</template>
