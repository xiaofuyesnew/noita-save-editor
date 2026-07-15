// 物品栏道具模型单测 —— 在 save00 夹具树上操作(不落盘)。
// 夹具/快照快捷栏至少含:法杖 + 1 瓶水(药水容器);其余道具随存档演化,
// 断言一律动态比对,不硬编码具体道具。统一枚举口径:非法杖道具含容器。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SAVE_DIR } from './setup.js';
import { parseXml } from '../server/xml/parse.js';
import { serializeXml, countElements } from '../server/xml/serialize.js';
import {
  listItems,
  addItem,
  removeItem,
  moveItemSlot,
  itemCatalog,
  listCatalog,
  freeItemSlots,
  ITEM_SLOTS,
} from '../server/model/items.js';
import { listContainers, applyContainerMaterials } from '../server/model/potions.js';

const PLAYER = join(SAVE_DIR, 'player.xml');
const loadPlayer = () => parseXml(readFileSync(PLAYER, 'utf8'));

function assertRoundTrip(tree) {
  const reparsed = parseXml(serializeXml(tree));
  assert.equal(countElements(reparsed), countElements(tree));
}

/** 道具行满员时先移除 index 0 腾一格(真实快照可能已满 4/4)。 */
function ensureFreeSlot(tree) {
  if (freeItemSlots(tree) === 0) removeItem(tree, 0);
  return tree;
}

/** 树内邪王真眼道具数(快照本身可能已有一个,断言用计数不用存在性)。 */
function evilEyeCount(tree) {
  return listItems(tree).filter((i) => i.itemName === '$item_evil_eye').length;
}

// ---- 目录 -------------------------------------------------------------------

test('itemCatalog: 收录邪王真眼且实体已全展开(无 <Base>)', () => {
  const catalog = itemCatalog();
  assert.ok(catalog.length >= 10, `目录条目数 ${catalog.length} 偏少`);
  const evil = catalog.find((x) => x.id === 'evil_eye');
  assert.ok(evil, '目录应包含 evil_eye');
  assert.equal(evil.itemName, '$item_evil_eye');
  assert.equal(evil.name, 'Paha Silmä');
  assert.ok(!evil.entity.includes('<Base'), '注入用实体必须已摊平,不含 <Base>');
  // 全展开实体可独立解析
  assert.doesNotThrow(() => parseXml(evil.entity));
});

test('listCatalog: 精简视图不含庞大的 entity 字段', () => {
  const view = listCatalog();
  assert.ok(view.every((x) => x.entity === undefined), 'listCatalog 不应带 entity');
  assert.ok(view.every((x) => x.id && x.group), '每项应有 id 与 group');
});

test('itemCatalog: 收录药水/粉末袋空容器(container 组)', () => {
  const catalog = itemCatalog();
  for (const id of ['potion', 'powder_stash']) {
    const entry = catalog.find((x) => x.id === id);
    assert.ok(entry, `目录应包含 ${id}`);
    assert.equal(entry.group, 'container');
    assert.ok(!entry.entity.includes('<Base'), '注入用实体必须已摊平,不含 <Base>');
    assert.doesNotThrow(() => parseXml(entry.entity));
  }
});

// ---- 枚举 -------------------------------------------------------------------

// 注意:save00 可能是真实存档快照或最小夹具,快捷栏道具随之不同 ——
// 断言取实际列表动态比对,不硬编码具体道具(参照 extras 遗骨测试的做法)。

