/**
 * 大型剧本端到端玩测（headless）
 *
 * 玩家由人/脚本扮演（无 LLM 玩家）：
 *   --player scripted（默认, 确定性启发式）/ interactive（人或 MCP 出招）/ manual（固定路线）
 * GM 叙述可选接入模型（OPENAI_* 环境变量；不配置则走 localFallback）。
 *
 * 其它参数：
 *   - --preset <path>   任意预设 JSON 路径（默认 presets/eternal-crown-stress-test.json）
 *   - --max-iter N      最大决策回合数（默认 200）
 *   - 玩家选择 starting choices（race/origin/background/faith）— 复刻 main.js 的角色创建
 *   - 终止条件兼容多 ending 事件（tag 含 'ending' 或 'epilogue' 都算主线完成）
 *   - 覆盖率/时延/GM token 等指标输出
 *
 * 用法：
 *   node scripts/playtest-large-script.mjs
 *   node scripts/playtest-large-script.mjs --preset presets/foo.json --player interactive --max-iter 250
 */

// 对局核心：引擎/系统接线、事件/effect/旅行/战斗结算都在这里（与生产、MCP 对局服务共用）
import { GameSession } from '../src/core/GameSession.js';
import { DEFAULT_PRESET } from '../src/data/defaultPreset.js';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- CLI 参数 ----------
const argv = process.argv.slice(2);
function argVal(flag, def) {
  const i = argv.indexOf(flag);
  if (i < 0) return def;
  return argv[i + 1];
}
const PRESET_PATH = path.resolve(__dirname, '..', argVal('--preset', 'presets/eternal-crown-stress-test.json'));
const MAX_ITER = parseInt(argVal('--max-iter', '200'), 10);
const API_TIMEOUT_MS = parseInt(process.env.OPENAI_TIMEOUT_MS || argVal('--timeout-ms', '60000'), 10);
// 玩家扮演模式（不再支持 LLM 玩家）：scripted（默认, 确定性启发式）/ manual（固定路线）/ interactive（人/MCP）
const PLAYER_MODE = argVal('--player', 'scripted');

// ---------- 环境补丁 ----------
globalThis.requestAnimationFrame ||= (cb) => setTimeout(() => cb(Date.now()), 16);
globalThis.cancelAnimationFrame ||= (id) => clearTimeout(id);
globalThis.localStorage = (() => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
})();

const KEY = process.env.OPENAI_API_KEY || '';
const ENDPOINT = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1';
const GM_MODEL = process.env.OPENAI_GM_MODEL || process.env.OPENAI_MODEL || 'qwen/qwen3.6-35b-a3b';

// ============================================================
// HeadlessApp — 场景图版
// ============================================================
// ============================================================
// HeadlessApp — 玩测专属壳：复用 GameSession 对局核心，只追加
//   多跳寻路 travelTo / inn 寻路 nearestSceneByTag / 手动休整 _healPartyToFull。
//   事件解析、effect、战斗自动结算、useItem、kickoff、isMainQuestComplete 均继承自核心。
// ============================================================
class HeadlessApp extends GameSession {
  _healPartyToFull(reason = '休整') {
    for (const c of this.gameState.activeCharacters || []) {
      if (!c.stats) continue;
      c.stats.hpCurrent = c.stats.hp;
      c.stats.mpCurrent = c.stats.mp || 0;
    }
    this.gameState.addNarrative('system', `（${reason}：队伍恢复至满状态）`);
  }

  /** 在场景图上做 BFS 找最近的 tag 匹配场景（给 inn 寻路用） */
  nearestSceneByTag(tag) {
    const ss = this.engine.getSystem('SceneSystem');
    const start = this.gameState.mapState?.currentSceneId;
    if (!start) return null;
    const visited = new Set([start]);
    const queue = [{ id: start, dist: 0, path: [] }];
    while (queue.length) {
      const { id, dist, path } = queue.shift();
      const scene = ss.getScene(id);
      if (scene && (scene.tags || []).includes(tag) && id !== start) {
        return { sceneId: id, name: scene.name, distance: dist, path };
      }
      for (const c of (scene?.connections || [])) {
        if (!visited.has(c.to)) {
          visited.add(c.to);
          queue.push({ id: c.to, dist: dist + 1, path: [...path, c.to] });
        }
      }
    }
    return null;
  }

