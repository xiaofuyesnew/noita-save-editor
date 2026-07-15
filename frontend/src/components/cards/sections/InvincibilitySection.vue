<script setup>
// 无敌页签(原无敌卡):两种模式勾选即时写缓冲,无 dirty 星号。
import { api } from '@/api/client'
import { useSaveStore } from '@/stores/save'

const save = useSaveStore()
const { t } = useI18n()

const effect = ref(false)
const frames = ref(false)

async function load() {
  const inv = await api('/player/invincibility')
  effect.value = inv.effect
  frames.value = inv.frames
}

function toggle(mode, enable) {
  save.act(
    () => api('/player/invincibility', { method: 'POST', body: { mode, enable } }),
    t('log.invToggled', { mode, state: enable ? t('log.on') : t('log.off') }),
  )
}

onMounted(load)
save.onReload(load)
</script>

<template>
  <NText :depth="3" class="block text-11px lh-snug mb-2">
    {{ t('inv.desc') }}
  </NText>
  <NFlex vertical :size="8">
    <NCheckbox v-model:checked="effect" size="small" @update:checked="v => toggle('effect', v)">
      {{ t('inv.effect') }}
    </NCheckbox>
    <NCheckbox v-model:checked="frames" size="small" @update:checked="v => toggle('frames', v)">
      {{ t('inv.frames') }}
    </NCheckbox>
  </NFlex>
</template>
