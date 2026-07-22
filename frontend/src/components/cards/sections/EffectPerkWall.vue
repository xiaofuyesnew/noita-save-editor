<script setup>
// 天赋/效果图标墙:上排天赋(40px 格)、下排效果(30px 小格)。
// 展示服务端缓冲现状 + 本卡暂存变更:实线框 = 缓冲现有,绿虚线 + 角标「+」=
// 待添加,红虚线半透明 + 角标「×」= 待移除;悬浮 tooltip 查看详情并
// 移除/恢复/撤销(均只改暂存,经卡顶「应用到缓冲」提交)。
// 图标 2 倍像素缩放;效果无 HUD 图标时经 gameEffect 反查天赋图标兜底,再无则文字占位。
import { dictName, getLang } from '@/locales'
import { useEffPerkStore } from '@/stores/effperk'
import { frames2s } from '@/ui/format'

const effperk = useEffPerkStore()
const { t } = useI18n()

function groupLabel(g) {
  if (!g)
    return ''
  const key = `effgroup.${g}`
  const label = t(key)
  return label === key ? g : label
}

function perkDesc(d) {
  return d ? (getLang() === 'zh' ? (d.descZh || d.desc) : (d.desc || d.descZh)) : ''
}
function effectName(id, nameZh) {
  return getLang() === 'zh' && nameZh ? nameZh : id
}
function effectDesc(d) {
  return d ? (getLang() === 'zh' ? (d.descZh || d.desc) : (d.desc || d.descZh)) : ''
}

// 天赋叠加规则文案:上限 N > 可叠加 > 不可叠加
function stackLabel(c) {
  if (c.stackableMax)
    return t('perk.tt.stackMax', { n: c.stackableMax })
  return c.stackable ? t('perk.tt.stackable') : t('perk.tt.notStackable')
}
// 天赋特性标记(一次性 / 敌人可用),拼为一行
function perkTraits(c) {
  return [
    c.oneOff ? t('perk.tt.oneOff') : '',
    c.usableByEnemies ? t('perk.tt.enemies') : '',
  ].filter(Boolean).join(' · ')
}
// 效果特性标记(有害 / 防火)
function effectTraits(c) {
  return [
    c.isHarmful ? t('eff.tt.harmful') : '',
    c.protectsFromFire ? t('eff.tt.fireProof') : '',
  ].filter(Boolean).join(' · ')
}

const perkCells = computed(() => {
  const removals = new Set(effperk.perkRemovals)
  const out = effperk.perks.map((p) => {
    const d = effperk.perkDict(p.id)
    return {
      key: `saved-${p.id}`,
      state: removals.has(p.id) ? 'pendingRemove' : 'saved',
      id: p.id,
      row: p,
      icon: effperk.perkIconUrl(p.id),
      name: dictName(p),
      desc: perkDesc(d),
      badge: Number(p.count) > 1 ? `×${p.count}` : '',
      funcImpact: d?.funcImpact ?? '',
      funcNote: d?.funcNote ?? '',
      stackable: d?.stackable ?? false,
      stackableMax: d?.stackableMax,
      oneOff: d?.oneOff ?? false,
      usableByEnemies: d?.usableByEnemies ?? false,
    }
  })
  for (const a of effperk.perkAdds) {
    const d = effperk.perkDict(a.id)
    out.push({
      key: `pend-${a.id}`,
      state: 'pendingAdd',
      id: a.id,
      row: null,
      icon: effperk.perkIconUrl(a.id),
      name: dictName(d) || a.id,
      desc: perkDesc(d),
      badge: a.count > 1 ? `×${a.count}` : '',
      funcImpact: d?.funcImpact ?? '',
      funcNote: d?.funcNote ?? '',
      stackable: d?.stackable ?? false,
      stackableMax: d?.stackableMax,
      oneOff: d?.oneOff ?? false,
      usableByEnemies: d?.usableByEnemies ?? false,
    })
  }
  return out
})

const effectCells = computed(() => {
  const removals = new Set(effperk.effectRemovals)
  const out = effperk.effects.map((e) => {
    const d = effperk.effectDict(e.effect)
    return {
      key: `saved-${e.index}-${e.effect}`,
      state: removals.has(e.index) ? 'pendingRemove' : 'saved',
      id: e.effect,
      row: e,
      icon: effperk.effectIconUrl(e.effect),
      name: effectName(e.effect, e.nameZh),
      desc: effectDesc(d),
      badge: !e.permanent && e.seconds ? `${e.seconds}s` : '',
      danger: e.danger,
      group: e.group,
      permanent: e.permanent,
      seconds: e.seconds,
      durationFrames: d?.durationFrames,
      isHarmful: d?.isHarmful ?? false,
      protectsFromFire: d?.protectsFromFire ?? false,
    }
  })
  effperk.effectAdds.forEach((a, i) => {
    const d = effperk.effectDict(a.effect)
    out.push({
      key: `pend-${i}-${a.effect}`,
      state: 'pendingAdd',
      id: a.effect,
      row: null,
      pendIndex: i,
      icon: effperk.effectIconUrl(a.effect),
      name: effectName(a.effect, d?.nameZh),
      desc: effectDesc(d),
      badge: !a.permanent && a.seconds ? `${a.seconds}s` : '',
      danger: d?.danger ?? false,
      group: d?.group,
      permanent: a.permanent,
      seconds: a.seconds,
      durationFrames: d?.durationFrames,
      isHarmful: d?.isHarmful ?? false,
      protectsFromFire: d?.protectsFromFire ?? false,
    })
  })
  return out
})

