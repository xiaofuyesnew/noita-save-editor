// M4 模型单测 —— 药水/世界状态/遗骨法杖在 save00 夹具树上操作(不落盘);
// 进度解锁旗标用临时目录做真实文件读写。
// save00 是真实存档快照,内容随「从实时档拉取」漂移;快照缺少前置条件
// (无药水/快捷栏满)时回退到 test/fixtures/save00/ 的入库夹具。

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SAVE_DIR } from './setup.js';
import { parseXml } from '../server/xml/parse.js';
import { serializeXml, countElements } from '../server/xml/serialize.js';
import {
  listContainers,
  applyContainerMaterials,
} from '../server/model/potions.js';
import {
  readWorldState,
  applyWorldState,
  hasRunFlag,
} from '../server/model/worldState.js';
import {
  listUnlocks,
  applyUnlocks,
  FLAG_FILE_CONTENT,
} from '../server/model/unlocks.js';
import { listBones, importBones } from '../server/model/bones.js';
import { listWands } from '../server/model/wands.js';
import { getDict } from '../server/services/dict.js';

const PLAYER = join(SAVE_DIR, 'player.xml');
const WORLD = join(SAVE_DIR, 'world_state.xml');
const BONES_DIR = join(SAVE_DIR, 'persistent', 'bones_new');

const loadPlayer = () => parseXml(readFileSync(PLAYER, 'utf8'));
const loadWorld = () => parseXml(readFileSync(WORLD, 'utf8'));

// 真实快照随「从实时档拉取」漂移,可能不含药水/无空法杖槽;
// 此时回退到入库夹具(水瓶 water 1000、快捷栏 2 杖)保证前置条件。
const FIXTURE_PLAYER = new URL('./fixtures/save00/player.xml', import.meta.url);
const loadFixturePlayer = () => parseXml(readFileSync(FIXTURE_PLAYER, 'utf8'));

function loadPlayerWithContainer() {
  const tree = loadPlayer();
  return listContainers(tree).length > 0 ? tree : loadFixturePlayer();
}

function loadPlayerWithFreeWandSlot() {
  const tree = loadPlayer();
  return listWands(tree).length < 4 ? tree : loadFixturePlayer();
}

function assertRoundTrip(tree) {
  const reparsed = parseXml(serializeXml(tree));
  assert.equal(countElements(reparsed), countElements(tree));
}

// ---- 字典 -------------------------------------------------------------------

test('dict: materials.json 覆盖常用材料并带 kind 分类', () => {
  const materials = getDict('materials');
  assert.ok(materials.length > 400, `材料数 ${materials.length} 应 >400`);
  const water = materials.find((m) => m.id === 'water');
  assert.equal(water.kind, 'liquid');
  assert.equal(water.nameZh, '水');
  assert.equal(materials.find((m) => m.id === 'gold').kind, 'powder');
});

test('dict: spells.json 带 unlockFlag(37 个旗标)', () => {
  const spells = getDict('spells');
  const flags = new Set(spells.map((s) => s.unlockFlag).filter(Boolean));
  assert.equal(flags.size, 37);
  assert.equal(
    spells.find((s) => s.id === 'SEA_LAVA').unlockFlag,
    'card_unlocked_sea_lava',
  );
  // 基础黑洞天生解锁,GIGA 版才要旗标
  assert.equal(spells.find((s) => s.id === 'BLACK_HOLE').unlockFlag, '');
  assert.equal(
    spells.find((s) => s.id === 'BLACK_HOLE_GIGA').unlockFlag,
    'card_unlocked_black_hole',
  );
});

// ---- 药水 -------------------------------------------------------------------

test('listContainers: 识别容器并读出材料', () => {
  const containers = listContainers(loadPlayerWithContainer());
  assert.ok(containers.length >= 1, '应至少有一个容器(夹具兜底为水瓶)');
  const potion = containers[0];
  assert.ok(['potion', 'powder_stash'].includes(potion.kind));
  assert.match(potion.capacity, /^\d+$/);
  for (const m of potion.materials) {
    assert.ok(m.material, '材料 id 应非空');
    assert.match(String(m.count), /^\d+(\.\d+)?$/);
    assert.ok(typeof m.nameZh === 'string');
  }
});

test('applyContainerMaterials: 替换/混装/清空 + round-trip', () => {
  const tree = loadPlayerWithContainer();
  const r = applyContainerMaterials(tree, 0, [
    { material: 'magic_liquid_hp_regeneration', count: '600' },
    { material: 'gold', count: 400 },
  ]);
  assert.equal(r.changed, true);
  assert.deepEqual(
    r.container.materials.map((m) => `${m.material}:${m.count}`),
    ['magic_liquid_hp_regeneration:600', 'gold:400'],
  );
  assertRoundTrip(tree);

  // 重解析后仍读得到
  const re = parseXml(serializeXml(tree));
  assert.equal(listContainers(re)[0].materials.length, 2);

  // 清空
  applyContainerMaterials(tree, 0, []);
  assert.equal(listContainers(tree)[0].materials.length, 0);
  assertRoundTrip(tree);
});

