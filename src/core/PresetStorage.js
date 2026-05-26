/**
 * 预设存储层（Phase 23A）
 *
 * 解决：300+ 节点剧本的 preset JSON 可能 2-5 MB，单 localStorage 装一两个就爆
 *
 * 策略：
 *   - IndexedDB 可用 → 主存 IDB，索引（id/name/size/mtime）镜像在 localStorage（同步读）
 *   - IndexedDB 不可用 → 完全用 localStorage（保留旧行为）
 *
 * API 全部异步（即使走 localStorage 也包装成 Promise），调用方一律 await。
 */

import { IndexedDBStore } from './IndexedDBStore.js';

const LS_INDEX_KEY = 'trpg_preset_index';        // localStorage 索引
const LS_PREFIX = 'trpg_preset:';                 // localStorage 数据前缀（无 IDB 时用）
const LS_CURRENT_KEY = 'trpg_current_preset';     // 旧的"当前预设"键

const SIZE_THRESHOLD_LS = 1024 * 1024;            // >1MB 强制走 IDB（即使能塞 localStorage）

class PresetStorageImpl {
  constructor() {
    this.idbAvailable = IndexedDBStore.isAvailable();
    this.idbStore = this.idbAvailable ? new IndexedDBStore('presets') : null;
    this._indexCache = null;
  }

  /** 读 LS 索引（同步） */
  _readIndex() {
    if (this._indexCache) return this._indexCache;
    try {
      const raw = localStorage.getItem(LS_INDEX_KEY);
      this._indexCache = raw ? JSON.parse(raw) : {};
    } catch { this._indexCache = {}; }
    return this._indexCache;
  }

  _writeIndex(idx) {
    this._indexCache = idx;
    try { localStorage.setItem(LS_INDEX_KEY, JSON.stringify(idx)); } catch { /* */ }
  }

  /** 列出已保存的预设（同步，仅返回元数据） */
  listSync() {
    const idx = this._readIndex();
    return Object.entries(idx).map(([id, meta]) => ({ id, ...meta }));
  }

  /** 保存一个预设 */
  async save(preset) {
    if (!preset || !preset.presetId) throw new Error('preset 必须有 presetId');
    const id = preset.presetId;
    const json = JSON.stringify(preset);
    const size = new Blob([json]).size;

    let storage = 'ls';
    if (this.idbStore && (size > SIZE_THRESHOLD_LS || size > 4 * 1024 * 1024)) {
      // 大预设走 IDB
      await this.idbStore.put(id, preset);
      storage = 'idb';
      try { localStorage.removeItem(LS_PREFIX + id); } catch { /* */ }
    } else if (this.idbStore) {
      // 中小预设也走 IDB（统一管理，避免迁移问题）
      await this.idbStore.put(id, preset);
      storage = 'idb';
      try { localStorage.removeItem(LS_PREFIX + id); } catch { /* */ }
    } else {
      // 无 IDB 兜底 LS
      try { localStorage.setItem(LS_PREFIX + id, json); } catch (e) {
        throw new Error(`预设过大无法存入 localStorage（${(size/1024).toFixed(0)}KB）：${e.message}`);
      }
    }

    // 写索引
    const idx = this._readIndex();
    idx[id] = {
      name: preset.name || '未命名',
      author: preset.author || '',
      sceneCount: (preset.scenes || []).length,
      eventCount: (preset.events || []).length,
      size,
      mtime: Date.now(),
      storage,
    };
    this._writeIndex(idx);
    return { id, size, storage };
  }

  /** 读取某个预设 */
  async load(id) {
    if (!id) return null;
    const idx = this._readIndex();
    const meta = idx[id];
    if (meta?.storage === 'idb' && this.idbStore) {
      return await this.idbStore.get(id);
    }
    // 尝试 LS
    try {
      const raw = localStorage.getItem(LS_PREFIX + id);
      if (raw) return JSON.parse(raw);
    } catch { /* */ }
    // 兜底：尝试 IDB（旧数据可能没索引）
    if (this.idbStore) return await this.idbStore.get(id);
    return null;
  }

  /** 删除一个预设 */
  async delete(id) {
    const idx = this._readIndex();
    delete idx[id];
    this._writeIndex(idx);
    if (this.idbStore) await this.idbStore.delete(id);
    try { localStorage.removeItem(LS_PREFIX + id); } catch { /* */ }
    return true;
  }

  /**
   * 取"上次加载的预设"（兼容旧 trpg_current_preset key）
   * 优先级：IDB current key → LS current key（旧）
   */
  async loadCurrent() {
    if (this.idbStore) {
      const v = await this.idbStore.get('__current__');
      if (v) return v;
    }
    try {
      const raw = localStorage.getItem(LS_CURRENT_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* */ }
    return null;
  }

  /** 写"当前预设"快照（同时清理旧 LS key 节省空间） */
  async saveCurrent(preset) {
    if (!preset) return;
    if (this.idbStore) {
      await this.idbStore.put('__current__', preset);
      // 清掉旧的 LS 副本（大预设可能塞不下也会失败 — 静默忽略）
      try { localStorage.removeItem(LS_CURRENT_KEY); } catch { /* */ }
    } else {
      try { localStorage.setItem(LS_CURRENT_KEY, JSON.stringify(preset)); } catch { /* */ }
    }
  }
}

// 单例
export const presetStorage = new PresetStorageImpl();

// 直接 export 类用于测试
export { PresetStorageImpl };
