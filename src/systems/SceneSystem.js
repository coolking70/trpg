/**
 * 场景系统（Scene Graph）
 *
 * 桌游跑团式的"节点 + 连接"地图模型。每个场景节点 = 一个有意义的桥段
 * （村庄 / 营地 / 战场 / 遗迹），玩家通过节点之间的连接移动。每次移动
 * 触发一次叙事（抵达 + 该场景挂载的事件），不再有"走 50 格才碰一段剧情"的稀释问题。
 *
 * 场景数据结构（preset.scenes 中的元素）：
 *   {
 *     id: 'scene_village',
 *     name: '林间村落',
 *     description: '抵达时的基础描述（AI 会在此基础上扩写）',
 *     type: 'settlement'|'wilderness'|'combat'|'dungeon'|'spawn'|'ending'|'vignette',
 *     coords: { x, y },       // 仅用于地图可视化的相对位置
 *     connections: [
 *       { to: 'scene_other_id', label?: '沿古道南下', cost?: 1, gated?: { variables?, completedEvents? } }
 *     ],
 *     events: ['ch3_village', 'ch4_shop'],   // 抵达时按事件 priority 扫描
 *     vignettes: ['重访叙事 1', '重访叙事 2'], // 无 AI 调用的本地兜底
 *     tags: ['main', 'safe'],
 *     icon: '🏘',
 *   }
 */

import { GameSystem } from '../core/GameEngine.js';

export class SceneSystem extends GameSystem {
  constructor() {
    super('SceneSystem');
    /** @type {Map<string, object>} sceneId → scene */
    this.scenes = new Map();
    /** @type {string|null} 起始场景 ID */
    this.startingSceneId = null;
  }

  /**
   * 从预设加载场景图
   * @param {object} preset
   */
  loadFromPreset(preset) {
    this.scenes.clear();
    this.startingSceneId = null;
    if (!preset || !preset.scenes) return;

    for (const scene of preset.scenes) {
      // 浅拷贝防止外部修改
      this.scenes.set(scene.id, { ...scene, connections: [...(scene.connections || [])] });
    }
    this.startingSceneId = preset.startingSceneId || preset.scenes[0]?.id || null;
  }

  /** 是否已加载场景图 */
  hasScenes() {
    return this.scenes.size > 0;
  }

  /** 取场景对象 */
  getScene(sceneId) {
    return this.scenes.get(sceneId) || null;
  }

  /** 取所有场景 */
  getAllScenes() {
    return Array.from(this.scenes.values());
  }

  /** 取当前所在场景 */
  getCurrentScene(gameState) {
    const id = gameState?.mapState?.currentSceneId;
    return id ? this.getScene(id) : null;
  }

  /**
   * 取当前场景的可达邻居（应用 gated 条件过滤）
   * Phase 21B — 自动过滤 discovered=false 的连接（除非已在 gameState.discoveredConnections）
   * @returns {Array<{ scene, connection, reachable, lockedReason? }>}
   */
  getAdjacent(gameState) {
    const current = this.getCurrentScene(gameState);
    if (!current) return [];
    const out = [];
    // Phase 21A — 取活跃变体的 connections（如果有）
    const activeConnections = this._getActiveConnections(current, gameState);
    for (const conn of activeConnections) {
      if (!this._isConnectionVisible(conn, current.id, gameState)) continue;
      const scene = this.getScene(conn.to);
      if (!scene) continue;
      const check = this._evaluateGated(conn.gated, gameState);
      out.push({
        scene,
        connection: conn,
        reachable: check.ok,
        lockedReason: check.reason || null,
      });
    }
    return out;
  }

  /**
   * Phase 21A — 取场景的活跃变体（如果有 variants）
   * 按 variants 数组顺序匹配第一个满足条件的，没有则返回 null（用 base scene 字段）
   */
  getActiveVariant(scene, gameState) {
    if (!scene || !scene.variants || scene.variants.length === 0) return null;
    for (const v of scene.variants) {
      if (this._evaluateVariantCondition(v.when, gameState)) return v;
    }
    return null;
  }

