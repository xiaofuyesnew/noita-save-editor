<script setup>
// 物品栏卡:统一 4 格游戏化槽位条(宝藏道具 + 药水/粉末袋容器共用道具行)。
// 空槽点击 → 道具选择器;容器点击 → 材料编辑弹窗;普通道具点击 → 删除确认;
// 拖拽换位。所有操作先改本地暂存(items store),点「应用」统一提交到编辑
// 缓冲(【写入存档】才落盘)。
import CardShell from '@/components/shared/CardShell.vue'
import ItemSlotStrip from '@/components/shared/ItemSlotStrip.vue'
import { dictName } from '@/locales'
import { useDictStore } from '@/stores/dict'
import { useItemsStore } from '@/stores/items'
import { useSaveStore } from '@/stores/save'
import ItemPickerModal from './ItemPickerModal.vue'
import PotionEditModal from './PotionEditModal.vue'

const { t } = useI18n()
const save = useSaveStore()
const dict = useDictStore()
const itemsStore = useItemsStore()

const pickerShow = ref(false)
const targetSlot = ref(null)

const potionShow = ref(false)
const editingIndex = ref(null)
const editingContainer = computed(() =>
  editingIndex.value !== null ? (itemsStore.stagedItems[editingIndex.value] ?? null) : null)

const deleteShow = ref(false)
const deletingItem = ref(null)

async function load(preserveEdits = true) {
  await dict.ensureItemsCatalog()
  await itemsStore.load(preserveEdits)
}

function itemLabel(it) {
  return (it.nameZh || it.name)
    ? dictName({ name: it.name, nameZh: it.nameZh, id: it.itemName })
    : (it.itemName || t('item.unknown'))
}

function onPick(slot) {
  targetSlot.value = slot
  pickerShow.value = true
}
function onSelect(entry) {
  itemsStore.stageAdd(entry, targetSlot.value)
}

function onEdit(it) {
  if (it.isContainer) {
    editingIndex.value = it.index
    potionShow.value = true
  }
  else {
    deletingItem.value = it
    deleteShow.value = true
  }
}
function removeItem() {
  itemsStore.stageRemove(deletingItem.value.index)
}

function onMove(it, slot) {
  itemsStore.stageMove(it.index, slot)
}

onMounted(() => load(false))
save.onReload(discardEdits => load(!discardEdits))
</script>

<template>
  <CardShell
    id="inventoryCard" :title="t('invbar.cardTitle')"
    :desc="t('invbar.desc')" :dirty="itemsStore.dirty"
  >
    <template #action>
      <NButton
        size="small" type="primary" secondary :disabled="!itemsStore.dirty"
        @click="itemsStore.applyAllLogged()"
      >
        {{ t('common.apply') }}
      </NButton>
    </template>

    <ItemSlotStrip
      :capacity="itemsStore.capacity" :items="itemsStore.stagedItems"
      @pick="onPick" @edit="onEdit" @move="onMove"
    />
    <NText
      :type="itemsStore.freeSlots <= 0 ? 'warning' : 'default'"
      :depth="itemsStore.freeSlots <= 0 ? undefined : 3"
      class="block text-12px mt-2"
    >
      {{ itemsStore.freeSlots <= 0
        ? t('item.full', { cap: itemsStore.capacity })
        : t('item.freeSlots', { n: itemsStore.freeSlots, cap: itemsStore.capacity }) }}
    </NText>

    <ItemPickerModal v-model:show="pickerShow" @select="onSelect" />
    <PotionEditModal
      v-model:show="potionShow" :container="editingContainer"
      @save="materials => itemsStore.stageMaterials(editingIndex, materials)"
      @remove="itemsStore.stageRemove(editingIndex)"
    />
    <NModal
      v-model:show="deleteShow" preset="dialog" type="warning"
      :title="t('invbar.deleteItem')"
      :positive-text="t('common.delete')" :negative-text="t('common.cancel')"
      @positive-click="removeItem"
    >
      {{ deletingItem ? t('invbar.deleteConfirm', { name: itemLabel(deletingItem) }) : '' }}
    </NModal>
  </CardShell>
</template>
