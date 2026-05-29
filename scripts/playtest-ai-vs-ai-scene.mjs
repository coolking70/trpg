/**
 * AI vs AI 完整玩测 — 场景图版
 *
 * - 同一个 OpenAI 兼容模型扮演"玩家大脑"：观察当前场景 + 邻居，选下一步去哪 / 选择事件
 * - GM 路径由 AIGMEngine 调用，给抵达叙事 / 事件叙事
 *
 * 与旧 grid 版的差异：
 *   - 玩家决策只看 "当前场景 + 邻居 + 事件" 这三件事
 *   - 不再有"走 50 格"的填充浪费 — 每次跳节点就是一次 AI 抵达叙事
 */

import { GameEngine } from '../src/core/GameEngine.js';
import { EventSystem } from '../src/core/EventSystem.js';

import { CardManager } from '../src/systems/CardManager.js';
import { DiceSystem } from '../src/systems/DiceSystem.js';
import { MapSystem } from '../src/systems/MapSystem.js';
import { CombatSystem } from '../src/systems/CombatSystem.js';
import { TurnManager } from '../src/systems/TurnManager.js';
import { AIGMEngine } from '../src/systems/AIGMEngine.js';
import { EventTriggerEngine, TRIGGER_MOMENTS } from '../src/systems/EventTriggerEngine.js';
import { ProgressionSystem } from '../src/systems/ProgressionSystem.js';
import { MemorySystem } from '../src/systems/MemorySystem.js';
import { AllyAIController } from '../src/systems/AllyAIController.js';
import { DifficultyTracker } from '../src/systems/DifficultyTracker.js';
import { LogSystem } from '../src/systems/LogSystem.js';
import { SceneSystem } from '../src/systems/SceneSystem.js';

import { GamePreset } from '../src/models/GamePreset.js';
import { GameState } from '../src/models/GameState.js';
import { DEFAULT_PRESET } from '../src/data/defaultPreset.js';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
const PLAYER_MODEL = process.env.OPENAI_PLAYER_MODEL || process.env.OPENAI_MODEL || GM_MODEL;

// ============================================================
// HeadlessApp — 场景图版
// ============================================================
class HeadlessApp {
  constructor() {
    this.engine = new GameEngine();
    this.eventSystem = new EventSystem();
    this.gameState = null;
    this.preset = null;
    this.engine.getGameState = () => this.gameState;
    this.engine.registerSystem(this.eventSystem, 100);
    this.engine.registerSystem(new CardManager(), 80);
    this.engine.registerSystem(new DiceSystem(), 70);
    this.engine.registerSystem(new MapSystem(), 60);
    this.engine.registerSystem(new CombatSystem(), 50);
    this.engine.registerSystem(new TurnManager(), 40);
    this.engine.registerSystem(new AIGMEngine(), 30);
    this.engine.registerSystem(new EventTriggerEngine(), 35);
    this.engine.registerSystem(new ProgressionSystem(), 25);
    this.engine.registerSystem(new MemorySystem(), 28);
    this.engine.registerSystem(new AllyAIController(), 22);
    this.engine.registerSystem(new DifficultyTracker(), 21);
    this.engine.registerSystem(new LogSystem(), 5);
    this.engine.registerSystem(new SceneSystem(), 33);
    this.engine.start();
  }

  loadPreset(presetData) {
    this.preset = new GamePreset(presetData);
    this.engine.getSystem('CardManager').loadFromPreset(this.preset);
    if (this.preset.map) this.engine.getSystem('MapSystem').loadMap(this.preset.map);
    this.engine.getSystem('SceneSystem').loadFromPreset(this.preset);
    this.engine.getSystem('AIGMEngine').setPreset(this.preset);
    this.gameState = GameState.fromPreset(this.preset);
    const ms = this.engine.getSystem('MemorySystem');
    if (ms) ms.initializeFromPreset(this.gameState, this.preset);
    const lore = this.preset.lore || {};
    const greeting = lore.background
      ? `欢迎来到${lore.worldName || '未知世界'}。${lore.background}`
      : '冒险开始了...';
    this.gameState.addNarrative('gm', greeting);
  }