  /** 场景图旅行 */
  async travelTo(sceneId, _autoPathDepth = 0) {
    const sceneSystem = this.engine.getSystem('SceneSystem');
    // 容错：如果目标不是直接可达邻居，自动 BFS 找一步路径，走相邻第一跳
    const adjacentReachable = sceneSystem.getAdjacent(this.gameState)
      .filter(a => a.reachable)
      .map(a => a.scene.id);
    if (!adjacentReachable.includes(sceneId)) {
      if (_autoPathDepth >= 1) {
        // 已经递归过一次还没能走出，说明 BFS 给了一个 reachable=false 的节点；放弃
        this.gameState.addNarrative('system', `（${sceneId} 路径中存在门控/隐藏，自动寻路失败）`);
        return false;
      }
      const start = this.gameState.mapState?.currentSceneId;
      if (start && start !== sceneId) {
        // BFS：仅走 reachable 邻居（与 getAdjacent 一致），避免选到 hidden/gated 死胡同
        const visited = new Set([start]);
        const queue = [{ id: start, path: [] }];
        let foundPath = null;
        const reachableNeighbors = (id) => {
          // 临时把 mapState.currentSceneId 切到 id 来询问 SceneSystem
          const saved = this.gameState.mapState.currentSceneId;
          this.gameState.mapState.currentSceneId = id;
          const adj = sceneSystem.getAdjacent(this.gameState).filter(a => a.reachable).map(a => a.scene.id);
          this.gameState.mapState.currentSceneId = saved;
          return adj;
        };
        while (queue.length) {
          const { id, path } = queue.shift();
          if (id === sceneId) { foundPath = path; break; }
          for (const nid of reachableNeighbors(id)) {
            if (!visited.has(nid)) {
              visited.add(nid);
              queue.push({ id: nid, path: [...path, nid] });
            }
          }
        }
        if (foundPath && foundPath.length > 0) {
          this.gameState.addNarrative('system', `（自动寻路：经过 ${foundPath.length} 步前往 ${sceneId}）`);
          return this._travelAlongPath(foundPath);
        }
      }
      this.gameState.addNarrative('system', `（${sceneId} 不在邻居，且无路可达）`);
      return false;
    }
    const check = sceneSystem.canTravelTo(this.gameState, sceneId);
    if (!check.ok) {
      this.gameState.addNarrative('system', `（${check.reason}）`);
      return false;
    }
    const fromScene = sceneSystem.getCurrentScene(this.gameState);
    const result = sceneSystem.performTravel(this.gameState, sceneId);
    if (!result) return false;
    const { scene, isFirstVisit, connection } = result;
    const label = connection?.label || `前往 ${scene.name}`;
    this.gameState.addNarrative('player', label);

    if (!isFirstVisit) {
      const v = sceneSystem.pickVignette(scene);
      if (v) this.gameState.addNarrative('gm', v);
    } else {
      try {
        await this.engine.getSystem('AIGMEngine').processGameAction('narrate_scene_arrival', {
          fromScene: fromScene ? { id: fromScene.id, name: fromScene.name } : null,
          toScene: { id: scene.id, name: scene.name, description: scene.description, type: scene.type, tags: scene.tags || [] },
          connectionLabel: connection?.label || '',
        }, this.gameState);
      } catch {
        if (scene.description) this.gameState.addNarrative('gm', scene.description);
      }
    }

    // 自动 meetNPC（场景里所有活着的 NPC）
    const npcSystem = this.engine.getSystem('NPCSystem');
    if (npcSystem) {
      const inScene = npcSystem.getNPCsInScene(this.gameState, scene.id, true);
      for (const { npc } of inScene) npcSystem.meetNPC(this.gameState, npc.id);
      for (const cid of (this.gameState.companions || [])) npcSystem.meetNPC(this.gameState, cid);
    }

    // 扫场景挂载的事件
    if (scene.events && scene.events.length > 0) {
      const cm = this.engine.getSystem('CardManager');
      const candidates = scene.events
        .map(id => cm.getCard(id))
        .filter(e => e && (!e.repeatable ? !this.gameState.completedEventIds.includes(e.id) : true));
      candidates.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      if (candidates[0]) {
        await this._triggerEvent(candidates[0].id);
      }
    }
    return true;
  }

  async _travelAlongPath(path) {
    if (!path || path.length === 0) return false;
    for (let i = 0; i < path.length; i++) {
      const isFinal = i === path.length - 1;
      const ok = await this.travelToAdjacent(path[i], { narrateWithAI: isFinal });
      if (!ok) return false;
      if (this.gameState.activeEvent || this.gameState.activeCombat) return true;
    }
    return true;
  }

  async travelToAdjacent(sceneId, { narrateWithAI = true } = {}) {
    const sceneSystem = this.engine.getSystem('SceneSystem');
    const check = sceneSystem.canTravelTo(this.gameState, sceneId);
    if (!check.ok) {
      this.gameState.addNarrative('system', `（${check.reason}）`);
      return false;
    }
    const fromScene = sceneSystem.getCurrentScene(this.gameState);
    const result = sceneSystem.performTravel(this.gameState, sceneId);
    if (!result) return false;
    const { scene, isFirstVisit, connection } = result;
    const label = connection?.label || `前往 ${scene.name}`;
    this.gameState.addNarrative('player', label);

    if (!narrateWithAI) {
      this.gameState.addNarrative('gm', scene.vignettes?.[0] || `你们经过${scene.name}，继续向目标前进。`);
    } else if (!isFirstVisit) {
      const v = sceneSystem.pickVignette(scene);
      if (v) this.gameState.addNarrative('gm', v);
    } else {
      try {
        await this.engine.getSystem('AIGMEngine').processGameAction('narrate_scene_arrival', {
          fromScene: fromScene ? { id: fromScene.id, name: fromScene.name } : null,
          toScene: { id: scene.id, name: scene.name, description: scene.description, type: scene.type, tags: scene.tags || [] },
          connectionLabel: connection?.label || '',
        }, this.gameState);
      } catch {
        if (scene.description) this.gameState.addNarrative('gm', scene.description);
      }
    }

    const npcSystem = this.engine.getSystem('NPCSystem');
    if (npcSystem) {
      const inScene = npcSystem.getNPCsInScene(this.gameState, scene.id, true);
      for (const { npc } of inScene) npcSystem.meetNPC(this.gameState, npc.id);
      for (const cid of (this.gameState.companions || [])) npcSystem.meetNPC(this.gameState, cid);
    }

    if (scene.events && scene.events.length > 0) {
      const cm = this.engine.getSystem('CardManager');
      const candidates = scene.events
        .map(id => cm.getCard(id))
        .filter(e => e && (!e.repeatable ? !this.gameState.completedEventIds.includes(e.id) : true));
      candidates.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      if (candidates[0]) await this._triggerEvent(candidates[0].id);
    }
    return true;
  }

}