test('applyContainerMaterials: 非法输入拒绝', () => {
  const tree = loadPlayerWithContainer();
  const outOfRange = listContainers(tree).length + 5;
  assert.throws(() => applyContainerMaterials(tree, 0, [{ material: 'not_a_mat_xx', count: '1' }]), /未知材料/);
  assert.throws(() => applyContainerMaterials(tree, 0, [{ material: '../evil', count: '1' }]), /材料名非法/);
  assert.throws(() => applyContainerMaterials(tree, 0, [{ material: 'water', count: '-5' }]), /数量非法/);
  assert.throws(() => applyContainerMaterials(tree, 0, 'water'), /必须是数组/);
  assert.throws(() => applyContainerMaterials(tree, outOfRange, []), /越界/);
});

// ---- 世界状态 ----------------------------------------------------------------

test('readWorldState: 字段/旗标/lua_globals', () => {
  const s = readWorldState(loadWorld());
  // 真实快照的具体数值随存档漂移,只断言结构与取值形态
  assert.match(s.fields.dayCount, /^\d+$/);
  assert.match(s.fields.rain, /^[\d.eE+-]+$/);
  assert.match(s.fields.openFogOfWarEverywhere, /^[01]$/);
  assert.equal(s.fields.infiniteSpells, undefined);
  assert.ok(Array.isArray(s.flags));
  assert.ok(s.flags.every((f) => typeof f === 'string' && f.length > 0));
  assert.ok(Array.isArray(s.changedMaterials));
  assert.ok(s.luaGlobals.some((g) => g.key === 'ORB_MAP_STRING'));
  assert.ok(Array.isArray(s.orbsFoundThisrun));
});

test('applyWorldState: 字段补丁 + 旗标替换 + 真菌变换 + round-trip', () => {
  const tree = loadWorld();
  const r = applyWorldState(tree, {
    fields: { dayCount: '3', rain: '0', rainTarget: 0, openFogOfWarEverywhere: '1' },
    flags: ['weather_this_run_no_gradient', 'NEW_FLAG_X', 'NEW_FLAG_X', ''],
    changedMaterials: [{ from: 'water', to: 'gold' }],
  });
  assert.equal(r.changed, true);
  assert.deepEqual(r.fields, ['dayCount', 'rain', 'rainTarget', 'openFogOfWarEverywhere']);
  assert.equal(r.flagsReplaced, true);
  assert.equal(r.changedMaterialsReplaced, true);

  const s = readWorldState(tree);
  assert.equal(s.fields.dayCount, '3');
  assert.equal(s.fields.openFogOfWarEverywhere, '1');
  assert.deepEqual(s.flags, ['weather_this_run_no_gradient', 'NEW_FLAG_X']); // 去重去空
  assert.deepEqual(s.changedMaterials, [{ from: 'water', to: 'gold' }]);
  assert.ok(hasRunFlag(tree, 'NEW_FLAG_X'));

  assertRoundTrip(tree);
  const re = parseXml(serializeXml(tree));
  assert.deepEqual(readWorldState(re).changedMaterials, [{ from: 'water', to: 'gold' }]);
});

test('applyWorldState: 非法输入拒绝,空补丁不置 changed', () => {
  const tree = loadWorld();
  assert.throws(() => applyWorldState(tree, { fields: { bogus: '1' } }), /未知的世界状态字段/);
  assert.throws(() => applyWorldState(tree, { fields: { rain: 'wet' } }), /不是有效数值/);
  assert.throws(() => applyWorldState(tree, { flags: 'x' }), /必须是字符串数组/);
  assert.throws(() => applyWorldState(tree, { flags: ['bad flag!'] }), /旗标名非法/);
  assert.throws(() => applyWorldState(tree, { changedMaterials: [{ from: 'water', to: 'nope_xx' }] }), /未知材料/);
  assert.equal(applyWorldState(tree, {}).changed, false);
});

// ---- 进度解锁 ----------------------------------------------------------------

