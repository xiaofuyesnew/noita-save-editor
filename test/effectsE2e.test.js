// M3 端到端集成测试:模型注入 → SaveManager 提交 → 磁盘文件验证。
// 在临时目录的 save00 副本上走完整写盘管道,不动仓库快照。

import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SAVE_DIR as SAVE } from './setup.js';
import { SaveManager } from '../server/services/saveManager.js';
import { parseXml } from '../server/xml/parse.js';
import { addEffect, listEffects } from '../server/model/effects.js';
import { listPerks, addPerk, hasRunFlag, getLuaGlobal } from '../server/model/perks.js';

test('注入效果+天赋 → commit → 双文件落盘且可重读', async () => {
  const root = mkdtempSync(join(tmpdir(), 'noita-m3-'));
  const saveDir = join(root, 'save00');
  cpSync(SAVE, saveDir, { recursive: true });
  const sm = new SaveManager({
    saveDir,
    backupsDir: join(root, 'backups'),
    keepBackups: 2,
  });
  sm.reload();

  const playerTree = sm.getTree('player.xml');
  const worldTree = sm.getTree('world_state.xml');
  const perksBefore = listPerks(playerTree, worldTree).length;

  addEffect(playerTree, { effect: 'PROTECTION_ALL', withIcon: true });
  addPerk(playerTree, worldTree, { id: 'BREATH_UNDERWATER' });
  sm.markDirty('player.xml');
  sm.markDirty('world_state.xml');

  const r = await sm.commit();
  assert.deepEqual(r.written.sort(), ['player.xml', 'world_state.xml']);

  // 磁盘内容验证
  const playerText = readFileSync(join(saveDir, 'player.xml'), 'utf8');
  assert.match(playerText, /effect="PROTECTION_ALL"/);
  assert.match(playerText, /name="save_editor_perk"/);
  assert.match(playerText, /icon_sprite_file="data\/ui_gfx\/status_indicators\/protection_all\.png"/);
  const worldText = readFileSync(join(saveDir, 'world_state.xml'), 'utf8');
  assert.match(worldText, /PERK_PICKED_BREATH_UNDERWATER/);

  // 重新解析磁盘文件,模型仍能读出注入结果
  const rePlayer = parseXml(playerText);
  const reWorld = parseXml(worldText);
  assert.ok(listEffects(rePlayer).some((e) => e.effect === 'PROTECTION_ALL' && e.hasIcon));
  assert.ok(hasRunFlag(reWorld, 'PERK_PICKED_BREATH_UNDERWATER'));
  assert.equal(getLuaGlobal(reWorld, 'PERK_PICKED_BREATH_UNDERWATER_PICKUP_COUNT'), '1');
  const perks = listPerks(rePlayer, reWorld);
  assert.equal(perks.length, perksBefore + 1);
  const injected = perks.find((p) => p.id === 'BREATH_UNDERWATER');
  assert.ok(injected, '落盘重读后应能列出注入的天赋');
  assert.equal(injected.entityCount, 1);

  rmSync(root, { recursive: true, force: true });
});