  /** 初始扫一次起始场景的事件（复刻 main.js 的 setTimeout 初始扫描） */
  async kickoff() {
    const sceneSystem = this.engine.getSystem('SceneSystem');
    const start = sceneSystem.getCurrentScene(this.gameState);
    if (!start) return;
    if (start.events && start.events.length > 0) {
      const cm = this.engine.getSystem('CardManager');
      const candidates = start.events
        .map(id => cm.getCard(id))
        .filter(e => e && (!e.repeatable ? !this.gameState.completedEventIds.includes(e.id) : true));
      candidates.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      if (candidates[0]) {
        await this._triggerEvent(candidates[0].id);
      }
    }
  }

  /** 复刻 _triggerEvent — 写 description + AI 叙事 + 无 choices 自动完成 */
  async _triggerEvent(eventId) {
    const cm = this.engine.getSystem('CardManager');
    const ai = this.engine.getSystem('AIGMEngine');
    const card = cm.getCard(eventId);
    if (!card) return;
    if (!card.repeatable && this.gameState.completedEventIds.includes(eventId)) return;

    this.gameState.activeEvent = card;

    try {
      await ai.processGameAction('narrate_event', { event: card }, this.gameState);
    } catch (e) {
      this.gameState.addNarrative('gm', card.description);
    }

    if (!card.choices || card.choices.length === 0) {
      // 无选项 → 直接完成
      this.gameState.activeEvent = null;
      if (!card.repeatable && !this.gameState.completedEventIds.includes(card.id)) {
        this.gameState.completedEventIds.push(card.id);
      }
      // 检查 epilogue
      if ((card.tags || []).includes('epilogue') || card.id === 'ch10_epilogue') {
        this._mainQuestComplete = true;
      }
      // 链式扫描
      await this._scanAfter(TRIGGER_MOMENTS.EVENT_COMPLETE);
    }
  }

  async _scanAfter(moment) {
    if (this.gameState.activeCombat && moment !== TRIGGER_MOMENTS.COMBAT_END) return;
    const triggerEngine = this.engine.getSystem('EventTriggerEngine');
    const ids = triggerEngine.scan(this.gameState, { moment });
    if (ids.length > 0) await this._triggerEvent(ids[0]);
  }

  /** 玩家选择事件选项 */
  async resolveEventChoice(eventId, choiceId) {
    const cm = this.engine.getSystem('CardManager');
    const ai = this.engine.getSystem('AIGMEngine');
    const memo = this.engine.getSystem('MemorySystem');
    const card = cm.getCard(eventId);
    if (!card) return null;
    const choice = (card.choices || []).find(c => c.id === choiceId);
    if (!choice) return null;

    this.gameState.addNarrative('player', `选择：${choice.text}`);

    let outcome = null;
    if (choice.outcomes && choice.outcomes.length) {
      const r = Math.random();
      let cum = 0;
      for (const o of choice.outcomes) {
        cum += o.probability || 0;
        if (r <= cum) { outcome = o; break; }
      }
      if (!outcome) outcome = choice.outcomes.at(-1);
    }
    if (outcome && outcome.effects) {
      for (const eff of outcome.effects) this._applyEventEffect(eff);
    }
    if (!card.repeatable && !this.gameState.completedEventIds.includes(eventId)) {
      this.gameState.completedEventIds.push(eventId);
    }
    this.gameState.activeEvent = null;
    if (memo) {
      memo.addKeyEvent(this.gameState, {
        summary: `${card.name}：选择"${choice.text}"${outcome ? ` → ${outcome.text}` : ''}`,
        tags: ['event', card.eventType].filter(Boolean),
      });
    }
    try {
      await ai.processGameAction('narrate_event', {
        event: card,
        choiceText: choice.text,
        outcomeText: outcome ? outcome.text : '',
      }, this.gameState);
    } catch { /* */ }

    // 检查 epilogue
    if ((card.tags || []).includes('epilogue') || card.id === 'ch10_epilogue') {
      this._mainQuestComplete = true;
    }

    // 处理战斗
    if (this.gameState.activeCombat) {
      await this._autoFinishCombat();
    }

    // 完成后扫描链式
    await this._scanAfter(TRIGGER_MOMENTS.EVENT_COMPLETE);
    return { outcome };
  }

