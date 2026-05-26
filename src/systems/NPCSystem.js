/**
 * NPC 系统（Phase 19B）
 *
 * 与 enemies 解耦的"持久世界角色"系统：
 *   - NPC 有 affection、currentScene、inventory、alive、mood 等持久状态
 *   - 支持 schedule（按 storyTime 决定 NPC 在哪个场景）
 *   - 支持 giftPreferences（按物品 itemType/tag 给 love/like/neutral/dislike/hate 反应）
 *   - 支持 recruitable（可作为伙伴加入）
 *
 * NPC 卡牌结构（preset.npcs[] 中的元素）：
 *   {
 *     id: 'npc_blacksmith_brown',
 *     name: '老布朗',
 *     title: '铁匠',
 *     description: '...',
 *     personality: 'gruff_but_kind',
 *     icon: '🔨',
 *     recruitable: false,
 *     // 战斗用 stats / abilities（仅 recruitable=true 时需要）
 *     stats: {...},
 *     abilities: [...],
 *     // 赠礼偏好（item.itemType 或 item.tags 任一匹配即可）
 *     giftPreferences: {
 *       'material:metal': 'love',
 *       'weapon': 'like',
 *       'consumable:food': 'neutral',
 *       'tag:cursed': 'hate',
 *     },
 *     // 时间表（可选）— hour 范围可跨午夜（[22,6] = 22 点到次日 6 点）
 *     schedule: [
 *       { day: 1, hour: [8, 18], scene: 'scene_shop' },
 *       { day: 1, hour: [22, 6], scene: 'scene_home' },
 *     ],
 *     // 对话树（Phase 20 才会接入营地 modal）
 *     dialogueTree: { root: {...} },
 *   }
 *
 * 运行时 gameState.npcState[id]:
 *   { affection, currentScene, inventory, alive, mood, knownTo, custom }
 */

import { GameSystem } from '../core/GameEngine.js';

const DEFAULT_NPC_STATE = {
  affection: 0,
  currentScene: null,
  inventory: [],
  alive: true,
  mood: 'normal',
  knownTo: false,
  custom: {},
};

export class NPCSystem extends GameSystem {
  constructor() {
    super('NPCSystem');
    /** @type {Map<string, object>} npcId → NPC 卡牌定义 */
    this.npcs = new Map();
    /** Phase 22B — NPC 关系图（按 from 索引便于查询）*/
    this.relationsByFrom = new Map();
  }

  /**
   * 从预设加载 NPC 定义 + 关系图
   */
  loadFromPreset(preset) {
    this.npcs.clear();
    this.relationsByFrom.clear();
    if (!preset || !preset.npcs) return;
    for (const npc of preset.npcs) {
      this.npcs.set(npc.id, { ...npc });
    }
    // Phase 22B — 加载关系图
    for (const rel of (preset.npcRelations || [])) {
      if (!rel.from || !rel.to) continue;
      if (!this.relationsByFrom.has(rel.from)) this.relationsByFrom.set(rel.from, []);
      this.relationsByFrom.get(rel.from).push({
        to: rel.to,
        strength: typeof rel.strength === 'number' ? rel.strength : 0,
        note: rel.note || '',
      });
    }
  }

  /**
   * 为 gameState 初始化所有 NPC 的默认 runtime 状态
   * 仅初始化尚未存在的 NPC，避免覆盖存档中的 affection
   */
  initializeNPCState(gameState) {
    if (!gameState.npcState) gameState.npcState = {};
    for (const npc of this.npcs.values()) {
      if (!gameState.npcState[npc.id]) {
        gameState.npcState[npc.id] = {
          ...DEFAULT_NPC_STATE,
          // 起始场景：优先 schedule 第一项；否则用 spawnScene 字段；否则 null
          currentScene: npc.schedule?.[0]?.scene || npc.spawnScene || null,
          // 起始 inventory：用卡牌定义的 initialInventory
          inventory: [...(npc.initialInventory || [])],
        };
      }
    }
  }

  /** 取 NPC 卡牌定义 */
  getNPC(npcId) {
    return this.npcs.get(npcId) || null;
  }

  /** 取所有 NPC 卡牌 */
  getAllNPCs() {
    return Array.from(this.npcs.values());
  }

  /** 取 NPC 运行时状态 */
  getNPCState(gameState, npcId) {
    return gameState.npcState?.[npcId] || null;
  }

  /**
   * 计算 NPC 在某个时刻应该出现在哪个场景
   * @param {object} npc - NPC 卡牌
   * @param {object} storyTime - { day, hour }
   * @returns {string|null} sceneId 或 null（无 schedule 则用当前 currentScene）
   */
  getScheduledScene(npc, storyTime) {
    if (!npc.schedule || npc.schedule.length === 0) return null;
    const { day = 1, hour = 0 } = storyTime || {};
    for (const slot of npc.schedule) {
      // day 可以是数字、数组 [min, max] 或 'any'
      let dayOk = false;
      if (slot.day === 'any' || slot.day === undefined) dayOk = true;
      else if (Array.isArray(slot.day)) dayOk = day >= slot.day[0] && day <= slot.day[1];
      else dayOk = slot.day === day;
      if (!dayOk) continue;

      // hour 总是 [lo, hi]，支持跨午夜（lo > hi）
      const [lo, hi] = slot.hour || [0, 24];
      const inWindow = lo <= hi
        ? (hour >= lo && hour < hi)
        : (hour >= lo || hour < hi);
      if (inWindow) return slot.scene;
    }
    return null;
  }

