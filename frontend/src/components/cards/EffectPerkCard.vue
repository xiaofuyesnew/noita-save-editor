<script setup>
// 天赋与效果聚合卡:上方图标墙(缓冲现状 + 本卡暂存变更,悬浮详情/撤销/移除),
// 下方天赋/效果两页签只保留添加面板(添加也只写暂存)。暂存非空时标题标星,
// 右上「应用到缓冲」批量提交。存档里天赋 = 挂在玩家身上的效果实体(+旗标/计数),
// 数据同源故合并;列表与暂存由 effperk store 统一持有。
import CardShell from '@/components/shared/CardShell.vue'
import { useCardLoad } from '@/composables/useCardLoad'
import { useSubmit } from '@/composables/useSubmit'
import { useEffPerkStore } from '@/stores/effperk'
import { useSaveStore } from '@/stores/save'
import EffectPerkWall from './sections/EffectPerkWall.vue'
import EffectSection from './sections/EffectSection.vue'
import PerkSection from './sections/PerkSection.vue'

const save = useSaveStore()
const effperk = useEffPerkStore()
const { t } = useI18n()
const { submitting, run: runSubmit } = useSubmit()

function apply() {
  const n = effperk.pendingCount
  return save.act(() => effperk.apply(), t('log.effperkApplied', { n }))
}

const { error, run: runLoad, retry } = useCardLoad(effperk.load)
onMounted(runLoad)
const unsubscribe = save.onReload(effperk.load)
onBeforeUnmount(unsubscribe)
</script>

<template>
  <CardShell id="effectPerkCard" :title="t('effperk.cardTitle')" :dirty="effperk.dirty" :load-error="error" @retry="retry">
    <template #action>
      <NButton size="small" type="primary" secondary :disabled="!effperk.dirty || submitting" :loading="submitting" @click="runSubmit(apply)">
        {{ t('common.apply') }}
      </NButton>
    </template>
    <EffectPerkWall />
    <NTabs type="line" size="small" display-directive="show" animated class="mt-1">
      <NTabPane name="perks" :tab="t('perk.title')">
        <PerkSection />
      </NTabPane>
      <NTabPane name="effects" :tab="t('eff.title')">
        <EffectSection />
      </NTabPane>
    </NTabs>
  </CardShell>
</template>
