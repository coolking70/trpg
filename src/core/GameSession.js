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
import { LegionWarfareSystem } from '../systems/LegionWarfareSystem.js';
import { StrategicSystem } from '../systems/StrategicSystem.js';
import { SkirmishSystem } from '../systems/SkirmishSystem.js';
import { rankForMerit } from '../data/skirmish.js';
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
import { canUseFormation, generalHasTactic } from '../data/warfare.js';
import { schemaOf, battleUnitKey } from '../data/strategySchema.js';
import { assembleLegionBattle, settleLegionBattle } from '../systems/legionOrchestration.js';
import { applyStrategyEffect, applySeasonEvents } from '../systems/strategyOrchestration.js';

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
    // 战斗模式：'auto'（默认，启发式自动结算，给脚本/纯测试）
    //          'interactive'（轮到我方角色时暂停，由 getState/applyAction 逐回合下指令，给真人/AI 席）
    this.combatMode = opts.combatMode || 'auto';
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
    this.engine.registerSystem(new LegionWarfareSystem(), 49);
    this.engine.registerSystem(new StrategicSystem(), 48);
    this.engine.registerSystem(new SkirmishSystem(), 47);
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
    this.sys('StrategicSystem').initFromPreset(this.gameState, this.preset);
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
      // 出身可决定战略身份（Phase 43）：playerRole(ruler/officer/soldier) + 所属势力。
      //   initFromPreset 随后读取 gameState._creationStrategic 覆盖默认 playerFactionId/playerRole。
      if (opt.strategicRole || opt.strategicFaction) {
        this.gameState._creationStrategic = {
          ...(this.gameState._creationStrategic || {}),
          ...(opt.strategicRole ? { role: opt.strategicRole } : {}),
          ...(opt.strategicFaction ? { factionId: opt.strategicFaction } : {}),
        };
      }
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
    if ((this.gameState.activeCombat || this.gameState.activeLegionBattle) && moment !== TRIGGER_MOMENTS.COMBAT_END) return;
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
    if (this.gameState.activeCombat) await this._enterCombat();
    if (this.gameState.activeLegionBattle) await this._enterLegionBattle();
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
      case 'start_legion_battle': this._startLegionBattle(eff.battle || eff.battleDef || eff); break;
      case 'set_diplomacy':
      case 'adjust_resource':
      case 'mobilize':
        applyStrategyEffect(eff, { gameState: gs, strategicSystem: this.sys('StrategicSystem') });
        break;
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
    if (!this.gameState.activeEvent && !this.gameState.activeCombat && !this.gameState.activeLegionBattle) {
      await this._scanAfter(TRIGGER_MOMENTS.SCENE_ENTER);
    }
    if (this.gameState.activeCombat) await this._enterCombat();
    if (this.gameState.activeLegionBattle) await this._enterLegionBattle();
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

  /** 战斗启动后的处理：按 combatMode 分派 */
  async _enterCombat() {
    if (this.combatMode === 'interactive') return this._advanceCombatToActor();
    return this._autoResolveCombat();
  }

  /** 敌人回合：攻击第一个存活我方。返回 nextTurn 结果 */
  _runEnemyTurn(slot, actor) {
    const combat = this.sys('CombatSystem');
    const target = this.gameState.activeCharacters.find(ch => ch.stats.hpCurrent > 0);
    if (target) {
      const r = combat.performAttack(this.gameState, slot.id, target.id);
      if (r && r.success) {
        const dmg = r.finalDamage ?? r.damage;
        this.gameState.addNarrative('system', `${actor.name} 攻击 ${target.name}，造成 ${dmg} 点伤害${r.targetDefeated ? '，倒下！' : '。'}`);
      }
    }
    return combat.nextTurn(this.gameState);
  }

  /** 自动结算（auto 模式 / 脚本测试）：我方用 decideCombat 启发式 */
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

      let r;
      if (slot.type === 'enemy') {
        r = this._runEnemyTurn(slot, actor);
      } else {
        const decision = this.decideCombat(actor, c.enemies) || { actionType: 'attack', targetId: (c.enemies.find(e => e.stats.hpCurrent > 0) || {}).id };
        this._applyCombatAction(actor, decision);
        r = combat.nextTurn(this.gameState);
      }
      if (r.combatEnd) { await this._endCombat(r); return; }
    }
  }

  /**
   * 交互模式：自动跑敌人/死亡跳过，直到轮到一名存活我方角色（暂停等指令），或战斗结束。
   * 返回时若 activeCombat 仍在，则 turnOrder[currentActorIndex] 必是一名存活我方角色。
   */
  async _advanceCombatToActor() {
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
        const r = this._runEnemyTurn(slot, actor);
        if (r.combatEnd) { await this._endCombat(r); return; }
        continue;
      }
      // 轮到存活我方角色 → 暂停，等 applyAction 下指令
      return;
    }
  }

  /** 交互模式：当前应行动的我方角色（无则 null） */
  _currentCombatActor() {
    const c = this.gameState.activeCombat;
    if (!c) return null;
    const slot = c.turnOrder[c.currentActorIndex];
    if (!slot || slot.type !== 'character') return null;
    const actor = this.sys('CombatSystem').findCombatant(this.gameState, slot.id);
    return (actor && actor.stats.hpCurrent > 0) ? actor : null;
  }

  /** 交互模式：提交一名我方角色的战斗指令，然后推进到下一个我方回合或战斗结束 */
  async submitCombatAction(action) {
    if (!this.gameState.activeCombat) return { ok: false, reason: '当前不在战斗中' };
    const actor = this._currentCombatActor();
    if (!actor) return { ok: false, reason: '当前不是我方角色的回合' };
    this._applyCombatAction(actor, action || { actionType: 'attack' });
    const r = this.sys('CombatSystem').nextTurn(this.gameState);
    if (r.combatEnd) { await this._endCombat(r); return { ok: true, combatEnd: true }; }
    await this._advanceCombatToActor();
    return { ok: true, combatEnd: !this.gameState.activeCombat };
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
  // 军团战争（Phase 31）—— 与个人战平行的另一套战斗，单位栈战术制
  // ============================================================
  /** 从事件效果/预设装配一场军团战并交给 LegionWarfareSystem */
  _startLegionBattle(battleDef) {
    if (!battleDef || !Array.isArray(battleDef.units) || battleDef.units.length === 0) return;
    this._legionBattleDef = battleDef; // 留作战后领土结算（Phase 38）
    const { def, strategyCtx } = assembleLegionBattle(battleDef, {
      gameState: this.gameState, strategicSystem: this.sys('StrategicSystem'), cardManager: this.sys('CardManager'),
    });
    this._legionStrategyCtx = strategyCtx;
    this.sys('LegionWarfareSystem').startBattle(this.gameState, def);
  }

  /** 军团战启动后的处理：开场叙述 + 按 combatMode 分派 */
  async _enterLegionBattle() {
    const b = this.gameState.activeLegionBattle;
    if (b) {
      const lw = this.sys('LegionWarfareSystem');
      try {
        await this.sys('AIGMEngine').processGameAction('narrate_legion_start', {
          battleType: b.battleType,
          battleTypeName: ({ field: '野战', siege: '攻城', defense: '守城', naval: '水战' })[b.battleType] || '大战',
          objectiveName: b.objectiveName,
          player: lw._sideSummary(this.gameState, 'player'),
          enemy: lw._sideSummary(this.gameState, 'enemy'),
        }, this.gameState);
      } catch { /* */ }
    }
    if (this.combatMode === 'interactive') return this._advanceLegionToActor();
    return this._autoResolveLegion();
  }

  /** 自动结算（auto 模式 / 脚本测试）：双方都用 decideLegion 启发式 */
  async _autoResolveLegion() {
    const lw = this.sys('LegionWarfareSystem');
    let safety = 0;
    while (this.gameState.activeLegionBattle && safety++ < 400) {
      const actor = lw.getCurrentActor(this.gameState);
      if (!actor || actor.troops <= 0) {
        const r = lw.nextTurn(this.gameState);
        if (r.battleEnd) { await this._endLegionBattle(r); return; }
        continue;
      }
      const order = lw.decideLegion(this.gameState, actor);
      const res = lw.executeOrder(this.gameState, actor.id, order);
      if (res && res.narrative) this.gameState.addNarrative('system', res.narrative);
      const r = lw.nextTurn(this.gameState);
      if (r.battleEnd) { await this._endLegionBattle(r); return; }
    }
  }

  /** 交互模式：自动跑敌方栈 / 跳过阵亡，直到轮到一支存活我方部队（暂停等指令），或战斗结束 */
  async _advanceLegionToActor() {
    const lw = this.sys('LegionWarfareSystem');
    let safety = 0;
    while (this.gameState.activeLegionBattle && safety++ < 400) {
      const actor = lw.getCurrentActor(this.gameState);
      if (!actor || actor.troops <= 0) {
        const r = lw.nextTurn(this.gameState);
        if (r.battleEnd) { await this._endLegionBattle(r); return; }
        continue;
      }
      if (actor.side === 'enemy') {
        const order = lw.decideLegion(this.gameState, actor);
        const res = lw.executeOrder(this.gameState, actor.id, order);
        if (res && res.narrative) this.gameState.addNarrative('system', res.narrative);
        const r = lw.nextTurn(this.gameState);
        if (r.battleEnd) { await this._endLegionBattle(r); return; }
        continue;
      }
      return; // 轮到我方部队 → 暂停等指令
    }
  }

  /** 交互模式：当前应下令的我方部队（无则 null） */
  _currentLegionActor() {
    const lw = this.sys('LegionWarfareSystem');
    const actor = lw.getCurrentActor(this.gameState);
    return (actor && actor.side === 'player' && actor.troops > 0) ? actor : null;
  }

  /** 交互模式：提交一条军团指令，推进到下一支我方部队或战斗结束 */
  async submitLegionOrder(order) {
    if (!this.gameState.activeLegionBattle) return { ok: false, reason: '当前不在军团战中' };
    const actor = this._currentLegionActor();
    if (!actor) return { ok: false, reason: '当前不是我方部队的回合' };
    const lw = this.sys('LegionWarfareSystem');
    const res = lw.executeOrder(this.gameState, actor.id, order || { type: 'attack' });
    if (res && res.narrative) this.gameState.addNarrative('system', res.narrative);
    const r = lw.nextTurn(this.gameState);
    if (r.battleEnd) { await this._endLegionBattle(r); return { ok: true, battleEnd: true }; }
    await this._advanceLegionToActor();
    return { ok: true, battleEnd: !this.gameState.activeLegionBattle };
  }

  async _endLegionBattle(turnResult) {
    const won = (turnResult.result || 'victory') === 'victory';
    const s = turnResult.summary || {};
    this.gameState.addNarrative('system', won
      ? `⚔ 此役我军获胜！（歼敌约 ${s.enemyLosses ?? '?'}，我军折损约 ${s.playerLosses ?? '?'}）`
      : `⚔ 此役我军败退。（我军折损约 ${s.playerLosses ?? '?'}）`);

    // 战略结算（drawFromStrategy 归队/资源/民心/关系）+ 战役领土后果（Phase 33/38，共享编排）
    const ctx = this._legionStrategyCtx; this._legionStrategyCtx = null;
    const bdef = this._legionBattleDef; this._legionBattleDef = null;
    const { narratives } = settleLegionBattle({
      gameState: this.gameState, strategicSystem: this.sys('StrategicSystem'),
      strategyCtx: ctx, battleDef: bdef, won, summary: s,
    });
    for (const n of narratives) this.gameState.addNarrative('system', n);

    // 突围决战（Phase 41 W4）：玩家=守方，胜→解围(守住)，败→城陷
    if (this._breakoutSiege) {
      const sg = this._breakoutSiege; this._breakoutSiege = null;
      const ss = this.sys('StrategicSystem');
      const res = ss.resolveSiege(this.gameState, sg, won ? 'retreat' : 'fallen');
      this.gameState.addNarrative('system', won
        ? `🎉 突围得手，敌军溃退，${this._holdingName(sg.holdingId)} 之围遂解！`
        : `🏯 突围失利，${this._holdingName(sg.holdingId)} 终告陷落，落入 ${this._factionName(sg.attacker)} 之手。`);
    }

    try {
      await this.sys('AIGMEngine').processGameAction('narrate_legion_result', { won, summary: s }, this.gameState);
    } catch { /* */ }
    await this._scanAfter(TRIGGER_MOMENTS.COMBAT_END);
    if (!this.gameState.activeCombat && !this.gameState.activeLegionBattle && !this.gameState.activeEvent) {
      await this._scanAfter(TRIGGER_MOMENTS.SCENE_ENTER);
    }
  }

  // ============================================================
  // 内政外交（Phase 33）—— 理政朝堂
  // ============================================================
  async _doGovern(policyId) {
    const ss = this.sys('StrategicSystem');
    const st = this.gameState.strategicState;
    if (!st) { this.gameState.addNarrative('system', '（当前剧本无战略层）'); return { ok: false }; }
    const r = ss.applyPolicy(this.gameState, st.playerFactionId, policyId);
    this.gameState.addNarrative('system', r.ok ? `📜 ${r.narrative}` : `（${r.reason}）`);
    if (r.ok) {
      try { await this.sys('AIGMEngine').processGameAction('narrate_governance', { kind: 'policy', policyId, player: ss.getPlayerState(this.gameState) }, this.gameState); } catch { /* */ }
    }
    return r;
  }

  async _doDiplomacy(action, targetId, otherId = null) {
    const ss = this.sys('StrategicSystem');
    const st = this.gameState.strategicState;
    if (!st) { this.gameState.addNarrative('system', '（当前剧本无战略层）'); return { ok: false }; }
    const before = ss.relationOf(this.gameState, st.playerFactionId, targetId).stance;
    const r = ss.applyDiplomacy(this.gameState, st.playerFactionId, action, targetId, otherId);
    this.gameState.addNarrative('system', r.ok ? `🤝 ${r.narrative}` : `（${r.reason}）`);
    if (r.ok) {
      // 玩家宣战 → 置 worldFlags 标记，供剧本军团战触发器挂接
      if (action === 'declare_war' && before !== 'war') {
        this.gameState.worldFlags ||= {};
        this.gameState.worldFlags[`war_with_${targetId}`] = true;
      }
      try { await this.sys('AIGMEngine').processGameAction('narrate_diplomacy', { action, targetId, result: r }, this.gameState); } catch { /* */ }
    }
    return r;
  }

  async _advanceSeason() {
    const ss = this.sys('StrategicSystem');
    if (!this.gameState.strategicState) { this.gameState.addNarrative('system', '（当前剧本无战略层）'); return; }
    const commands = ss.playerCommands(this.gameState);
    const { events, season } = ss.advanceSeason(this.gameState);
    this.gameState.addNarrative('system', commands ? `🗓 政务推进，时序入第 ${season} 季。` : `🗓 时局流转，又是一季（第 ${season} 季）。`);
    // 敌国 AI 事件 → worldFlags + 叙述 + 入侵意图（共享编排）
    const { narratives, invasion } = applySeasonEvents(this.gameState, events);
    for (const n of narratives) this.gameState.addNarrative('system', n);
    // 作战自结算（Phase 43）：城池易主等大事——尤其底层视角下，让玩家从天下风云中感知战局
    for (const e of events.filter(ev => ev.type === 'siege_resolved')) {
      const sg = e.siege;
      this.gameState.addNarrative('system', e.attackerWins
        ? `🏯 ${this._holdingName(sg.holdingId)} 失守，落入 ${this._factionName(sg.attacker)} 之手。`
        : `🛡 ${this._factionName(sg.attacker)} 顿兵 ${this._holdingName(sg.holdingId)} 城下，无功而退。`);
    }
    try { await this.sys('AIGMEngine').processGameAction('narrate_governance', { kind: 'season', season, events, player: ss.getPlayerState(this.gameState) }, this.gameState); } catch { /* */ }

    // 作战层（Phase 41 W3）：探报 + 接敌抉择（regions 启用时取代 instant invasion）
    for (const d of events.filter(e => e.type === 'march_detected')) {
      this.gameState.addNarrative('system', `🛰 探报：${this._factionName(d.march.attacker)} 一支军马正向 ${this._holdingName(d.march.targetHoldingId)} 开进（${d.march.posture === 'raid' ? '踪迹隐秘' : '旗号公开'}）。`);
    }
    const arrival = events.find(e => e.type === 'army_arrived' && e.playerEngagement);
    if (arrival) {
      this.gameState._pendingEngagement = arrival.march;
      this.gameState.addNarrative('system', `⚔ ${this._factionName(arrival.march.attacker)} 大军已抵 ${this._holdingName(arrival.march.targetHoldingId)} 城下！`);
      try { await this.sys('AIGMEngine').processGameAction('narrate_event', { event: { name: '兵临城下', description: `${this._factionName(arrival.march.attacker)}大军压境${arrival.march.posture === 'raid' ? '（事出突然，城防未备）' : ''}。当出城迎击，还是闭城固守？` } }, this.gameState); } catch { /* */ }
      return; // 暂停，待玩家接敌抉择
    }

    // 战役级连战（Phase 38，无 regions 旧路径）：敌国来犯 → 立刻一场守城战
    if (invasion) {
      const battle = ss.buildInvasionBattle(this.gameState, invasion.by, this.gameState.strategicState.playerFactionId);
      if (battle) { this._startLegionBattle(battle); if (this.gameState.activeLegionBattle) { await this._enterLegionBattle(); return; } }
    }
    await this._scanAfter(TRIGGER_MOMENTS.SCENE_ENTER);
  }

  _holdingName(id) {
    const st = this.gameState.strategicState;
    for (const f of Object.values(st?.factions || {})) { const h = (f.holdings || []).find(x => x.id === id); if (h) return h.name; }
    return id;
  }

  _buildSiegeSnapshot(gs, sg) {
    const pid = gs.strategicState.playerFactionId;
    return {
      holding: this._holdingName(sg.holdingId), mode: sg.mode, xun: sg.xun,
      asAttacker: sg.attacker === pid,
      atk: { faction: this._factionName(sg.attacker), ...sg.atk }, def: { faction: this._factionName(sg.defender), ...sg.def },
      works: sg.works,
    };
  }

  /** 围城操作选项：守方 坚守/反击/求援/突围；攻方 强攻/围困/退兵 */
  _appendSiegeOptions(gs, sg, options) {
    const pid = gs.strategicState.playerFactionId;
    let n = 0;
    if (sg.defender === pid) {
      options.push({ n: ++n, type: 'siege_order', order: 'hold', text: '坚守（凭城消耗，待敌粮尽士衰）' });
      options.push({ n: ++n, type: 'siege_order', order: 'sortie', text: '强攻反击（开城突袭，挫敌兵锐）' });
      const ally = this._bestAlly(gs, pid);
      if (ally) options.push({ n: ++n, type: 'siege_order', order: 'relief', allyId: ally, text: `求援（急召 ${this._factionName(ally)} 来援）` });
      options.push({ n: ++n, type: 'siege_order', order: 'breakout', text: '突围（倾力出城决战）' });
    } else { // 玩家为攻方
      options.push({ n: ++n, type: 'siege_order', order: 'assault', text: '强攻（破门夺城，伤亡大）' });
      options.push({ n: ++n, type: 'siege_order', order: 'blockade', text: '围困（断粮相持，待其献城）' });
      options.push({ n: ++n, type: 'siege_order', order: 'lift', text: '退兵（解围撤还）' });
    }
  }

  _bestAlly(gs, fid) {
    const me = gs.strategicState.factions[fid];
    let best = null, bestRel = 39; // 需 ally/高关系
    for (const [tid, rel] of Object.entries(me?.diplomacy || {})) {
      if ((rel.stance === 'ally' || rel.relation >= 40) && rel.relation > bestRel) { bestRel = rel.relation; best = tid; }
    }
    return best;
  }

  /** 围城下令（Phase 41 W4）：推进一旬并按结局收尾 */
  async _siegeOrder(action) {
    const ss = this.sys('StrategicSystem');
    const sg = ss.playerSiege(this.gameState);
    if (!sg) return;
    if (action.order === 'breakout') {
      // 突围：以守军倾力出城野战；胜→解围，败→城陷（经领土结算）
      this._breakoutSiege = sg;
      const def = sg.def, atk = sg.atk;
      // 注：不带 objectiveHoldingId（领土由突围结果在 _endLegionBattle 显式结算，玩家是守方语义与攻方中心模型相反）
      this._startLegionBattle({
        battleType: 'field', enemyFactionId: sg.attacker,
        objectiveName: `${this._holdingName(sg.holdingId)}·突围决战`, supply: { player: 9999, enemy: atk.supply },
        units: [
          { id: 'def_main', side: 'player', unitType: battleUnitKey(schemaOf(this.gameState), 'defender'), troops: Math.max(1, def.troops) },
          { id: 'atk_main', side: 'enemy', unitType: battleUnitKey(schemaOf(this.gameState), 'attacker'), troops: Math.max(1, atk.troops) },
        ],
      });
      this.gameState.addNarrative('system', `🐎 ${this._holdingName(sg.holdingId)} 守军大开城门，倾力突围！`);
      if (this.gameState.activeLegionBattle) { await this._enterLegionBattle(); }
      return;
    }
    if (action.order === 'lift') {
      ss.resolveSiege(this.gameState, sg, 'retreat');
      this.gameState.addNarrative('system', `🏳 我军解围撤还，${this._holdingName(sg.holdingId)} 之围遂解。`);
      await this._scanAfter(TRIGGER_MOMENTS.SCENE_ENTER);
      return;
    }
    const r = ss.siegeOrder(this.gameState, sg, action.order, { allyId: action.allyId });
    this.gameState.addNarrative('system', `🏯 ${r.narrative}`);
    for (const ev of (r.events || [])) {
      if (ev.type === 'relief_arrived' && ev.result) this.gameState.addNarrative('system', `🚩 援军驰至，里应外合，重创围城之敌（歼约 ${ev.result.hit}）！`);
    }
    try { await this.sys('AIGMEngine').processGameAction('narrate_legion_result', { won: false, summary: {}, siege: true }, this.gameState); } catch { /* */ }
    if (r.outcome) {
      const res = ss.resolveSiege(this.gameState, sg, r.outcome.type);
      const verb = (schemaOf(this.gameState).narration?.siegeVerbs || {})[r.outcome.type] || r.outcome.type;
      this.gameState.addNarrative('system', res.attackerWins
        ? `🏯 ${this._holdingName(sg.holdingId)} ${verb}，落入 ${this._factionName(sg.attacker)} 之手。`
        : `🎉 ${verb}，${this._holdingName(sg.holdingId)} 之围得解！`);
      await this._scanAfter(TRIGGER_MOMENTS.SCENE_ENTER);
    }
  }

  // ============================================================
  // 小兵实战参战（Phase 44）—— 局部战斗 + 局部时间放缓
  //   底层视角(soldier/officer)下，玩家可"请缨参战"投身当前战线的一小片厮杀。
  //   这是被放大的瞬间：不推进战略时钟（季/旬）；个人英勇几乎不改全局，唯阵斩敌将成重大事件。
  // ============================================================

  /** 当前可参战的战线上下文（活跃围城 / 在途行军涉及玩家势力时）。无则 null。 */
  _skirmishContext(gs) {
    const st = gs.strategicState; if (!st) return null;
    const pid = st.playerFactionId;
    const tideFrom = (mine, foe) => Math.max(-1, Math.min(1, Math.log2(((mine || 1)) / ((foe || 1))) / 2));
    const siege = (st.sieges || []).find(s => !s._resolved && (s.attacker === pid || s.defender === pid));
    if (siege) {
      const asAtk = siege.attacker === pid;
      const my = asAtk ? siege.atk : siege.def, foe = asAtk ? siege.def : siege.atk;
      const enemyFid = asAtk ? siege.defender : siege.attacker;
      return {
        kind: 'siege', side: asAtk ? 'attacker' : 'defender', enemyFactionId: enemyFid,
        holdingId: siege.holdingId, tide: tideFrom(my.troops, foe.troops),
        desc: `${this._holdingName(siege.holdingId)} ${asAtk ? '城下（我军攻城）' : '城头（我军守城）'}`,
        myMorale: my.morale ?? 70, foeMorale: foe.morale ?? 70,
      };
    }
    const march = (st.marches || []).find(m => !m._done && (m.defender === pid || m.attacker === pid));
    if (march) {
      const asAtk = march.attacker === pid;
      const enemyFid = asAtk ? march.defender : march.attacker;
      const myT = this.sys('StrategicSystem').getFactionState(gs, pid)?.troops || 1;
      const foeT = this.sys('StrategicSystem').getFactionState(gs, enemyFid)?.troops || 1;
      return {
        kind: 'field', side: asAtk ? 'attacker' : 'defender', enemyFactionId: enemyFid,
        holdingId: march.targetHoldingId, tide: tideFrom(myT, foeT),
        desc: asAtk ? '随军行进、前锋遭遇战' : '边境遭遇、阻击来犯前锋',
        myMorale: 70, foeMorale: 70,
      };
    }
    return null;
  }

  /** 据战线上下文构建并开始一场局部战斗 */
  async _startSkirmish(gs) {
    const ctx = this._skirmishContext(gs);
    if (!ctx) { gs.addNarrative('system', '（当前并无可投身的战事。）'); return; }
    const sk = this.sys('SkirmishSystem');
    const enemyName = this._factionName(ctx.enemyFactionId);
    const tide = ctx.tide;
    // 题材措辞（小队/援兵/敌将命名随题材换皮）
    const skn = schemaOf(gs).narration?.skirmish || {};
    const allyW = skn.ally || '袍泽', enemyW = skn.enemy || '敌兵', ncoW = skn.nco || '什长';
    const commTitle = skn.commanderTitle || '骁将', commPool = skn.commanders || ['关靖', '夏侯尚', '牛金', '王双', '张虎'];
    // 小队规模 + 援兵（战线越有利我方援兵越足、敌方越少）；据 tide 微调
    const allyReserves = Math.max(1, Math.round(3 + tide * 2));
    const enemyReserves = Math.max(1, Math.round(3 - tide * 2));
    const ek = (n, atk, def, hp, over = {}) => ({ name: n, atk, def, hp, hpMax: hp, ...over });
    const enemies = [
      ek(`${enemyName}${enemyW}`, 7, 4, 32), ek(`${enemyName}${enemyW}`, 7, 4, 30), ek(`${enemyName}${ncoW}`, 8, 5, 38),
    ];
    // 偶遇敌方关键将领（小概率，且战线不至于太劣）：阵斩/生擒→战略重大事件
    const rng = sk.rng || Math.random;
    let bossName = null;
    if (rng() < 0.12 + Math.max(0, tide) * 0.06) {
      bossName = `${enemyName}${commTitle}·${commPool[Math.floor(rng() * commPool.length)]}`;
      enemies.push(ek(bossName, 11, 7, 90, { isCommander: true }));
    }
    sk.startSkirmish(gs, {
      playerChar: gs.activeCharacters[0],
      allies: [ek(allyW, 7, 4, 34), ek(allyW, 6, 4, 30)],
      enemies,
      reserves: { ally: allyReserves, enemy: enemyReserves },
      tide,
      labels: { allyReinforce: skn.allyReinforce || '我军援兵', enemyReinforce: skn.enemyReinforce || '敌军援兵' },
      parent: { kind: ctx.kind, side: ctx.side, factionId: gs.strategicState.playerFactionId, enemyFactionId: ctx.enemyFactionId, holdingId: ctx.holdingId, commanderName: bossName },
    });
    gs.addNarrative('system', `⚔ 你随队投身 ${ctx.desc}，刀光血影间，这只是万千战线中的一小片。`);
    if (bossName) gs.addNarrative('system', `（乱军之中，敌阵里那员被簇拥的骁将格外显眼……）`);
    // auto 模式：直接打完
    if (this.combatMode !== 'interactive') {
      sk.autoResolve(gs);
      await this._endSkirmish();
    }
  }

  _buildSkirmishSnapshot(gs) {
    const sk = this.sys('SkirmishSystem');
    const s = gs.activeSkirmish; if (!s) return null;
    const map = (u) => ({ id: u.id, name: u.name, hp: u.hp, hpMax: u.hpMax, isCommander: u.isCommander, isPlayer: u.isPlayer });
    return {
      round: s.round, tide: s.tide, parent: s.parent,
      allies: s.allies.filter(u => u.hp > 0).map(map),
      enemies: s.enemies.filter(u => u.hp > 0).map(map),
      reserves: { ...s.reserves }, kills: s.kills,
    };
  }

  _appendSkirmishOptions(gs, options) {
    const sk = this.sys('SkirmishSystem');
    let n = 0;
    for (const t of sk.enemyTargets(gs)) {
      const canCap = t.hp <= Math.max(6, t.hpMax * 0.25);
      options.push({ n: ++n, type: 'skirmish', skAction: canCap && t.isCommander ? 'capture' : 'attack', targetId: t.id, text: `${canCap && t.isCommander ? '生擒' : '斩击'} ${t.name}（${t.hp}）` });
    }
    options.push({ n: ++n, type: 'skirmish', skAction: 'defend', text: '据守格挡（减伤）' });
    options.push({ n: ++n, type: 'skirmish', skAction: 'rally', text: '鼓舞袍泽（提士气）' });
    options.push({ n: ++n, type: 'skirmish', skAction: 'flee', text: '且战且退（脱离战线）' });
  }

  async _submitSkirmish(action) {
    const sk = this.sys('SkirmishSystem');
    const r = sk.submitPlayerAction(this.gameState, { type: action.skAction || 'attack', targetId: action.targetId });
    for (const line of (r.log || [])) this.gameState.addNarrative('system', line);
    if (r.outcome) await this._endSkirmish();
  }

  async _endSkirmish() {
    const s = this.gameState.activeSkirmish; if (!s) return;
    const oc = s.outcome;
    this.gameState.activeSkirmish = null;
    this.gameState.addNarrative('system', `🛡 ${oc.label}（斩获约 ${oc.kills}）。`);
    await this._applySkirmishOutcome(oc); // 战功/晋升/敌将重大事件（P44c）
    // 局部时间放缓（非冻结）：个人鏖战相对战略时钟极慢——每数场厮杀，宏观战事方推进一旬。
    const st = this.gameState.strategicState;
    if (st && st.regions) {
      st._skirmishTick = (st._skirmishTick || 0) + 1;
      if (st._skirmishTick % 3 === 0) {
        const evs = this.sys('StrategicSystem').advanceWarXun(this.gameState);
        for (const e of (evs || []).filter(x => x.type === 'siege_resolved')) {
          const sg = e.siege;
          this.gameState.addNarrative('system', e.attackerWins
            ? `🏯 战报：${this._holdingName(sg.holdingId)} 失守，落入 ${this._factionName(sg.attacker)} 之手。`
            : `🛡 战报：${this._factionName(sg.attacker)} 攻 ${this._holdingName(sg.holdingId)} 不克而退。`);
        }
      }
    }
    await this._scanAfter(TRIGGER_MOMENTS.SCENE_ENTER);
  }

  /** 战功结算 + 晋升（达将官→转战略参与）+ 敌将偶遇重大事件（Phase 44 P44c） */
  async _applySkirmishOutcome(oc) {
    const gs = this.gameState;
    const ss = this.sys('StrategicSystem');
    const c = (gs.soldierCareer ||= { rank: '士卒', rankTier: 0, merit: 0, kills: 0, battles: 0 });

    // 阵斩/生擒敌将 → 战略重大事件（极少数个体撬动全局）
    let bonusMerit = 0;
    if (oc.commanderKill && oc.parent?.enemyFactionId) {
      const captured = oc.commanderKill === 'captured';
      gs.addNarrative('system', captured
        ? `⚑【重大军情】乱军之中，你竟生擒了 ${oc.parent.commanderName || '敌方骁将'}！`
        : `⚑【重大军情】你于万军之中阵斩 ${oc.parent.commanderName || '敌方骁将'}，敌阵大乱！`);
      const r = ss.applyMajorEvent(gs, { kind: captured ? 'commander_captured' : 'commander_slain', factionId: oc.parent.enemyFactionId, commanderName: oc.parent.commanderName });
      gs.addNarrative('system', `${this._factionName(oc.parent.enemyFactionId)}痛失大将，三军夺气、士气大挫${r?.troopHit ? `（折兵约 ${r.troopHit}）` : ''}。`);
      if (r?.liftedSiegeHoldingId) gs.addNarrative('system', `🎉 围攻 ${this._holdingName(r.liftedSiegeHoldingId)} 的敌军竟因此动摇而退——这一战，因你而改写！`);
      bonusMerit = captured ? 120 : 80;
    }

    c.merit += (oc.merit || 0) + bonusMerit;
    c.kills += oc.kills || 0;
    c.battles += 1;
    if (oc.merit || bonusMerit) gs.addNarrative('system', `（战功 +${(oc.merit || 0) + bonusMerit}，累计 ${c.merit}）`);

    // 晋升（按累计战功）；达 commander 级 → 获号令之权，转入战略参与模式
    const newRank = rankForMerit(c.merit);
    if (newRank.tier > (c.rankTier || 0)) {
      c.rankTier = newRank.tier; c.rank = newRank.name;
      gs.addNarrative('system', `🎖 论功行赏，你由行伍擢升为「${newRank.name}」！`);
      if (newRank.commander && gs.strategicState && gs.strategicState.playerRole !== 'ruler') {
        gs.strategicState.playerRole = 'ruler';
        gs.addNarrative('system', `自此你执掌一军、可参赞方略——从此你的主张，将真正左右这场天下大势。`);
      }
    }
  }

  /** 接敌抉择（Phase 41 W3）：sally 出城迎击→野战；hold 闭城固守→围城 */
  async _resolveEngagement(choice) {
    const m = this.gameState._pendingEngagement;
    if (!m) return;
    this.gameState._pendingEngagement = null;
    const ss = this.sys('StrategicSystem');
    const r = ss.resolveEngagement(this.gameState, m, choice);
    if (r.kind === 'battle') {
      this.gameState.addNarrative('system', `🐎 ${this._holdingName(m.targetHoldingId)} 守军出城列阵，迎击来犯之敌！`);
      this._startLegionBattle(r.battleDef);
      if (this.gameState.activeLegionBattle) { await this._enterLegionBattle(); return; }
    } else {
      this.gameState.addNarrative('system', `🏯 ${this._holdingName(m.targetHoldingId)} 闭门坚守，围城战起。`);
      try { await this.sys('AIGMEngine').processGameAction('narrate_event', { event: { name: '闭城固守', description: `${this._holdingName(m.targetHoldingId)}紧闭城门，深沟高垒，与城外大军相持。` } }, this.gameState); } catch { /* */ }
    }
    await this._scanAfter(TRIGGER_MOMENTS.SCENE_ENTER);
  }

  /** 收尾 AI 落地的待执行作战令（Phase 42 作战自由进谏） */
  async _drainWarOrder() {
    const wo = this.gameState._pendingWarOrder;
    if (!wo) return;
    this.gameState._pendingWarOrder = null;
    if (wo.kind === 'engage') await this._resolveEngagement(wo.choice);
    else if (wo.kind === 'siege_order') await this._siegeOrder(wo);
  }

  _factionName(id) {
    return this.gameState.strategicState?.factions?.[id]?.name || id;
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
      case 'combat':
        // 交互式战斗：提交当前我方角色的指令（attack/ability），推进到下一我方回合或战斗结束
        await this.submitCombatAction({
          actionType: action.actionType || 'attack',
          targetId: action.targetId,
          abilityId: action.abilityId,
        });
        break;
      case 'legion':
        // 交互式军团战：提交当前我方部队的一条指令，推进到下一支我方部队或战斗结束
        await this.submitLegionOrder(action.order || {
          type: action.orderType || 'attack',
          targetId: action.targetId,
          zone: action.zone,
          formation: action.formation,
          tacticKey: action.tacticKey,
        });
        break;
      case 'say':
        // 玩家以所扮角色的身份自由发言/行动/进谏 → 交 AI GM 裁决（按参与度阶梯过滤其落地动作）。
        // 这是"AI 驱动 TRPG"的核心：玩家始终是"那个人在做那件事"，高权限下可用自然语言提出内政外交主张。
        if (action.text) {
          this.gameState.addNarrative('player', action.text);
          try {
            await this.sys('AIGMEngine').processGameAction('player_action', { text: action.text, moved: false }, this.gameState);
          } catch { /* AI 不可用时静默：玩家发言已记录 */ }
          // 作战自由进谏（Phase 42）：AI 把"出城迎击/闭城固守/围城下令"落为待执行作战令 → 此处收尾（起战/建围/结算）
          await this._drainWarOrder();
        }
        break;
      case 'govern':
        await this._doGovern(action.policyId);
        break;
      case 'diplomacy':
        await this._doDiplomacy(action.action || action.diplomacyAction, action.targetId, action.otherId || null);
        break;
      case 'advance_season':
        await this._advanceSeason();
        break;
      case 'engage':
        await this._resolveEngagement(action.choice || 'hold');
        break;
      case 'siege_order':
        await this._siegeOrder(action);
        break;
      case 'skirmish_join':
        // 局部时间放缓：参战是被放大的瞬间，不推进战略时钟（季/旬）
        await this._startSkirmish(this.gameState);
        break;
      case 'skirmish':
        await this._submitSkirmish(action);
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
    let combat = null;
    let legion = null;
    let strategy = null;
    let skirmish = null;
    if (gs.activeSkirmish) {
      // 局部战斗（Phase 44）：小兵在战线上的一片厮杀
      situation = 'skirmish';
      skirmish = this._buildSkirmishSnapshot(gs);
      if (this.combatMode === 'interactive') this._appendSkirmishOptions(gs, options);
    } else if (gs._pendingEngagement) {
      // 接敌抉择（Phase 41 W3）：敌军兵临城下，出城迎击 or 闭城固守
      situation = 'engagement';
      const m = gs._pendingEngagement;
      event = { name: '兵临城下', description: `${this._factionName(m.attacker)} 大军（约 ${m.army.troops} 众）已抵 ${this._holdingName(m.targetHoldingId)} 城下。` };
      options.push({ n: 1, type: 'engage', choice: 'sally', text: '出城迎击（野战决胜）' });
      options.push({ n: 2, type: 'engage', choice: 'hold', text: '闭城固守（凭城消耗）' });
    } else if (gs.activeLegionBattle) {
      situation = 'legion';
      legion = this._buildLegionSnapshot(gs, options);
    } else if (gs.activeCombat) {
      situation = 'combat';
      const c = gs.activeCombat;
      const livingEnemies = (c.enemies || []).filter(e => e.stats.hpCurrent > 0)
        .map(e => ({ id: e.id, name: e.name, hp: e.stats.hpCurrent, hpMax: e.stats.hp }));
      const actor = this._currentCombatActor();
      combat = {
        round: c.round,
        enemies: livingEnemies,
        currentActor: actor ? { id: actor.id, name: actor.name, hp: actor.stats.hpCurrent, mp: actor.stats.mpCurrent ?? 0 } : null,
        awaitingInput: !!actor, // 交互模式下轮到我方角色 → 等指令
      };
      // 仅交互模式 + 轮到我方角色时给出可选战斗动作
      if (actor && this.combatMode === 'interactive') {
        let n = 0;
        const mp = actor.stats.mpCurrent ?? 0;
        for (const en of livingEnemies) {
          options.push({ n: ++n, type: 'combat', actionType: 'attack', targetId: en.id, text: `攻击 ${en.name}` });
        }
        const target = livingEnemies[0];
        for (const ab of (actor.abilities || [])) {
          const cost = ab.cost?.mp ?? ab.mpCost ?? 0;
          if (ab.type === 'passive' || cost > mp) continue;
          options.push({ n: ++n, type: 'combat', actionType: 'ability', abilityId: ab.id, targetId: target?.id, text: `技能「${ab.name || ab.id}」(mp${cost})${target ? ` → ${target.name}` : ''}` });
        }
      }
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

    // 战略层：始终给概要；号令权(ruler)下位于「理政」场景进入 governance 态并给指挥动作。
    // 底层视角(officer/soldier)：不给任何指挥选项——势力自治、战争幕后自结算（Phase 43）。
    let siege = null;
    if (gs.strategicState) {
      strategy = this._buildStrategySnapshot(gs);
      const commands = this.sys('StrategicSystem').playerCommands(gs);
      // 围城进行中且玩家亲自指挥（ruler）→ siege 态 + 围城操作（Phase 41 W4）
      const sg = commands && (situation === 'travel' || situation === 'governance') ? this.sys('StrategicSystem').playerSiege(gs) : null;
      if (sg) {
        situation = 'siege';
        options = [];
        siege = this._buildSiegeSnapshot(gs, sg);
        this._appendSiegeOptions(gs, sg, options);
      } else if (commands && situation === 'travel' && current && (current.tags || []).includes('governance')) {
        situation = 'governance';
        this._appendGovernanceOptions(gs, options);
      } else if (!commands && situation === 'travel' && gs.strategicState.regions) {
        // 底层视角：所属势力正卷入战事 → 可"请缨参战"（局部战斗，时间放缓、不推进战略时钟）；
        //   否则给"静观时局"入口让幕后世界继续运转。
        if (this._skirmishContext(gs)) {
          options.push({ n: options.length + 1, type: 'skirmish_join', text: '请缨参战（投身当前战线厮杀）' });
        }
        options.push({ n: options.length + 1, type: 'advance_season', text: '静观时局变化（一季流转）' });
      }
    }

    const narrative = (gs.narrativeLog || []).slice(-8).map(n => ({ speaker: n.speaker, text: n.text }));

    return {
      ready: true,
      situation,
      mainQuestComplete: this._mainQuestComplete,
      partyWiped: gs.activeCharacters.every(c => c.stats.hpCurrent <= 0),
      scene: current ? { id: current.id, name: current.name, type: current.type, tags: current.tags || [] } : null,
      event,
      combat,
      legion,
      strategy,
      siege,
      skirmish,
      options: (situation === 'combat' || situation === 'legion' || situation === 'skirmish') ? options : options.filter(o => o.type !== 'travel' || o.reachable),
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

  /** 构建军团战快照 + 交互模式下当前我方部队的可选指令（写入 options） */
  _buildLegionSnapshot(gs, options) {
    const b = gs.activeLegionBattle;
    const lw = this.sys('LegionWarfareSystem');
    const mapStack = (u) => ({
      id: u.id, name: u.name, unitType: u.unitType, troops: u.troops,
      morale: u.morale, zone: u.zone, formation: u.formation,
      generalId: u.generalId || null, machines: u.machines || [],
    });
    const actor = this._currentLegionActor();
    const snap = {
      battleType: b.battleType,
      objectiveName: b.objectiveName,
      round: b.round,
      zones: b.zones,
      supply: b.supply,
      works: b.works,
      control: b.control,
      player: b.units.filter(u => u.side === 'player' && u.troops > 0).map(mapStack),
      enemy: b.units.filter(u => u.side === 'enemy' && u.troops > 0).map(mapStack),
      currentActor: actor ? mapStack(actor) : null,
      awaitingInput: !!actor,
    };
    // 仅交互模式 + 轮到我方部队时给出可选指令
    if (actor && this.combatMode === 'interactive') {
      let n = 0;
      const targets = lw.attackableTargets(gs, actor);
      for (const t of targets) {
        options.push({ n: ++n, type: 'legion', orderType: 'attack', targetId: t.id, text: `进攻 ${t.name}（${t.troops}众）` });
      }
      // 列阵（仅主将阵法够格的）——阵型/战法表取自题材 Schema
      const _sc = schemaOf(gs);
      const FORMS = _sc.formations, TACS = _sc.tactics;
      const g = actor.generalId ? (b.generals[actor.generalId] || null) : null;
      for (const fk of Object.keys(FORMS)) {
        if (fk === 'none' || fk === actor.formation) continue;
        if (canUseFormation(g, fk, FORMS)) {
          options.push({ n: ++n, type: 'legion', orderType: 'set_formation', formation: fk, text: `列「${FORMS[fk].name}」阵` });
        }
      }
      // 器械轰击
      if ((actor.machines || []).some(Boolean)) {
        options.push({ n: ++n, type: 'legion', orderType: 'bombard', text: '器械轰击' });
      }
      // 战法
      for (const tk of (g?.warfare?.abilities || [])) {
        if (generalHasTactic(g, tk) && !b.tacticsUsed[`${actor.id}:${tk}`]) {
          options.push({ n: ++n, type: 'legion', orderType: 'tactic', tacticKey: tk, targetId: targets[0]?.id, text: `战法「${TACS[tk]?.name || tk}」` });
        }
      }
      options.push({ n: ++n, type: 'legion', orderType: 'hold', text: '据守不动' });
      options.push({ n: ++n, type: 'legion', orderType: 'retreat', text: '撤退脱离' });
    }
    return snap;
  }

  /** 战略层概要：玩家势力资源 + 对各势力外交立场 + 势力实力排名 */
  _buildStrategySnapshot(gs) {
    const ss = this.sys('StrategicSystem');
    const st = gs.strategicState;
    const me = ss.getPlayerState(gs);
    if (!me) return null;
    const diplomacy = Object.entries(me.diplomacy || {}).map(([id, rel]) => ({
      factionId: id, name: this._factionName(id), stance: rel.stance, relation: rel.relation,
    }));
    const role = st.playerRole || 'ruler';
    const commands = ss.playerCommands(gs);
    // 暗示：仅号令权(ruler)+高参与度(≥L3)下，进言才会被落实为内政外交动作；底层视角进言只是表态。
    const canPropose = commands && (gs.aiAuthority ?? 2) >= 3;
    const hint = commands
      ? (canPropose ? '可直接进言：说出你的内政或外交主张（如「劝课农桑、遣使结好东吴」），自会有人去办。' : null)
      : `你身处「${me.name}」，却无号令之权——天下大势自有人主张，你只能在洪流中安身、随波而行。`;
    return {
      season: st.season,
      playerFactionId: st.playerFactionId,
      playerRole: role,
      resources: { gold: me.gold, food: me.food, troops: me.troops, order: me.order },
      productionEfficiency: me.agg?.productionEfficiency,
      diplomacy,
      ranking: ss.ranking(gs),
      // 极简呈现：UI 只需取 resources + diplomacy 几项；hint 提示进言入口或底层处境
      hint,
    };
  }

  /** 在 options 里追加理政朝堂的内政/外交/推进动作（仅交互模式有意义） */
  _appendGovernanceOptions(gs, options) {
    if (this.combatMode !== 'interactive') return;
    const ss = this.sys('StrategicSystem');
    const me = ss.getPlayerState(gs);
    if (!me) return;
    let n = options.length;
    const afford = (cost) => Object.keys(cost || {}).every(k => (me[k] || 0) >= cost[k]);
    const _sc = schemaOf(gs);
    // 内政政令（题材表）
    for (const [pid, p] of Object.entries(_sc.policies)) {
      options.push({ n: ++n, type: 'govern', policyId: pid, text: `政令·${p.name}`, affordable: afford(p.cost) });
    }
    // 外交：对每个其它势力的可行动作（题材表）
    for (const [tid, rel] of Object.entries(me.diplomacy || {})) {
      const name = this._factionName(tid);
      for (const [aid, a] of Object.entries(_sc.diplomacyActions)) {
        if (aid === 'sow_discord') continue; // 离间需双目标，UI 层另议
        // 简单可行性：宣战/求和依当前 stance，结盟/联姻依关系
        if (aid === 'declare_war' && rel.stance === 'war') continue;
        if (aid === 'sue_peace' && rel.stance !== 'war') continue;
        if (aid === 'alliance' && (rel.relation < 40 || rel.stance === 'ally')) continue;
        if (aid === 'marriage' && rel.relation < 30) continue;
        options.push({ n: ++n, type: 'diplomacy', diplomacyAction: aid, targetId: tid, text: `外交·对${name}·${a.name}`, affordable: afford(a.cost) });
      }
    }
    options.push({ n: ++n, type: 'advance_season', text: '处理政务（推进一季）' });
  }

  isMainQuestComplete() { return !!this._mainQuestComplete; }

  destroy() { this.engine.stop(); }
}
