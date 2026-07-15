// 前端模块语法守卫 —— 本项目无构建步骤,浏览器 ES module 的语法错误
// 只有打开页面才会暴露;此测试用 node --check 提前拦截(含 i18n 子目录)。

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const webDir = fileURLToPath(new URL('../web', import.meta.url));

const files = readdirSync(webDir, { recursive: true })
  .map(String)
  .filter((n) => n.endsWith('.js'));

for (const name of files) {
  test(`web/${name.replaceAll('\\', '/')} 语法检查`, () => {
    assert.doesNotThrow(() =>
      execFileSync(process.execPath, ['--check', join(webDir, name)], { stdio: 'pipe' }));
  });
}
