/**
 * 记忆系统
 * 维护分层 AI 长期记忆：World Facts (永久) + Key Events (滚动)
 * 数据持久化在 GameState.aiContext 上，跟随存档
 *
 * 容量策略：
 * - World Facts 无限增长（条目精简）
 * - Key Events 保留最近 20 条，超出时把最早 5 条归档到 World Facts
 */

import { GameSystem } from '../core/GameEngine.js';

const KEY_EVENT_LIMIT = 20;
const ARCHIVE_BATCH = 5;
const MAX_FACT_LENGTH = 120;

export class MemorySystem extends GameSystem {
  constructor() {
    super('MemorySystem');
    this.eventSystem = null;
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.eventSystem = gameEngine.getSystem('EventSystem');
  }

  /**
   * 确保 gameState.aiContext 有 memory 字段（用于旧存档迁移）
   */
  _ensureMemoryFields(gameState) {
    if (!gameState.aiContext) gameState.aiContext = {};
    if (!Array.isArray(gameState.aiContext.worldFacts)) gameState.aiContext.worldFacts = [];
    if (!Array.isArray(gameState.aiContext.keyEvents)) gameState.aiContext.keyEvents = [];
  }

  /**
   * 从预设初始化世界观事实
   * @param {object} gameState
   * @param {object} preset - GamePreset
   */
  initializeFromPreset(gameState, preset) {
    this._ensureMemoryFields(gameState);

    const facts = [];
    if (preset.lore) {
      const { worldName, era, background, rules, gmStyle } = preset.lore;
      if (worldName) facts.push(`世界：${worldName}${era ? `（${era}）` : ''}`);
      if (background) facts.push(`背景：${this._truncate(background, MAX_FACT_LENGTH)}`);
      if (rules) facts.push(`规则：${this._truncate(rules, MAX_FACT_LENGTH)}`);
      if (gmStyle) facts.push(`GM 风格：${this._truncate(gmStyle, MAX_FACT_LENGTH)}`);
    }

    // 角色身份
    if (preset.characters && preset.characters.length > 0) {
      const partyDesc = preset.characters
        .map(c => `${c.name}${c.title ? `(${c.title})` : ''}`)
        .join('、');
      facts.push(`队伍成员：${partyDesc}`);
    }

    // 合并去重
    for (const fact of facts) {
      if (!gameState.aiContext.worldFacts.includes(fact)) {
        gameState.aiContext.worldFacts.push(fact);
      }
    }
  }

  /**
   * 加入一条 World Fact（不变事实）
   */
  addWorldFact(gameState, text) {
    if (!text) return;
    this._ensureMemoryFields(gameState);
    const trimmed = this._truncate(text, MAX_FACT_LENGTH);
    if (!gameState.aiContext.worldFacts.includes(trimmed)) {
      gameState.aiContext.worldFacts.push(trimmed);
    }
  }

  /**
   * 加入一条 Key Event（关键事件）
   * 容量满时把最早 5 条归档到 World Facts
   * @param {object} gameState
   * @param {{summary, tags?}} entry
   */
  addKeyEvent(gameState, entry) {
    this._ensureMemoryFields(gameState);
    if (!entry || !entry.summary) return;
    const record = {
      ts: new Date().toISOString(),
      summary: this._truncate(entry.summary, MAX_FACT_LENGTH),
      tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 4) : [],
    };
    gameState.aiContext.keyEvents.push(record);

    // 超出容量 → 归档最早一批到 World Facts
    if (gameState.aiContext.keyEvents.length > KEY_EVENT_LIMIT) {
      const archived = gameState.aiContext.keyEvents.splice(0, ARCHIVE_BATCH);
      const archiveLine = `早期事件：${archived.map(e => e.summary).join('；')}`;
      this.addWorldFact(gameState, this._truncate(archiveLine, MAX_FACT_LENGTH * 2));
    }

    if (this.eventSystem) {
      this.eventSystem.publish('memory:keyEventAdded', { record });
    }
  }

  /**
   * 获取当前记忆视图（供 AIPromptBuilder 注入到 prompt）
   * @returns {{worldFacts: string[], keyEvents: string[]}}
   */
  getMemoryView(gameState, options = {}) {
    this._ensureMemoryFields(gameState);
    const worldFactLimit = Number.isFinite(options.worldFactLimit) ? options.worldFactLimit : 12;
    const keyEventLimit = Number.isFinite(options.keyEventLimit) ? options.keyEventLimit : 12;
    return {
      worldFacts: gameState.aiContext.worldFacts.slice(-worldFactLimit),
      keyEvents: gameState.aiContext.keyEvents.slice(-keyEventLimit).map(e => e.summary),
    };
  }

  /** 重置（清空所有记忆，谨慎使用） */
  reset(gameState) {
    if (!gameState.aiContext) gameState.aiContext = {};
    gameState.aiContext.worldFacts = [];
    gameState.aiContext.keyEvents = [];
  }

  _truncate(text, maxLen) {
    const s = String(text || '').trim();
    return s.length <= maxLen ? s : s.substring(0, maxLen - 1) + '…';
  }

  destroy() {
    this.eventSystem = null;
    super.destroy();
  }
}