  /**
   * 取场景"当下应该显示"的合并视图：base + active variant
   * variants 字段优先：description / events / connections / vignettes
   */
  getActiveSceneView(scene, gameState) {
    if (!scene) return null;
    const v = this.getActiveVariant(scene, gameState);
    if (!v) return scene;
    return {
      ...scene,
      description: v.description !== undefined ? v.description : scene.description,
      events: v.events !== undefined ? v.events : scene.events,
      connections: v.connections !== undefined ? v.connections : scene.connections,
      vignettes: v.vignettes !== undefined ? v.vignettes : scene.vignettes,
      _variantId: v.id || null,
    };
  }

  /**
   * 同上但内部用：直接返回 connections（要么 base 要么 variant）
   */
  _getActiveConnections(scene, gameState) {
    const v = this.getActiveVariant(scene, gameState);
    if (v && v.connections !== undefined) return v.connections;
    return scene.connections || [];
  }

  /**
   * Phase 21B — 连接是否对玩家可见
   * 默认 discovered !== false 即可见
   * discovered === false 时需要在 gameState.discoveredConnections 才可见
   */
  _isConnectionVisible(conn, fromSceneId, gameState) {
    if (conn.discovered === false) {
      const key = `${fromSceneId}→${conn.to}`;
      return (gameState.discoveredConnections || []).includes(key);
    }
    return true;
  }

  /**
   * Phase 21B — 解锁一条隐藏连接
   * @returns true 如果是新解锁（之前未发现），false 如果已经解锁过
   */
  revealConnection(gameState, fromSceneId, toSceneId) {
    const key = `${fromSceneId}→${toSceneId}`;
    gameState.discoveredConnections ||= [];
    if (gameState.discoveredConnections.includes(key)) return false;
    gameState.discoveredConnections.push(key);
    return true;
  }

  /**
   * Phase 21A — 评估 variant.when 条件
   * 支持：requireVariables / requireWorldFlags / requireStoryTime / requireTags / requireCompletedEvents
   */
  _evaluateVariantCondition(when, gameState) {
    if (!when) return true;
    if (when.requireVariables) {
      const vars = gameState.variables || {};
      for (const [k, v] of Object.entries(when.requireVariables)) {
        if (vars[k] !== v) return false;
      }
    }
    if (when.requireWorldFlags) {
      const wf = gameState.worldFlags || {};
      for (const [k, v] of Object.entries(when.requireWorldFlags)) {
        if (wf[k] !== v) return false;
      }
    }
    if (when.requireCompletedEvents) {
      for (const eid of when.requireCompletedEvents) {
        if (!(gameState.completedEventIds || []).includes(eid)) return false;
      }
    }
    if (when.requireTags) {
      const tags = new Set(gameState.playerTags || []);
      for (const t of when.requireTags) if (!tags.has(t)) return false;
    }
    if (when.requireStoryTime) {
      const st = gameState.storyTime || { day: 1, hour: 0 };
      const rt = when.requireStoryTime;
      if (rt.minDay !== undefined && st.day < rt.minDay) return false;
      if (rt.maxDay !== undefined && st.day > rt.maxDay) return false;
      if (rt.hourRange) {
        const [lo, hi] = rt.hourRange;
        const inWindow = lo <= hi ? (st.hour >= lo && st.hour <= hi) : (st.hour >= lo || st.hour <= hi);
        if (!inWindow) return false;
      }
    }
    return true;
  }

  /**
   * 校验能否前往目标场景
   */
  canTravelTo(gameState, sceneId) {
    const current = this.getCurrentScene(gameState);
    if (!current) return { ok: false, reason: '尚未设置当前场景' };
    const conn = (current.connections || []).find(c => c.to === sceneId);
    if (!conn) return { ok: false, reason: '此场景与当前场景没有直接连接' };
    return this._evaluateGated(conn.gated, gameState);
  }