// ============================================================
// BasePlayer — 玩家侧"上下文/目标推断"共享基类（不含任何 LLM 决策）
//
// 设计结论：不再用本地模型 / API 扮演玩家。玩家只由 (a) 人类手动 /
//   MCP 客户端，或 (b) 确定性脚本启发式来扮演。本类只提供 buildContext /
//   buildCombatContext / 主线目标推断等纯函数工具，decide()/decideCombat()
//   由子类（Scripted / CodexManual / Interactive）各自实现，均无 LLM 调用。
// ============================================================
class BasePlayer {
  constructor(endpoint, apiKey, model) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.model = model;
    this.callCount = 0;
    this.totalTokens = 0;
    this.totalPrompt = 0;
    this.totalCompletion = 0;
  }

  buildContext(app) {
    const gs = app.gameState;
    const sceneSystem = app.engine.getSystem('SceneSystem');
    const cm = app.engine.getSystem('CardManager');
    const current = sceneSystem.getCurrentScene(gs);
    const visited = new Set(gs.mapState.visitedSceneIds || []);
    const adjacent = sceneSystem.getAdjacent(gs);

    const chars = gs.activeCharacters.map(c => ({
      id: c.id, name: c.name,
      hp: `${c.stats.hpCurrent}/${c.stats.hp}`,
      hpPct: Math.round((c.stats.hpCurrent / Math.max(1, c.stats.hp)) * 100),
      mp: `${c.stats.mpCurrent}/${c.stats.mp}`,
      alive: c.stats.hpCurrent > 0,
      inventory: c.inventory || [],
    }));

    // 当前小队所有可用消耗品（heal/buff）
    const usableItems = [];
    for (const c of gs.activeCharacters) {
      for (const itemId of (c.inventory || [])) {
        const item = cm ? cm.getCard(itemId) : null;
        if (item && item.itemType === 'consumable' && item.consumeEffect) {
          usableItems.push({
            owner: c.id, itemId, name: item.name,
            effect: item.consumeEffect.type === 'heal'
              ? `${item.consumeEffect.stat || 'hp'}+${item.consumeEffect.value || 0}`
              : 'buff',
          });
        }
      }
    }

    // 队伍 HP 比例最低
    const lowestHpPct = chars.filter(c => c.alive).reduce((m, c) => Math.min(m, c.hpPct), 100);
    // 最近的 inn（HP 低时给 AI 提示）
    let nearestInn = null;
    if (lowestHpPct < 50) {
      nearestInn = app.nearestSceneByTag('inn') || app.nearestSceneByTag('safe');
    }

    const recent = gs.narrativeLog.slice(-10).map(n => {
      const lbl = { gm: 'GM', player: '我', system: '系统' }[n.speaker] || n.speaker;
      return `[${lbl}] ${n.text.slice(0, 200)}`;
    });

    let situation = 'travel', detail = null;
    if (gs.activeEvent) {
      situation = 'event';
      detail = {
        eventName: gs.activeEvent.name,
        eventType: gs.activeEvent.eventType,
        description: gs.activeEvent.description,
        choices: (gs.activeEvent.choices || []).map(c => ({ id: c.id, text: c.text })),
      };
    } else if (current) {
      // 旅行选择
      detail = {
        currentScene: { id: current.id, name: current.name, description: current.description, type: current.type, tags: current.tags || [] },
        neighbors: adjacent.map(a => {
          const hide = !a.reachable && !visited.has(a.scene.id);
          return {
            sceneId: a.scene.id,
            sceneName: hide ? '???' : a.scene.name,
            label: a.connection.label || '前往',
            reachable: a.reachable,
            lockedReason: a.reachable ? null : a.lockedReason,
            visited: visited.has(a.scene.id),
          };
        }),
      };
    }

    // —— 根据剧本规则推导"下一步主线目标"
    // 通用思路：从主线事件清单里找出"已 unlock 但未完成"的第一个 main 事件，
    // 给 AI 一个明确的"该去哪"提示，避免完成 crown_a 后死循环。
    const nextObjective = this._inferNextObjective(app, gs);

    return {
      situation, detail, chars, recent,
      completed: gs.completedEventIds, variables: gs.variables,
      usableItems, lowestHpPct, nearestInn,
      worldFlags: gs.worldFlags || {},
      companions: gs.companions || [],
      nextObjective,
    };
  }

  /** 推断下一个主线目标（事件 id + 名 + inScene 提示） */
  _inferNextObjective(app, gs) {
    const cm = app.engine.getSystem('CardManager');
    const triggerEngine = app.engine.getSystem('EventTriggerEngine');
    if (!cm) return null;
    const allEvents = (app.preset.events || []);
    const mainEvents = allEvents.filter(e => (e.tags || []).includes('main'));
    const completedSet = new Set(gs.completedEventIds || []);
    const introDone = allEvents.some(e =>
      (e.tags || []).includes('intro') && completedSet.has(e.id)
    );
    // 候选：未完成的 main 事件
    const candidates = mainEvents
      .filter(e => !completedSet.has(e.id))
      .filter(e => {
        if (introDone && (e.tags || []).includes('intro')) return false;
        // 评估 requireVariables / requireCompletedEvents 是否已满足（即"可触发"）
        const cond = e.trigger?.condition || {};
        for (const exE of (cond.excludeCompletedEvents || [])) {
          if (completedSet.has(exE)) return false;
        }
        for (const [k, v] of Object.entries(cond.requireVariables || {})) {
          if (gs.variables?.[k] !== v) return false;
        }
        for (const reqE of (cond.requireCompletedEvents || [])) {
          if (!completedSet.has(reqE)) return false;
        }
        return true;
      })
      .map(e => ({
        event: e,
        pathDistance: this._distanceToAnyScene(app, gs, e.trigger?.condition?.inScene || []),
      }))
      .filter(o => o.pathDistance !== Infinity);
    if (candidates.length === 0) return null;
    // 取 priority 高且当前可达的目标；同优先级时优先近处，避免盯着尚未开放的远端 boss。
    candidates.sort((a, b) =>
      ((b.event.priority || 0) - (a.event.priority || 0))
      || (a.pathDistance - b.pathDistance)
    );
    const next = candidates[0].event;
    const inScene = next.trigger?.condition?.inScene || [];
    return {
      eventId: next.id,
      eventName: next.name,
      inScene,                              // 该事件挂在哪些场景
      hint: `目标事件「${next.name}」(${next.id})${inScene.length ? `，需要前往：${inScene.join(' / ')}` : ''}`,
    };
  }

  _distanceToAnyScene(app, gs, targetSceneIds) {
    if (!targetSceneIds || targetSceneIds.length === 0) return 0;
    const targets = new Set(targetSceneIds);
    const sceneSystem = app.engine.getSystem('SceneSystem');
    const start = gs.mapState?.currentSceneId;
    if (!start) return Infinity;
    if (targets.has(start)) return 0;

    const visited = new Set([start]);
    const queue = [{ id: start, dist: 0 }];
    while (queue.length) {
      const { id, dist } = queue.shift();
      const saved = gs.mapState.currentSceneId;
      gs.mapState.currentSceneId = id;
      const neighbors = sceneSystem.getAdjacent(gs).filter(a => a.reachable).map(a => a.scene.id);
      gs.mapState.currentSceneId = saved;
      for (const nid of neighbors) {
        if (visited.has(nid)) continue;
        if (targets.has(nid)) return dist + 1;
        visited.add(nid);
        queue.push({ id: nid, dist: dist + 1 });
      }
    }
    return Infinity;
  }

  buildCombatContext(app, currentCharacter) {
    const gs = app.gameState;
    const combat = gs.activeCombat;
    const aliveEnemies = combat.enemies.filter(e => e.stats.hpCurrent > 0)
      .map(e => ({ id: e.id, name: e.name, hp: e.stats.hpCurrent }));
    return {
      round: combat.round,
      yourTurn: {
        id: currentCharacter.id, name: currentCharacter.name,
        hp: `${currentCharacter.stats.hpCurrent}/${currentCharacter.stats.hp}`,
        mp: `${currentCharacter.stats.mpCurrent}/${currentCharacter.stats.mp}`,
        abilities: (currentCharacter.abilities || []).map(a => `${a.id}:${a.name}(mp${a.cost?.mp || 0})`),
      },
      enemies: aliveEnemies,
      allies: gs.activeCharacters
        .filter(c => c.stats.hpCurrent > 0 && c.id !== currentCharacter.id)
        .map(c => ({ id: c.id, name: c.name, hp: `${c.stats.hpCurrent}/${c.stats.hp}` })),
    };
  }

}

