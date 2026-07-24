// 存档管理:读盘、内存工作副本(编辑缓冲)、备份/恢复、pull/push、
// 进程检测、原子写入、互斥锁。所有写操作强制走 writeFile()/commit()。
//
// 编辑缓冲模型:load 后各 XML 的保序树缓存在内存 buffers 中,领域模型
// 直接改这些树;前端点【写入存档】才调用 commit() 落盘。dirty 标记
// 反映"有未保存更改"。

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { config } from '../config.js';
import { loadXml, parseXml } from '../xml/parse.js';
import { serializeXml, countElements, canonicalizeTree } from '../xml/serialize.js';

// 编辑器会读入内存并可写回的 XML 文件(相对存档目录)
const MANAGED_FILES = ['player.xml', 'world_state.xml', 'mod_config.xml'];

/** 目录是否为"可安全覆盖的推送目标":不存在 / 空目录 / 像 save00。 */
function isSafePushTarget(dir) {
  if (!existsSync(dir)) return true; // 首次推送会创建
  if (!statSync(dir).isDirectory()) return false;
  if (existsSync(join(dir, 'player.xml'))) return true; // 真实存档目录
  return readdirSync(dir).length === 0; // 空目录亦可
}

class Mutex {
  #locked = false;
  #queue = [];
  async run(fn) {
    while (this.#locked) await new Promise((r) => this.#queue.push(r));
    this.#locked = true;
    try {
      return await fn();
    } finally {
      this.#locked = false;
      const next = this.#queue.shift();
      if (next) next();
    }
  }
}

export class SaveManager {
  constructor(opts = {}) {
    this.saveDir = opts.saveDir || config.workspaceSave;
    this.liveDir = opts.liveDir || config.liveSave;
    this.backupsDir = opts.backupsDir || config.backupsDir;
    this.keepBackups = opts.keepBackups ?? config.keepBackups;
    /** @type {Map<string, {tree: Array, style: string, dirty: boolean}>} */
    this.buffers = new Map();
    this.version = 0; // 每次 reload/commit 递增,前端用于防索引漂移
    this.mutex = new Mutex();
    this.loaded = false;
  }

  // ---- 读取 ---------------------------------------------------------------

  /** 从存档目录读入受管 XML 到内存缓冲。 */
  reload() {
    this.buffers.clear();
    for (const name of MANAGED_FILES) {
      const p = join(this.saveDir, name);
      if (!existsSync(p)) continue;
      const text = readFileSync(p, 'utf8');
      const { tree, style } = loadXml(text);
      this.buffers.set(name, { tree, style, dirty: false });
    }
    this.loaded = true;
    this.version++;
    return this;
  }

  #ensureLoaded() {
    if (!this.loaded) this.reload();
  }

  /** 取某文件的保序树(领域模型入口)。不存在返回 undefined。 */
  getTree(name) {
    this.#ensureLoaded();
    return this.buffers.get(name)?.tree;
  }

  /** 标记文件已被修改(领域模型改树后调用)。 */
  markDirty(name) {
    const buf = this.buffers.get(name);
    if (buf) buf.dirty = true;
  }

  get dirty() {
    for (const buf of this.buffers.values()) if (buf.dirty) return true;
    return false;
  }

  dirtyFiles() {
    return [...this.buffers.entries()]
      .filter(([, b]) => b.dirty)
      .map(([n]) => n);
  }

  // ---- 进程检测 -----------------------------------------------------------

  /** 游戏是否正在运行(Windows tasklist;非 Windows 或出错返回 false)。 */
  isGameRunning() {
    if (process.platform !== 'win32') return false;
    try {
      const out = execFileSync(
        'tasklist',
        ['/FI', `IMAGENAME eq ${config.processName}`, '/FO', 'CSV', '/NH'],
        { encoding: 'utf8' },
      );
      return out.toLowerCase().includes(config.processName.toLowerCase());
    } catch {
      return false;
    }
  }

  // ---- 备份 ---------------------------------------------------------------

