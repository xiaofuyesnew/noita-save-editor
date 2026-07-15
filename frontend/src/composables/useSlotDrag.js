// SortableJS + 官方 Swap 插件封装:法术槽格子条的"格位互换"拖拽。
// filter 限定空格不可作为拖动源(但仍是落点);onEnd 上报显示位下标对,
// DOM 变更由调用方通过 key 重建丢弃(状态才是唯一事实来源)。
//
// 两道防线保证 Sortable 的 DOM 搬动不留残余:
// 1. 格子必须是普通元素迭代根(v-for 写在 div 上,见 SlotStrip 注释)——
//    fragment 迭代根的锚点区间卸载会漏删被移走的节点,残留幽灵格;
// 2. onEnd 先把 Swap 互换的两个节点换回原位再上报,把与虚拟 DOM 一致的
//    真实 DOM 交还给 Vue,重渲染前后都不依赖 Sortable 留下的顺序。
import Sortable, { Swap } from 'sortablejs'

let swapMounted = false

/** 互换两个兄弟/跨父节点的 DOM 位置(等价于 Swap 插件 swapNodes 的逆操作)。 */
function undoSwap(a, b) {
  const marker = document.createComment('')
  a.parentNode.insertBefore(marker, a)
  b.parentNode.insertBefore(a, b)
  marker.parentNode.insertBefore(b, marker)
  marker.remove()
}

/**
 * @param {import('vue').Ref<HTMLElement|null>} elRef 格子条容器
 * @param {(fromIdx: number, toIdx: number) => void} onSwap 显示位互换回调
 */
export function useSlotDrag(elRef, onSwap) {
  if (!swapMounted) {
    Sortable.mount(new Swap())
    swapMounted = true
  }
  let inst = null

  onMounted(() => {
    inst = Sortable.create(elRef.value, {
      swap: true,
      swapClass: 'slot-swap-target',
      draggable: '.slot',
      filter: '.empty',
      animation: 120,
      onEnd(evt) {
        if (evt.swapItem && evt.swapItem !== evt.item)
          undoSwap(evt.item, evt.swapItem)
        if (evt.oldIndex !== evt.newIndex)
          onSwap(evt.oldIndex, evt.newIndex)
      },
    })
  })
  onBeforeUnmount(() => {
    inst?.destroy()
    inst = null
  })
}
