<script setup>
// 法术详情面板(游戏风格 tooltip 的内容体):字典条目 + 可选的槽内实例。
// 由 SlotStrip(法杖/背包槽)与 SpellPickerModal(选择器行)共用。
// 数值行按字段存在性稀疏渲染:修正类增量(castDelay/damageMods 等,来自
// gun_actions 的 action() 解析)带 +/- 号;弹射物基础数值(projectile.*)
// 直出。单位换算(帧÷60、伤害×25)见 ui/format.js;图标取原版物品栏统计
// 小图标(build-icons.js 提取到 /icons/inventory/)。
import { dictName, getLang } from '@/locales'
import { useDictStore } from '@/stores/dict'
import { dmg, frames2s, signedFrames2s, signedNum, speedRange, trimNum } from '@/ui/format'

const props = defineProps({
  entry: { type: Object, default: null }, // spells.json 字典条目
  spell: { type: Object, default: null }, // 槽内实例(usesRemaining/alwaysCast/slot);选择器场景为空
})
const { t } = useI18n()
const dict = useDictStore()

// 字典 sprite 路径按 build-icons.js 的固定规则映射:'data/ui_gfx/' → '/icons/'
function iconUrl(spritePath) {
  return spritePath?.startsWith('data/ui_gfx/')
    ? `/icons/${spritePath.slice('data/ui_gfx/'.length)}`
    : ''
}

const icon = computed(() => iconUrl(props.entry?.sprite))
const name = computed(() =>
  props.entry ? (dictName(props.entry) || props.entry.id) : (props.spell?.actionId ?? '?'))
const desc = computed(() => {
  const d = props.entry
  if (!d)
    return ''
  return getLang() === 'zh' ? (d.descZh || d.desc) : (d.desc || d.descZh)
})
const typeLabel = computed(() => {
  const type = props.entry?.type
  if (!type)
    return '?'
  if (getLang() === 'zh')
    return dict.spellTypes?.find(x => x.type === type)?.nameZh ?? t(`spelltype.${type}`)
  return t(`spelltype.${type}`)
})

const usesText = computed(() => {
  const d = props.entry
  if (props.spell) {
    const cur = props.spell.usesRemaining === '-1'
      ? t('wand.tt.unlimited')
      : props.spell.usesRemaining
    return d && d.maxUses !== '-1' ? `${cur} / ${d.maxUses}` : cur
  }
  return d && d.maxUses !== '-1' ? d.maxUses : t('wand.tt.unlimited')
})

