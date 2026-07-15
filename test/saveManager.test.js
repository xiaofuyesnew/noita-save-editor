import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SAVE_DIR as SAVE } from './setup.js';
import { SaveManager } from '../server/services/saveManager.js';
import { docRoot, findComponent, getAttr, setAttr } from '../server/xml/query.js';

function freshManager() {
  const root = mkdtempSync(join(tmpdir(), 'noita-sm-'));
  const saveDir = join(root, 'save00');
  cpSync(SAVE, saveDir, { recursive: true });
  const sm = new SaveManager({
    saveDir,
    backupsDir: join(root, 'backups'),
    keepBackups: 3,
  });
  return { sm, root, saveDir };
}

test('reload loads managed files into buffers', () => {
  const { sm, root } = freshManager();
  sm.reload();
  assert.ok(sm.getTree('player.xml'));
  assert.ok(sm.getTree('world_state.xml'));
  assert.equal(sm.dirty, false);
  rmSync(root, { recursive: true, force: true });
});

test('edit + commit writes byte-changed file and clears dirty', () => {
  const { sm, root, saveDir } = freshManager();
  sm.reload();
  const player = docRoot(sm.getTree('player.xml'), 'Entity');
  const wallet = findComponent(player, 'WalletComponent');
  assert.ok(wallet, 'WalletComponent present');
  setAttr(wallet, 'money', '999999');
  sm.markDirty('player.xml');
  assert.equal(sm.dirty, true);

  const res = sm.commit({ skipBackup: false });
  return res.then((r) => {
    assert.deepEqual(r.written, ['player.xml']);
    assert.ok(r.backup, 'backup created before write');
    assert.equal(sm.dirty, false);
    const onDisk = readFileSync(join(saveDir, 'player.xml'), 'utf8');
    assert.match(onDisk, /money="999999"/);
    // 未修改的文件不应被写
    rmSync(root, { recursive: true, force: true });
  });
});

test('commit with no dirty files is a no-op', async () => {
  const { sm, root } = freshManager();
  sm.reload();
  const r = await sm.commit();
  assert.deepEqual(r.written, []);
  rmSync(root, { recursive: true, force: true });
});

test('backup then restore round-trips', async () => {
  const { sm, root, saveDir } = freshManager();
  sm.reload();
  const name = sm.backup();
  assert.ok(existsSync(join(sm.backupsDir, name)));

  // 改并写盘
  const player = docRoot(sm.getTree('player.xml'), 'Entity');
  setAttr(findComponent(player, 'WalletComponent'), 'money', '5');
  sm.markDirty('player.xml');
  await sm.commit({ skipBackup: true });
  assert.match(readFileSync(join(saveDir, 'player.xml'), 'utf8'), /money="5"/);

  // 恢复回备份
  await sm.restore(name);
  const restored = readFileSync(join(saveDir, 'player.xml'), 'utf8');
  assert.doesNotMatch(restored, /money="5"/);
  rmSync(root, { recursive: true, force: true });
});

test('keepBackups prunes oldest', () => {
  const { sm, root } = freshManager();
  for (let i = 0; i < 5; i++) sm.backup(sm.saveDir, `t${i}`);
  assert.ok(sm.listBackups().length <= 3);
  rmSync(root, { recursive: true, force: true });
});

test('deleteBackup / exportBackup manage single backups safely', () => {
  const { sm, root } = freshManager();
  const name = sm.backup();

  // 导出为真 zip(PK 魔数),包体非空
  const { fileName, data } = sm.exportBackup(name);
  assert.equal(fileName, `${name}.zip`);
  assert.ok(data.length > 1000, `zip 应有实际内容(得到 ${data.length} 字节)`);
  assert.equal(data.readUInt16LE(0), 0x4b50); // 'PK'

  // 名称校验:穿越/不存在均拒绝
  assert.throws(() => sm.deleteBackup('../evil'), /备份名非法/);
  assert.throws(() => sm.deleteBackup('save00-nope'), /备份不存在/);
  assert.throws(() => sm.exportBackup('save00-nope'), /备份不存在/);

  // 删除后列表为空
  sm.deleteBackup(name);
  assert.equal(sm.listBackups().length, 0);
  rmSync(root, { recursive: true, force: true });
});

test('status reports shape', () => {
  const { sm, root } = freshManager();
  const s = sm.status();
  assert.equal(typeof s.gameRunning, 'boolean');
  assert.ok(Array.isArray(s.managedFiles));
  assert.ok(s.managedFiles.includes('player.xml'));
  rmSync(root, { recursive: true, force: true });
});