function actionLabel(state) {
  if (state === 'saved')
    return t('common.remove')
  return state === 'pendingRemove' ? t('common.restore') : t('effperk.undoAdd')
}

function perkAction(c) {
  if (c.state === 'saved')
    effperk.stagePerkRemoval(c.id)
  else if (c.state === 'pendingRemove')
    effperk.unstagePerkRemoval(c.id)
  else
    effperk.unstagePerkAdd(c.id)
}

function effectAction(c) {
  if (c.state === 'saved')
    effperk.stageEffectRemoval(c.row.index)
  else if (c.state === 'pendingRemove')
    effperk.unstageEffectRemoval(c.row.index)
  else
    effperk.unstageEffectAdd(c.pendIndex)
}
</script>

<template>
  <NText :depth="3" class="block text-11px lh-snug mb-2">
    {{ t('effperk.wallHint') }}
  </NText>

  <NText :depth="3" class="block text-11px mb-1">
    {{ t('perk.title') }}
  </NText>
  <NText v-if="perkCells.length === 0" :depth="3" class="block text-12px">
    {{ t('perk.none') }}
  </NText>
  <div v-else class="wall">
    <NPopover
      v-for="c in perkCells" :key="c.key"
      trigger="hover" raw :show-arrow="false" placement="top"
      :delay="150" :duration="60"
    >
      <template #trigger>
        <div class="cell" :class="c.state">
          <img v-if="c.icon" class="cell-icon" :src="c.icon" :alt="c.id" draggable="false">
          <span v-else class="cell-fallback">{{ c.name }}</span>
          <span v-if="c.badge" class="cell-badge">{{ c.badge }}</span>
          <span v-if="c.state === 'pendingAdd'" class="cell-mark add">+</span>
          <span v-else-if="c.state === 'pendingRemove'" class="cell-mark del">×</span>
        </div>
      </template>
      <div class="game-tt ep-tt">
        <div class="tt-head">
          <img v-if="c.icon" :src="c.icon" alt="" class="tt-icon">
          <span class="tt-name">{{ c.name }}</span>
          <span class="tt-kind perk">{{ t('effperk.ttPerk') }}</span>
        </div>
        <div v-if="c.desc" class="tt-desc">
          {{ c.desc }}
        </div>
        <div class="tt-stats">
          <div class="tt-row">
            <span class="tt-lbl">{{ t('effperk.count') }}</span>
            <span>{{ c.row ? c.row.count : `+${effperk.perkAdds.find(p => p.id === c.id)?.count ?? 1}` }}</span>
          </div>
          <div class="tt-row">
            <span class="tt-lbl">{{ t('perk.tt.stack') }}</span>
            <span>{{ stackLabel(c) }}</span>
          </div>
          <div v-if="perkTraits(c)" class="tt-row">
            <span class="tt-lbl">{{ t('perk.tt.traits') }}</span>
            <span>{{ perkTraits(c) }}</span>
          </div>
          <div v-if="c.row" class="tt-row">
            <span class="tt-lbl">{{ t('perk.entity') }}</span>
            <span :class="{ 'tt-miss': c.row.entityCount === 0 }">
              {{ c.row.entityCount > 0 ? t('perk.entityOk') : t('perk.entityMissing') }}
            </span>
          </div>
          <div v-if="c.row" class="tt-row">
            <span class="tt-lbl">{{ t('effperk.source') }}</span>
            <span>{{ t(c.row.source === 'editor' ? 'perk.srcEditor' : 'perk.srcGame') }}</span>
          </div>
        </div>
        <div v-if="c.funcNote" class="tt-note" :class="{ 'tt-warn': c.funcImpact === 'major' }">
          {{ c.funcNote }}
        </div>
        <div v-if="c.state !== 'saved'" :class="c.state === 'pendingAdd' ? 'tt-add' : 'tt-warn'">
          {{ t(c.state === 'pendingAdd' ? 'effperk.pendingAdd' : 'effperk.pendingRemove') }}
        </div>
        <div class="tt-foot">
          <span class="tt-id">{{ c.id }}</span>
          <NButton size="tiny" secondary :type="c.state === 'saved' ? 'error' : 'default'" @click="perkAction(c)">
            {{ actionLabel(c.state) }}
          </NButton>
        </div>
      </div>
    </NPopover>
  </div>

  <NText :depth="3" class="block text-11px mb-1 mt-2">
    {{ t('eff.title') }}
  </NText>
  <NText v-if="effectCells.length === 0" :depth="3" class="block text-12px">
    {{ t('eff.none') }}
  </NText>
  <div v-else class="wall">
    <NPopover
      v-for="c in effectCells" :key="c.key"
      trigger="hover" raw :show-arrow="false" placement="top"
      :delay="150" :duration="60"
    >
      <template #trigger>
        <div class="cell small" :class="[c.state, { danger: c.danger }]">
          <img v-if="c.icon" class="cell-icon" :src="c.icon" :alt="c.id" draggable="false">
          <span v-else class="cell-fallback">{{ c.name }}</span>
          <span v-if="c.badge" class="cell-badge">{{ c.badge }}</span>
          <span v-if="c.state === 'pendingAdd'" class="cell-mark add">+</span>
          <span v-else-if="c.state === 'pendingRemove'" class="cell-mark del">×</span>
        </div>
      </template>
      <div class="game-tt ep-tt">
        <div class="tt-head">
          <img v-if="c.icon" :src="c.icon" alt="" class="tt-icon">
          <span class="tt-name">{{ c.name }}</span>
          <span class="tt-kind effect">{{ t('effperk.ttEffect') }}</span>
        </div>
        <div v-if="c.desc" class="tt-desc">
          {{ c.desc }}
        </div>
        <div class="tt-stats">
          <div v-if="c.group" class="tt-row">
            <span class="tt-lbl">{{ t('effperk.group') }}</span>
            <span>{{ groupLabel(c.group) }}</span>
          </div>
          <div class="tt-row">
            <span class="tt-lbl">{{ t('effperk.duration') }}</span>
            <span>{{ c.permanent ? t('eff.permanentTag') : t('eff.secondsTag', { n: c.seconds }) }}</span>
          </div>
          <div v-if="c.durationFrames" class="tt-row">
            <span class="tt-lbl">{{ t('eff.tt.defaultDuration') }}</span>
            <span>{{ t('eff.secondsTag', { n: frames2s(c.durationFrames) }) }}</span>
          </div>
          <div v-if="effectTraits(c)" class="tt-row">
            <span class="tt-lbl">{{ t('perk.tt.traits') }}</span>
            <span>{{ effectTraits(c) }}</span>
          </div>
          <div v-if="c.row" class="tt-row">
            <span class="tt-lbl">{{ t('effperk.source') }}</span>
            <span>{{ t(c.row.source === 'editor' ? 'eff.srcEditor' : 'eff.srcGame') }}</span>
          </div>
        </div>
        <div v-if="c.danger" class="tt-warn">
          {{ t('effperk.danger') }}
        </div>
        <div v-if="c.state !== 'saved'" :class="c.state === 'pendingAdd' ? 'tt-add' : 'tt-warn'">
          {{ t(c.state === 'pendingAdd' ? 'effperk.pendingAdd' : 'effperk.pendingRemove') }}
        </div>
        <div class="tt-foot">
          <span class="tt-id">{{ c.id }}</span>
          <NButton size="tiny" secondary :type="c.state === 'saved' ? 'error' : 'default'" @click="effectAction(c)">
            {{ actionLabel(c.state) }}
          </NButton>
        </div>
      </div>
    </NPopover>
  </div>