  /**
   * 应用前往：更新 currentSceneId / visitedSceneIds / playerPosition
   * 不调 AI，仅更新状态。AI 叙事 + 事件扫描由调用方负责。
   * @returns { scene, isFirstVisit, connection }
   */
  performTravel(gameState, sceneId) {
    const current = this.getCurrentScene(gameState);
    const next = this.getScene(sceneId);
    if (!next) return null;

    const connection = current?.connections?.find(c => c.to === sceneId) || null;
    const visited = gameState.mapState.visitedSceneIds || [];
    const isFirstVisit = !visited.includes(sceneId);

    gameState.mapState.currentSceneId = sceneId;
    if (isFirstVisit) {
      gameState.mapState.visitedSceneIds = [...visited, sceneId];
    }
    // 同步 playerPosition（让旧的地形卡/UI 能继续工作）
    if (next.coords) {
      gameState.mapState.playerPosition = { x: next.coords.x, y: next.coords.y };
    }

    return { scene: next, isFirstVisit, connection };
  }

  /**
   * 取一段当前场景的 vignette（重访短描述），无 AI 调用
   */
  pickVignette(scene) {
    if (!scene || !scene.vignettes || scene.vignettes.length === 0) return null;
    return scene.vignettes[Math.floor(Math.random() * scene.vignettes.length)];
  }

  /**
   * 评估 gated 条件
   * gated = {
   *   requireVariables?: {key: val},
   *   requireCompletedEvents?: ['id'],
   *   requireItems?: ['id'],
   *   hint?: string,        // 作者写的诗意提示，会优先用作 reason
   * }
   *
   * 返回的 reason 永远不会暴露内部变量名 / 事件 ID / 物品 ID —
   * UI 直接拿去显示也不会剧透。
   */
  _evaluateGated(gated, gameState) {
    if (!gated) return { ok: true };

    // 收集失败种类，决定走哪种通用提示
    let kind = null;
    if (gated.requireVariables) {
      for (const [k, v] of Object.entries(gated.requireVariables)) {
        if (gameState.variables[k] !== v) { kind = 'variable'; break; }
      }
    }
    if (!kind && gated.requireCompletedEvents) {
      for (const eid of gated.requireCompletedEvents) {
        if (!gameState.completedEventIds.includes(eid)) { kind = 'event'; break; }
      }
    }
    if (!kind && gated.requireItems) {
      const inv = (gameState.activeCharacters || []).flatMap(c => c.inventory || []);
      for (const itemId of gated.requireItems) {
        if (!inv.includes(itemId)) { kind = 'item'; break; }
      }
    }
    // Phase 19A — 玩家标签
    if (!kind && gated.requireTags) {
      const tags = new Set(gameState.playerTags || []);
      for (const t of gated.requireTags) {
        if (!tags.has(t)) { kind = 'tag'; break; }
      }
    }
    if (!kind && gated.requireAnyTags) {
      const tags = new Set(gameState.playerTags || []);
      if (!gated.requireAnyTags.some(t => tags.has(t))) kind = 'tag';
    }
    // Phase 19C — 故事时间
    if (!kind && gated.requireStoryTime) {
      const st = gameState.storyTime || { day: 1, hour: 0 };
      const rt = gated.requireStoryTime;
      if ((rt.minDay !== undefined && st.day < rt.minDay) ||
          (rt.maxDay !== undefined && st.day > rt.maxDay)) {
        kind = 'time';
      }
      if (!kind && rt.hourRange) {
        const [lo, hi] = rt.hourRange;
        const inWindow = lo <= hi
          ? (st.hour >= lo && st.hour <= hi)
          : (st.hour >= lo || st.hour <= hi);
        if (!inWindow) kind = 'time';
      }
    }

    if (!kind) return { ok: true };

    // 走作者提示，否则走通用文案 — 都不暴露内部 key
    if (gated.hint) return { ok: false, reason: gated.hint };
    const generic = {
      variable: '你们似乎还差一些线索',
      event:    '需要先完成某段前置经历',
      item:     '需要先找到某件关键物品',
      tag:      '此路对你而言并不合适',
      time:     '此时此刻这条路并不开启',
    };
    return { ok: false, reason: generic[kind] || '此路尚未开启' };
  }
}
