<script setup>
// 应用外壳:NLayout 顶栏 + 内容区;内容区为 h-full 的 4×3 CSS 网格(1fr 行高均分,
// 玩家属性/法杖/解锁跨 2 列),任意窗口尺寸下整页不滚动,溢出交给各卡内部 NScrollbar。
// 各卡自装载数据;启动时先取一次 status(供 version/顶栏状态)。
import AppTopbar from '@/components/AppTopbar.vue'
import BackupModal from '@/components/BackupModal.vue'
import BonesCard from '@/components/cards/BonesCard.vue'
import EffectPerkCard from '@/components/cards/EffectPerkCard.vue'
import InventoryCard from '@/components/cards/InventoryCard.vue'
import LogCard from '@/components/cards/LogCard.vue'
import PlayerCard from '@/components/cards/PlayerCard.vue'
import StatusCard from '@/components/cards/StatusCard.vue'
import UnlockCard from '@/components/cards/UnlockCard.vue'
import WandCard from '@/components/cards/WandCard.vue'
import WorldCard from '@/components/cards/WorldCard.vue'
import { useLogStore } from '@/stores/log'
import { useSaveStore } from '@/stores/save'

const save = useSaveStore()
const logStore = useLogStore()
const { t } = useI18n()

const showBackups = ref(false)

onMounted(async () => {
  try {
    await save.refresh()
  }
  catch (e) {
    logStore.log(t('log.initFailed', { msg: e.message }), 'warn')
  }
})
</script>

<template>
  <NLayout position="absolute">
    <NLayoutHeader bordered class="h-12">
      <AppTopbar v-model:show-backups="showBackups" />
    </NLayoutHeader>
    <NLayoutContent position="absolute" class="!top-12">
      <!-- 一屏 4×3:行高 1fr 均分容器,结构上不可能出现页面滚动条;溢出内容一律卡内滚动 -->
      <div id="cardsGrid" class="h-full box-border p-3 grid grid-cols-4 grid-rows-3 gap-3 overflow-hidden">
        <PlayerCard class="col-span-2" />
        <EffectPerkCard />
        <InventoryCard />
        <WandCard class="col-span-2" />
        <BonesCard />
        <StatusCard />
        <UnlockCard class="col-span-2" />
        <WorldCard />
        <LogCard />
      </div>
    </NLayoutContent>
  </NLayout>
  <BackupModal v-model:show="showBackups" />
</template>