// ============================================================
// ScriptedPlayer — 不调用玩家侧 AI，由脚本扮演玩家
// ============================================================
class ScriptedPlayer extends BasePlayer {
  constructor() {
    super('', '', 'scripted-codex-player');
  }

  async decide(context) {
    if (context.situation === 'event' && context.detail) {
      return {
        reasoning: '按主线推进',
        action: { type: 'choose', choiceId: this._pickChoice(context.detail.choices || []) },
      };
    }

    // 低血先用药
    if (context.lowestHpPct < 40 && context.usableItems.length > 0) {
      const item = context.usableItems[0];
      return {
        reasoning: '低血量用药',
        action: { type: 'use_item', itemId: item.itemId, targetId: item.owner },
      };
    }

    // 没药又低血、或有队员倒地 → 休整回满（避免直扑高阶目标被团灭）。
    // 这是上轮 deepseek 玩测的发现：scripted 一路莽冲、主角倒地仍硬推 → party-wiped。
    const someoneDown = (context.chars || []).some(c => c.alive === false);
    if ((context.lowestHpPct < 50 && context.usableItems.length === 0) || someoneDown) {
      return { reasoning: someoneDown ? '有人倒地，休整' : '低血无药，休整', action: { type: 'manual_rest' } };
    }

    if (context.nextObjective?.inScene?.length) {
      const target = context.nextObjective.inScene[0];
      const currentSceneId = context.detail?.currentScene?.id;
      if (target && target !== currentSceneId) {
        return {
          reasoning: '前往主线目标',
          action: { type: 'travel', sceneId: target },
        };
      }
    }

    const reachable = (context.detail?.neighbors || []).filter(n => n.reachable);
    const unvisited = reachable.find(n => !n.visited);
    const next = unvisited || reachable[0];
    if (next) {
      return {
        reasoning: '探索可达节点',
        action: { type: 'travel', sceneId: next.sceneId },
      };
    }

    return { reasoning: '无可用行动', action: { type: 'say', text: '我停下来整理线索。' } };
  }