const INV = '/icons/inventory'
const statRows = computed(() => {
  const d = props.entry
  if (!d)
    return []
  const rows = []
  const push = (icon, label, value) => rows.push({ icon, label, value })
  const signedDmg = v => `${v >= 0 ? '+' : ''}${dmg(v)}`
  const dmgLabel = type => t('spell.tt.dmg', { type: t(`dmg.${type}`) })
  // 有对应统计小图标的伤害类型(/icons/inventory/icon_damage_*.png)
  const DMG_ICONS = new Set(['projectile', 'explosion', 'electricity', 'fire', 'ice', 'slice', 'melee', 'drill', 'healing', 'holy', 'curse'])
  const dmgIcon = type => DMG_ICONS.has(type) ? `${INV}/icon_damage_${type}.png` : ''
  // 伤害修正(modifier 增量,内部值 ×25 显示)
  for (const [type, v] of Object.entries(d.damageMods ?? {}))
    push(dmgIcon(type), dmgLabel(type), signedDmg(v))
  // 弹射物基础数值
  const p = d.projectile
  if (p) {
    if (p.damage > 0)
      push(dmgIcon('projectile'), dmgLabel('projectile'), dmg(p.damage))
    for (const [type, v] of Object.entries(p.damageByType ?? {}))
      push(dmgIcon(type), dmgLabel(type), dmg(v))
    if (p.explosionDamage > 0) {
      push(dmgIcon('explosion'), dmgLabel('explosion'), dmg(p.explosionDamage))
      if (p.explosionRadius > 0)
        push(`${INV}/icon_explosion_radius.png`, t('spell.tt.explRadius'), trimNum(p.explosionRadius))
    }
    if (p.speedMax > 0)
      push(`${INV}/icon_speed_multiplier.png`, t('spell.tt.speed'), speedRange(p.speedMin ?? p.speedMax, p.speedMax))
    if (p.lifetime > 0)
      push('', t('spell.tt.lifetime'), `${frames2s(p.lifetime)} s`)
  }
  // 施法参数修正
  if (d.explosionRadius !== undefined)
    push(`${INV}/icon_explosion_radius.png`, t('spell.tt.explRadius'), signedNum(d.explosionRadius))
  if (d.castDelay !== undefined)
    push(`${INV}/icon_fire_rate_wait.png`, t('spell.tt.castDelay'), signedFrames2s(d.castDelay))
  if (d.rechargeTime !== undefined)
    push(`${INV}/icon_reload_time.png`, t('spell.tt.recharge'), signedFrames2s(d.rechargeTime))
  if (d.spreadDegrees !== undefined)
    push(`${INV}/icon_spread_degrees.png`, t('spell.tt.spread'), signedNum(d.spreadDegrees, ' DEG'))
  if (d.critChance !== undefined)
    push(`${INV}/icon_damage_critical_chance.png`, t('spell.tt.crit'), signedNum(d.critChance, ' %'))
  if (d.speedMultiplier !== undefined)
    push(`${INV}/icon_speed_multiplier.png`, t('spell.tt.speedMul'), `× ${trimNum(d.speedMultiplier)}`)
  if (d.speedAdd !== undefined)
    push(`${INV}/icon_speed_multiplier.png`, t('spell.tt.speedMul'), signedNum(d.speedAdd))
  if (d.bounces !== undefined)
    push(`${INV}/icon_bounces.png`, t('spell.tt.bounces'), signedNum(d.bounces))
  if (d.lifetimeAdd !== undefined)
    push('', t('spell.tt.lifetime'), signedFrames2s(d.lifetimeAdd))
  if (d.knockback !== undefined)
    push(`${INV}/icon_knockback.png`, t('spell.tt.knockback'), signedNum(d.knockback))
  return rows
})
</script>

<template>
  <div class="game-tt">
    <div class="tt-head">
      <img v-if="icon" :src="icon" alt="" class="tt-icon">
      <span class="tt-name">{{ name }}</span>
    </div>
    <div v-if="desc" class="tt-desc">
      {{ desc }}
    </div>
    <div class="tt-stats">
      <div class="tt-row">
        <span class="tt-lbl"><img src="/icons/inventory/icon_action_type.png" alt="">{{ t('wand.tt.type') }}</span>
        <span>{{ typeLabel }}</span>
      </div>
      <div class="tt-row">
        <span class="tt-lbl"><img src="/icons/inventory/icon_action_max_uses.png" alt="">{{ t('wand.tt.uses') }}</span>
        <span>{{ usesText }}</span>
      </div>
      <div class="tt-row">
        <span class="tt-lbl"><img src="/icons/inventory/icon_mana_drain.png" alt="">{{ t('wand.tt.mana') }}</span>
        <span class="tt-mana">{{ entry?.mana ?? '?' }}</span>
      </div>
      <div v-for="(r, i) in statRows" :key="i" class="tt-row">
        <span class="tt-lbl">
          <img v-if="r.icon" :src="r.icon" alt="">
          <span v-else class="tt-lbl-pad" />
          {{ r.label }}
        </span>
        <span>{{ r.value }}</span>
      </div>
      <div v-if="entry?.price" class="tt-row">
        <span class="tt-lbl"><span class="tt-lbl-pad" />{{ t('wand.tt.price') }}</span>
        <span class="tt-gold">{{ entry.price }}</span>
      </div>
      <div v-if="spell?.alwaysCast" class="tt-row tt-ac">
        <span class="tt-lbl"><img src="/icons/inventory/icon_gun_permanent_actions.png" alt=""></span>
        <span>{{ t('wand.tt.ac') }}</span>
      </div>
    </div>
    <div v-if="entry?.statsApprox" class="tt-note">
      {{ t('spell.tt.approx') }}
    </div>
    <div class="tt-id">
      {{ spell?.actionId ?? entry?.id }}<template v-if="spell">
        · {{ t('wand.slotLabel', { slot: spell.slot }) }}
      </template>
    </div>
  </div>
</template>
