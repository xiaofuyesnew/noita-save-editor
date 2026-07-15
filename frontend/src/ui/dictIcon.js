// 字典 sprite 路径 → 前端图标 URL。
// build-icons.js 的固定映射规则:'data/ui_gfx/' 前缀 → '/icons/';
// 未知路径(模组贴图等)返回 '',调用方显示占位。
export function uiGfxIconUrl(spritePath) {
  return spritePath?.startsWith('data/ui_gfx/')
    ? `/icons/${spritePath.slice('data/ui_gfx/'.length)}`
    : ''
}
