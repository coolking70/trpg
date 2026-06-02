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
import { FORMATIONS, canUseFormation, generalHasTactic, TACTICS } from '../data/warfare.js';
import { POLICIES, DIPLOMACY_ACTIONS, clampRelation, stanceFromRelation } from '../data/governance.js';

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
      case 'set_diplomacy': {
        const ss = this.sys('StrategicSystem');
        const st = gs.strategicState;
        if (ss && st && eff.factionId && eff.targetId && st.factions[eff.factionId] && st.factions[eff.targetId]) {
          const cur = ss.relationOf(gs, eff.factionId, eff.targetId);
          const relation = eff.relation != null ? clampRelation(eff.relation) : clampRelation((cur.relation || 0) + (eff.relationDelta || 0));
          ss._setRelationSym(st.factions, eff.factionId, eff.targetId, relation, eff.stance || null);
        }
        break;
      }
      case 'adjust_resource': {
        const ss = this.sys('StrategicSystem');
        const fid = eff.factionId || gs.strategicState?.playerFactionId;
        const f = ss ? ss.getFactionState(gs, fid) : null;
        if (f) ss._applyDeltas(f, { gold: eff.gold || 0, food: eff.food || 0, troops: eff.troops || 0, order: eff.order || 0 });
        break;
      }
      case 'mobilize': {
        const ss = this.sys('StrategicSystem');
        const fid = eff.factionId || gs.strategicState?.playerFactionId;
        if (ss && fid) ss.mobilize(gs, fid, eff.value || eff.amount || 0);
        break;
      }
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
    const lw = this.sys('LegionWarfareSystem');
    const cm = this.sys('CardManager');
    let def = { ...battleDef, units: battleDef.units.map(u => ({ ...u })) };
    this._legionStrategyCtx = null;

    // 深耦合（Phase 33）：drawFromStrategy → 我方兵力/粮草从玩家势力国库取并扣减
    const st = this.gameState.strategicState;
    if (battleDef.drawFromStrategy && st) {
      const ss = this.sys('StrategicSystem');
      const fid = battleDef.playerFactionId || st.playerFactionId;
      const playerUnits = def.units.filter(u => u.side !== 'enemy');
      const requested = playerUnits.reduce((s, u) => s + (Number(u.troops) || 0), 0) || (ss.getFactionState(this.gameState, fid)?.troops || 0);
      const mobilized = ss.mobilize(this.gameState, fid, requested);
      const scale = requested > 0 ? mobilized / requested : 1;
      for (const u of playerUnits) u.troops = Math.max(1, Math.round((Number(u.troops) || 0) * scale));
      // 粮草：未指定则从国库粮取半数随军，并扣减
      const f = ss.getFactionState(this.gameState, fid);
      def.supply = def.supply || {};
      if (def.supply.player == null && f) {
        const carried = Math.floor((f.food || 0) * 0.5);
        def.supply.player = carried;
        f.food = Math.max(0, (f.food || 0) - carried);
      }
      // 外交援军（sideFromDiplomacy）：盟友按关系出兵助战
      if (battleDef.allyFactionId) {
        const ally = ss.getFactionState(this.gameState, battleDef.allyFactionId);
        const rel = ss.relationOf(this.gameState, fid, battleDef.allyFactionId);
        if (ally && rel.stance === 'ally') {
          const aid = ss.mobilize(this.gameState, battleDef.allyFactionId, Math.round((ally.troops || 0) * 0.4));
          if (aid > 0) def.units.push({ id: `ally_${battleDef.allyFactionId}`, side: 'player', unitType: 'infantry', troops: aid, name: `${ally.name}援军` });
        }
      }
      this._legionStrategyCtx = { fid, mobilized, enemyFid: battleDef.enemyFactionId || null };
    }

    // 装配主将信息（武备）：先用 battleDef.generals 内联，再从预设角色/NPC 卡补全
    const generals = { ...(def.generals || {}) };
    for (const u of def.units) {
      if (u.generalId && !generals[u.generalId]) {
        const card = cm ? cm.getCard(u.generalId) : null;
        if (card) generals[u.generalId] = { name: card.name, warfare: card.warfare || null };
      }
    }
    lw.startBattle(this.gameState, { ...def, generals });
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

    // 深耦合（Phase 33）：drawFromStrategy 的战役结算回国库
    const ctx = this._legionStrategyCtx;
    this._legionStrategyCtx = null;
    if (ctx && this.gameState.strategicState) {
      const ss = this.sys('StrategicSystem');
      const survivors = Math.max(0, s.playerTroops || 0);
      ss.returnTroops(this.gameState, ctx.fid, survivors); // 残部归队
      const me = ss.getFactionState(this.gameState, ctx.fid);
      if (me) {
        if (won) { me.gold += 50; me.order = Math.min(100, me.order + 6); } // 战利与振奋
        else { me.order = Math.max(0, me.order - 10); }                      // 败绩挫民心
      }
      if (ctx.enemyFid && this.gameState.strategicState.factions[ctx.enemyFid]) {
        const delta = won ? -10 : 6;
        const cur = ss.relationOf(this.gameState, ctx.fid, ctx.enemyFid);
        ss._setRelationSym(this.gameState.strategicState.factions, ctx.fid, ctx.enemyFid, cur.relation + delta);
      }
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
    const { events, season } = ss.advanceSeason(this.gameState);
    this.gameState.addNarrative('system', `🗓 政务推进，时序入第 ${season} 季。`);
    // 敌国 AI 事件 → 落 worldFlags + 叙述，供剧本触发器挂接
    this.gameState.worldFlags ||= {};
    for (const ev of (events || [])) {
      if (ev.type === 'war_declared' && ev.against === this.gameState.strategicState.playerFactionId) {
        this.gameState.worldFlags[`war_with_${ev.by}`] = true;
        this.gameState.addNarrative('system', `⚠ ${this._factionName(ev.by)} 向我方宣战！`);
      } else if (ev.type === 'attack_intent' && ev.against === this.gameState.strategicState.playerFactionId) {
        this.gameState.worldFlags[`invasion_from_${ev.by}`] = true;
        this.gameState.addNarrative('system', `⚠ ${this._factionName(ev.by)} 大军压境，意图来犯！`);
      } else if (ev.type === 'famine') {
        this.gameState.addNarrative('system', `（${this._factionName(ev.faction)} 粮荒，民心动荡）`);
      }
    }
    try { await this.sys('AIGMEngine').processGameAction('narrate_governance', { kind: 'season', season, events, player: ss.getPlayerState(this.gameState) }, this.gameState); } catch { /* */ }
    await this._scanAfter(TRIGGER_MOMENTS.SCENE_ENTER);
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
        if (action.text) this.gameState.addNarrative('player', action.text);
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
    if (gs.activeLegionBattle) {
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

    // 战略层：始终给概要；位于「理政」场景时进入 governance 态并给出内政外交动作
    if (gs.strategicState) {
      strategy = this._buildStrategySnapshot(gs);
      if (situation === 'travel' && current && (current.tags || []).includes('governance')) {
        situation = 'governance';
        this._appendGovernanceOptions(gs, options);
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
      options: (situation === 'combat' || situation === 'legion') ? options : options.filter(o => o.type !== 'travel' || o.reachable),
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
      // 列阵（仅主将阵法够格的）
      const g = actor.generalId ? (b.generals[actor.generalId] || null) : null;
      for (const fk of Object.keys(FORMATIONS)) {
        if (fk === 'none' || fk === actor.formation) continue;
        if (canUseFormation(g, fk)) {
          options.push({ n: ++n, type: 'legion', orderType: 'set_formation', formation: fk, text: `列「${FORMATIONS[fk].name}」阵` });
        }
      }
      // 器械轰击
      if ((actor.machines || []).some(Boolean)) {
        options.push({ n: ++n, type: 'legion', orderType: 'bombard', text: '器械轰击' });
      }
      // 战法
      for (const tk of (g?.warfare?.abilities || [])) {
        if (generalHasTactic(g, tk) && !b.tacticsUsed[`${actor.id}:${tk}`]) {
          options.push({ n: ++n, type: 'legion', orderType: 'tactic', tacticKey: tk, targetId: targets[0]?.id, text: `战法「${TACTICS[tk]?.name || tk}」` });
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
    return {
      season: st.season,
      playerFactionId: st.playerFactionId,
      resources: { gold: me.gold, food: me.food, troops: me.troops, order: me.order },
      productionEfficiency: me.agg?.productionEfficiency,
      diplomacy,
      ranking: ss.ranking(gs),
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
    // 内政政令
    for (const [pid, p] of Object.entries(POLICIES)) {
      options.push({ n: ++n, type: 'govern', policyId: pid, text: `政令·${p.name}`, affordable: afford(p.cost) });
    }
    // 外交：对每个其它势力的可行动作
    for (const [tid, rel] of Object.entries(me.diplomacy || {})) {
      const name = this._factionName(tid);
      for (const [aid, a] of Object.entries(DIPLOMACY_ACTIONS)) {
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
