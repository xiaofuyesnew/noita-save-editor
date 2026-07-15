import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { SAVE_DIR as SAVE } from './setup.js';
import { loadXml, parseXml } from '../server/xml/parse.js';
import { serializeXml, countElements } from '../server/xml/serialize.js';

function collect() {
  const files = [];
  const push = (p) => existsSync(p) && files.push(p);
  push(join(SAVE, 'player.xml'));
  push(join(SAVE, 'world_state.xml'));
  push(join(SAVE, 'mod_config.xml'));
  const bones = join(SAVE, 'persistent', 'bones_new');
  if (existsSync(bones)) {
    for (const f of readdirSync(bones)) {
      if (f.endsWith('.xml')) files.push(join(bones, f));
    }
  }
  const stats = join(SAVE, 'stats');
  if (existsSync(stats)) {
    for (const f of readdirSync(stats)) {
      if (f.endsWith('.xml')) files.push(join(stats, f));
    }
  }
  return files;
}

const FILES = collect();

test('fixture files were found', () => {
  assert.ok(FILES.length >= 3, `expected save00 fixtures, got ${FILES.length}`);
});

for (const file of FILES) {
  const label = file.slice(SAVE.length);

  test(`byte-identical round-trip: ${label}`, () => {
    const original = readFileSync(file, 'latin1'); // 逐字节保真比较
    const { tree, style } = loadXml(original);
    const out = serializeXml(tree, { style });
    if (out !== original) {
      // 定位首个差异,便于调试
      let i = 0;
      while (i < out.length && i < original.length && out[i] === original[i]) i++;
      const ctx = (s) =>
        JSON.stringify(s.slice(Math.max(0, i - 30), i + 30));
      assert.fail(
        `round-trip diff in ${label} at byte ${i}\n` +
          `  orig: ${ctx(original)}\n  out : ${ctx(out)}`,
      );
    }
  });

  test(`structural round-trip stable: ${label}`, () => {
    const original = readFileSync(file, 'utf8');
    const tree1 = parseXml(original);
    const tree2 = parseXml(serializeXml(tree1, { style: loadXml(original).style }));
    assert.equal(countElements(tree1), countElements(tree2));
    assert.deepEqual(tree2, tree1);
  });
}
