// 测试存档目录解析(单一事实来源):
//  1. 显式 NOITA_WORKSPACE_SAVE(调用方指定,如指向某个备份做回归)
//  2. 仓库根 save00/(本工作区真实存档快照 —— 全量真实回归)
//  3. test/fixtures/save00/(入库的最小夹具 —— CI / 拆库后的默认)
//
// 经 package.json 的 `node --import ./test/setup.js --test` 预加载:
// 在任何测试模块(含 server/config.js)求值前把选择写入环境变量,保证
// API 型测试的 saveManager 单例与直接读文件的单测用同一目录,且不受
// 开发机 config.local.json 的影响。node:test 子进程继承 execArgv 与
// env,本文件在每个测试进程里同样先于测试代码执行。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoSave = fileURLToPath(new URL('../save00/', import.meta.url));
const fixtureSave = fileURLToPath(new URL('./fixtures/save00/', import.meta.url));

export const SAVE_DIR =
  process.env.NOITA_WORKSPACE_SAVE ||
  (existsSync(join(repoSave, 'player.xml')) ? repoSave : fixtureSave);

process.env.NOITA_WORKSPACE_SAVE = SAVE_DIR;
