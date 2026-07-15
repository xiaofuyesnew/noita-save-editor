<script setup>
// 通用 card 骨架:NCard(标题 + 说明 + 右上动作插槽)+ NScrollbar 滚动主体;
// dirty 星号由父级传入。高度由 card-cell(uno shortcut)保持一屏三行。
defineProps({
  id: { type: String, required: true },
  title: { type: String, required: true },
  desc: { type: String, default: '' },
  dirty: { type: Boolean, default: false },
})
</script>

<template>
  <NCard
    :id="id"
    size="small"
    class="card-cell flex flex-col overflow-hidden"
    content-style="flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; overflow: hidden; padding-top: 0;"
  >
    <template #header>
      <NEllipsis>
        {{ title }}<NText v-if="dirty" type="warning">
          *
        </NText>
      </NEllipsis>
    </template>
    <template #header-extra>
      <slot name="action" />
    </template>
    <NText v-if="desc" :depth="3" class="block text-11px lh-snug mb-2 flex-shrink-0">
      {{ desc }}
    </NText>
    <NScrollbar class="flex-1 min-h-0">
      <div class="pr-3">
        <slot />
      </div>
    </NScrollbar>
  </NCard>
</template>
