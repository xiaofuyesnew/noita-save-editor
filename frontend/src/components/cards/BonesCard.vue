<script setup>
// 遗骨法杖卡:bones_new 预览列表,一键导入快捷栏空槽(导入后刷新法杖卡)。
import { api } from '@/api/client'
import CardShell from '@/components/shared/CardShell.vue'
import { dictName, getLang } from '@/locales'
import { useSaveStore } from '@/stores/save'
import { useWandsStore } from '@/stores/wands'
import { wandIconUrl } from '@/ui/wandIcon'

const save = useSaveStore()
const wandsStore = useWandsStore()
const { t } = useI18n()

const bones = ref([])

const listSep = () => (getLang() === 'zh' ? '、' : ', ')

async function load() {
  const data = await api('/bones')
  save.syncVersion(data.version)
  bones.value = data.bones
}

function spellsText(b) {
  return b.spells.map(s => dictName({ ...s, id: s.actionId }) || s.actionId).join(listSep())
    || t('bones.empty')
}

function importBone(b) {
  save.act(async () => {
    await api(`/wands/import-bones/${encodeURIComponent(b.file)}`, {
      method: 'POST',
      body: { version: save.version },
    })
    await wandsStore.load()
    await load()
  }, t('log.bonesImported', { name: b.uiName || b.file }))
}

onMounted(load)
save.onReload(load)
</script>

<template>
  <CardShell id="bonesCard" :title="t('bones.title')" :desc="t('bones.desc')">
    <NEmpty v-if="bones.length === 0" size="small" :description="t('bones.none')" />
    <NFlex
      v-for="b in bones" :key="b.file"
      justify="space-between" align="center" :wrap="false"
      class="py-1.5 border-b border-b-solid border-white/8 last:border-b-0"
    >
      <template v-if="b.error">
        <NText type="warning" class="text-12px">
          {{ b.file }}: {{ b.error }}
        </NText>
      </template>
      <template v-else>
        <NFlex align="center" :size="8" :wrap="false" class="min-w-0">
          <span v-if="wandIconUrl(b.spriteFile)" class="bone-look" :title="b.spriteFile">
            <img :src="wandIconUrl(b.spriteFile)" :alt="b.uiName || b.file">
          </span>
          <div class="min-w-0">
            <NText strong class="text-13px">
              {{ b.uiName || t('bones.noName') }}
            </NText>
            <NText :depth="3" class="text-12px">
              {{ t('bones.summary', {
                file: b.file,
                level: b.gunLevel,
                cap: b.deckCapacity,
                mana: b.manaMax,
                charge: b.manaChargeSpeed,
                apr: b.actionsPerRound,
              }) }}
            </NText>
            <NEllipsis class="block text-12px max-w-160">
              <NText :depth="3" class="text-12px">
                {{ t('bones.spells', { n: b.spellCount, list: spellsText(b) }) }}
              </NText>
            </NEllipsis>
          </div>
        </NFlex>
        <NButton size="small" secondary @click="importBone(b)">
          {{ t('bones.import') }}
        </NButton>
      </template>
    </NFlex>
  </CardShell>
</template>

<style scoped>
/* 遗骨杖外观预览:原版像素图约 2 倍缩放 */
.bone-look { flex: none; width: 44px; display: flex; justify-content: center; }
.bone-look img { image-rendering: pixelated; height: 24px; max-width: 44px; object-fit: contain; }
</style>
