/**
 * GameSession — 权威对局核心（headless, 无 UI / 无玩家 AI）
 *
 * 单一真相源：封装游戏引擎 + 全部系统，对外暴露一套
 *   getState() / applyAction() 的"动作-状态" RPC 边界。
 *
 * 设计目标（见架构讨论）：把"权威对局"与"玩家客户端"解耦。
 *   - 现在：MCP 对局服务（game-session-server.mjs）包它，给 AI 占位玩家 / 自动化测试用。
 *   - 以后：WebSocket 适配器包同一个核心，给真人实时多人用。核心零改动。
 *
 * 不负责：UI 渲染、玩家决策（谁来出招由上层适配器/客户端决定）。
 *
 * 战斗：v1 采用可插拔的自动结算（decideCombat 默认简单启发式）。
 *   日后要做"逐回合交互式战斗（每个回合一个 action）"时，把 _autoResolveCombat
 *   换成基于 getState()/applyAction() 的逐步推进即可，getState 已预留 combat 字段。
 */

import { GameEngine } from './GameEngine.js';
import { EventSystem } from './EventSystem.js';

import { CardManager } from '../systems/CardManager.js';
import { DiceSystem } from '../systems/DiceSystem.js';
import { MapSystem } from '../systems/MapSystem.js';
import { CombatSystem } from '../systems/CombatSystem.js';
import { TurnManager } from '../systems/TurnManager.js';
import { AIGMEngine } from '../systems/AIGMEngine.js';
import { EventTriggerEngine, TRIGGER_MOMENTS } from '../systems/EventTriggerEngine.js';
import { ProgressionSystem } from '../systems/ProgressionSystem.js';
import { MemorySystem } from '../systems/MemorySystem.js';
import { AllyAIController } from '../systems/AllyAIController.js';
import { DifficultyTracker } from '../systems/DifficultyTracker.js';
import { LogSystem } from '../systems/LogSystem.js';
import { SceneSystem } from '../systems/SceneSystem.js';
import { NPCSystem } from '../systems/NPCSystem.js';
import { DialogueSystem } from '../systems/DialogueSystem.js';
import { ContextRetriever } from '../systems/ContextRetriever.js';

import { GamePreset } from '../models/GamePreset.js';
import { GameState } from '../models/GameState.js';

/** 默认战斗决策：有可用主动技能就用（集火最低血敌人），否则普攻 */
function defaultDecideCombat(combatant, enemies) {
  const target = [...enemies].filter(e => e.stats.hpCurrent > 0)
    .sort((a, b) => a.stats.hpCurrent - b.stats.hpCurrent)[0];
  if (!target) return null;
  const mp = combatant.stats.mpCurrent ?? 0;
  const ability = (combatant.abilities || []).find(a => {
    const cost = a.cost?.mp ?? a.mpCost ?? 0;
    return a.type !== 'passive' && cost <= mp && cost > 0;
  });
  if (ability) return { actionType: 'ability', abilityId: ability.id, targetId: target.id };
  return { actionType: 'attack', targetId: target.id };
}

export class GameSession {
  /**
   * @param {object} [opts]
   * @param {function} [opts.decideCombat] - (combatant, enemies) => {actionType, ...}
   */
  constructor(opts = {}) {
    this.decideCombat = opts.decideCombat || defaultDecideCombat;
    this.engine = new GameEngine();
    this.eventSystem = new EventSystem();
    this.gameState = null;
    this.preset = null;
    this._mainQuestComplete = false;

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
    this.engine.registerSystem(new NPCSystem(), 34);
    this.engine.registerSystem(new DialogueSystem(), 32);
    this.engine.registerSystem(new ContextRetriever(), 31);
    this.engine.start();
  }

  sys(name) { return this.engine.getSystem(name); }

  /** 配置 AI GM（可选）。不配置时引擎走 localFallback，游戏仍可推进。 */
  configureAI(config) {
    const ai = this.sys('AIGMEngine');
    if (ai) ai.setAPIConfig(config);
  }

