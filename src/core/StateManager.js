/**
 * 状态管理器
 * 管理游戏运行时状态、快照保存和回滚
 */

import { GameSystem } from './GameEngine.js';

export class StateManager extends GameSystem {
  constructor() {
    super('StateManager');

    /** @type {object|null} 当前游戏状态 */
    this.state = null;

    /** @type {Array} 状态快照栈（用于撤销） */
    this.snapshots = [];

    /** @type {number} 最大快照数量 */
    this.maxSnapshots = 20;

    /** @type {Set<Function>} 状态变更监听器 */
    this.listeners = new Set();

    /** @type {boolean} 是否有未保存的变更 */
    this.dirty = false;
  }

  /**
   * 设置游戏状态
   * @param {object} state - 完整的游戏状态对象
   */
  setState(state) {
    this.state = state;
    this.dirty = true;
    this.notifyListeners('set', null);
  }

  /**
   * 获取当前游戏状态
   * @returns {object|null}
   */
  getState() {
    return this.state;
  }

  /**
   * 更新状态的某个路径
   * @param {string} path - 点分隔的路径，如 'activeCharacters.0.stats.hpCurrent'
   * @param {*} value - 新值
   */
  updateState(path, value) {
    if (!this.state) return;

    const keys = path.split('.');
    let current = this.state;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = isNaN(keys[i]) ? keys[i] : parseInt(keys[i]);
      if (current[key] === undefined) return;
      current = current[key];
    }

    const lastKey = isNaN(keys[keys.length - 1])
      ? keys[keys.length - 1]
      : parseInt(keys[keys.length - 1]);

    const oldValue = current[lastKey];
    current[lastKey] = value;
    this.dirty = true;