  _applyEventEffect(eff) {
    switch (eff.type) {
      case 'add_item': {
        const c = this.gameState.activeCharacters[0];
        if (c) (c.inventory ||= []).push(eff.itemId);
        break;
      }
      case 'set_variable': this.gameState.variables[eff.name] = eff.value; break;
      case 'add_memory': {
        const m = this.engine.getSystem('MemorySystem');
        if (m) m.addKeyEvent(this.gameState, { summary: eff.value, tags: ['manual'] });
        break;
      }
      case 'start_combat': this._startCombat(eff.enemyIds || []); break;
      case 'heal':
        if (eff.target === 'all') {
          for (const c of this.gameState.activeCharacters) {
            c.stats.hpCurrent = Math.min(c.stats.hp, c.stats.hpCurrent + (eff.value || 0));
          }
        }
        break;
    }
  }

  _startCombat(enemyIds) {
    const cm = this.engine.getSystem('CardManager');
    const combat = this.engine.getSystem('CombatSystem');
    const enemies = enemyIds.map((id, idx) => ({ original: cm.getCard(id), idx }))
      .filter(o => o.original)
      .map(({ original, idx }) => {
        const clone = JSON.parse(JSON.stringify(original));
        clone._originalId = original.id;
        clone.id = `${original.id}#${idx}`;
        return clone;
      });
    if (enemies.length === 0) return;
    combat.startCombat(this.gameState, enemies);
  }

  /** 战斗：让 Pro AI 一回合一回合下令，敌人自动行动 */
  async runCombatTurns(playerAI) {
    const combat = this.engine.getSystem('CombatSystem');
    let safety = 0;
    while (this.gameState.activeCombat && safety++ < 50) {
      const c = this.gameState.activeCombat;
      const slot = c.turnOrder[c.currentActorIndex];
      if (!slot) break;
      const combatant = combat.findCombatant(this.gameState, slot.id);

      if (slot.type === 'enemy') {
        if (combatant && combatant.stats.hpCurrent > 0) {
          await this._enemyAct(slot.id);
        }
        const r = combat.nextTurn(this.gameState);
        if (r.combatEnd) { await this._endCombat(r); return; }
        continue;
      }

      if (slot.type === 'character') {
        if (!combatant || combatant.stats.hpCurrent <= 0) {
          const r = combat.nextTurn(this.gameState);
          if (r.combatEnd) { await this._endCombat(r); return; }
          continue;
        }
        // 让 Pro AI 决定该角色的行动
        const ctx = playerAI.buildCombatContext(this, combatant);
        let decision;
        try { decision = await playerAI.decideCombat(ctx); }
        catch (e) {
          // 兜底：普攻
          const enemy = c.enemies.find(e => e.stats.hpCurrent > 0);
          if (!enemy) { await this._endCombat({ result: 'victory' }); return; }
          decision = { reasoning: 'fallback', action: { actionType: 'attack', targetId: enemy.id } };
        }
        await this._handleCombatPlayerAction(combatant, decision.action);
        const r = combat.nextTurn(this.gameState);
        if (r.combatEnd) { await this._endCombat(r); return; }
      }
    }
  }