  // ============================================================
  // 载入 / 开局
  // ============================================================
  loadPreset(presetData, creationChoices = null) {
    this.preset = new GamePreset(presetData);
    this.sys('CardManager').loadFromPreset(this.preset);
    if (this.preset.map) this.sys('MapSystem').loadMap(this.preset.map);
    this.sys('SceneSystem').loadFromPreset(this.preset);
    this.sys('NPCSystem').loadFromPreset(this.preset);
    this.sys('AIGMEngine').setPreset(this.preset);
    this.gameState = GameState.fromPreset(this.preset);

    if (creationChoices && this.preset.startingOptions) {
      this._applyCreationChoices(creationChoices);
    }

    this.sys('NPCSystem').initializeNPCState(this.gameState);
    this.gameState.storyTime ||= { day: 1, hour: 8 };
    const ms = this.sys('MemorySystem');
    if (ms) ms.initializeFromPreset(this.gameState, this.preset);

    const lore = this.preset.lore || {};
    const greeting = lore.background
      ? `欢迎来到${lore.worldName || '未知世界'}。${lore.background}`
      : '冒险开始了...';
    this.gameState.addNarrative('gm', greeting);
    return this;
  }

  _applyCreationChoices(choices) {
    const tags = new Set(this.gameState.playerTags || []);
    const protag = this.gameState.activeCharacters[0];
    for (const axis of ['races', 'origins', 'backgrounds', 'faiths']) {
      const opts = this.preset.startingOptions[axis] || [];
      const opt = opts.find(o => o.id === choices[axis]) || opts[0];
      if (!opt) continue;
      (opt.tags || []).forEach(t => tags.add(t));
      if (opt.statBonus && protag) {
        for (const [k, v] of Object.entries(opt.statBonus)) {
          protag.stats[k] = (protag.stats[k] || 0) + v;
          if (k === 'hp') protag.stats.hpCurrent = protag.stats.hp;
          if (k === 'mp') protag.stats.mpCurrent = protag.stats.mp;
        }
      }
    }
    this.gameState.playerTags = [...tags];

    // 起始场景路由
    let startSceneId = null;
    for (const rule of (this.preset.startingSceneRules || [])) {
      if (rule.default) continue;
      const need = rule.when?.tags || [];
      if (need.every(t => tags.has(t))) { startSceneId = rule.sceneId; break; }
    }
    if (!startSceneId) {
      const defRule = this.preset.startingSceneRules?.find(r => r.default);
      if (defRule) startSceneId = defRule.sceneId || defRule.default;
    }
    if (startSceneId) this._syncScenePosition(startSceneId);
  }

  _syncScenePosition(sceneId) {
    const scene = this.sys('SceneSystem').getScene(sceneId);
    if (!scene) return;
    this.gameState.mapState ||= {};
    this.gameState.mapState.currentSceneId = sceneId;
    this.gameState.mapState.visitedSceneIds = [sceneId];
    if (scene.coords) this.gameState.mapState.playerPosition = { x: scene.coords.x, y: scene.coords.y };
  }

  /** 初始扫描起始场景挂载的事件（复刻 main.js 初始扫描） */
  async kickoff() {
    const start = this.sys('SceneSystem').getCurrentScene(this.gameState);
    if (!start) return;
    if (start.events && start.events.length > 0) {
      const cm = this.sys('CardManager');
      const candidates = start.events.map(id => cm.getCard(id))
        .filter(e => e && (!e.repeatable ? !this.gameState.completedEventIds.includes(e.id) : true));
      candidates.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      if (candidates[0]) await this._triggerEvent(candidates[0].id);
    }
  }

  // ============================================================
  // 事件
  // ============================================================
  async _triggerEvent(eventId) {
    const cm = this.sys('CardManager');
    const ai = this.sys('AIGMEngine');
    const card = cm.getCard(eventId);
    if (!card) return;
    if (!card.repeatable && this.gameState.completedEventIds.includes(eventId)) return;

    this.gameState.activeEvent = card;
    try {
      await ai.processGameAction('narrate_event', { event: card }, this.gameState);
    } catch {
      this.gameState.addNarrative('gm', card.description);
    }

    if (!card.choices || card.choices.length === 0) {
      this.gameState.activeEvent = null;
      if (!card.repeatable && !this.gameState.completedEventIds.includes(card.id)) {
        this.gameState.completedEventIds.push(card.id);
      }
      this._checkMainQuestComplete(card);
      await this._scanAfter(TRIGGER_MOMENTS.EVENT_COMPLETE);
    }
  }

