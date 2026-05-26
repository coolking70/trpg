/**
 * 元进度（Phase 23A / Phase 24 预留）
 *
 * 跨周目持久数据：图鉴收集 / 解锁状态 / 总游玩时长。
 * 与单局存档分开 — 新游戏不会清空，玩家重玩永远累积。
 *
 * 数据结构：
 *   {
 *     runCount: 0,                       // 通关次数（含主线完成 + 全队倒下）
 *     completedRuns: 0,                  // 完整通关（ending 触发）次数
 *     totalPlayTimeSeconds: 0,
 *     discoveredScenes: ['scene_a', ...],
 *     discoveredEvents: ['ch1_start', ...],
 *     discoveredNpcs: ['npc_x', ...],
 *     discoveredEndings: ['ending_redeemed', 'ending_default', ...],
 *     unlockedRaces: ['human', 'elf'],      // 部分种族要解锁
 *     unlockedOrigins: [...],
 *     unlockedBackgrounds: [...],
 *     unlockedFaiths: [...],
 *     achievements: { 'killed_lich': true, ... },
 *   }
 *
 * 每个 preset 独立元进度（按 presetId 分 key）— 不同剧本各算各的。
 */

import { IndexedDBStore } from './IndexedDBStore.js';

const LS_PREFIX = 'trpg_meta_';   // localStorage 兜底前缀

function emptyMeta() {
  return {
    runCount: 0,
    completedRuns: 0,
    totalPlayTimeSeconds: 0,
    discoveredScenes: [],
    discoveredEvents: [],
    discoveredNpcs: [],
    discoveredEndings: [],
    unlockedRaces: [],
    unlockedOrigins: [],
    unlockedBackgrounds: [],
    unlockedFaiths: [],
    achievements: {},
  };
}

class MetaProgressionImpl {
  constructor() {
    this.idbStore = IndexedDBStore.isAvailable() ? new IndexedDBStore('meta') : null;
    this._cache = new Map();   // presetId → 内存缓存
  }

  /**
   * 加载预设的元进度（无则返回空骨架）
   */
  async load(presetId) {
    if (!presetId) return emptyMeta();
    if (this._cache.has(presetId)) return this._cache.get(presetId);

    let data = null;
    if (this.idbStore) {
      data = await this.idbStore.get(presetId);
    }
    if (!data) {
      try {
        const raw = localStorage.getItem(LS_PREFIX + presetId);
        if (raw) data = JSON.parse(raw);
      } catch { /* */ }
    }
    const merged = { ...emptyMeta(), ...(data || {}) };
    this._cache.set(presetId, merged);
    return merged;
  }

  /**
   * 保存元进度（同时写 IDB 和 LS 兜底）
   */
  async save(presetId, meta) {
    if (!presetId) return;
    this._cache.set(presetId, meta);
    if (this.idbStore) await this.idbStore.put(presetId, meta);
    try { localStorage.setItem(LS_PREFIX + presetId, JSON.stringify(meta)); } catch { /* */ }
  }

  /**
   * 应用一局游戏的成果（增量更新）
   * @param {string} presetId
   * @param {object} runStats - { scenes: [], events: [], npcs: [], ending: 'xxx', completed: bool, playTimeSeconds }
   */
  async commitRun(presetId, runStats) {
    const meta = await this.load(presetId);
    meta.runCount = (meta.runCount || 0) + 1;
    if (runStats.completed) meta.completedRuns = (meta.completedRuns || 0) + 1;
    meta.totalPlayTimeSeconds = (meta.totalPlayTimeSeconds || 0) + (runStats.playTimeSeconds || 0);

    const merge = (arr, items) => {
      const set = new Set(arr);
      for (const x of (items || [])) set.add(x);
      return [...set];
    };
    meta.discoveredScenes = merge(meta.discoveredScenes, runStats.scenes);
    meta.discoveredEvents = merge(meta.discoveredEvents, runStats.events);
    meta.discoveredNpcs   = merge(meta.discoveredNpcs,   runStats.npcs);
    if (runStats.ending) {
      meta.discoveredEndings = merge(meta.discoveredEndings, [runStats.ending]);
    }

    await this.save(presetId, meta);
    return meta;
  }

  /** 检查某 race/origin/... 是否解锁（默认未解锁的视为锁定，由 preset.startingOptions 标注 lockedBy） */
  isUnlocked(meta, axis, optionId, defaultUnlocked = true) {
    const arr = meta[`unlocked${axis}`] || [];
    if (arr.includes(optionId)) return true;
    return defaultUnlocked;
  }

  /** 手动解锁某个选项 */
  async unlock(presetId, axis, optionId) {
    const meta = await this.load(presetId);
    const key = `unlocked${axis}`;
    meta[key] = [...new Set([...(meta[key] || []), optionId])];
    await this.save(presetId, meta);
  }

  /** 清空（开发/调试用） */
  async clear(presetId) {
    this._cache.delete(presetId);
    if (this.idbStore) await this.idbStore.delete(presetId);
    try { localStorage.removeItem(LS_PREFIX + presetId); } catch { /* */ }
  }
}

export const metaProgression = new MetaProgressionImpl();
export { MetaProgressionImpl };
