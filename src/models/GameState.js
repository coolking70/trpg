/**
 * 游戏运行时状态容器
 * 保存游戏进行中的所有动态数据
 */

import { generateId } from '../utils/idGenerator.js';
import { deepClone } from '../utils/deepClone.js';

export class GameState {
  constructor(data = {}) {
    this.gameId = data.gameId || generateId('game');
    this.presetId = data.presetId || '';
    this.startedAt = data.startedAt || new Date().toISOString();
    this.lastSavedAt = data.lastSavedAt || null;

    // 回合信息
    this.turnNumber = data.turnNumber || 1;
    // exploration | event | combat | rest
    this.currentPhase = data.currentPhase || 'exploration';

    // 活跃角色（带运行时状态的CharacterCard数据）
    this.activeCharacters = [...(data.activeCharacters || [])];

    // 当前战斗状态
    this.activeCombat = data.activeCombat || null;
    // 示例: { enemies: [...], turnOrder: [...], round: 1, currentActorIndex: 0 }

    // 当前活跃事件
    this.activeEvent = data.activeEvent || null;

    // 地图状态
    this.mapState = {
      playerPosition: { x: 0, y: 0 },
      revealedTiles: [],    // "x,y" 格式字符串数组
      visitedTiles: [],     // "x,y" 格式字符串数组
      ...(data.mapState || {}),
    };

    // 已完成的事件ID列表
    this.completedEventIds = [...(data.completedEventIds || [])];

    // 叙事日志
    this.narrativeLog = [...(data.narrativeLog || [])];

    // AI上下文（仅保存用于断点续传）
    this.aiContext = {
      recentMessages: [],
      summaryCache: '',
      tokenBudget: { used: 0, limit: 4000 },
      ...(data.aiContext || {}),
    };

    // 骰子历史
    this.diceHistory = [...(data.diceHistory || [])];

    // 全局变量（事件系统可读写的键值对）
    this.variables = { ...(data.variables || {}) };

    // 队伍共享金币
    this.gold = data.gold !== undefined ? data.gold : 0;
  }

  /**
   * 添加叙事日志
   * @param {string} speaker - 发言者 ('gm' | 'player' | 'system')
   * @param {string} text - 文本内容
   */
  addNarrative(speaker, text) {
    this.narrativeLog.push({
      timestamp: new Date().toISOString(),
      speaker,
      text,
    });
  }

  /**
   * 添加骰子记录
   * @param {object} diceResult
   */
  addDiceResult(diceResult) {
    this.diceHistory.push({
      ...diceResult,
      turn: this.turnNumber,
    });
  }

  /**
   * 标记事件为已完成
   * @param {string} eventId
   */
  completeEvent(eventId) {
    if (!this.completedEventIds.includes(eventId)) {
      this.completedEventIds.push(eventId);
    }
  }

  /**
   * 获取事件的完成次数
   * @param {string} eventId
   * @returns {number}
   */
  getEventCompletionCount(eventId) {
    return this.completedEventIds.filter(id => id === eventId).length;
  }

  /**
   * 揭示地图格子
   * @param {number} x
   * @param {number} y
   */
  revealTile(x, y) {
    const key = `${x},${y}`;
    if (!this.mapState.revealedTiles.includes(key)) {
      this.mapState.revealedTiles.push(key);
    }
  }

  /**
   * 揭示以指定点为中心的区域
   * @param {number} cx
   * @param {number} cy
   * @param {number} radius
   */
  revealArea(cx, cy, radius) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        // 使用圆形范围
        if (dx * dx + dy * dy <= radius * radius) {
          this.revealTile(cx + dx, cy + dy);
        }
      }
    }
  }

  /**
   * 检查格子是否已揭示
   */
  isTileRevealed(x, y) {
    return this.mapState.revealedTiles.includes(`${x},${y}`);
  }

  /**
   * 从预设创建初始游戏状态
   * @param {object} preset - GamePreset数据
   * @returns {GameState}
   */
  static fromPreset(preset) {
    const state = new GameState({
      presetId: preset.presetId || preset.id || '',
      gold: (preset.rules && preset.rules.startingGold) || 0,
    });

    // 复制角色卡数据
    state.activeCharacters = (preset.characters || []).map(c => deepClone(c));

    // 设置起始位置
    if (preset.map) {
      const mapData = preset.map;
      // 查找起点
      let spawnX = 0, spawnY = 0;
      const spawn = (mapData.pointsOfInterest || []).find(p => p.type === 'spawn');
      if (spawn) {
        spawnX = spawn.x;
        spawnY = spawn.y;
      } else if (mapData.grid) {
        outer: for (let y = 0; y < mapData.grid.length; y++) {
          for (let x = 0; x < mapData.grid[y].length; x++) {
            if (mapData.grid[y][x] === 'S') {
              spawnX = x;
              spawnY = y;
              break outer;
            }
          }
        }
      }

      state.mapState.playerPosition = { x: spawnX, y: spawnY };

      // 揭示起始区域
      const radius = mapData.revealRadius || 3;
      state.revealArea(spawnX, spawnY, radius);
    }

    return state;
  }

  clone() {
    return new GameState(this.toJSON());
  }

  toJSON() {
    return deepClone({
      gameId: this.gameId,
      presetId: this.presetId,
      startedAt: this.startedAt,
      lastSavedAt: this.lastSavedAt,
      turnNumber: this.turnNumber,
      currentPhase: this.currentPhase,
      activeCharacters: this.activeCharacters,
      activeCombat: this.activeCombat,
      activeEvent: this.activeEvent,
      mapState: this.mapState,
      completedEventIds: this.completedEventIds,
      narrativeLog: this.narrativeLog,
      aiContext: this.aiContext,
      diceHistory: this.diceHistory,
      variables: this.variables,
      gold: this.gold,
    });
  }

  static fromJSON(json) {
    return new GameState(json);
  }
}
