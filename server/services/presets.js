// 预设持久化服务(§20):坐标 / 天赋 / 法杖三类可复用预设。
//
// 与存档缓冲无关的 app 级持久化,独立文件 presets.json(不塞进 config.local.json,
// 避免大体量法杖数据混入),路径仿 backupsDir 派生自 dataDir —— 开发=仓库根、
// 打包=Electron userData。原子写(tmp→rename);坏文件降级空、坏项跳过。
//
// 本服务只管持久化与 CRUD;把某支杖/某组天赋读成结构化预设的逻辑在 routes/presets.js
// (需要 save 领域模型),两者解耦。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { config } from '../config.js';

export const CATEGORIES = ['locations', 'perks', 'wands'];

/** 空结构:三类各一个数组。 */
function emptyData() {
  return { locations: [], perks: [], wands: [] };
}

/**
 * 宽松清洗:确保三个数组存在;逐项要求是对象,补全 id、规整 tags 为数组。
 * 用户手改 presets.json 时坏项跳过、缺 id 就地补 UUID(不落盘,除非后续有写)。
 */
function sanitize(raw) {
  const out = emptyData();
  if (!raw || typeof raw !== 'object') return out;
  for (const cat of CATEGORIES) {
    if (!Array.isArray(raw[cat])) continue;
    for (const it of raw[cat]) {
      if (!it || typeof it !== 'object') continue;
      out[cat].push({
        ...it,
        id: typeof it.id === 'string' && it.id ? it.id : randomUUID(),
        tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
      });
    }
  }
  return out;
}

export class PresetStore {
  constructor(filePath = join(config.dataDir, 'presets.json')) {
    this.filePath = filePath;
    /** @type {{locations: object[], perks: object[], wands: object[]} | null} */
    this._data = null;
  }

  /** 惰性读盘并缓存;坏文件降级空结构。 */
  #ensure() {
    if (this._data) return this._data;
    try {
      this._data = sanitize(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      this._data = emptyData();
    }
    return this._data;
  }

  /** 丢弃内存缓存,下次访问重新读盘(测试用)。 */
  reload() {
    this._data = null;
    return this;
  }

  #persist() {
    mkdirSync(join(this.filePath, '..'), { recursive: true });
    const tmp = this.filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(this._data, null, 2) + '\n', 'utf8');
    renameSync(tmp, this.filePath);
  }

  #assertCategory(category) {
    if (!CATEGORIES.includes(category)) {
      throw new Error(`未知预设分类: ${category}(可选 ${CATEGORIES.join('/')})`);
    }
  }

  /** 全量:{locations, perks, wands}。 */
  all() {
    return this.#ensure();
  }

  /** 新建一条预设(item 已由路由组装好领域字段);补 id/tags/createdAt 后落盘。 */
  create(category, item) {
    this.#assertCategory(category);
    const data = this.#ensure();
    // 领域字段先铺开,再用规整后的 id/label/tags/createdAt 覆盖(不被 item 原值反噬)
    const entry = {
      ...item,
      id: randomUUID(),
      label: String(item.label ?? '').trim(),
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      createdAt: new Date().toISOString(),
    };
    if (!entry.label) throw new Error('预设名称不能为空');
    data[category].push(entry);
    this.#persist();
    return entry;
  }

  #find(category, id) {
    this.#assertCategory(category);
    const entry = this.#ensure()[category].find((x) => x.id === id);
    if (!entry) throw new Error(`预设不存在: ${category}/${id}`);
    return entry;
  }

  /** 改标签(所有类);坐标类另可改 x/y。其余领域字段不经此端点改。 */
  update(category, id, patch = {}) {
    const entry = this.#find(category, id);
    if (patch.label !== undefined) {
      const label = String(patch.label).trim();
      if (!label) throw new Error('预设名称不能为空');
      entry.label = label;
    }
    if (patch.tags !== undefined) {
      entry.tags = Array.isArray(patch.tags) ? patch.tags.map(String) : [];
    }
    if (category === 'locations') {
      if (patch.x !== undefined) entry.x = String(patch.x);
      if (patch.y !== undefined) entry.y = String(patch.y);
    }
    this.#persist();
    return entry;
  }

  /** 删除一条。 */
  remove(category, id) {
    this.#assertCategory(category);
    const data = this.#ensure();
    const i = data[category].findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`预设不存在: ${category}/${id}`);
    const [removed] = data[category].splice(i, 1);
    this.#persist();
    return { removed: removed.id };
  }
}

export const presets = new PresetStore();