test('listItems: 枚举非法杖道具,含药水/粉末袋容器', () => {
  const tree = loadPlayer();
  const items = listItems(tree);
  assert.ok(Array.isArray(items));
  // 每项都应带槽位与 itemName,且不混入法杖(法杖 itemName 形如 default_gun)
  for (const it of items) {
    assert.ok(it.itemName !== undefined);
    assert.notEqual(it.kind, undefined);
  }
  // 容器条目:统一列表与容器索引空间一一对应,附材料/容量
  const containers = listContainers(tree);
  const potions = items.filter((i) => i.isContainer);
  assert.equal(potions.length, containers.length, '统一列表容器数应与容器索引空间一致');
  assert.ok(potions.length >= 1, '快捷栏应至少有一个容器(夹具含一瓶水)');
  for (const p of potions) {
    assert.ok(Array.isArray(p.materials));
    assert.notEqual(p.capacity, undefined);
    assert.equal(containers[p.containerIndex].slot, p.slot, 'containerIndex 应指向同一实体');
  }
  // 注入一个已知道具后应恰好多出一项,证明枚举口径稳定
  const tree2 = ensureFreeSlot(loadPlayer());
  const before = listItems(tree2).length;
  addItem(tree2, 'evil_eye');
  assert.equal(listItems(tree2).length, before + 1);
});

test('freeItemSlots: 容器占用的槽位计入占用(不再双重分配)', () => {
  const tree = loadPlayer();
  const potion = listItems(tree).find((i) => i.isContainer);
  assert.ok(potion, '夹具应含药水容器');
  const s = Number(potion.slot);
  assert.ok(Number.isInteger(s) && s >= 0 && s < ITEM_SLOTS, '夹具药水应占 0–3 槽');
  assert.throws(() => addItem(tree, 'moon', { slot: s }), /已被其他道具占用/);
});

// ---- 注入 -------------------------------------------------------------------

test('addItem: 补入邪王真眼到空槽,round-trip 一致', () => {
  const tree = ensureFreeSlot(loadPlayer());
  const before = listItems(tree).length;
  const eyesBefore = evilEyeCount(tree);
  const r = addItem(tree, 'evil_eye');

  assert.equal(listItems(tree).length, before + 1);
  assert.equal(r.item.itemName, '$item_evil_eye');
  assert.equal(r.item.nameZh, itemCatalog().find((x) => x.id === 'evil_eye').nameZh);
  assert.ok(Number.isInteger(r.slot) && r.slot >= 0 && r.slot < ITEM_SLOTS);

  // 序列化含 evil_eye 标签且元素数守恒
  const text = serializeXml(tree);
  assert.ok(text.includes('evil_eye'));
  assertRoundTrip(tree);

  // 重解析后新道具仍在,槽位/在手态字段就位
  const re = parseXml(text);
  assert.equal(evilEyeCount(re), eyesBefore + 1);
  const eye = listItems(re).find(
    (i) => i.itemName === '$item_evil_eye' && String(i.slot) === String(r.slot));
  assert.ok(eye, '重解析后应仍能在注入槽位读到邪王真眼');
});

test('addItem: 指定槽位与非法输入', () => {
  const tree = ensureFreeSlot(loadPlayer());

  // 越界槽位 → 拒绝
  assert.throws(() => addItem(tree, 'moon', { slot: 99 }), /槽位必须是/);
  // 未知目录 id → 拒绝
  assert.throws(() => addItem(tree, 'not_a_real_item'), /未知道具 id/);

  // 指定空槽 → 成功且落在该槽
  const occupied = new Set(listItems(tree).map((i) => Number(i.slot)));
  const free = Array.from({ length: ITEM_SLOTS }, (_, i) => i).find((s) => !occupied.has(s));
  const r = addItem(tree, 'moon', { slot: free });
  assert.equal(r.slot, free);

  // 现在该槽被占,再往同槽注入 → 拒绝
  assert.throws(() => addItem(tree, 'physics_die', { slot: free }), /已被其他道具占用/);
});

test('addItem: 槽满时拒绝', () => {
  const tree = loadPlayer();
  const occupied = new Set(listItems(tree).map((i) => Number(i.slot)));
  const free = Array.from({ length: ITEM_SLOTS }, (_, i) => i).filter((s) => !occupied.has(s));
  // 填满所有空的道具槽
  for (const s of free) addItem(tree, 'physics_die', { slot: s });
  assert.throws(() => addItem(tree, 'moon'), /已满/);
});

