<script setup>
// 法杖与法术卡(M2/UI③):快捷栏法杖按游戏化法杖槽墙展示(悬浮 tooltip 看
// 参数,点击弹窗编辑属性与法术槽);背包散装法术保留格子条交互。
// 属性表单与法术加删改/拖拽都先改本地暂存(wands store),统一「应用」提交。
import CardShell from '@/components/shared/CardShell.vue'
import SlotStrip from '@/components/shared/SlotStrip.vue'
import { useCardLoad } from '@/composables/useCardLoad'
import { useSubmit } from '@/composables/useSubmit'
import { useDictStore } from '@/stores/dict'
import { useSaveStore } from '@/stores/save'
import { useWandsStore, WAND_FORM_FIELDS } from '@/stores/wands'
import { wandIconUrl } from '@/ui/wandIcon'
import SpellEditModal from './SpellEditModal.vue'
import SpellPickerModal from './SpellPickerModal.vue'
import WandEditModal from './WandEditModal.vue'
import WandLookPickerModal from './WandLookPickerModal.vue'

const save = useSaveStore()
const dict = useDictStore()
const wandsStore = useWandsStore()
const { t } = useI18n()
const { submitting, run: runSubmit } = useSubmit()

const showPicker = ref(false)
const showEditor = ref(false)
const pickerCtx = ref(null) // { target, slot }
const editorCtx = ref(null) // { target, spell }

// ---- 法杖编辑弹窗 ----
const showWandEditor = ref(false)
const wandCtx = ref(null) // 表单下标
function openWandEditor(i) {
  wandCtx.value = i
  showWandEditor.value = true
}

// ---- 外观选择(§12):写表单值,走统一「应用」批量提交 ----
const showLookPicker = ref(false)
const lookCtx = ref(null) // 表单下标
function openLookPicker(i) {
  lookCtx.value = i
  showLookPicker.value = true
}
function onLookPicked(look) {
  if (lookCtx.value !== null && wandsStore.forms[lookCtx.value])
    wandsStore.forms[lookCtx.value].spriteFile = look.file
}

async function load(preserveEdits = true) {
  await Promise.all([dict.ensureSpells(), dict.ensureSpellTypes()])
  await wandsStore.load(preserveEdits)
}

// ---- 法杖槽展示辅助 ----
function wandName(i) {
  const w = wandsStore.wands[i]
  return wandsStore.forms[i]?.uiName || w.uiName || t('wand.unnamed')
}
function wandSprite(i) {
  return wandIconUrl(wandsStore.forms[i]?.spriteFile || wandsStore.wands[i].spriteFile)
}
function isWandDirty(i) {
  const f = wandsStore.forms[i]
  const formDirty = !!f && WAND_FORM_FIELDS.some(([field]) => f[field] !== wandsStore.baselines[i]?.[field])
  return formDirty || wandsStore.spellOps.some(op => op.target === i)
}
// tooltip 参数行:显示表单当前值(= 应用后的目标值)
const TT_ROWS = ['manaMax', 'mana', 'manaChargeSpeed', 'deckCapacity', 'reloadTime', 'fireRateWait', 'actionsPerRound', 'spreadDegrees', 'speedMultiplier', 'gunLevel']
function ttValue(i, field) {
  return wandsStore.forms[i]?.[field] ?? wandsStore.wands[i][field]
}
function stagedSpellsOf(i) {
  return wandsStore.stagedWandSpells[i] ?? wandsStore.wands[i].spells
}

// tooltip 内的迷你法术图标行
const spellById = computed(() => new Map((dict.spells ?? []).map(s => [s.id, s])))
function miniSpellIcon(spell) {
  const sprite = spellById.value.get(spell.actionId)?.sprite
  return sprite?.startsWith('data/ui_gfx/') ? `/icons/${sprite.slice('data/ui_gfx/'.length)}` : ''
}

// ---- 法术槽交互(法杖与背包共用):全部改本地暂存,经「应用」提交 ----
function onPick(target, slot) {
  pickerCtx.value = { target, slot }
  showPicker.value = true
}
function onPicked(spellDict) {
  const { target, slot } = pickerCtx.value
  wandsStore.stageAdd(target, spellDict.id, slot)
}
function onEdit(target, spell) {
  editorCtx.value = { target, spell }
  showEditor.value = true
}
function onEditorSave(patch) {
  const { target, spell } = editorCtx.value
  wandsStore.stageUpdate(target, spell.idx, patch)
}
function onEditorRemove() {
  const { target, spell } = editorCtx.value
  wandsStore.stageRemove(target, spell.idx)
}
function onReorder(target, order) {
  wandsStore.stageReorder(target, order)
}

const { error, run: runLoad, retry } = useCardLoad(load)
onMounted(() => runLoad(false))
const unsubscribe = save.onReload(discardEdits => load(!discardEdits))
onBeforeUnmount(unsubscribe)
</script>