  #timestamp() {
    // 不用 Date.now();用文件系统当前时间生成可排序戳
    const d = new Date();
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return (
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
      `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
  }

  /** 完整拷贝指定目录到 backups/save00-<戳>/;返回备份名。 */
  backup(srcDir = this.saveDir, tag = '') {
    if (!existsSync(srcDir)) throw new Error(`备份源不存在: ${srcDir}`);
    mkdirSync(this.backupsDir, { recursive: true });
    const name = `save00-${this.#timestamp()}${tag ? '-' + tag : ''}`;
    const dest = join(this.backupsDir, name);
    // 极小概率同秒重名 —— 加序号
    let finalDest = dest;
    let i = 1;
    while (existsSync(finalDest)) finalDest = `${dest}_${i++}`;
    cpSync(srcDir, finalDest, { recursive: true });
    this.#pruneBackups();
    return basename(finalDest);
  }

  #pruneBackups() {
    if (!existsSync(this.backupsDir)) return;
    const entries = readdirSync(this.backupsDir)
      .filter((n) => n.startsWith('save00-'))
      .map((n) => ({ n, t: statSync(join(this.backupsDir, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { n } of entries.slice(this.keepBackups)) {
      rmSync(join(this.backupsDir, n), { recursive: true, force: true });
    }
  }

  listBackups() {
    if (!existsSync(this.backupsDir)) return [];
    return readdirSync(this.backupsDir)
      .filter((n) => n.startsWith('save00-'))
      .map((n) => ({
        name: n,
        mtime: statSync(join(this.backupsDir, n)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
  }

  /** 校验备份名并解析为 backups/ 内的绝对路径(防路径穿越;不存在抛错)。 */
  #backupPath(name) {
    if (!/^save00-[\w.\-]+$/.test(String(name))) {
      throw new Error(`备份名非法: ${JSON.stringify(name)}`);
    }
    const p = join(this.backupsDir, name);
    if (!existsSync(p)) throw new Error(`备份不存在: ${name}`);
    return p;
  }

  /** 删除单个备份。 */
  deleteBackup(name) {
    rmSync(this.#backupPath(name), { recursive: true, force: true });
    return { deleted: name };
  }

  /**
   * 打包备份为 zip 供下载(用 Windows 自带 bsdtar,零 npm 依赖)。
   * @returns {{fileName: string, data: Buffer}}
   */
  exportBackup(name) {
    this.#backupPath(name);
    // 显式用 System32 的 bsdtar:PATH 里可能排在前面的 GNU tar(Git Bash)不支持 .zip
    const tarBin = process.platform === 'win32'
      ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
    const tmp = join(tmpdir(), `noita-export-${name}-${process.pid}.zip`);
    try {
      // -a 按扩展名(.zip)自动选格式;-C 使包内路径以备份名开头
      execFileSync(tarBin, ['-a', '-c', '-f', tmp, '-C', this.backupsDir, name]);
      return { fileName: `${name}.zip`, data: readFileSync(tmp) };
    } catch (e) {
      throw new Error(`打包备份失败(需要 Windows 10+ 自带 tar): ${e.message}`);
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  /**
   * 原子地把 srcDir 拷成 destDir:先拷到同级临时目录,成功后再交换 ——
   * 避免"先删 destDir 再拷贝、中途失败导致 destDir 半毁"。destDir 已存在
   * 时旧内容移到 .old 暂存,交换成功后删除;交换失败则回滚。
   */
  #atomicReplaceDir(srcDir, destDir) {
    const staging = destDir + '.new';
    const old = destDir + '.old';
    rmSync(staging, { recursive: true, force: true });
    rmSync(old, { recursive: true, force: true });
    cpSync(srcDir, staging, { recursive: true }); // 失败时 destDir 原封不动
    if (existsSync(destDir)) renameSync(destDir, old);
    try {
      renameSync(staging, destDir);
    } catch (e) {
      if (existsSync(old) && !existsSync(destDir)) renameSync(old, destDir); // 回滚
      rmSync(staging, { recursive: true, force: true });
      throw e;
    }
    rmSync(old, { recursive: true, force: true });
  }

  /** 从备份恢复到工作区(恢复前自动备份当前工作区)。 */
  restore(backupName) {
    const src = this.#backupPath(backupName);
    return this.mutex.run(async () => {
      if (existsSync(this.saveDir)) this.backup(this.saveDir, 'prerestore');
      this.#atomicReplaceDir(src, this.saveDir);
      this.reload();
      return { restored: backupName };
    });
  }

  // ---- pull / push --------------------------------------------------------

  /** 实时档 → 工作区快照(拉取)。会丢弃当前工作区并重载缓冲。 */
  pull() {
    if (!existsSync(this.liveDir)) throw new Error(`实时档不存在: ${this.liveDir}`);
    return this.mutex.run(async () => {
      if (existsSync(this.saveDir)) this.backup(this.saveDir, 'prepull');
      this.#atomicReplaceDir(this.liveDir, this.saveDir);
      this.reload();
      return { from: this.liveDir, to: this.saveDir };
    });
  }

  /** 工作区快照 → 实时档(推送)。游戏运行中默认拒绝,force 才覆盖。 */
  push({ force = false } = {}) {
    if (this.isGameRunning() && !force) {
      throw new Error('检测到 Noita 正在运行;推送到实时档前请先关闭游戏(或 force)');
    }
    // 防误覆盖:实时档已存在、非空、又不含 player.xml(不像存档目录)时拒绝,
    // 避免把存档倒进 C:\Windows 这类被错配的路径(force 可显式绕过)。
    if (!force && !isSafePushTarget(this.liveDir)) {
      throw new Error(
        `实时档路径看起来不是存档目录(非空且无 player.xml),已拒绝覆盖: ${this.liveDir}`,
      );
    }
    return this.mutex.run(async () => {
      if (existsSync(this.liveDir)) this.backup(this.liveDir, 'live');
      cpSync(this.saveDir, this.liveDir, { recursive: true });
      return { from: this.saveDir, to: this.liveDir };
    });
  }

  // ---- 写入 ---------------------------------------------------------------

  /**
   * 提交所有 dirty 缓冲到工作区磁盘。两阶段,保证跨文件一致性:
   *   阶段一(不落盘):逐文件序列化 + 重解析深比对自检,任一失败即整体中止;
   *   阶段二(落盘):全部自检通过后,才逐文件 tmp→rename 原子替换并清 dirty。
   * 这样不会出现"player.xml 落了新数据、world_state.xml 还是旧的"的半提交。
   * @param {{skipBackup?: boolean}} [opts]
   */
  commit(opts = {}) {
    this.#ensureLoaded();
    return this.mutex.run(async () => {
      const targets = this.dirtyFiles();
      if (targets.length === 0) return { written: [], backup: null };

      // 阶段一:全部序列化 + 自检(纯内存,失败不留副作用)
      const prepared = [];
      for (const name of targets) {
        const buf = this.buffers.get(name);
        const text = serializeXml(buf.tree, { style: buf.style });
        const reparsed = parseXml(text);
        // 元素数一致 + 归一化深比对(捕获属性/文本级损坏,非仅结构)
        if (countElements(reparsed) !== countElements(buf.tree)
          || JSON.stringify(canonicalizeTree(reparsed)) !== JSON.stringify(canonicalizeTree(buf.tree))) {
          throw new Error(`写入自检失败(${name}):序列化前后内容不一致,已中止全部写入`);
        }
        prepared.push({ name, buf, text });
      }

      // 阶段一全部通过后才备份 + 落盘
      const backupName = opts.skipBackup ? null : this.backup(this.saveDir, 'edit');
      const written = [];
      for (const { name, buf, text } of prepared) {
        const dest = join(this.saveDir, name);
        const tmp = dest + '.tmp';
        writeFileSync(tmp, text, 'utf8');
        renameSync(tmp, dest);
        buf.dirty = false;
        written.push(name);
      }
      this.version++;
      return { written, backup: backupName };
    });
  }

  /**
   * 事务性缓冲修改:对涉及的受管文件先做快照,执行 fn;fn 抛错则原地回滚
   * 全部快照,杜绝"改到一半失败留下污染树、却因未 markDirty 而被后续 commit
   * 顺带写盘"的问题。fn 为同步函数(领域模型均同步改树)。
   * @template T
   * @param {string|string[]} fileNames 参与本次事务的受管文件
   * @param {() => T} fn
   * @returns {T}
   */
  mutate(fileNames, fn) {
    this.#ensureLoaded();
    const names = Array.isArray(fileNames) ? fileNames : [fileNames];
    const snaps = new Map();
    for (const name of names) {
      const buf = this.buffers.get(name);
      if (buf) snaps.set(name, structuredClone(buf.tree));
    }
    try {
      return fn();
    } catch (e) {
      for (const [name, snap] of snaps) {
        const buf = this.buffers.get(name);
        if (buf) {
          // 原地还原:保持数组引用不变(路由局部持有的 tree 引用同步复原)
          buf.tree.length = 0;
          buf.tree.push(...snap);
        }
      }
      throw e;
    }
  }

  /** 丢弃内存改动,重新读盘。 */
  discard() {
    return this.reload();
  }

  // ---- 路径配置(功能③) ------------------------------------------------------

  /**
   * 切换存档/实时路径。存档路径要求目录存在且含 player.xml;
   * 编辑缓冲有未保存更改时拒绝(error.requiresForce = true),force 才切换。
   * 存档路径变化会丢弃缓冲并重新读盘;实时路径变化仅更新引用。
   */
  setPaths({ saveDir, liveDir, force = false } = {}) {
    const nextSave = saveDir === undefined || saveDir === '' ? undefined : String(saveDir);
    const nextLive = liveDir === undefined || liveDir === '' ? undefined : String(liveDir);
    const changingSave = nextSave !== undefined && nextSave !== this.saveDir;
    const changingLive = nextLive !== undefined && nextLive !== this.liveDir;

    if (changingSave) {
      if (!existsSync(nextSave) || !statSync(nextSave).isDirectory()) {
        throw new Error(`存档目录不存在: ${nextSave}`);
      }
      if (!existsSync(join(nextSave, 'player.xml'))) {
        throw new Error(`目录里没有 player.xml,不是有效的 save00: ${nextSave}`);
      }
      this.#ensureLoaded();
      if (this.dirty && !force) {
        const e = new Error('编辑缓冲有未保存更改;切换存档路径会丢弃这些更改,请确认(force)后重试');
        e.requiresForce = true;
        throw e;
      }
      this.saveDir = nextSave;
    }
    if (changingLive) {
      // 实时档是 push 的覆盖目标:若指向一个已存在、非空、又不像存档目录的
      // 路径(如误填 C:\Windows),提前拒绝,避免 push 时酿成灾难性覆盖。
      if (existsSync(nextLive) && !statSync(nextLive).isDirectory()) {
        throw new Error(`实时档路径不是目录: ${nextLive}`);
      }
      if (!isSafePushTarget(nextLive)) {
        throw new Error(`实时档路径看起来不是存档目录(非空且无 player.xml): ${nextLive}`);
      }
      this.liveDir = nextLive;
    }
    if (changingSave) this.reload();
    return {
      changed: changingSave || changingLive,
      saveDir: this.saveDir,
      liveDir: this.liveDir,
    };
  }

  // ---- 状态 ---------------------------------------------------------------

  status() {
    this.#ensureLoaded();
    const backups = this.listBackups();
    return {
      saveDir: this.saveDir,
      liveDir: this.liveDir,
      liveExists: existsSync(this.liveDir),
      gameRunning: this.isGameRunning(),
      dirty: this.dirty,
      dirtyFiles: this.dirtyFiles(),
      version: this.version,
      managedFiles: [...this.buffers.keys()],
      backups: backups.slice(0, 5),
      backupsTotal: backups.length,
    };
  }
}

export const saveManager = new SaveManager();