    this.notifyListeners('update', { path, oldValue, newValue: value });
  }

  /**
   * 保存当前状态快照
   */
  saveSnapshot() {
    if (!this.state) return;

    const snapshot = JSON.parse(JSON.stringify(this.state));
    this.snapshots.push(snapshot);

    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  /**
   * 回滚到上一个快照
   * @returns {boolean} 是否回滚成功
   */
  rollback() {
    if (this.snapshots.length === 0) return false;

    this.state = this.snapshots.pop();
    this.dirty = true;
    this.notifyListeners('rollback', null);
    return true;
  }

  /**
   * 序列化状态为JSON字符串
   * @returns {string}
   */
  serialize() {
    return JSON.stringify(this.state);
  }

  /**
   * 从JSON字符串恢复状态
   * @param {string} json - JSON字符串
   */
  deserialize(json) {
    try {
      this.state = JSON.parse(json);
      this.dirty = false;
      this.notifyListeners('deserialize', null);
      return true;
    } catch (e) {
      console.error('状态反序列化失败:', e);
      return false;
    }
  }

  /**
   * 保存到localStorage
   * @param {string} key - 存储键名
   */
  saveToLocal(key = 'trpg_save') {
    if (!this.state) return false;
    try {
      localStorage.setItem(key, this.serialize());
      this.dirty = false;
      return true;
    } catch (e) {
      console.error('保存到本地存储失败:', e);
      return false;
    }
  }

  /**
   * 从localStorage加载
   * @param {string} key - 存储键名
   * @returns {object|null} 加载成功返回状态对象，失败返回null
   */
  loadFromLocal(key = 'trpg_save') {
    try {
      const json = localStorage.getItem(key);
      if (!json) return null;
      const data = JSON.parse(json);
      this.state = data;
      this.dirty = false;
      this.notifyListeners('deserialize', null);
      return data;
    } catch (e) {
      console.error('从本地存储加载失败:', e);
      return null;
    }
  }

  // ==================== 多槽位存档 API ====================

  /**
   * 内部：存档槽索引 key
   * 槽位元数据存储格式: { [slotId]: { name, savedAt, meta } }
   */
  _slotsIndexKey() { return 'trpg_slots_v2_index'; }
  _slotDataKey(slotId) { return `trpg_slots_v2_${slotId}`; }

  /** 读取存档槽位索引 */
  _readSlotsIndex() {
    try {
      const json = localStorage.getItem(this._slotsIndexKey());
      return json ? JSON.parse(json) : {};
    } catch (e) {
      return {};
    }
  }

  /** 写入存档槽位索引 */
  _writeSlotsIndex(index) {
    try {
      localStorage.setItem(this._slotsIndexKey(), JSON.stringify(index));
    } catch (e) {
      console.error('写入存档索引失败:', e);
    }
  }

  /**
   * 保存当前状态到指定槽位
   * @param {string} slotId - 槽位 ID (auto/slot1/slot2/slot3 ...)
   * @param {string} [name] - 用户可读名称
   * @param {string} [presetJson] - 同时保存预设 JSON 字符串以便完整恢复
   * @returns {boolean}
   */
  saveToSlot(slotId, name, presetJson) {
    if (!this.state || !slotId) return false;
    try {
      const payload = {
        version: 'v2',
        savedAt: new Date().toISOString(),
        state: this.state,
        preset: presetJson || null,
      };
      localStorage.setItem(this._slotDataKey(slotId), JSON.stringify(payload));

      // 解析 preset 以便把当前场景名 / 总场景数写进 meta（不依赖 preset 也要能存）
      let presetData = null;
      if (presetJson) {
        try { presetData = JSON.parse(presetJson); } catch { /* */ }
      }

      // 更新索引
      const index = this._readSlotsIndex();
      index[slotId] = {
        name: name || index[slotId]?.name || slotId,
        savedAt: payload.savedAt,
        meta: this._extractStateMeta(this.state, presetData),
      };
      this._writeSlotsIndex(index);

      this.dirty = false;
      return true;
    } catch (e) {
      console.error('保存槽位失败:', e);
      return false;
    }
  }

  /**
   * 从指定槽位加载
   * @returns {{state, preset}|null}
   */
  loadFromSlot(slotId) {
    try {
      const json = localStorage.getItem(this._slotDataKey(slotId));
      if (!json) return null;
      const payload = JSON.parse(json);
      this.state = payload.state;
      this.dirty = false;
      this.notifyListeners('deserialize', null);
      return { state: payload.state, preset: payload.preset || null };
    } catch (e) {
      console.error('加载槽位失败:', e);
      return null;
    }
  }

  /**
   * 列出所有槽位的元数据
   * @returns {Array<{id, name, savedAt, meta}>}
   */
  listSlots() {
    const index = this._readSlotsIndex();
    return Object.entries(index).map(([id, info]) => ({ id, ...info }));
  }

  /** 删除指定槽位 */
  deleteSlot(slotId) {
    try {
      localStorage.removeItem(this._slotDataKey(slotId));
      const index = this._readSlotsIndex();
      delete index[slotId];
      this._writeSlotsIndex(index);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 从游戏状态中提取关键展示信息
   * @param {object} state
   */
  _extractStateMeta(state, preset = null) {
    if (!state) return {};
    const chars = state.activeCharacters || [];
    const mapState = state.mapState || {};

    // 把场景名 / 已访问/总场景数从 preset 解析出来
    let currentSceneName = null;
    let visitedSceneCount = 0;
    let totalSceneCount = 0;
    if (preset && Array.isArray(preset.scenes) && preset.scenes.length > 0) {
      totalSceneCount = preset.scenes.length;
      visitedSceneCount = (mapState.visitedSceneIds || []).length;
      const currentSceneId = mapState.currentSceneId;
      if (currentSceneId) {
        const cur = preset.scenes.find(s => s.id === currentSceneId);
        if (cur) currentSceneName = `${cur.icon || '📍'} ${cur.name}`;
      }
    }

    // 把章节 ID 转成 preset 里的事件名（更友好）
    const lastChapterId = (state.completedEventIds || []).filter(id => id.startsWith('ch')).pop() || null;
    let lastChapterLabel = lastChapterId;
    if (preset && lastChapterId && Array.isArray(preset.events)) {
      const ev = preset.events.find(e => e.id === lastChapterId);
      if (ev) lastChapterLabel = ev.name;
    }

    return {
      turnNumber: state.turnNumber || 1,
      phase: state.currentPhase || 'exploration',
      partySize: chars.length,
      partyHpSummary: chars.map(c => `${c.name}:${c.stats?.hpCurrent ?? 0}/${c.stats?.hp ?? 0}`).join(' '),
      chaptersCompleted: (state.completedEventIds || []).filter(id => id.startsWith('ch')).length,
      lastChapter: lastChapterId,
      lastChapterLabel,
      gold: state.gold || 0,
      // 场景图模式
      currentSceneId: mapState.currentSceneId || null,
      currentSceneName,
      visitedSceneCount,
      totalSceneCount,
      // 旧格子模式（兼容）
      playerPosition: mapState.playerPosition || null,
    };
  }

  /**
   * 添加状态变更监听器
   * @param {Function} listener - 监听函数，接收(changeType, detail)
   * @returns {Function} 取消监听的函数
   */
  addListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 通知所有监听器 */
  notifyListeners(changeType, detail) {
    for (const listener of this.listeners) {
      try {
        listener(changeType, detail);
      } catch (e) {
        console.error('状态监听器执行错误:', e);
      }
    }
  }

  /** 检查是否有未保存变更 */
  isDirty() {
    return this.dirty;
  }

  /** 清除所有快照 */
  clearSnapshots() {
    this.snapshots = [];
  }

  /** 销毁 */
  destroy() {
    this.state = null;
    this.snapshots = [];
    this.listeners.clear();
    super.destroy();
  }
}
