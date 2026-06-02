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

    // 当前军团战状态（Phase 31，与 activeCombat 互斥；单位栈战术制）
    this.activeLegionBattle = data.activeLegionBattle || null;

    // 战略层状态（Phase 33，内政外交；无战略剧本为 null）
    this.strategicState = data.strategicState || null;

    // 当前活跃事件
    this.activeEvent = data.activeEvent || null;

    // 地图状态
    this.mapState = {
      playerPosition: { x: 0, y: 0 },
      revealedTiles: [],         // "x,y" 格式字符串数组（旧格子模式）
      visitedTiles: [],          // "x,y" 格式字符串数组（旧格子模式）
      currentSceneId: null,      // 场景图模式下的当前节点
      visitedSceneIds: [],       // 已访问过的场景节点 ID 列表
      ...(data.mapState || {}),
    };

    // Phase 19A — 玩家创建时选定的标签（race/origin/background/faith + 自定义）
    this.playerTags = [...(data.playerTags || [])];

    // Phase 26B — AI tier 控制叙事丰度（频率轴）
    //   'none'/'light'/'standard'/'advanced'；与 preset.aiHooks 协同决定何时调 AI
    this.aiTier = data.aiTier || 'standard';
    // AI 参与度/主导度（权限轴，0–4）：控制 AI 操作的 GM 能改动什么。见 systems/AIAuthority.js
    //   0 旁白 / 1 主持 / 2 裁决(默认) / 3 编剧 / 4 创世；可新游戏选择、游戏中实时调整、随存档持久化
    this.aiAuthority = (data.aiAuthority !== undefined && data.aiAuthority !== null)
      ? Math.max(0, Math.min(4, Math.round(Number(data.aiAuthority)) || 0))
      : 2;

    // Phase 19C — 故事时间（与游戏回合 turnNumber 独立）
    this.storyTime = {
      day: 1,
      hour: 8,
      ...(data.storyTime || {}),
    };

    // Phase 19B — NPC 运行时状态池
    //   key: npc.id, value: { affection, currentScene, inventory, alive, mood, knownTo }
    this.npcState = { ...(data.npcState || {}) };
    // 当前同行的伙伴 NPC id 列表（按入队顺序）
    this.companions = [...(data.companions || [])];

    // Phase 22 预留 — 全局世界状态（discrete narrative flags）
    this.worldFlags = { ...(data.worldFlags || {}) };

    // Phase 20B — 当前活跃对话（NPC + 节点 id）
    this.activeDialogue = data.activeDialogue || null;

    // Phase 21B — 已发现的隐藏连接（编码为 "fromId→toId" 字符串）
    this.discoveredConnections = [...(data.discoveredConnections || [])];

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

    // 场景图模式：设置起始场景
    if (preset.scenes && preset.scenes.length > 0) {
      const startSceneId = preset.startingSceneId || preset.scenes[0].id;
      const startScene = preset.scenes.find(s => s.id === startSceneId);
      state.mapState.currentSceneId = startSceneId;
      state.mapState.visitedSceneIds = [startSceneId];
      // 兼容：把场景坐标同步到 playerPosition，让旧的地形卡/UI 能用
      if (startScene && startScene.coords) {
        state.mapState.playerPosition = { x: startScene.coords.x, y: startScene.coords.y };
      }
    }

    // 设置起始位置（兼容旧格子地图 — 仅当没有场景图时使用）
    const hasScenes = preset.scenes && preset.scenes.length > 0;
    if (preset.map && !hasScenes) {
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
      activeLegionBattle: this.activeLegionBattle,
      strategicState: this.strategicState,
      activeEvent: this.activeEvent,
      mapState: this.mapState,
      completedEventIds: this.completedEventIds,
      narrativeLog: this.narrativeLog,
      aiContext: this.aiContext,
      diceHistory: this.diceHistory,
      variables: this.variables,
      gold: this.gold,
      // Phase 19
      playerTags: this.playerTags,
      storyTime: this.storyTime,
      npcState: this.npcState,
      companions: this.companions,
      worldFlags: this.worldFlags,
      activeDialogue: this.activeDialogue,
      discoveredConnections: this.discoveredConnections,
      // Phase 26B
      aiTier: this.aiTier,
      aiAuthority: this.aiAuthority,
    });
  }

  static fromJSON(json) {
    return new GameState(json);
  }
}
