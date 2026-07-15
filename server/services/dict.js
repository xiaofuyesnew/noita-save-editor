// 字典加载服务:data/ 下预生成 JSON 的读取与缓存(§6)。
// 字典随仓库提交,运行时零网络依赖;build-dict.js 重跑后需重启服务。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dataDir = fileURLToPath(new URL('../../data', import.meta.url));

// 可通过 /api/dict/:name 暴露的字典白名单
const DICT_NAMES = ['spells', 'spell_types', 'effects', 'perks', 'materials', 'wands'];

const cache = new Map();

/** 读字典(名称必须在白名单内;文件缺失/名称非法抛错)。 */
export function getDict(name) {
  if (!DICT_NAMES.includes(name)) {
    throw new Error(`未知字典: ${name}(可用: ${DICT_NAMES.join(', ')})`);
  }
  if (!cache.has(name)) {
    cache.set(name, JSON.parse(readFileSync(join(dataDir, `${name}.json`), 'utf8')));
  }
  return cache.get(name);
}

/** 按 action_id 查法术字典条目;查不到返回 undefined。 */
export function findSpell(actionId) {
  return getDict('spells').find((s) => s.id === actionId);
}

/** 按枚举名查效果字典条目;查不到返回 undefined。 */
export function findEffect(effectId) {
  return getDict('effects').find((e) => e.id === effectId);
}

/** 按天赋 ID 查字典条目;查不到返回 undefined。 */
export function findPerk(perkId) {
  return getDict('perks').find((p) => p.id === perkId);
}

/** 按材料名(CellData name)查字典条目;查不到返回 undefined。 */
export function findMaterial(materialId) {
  return getDict('materials').find((m) => m.id === materialId);
}

/**
 * 按外观资源路径(AbilityComponent.sprite_file)查法杖外观字典条目(§12);
 * 查不到返回 undefined(模组/自定义路径 —— 调用方应只改贴图不碰几何字段)。
 */
export function findWandLook(file) {
  return getDict('wands').find((w) => w.file === file);
}

/** 法术类型 → item_bg 背景图路径(未知类型回退 other)。 */
export function itemBgForType(type) {
  const types = getDict('spell_types');
  const hit = types.find((t) => t.type === type) ?? types.find((t) => t.type === 'other');
  return hit.itemBg;
}

export { DICT_NAMES };
