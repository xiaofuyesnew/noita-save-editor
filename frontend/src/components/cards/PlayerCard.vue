<script setup>
// 玩家属性聚合卡:基础属性/无敌/受伤倍率三页签(同属 player.xml DamageModelComponent 簇)。
// 各页签逻辑独立(自装载/自应用);表单型页签的 dirty 汇总到卡标题,页签名旁另加 *。
import CardShell from '@/components/shared/CardShell.vue'
import DamageSection from './sections/DamageSection.vue'
import InvincibilitySection from './sections/InvincibilitySection.vue'
import PlayerBasicsSection from './sections/PlayerBasicsSection.vue'

const { t } = useI18n()

const basicsDirty = ref(false)
const dmgDirty = ref(false)
const dirty = computed(() => basicsDirty.value || dmgDirty.value)

const star = d => d ? ' *' : ''
</script>

<template>
  <CardShell id="playerCard" :title="t('player.cardTitle')" :dirty="dirty">
    <NTabs type="line" size="small" display-directive="show" animated>
      <NTabPane name="basics" :tab="t('player.tabBasics') + star(basicsDirty)">
        <PlayerBasicsSection @update:dirty="v => basicsDirty = v" />
      </NTabPane>
      <NTabPane name="inv" :tab="t('inv.title')">
        <InvincibilitySection />
      </NTabPane>
      <NTabPane name="dmg" :tab="t('dmg.title') + star(dmgDirty)">
        <DamageSection @update:dirty="v => dmgDirty = v" />
      </NTabPane>
    </NTabs>
  </CardShell>
</template>
