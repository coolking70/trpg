/**
 * AI 上下文检索器（Phase 23D）
 *
 * 300+ 场景的项目不可能把全部 description 塞进 AI prompt。
 * 这个检索器按"相关性"挑 N 个最相关的场景/NPC，仅注入这些。
 *
 * 评分维度（加权）：
 *   1. 距离当前场景的图距离（BFS 跳数）— 最近邻给最高分
 *   2. 共享 tag 数（场景 tag ∩ 玩家 playerTags）
 *   3. 最近访问 — gameState.visitedSceneIds 倒序前 N
 *   4. 出现在当前激活事件的 inScene 中
 *
 * NPC 类似：
 *   1. 当前场景在场 / 同行伙伴 → 最高
 *   2. 玩家已遇见（knownTo=true）
 *   3. 好感度高
 */

import { GameSystem } from '../core/GameEngine.js';

export class ContextRetriever extends GameSystem {
  constructor() {
    super('ContextRetriever');
    this._sceneSystem = null;
    this._npcSystem = null;
  }

  initialize(engine) {
    super.initialize(engine);
    this._sceneSystem = engine.getSystem('SceneSystem');
    this._npcSystem = engine.getSystem('NPCSystem');
  }

  /**
   * 检索与当前局面最相关的 N 个场景（含 description）
   * @returns {Array<{ id, name, description, type, score }>}
   */
  getRelevantScenes(gameState, limit = 10) {
    if (!this._sceneSystem?.hasScenes() || !gameState) return [];
    const scenes = this._sceneSystem.getAllScenes();
    if (scenes.length <= limit) return scenes.map(s => this._sceneDigest(s, 1));

    const currentId = gameState.mapState?.currentSceneId;
    const visited = gameState.mapState?.visitedSceneIds || [];
    const visitedSet = new Set(visited);
    const playerTags = new Set(gameState.playerTags || []);

    // BFS 距离
    const distance = this._bfsDistances(scenes, currentId);

    const scored = scenes.map(scene => {
      let score = 0;
      // 1. 图距离（max - dist，离得近的高分）
      const d = distance.get(scene.id);
      if (d !== undefined) score += Math.max(0, 10 - d);
      // 当前场景始终最高
      if (scene.id === currentId) score += 100;
      // 2. 共享 tag
      const sceneTags = new Set(scene.tags || []);
      for (const t of sceneTags) if (playerTags.has(t)) score += 2;
      // 3. 已访问 — 最近的 5 个 +5/+4/+3/+2/+1
      const idxFromEnd = visited.length - 1 - visited.lastIndexOf(scene.id);
      if (visitedSet.has(scene.id) && idxFromEnd >= 0 && idxFromEnd < 5) {
        score += 5 - idxFromEnd;
      }
      return { scene, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ scene, score }) => this._sceneDigest(scene, score));
  }

  /**
   * 检索与当前局面最相关的 N 个 NPC
   */
  getRelevantNPCs(gameState, limit = 8) {
    if (!this._npcSystem || !gameState) return [];
    const all = this._npcSystem.getAllNPCs();
    if (all.length === 0) return [];

    const currentScene = gameState.mapState?.currentSceneId;
    const companions = new Set(gameState.companions || []);

    const scored = all.map(npc => {
      const st = this._npcSystem.getNPCState(gameState, npc.id);
      if (!st || !st.alive) return null;
      let score = 0;
      if (companions.has(npc.id)) score += 100;       // 同行伙伴最高
      if (st.currentScene === currentScene) score += 50;  // 同场景次高
      if (st.knownTo) score += 10;
      score += Math.min(20, (st.affection || 0) / 5);  // 高好感加分
      return { npc, state: st, score };
    }).filter(Boolean);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ npc, state, score }) => ({
      id: npc.id,
      name: npc.name,
      personality: npc.personality || '',
      currentScene: state.currentScene,
      affection: state.affection,
      isCompanion: companions.has(npc.id),
      score,
    }));
  }

  /**
   * 生成一段紧凑的上下文摘要文本（直接塞 AI system prompt）
   */
  buildContextDigest(gameState, opts = {}) {
    const lines = [];

    // 当前场景概况
    if (this._sceneSystem) {
      const cur = this._sceneSystem.getCurrentScene(gameState);
      if (cur) {
        lines.push(`【当前场景】${cur.name}（${cur.type || ''}）: ${cur.description || ''}`);
      }
    }

    // 故事时间 + worldFlags
    const st = gameState.storyTime || {};
    if (st.day) lines.push(`【时间】第 ${st.day} 天 ${String(st.hour ?? 0).padStart(2, '0')}:00`);
    const wf = gameState.worldFlags || {};
    const flagKeys = Object.keys(wf).filter(k => wf[k]);
    if (flagKeys.length > 0) lines.push(`【世界状态】${flagKeys.join(' / ')}`);

    // 玩家身份
    if ((gameState.playerTags || []).length > 0) {
      lines.push(`【玩家身份】${gameState.playerTags.join(' · ')}`);
    }

    // 同行伙伴
    const companions = gameState.companions || [];
    if (companions.length > 0 && this._npcSystem) {
      const names = companions
        .map(id => this._npcSystem.getNPC(id))
        .filter(Boolean)
        .map(n => n.name);
      if (names.length > 0) lines.push(`【同行】${names.join('、')}`);
    }

    // 相关场景（最多 N 个）
    const sceneLimit = opts.sceneLimit ?? 6;
    if (sceneLimit > 0) {
      const related = this.getRelevantScenes(gameState, sceneLimit);
      const items = related
        .filter(s => s.id !== gameState.mapState?.currentSceneId)
        .slice(0, sceneLimit - 1)
        .map(s => `  - ${s.name}: ${(s.description || '').slice(0, 60)}`);
      if (items.length > 0) lines.push(`【相关场景】\n${items.join('\n')}`);
    }

    // 在场 / 同行 NPC
    const npcLimit = opts.npcLimit ?? 5;
    if (npcLimit > 0) {
      const relNpcs = this.getRelevantNPCs(gameState, npcLimit);
      if (relNpcs.length > 0) {
        const items = relNpcs.map(n => {
          const tag = n.isCompanion ? '同行' : '在场';
          return `  - ${n.name}（${tag}, 好感 ${n.affection}）: ${n.personality}`;
        });
        lines.push(`【相关 NPC】\n${items.join('\n')}`);
      }
    }

    return lines.join('\n');
  }

  // ---------- 内部 ----------

  _sceneDigest(scene, score = 0) {
    return {
      id: scene.id,
      name: scene.name,
      type: scene.type,
      description: scene.description,
      tags: scene.tags || [],
      score,
    };
  }

  /**
   * BFS：返回 sceneId → 距离 startId 的最短跳数
   * 未连通的不在结果中
   */
  _bfsDistances(allScenes, startId) {
    const dist = new Map();
    if (!startId) return dist;
    const adj = new Map();
    for (const s of allScenes) {
      const out = [];
      for (const c of (s.connections || [])) out.push(c.to);
      adj.set(s.id, out);
    }
    dist.set(startId, 0);
    const queue = [startId];
    while (queue.length > 0) {
      const cur = queue.shift();
      const d = dist.get(cur);
      for (const next of (adj.get(cur) || [])) {
        if (!dist.has(next)) {
          dist.set(next, d + 1);
          queue.push(next);
        }
      }
    }
    return dist;
  }
}
