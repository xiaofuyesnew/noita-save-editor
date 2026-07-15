// 法杖外观资源路径 → 预览图 URL(§12)。
// build-icons.js 的固定映射规则:
//   'data/items_gfx/wands/*.png' → '/icons/wands/*'(含 custom/ 子目录)
//   'data/items_gfx/(handgun|bomb_wand).xml' → '/icons/wands/$1.png'(初始杖精灵表)
// 未知路径(模组贴图/自定义)返回 '',调用方显示占位。
export function wandIconUrl(spriteFile) {
  if (!spriteFile)
    return ''
  if (spriteFile.startsWith('data/items_gfx/wands/') && spriteFile.endsWith('.png'))
    return `/icons/wands/${spriteFile.slice('data/items_gfx/wands/'.length)}`
  const m = spriteFile.match(/^data\/items_gfx\/(handgun|bomb_wand)\.xml$/)
  return m ? `/icons/wands/${m[1]}.png` : ''
}