  async _handleCombatPlayerAction(actor, action) {
    const combat = this.engine.getSystem('CombatSystem');
    // Pro AI 偶尔会输出 "目标" 这种占位符 — fallback 到第一个活着的敌人
    let target = combat.findCombatant(this.gameState, action.targetId);
    if (!target) {
      const aliveEnemy = this.gameState.activeCombat.enemies.find(e => e.stats.hpCurrent > 0);
      if (aliveEnemy) {
        action.targetId = aliveEnemy.id;
        target = aliveEnemy;
      }
    }
    let intent;
    if (action.actionType === 'attack') intent = `指挥 ${actor.name} 普攻 ${target?.name || '目标'}`;
    else if (action.actionType === 'ability') {
      const ab = (actor.abilities || []).find(a => a.id === action.abilityId);
      intent = `指挥 ${actor.name} 释放「${ab?.name || action.abilityId}」对 ${target?.name || '目标'}`;
    } else intent = `执行 ${action.actionType}`;
    this.gameState.addNarrative('player', intent);

    let res = null;
    if (action.actionType === 'attack') res = combat.performAttack(this.gameState, actor.id, action.targetId);
    else if (action.actionType === 'ability') res = combat.useAbility(this.gameState, actor.id, action.abilityId, action.targetId);

    if (res && res.success) {
      const name = action.actionType === 'attack' ? '普攻'
        : (actor.abilities?.find(a => a.id === action.abilityId)?.name || '技能');
      const dmg = res.finalDamage ?? res.damage;
      const heal = res.healing;
      const detail = dmg > 0 ? `造成 ${dmg} 点伤害` : (heal > 0 ? `恢复 ${heal} HP` : '');
      const defeated = res.targetDefeated ? '，击败！' : '。';
      this.gameState.addNarrative('system', `${actor.name} 对 ${target?.name || ''} 使用 ${name}${detail ? '，' + detail : ''}${defeated}`);
    }
  }

  async _enemyAct(enemyId) {
    const combat = this.engine.getSystem('CombatSystem');
    const enemy = combat.findCombatant(this.gameState, enemyId);
    if (!enemy || enemy.stats.hpCurrent <= 0) return;
    const target = this.gameState.activeCharacters.find(c => c.stats.hpCurrent > 0);
    if (!target) return;
    const r = combat.performAttack(this.gameState, enemyId, target.id);
    if (r && r.success) {
      const dmg = r.finalDamage ?? r.damage;
      this.gameState.addNarrative('system', `${enemy.name} 攻击 ${target.name}，造成 ${dmg} 点伤害${r.targetDefeated ? '，倒下！' : '。'}`);
    }
  }

  async _endCombat(turnResult) {
    const combat = this.engine.getSystem('CombatSystem');
    combat.endCombat(this.gameState, turnResult.outcome || 'victory');
    const wasVictory = (turnResult.outcome || 'victory') === 'victory';
    this.gameState.addNarrative('system', wasVictory ? '战斗胜利！' : '战斗结束。');
    try {
      await this.engine.getSystem('AIGMEngine').processGameAction('narrate_combat', {
        roundResults: [{ narrative: wasVictory ? '战斗胜利' : '战斗失败' }],
      }, this.gameState);
    } catch { /* */ }
    // 战斗结束后扫描（让 ch10 类后续事件触发）
    await this._scanAfter(TRIGGER_MOMENTS.COMBAT_END);
  }

  async _autoFinishCombat() {
    // 当选择 outcome 中含 start_combat 时被调用 — 这里不行动，留给主循环调 runCombatTurns
  }

  /** 场景图旅行 */
  async travelTo(sceneId) {
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

  isMainQuestComplete() {
    return !!this._mainQuestComplete;
  }
}

// ============================================================
// PlayerAI — Pro 模型扮演决策者
// ============================================================
class PlayerAI {
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
    const current = sceneSystem.getCurrentScene(gs);
    const visited = new Set(gs.mapState.visitedSceneIds || []);
    const adjacent = sceneSystem.getAdjacent(gs);

    const chars = gs.activeCharacters.map(c => ({
      id: c.id, name: c.name,
      hp: `${c.stats.hpCurrent}/${c.stats.hp}`,
      mp: `${c.stats.mpCurrent}/${c.stats.mp}`,
      alive: c.stats.hpCurrent > 0,
    }));

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
        currentScene: { id: current.id, name: current.name, description: current.description, type: current.type },
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