test('unlocks: 列表合并字典与磁盘,开关幂等可逆', () => {
  const dir = mkdtempSync(join(tmpdir(), 'noita-flags-'));
  try {
    // 空目录:全部未解锁,但字典内 37 个旗标都在列
    let list = listUnlocks(dir);
    assert.equal(list.length, 37);
    assert.ok(list.every((u) => !u.unlocked && u.known));
    const sea = list.find((u) => u.flag === 'card_unlocked_sea_lava');
    assert.ok(sea.spells.some((s) => s.id === 'SEA_LAVA'));

    // 开两个 → 文件出现,内容与游戏一致
    let r = applyUnlocks(dir, {
      card_unlocked_sea_lava: true,
      card_unlocked_paint: true,
    });
    assert.equal(r.applied.length, 2);
    assert.equal(readFileSync(join(dir, 'card_unlocked_paint'), 'utf8'), FLAG_FILE_CONTENT);
    list = listUnlocks(dir);
    assert.equal(list.filter((u) => u.unlocked).length, 2);

    // 幂等:重复开 = skipped
    r = applyUnlocks(dir, { card_unlocked_paint: true });
    assert.deepEqual(r.applied, []);
    assert.deepEqual(r.skipped, ['card_unlocked_paint']);

    // 关掉 → 文件消失
    r = applyUnlocks(dir, { card_unlocked_paint: false });
    assert.equal(r.applied.length, 1);
    assert.ok(!existsSync(join(dir, 'card_unlocked_paint')));

    // 字典未收录但格式合法的旗标(如模组)也允许,并出现在列表中标 known=false
    applyUnlocks(dir, { card_unlocked_mymod_spell: true });
    const mod = listUnlocks(dir).find((u) => u.flag === 'card_unlocked_mymod_spell');
    assert.equal(mod.known, false);
    assert.equal(mod.unlocked, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unlocks: 非法旗标名整体拒绝且不产生副作用', () => {
  const dir = mkdtempSync(join(tmpdir(), 'noita-flags-'));
  try {
    for (const bad of ['perk_picked_x', 'card_unlocked_../evil', 'card_unlocked_UPPER', '']) {
      assert.throws(
        () => applyUnlocks(dir, { card_unlocked_ok_flag: true, [bad]: true }),
        /旗标名非法/,
      );
    }
    assert.throws(() => applyUnlocks(dir, { card_unlocked_x: 'yes' }), /布尔值/);
    assert.throws(() => applyUnlocks(dir, ['card_unlocked_x']), /对象/);
    // 整体拒绝:连同合法项也不应写入
    assert.equal(listUnlocks(dir).filter((u) => u.unlocked).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 遗骨法杖 ----------------------------------------------------------------

// 注意:save00 是真实存档快照,遗骨数量与文件名随「从实时档拉取」变化,
// 断言一律取实际列表动态比对,不硬编码数量与文件名。

test('listBones: 枚举遗骨法杖并附法术摘要', () => {
  const bones = listBones(BONES_DIR);
  assert.ok(bones.length >= 1, '夹具 bones_new 应至少有一根遗骨法杖');
  assert.ok(bones.every((b) => !b.error), '不应有解析失败的文件');
  for (const b of bones) {
    assert.match(b.file, /^item[\w.\-]*\.xml$/);
    assert.ok(Array.isArray(b.spells));
    assert.equal(b.spells.length, b.spellCount);
    assert.ok(Number.isFinite(Number(b.manaMax)), `manaMax 应为数值: ${b.manaMax}`);
  }
});

test('importBones: 导入规整为在手形态,自动占用空槽', () => {
  const tree = loadPlayerWithFreeWandSlot();
  const before = listWands(tree);
  assert.ok(before.length < 4, '快捷栏应有空位供导入(夹具兜底)');
  const bone = listBones(BONES_DIR).find((b) => !b.error);

  const r = importBones(tree, BONES_DIR, bone.file);
  const after = listWands(tree);
  assert.equal(after.length, before.length + 1);
  assert.ok(!before.map((w) => Number(w.slot)).includes(r.slot), '新槽位应空闲');
  assert.equal(r.wand.uiName, bone.uiName);
  assert.equal(String(r.slot), after[after.length - 1].slot);

  // 实体形态检查:tags/位置/缩放/解冻由序列化文本反查
  const text = serializeXml(tree);
  assert.ok(!text.includes('trap_wand'), '导入后不应保留 trap_wand 标签');
  assertRoundTrip(tree);

  // 法术卡随导入带入,重解析后仍可读
  const re = parseXml(text);
  const reWands = listWands(re);
  assert.equal(reWands[reWands.length - 1].spellCount, r.spells.length);
});

test('importBones: 指定槽位与满员拒绝', () => {
  const tree = loadPlayer();
  const boneFile = listBones(BONES_DIR).find((b) => !b.error).file;
  const occupied = listWands(tree).map((w) => Number(w.slot));
  const free = [0, 1, 2, 3].filter((s) => !occupied.includes(s));

  // 指定被占槽位 → 拒绝
  assert.throws(
    () => importBones(tree, BONES_DIR, boneFile, { slot: occupied[0] }),
    /已被其他法杖占用/,
  );
  assert.throws(() => importBones(tree, BONES_DIR, boneFile, { slot: 7 }), /槽位必须是/);

  // 填满剩余槽位后再导入 → 满员拒绝
  for (const s of free) {
    importBones(tree, BONES_DIR, boneFile, { slot: s });
  }
  assert.throws(() => importBones(tree, BONES_DIR, boneFile), /已满/);
});

test('importBones: 文件名校验与缺失文件', () => {
  const tree = loadPlayer();
  assert.throws(() => importBones(tree, BONES_DIR, '../player.xml'), /文件名非法/);
  assert.throws(() => importBones(tree, BONES_DIR, 'item99999.xml'), /不存在/);
});
