// M4 药水/材料容器模型 —— 编辑快捷栏内带 MaterialInventoryComponent 的物品
// (药水瓶、粉末袋)所装的材料与数量。
//
// 存档结构(实测 §3.3):
//   <Entity tags="...potion"> > <MaterialInventoryComponent> > <count_per_material_type>
//     > <Material count="1000" material="water" />
// 编辑 = 整体替换 Material 子元素列表;材料名必须在 materials.json 字典内。
// 容量参考 MaterialSuckerComponent barrel_size(默认 1000),超装不阻止
// (游戏对超装宽容),由 UI 负责提示。

import {
  findComponent,
  findChild,
  findChildren,
  childEntities,
  getAttr,
  entityHasTag,
  makeElement,
  tagOf,
} from '../xml/query.js';
import { quickInventory } from './wands.js';
import { findMaterial } from '../services/dict.js';

const MATERIAL_RE = /^[a-z0-9_]+$/;

/** 快捷栏中的材料容器实体(树内顺序 = 对外索引)。 */
export function containerEntities(playerTree) {
  return childEntities(quickInventory(playerTree), (e) =>
    findComponent(e, 'MaterialInventoryComponent') !== undefined);
}

/** 按索引取容器实体;越界抛错。 */
export function containerAt(playerTree, index) {
  const containers = containerEntities(playerTree);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= containers.length) {
    throw new Error(`容器索引越界: ${index}(现有 ${containers.length} 个)`);
  }
  return containers[i];
}

/** MaterialInventoryComponent 下的 <count_per_material_type>(缺失则补建)。 */
export function countPerMaterialNode(entity) {
  const inv = findComponent(entity, 'MaterialInventoryComponent');
  if (!inv) throw new Error('实体缺少 MaterialInventoryComponent');
  let node = findChild(inv, 'count_per_material_type');
  if (!node) {
    node = makeElement('count_per_material_type');
    inv[tagOf(inv)].push(node);
  }
  return node;
}

/** 读单个容器(材料列表附字典中文名)。 */
export function readContainer(entity, index) {
  const item = findComponent(entity, 'ItemComponent');
  const sucker = findComponent(entity, 'MaterialSuckerComponent');
  const kind = entityHasTag(entity, 'potion')
    ? 'potion'
    : entityHasTag(entity, 'powder_stash') ? 'powder_stash' : 'other';
  const materials = findChildren(countPerMaterialNode(entity), 'Material').map((m) => {
    const id = getAttr(m, 'material') ?? '';
    const dict = findMaterial(id);
    return {
      material: id,
      count: getAttr(m, 'count') ?? '0',
      nameZh: dict?.nameZh,
      matKind: dict?.kind,
    };
  });
  return {
    index,
    kind,
    slot: item ? getAttr(item, 'inventory_slot.x') : undefined,
    capacity: sucker ? getAttr(sucker, 'barrel_size') : undefined,
    materials,
  };
}

/** 快捷栏容器列表。 */
export function listContainers(playerTree) {
  return containerEntities(playerTree).map((e, i) => readContainer(e, i));
}

/**
 * 整体替换容器材料列表。
 * @param {Array<{material: string, count: string|number}>} materials 空数组 = 清空
 * @returns {{changed: boolean, container: object}}
 */
export function applyContainerMaterials(playerTree, index, materials) {
  if (!Array.isArray(materials)) throw new Error('materials 必须是数组');
  const entity = containerAt(playerTree, index);

  const cleaned = materials.map((m, i) => {
    const id = String(m?.material ?? '').trim();
    if (!MATERIAL_RE.test(id)) {
      throw new Error(`第 ${i + 1} 项材料名非法: ${JSON.stringify(m?.material)}`);
    }
    if (!findMaterial(id)) throw new Error(`未知材料: ${id}(不在 materials.json 字典内)`);
    const count = String(m?.count ?? '').trim();
    const n = Number(count);
    if (count === '' || !Number.isFinite(n) || n < 0) {
      throw new Error(`材料 ${id} 的数量非法: ${JSON.stringify(m?.count)}`);
    }
    return { material: id, count };
  });

  const node = countPerMaterialNode(entity);
  // 属性顺序沿用游戏原生输出(count 在前)
  node[tagOf(node)] = cleaned.map((m) =>
    makeElement('Material', { count: m.count, material: m.material }));

  return { changed: true, container: readContainer(entity, Number(index)) };
}
