<script setup>
// noitamap 选点弹窗:iframe 加载本地反代 /noitamap/(同源化,见 server/routes/noitamap.js),
// 右键时读取站点自带的 #coordinate 悬浮框文本(格式 "(x, y)\nchunk: (cx, cy)",
// x/y 即游戏世界像素坐标,与 player.xml _Transform 同单位),菜单仅一项 —— 回填坐标。
// 填入后弹窗保持打开,便于反复取点;关闭即销毁 iframe,下次打开重新加载。
const emit = defineEmits(['pick', 'savePreset'])
const show = defineModel('show', { type: Boolean, default: false })
const { t } = useI18n()

const iframeEl = ref(null)
const menu = reactive({ show: false, x: 0, y: 0, coord: null })
const lastPick = ref(null)

function onLoad() {
  const doc = iframeEl.value?.contentDocument
  if (!doc)
    return
  doc.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    // 悬浮框由站点的 mousemove 实时刷新,右键那一刻的值即鼠标所指点
    const text = doc.getElementById('coordinate')?.innerText ?? ''
    const m = text.match(/\((-?\d+),\s*(-?\d+)\)/)
    const rect = iframeEl.value.getBoundingClientRect()
    menu.coord = m ? { x: Number(m[1]), y: Number(m[2]) } : null
    menu.x = rect.left + e.clientX
    menu.y = rect.top + e.clientY
    menu.show = true
  }, true)
  // NDropdown 的 clickoutside 收不到 iframe 内部的点击,菜单开着时在图内
  // 再按下任意键位(含开始拖动)即关闭
  doc.addEventListener('mousedown', () => {
    menu.show = false
  }, true)
}

const options = computed(() => menu.coord
  ? [
      { key: 'fill', label: t('mappick.fill', menu.coord) },
      { key: 'savePreset', label: t('preset.savePoint') },
    ]
  : [{ key: 'none', label: t('mappick.noCoord'), disabled: true }])

function onSelect(key) {
  menu.show = false
  if (!menu.coord)
    return
  if (key === 'fill') {
    lastPick.value = { ...menu.coord }
    emit('pick', { ...menu.coord })
  }
  else if (key === 'savePreset') {
    emit('savePreset', { ...menu.coord })
  }
}

watch(show, (v) => {
  if (!v)
    menu.show = false
})
</script>

<template>
  <NModal
    v-model:show="show" preset="card" :title="t('mappick.title')"
    :style="{ width: '94vw', maxWidth: '1600px' }" size="small"
  >
    <NFlex align="center" justify="space-between" :wrap="false" class="mb-2">
      <NText :depth="3" class="text-12px">
        {{ t('mappick.hint') }}
      </NText>
      <NText v-if="lastPick" type="success" class="text-12px whitespace-nowrap">
        {{ t('mappick.filled', lastPick) }}
      </NText>
    </NFlex>
    <iframe
      ref="iframeEl" src="/noitamap/" :title="t('mappick.title')"
      style="width: 100%; height: 74vh; border: 0; display: block; background: #111;"
      @load="onLoad"
    />
    <NDropdown
      trigger="manual" placement="bottom-start" :show="menu.show"
      :x="menu.x" :y="menu.y" :options="options"
      @select="onSelect" @clickoutside="menu.show = false"
    />
  </NModal>
</template>
