/**
 * 事件触发引擎
 * 评估复合触发条件，支持空间/变量/前置事件/HP/回合/物品等多维度
 * 在玩家移动、回合结束、战斗结束、事件完成时被扫描
 */

import { GameSystem } from '../core/GameEngine.js';

/** 触发时机枚举 */
export const TRIGGER_MOMENTS = {
  MOVE: 'move',
  TURN_END: 'turn_end',
  COMBAT_END: 'combat_end',
  EVENT_COMPLETE: 'event_complete',
  VARIABLE_CHANGE: 'variable_change',
  SCENE_ENTER: 'scene_enter',  // 新增：抵达场景时扫描
};

export class EventTriggerEngine extends GameSystem {
  constructor() {
    super('EventTriggerEngine');
    this.cardManager = null;
    this.mapSystem = null;
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.cardManager = gameEngine.getSystem('CardManager');
    this.mapSystem = gameEngine.getSystem('MapSystem');
  }

  /**
   * 扫描所有事件并返回匹配条件的事件 ID 列表（按优先级排序）
   * @param {object} gameState
   * @param {object} context - 触发上下文 { moment, tileX, tileY, ... }
   * @returns {string[]} 应触发的 event ID 列表（按 priority 排序，未指定则按文件顺序）
   */
  scan(gameState, context = {}) {
    if (!this.cardManager || !gameState) return [];

    const events = this.cardManager.getCardsByType('event');
    const matches = [];

    for (const event of events) {
      // 不可重复且已完成 → 跳过
      if (!event.repeatable && gameState.completedEventIds.includes(event.id)) {
        continue;
      }

      // 重复事件检查最大次数
      if (event.maxOccurrences && event.maxOccurrences > 0) {
        const count = gameState.getEventCompletionCount
          ? gameState.getEventCompletionCount(event.id)
          : gameState.completedEventIds.filter(id => id === event.id).length;
        if (count >= event.maxOccurrences) continue;
      }

      if (this.evaluateTrigger(event, gameState, context)) {
        matches.push(event);
      }
    }

    // 按 priority 字段降序排（未设置默认为 0）
    matches.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return matches.map(e => e.id);
  }

  /**
   * 评估单个事件的触发条件是否满足
   * @param {object} event - EventCard
   * @param {object} gameState
   * @param {object} context
   * @returns {boolean}
   */
  evaluateTrigger(event, gameState, context) {
    const trigger = event.trigger;
    if (!trigger) return false;

    // 兼容旧格式 map_tile
    if (trigger.type === 'map_tile') {
      return this._evaluateMapTile(trigger.condition || {}, gameState, context);
    }

    // 显式触发器（由 outcome.effects 的 trigger_event 直接发起，不走条件评估）
    if (trigger.type === 'explicit') {
      return false; // 不会通过 scan 触发
    }

    // 复合条件
    if (trigger.type === 'composite') {
      return this._evaluateComposite(trigger.condition || {}, gameState, context);
    }

    return false;
  }

  /**
   * 评估旧的 map_tile 触发器（仅在 MOVE 时机有效）
   */
  _evaluateMapTile(condition, gameState, context) {
    if (context.moment !== TRIGGER_MOMENTS.MOVE) return false;
    const { tileX, tileY, tileKey } = context;
    if (tileX === undefined || tileY === undefined) return false;

    const tileTypes = condition.tileTypes || [];
    if (tileTypes.length > 0 && !tileTypes.includes(tileKey)) return false;

    const prob = condition.probability !== undefined ? condition.probability : 1.0;
    return Math.random() < prob;
  }

