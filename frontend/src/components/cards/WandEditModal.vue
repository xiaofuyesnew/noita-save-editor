<script setup>
// 法杖编辑弹窗:属性表单(写 wandsStore.forms)+ 本杖法术槽(pick/edit/reorder
// 事件冒泡回 WandCard 复用法术弹窗)。改动即本地暂存,底部「应用」把全部暂存
// 提交到服务端编辑缓冲并关闭弹窗(落盘仍走全局「写入存档」)。
import FieldLabel from '@/components/shared/FieldLabel.vue'
import PresetListModal from '@/components/shared/PresetListModal.vue'
import SlotStrip from '@/components/shared/SlotStrip.vue'
import { usePresetsStore } from '@/stores/presets'
import { useWandsStore, WAND_FORM_FIELDS } from '@/stores/wands'
import { wandIconUrl } from '@/ui/wandIcon'

const props = defineProps({
  index: { type: Number, default: null }, // wandsStore.forms/wands 下标
})
const emit = defineEmits(['pick', 'edit', 'reorder', 'pickLook'])
const show = defineModel('show', { type: Boolean, default: false })
const { t } = useI18n()
const wandsStore = useWandsStore()
const presets = usePresetsStore()

const wand = computed(() => props.index !== null ? wandsStore.wands[props.index] : null)
const form = computed(() => props.index !== null ? wandsStore.forms[props.index] : null)

const title = computed(() => wand.value
  ? t('wand.editTitle', { i: wand.value.index, name: form.value?.uiName || wand.value.uiName || t('wand.unnamed') })
  : '')

// 应用成功才关闭;失败时 save.act 已记警告日志,弹窗留在原地便于继续改
async function applyAndClose() {
  if (await wandsStore.applyAllLogged())
    show.value = false
}

// ---- 预设(§20):存当前杖 / 载入到当前编辑杖 ----
const showPresets = ref(false)
// 存预设取「已提交到缓冲」的第 index 支杖(未应用的暂存改动不含在内)
function onSavePreset({ label, tags }) {
  if (props.index === null)
    return
  const wandIndex = wandsStore.wands[props.index]?.index ?? props.index
  presets.createWand({ label, tags, index: wandIndex })
}
function onApplyPreset(preset) {
  if (props.index !== null)
    wandsStore.applyPresetToWand(props.index, preset)
}
</script>

<template>
  <NModal
    v-model:show="show" preset="card" :title="title"
    :style="{ width: '640px', maxWidth: '94vw' }" size="small"
  >
    <template v-if="wand && form">
      <div class="field-grid">
        <template v-for="[field, kind] in WAND_FORM_FIELDS" :key="field">
          <NCheckbox v-if="kind === 'checkbox'" v-model:checked="form[field]" size="small">
            <FieldLabel :label="t(`wand.f.${field}`)" :tip="t(`wand.f.${field}.tip`)" />
          </NCheckbox>
          <NFlex v-else-if="field === 'spriteFile'" vertical :size="2" class="col-span-full">
            <FieldLabel :label="t(`wand.f.${field}`)" :tip="t(`wand.f.${field}.tip`)" />
            <NFlex align="center" :size="6" :wrap="false">
              <span class="look-preview" :title="form[field]">
                <img v-if="wandIconUrl(form[field])" :src="wandIconUrl(form[field])" alt="">
                <NText v-else :depth="3" class="text-12px">?</NText>
              </span>
              <NInput v-model:value="form[field]" size="tiny" class="flex-1" />
              <NButton size="tiny" secondary @click="emit('pickLook', index)">
                {{ t('wand.lookPick') }}
              </NButton>
            </NFlex>
          </NFlex>
          <NFlex v-else vertical :size="2">
            <FieldLabel :label="t(`wand.f.${field}`)" :tip="t(`wand.f.${field}.tip`)" />
            <NInputNumber v-if="kind === 'number'" v-model:value="form[field]" size="tiny" :show-button="false" />
            <NInput v-else v-model:value="form[field]" size="tiny" />
          </NFlex>
        </template>
      </div>

      <NDivider title-placement="left" class="!my-2 !text-13px">
        {{ t('wand.spellsTitle') }}
      </NDivider>
      <SlotStrip
        :capacity="Number(form.deckCapacity) || Number(wand.deckCapacity)"
        :spells="wandsStore.stagedWandSpells[index] ?? wand.spells"
        @pick="slot => emit('pick', slot)"
        @edit="spell => emit('edit', spell)"
        @reorder="order => emit('reorder', order)"
      />
    </template>
    <template #footer>
      <NFlex :size="8" align="center">
        <NButton size="small" type="primary" secondary :disabled="!wandsStore.dirty" @click="applyAndClose">
          {{ t('common.applyNow') }}
        </NButton>
        <NButton size="small" secondary @click="showPresets = true">
          {{ t('preset.entry') }}
        </NButton>
        <NText :depth="3" class="text-11px">
          {{ t('wand.modalHint') }}
        </NText>
        <NButton size="small" class="ml-auto" @click="show = false">
          {{ t('common.close') }}
        </NButton>
      </NFlex>
    </template>
  </NModal>

  <PresetListModal
    v-model:show="showPresets" category="wands"
    :default-label="form?.uiName || ''"
    @save="onSavePreset" @apply="onApplyPreset"
  />
</template>

<style scoped>
.look-preview {
  flex: none; width: 52px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 3px;
}
.look-preview img { image-rendering: pixelated; height: 24px; max-width: 48px; object-fit: contain; }
</style>