  _checkMainQuestComplete(card) {
    if ((card.tags || []).includes('ending')
      || card.id === 'ch10_epilogue'
      || this.gameState.variables?.game_complete === true) {
      this._mainQuestComplete = true;
    }
  }

  async _scanAfter(moment) {
    if (this.gameState.activeCombat && moment !== TRIGGER_MOMENTS.COMBAT_END) return;
    const ids = this.sys('EventTriggerEngine').scan(this.gameState, { moment });
    if (ids.length > 0) await this._triggerEvent(ids[0]);
  }

  async resolveEventChoice(eventId, choiceId) {
    const cm = this.sys('CardManager');
    const ai = this.sys('AIGMEngine');
    const memo = this.sys('MemorySystem');
    const card = cm.getCard(eventId);
    if (!card) return { ok: false, reason: '事件不存在' };
    const choice = (card.choices || []).find(c => c.id === choiceId);
    if (!choice) return { ok: false, reason: '选项不存在' };

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
        event: card, choiceText: choice.text, outcomeText: outcome ? outcome.text : '',
      }, this.gameState);
    } catch { /* */ }

    this._checkMainQuestComplete(card);
    if (this.gameState.activeCombat) await this._autoResolveCombat();
    await this._scanAfter(TRIGGER_MOMENTS.EVENT_COMPLETE);
    return { ok: true, outcome };
  }

  _applyEventEffect(eff) {
    const gs = this.gameState;
    switch (eff.type) {
      case 'add_item': {
        const c = gs.activeCharacters[0];
        if (c) (c.inventory ||= []).push(eff.itemId);
        break;
      }
      case 'set_variable': gs.variables[eff.name] = eff.value; break;
      case 'set_worldFlag': { gs.worldFlags ||= {}; gs.worldFlags[eff.name] = eff.value; break; }
      case 'add_memory': {
        const m = this.sys('MemorySystem');
        if (m) m.addKeyEvent(gs, { summary: eff.value, tags: ['manual'] });
        break;
      }
      case 'start_combat': this._startCombat(eff.enemyIds || []); break;
      case 'heal': {
        const targets = eff.target === 'all' ? gs.activeCharacters : [gs.activeCharacters[0]];
        for (const c of targets) if (c) c.stats.hpCurrent = Math.min(c.stats.hp, c.stats.hpCurrent + (eff.value || 0));
        break;
      }
      case 'damage': {
        const targets = eff.target === 'all' ? gs.activeCharacters : [gs.activeCharacters[0]];
        for (const c of targets) if (c) c.stats.hpCurrent = Math.max(0, c.stats.hpCurrent - (eff.value || 0));
        break;
      }
      case 'recruit_companion': {
        const ns = this.sys('NPCSystem');
        if (ns && eff.npcId) {
          const okR = ns.recruitCompanion(gs, eff.npcId);
          const npc = ns.getNPC(eff.npcId);
          if (okR && npc) {
            const exists = gs.activeCharacters.some(c => c.id === eff.npcId);
            if (!exists && npc.stats) {
              const slot = JSON.parse(JSON.stringify(npc));
              slot._isCompanion = true; slot.type = 'character';
              slot.stats.hpCurrent = slot.stats.hp; slot.stats.mpCurrent = slot.stats.mp || 0;
              gs.activeCharacters.push(slot);
            }
            gs.addNarrative('system', `🤝 ${npc.name} 加入了你的队伍。`);
          }
        }
        break;
      }
      case 'change_affection': {
        const ns = this.sys('NPCSystem');
        if (ns && eff.npcId !== undefined) ns.changeAffection(gs, eff.npcId, eff.value || 0);
        break;
      }
      case 'advance_time': {
        const h = eff.value || 1;
        gs.storyTime ||= { day: 1, hour: 8 };
        gs.storyTime.hour += h;
        while (gs.storyTime.hour >= 24) { gs.storyTime.hour -= 24; gs.storyTime.day += 1; }
        const ns = this.sys('NPCSystem');
        if (ns) ns.refreshNPCLocations(gs);
        break;
      }
      case 'reveal_connection': {
        const ss = this.sys('SceneSystem');
        if (ss && eff.fromId && eff.toId) ss.revealConnection(gs, eff.fromId, eff.toId);
        break;
      }
      case 'kill_npc': {
        const ns = this.sys('NPCSystem');
        if (ns && eff.npcId) ns.applyNPCDeath(gs, eff.npcId);
        break;
      }
      case 'teleport_to_scene': {
        const ss = this.sys('SceneSystem');
        if (!ss || !eff.sceneId) break;
        const target = ss.getScene(eff.sceneId);
        if (!target) break;
        const visited = gs.mapState?.visitedSceneIds || [];
        if (!eff.allowUnvisited && !visited.includes(eff.sceneId)) {
          gs.addNarrative('system', `（${target.name} 还未去过，不能传送）`);
          break;
        }
        gs.mapState.currentSceneId = eff.sceneId;
        if (target.coords) gs.mapState.playerPosition = { x: target.coords.x, y: target.coords.y };
        const ns2 = this.sys('NPCSystem');
        if (ns2) ns2.refreshNPCLocations(gs);
        gs.addNarrative('system', `🛤 你来到了 ${target.name}。`);
        break;
      }
    }
  }

  // ============================================================
  // 旅行（单跳到相邻可达场景）
  // ============================================================
  async travelTo(sceneId) {
    const ss = this.sys('SceneSystem');
    const check = ss.canTravelTo(this.gameState, sceneId);
    if (!check.ok) {
      this.gameState.addNarrative('system', `（${check.reason}）`);
      return { ok: false, reason: check.reason };
    }
    const fromScene = ss.getCurrentScene(this.gameState);
    const result = ss.performTravel(this.gameState, sceneId);
    if (!result) return { ok: false, reason: '无法前往' };
    const { scene, isFirstVisit, connection } = result;
    this.gameState.addNarrative('player', connection?.label || `前往 ${scene.name}`);

    if (!isFirstVisit) {
      const v = ss.pickVignette(scene);
      if (v) this.gameState.addNarrative('gm', v);
    } else {
      try {
        await this.sys('AIGMEngine').processGameAction('narrate_scene_arrival', {
          fromScene: fromScene ? { id: fromScene.id, name: fromScene.name } : null,
          toScene: { id: scene.id, name: scene.name, description: scene.description, type: scene.type, tags: scene.tags || [] },
          connectionLabel: connection?.label || '',
        }, this.gameState);
      } catch {
        if (scene.description) this.gameState.addNarrative('gm', scene.description);
      }
    }

    const ns = this.sys('NPCSystem');
    if (ns) {
      const inScene = ns.getNPCsInScene(this.gameState, scene.id, true);
      for (const { npc } of inScene) ns.meetNPC(this.gameState, npc.id);
      for (const cid of (this.gameState.companions || [])) ns.meetNPC(this.gameState, cid);
    }

    // 扫场景挂载的事件
    if (scene.events && scene.events.length > 0) {
      const cm = this.sys('CardManager');
      const candidates = scene.events.map(id => cm.getCard(id))
        .filter(e => e && (!e.repeatable ? !this.gameState.completedEventIds.includes(e.id) : true));
      candidates.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      if (candidates[0]) await this._triggerEvent(candidates[0].id);
    }
    // SCENE_ENTER 触发器（inScene 条件 / 概率遭遇）
    if (!this.gameState.activeEvent && !this.gameState.activeCombat) {
      await this._scanAfter(TRIGGER_MOMENTS.SCENE_ENTER);
    }
    if (this.gameState.activeCombat) await this._autoResolveCombat();
    return { ok: true };
  }

  // ============================================================
  // 战斗（v1：可插拔的自动结算）
  // ============================================================
  _startCombat(enemyIds) {
    const cm = this.sys('CardManager');
    const combat = this.sys('CombatSystem');
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

  async _autoResolveCombat() {
    const combat = this.sys('CombatSystem');
    let safety = 0;
    while (this.gameState.activeCombat && safety++ < 100) {
      const c = this.gameState.activeCombat;
      const slot = c.turnOrder[c.currentActorIndex];
      if (!slot) break;
      const actor = combat.findCombatant(this.gameState, slot.id);

      if (!actor || actor.stats.hpCurrent <= 0) {
        const r = combat.nextTurn(this.gameState);
        if (r.combatEnd) { await this._endCombat(r); return; }
        continue;
      }

      if (slot.type === 'enemy') {
        const target = this.gameState.activeCharacters.find(ch => ch.stats.hpCurrent > 0);
        if (target) {
          const r = combat.performAttack(this.gameState, slot.id, target.id);
          if (r && r.success) {
            const dmg = r.finalDamage ?? r.damage;
            this.gameState.addNarrative('system', `${actor.name} 攻击 ${target.name}，造成 ${dmg} 点伤害${r.targetDefeated ? '，倒下！' : '。'}`);
          }
        }
      } else {
        const decision = this.decideCombat(actor, c.enemies) || { actionType: 'attack', targetId: (c.enemies.find(e => e.stats.hpCurrent > 0) || {}).id };
        this._applyCombatAction(actor, decision);
      }

      const r = combat.nextTurn(this.gameState);
      if (r.combatEnd) { await this._endCombat(r); return; }
    }
  }

  _applyCombatAction(actor, action) {
    const combat = this.sys('CombatSystem');
    let target = combat.findCombatant(this.gameState, action.targetId);
    if (!target) {
      const alive = this.gameState.activeCombat.enemies.find(e => e.stats.hpCurrent > 0);
      if (alive) { action.targetId = alive.id; target = alive; }
    }
    let res = null;
    if (action.actionType === 'attack') res = combat.performAttack(this.gameState, actor.id, action.targetId);
    else if (action.actionType === 'ability') res = combat.useAbility(this.gameState, actor.id, action.abilityId, action.targetId);
    if (res && res.success) {
      const name = action.actionType === 'attack' ? '普攻'
        : (actor.abilities?.find(a => a.id === action.abilityId)?.name || '技能');
      const dmg = res.finalDamage ?? res.damage;
      const heal = res.healing;
      const detail = dmg > 0 ? `造成 ${dmg} 点伤害` : (heal > 0 ? `恢复 ${heal} HP` : '');
      this.gameState.addNarrative('system', `${actor.name} 对 ${target?.name || ''} 使用 ${name}${detail ? '，' + detail : ''}${res.targetDefeated ? '，击败！' : '。'}`);
    }
  }

  async _endCombat(turnResult) {
    const combat = this.sys('CombatSystem');
    combat.endCombat(this.gameState, turnResult.outcome || 'victory');
    const won = (turnResult.outcome || 'victory') === 'victory';
    this.gameState.addNarrative('system', won ? '战斗胜利！' : '战斗结束。');
    try {
      await this.sys('AIGMEngine').processGameAction('narrate_combat', {
        roundResults: [{ narrative: won ? '战斗胜利' : '战斗失败' }],
      }, this.gameState);
    } catch { /* */ }
    await this._scanAfter(TRIGGER_MOMENTS.COMBAT_END);
    if (!this.gameState.activeCombat && !this.gameState.activeEvent) {
      await this._scanAfter(TRIGGER_MOMENTS.SCENE_ENTER);
    }
  }

  // ============================================================
  // 物品 / 休整
  // ============================================================
  useItem(itemId, ownerCharId = null, targetCharId = null) {
    const progression = this.sys('ProgressionSystem');
    if (!progression) return { ok: false, reason: 'ProgressionSystem 未注册' };
    if (!ownerCharId) {
      const owner = this.gameState.activeCharacters.find(c => (c.inventory || []).includes(itemId));
      if (!owner) return { ok: false, reason: `没人持有 ${itemId}` };
      ownerCharId = owner.id;
    }
    if (!targetCharId) targetCharId = ownerCharId;
    const r = progression.useItem(this.gameState, itemId, ownerCharId, targetCharId);
    if (r.success) {
      const e = r.effect;
      const parts = [`${e.targetName} 使用 ${e.itemName}`];
      if (e.hpRestored) parts.push(`恢复 ${e.hpRestored} HP`);
      if (e.mpRestored) parts.push(`恢复 ${e.mpRestored} MP`);
      if (e.buffApplied) parts.push(e.buffApplied);
      this.gameState.addNarrative('system', parts.join('，') + '。');
    } else {
      this.gameState.addNarrative('system', `（${r.reason}）`);
    }
    return { ok: !!r.success, ...r };
  }

  // ============================================================
  // 统一动作入口 + 状态快照
  // ============================================================
  /**
   * @param {object} action - { type: 'choose'|'travel'|'use_item'|'say', ... }
   * @returns {Promise<object>} 新状态快照（getState()）
   */
  async applyAction(action) {
    if (!action || !action.type) return this.getState();
    switch (action.type) {
      case 'choose': {
        const ev = this.gameState.activeEvent;
        if (ev) await this.resolveEventChoice(ev.id, action.choiceId);
        break;
      }
      case 'travel':
        await this.travelTo(action.sceneId);
        break;
      case 'use_item':
        this.useItem(action.itemId, action.ownerId || null, action.targetId || null);
        break;
      case 'say':
        if (action.text) this.gameState.addNarrative('player', action.text);
        break;
      default:
        this.gameState.addNarrative('system', `（未知动作类型：${action.type}）`);
    }
    return this.getState();
  }

  /** 当前局面的可序列化快照 — 客户端/AI 席据此决策 */
  getState() {
    const gs = this.gameState;
    const ss = this.sys('SceneSystem');
    const cm = this.sys('CardManager');
    if (!gs) return { ready: false };

    const current = ss.getCurrentScene(gs);
    const visited = new Set(gs.mapState?.visitedSceneIds || []);

    const party = gs.activeCharacters.map(c => ({
      id: c.id, name: c.name,
      hp: c.stats.hpCurrent, hpMax: c.stats.hp,
      hpPct: Math.round((c.stats.hpCurrent / Math.max(1, c.stats.hp)) * 100),
      mp: c.stats.mpCurrent ?? 0, mpMax: c.stats.mp ?? 0,
      alive: c.stats.hpCurrent > 0,
      isCompanion: !!c._isCompanion,
      inventory: c.inventory || [],
    }));

    const usableItems = [];
    for (const c of gs.activeCharacters) {
      for (const itemId of (c.inventory || [])) {
        const item = cm ? cm.getCard(itemId) : null;
        if (item && item.itemType === 'consumable' && item.consumeEffect) {
          usableItems.push({ ownerId: c.id, itemId, name: item.name });
        }
      }
    }

    let situation = 'travel';
    let event = null;
    let options = [];
    if (gs.activeCombat) {
      situation = 'combat';
    } else if (gs.activeEvent) {
      situation = 'event';
      event = {
        id: gs.activeEvent.id, name: gs.activeEvent.name,
        description: gs.activeEvent.description,
      };
      options = (gs.activeEvent.choices || []).map((c, i) => ({ n: i + 1, type: 'choose', choiceId: c.id, text: c.text }));
    } else if (current) {
      const adjacent = ss.getAdjacent(gs);
      options = adjacent.map((a, i) => {
        const hidden = !a.reachable && !visited.has(a.scene.id);
        return {
          n: i + 1, type: 'travel', sceneId: a.scene.id,
          text: a.connection.label || '前往',
          sceneName: hidden ? '???' : a.scene.name,
          reachable: a.reachable,
          visited: visited.has(a.scene.id),
          lockedReason: a.reachable ? null : a.lockedReason,
        };
      });
    }

    const narrative = (gs.narrativeLog || []).slice(-8).map(n => ({ speaker: n.speaker, text: n.text }));

    return {
      ready: true,
      situation,
      mainQuestComplete: this._mainQuestComplete,
      partyWiped: gs.activeCharacters.every(c => c.stats.hpCurrent <= 0),
      scene: current ? { id: current.id, name: current.name, type: current.type, tags: current.tags || [] } : null,
      event,
      options: situation === 'combat' ? [] : options.filter(o => o.type !== 'travel' || o.reachable),
      party,
      usableItems,
      narrative,
      variables: gs.variables || {},
      storyTime: gs.storyTime || { day: 1, hour: 8 },
      progress: {
        scenesVisited: visited.size,
        scenesTotal: this.preset?.scenes?.length || 0,
        eventsCompleted: (gs.completedEventIds || []).length,
        eventsTotal: this.preset?.events?.length || 0,
      },
    };
  }

  isMainQuestComplete() { return !!this._mainQuestComplete; }

  destroy() { this.engine.stop(); }
}
