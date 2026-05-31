/**
 * AI vs AI 大型剧本压力测试
 *
 * 基于 playtest-ai-vs-ai-scene.mjs。改造点：
 *   - --preset <path>   传任意预设 JSON 路径（默认 presets/eternal-crown-stress-test.json）
 *   - --max-iter N      最大决策回合数（默认 200）
 *   - 玩家选择 starting choices（race/origin/background/faith）— 复刻 main.js 的角色创建
 *   - 终止条件兼容多 ending 事件（tag 含 'ending' 或 'epilogue' 都算主线完成）
 *   - 详细的压测指标输出（覆盖率/平均时延/token 分布）
 *
 * 用法：
 *   node scripts/playtest-large-script.mjs
 *   node scripts/playtest-large-script.mjs --preset presets/foo.json --max-iter 250
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
import { NPCSystem } from '../src/systems/NPCSystem.js';
import { DialogueSystem } from '../src/systems/DialogueSystem.js';
import { ContextRetriever } from '../src/systems/ContextRetriever.js';

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
const PLAYER_MODE = argVal('--player', 'ai');

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
    this.engine.registerSystem(new NPCSystem(), 34);
    this.engine.registerSystem(new DialogueSystem(), 32);
    this.engine.registerSystem(new ContextRetriever(), 31);
    this.engine.start();
  }

  loadPreset(presetData, choices = null) {
    this.preset = new GamePreset(presetData);
    this.engine.getSystem('CardManager').loadFromPreset(this.preset);
    if (this.preset.map) this.engine.getSystem('MapSystem').loadMap(this.preset.map);
    this.engine.getSystem('SceneSystem').loadFromPreset(this.preset);
    this.engine.getSystem('NPCSystem').loadFromPreset(this.preset);
    this.engine.getSystem('AIGMEngine').setPreset(this.preset);
    this.gameState = GameState.fromPreset(this.preset);

    // 应用玩家创建选项
    if (choices && this.preset.startingOptions) {
      const tags = new Set(this.gameState.playerTags || []);
      const protag = this.gameState.activeCharacters[0];
      for (const axis of ['races', 'origins', 'backgrounds', 'faiths']) {
        const opts = this.preset.startingOptions[axis] || [];
        const choiceId = choices[axis];
        const opt = opts.find(o => o.id === choiceId) || opts[0];
        if (opt) {
          (opt.tags || []).forEach(t => tags.add(t));
          if (opt.statBonus && protag) {
            for (const [k, v] of Object.entries(opt.statBonus)) {
              protag.stats[k] = (protag.stats[k] || 0) + v;
              if (k === 'hp') protag.stats.hpCurrent = protag.stats.hp;
              if (k === 'mp') protag.stats.mpCurrent = protag.stats.mp;
            }
          }
        }
      }
      this.gameState.playerTags = [...tags];

      // 起始场景路由
      let selectedStartSceneId = null;
      for (const rule of (this.preset.startingSceneRules || [])) {
        if (rule.default) continue;
        const need = rule.when?.tags || [];
        if (need.every(t => tags.has(t))) {
          selectedStartSceneId = rule.sceneId;
          break;
        }
      }
      if (!selectedStartSceneId) {
        const defRule = this.preset.startingSceneRules?.find(r => r.default);
        if (defRule) selectedStartSceneId = defRule.sceneId || defRule.default;
      }
      if (selectedStartSceneId) this._syncScenePosition(selectedStartSceneId);
    }

    this.engine.getSystem('NPCSystem').initializeNPCState(this.gameState);
    this.gameState.storyTime ||= { day: 1, hour: 8 };

    const ms = this.engine.getSystem('MemorySystem');
    if (ms) ms.initializeFromPreset(this.gameState, this.preset);
    const lore = this.preset.lore || {};
    const greeting = lore.background
      ? `欢迎来到${lore.worldName || '未知世界'}。${lore.background}`
      : '冒险开始了...';
    this.gameState.addNarrative('gm', greeting);
  }

  _syncScenePosition(sceneId) {
    const scene = this.engine.getSystem('SceneSystem').getScene(sceneId);
    if (!scene) return;
    if (!this.gameState.mapState) this.gameState.mapState = {};
    this.gameState.mapState.currentSceneId = sceneId;
    this.gameState.mapState.visitedSceneIds = [sceneId];
    if (scene.coords) this.gameState.mapState.playerPosition = { x: scene.coords.x, y: scene.coords.y };
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
      // 检查真正结局。epilogue 可能标在最终 boss 事件上，不能等同于主线完成。
      if ((card.tags || []).includes('ending') || card.id === 'ch10_epilogue' || this.gameState.variables?.game_complete === true) {
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

    // 检查真正结局。epilogue 可能标在最终 boss 事件上，不能等同于主线完成。
    if ((card.tags || []).includes('ending') || card.id === 'ch10_epilogue' || this.gameState.variables?.game_complete === true) {
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
      case 'set_worldFlag': {
        this.gameState.worldFlags ||= {};
        this.gameState.worldFlags[eff.name] = eff.value;
        break;
      }
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
        } else {
          const c = this.gameState.activeCharacters[0];
          if (c) c.stats.hpCurrent = Math.min(c.stats.hp, c.stats.hpCurrent + (eff.value || 0));
        }
        break;
      case 'damage':
        if (eff.target === 'all') {
          for (const c of this.gameState.activeCharacters) {
            c.stats.hpCurrent = Math.max(0, c.stats.hpCurrent - (eff.value || 0));
          }
        }
        break;
      case 'recruit_companion': {
        const ns = this.engine.getSystem('NPCSystem');
        if (ns && eff.npcId) {
          const ok = ns.recruitCompanion(this.gameState, eff.npcId);
          const npc = ns.getNPC(eff.npcId);
          if (ok && npc) {
            // ⚠ 关键修复：要把 NPC 真的加进 activeCharacters，否则不参与战斗
            const exists = this.gameState.activeCharacters.some(c => c.id === eff.npcId);
            if (!exists && npc.stats) {
              const slot = JSON.parse(JSON.stringify(npc));
              slot._isCompanion = true;
              slot.type = 'character';
              slot.stats.hpCurrent = slot.stats.hp;
              slot.stats.mpCurrent = slot.stats.mp || 0;
              this.gameState.activeCharacters.push(slot);
            }
            this.gameState.addNarrative('system', `🤝 ${npc.name} 加入了你的队伍。`);
          }
        }
        break;
      }
      case 'change_affection': {
        const ns = this.engine.getSystem('NPCSystem');
        if (ns && eff.npcId !== undefined) ns.changeAffection(this.gameState, eff.npcId, eff.value || 0);
        break;
      }
      case 'advance_time': {
        const h = eff.value || 1;
        this.gameState.storyTime ||= { day: 1, hour: 8 };
        this.gameState.storyTime.hour += h;
        while (this.gameState.storyTime.hour >= 24) {
          this.gameState.storyTime.hour -= 24;
          this.gameState.storyTime.day += 1;
        }
        const ns = this.engine.getSystem('NPCSystem');
        if (ns) ns.refreshNPCLocations(this.gameState);
        break;
      }
      case 'reveal_connection': {
        const ss = this.engine.getSystem('SceneSystem');
        if (ss && eff.fromId && eff.toId) ss.revealConnection(this.gameState, eff.fromId, eff.toId);
        break;
      }
      case 'kill_npc': {
        const ns = this.engine.getSystem('NPCSystem');
        if (ns && eff.npcId) ns.applyNPCDeath(this.gameState, eff.npcId);
        break;
      }
      case 'teleport_to_scene': {
        const ss = this.engine.getSystem('SceneSystem');
        if (!ss || !eff.sceneId) break;
        const target = ss.getScene(eff.sceneId);
        if (!target) break;
        const visited = this.gameState.mapState?.visitedSceneIds || [];
        if (!eff.allowUnvisited && !visited.includes(eff.sceneId)) {
          this.gameState.addNarrative('system', `（${target.name} 还未去过，不能传送）`);
          break;
        }
        this.gameState.mapState.currentSceneId = eff.sceneId;
        if (target.coords) this.gameState.mapState.playerPosition = { x: target.coords.x, y: target.coords.y };
        const ns2 = this.engine.getSystem('NPCSystem');
        if (ns2) ns2.refreshNPCLocations(this.gameState);
        this.gameState.addNarrative('system', `🛤 你来到了 ${target.name}。`);
        break;
      }
    }
  }

  _healPartyToFull(reason = '休整') {
    for (const c of this.gameState.activeCharacters || []) {
      if (!c.stats) continue;
      c.stats.hpCurrent = c.stats.hp;
      c.stats.mpCurrent = c.stats.mp || 0;
    }
    this.gameState.addNarrative('system', `（${reason}：队伍恢复至满状态）`);
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
    if (!this.gameState.activeCombat && !this.gameState.activeEvent) {
      await this._scanAfter(TRIGGER_MOMENTS.SCENE_ENTER);
    }
  }

  async _autoFinishCombat() {
    // 当选择 outcome 中含 start_combat 时被调用 — 这里不行动，留给主循环调 runCombatTurns
  }

  /** 使用消耗品（药水/食物等）— 给 PlayerAI 的 use_item action 用 */
  useItem(itemId, ownerCharId = null, targetCharId = null) {
    const progression = this.engine.getSystem('ProgressionSystem');
    if (!progression) return { success: false, reason: 'ProgressionSystem 未注册' };
    // 默认 owner = 第一个 inventory 里有的活人
    if (!ownerCharId) {
      const owner = this.gameState.activeCharacters.find(c => (c.inventory || []).includes(itemId));
      if (!owner) return { success: false, reason: `没人持有 ${itemId}` };
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
    return r;
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

  async decide(context) {
    const sys = `你是一支冒险小队的玩家/指挥官，正在玩桌游跑团 TRPG。
任务：完成主线（最终完成带 epilogue/ending 标签的事件）。

游戏机制：
- 地图是"场景节点图"，每个节点是一段戏，邻居之间可点击跳转
- 看到 reachable=false 的节点表示有门控，需要更多线索（去找其他场景探索）
- 当 situation=event 时，必须选事件给的选项之一
- 当 situation=travel 时，从邻居中挑选 reachable=true 的某个去

资源管理（重要！）：
- 当队伍 HP 低于 40% 时，**优先**用 use_item 喝药水
- **itemId 必须 100% 复制自上方"可用消耗品"列表里的 id（如 item_potion_minor），不要自己造（不要写 potion_healing / potion_small 这种）；列表为空就别用 use_item**
- 仍 HP 低又没药水时，**优先**回到 nearest_inn 提供的场景休息（inn 场景的 rest 事件会回满 HP）
- **boss_room 场景一旦开战就无回头路**——进入 boss_room 标签的场景前，先确保队伍满状态。HP 不够就 travel 退回邻居场景休整
- 不要在 HP 低于 30% 时还冲战斗节点（type=combat/dungeon）或 boss_room

只输出一个 JSON：
{ "reasoning": "<30字内推理>", "action": <action> }

<action> 仅可为：
- 事件选择: {"type":"choose","choiceId":"..."}
- 旅行到邻居: {"type":"travel","sceneId":"..."}
- 使用消耗品: {"type":"use_item","itemId":"...","targetId":"角色id（可省略=持有者自用）"}
- 自由发言: {"type":"say","text":"..."}
- 结束游戏: {"type":"end","reason":"..."}（只在主线完成后才可用）`;

    const recentBlock = context.recent.join('\n');
    const charsBlock = context.chars.map(c =>
      `  ${c.name}(${c.id}) HP${c.hp}(${c.hpPct}%) MP${c.mp}${c.alive ? '' : ' [倒下]'}`
    ).join('\n');

    let stateBlock = `情境: ${context.situation}\n`;
    stateBlock += `队伍最低 HP: ${context.lowestHpPct}%\n`;
    stateBlock += `已完成: ${context.completed.join(', ') || '无'}\n`;
    stateBlock += `变量: ${JSON.stringify(context.variables)}\n`;
    stateBlock += `worldFlags: ${JSON.stringify(context.worldFlags)}\n`;
    stateBlock += `同行伙伴: ${context.companions.join(', ') || '无'}\n`;
    stateBlock += `队伍:\n${charsBlock}\n`;

    if (context.usableItems.length > 0) {
      stateBlock += `\n可用消耗品:\n${context.usableItems.map(u => `  ${u.itemId}: ${u.name} (${u.effect}) [${u.owner} 持有]`).join('\n')}\n`;
    }

    if (context.nearestInn) {
      stateBlock += `\n⚠ HP 偏低！最近的休息点: ${context.nearestInn.name} (${context.nearestInn.sceneId})，距离 ${context.nearestInn.distance} 步\n`;
    }

    if (context.nextObjective) {
      stateBlock += `\n📌 下一个主线目标: ${context.nextObjective.hint}\n`;
      stateBlock += `（**如果当前场景不在目标场景列表里，应该 travel 到目标场景；当前已"卡住"循环时尤其要明确换方向**）\n`;
    } else {
      stateBlock += `\n📌 主线目标: （所有可触发的主线事件都已完成，请检查 endings 或寻找新分支）\n`;
    }

    if (context.situation === 'event' && context.detail) {
      stateBlock += `\n当前事件: ${context.detail.eventName} [${context.detail.eventType}]\n描述: ${context.detail.description}\n`;
      stateBlock += `可选:\n${context.detail.choices.map(c => `  ${c.id}: ${c.text}`).join('\n')}\n`;
    } else if (context.detail) {
      const tagStr = context.detail.currentScene.tags?.length ? ` tags=[${context.detail.currentScene.tags.join(',')}]` : '';
      stateBlock += `\n当前场景: ${context.detail.currentScene.name} [${context.detail.currentScene.type}]${tagStr}\n描述: ${context.detail.currentScene.description}\n`;
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
    // 指数退避重试：网络抖动 / 429 / 5xx 自动重试 3 次
    const MAX_RETRIES = 3;
    let lastErr = null;
    let resp = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
      try {
        resp = await fetch(`${this.endpoint}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (resp.ok) { lastErr = null; break; }
        // 4xx (非 429) 不重试，直接抛
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
          const t = await resp.text();
          throw new Error(`Player AI HTTP ${resp.status}: ${t.slice(0, 200)}`);
        }
        // 5xx 或 429 → 重试
        const t = await resp.text();
        lastErr = new Error(`Player AI HTTP ${resp.status}: ${t.slice(0, 200)}`);
      } catch (e) {
        // fetch failed / 网络断开
        lastErr = e.name === 'AbortError'
          ? new Error(`Player AI 请求超时（${Math.floor(API_TIMEOUT_MS / 1000)}秒）`)
          : e;
      } finally {
        clearTimeout(timeoutId);
      }
      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
    if (lastErr) throw lastErr;
    if (!resp || !resp.ok) {
      const t = resp ? await resp.text() : '';
      throw new Error(`Player AI HTTP ${resp?.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    this.callCount++;
    if (data.usage) {
      this.totalTokens += data.usage.total_tokens || 0;
      this.totalPrompt += data.usage.prompt_tokens || 0;
      this.totalCompletion += data.usage.completion_tokens || 0;
    }
    const content = data.choices?.[0]?.message?.content || '';
    // 尝试多种解析路径：原文 → 中文引号→英文 → 提取 {...} → 提取 {...} 后再 normalize 引号
    const normalizeQuotes = (s) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    const attempts = [
      content,
      normalizeQuotes(content),
    ];
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      attempts.push(m[0]);
      attempts.push(normalizeQuotes(m[0]));
    }
    for (const txt of attempts) {
      try { return JSON.parse(txt); } catch { /* try next */ }
    }
    throw new Error('Player AI 返回无效 JSON: ' + content.slice(0, 120));
  }
}

// ============================================================
// ScriptedPlayer — 不调用玩家侧 AI，由脚本扮演玩家
// ============================================================
class ScriptedPlayer extends PlayerAI {
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

    if (context.lowestHpPct < 40 && context.usableItems.length > 0) {
      const item = context.usableItems[0];
      return {
        reasoning: '低血量用药',
        action: { type: 'use_item', itemId: item.itemId, targetId: item.owner },
      };
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
class CodexManualPlayer extends PlayerAI {
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
class InteractivePlayer extends PlayerAI {
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
  console.log('=== TRPG AI vs AI 大型剧本压力测试 ===');
  const playerLabel = PLAYER_MODE === 'manual'
    ? 'Codex Manual Player'
    : (PLAYER_MODE === 'scripted' ? 'Scripted Codex Player' : PLAYER_MODEL);
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
  const playerAI = PLAYER_MODE === 'interactive'
    ? new InteractivePlayer(argVal('--cmd-file', '/tmp/play_cmd.txt'), argVal('--out-file', '/tmp/play_out.json'))
    : (PLAYER_MODE === 'manual'
      ? new CodexManualPlayer()
      : (PLAYER_MODE === 'scripted'
        ? new ScriptedPlayer()
        : new PlayerAI(ENDPOINT, KEY, PLAYER_MODEL)));
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
  const playerStats = `\n## Pro Player AI 用量\n\n- 模型: ${PLAYER_MODEL}\n- 调用: ${playerAI.callCount} 次\n- Token: ${playerAI.totalTokens} (prompt ${playerAI.totalPrompt} / completion ${playerAI.totalCompletion})\n`;

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