    return { situation, detail, chars, recent, completed: gs.completedEventIds, variables: gs.variables };
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

  async decide(context) {
    const sys = `你是一支 4 人冒险小队的玩家/指挥官，正在玩桌游跑团 TRPG。
任务：完成主线（最终完成 ch10_epilogue 或带 epilogue 标签的事件）。

游戏机制：
- 地图是"场景节点图"，每个节点是一段戏，邻居之间可点击跳转
- 看到 reachable=false 的节点表示有门控，需要更多线索（去找其他场景探索）
- 当 situation=event 时，必须选事件给的选项之一
- 当 situation=travel 时，从邻居中挑选 reachable=true 的某个去

只输出一个 JSON：
{ "reasoning": "<30字内推理>", "action": <action> }

<action> 仅可为：
- 事件选择: {"type":"choose","choiceId":"..."}
- 旅行到邻居: {"type":"travel","sceneId":"..."}
- 自由发言: {"type":"say","text":"..."}
- 结束游戏: {"type":"end","reason":"..."}（只在 ch10 完成后才可用）`;

    const recentBlock = context.recent.join('\n');
    const charsBlock = context.chars.map(c =>
      `  ${c.name}(${c.id}) HP${c.hp} MP${c.mp}${c.alive ? '' : ' [倒下]'}`
    ).join('\n');

    let stateBlock = `情境: ${context.situation}\n`;
    stateBlock += `已完成: ${context.completed.join(', ') || '无'}\n`;
    stateBlock += `变量: ${JSON.stringify(context.variables)}\n`;
    stateBlock += `队伍:\n${charsBlock}\n`;

    if (context.situation === 'event' && context.detail) {
      stateBlock += `\n当前事件: ${context.detail.eventName} [${context.detail.eventType}]\n描述: ${context.detail.description}\n`;
      stateBlock += `可选:\n${context.detail.choices.map(c => `  ${c.id}: ${c.text}`).join('\n')}\n`;
    } else if (context.detail) {
      stateBlock += `\n当前场景: ${context.detail.currentScene.name} [${context.detail.currentScene.type}]\n描述: ${context.detail.currentScene.description}\n`;
      stateBlock += `邻居节点:\n`;
      for (const n of context.detail.neighbors) {
        const flag = n.reachable ? '✓' : '🔒';
        const v = n.visited ? '(去过)' : '';
        stateBlock += `  ${flag} ${n.sceneId}: ${n.sceneName} — ${n.label}${v}${n.lockedReason ? ' [' + n.lockedReason + ']' : ''}\n`;
      }
    }

    stateBlock += `\n最近叙事:\n${recentBlock}\n\n请给出下一步决策（JSON）：`;

    return await this._call(sys, stateBlock);
  }

  async decideCombat(context) {
    const sys = `你正在指挥战斗中的某个角色行动。
只输出 JSON：
{ "reasoning": "<30字内推理>", "action": <action> }
<action>:
- 普攻: {"actionType":"attack","targetId":"敌人id"}
- 技能: {"actionType":"ability","abilityId":"...","targetId":"敌人id"}
战术规则：
- MP 够时优先用技能（伤害更高）
- 目标选当前 HP 最低的敌人优先击杀`;

    const user = `当前战斗:
轮次: ${context.round}
你的角色: ${context.yourTurn.name} (id=${context.yourTurn.id}) HP${context.yourTurn.hp} MP${context.yourTurn.mp}
你的技能: ${context.yourTurn.abilities.join(' | ') || '无'}
活着的敌人: ${context.enemies.map(e => `${e.id}(${e.name},HP${e.hp})`).join(', ')}
队友: ${context.allies.map(a => `${a.name} HP${a.hp}`).join(', ')}

请给出本回合该角色的行动（JSON）：`;

    return await this._call(sys, user);
  }