<template>
  <CardShell
    id="wandCard" :title="t('wand.title')" :desc="t('wand.desc')" :dirty="wandsStore.dirty"
    :load-error="error" @retry="retry"
  >
    <template #action>
      <NButton
        size="small" type="primary" secondary :disabled="!wandsStore.dirty || submitting" :loading="submitting"
        @click="runSubmit(() => wandsStore.applyAllLogged())"
      >
        {{ t('common.apply') }}
      </NButton>
    </template>

    <NDivider title-placement="left" class="!mt-0 !mb-2 !text-13px">
      {{ t('wand.quick') }}
    </NDivider>
    <div class="wand-wall">
      <NPopover
        v-for="(w, i) in wandsStore.wands" :key="w.index"
        trigger="hover" raw :show-arrow="false" placement="top"
        :delay="150" :duration="60"
      >
        <template #trigger>
          <div class="wand-slot" @click="openWandEditor(i)">
            <span class="wand-no">{{ w.index }}</span>
            <img
              v-if="wandSprite(i)"
              class="wand-img" :src="wandSprite(i)" :alt="wandName(i)" draggable="false"
            >
            <span v-else class="wand-fallback">{{ wandName(i) }}</span>
            <span v-if="isWandDirty(i)" class="wand-dirty">*</span>
          </div>
        </template>
        <div class="game-tt wand-tt">
          <div class="tt-head">
            <img v-if="wandSprite(i)" :src="wandSprite(i)" alt="" class="tt-wand-icon">
            <span class="tt-name">{{ wandName(i) }}</span>
            <span class="tt-shuffle" :class="{ on: wandsStore.forms[i]?.shuffleDeckWhenEmpty }">
              {{ t(wandsStore.forms[i]?.shuffleDeckWhenEmpty ? 'wand.tt.shuffleOn' : 'wand.tt.shuffleOff') }}
            </span>
          </div>
          <div class="tt-stats">
            <div v-for="field in TT_ROWS" :key="field" class="tt-row">
              <span class="tt-lbl">{{ t(`wand.f.${field}`) }}</span>
              <span>{{ ttValue(i, field) }}</span>
            </div>
          </div>
          <div v-if="stagedSpellsOf(i).length" class="tt-spells">
            <template v-for="s in [...stagedSpellsOf(i)].sort((a, b) => a.slot - b.slot)" :key="s.idx">
              <img v-if="miniSpellIcon(s)" :src="miniSpellIcon(s)" :alt="s.actionId" :class="{ ac: s.alwaysCast }">
            </template>
          </div>
          <div v-if="isWandDirty(i)" class="tt-dirty">
            {{ t('wand.tt.dirty') }}
          </div>
          <div class="tt-id">
            {{ t('wand.summary', { slot: w.slot, mana: w.mana, manaMax: w.manaMax, cap: w.deckCapacity, n: stagedSpellsOf(i).length }) }}
            · {{ t('wand.clickTip') }}
          </div>
        </div>
      </NPopover>
    </div>

    <NDivider title-placement="left" class="!my-2 !text-13px">
      {{ t('wand.bag') }}
    </NDivider>
    <SlotStrip
      :capacity="Math.max(wandsStore.invSpells.capacity, wandsStore.stagedInvSpells.length)"
      :spells="wandsStore.stagedInvSpells"
      @pick="slot => onPick('inv', slot)"
      @edit="spell => onEdit('inv', spell)"
      @reorder="order => onReorder('inv', order)"
    />

    <WandEditModal
      v-model:show="showWandEditor" :index="wandCtx"
      @pick="slot => onPick(wandCtx, slot)"
      @edit="spell => onEdit(wandCtx, spell)"
      @reorder="order => onReorder(wandCtx, order)"
      @pick-look="openLookPicker"
    />
    <SpellPickerModal v-model:show="showPicker" @select="onPicked" />
    <SpellEditModal
      v-model:show="showEditor" :spell="editorCtx?.spell"
      @save="onEditorSave" @remove="onEditorRemove"
    />
    <WandLookPickerModal
      v-model:show="showLookPicker"
      :current="lookCtx !== null ? (wandsStore.forms[lookCtx]?.spriteFile ?? '') : ''"
      @select="onLookPicked"
    />
  </CardShell>
</template>

<style scoped>
/* ---- 法杖槽墙:仿游戏物品栏的竖置法杖槽,像素图旋转 -90° 2 倍缩放 ---- */
.wand-wall { display: flex; flex-wrap: wrap; gap: 6px; }
.wand-slot {
  position: relative;
  width: 48px;
  height: 96px;
  background: #0d0d12;
  border: 1px solid #3a3a45;
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
}
.wand-slot:hover { border-color: #d8a24a; }
.wand-slot:hover .wand-img { filter: brightness(1.25); }
.wand-img {
  image-rendering: pixelated;
  transform: rotate(-90deg) scale(2);
  max-width: 88px; /* 旋转后对应槽高 */
  max-height: 40px;
  pointer-events: none;
}
.wand-fallback {
  overflow: hidden;
  max-height: 100%;
  padding: 2px;
  font-size: 9px;
  line-height: 1.2;
  word-break: break-all;
  text-align: center;
  color: #ddd;
  text-shadow: 1px 1px 0 #000;
}
.wand-no {
  position: absolute;
  left: 3px;
  top: 1px;
  font-size: 10px;
  color: #6d6680;
  text-shadow: 1px 1px 0 #000;
}
.wand-dirty {
  position: absolute;
  right: 3px;
  top: 0;
  font-size: 14px;
  font-weight: 700;
  color: #d8a24a;
  text-shadow: 1px 1px 0 #000;
}

/* tooltip 面板样式为全局 .game-tt(styles/game-tooltip.css);此处仅保留
   法杖面板的差异化规则:更宽的面板、两栏参数、法杖横图、乱序徽标等 */
.wand-tt { min-width: 220px; max-width: 320px; }
.tt-wand-icon { height: 22px; max-width: 60px; object-fit: contain; image-rendering: pixelated; }
.tt-shuffle {
  margin-left: auto;
  font-size: 11px;
  padding: 0 5px;
  border: 1px solid #3e5a7a;
  color: #8faef5;
}
.tt-shuffle.on { border-color: #7a6236; color: #d8a24a; }
.game-tt .tt-stats { column-count: 2; column-gap: 16px; }
.game-tt .tt-lbl { width: 78px; }
.tt-spells {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.tt-spells img { width: 20px; height: 20px; image-rendering: pixelated; }
.tt-spells img.ac { outline: 1px solid #d8a24a; }
.tt-dirty { margin-top: 6px; color: #d8a24a; }
</style>