  async decideCombat(context) {
    const enemies = [...context.enemies].sort((a, b) => a.hp - b.hp);
    const target = enemies[0];
    if (!target) return { reasoning: '无敌人', action: { actionType: 'attack', targetId: '' } };

    const mpCurrent = parseInt(String(context.yourTurn.mp).split('/')[0], 10) || 0;
    const abilities = (context.yourTurn.abilities || [])
      .map(raw => {
        const m = String(raw).match(/^([^:]+):(.+)\(mp(\d+)\)$/);
        return m ? { id: m[1], name: m[2], mp: parseInt(m[3], 10) || 0 } : null;
      })
      .filter(Boolean)
      .filter(a => a.mp <= mpCurrent);
    const ability = abilities.find(a => a.mp > 0) || null;
    if (ability) {
      return {
        reasoning: '技能集火',
        action: { actionType: 'ability', abilityId: ability.id, targetId: target.id },
      };
    }
    return {
      reasoning: '普攻低血量',
      action: { actionType: 'attack', targetId: target.id },
    };
  }

  _pickChoice(choices) {
    if (choices.length === 0) return '';
    const scored = choices.map((choice, idx) => {
      const text = `${choice.id || ''} ${choice.text || ''}`.toLowerCase();
      let score = 100 - idx;
      if (/接受|帮助|调查|继续|进入|开启|同意|相信|保护|拯救|净化|光明|联盟|揭露|追踪|前进/.test(text)) score += 80;
      if (/逃|放弃|拒绝|攻击村民|背叛|黑暗|献祭|离开/.test(text)) score -= 120;
      if (/隐藏|真相|王冠|封印|仪式|主线/.test(text)) score += 40;
      return { choice, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].choice.id;
  }
}

// ============================================================
// CodexManualPlayer — 手动指定路线，不做玩家侧推理
// ============================================================
class CodexManualPlayer extends BasePlayer {
  constructor() {
    super('', '', 'codex-manual-player');
  }

  async decide(context) {
    if (context.situation === 'event' && context.detail) {
      const choiceId = this._manualChoice(context.detail.eventName, context.detail.choices || []);
      return {
        reasoning: '手动选择',
        action: { type: 'choose', choiceId },
      };
    }

    if (context.lowestHpPct < 60) {
      return {
        reasoning: '手动休整',
        action: { type: 'manual_rest' },
      };
    }

    const completed = new Set(context.completed || []);
    const vars = context.variables || {};
    const current = context.detail?.currentScene?.id;
    const target = this._manualTravelTarget(completed, vars, current);
    if (target) {
      return {
        reasoning: '手动前进',
        action: { type: 'travel', sceneId: target },
      };
    }

    return {
      reasoning: '手动收束',
      action: { type: 'end', reason: 'manual route complete or no target' },
    };
  }

  async decideCombat(context) {
    const enemies = [...context.enemies].sort((a, b) => a.hp - b.hp);
    const target = enemies[0];
    if (!target) return { reasoning: '无敌人', action: { actionType: 'attack', targetId: '' } };
    const mpCurrent = parseInt(String(context.yourTurn.mp).split('/')[0], 10) || 0;
    const usable = (context.yourTurn.abilities || [])
      .map(raw => String(raw).match(/^([^:]+):(.+)\(mp(\d+)\)$/))
      .filter(Boolean)
      .map(m => ({ id: m[1], mp: parseInt(m[3], 10) || 0 }))
      .filter(a => a.mp > 0 && a.mp <= mpCurrent);
    if (usable[0]) {
      return {
        reasoning: '手动技能',
        action: { actionType: 'ability', abilityId: usable[0].id, targetId: target.id },
      };
    }
    return {
      reasoning: '手动普攻',
      action: { actionType: 'attack', targetId: target.id },
    };
  }

  _manualChoice(eventName, choices) {
    const first = choices[0]?.id || '';
    if (/快速旅行|驿马服务/.test(eventName)) {
      return choices.find(c => /算了|取消|不/.test(c.text))?.id || first;
    }
    if (/虚空之厅/.test(eventName)) {
      return choices.find(c => /拒绝|打/.test(c.text))?.id || first;
    }
    return first;
  }

  _manualTravelTarget(completed, vars, current) {
    const steps = [
      { until: () => completed.has('ev_astra_hub_intro'), target: 'scene_astra_square' },
      { until: () => completed.has('ev_temple_blessing'), target: 'scene_astra_temple' },
      { until: () => completed.has('ev_thorn_hunter_meet'), target: 'scene_thorn_hut' },
      { until: () => completed.has('ev_goblin_throne_loot') || vars.has_crown_a, target: 'scene_gmine_throne' },
      { until: () => completed.has('ev_marsh_witch_meet'), target: 'scene_marsh_witch_hut' },
      { until: () => completed.has('ev_marsh_loot') || vars.has_crown_b, target: 'scene_marsh_altar' },
      { until: () => completed.has('ev_keep_council'), target: 'scene_keep_war_room' },
      { until: () => completed.has('ev_range_loot') || vars.has_crown_c, target: 'scene_range_dragon_lair' },
      { until: () => completed.has('ev_spire_void'), target: 'scene_spire_void' },
      { until: () => completed.has('ev_spire_pinnacle'), target: 'scene_spire_pinnacle' },
      { until: () => completed.has('ev_ending_light') || completed.has('ev_ending_complete') || vars.game_complete, target: 'scene_ending_light' },
    ];
    const next = steps.find(step => !step.until());
    if (!next) return null;
    return next.target === current ? null : next.target;
  }
}

// ============================================================
// InteractivePlayer — 真·人工玩家：把 GM 叙述+选项写文件，阻塞等命令
//   命令文件 (--cmd-file, 默认 /tmp/play_cmd.txt):
//     choose <n|id>   选事件选项（n 为 1 起序号）
//     go <n|id>       前往邻接场景（n 为 1 起序号）
//     rest            手动休整
//     item <itemId>   使用消耗品
//     end             结束
//   快照文件 (--out-file, 默认 /tmp/play_out.json): 每回合刷新
// ============================================================
class InteractivePlayer extends BasePlayer {
  constructor(cmdFile, outFile) {
    super('', '', 'interactive-player');
    this.cmdFile = cmdFile;
    this.outFile = outFile;
    this.turn = 0;
  }

  _writeSnapshot(context, app) {
    this.turn++;
    const gs = app.gameState;
    const narrative = gs.narrativeLog.slice(-8).map(n => {
      const lbl = { gm: 'GM', player: '我', system: '系统' }[n.speaker] || n.speaker;
      return `[${lbl}] ${n.text}`;
    });
    let options = [];
    if (context.situation === 'event' && context.detail) {
      options = (context.detail.choices || []).map((c, i) => ({ n: i + 1, id: c.id, text: c.text }));
    } else if (context.detail) {
      options = (context.detail.neighbors || [])
        .filter(nb => nb.reachable)
        .map((nb, i) => ({ n: i + 1, id: nb.sceneId, text: `${nb.label} → ${nb.sceneName}${nb.visited ? '(去过)' : ''}` }));
    }
    const snap = {
      turn: this.turn,
      situation: context.situation,
      scene: context.detail?.currentScene || null,
      event: context.situation === 'event' ? { name: context.detail.eventName, desc: context.detail.description } : null,
      party: context.chars.map(c => `${c.name} ${c.hp}(${c.hpPct}%)`),
      lowestHpPct: context.lowestHpPct,
      usableItems: context.usableItems,
      nextObjective: context.nextObjective || null,
      narrative,
      options,
      completedCount: (context.completed || []).length,
    };
    fs.writeFileSync(this.outFile, JSON.stringify(snap, null, 2), 'utf-8');
    fs.writeFileSync(this.outFile + '.ready', String(this.turn), 'utf-8');
  }

  _readCommand() {
    // 阻塞轮询命令文件，要求其首行 token = 当前 turn（避免吃旧命令）
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      try {
        if (fs.existsSync(this.cmdFile)) {
          const raw = fs.readFileSync(this.cmdFile, 'utf-8').trim();
          if (raw) {
            const [tok, ...rest] = raw.split(/\s+/);
            if (parseInt(tok, 10) === this.turn) {
              fs.unlinkSync(this.cmdFile);
              return rest.join(' ').trim();
            }
          }
        }
      } catch { /* retry */ }
      // 同步阻塞 500ms（真睡眠，不烧 CPU）
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    return 'end';
  }

  async decide(context) {
    this._writeSnapshot(context, this.app);
    const cmd = this._readCommand();
    const [verb, arg] = cmd.split(/\s+/);
    const byNorId = (list, getId) => {
      const n = parseInt(arg, 10);
      if (!isNaN(n) && n >= 1 && n <= list.length) return getId(list[n - 1]);
      return arg;
    };
    if (verb === 'choose' && context.situation === 'event') {
      const choices = context.detail.choices || [];
      const id = byNorId(choices, c => c.id);
      return { reasoning: `[人工] choose ${arg}`, action: { type: 'choose', choiceId: id } };
    }
    if (verb === 'go') {
      const nbs = (context.detail?.neighbors || []).filter(n => n.reachable);
      const id = byNorId(nbs, n => n.sceneId);
      return { reasoning: `[人工] go ${arg}`, action: { type: 'travel', sceneId: id } };
    }
    if (verb === 'rest') return { reasoning: '[人工] rest', action: { type: 'manual_rest' } };
    if (verb === 'item') return { reasoning: `[人工] item ${arg}`, action: { type: 'use_item', itemId: arg } };
    if (verb === 'end') return { reasoning: '[人工] end', action: { type: 'end' } };
    // 兜底：当作 choose/go 的第一项
    if (context.situation === 'event') return { reasoning: '[人工] 默认首选', action: { type: 'choose', choiceId: (context.detail.choices || [])[0]?.id } };
    const nbs = (context.detail?.neighbors || []).filter(n => n.reachable);
    return { reasoning: '[人工] 默认前进', action: { type: 'travel', sceneId: nbs[0]?.sceneId } };
  }

  // 战斗交给自动策略（评估重点是 GM 叙述，不是战棋手操）
  async decideCombat(context) {
    const enemies = [...context.enemies].sort((a, b) => a.hp - b.hp);
    const target = enemies[0];
    if (!target) return { reasoning: '无敌人', action: { actionType: 'attack', targetId: '' } };
    const mpCurrent = parseInt(String(context.yourTurn.mp).split('/')[0], 10) || 0;
    const usable = (context.yourTurn.abilities || [])
      .map(raw => String(raw).match(/^([^:]+):(.+)\(mp(\d+)\)$/)).filter(Boolean)
      .map(m => ({ id: m[1], mp: parseInt(m[3], 10) || 0 })).filter(a => a.mp > 0 && a.mp <= mpCurrent);
    if (usable[0]) return { reasoning: '自动技能', action: { actionType: 'ability', abilityId: usable[0].id, targetId: target.id } };
    return { reasoning: '自动普攻', action: { actionType: 'attack', targetId: target.id } };
  }
}

// ============================================================
// 主循环
// ============================================================
async function gameLoop(app, playerAI, maxIter = 60) {
  let consecutiveErrors = 0;
  for (let i = 0; i < maxIter; i++) {
    // 终止
    if (app.isMainQuestComplete()) {
      console.log('★ 主线完成');
      return 'main-quest-done';
    }
    if (app.gameState.activeCharacters.every(c => c.stats.hpCurrent <= 0)) {
      console.log('✗ 全队倒下');
      return 'party-wiped';
    }

    // 战斗已由对局核心（GameSession）在 resolveEventChoice/travel 内自动结算，
    // 用确定性启发式（含同行伙伴），此处无需再单独驱动战斗回合。

    // 主决策
    const ctx = playerAI.buildContext(app);
    let decision;
    try {
      decision = await playerAI.decide(ctx);
      consecutiveErrors = 0;
    } catch (e) {
      consecutiveErrors++;
      console.warn(`[iter ${i + 1}] Player AI 失败: ${e.message}`);
      if (consecutiveErrors >= 3) return 'player-ai-failed';
      continue;
    }

    const a = decision.action;
    const shortAction = JSON.stringify(a).slice(0, 100);
    console.log(`[iter ${i + 1}] ${ctx.situation} | ${decision.reasoning} → ${shortAction}`);

    if (!a) continue;
    if (a.type === 'choose') {
      const ev = app.gameState.activeEvent;
      if (ev) await app.resolveEventChoice(ev.id, a.choiceId);
    } else if (a.type === 'travel') {
      await app.travelTo(a.sceneId);
    } else if (a.type === 'use_item') {
      app.useItem(a.itemId, null, a.targetId || null);
    } else if (a.type === 'manual_rest') {
      app._healPartyToFull('手动测试休整');
    } else if (a.type === 'say') {
      app.gameState.addNarrative('player', a.text);
    } else if (a.type === 'end') {
      if (app.isMainQuestComplete()) return 'player-end';
      console.warn(`[iter ${i + 1}] 主线未完成不能 end，继续`);
    }
  }
  return 'max-iterations';
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('=== TRPG 大型剧本玩测（GM=AI 叙述者 / 玩家=人或脚本，无 LLM 玩家）===');
  const playerLabel = {
    manual: 'CodexManual (固定路线)',
    interactive: 'Interactive (人/MCP)',
    scripted: 'Scripted (确定性启发式)',
  }[PLAYER_MODE] || 'Scripted (确定性启发式)';
  console.log(`Player: ${playerLabel}  GM: ${GM_MODEL}`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Preset: ${PRESET_PATH}`);
  console.log(`Max iter: ${MAX_ITER}`);

  const app = new HeadlessApp();
  const aiEngine = app.engine.getSystem('AIGMEngine');
  aiEngine.setAPIConfig({
    endpoint: ENDPOINT,
    apiKey: KEY,
    model: GM_MODEL,
    maxTokens: 3200,
    temperature: 0.7,
    timeoutMs: API_TIMEOUT_MS,
    // OPENAI_API_STYLE=responses → 走 /responses(如 hy3-preview)；省略=自动(/chat/completions 或按 endpoint 探测)
    ...(process.env.OPENAI_API_STYLE ? { apiStyle: process.env.OPENAI_API_STYLE } : {}),
  });

  // 加载自定义预设
  let presetData;
  if (fs.existsSync(PRESET_PATH)) {
    presetData = JSON.parse(fs.readFileSync(PRESET_PATH, 'utf-8'));
    console.log(`✓ 已读取预设: ${presetData.name}`);
  } else {
    console.warn(`⚠ 预设文件不存在: ${PRESET_PATH}，回退 DEFAULT_PRESET`);
    presetData = DEFAULT_PRESET;
  }

  // 自动选 starting choices（如果有 startingOptions，挑第一个）
  let choices = null;
  if (presetData.startingOptions) {
    choices = {};
    for (const axis of ['races', 'origins', 'backgrounds', 'faiths']) {
      const opts = presetData.startingOptions[axis] || [];
      if (opts.length > 0) choices[axis] = opts[0].id;
    }
    console.log(`✓ 角色创建: ${JSON.stringify(choices)}`);
  }

  app.loadPreset(presetData, choices);
  console.log(`已加载: ${app.preset.name}（${app.preset.scenes?.length || 0} 节点 / ${app.preset.events?.length || 0} 事件 / ${app.preset.npcs?.length || 0} NPC）`);
  console.log(`起始场景: ${app.gameState.mapState?.currentSceneId}`);

  // 初始扫描
  await app.kickoff();

  const startMs = Date.now();
  // 玩家由人/脚本扮演（不再有 LLM 玩家）：
  //   interactive = 人类手动 / MCP 出招；manual = 固定路线；scripted（默认）= 确定性启发式
  const playerAI = PLAYER_MODE === 'interactive'
    ? new InteractivePlayer(argVal('--cmd-file', '/tmp/play_cmd.txt'), argVal('--out-file', '/tmp/play_out.json'))
    : (PLAYER_MODE === 'manual'
      ? new CodexManualPlayer()
      : new ScriptedPlayer());
  playerAI.app = app;
  const status = await gameLoop(app, playerAI, MAX_ITER);
  const elapsedMs = Date.now() - startMs;
  console.log(`\n=== 终止状态: ${status} (${(elapsedMs / 1000).toFixed(1)}s) ===`);

  // 计算压测指标
  const totalScenes = app.preset.scenes.length;
  const visitedScenes = new Set(app.gameState.mapState?.visitedSceneIds || []);
  const sceneCoverage = (visitedScenes.size / totalScenes * 100).toFixed(1);
  const totalEvents = app.preset.events.length;
  const completedEvents = app.gameState.completedEventIds.length;
  const eventCoverage = (completedEvents / totalEvents * 100).toFixed(1);
  const npcsTotal = app.preset.npcs?.length || 0;
  const knownNPCs = npcsTotal > 0 ? Object.entries(app.gameState.npcState || {}).filter(([, v]) => v.knownTo).length : 0;

  const gmStats = aiEngine.getTokenStats();
  const totalTokens = gmStats.totalTokens + playerAI.totalTokens;
  const totalCalls = gmStats.totalCalls + playerAI.callCount;
  const avgLatencyMs = elapsedMs / Math.max(1, totalCalls);

  const stressMetrics = `
## 压力测试指标

- **场景覆盖率**: ${sceneCoverage}% (${visitedScenes.size}/${totalScenes})
- **事件覆盖率**: ${eventCoverage}% (${completedEvents}/${totalEvents})
- **NPC 遇见**: ${knownNPCs} / ${npcsTotal}
- **同行伙伴**: ${(app.gameState.companions || []).length}
- **故事时间**: Day ${app.gameState.storyTime?.day || 1}, Hour ${app.gameState.storyTime?.hour || 0}
- **总耗时**: ${(elapsedMs / 1000).toFixed(1)}s
- **AI 调用合计**: ${totalCalls} 次 (GM ${gmStats.totalCalls} + Player ${playerAI.callCount})
- **Token 合计**: ${totalTokens.toLocaleString()} (GM ${gmStats.totalTokens.toLocaleString()} + Player ${playerAI.totalTokens.toLocaleString()})
- **平均时延/调用**: ${avgLatencyMs.toFixed(0)} ms
- **终止状态**: ${status}
`;

  // 导出日志
  const logSystem = app.engine.getSystem('LogSystem');
  const md = logSystem.generateMarkdown(app.gameState, app.preset);
  const json = JSON.stringify({
    ...logSystem.generateReport(app.gameState, app.preset),
    stressMetrics: { sceneCoverage, eventCoverage, knownNPCs, npcsTotal, totalTokens, totalCalls, elapsedMs, status },
  }, null, 2);
  const ts = new Date().toISOString().substring(0, 19).replace(/[:T]/g, '-');
  const playerStats = `\n## 玩家侧\n\n- 模式: ${PLAYER_MODE}（无 LLM 玩家）\n`;

  const outDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const mdFile = path.join(outDir, `playtest-large-${ts}.md`);
  const jsonFile = path.join(outDir, `playtest-large-${ts}.json`);
  fs.writeFileSync(mdFile, md + playerStats + stressMetrics, 'utf-8');
  fs.writeFileSync(jsonFile, json, 'utf-8');
  console.log(`✓ Markdown: ${mdFile}`);
  console.log(`✓ JSON: ${jsonFile}`);
  console.log(stressMetrics);

  app.engine.stop();
}

main().catch(e => {
  console.error('AI vs AI 玩测失败:', e);
  process.exit(1);
});