</template>

<style scoped>
/* 天赋格 40px(图标 16→32px 二倍缩放),效果小格 30px(图标 22px)。 */
.wall { display: flex; flex-wrap: wrap; gap: 5px; }
.cell {
  position: relative;
  width: 40px;
  height: 40px;
  background: #0d0d12;
  border: 1px solid #7a6236;
  box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}
.cell.small { width: 30px; height: 30px; border-color: #3e5a7a; }
.cell.small .cell-icon { width: 22px; height: 22px; }
.cell.danger { border-color: #b0463c; }
.cell.pendingAdd { border: 1px dashed #6fae6f; }
.cell.pendingRemove { border: 1px dashed #b0463c; opacity: 0.45; }
.cell:hover { filter: brightness(1.3); }
.cell-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
  image-rendering: pixelated;
  pointer-events: none;
}
.cell-fallback {
  overflow: hidden;
  max-height: 100%;
  padding: 1px;
  font-size: 8px;
  line-height: 1.1;
  word-break: break-all;
  text-align: center;
  color: #ddd;
  text-shadow: 1px 1px 0 #000;
}
.cell-badge {
  position: absolute;
  right: 2px;
  bottom: 0;
  font-size: 10px;
  color: #ffe9a8;
  text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000;
}
.cell-mark {
  position: absolute;
  left: 2px;
  top: -1px;
  font-size: 11px;
  font-weight: 700;
  text-shadow: 1px 1px 0 #000;
}
.cell-mark.add { color: #7ec97e; }
.cell-mark.del { color: #ff6b5e; }

/* tooltip 面板样式为全局 .game-tt(styles/game-tooltip.css);此处仅覆盖:
   天赋/效果面板的标签列较窄(纯文字标签,无统计小图标) */
.game-tt .tt-lbl { width: 64px; }
</style>