  /**
   * 评估复合触发器（所有给定条件必须满足）
   */
  _evaluateComposite(condition, gameState, context) {
    // 身份门控（Phase 46，通用）：仅当玩家战略身份(playerRole)在白名单内才触发。
    //   常用于把"主角本位的主线事件"限定给 ruler——底层视角(officer/soldier)不被强行卷入主公的剧情。
    //   无战略层时 playerRole 视作 'ruler'（向后兼容：未设此条件的事件不受影响）。
    if (condition.requirePlayerRole) {
      const need = Array.isArray(condition.requirePlayerRole) ? condition.requirePlayerRole : [condition.requirePlayerRole];
      const role = gameState?.strategicState?.playerRole || 'ruler';
      if (!need.includes(role)) return false;
    }

    // 学校状态门控（Phase 48，通用）：把社团/实践/校园剧情限定到在校特定情形。
    //   未含学校模块的剧本若设此条件则恒不触发（无 schoolState）。无此条件的事件不受影响。
    //   支持：true(仅需在校)/{status,minYear,maxYear,major,enrolledIn,completed,inClub,
    //          eventHook,minDemerits,minGpa}。
    if (condition.requireSchoolState) {
      const ss = gameState?.schoolState;
      if (!ss) return false;
      const c = condition.requireSchoolState === true ? {} : condition.requireSchoolState;
      if (c.status && ss.status !== c.status) return false;
      if (c.minYear != null && (ss.year || 1) < c.minYear) return false;
      if (c.maxYear != null && (ss.year || 1) > c.maxYear) return false;
      if (c.major && ss.major !== c.major) return false;
      if (c.enrolledIn && !(ss.enrolled || []).includes(c.enrolledIn)) return false;
      if (c.completed && !(ss.completed || []).includes(c.completed)) return false;
      if (c.inClub && !(ss.clubs || []).includes(c.inClub)) return false;
      if (c.eventHook && context.schoolHook !== c.eventHook) return false;
      if (c.minDemerits != null && (ss.demerits || 0) < c.minDemerits) return false;
      if (c.minGpa != null && (ss.gpa || 0) < c.minGpa) return false;
    }

    // 场景条件（新版）— 必须当前在指定的场景之一
    if (condition.inScene && condition.inScene.length > 0) {
      if (context.moment !== TRIGGER_MOMENTS.SCENE_ENTER) return false;
      const currentSceneId = gameState?.mapState?.currentSceneId;
      if (!currentSceneId || !condition.inScene.includes(currentSceneId)) return false;
    }

    // 空间条件（OR 关系：tileTypes / pointsOfInterest 满足任一）
    const hasSpatialCondition = (condition.tileTypes && condition.tileTypes.length > 0) ||
                                (condition.pointsOfInterest && condition.pointsOfInterest.length > 0);

    if (hasSpatialCondition) {
      // 空间条件仅在 MOVE 时机评估
      if (context.moment !== TRIGGER_MOMENTS.MOVE) return false;
      let spatialMatch = false;

      if (condition.tileTypes && condition.tileTypes.includes(context.tileKey)) {
        spatialMatch = true;
      }
      if (!spatialMatch && condition.pointsOfInterest && this.mapSystem) {
        const mapData = this.mapSystem.getMapData();
        if (mapData) {
          const poi = mapData.getPointOfInterest(context.tileX, context.tileY);
          if (poi && condition.pointsOfInterest.includes(poi.id || `${poi.x},${poi.y}`)) {
            spatialMatch = true;
          }
        }
      }
      if (!spatialMatch) return false;
    }

    // 变量条件（全部匹配）
    if (condition.requireVariables) {
      const vars = gameState.variables || {};
      for (const [key, expected] of Object.entries(condition.requireVariables)) {
        if (vars[key] !== expected) return false;
      }
    }

    // 已完成事件（全部完成）
    if (condition.requireCompletedEvents && condition.requireCompletedEvents.length > 0) {
      for (const eid of condition.requireCompletedEvents) {
        if (!gameState.completedEventIds.includes(eid)) return false;
      }
    }

    // 排除已完成事件（任一已完成即拒绝）
    if (condition.excludeCompletedEvents && condition.excludeCompletedEvents.length > 0) {
      for (const eid of condition.excludeCompletedEvents) {
        if (gameState.completedEventIds.includes(eid)) return false;
      }
    }

    // HP 阈值
    if (condition.partyHpBelow !== undefined) {
      const chars = gameState.activeCharacters || [];
      const alive = chars.filter(c => c.stats.hp > 0);
      if (alive.length === 0) return false;
      const totalRatio = alive.reduce((sum, c) => sum + (c.stats.hpCurrent / c.stats.hp), 0) / alive.length;
      if (totalRatio >= condition.partyHpBelow) return false;
    }

    // 回合数
    if (condition.turnNumberAtLeast !== undefined) {
      if (gameState.turnNumber < condition.turnNumberAtLeast) return false;
    }

    // 必须持有物品（任一角色持有即可）
    if (condition.requireItems && condition.requireItems.length > 0) {
      const allInventories = (gameState.activeCharacters || []).flatMap(c => c.inventory || []);
      for (const itemId of condition.requireItems) {
        if (!allInventories.includes(itemId)) return false;
      }
    }

    // Phase 19A — 玩家标签（race/origin/background/faith 等）
    const tags = new Set(gameState.playerTags || []);
    if (condition.requireTags && condition.requireTags.length > 0) {
      for (const t of condition.requireTags) if (!tags.has(t)) return false;
    }
    if (condition.requireAnyTags && condition.requireAnyTags.length > 0) {
      if (!condition.requireAnyTags.some(t => tags.has(t))) return false;
    }
    if (condition.requireNoTags && condition.requireNoTags.length > 0) {
      for (const t of condition.requireNoTags) if (tags.has(t)) return false;
    }

    // Phase 19C — 故事时间窗口
    if (condition.requireStoryTime) {
      const st = gameState.storyTime || { day: 1, hour: 0 };
      const rt = condition.requireStoryTime;
      if (rt.minDay !== undefined && st.day < rt.minDay) return false;
      if (rt.maxDay !== undefined && st.day > rt.maxDay) return false;
      if (rt.hourRange) {
        const [lo, hi] = rt.hourRange;
        if (lo <= hi) {
          if (st.hour < lo || st.hour > hi) return false;
        } else {
          // 跨午夜的窗口，如 [22, 6] = 晚 22 点到次日 6 点
          if (st.hour < lo && st.hour > hi) return false;
        }
      }
    }

    // Phase 22 预留 — worldFlags 维度
    if (condition.requireWorldFlags) {
      const wf = gameState.worldFlags || {};
      for (const [k, v] of Object.entries(condition.requireWorldFlags)) {
        if (wf[k] !== v) return false;
      }
    }

    // 概率（随机遭遇）
    // 每次进入场景只允许触发一次"随机遭遇"：避免战斗结束后补扫 SCENE_ENTER 时，
    // 同场景的概率遭遇被再次掷中，导致背靠背连续战斗（生产 + 玩测均复现的 bug）。
    // 关键区分：只有 probability < 1.0 的"真随机遭遇"才参与单次访问冷却；
    //   probability === 1.0 或缺省的是"确定性事件"（如同场景的多结局/剧情后续），
    //   它们不参与冷却、也不设置冷却标记——否则会误杀同场景内更高优先级的确定性事件。
    if (condition.probability !== undefined && condition.probability < 1.0) {
      const ms = gameState.mapState;
      const sceneId = ms?.currentSceneId;
      if (ms && sceneId && ms._encounterFiredSceneId === sceneId) {
        return false; // 本次进入该场景已触发过随机遭遇
      }
      if (Math.random() < condition.probability) {
        if (ms && sceneId) ms._encounterFiredSceneId = sceneId;
        return true;
      }
      return false;
    }

    // 确定性事件：probability 1.0（或缺省）
    const prob = condition.probability !== undefined ? condition.probability : 1.0;
    return Math.random() < prob;
  }

  destroy() {
    this.cardManager = null;
    this.mapSystem = null;
    super.destroy();
  }
}