  async _call(sys, user) {
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    };
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(this.endpoint)) {
      delete body.response_format;
      body.reasoning_effort = 'none';
    }
    const resp = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Player AI HTTP ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    this.callCount++;
    if (data.usage) {
      this.totalTokens += data.usage.total_tokens || 0;
      this.totalPrompt += data.usage.prompt_tokens || 0;
      this.totalCompletion += data.usage.completion_tokens || 0;
    }
    const content = data.choices?.[0]?.message?.content || '';
    try { return JSON.parse(content); } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) try { return JSON.parse(m[0]); } catch { /* */ }
      throw new Error('Player AI 返回无效 JSON: ' + content.slice(0, 120));
    }
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

    // 战斗状态：跳到战斗回合循环
    if (app.gameState.activeCombat) {
      console.log(`[iter ${i + 1}] === 进入战斗 ===`);
      await app.runCombatTurns(playerAI);
      continue;
    }

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
  console.log('=== TRPG AI vs AI 完整玩测（场景图版）===');
  console.log(`Player(Pro): ${PLAYER_MODEL}  GM: ${GM_MODEL}`);
  console.log(`Endpoint: ${ENDPOINT}`);

  const app = new HeadlessApp();
  const aiEngine = app.engine.getSystem('AIGMEngine');
  aiEngine.setAPIConfig({
    endpoint: ENDPOINT,
    apiKey: KEY,
    model: GM_MODEL,
    maxTokens: 3200,
    temperature: 0.7,
  });

  app.loadPreset(DEFAULT_PRESET);
  console.log(`已加载预设: ${app.preset.name}（${app.preset.scenes?.length || 0} 节点）`);

  // 初始扫描（复刻 main.js 的 loadPreset 末尾的 300ms setTimeout）
  await app.kickoff();

  const playerAI = new PlayerAI(ENDPOINT, KEY, PLAYER_MODEL);
  const status = await gameLoop(app, playerAI, 60);
  console.log(`\n=== 终止状态: ${status} ===`);

  // 导出日志
  const logSystem = app.engine.getSystem('LogSystem');
  const md = logSystem.generateMarkdown(app.gameState, app.preset);
  const json = JSON.stringify(logSystem.generateReport(app.gameState, app.preset), null, 2);
  const ts = new Date().toISOString().substring(0, 10);
  const playerStats = `\n## Pro Player AI 用量\n\n- 模型: ${PLAYER_MODEL}\n- 调用: ${playerAI.callCount} 次\n- Token: ${playerAI.totalTokens} (prompt ${playerAI.totalPrompt} / completion ${playerAI.totalCompletion})\n`;

  const outDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const mdFile = path.join(outDir, `playtest-ai-vs-ai-scene-${ts}.md`);
  const jsonFile = path.join(outDir, `playtest-ai-vs-ai-scene-${ts}.json`);
  fs.writeFileSync(mdFile, md + playerStats, 'utf-8');
  fs.writeFileSync(jsonFile, json, 'utf-8');
  console.log(`✓ Markdown: ${mdFile}`);
  console.log(`✓ JSON: ${jsonFile}`);

  const log = app.gameState.narrativeLog;
  const players = log.filter(n => n.speaker === 'player').length;
  const gms = log.filter(n => n.speaker === 'gm').length;
  const systems = log.filter(n => n.speaker === 'system').length;
  console.log(`\n叙事: 共 ${log.length} 条（玩家[你] ${players} / GM ${gms} / 系统 ${systems}）`);
  const gmStats = aiEngine.getTokenStats();
  console.log(`GM AI (${GM_MODEL}): ${gmStats.totalCalls} 次, ${gmStats.totalTokens} tokens`);
  console.log(`Player AI (${PLAYER_MODEL}): ${playerAI.callCount} 次, ${playerAI.totalTokens} tokens`);
  console.log(`两模型合计: ${gmStats.totalTokens + playerAI.totalTokens} tokens`);

  app.engine.stop();
}

main().catch(e => {
  console.error('AI vs AI 玩测失败:', e);
  process.exit(1);
});