  /**
   * 同步所有 NPC 的 currentScene 到他们的 schedule 上
   * 应在 storyTime 推进后调用
   */
  refreshNPCLocations(gameState) {
    const storyTime = gameState.storyTime || { day: 1, hour: 0 };
    for (const npc of this.npcs.values()) {
      const scheduled = this.getScheduledScene(npc, storyTime);
      if (scheduled) {
        const st = gameState.npcState[npc.id];
        if (st && st.alive) st.currentScene = scheduled;
      }
    }
  }

  /**
   * 取当前在指定场景中的所有 NPC（活的 + 已被玩家见过的）
   * @returns {Array<{ npc, state }>}
   */
  getNPCsInScene(gameState, sceneId, includeUnknown = false) {
    const out = [];
    for (const npc of this.npcs.values()) {
      const st = gameState.npcState?.[npc.id];
      if (!st || !st.alive) continue;
      if (st.currentScene !== sceneId) continue;
      if (!includeUnknown && !st.knownTo) continue;
      out.push({ npc, state: st });
    }
    return out;
  }

  /**
   * 标记玩家见过 NPC（首次相遇时调用）
   */
  meetNPC(gameState, npcId) {
    const st = gameState.npcState?.[npcId];
    if (st && !st.knownTo) {
      st.knownTo = true;
      return true;
    }
    return false;
  }

  /**
   * 调整好感（带上下限钳制）
   * Phase 22B — 自动按 npcRelations 传播到关联 NPC（一级传播，避免无限递归）
   * @param _depth 内部用，限制递归深度
   * @returns 新的 affection 值
   */
  changeAffection(gameState, npcId, delta, _depth = 0) {
    const st = gameState.npcState?.[npcId];
    if (!st) return null;
    const before = st.affection || 0;
    st.affection = Math.max(0, Math.min(100, before + delta));
    const actualDelta = st.affection - before;

    // Phase 22B — 一级传播（_depth=0 时才传播，避免环回）
    if (_depth === 0 && actualDelta !== 0) {
      const rels = this.relationsByFrom.get(npcId) || [];
      for (const r of rels) {
        const propagated = Math.round(actualDelta * r.strength);
        if (propagated !== 0) {
          this.changeAffection(gameState, r.to, propagated, _depth + 1);
        }
      }
    }
    return st.affection;
  }

  /**
   * 应用 NPC 死亡事件 — 会按关系传播到关联 NPC（如同伴大悲、敌人窃喜）
   * @returns 受影响的 NPC 列表
   */
  applyNPCDeath(gameState, npcId) {
    const st = gameState.npcState?.[npcId];
    if (!st) return [];
    st.alive = false;
    const effects = [];
    const rels = this.relationsByFrom.get(npcId) || [];
    for (const r of rels) {
      const targetSt = gameState.npcState?.[r.to];
      if (!targetSt || !targetSt.alive) continue;
      // 死亡 = 强烈情感冲击 — 用 strength × 25 作为 affection 变化（不传播二次）
      const delta = Math.round(r.strength * 25);
      if (delta !== 0) {
        this.changeAffection(gameState, r.to, delta, 1);   // _depth=1 避免再次传播
        effects.push({ to: r.to, delta, strength: r.strength });
        // 关系紧密的还可能改 mood
        if (Math.abs(r.strength) >= 0.7) {
          targetSt.mood = r.strength > 0 ? 'grieving' : 'pleased';
        }
      }
    }
    return effects;
  }

  /**
   * 评估 NPC 对赠送物品的反应
   * 优先级：明确的 item id 匹配 > item.itemType 匹配 > item.tags 匹配
   * @returns 'love' | 'like' | 'neutral' | 'dislike' | 'hate'
   */
  evaluateGiftReaction(npcId, item) {
    const npc = this.npcs.get(npcId);
    if (!npc || !npc.giftPreferences) return 'neutral';
    const prefs = npc.giftPreferences;

    if (prefs[item.id]) return prefs[item.id];
    if (prefs[item.itemType]) return prefs[item.itemType];
    for (const tag of (item.tags || [])) {
      if (prefs[`tag:${tag}`]) return prefs[`tag:${tag}`];
      if (prefs[tag]) return prefs[tag];
    }
    return 'neutral';
  }

  /** 赠礼的 affection 增量（标准映射） */
  giftReactionDelta(reaction) {
    return { love: 15, like: 5, neutral: 1, dislike: -3, hate: -10 }[reaction] || 0;
  }

  /**
   * 招募 NPC 为伙伴
   */
  recruitCompanion(gameState, npcId) {
    const npc = this.npcs.get(npcId);
    if (!npc || !npc.recruitable) return false;
    if (!gameState.companions) gameState.companions = [];
    if (gameState.companions.includes(npcId)) return false;
    gameState.companions.push(npcId);
    return true;
  }

  /** 让伙伴离队 */
  dismissCompanion(gameState, npcId) {
    if (!gameState.companions) return false;
    const idx = gameState.companions.indexOf(npcId);
    if (idx < 0) return false;
    gameState.companions.splice(idx, 1);
    return true;
  }

  /** 是否当前是同行伙伴 */
  isCompanion(gameState, npcId) {
    return (gameState.companions || []).includes(npcId);
  }
}