test('freeItemSlots: 道具行 4 格,注入递减、移除递增', () => {
  assert.equal(ITEM_SLOTS, 4);
  const tree = ensureFreeSlot(loadPlayer());
  const before = freeItemSlots(tree);
  assert.ok(before > 0 && before <= ITEM_SLOTS);
  const r = addItem(tree, 'evil_eye');
  assert.equal(freeItemSlots(tree), before - 1);
  removeItem(tree, r.index);
  assert.equal(freeItemSlots(tree), before);
});

test('addItem(potion): 注入空瓶,剥离随机化脚本,双索引空间可用', () => {
  const tree = ensureFreeSlot(loadPlayer());
  const containersBefore = listContainers(tree).length;
  const r = addItem(tree, 'potion');

  assert.equal(r.item.isContainer, true);
  assert.equal(r.item.kind, 'potion');
  assert.deepEqual(r.item.materials, [], '新注入的药水应是空瓶');
  assert.equal(listContainers(tree).length, containersBefore + 1);
  assert.equal(r.item.containerIndex, containersBefore, '新容器追加在容器索引空间末尾');

  // 随机化脚本必须剥离,否则进游戏材料会被覆盖;事件钩子(空 source)保留
  const text = serializeXml(tree);
  assert.ok(!text.includes('data/scripts/items/potion.lua'), '随机化脚本必须剥离');
  assertRoundTrip(tree);

  // 材料编辑走容器索引空间
  applyContainerMaterials(tree, r.item.containerIndex, [{ material: 'water', count: '500' }]);
  const mine = listItems(tree).find(
    (i) => i.isContainer && i.containerIndex === r.item.containerIndex);
  assert.equal(mine.materials.length, 1);
  assert.equal(mine.materials[0].material, 'water');

  // 删除走统一道具索引,容器索引空间随之收缩
  removeItem(tree, mine.index);
  assert.equal(listContainers(tree).length, containersBefore);
});

// ---- 换槽 -------------------------------------------------------------------

test('moveItemSlot: 移到空槽、与占用槽交换、越界拒绝', () => {
  const tree = loadPlayer();
  // 备齐前置:至少 2 个道具、至少 1 个空槽(快照道具数随存档演化)
  while (freeItemSlots(tree) < 2) removeItem(tree, 0);
  while (listItems(tree).length < 2) addItem(tree, 'physics_die');
  const items = listItems(tree);
  const it = items[0];

  assert.throws(() => moveItemSlot(tree, it.index, 9), /槽位必须是/);
  assert.equal(moveItemSlot(tree, it.index, Number(it.slot)).changed, false, '原槽 no-op');

  // 移到空槽
  const occupied = new Set(listItems(tree).map((i) => Number(i.slot)));
  const free = Array.from({ length: ITEM_SLOTS }, (_, i) => i).find((s) => !occupied.has(s));
  const r1 = moveItemSlot(tree, it.index, free);
  assert.equal(r1.changed, true);
  assert.equal(String(listItems(tree)[it.index].slot), String(free));

  // 与占用槽交换:双方槽位互换,树内顺序(索引)不变
  const other = listItems(tree).find((x) => x.index !== it.index);
  const otherSlot = Number(other.slot);
  const r2 = moveItemSlot(tree, it.index, otherSlot);
  assert.equal(r2.changed, true);
  assert.equal(String(listItems(tree)[it.index].slot), String(otherSlot));
  assert.equal(String(listItems(tree)[other.index].slot), String(free));
  assertRoundTrip(tree);
});

// ---- 删除 -------------------------------------------------------------------

test('removeItem: 移除后列表收缩,round-trip 一致', () => {
  const tree = ensureFreeSlot(loadPlayer());
  const eyesBefore = evilEyeCount(tree);
  const added = addItem(tree, 'evil_eye');
  const countAfterAdd = listItems(tree).length;

  const r = removeItem(tree, added.index);
  assert.equal(r.removed.itemName, '$item_evil_eye');
  assert.equal(listItems(tree).length, countAfterAdd - 1);
  assert.equal(evilEyeCount(tree), eyesBefore);
  assertRoundTrip(tree);
});

test('removeItem: 索引越界拒绝', () => {
  const tree = loadPlayer();
  assert.throws(() => removeItem(tree, 99), /越界/);
});
