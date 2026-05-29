/**
 * AI vs AI 完整玩测
 *
 * - 同一个 OpenAI 兼容模型扮演"玩家大脑"：观察状态、做选择、下战斗指令、写自由文本
 * - GM 路径由 AIGMEngine 调用
 *
 * 这是一次端到端的自动化跑团：让两个 AI 互相对话，把全流程完整跑下来，
 * 并把整局过程导出到 logs/playtest-ai-vs-ai-*.md
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
// HeadlessApp（与 v2 共享 — 复刻 TRPGApp 玩家路径方法）
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
    this.engine.start();
  }

  loadPreset(presetData) {
    this.preset = new GamePreset(presetData);
    this.engine.getSystem('CardManager').loadFromPreset(this.preset);
    if (this.preset.map) this.engine.getSystem('MapSystem').loadMap(this.preset.map);
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

  scanTriggers(moment = TRIGGER_MOMENTS.MOVE) {
    const engine = this.engine.getSystem('EventTriggerEngine');
    const mapSystem = this.engine.getSystem('MapSystem');
    const cardManager = this.engine.getSystem('CardManager');
    const pos = this.gameState.mapState.playerPosition;
    const ctx = { moment, tileX: pos.x, tileY: pos.y };
    if (moment === TRIGGER_MOMENTS.MOVE) {
      const md = mapSystem.getMapData();
      if (md) ctx.tileKey = md.getTileKey(pos.x, pos.y);
    }
    const ids = engine.scan(this.gameState, ctx);
    return ids.map(id => cardManager.getCard(id)).filter(Boolean);
  }

  async moveStep(dx, dy, label = '') {
    const pos = this.gameState.mapState.playerPosition;
    const nx = pos.x + dx, ny = pos.y + dy;
    const md = this.engine.getSystem('MapSystem').getMapData();
    if (!md) return null;
    if (nx < 0 || ny < 0 || nx >= md.width || ny >= md.height) {
      this.gameState.addNarrative('system', `（前方是世界边界，无法移动）`);
      return null;
    }
    const tile = md.getTile(nx, ny);
    if (!tile || !tile.walkable) {
      this.gameState.addNarrative('system', `（${tile?.name || '该方向'}不可通行）`);
      return null;
    }
    let dirLabel = '';
    if (dy < 0) dirLabel = '北'; else if (dy > 0) dirLabel = '南';
    if (dx < 0) dirLabel += '西'; else if (dx > 0) dirLabel += '东';
    if (!dirLabel) dirLabel = '原地';
    const tname = tile.name || '';
    this.gameState.addNarrative('player', `向${dirLabel}移动${tname ? ` - ${tname}` : ''}${label ? `（${label}）` : ''}`);
    this.gameState.mapState.playerPosition = { x: nx, y: ny };

    const triggered = this.scanTriggers(TRIGGER_MOMENTS.MOVE);
    if (triggered.length > 0) {
      const ev = triggered[0];
      this.gameState.activeEvent = ev;
      this.gameState.addNarrative('gm', ev.description);
      return ev;
    }
    return null;
  }

  async resolveEventChoice(eventId, choiceId) {
    const cm = this.engine.getSystem('CardManager');
    const ai = this.engine.getSystem('AIGMEngine');
    const memo = this.engine.getSystem('MemorySystem');
    const eventCard = cm.getCard(eventId);
    if (!eventCard) return null;
    const choice = (eventCard.choices || []).find(c => c.id === choiceId);
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
    if (!eventCard.repeatable && !this.gameState.completedEventIds.includes(eventId)) {
      this.gameState.completedEventIds.push(eventId);
    }
    this.gameState.activeEvent = null;
    if (memo) {
      memo.addKeyEvent(this.gameState, {
        summary: `${eventCard.name}：选择"${choice.text}"${outcome ? ` → ${outcome.text}` : ''}`,
        tags: ['event', eventCard.eventType].filter(Boolean),
      });
    }
    try {
      return await ai.processGameAction('narrate_event', {
        event: eventCard,
        choiceText: choice.text,
        outcomeText: outcome ? outcome.text : '',
      }, this.gameState);
    } catch (e) {
      console.warn('narrate_event 失败:', e.message);
      return null;
    }
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
      case 'trigger_event': {
        const cm = this.engine.getSystem('CardManager');
        const next = cm.getCard(eff.eventId);
        if (next) {
          this.gameState.activeEvent = next;
          this.gameState.addNarrative('gm', next.description);
        }
        break;
      }
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

  async handleCombatPlayerAction({ actionType, actorId, targetId, abilityId }) {
    if (!this.gameState.activeCombat) return null;
    const combat = this.engine.getSystem('CombatSystem');
    const actorPre = combat.findCombatant(this.gameState, actorId);
    const targetPre = combat.findCombatant(this.gameState, targetId);
    if (actorPre) {
      let intent;
      if (actionType === 'attack') intent = `指挥 ${actorPre.name} 普攻 ${targetPre?.name || '目标'}`;
      else if (actionType === 'ability') {
        const ab = (actorPre.abilities || []).find(a => a.id === abilityId);
        intent = `指挥 ${actorPre.name} 释放「${ab?.name || abilityId}」对 ${targetPre?.name || '目标'}`;
      } else intent = `执行 ${actionType}`;
      this.gameState.addNarrative('player', intent);
    }
    let res = null;
    if (actionType === 'attack') res = combat.performAttack(this.gameState, actorId, targetId);
    else if (actionType === 'ability') res = combat.useAbility(this.gameState, actorId, abilityId, targetId);
    if (res && res.success) {
      const action = actionType === 'attack' ? '普攻'
        : (actorPre?.abilities?.find(a => a.id === abilityId)?.name || '技能');
      const target = combat.findCombatant(this.gameState, targetId);
      const dmg = res.finalDamage ?? res.damage;
      const heal = res.healing;
      let detail = dmg > 0 ? `造成 ${dmg} 点伤害` : (heal > 0 ? `恢复 ${heal} HP` : '');
      const defeated = res.targetDefeated ? '，击败！' : '。';
      this.gameState.addNarrative('system', `${actorPre?.name || ''} 对 ${target?.name || ''} 使用 ${action}${detail ? '，' + detail : ''}${defeated}`);
    }
    return res;
  }

  async advanceTurn() {
    if (!this.gameState.activeCombat) return { combatEnd: true };
    const combat = this.engine.getSystem('CombatSystem');
    const r = combat.nextTurn(this.gameState);
    if (r.combatEnd) {
      combat.endCombat(this.gameState, r.outcome || 'victory');
      const wasVictory = (r.outcome || 'victory') === 'victory';
      this.gameState.addNarrative('system', wasVictory ? '战斗胜利！' : '战斗结束。');
      // 触发战后 AI 叙事
      try {
        await this.engine.getSystem('AIGMEngine').processGameAction('narrate_combat', {
          roundResults: [{ narrative: wasVictory ? '战斗胜利' : '战斗失败' }],
        }, this.gameState);
      } catch { /* ignore */ }
    }
    return r;
  }

  /** 让当前敌人/队友自动行动 */
  async driveCurrentActor() {
    const combat = this.gameState.activeCombat;
    if (!combat) return null;
    const slot = combat.turnOrder[combat.currentActorIndex];
    if (!slot) return null;
    const cs = this.engine.getSystem('CombatSystem');

    if (slot.type === 'enemy') {
      const enemy = cs.findCombatant(this.gameState, slot.id);
      if (!enemy || enemy.stats.hpCurrent <= 0) return null;
      const target = this.gameState.activeCharacters.find(c => c.stats.hpCurrent > 0);
      if (!target) return null;
      const r = cs.performAttack(this.gameState, slot.id, target.id);
      if (r && r.success) {
        const dmg = r.finalDamage ?? r.damage;
        this.gameState.addNarrative('system', `${enemy.name} 攻击 ${target.name}，造成 ${dmg} 点伤害${r.targetDefeated ? '，倒下！' : '。'}`);
      }
      return r;
    }
    return null;  // 角色行动由 Pro 模型决定
  }

  async playerAction(text) {
    this.gameState.addNarrative('player', text);
    try {
      return await this.engine.getSystem('AIGMEngine').processGameAction('player_action', { text, moved: false }, this.gameState);
    } catch (e) {
      console.warn('player_action 失败:', e.message);
      return null;
    }
  }
}

// ============================================================
// PlayerAI（Pro 模型扮演玩家大脑）
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
    const md = app.engine.getSystem('MapSystem').getMapData();
    const pos = gs.mapState.playerPosition;

    // 5×5 地图视野
    const view = [];
    for (let dy = -2; dy <= 2; dy++) {
      const row = [];
      for (let dx = -2; dx <= 2; dx++) {
        const tx = pos.x + dx, ty = pos.y + dy;
        if (tx < 0 || ty < 0 || tx >= md.width || ty >= md.height) { row.push('·'); continue; }
        if (dx === 0 && dy === 0) row.push('@');
        else row.push(md.getTileKey(tx, ty));
      }
      view.push(row.join(' '));
    }

    const pois = (md.pointsOfInterest || []).map(p => `${p.name}@(${p.x},${p.y})`);
    const chars = gs.activeCharacters.map(c => ({
      id: c.id, name: c.name,
      hp: `${c.stats.hpCurrent}/${c.stats.hp}`,
      mp: `${c.stats.mpCurrent}/${c.stats.mp}`,
      alive: c.stats.hpCurrent > 0,
      abilities: (c.abilities || []).map(a => `${a.id}:${a.name}(mp${a.cost?.mp || 0})`),
    }));
    const recent = gs.narrativeLog.slice(-10).map(n => {
      const lbl = { gm: 'GM', player: '我', system: '系统' }[n.speaker] || n.speaker;
      return `[${lbl}] ${n.text.slice(0, 220)}`;
    });

    let situation = 'free', detail = null;
    if (gs.activeEvent) {
      situation = 'event';
      const ev = gs.activeEvent;
      detail = {
        eventName: ev.name,
        eventType: ev.eventType,
        description: ev.description,
        choices: (ev.choices || []).map(c => ({ id: c.id, text: c.text })),
      };
    } else if (gs.activeCombat) {
      const c = gs.activeCombat;
      const slot = c.turnOrder[c.currentActorIndex];
      if (slot && slot.type === 'character') {
        situation = 'combat';
        const actor = gs.activeCharacters.find(ch => ch.id === slot.id);
        detail = {
          round: c.round,
          yourTurn: actor ? { id: actor.id, name: actor.name, abilities: chars.find(ch => ch.id === actor.id).abilities } : null,
          enemies: c.enemies.filter(e => e.stats.hpCurrent > 0).map(e => ({ id: e.id, name: e.name, hp: e.stats.hpCurrent })),
          allies: chars.filter(ch => ch.alive),
        };
      }
    }

    return {
      situation, detail, view, pois, chars,
      pos, recent,
      completed: gs.completedEventIds,
      variables: gs.variables,
      turn: gs.turnNumber,
    };
  }

  async decide(context) {
    const sys = `你是一支 4 人冒险小队的玩家/指挥官，正在玩 TRPG。世界：黑暗纪元第三年的暗黑森林。
你的任务：完成 10 章主线（受命出征→探索→对决森林巫妖→黎明）。

地图字符：S=出发点 V=村庄 D=遗迹入口 R=道路 G=草地 T=森林 M=山 W=水 @=你

规则：
- 不要重复触发已完成事件
- 移动 1 格只能 4 邻接（dx/dy 是 -1/0/1，但不能同时非零；不可通过 M 山 W 水）
- 战斗时只能选活着的敌人作为目标；技能要检查 MP 够不够
- 推动主线：起点→道路→村庄(7,1)→森林→遗迹(17,10)
- 关键变量决定支线分支：quest_received、met_traveler、knows_dark_knight、opened_gate
- **只有完成 ch10_epilogue 或全队倒下才算结束**。中途不要用 end，要继续探索找下一个事件触发。
- 战斗结束后立刻继续移动/探索，不要 end。

只输出一个 JSON，结构：
{ "reasoning": "<30字内推理>", "action": <action> }

<action> 仅可为以下之一（type 字段必填）：
- 事件选择: {"type":"choose","choiceId":"..."}
- 战斗普攻: {"type":"combat","actionType":"attack","actorId":"...","targetId":"..."}
- 战斗技能: {"type":"combat","actionType":"ability","actorId":"...","abilityId":"...","targetId":"..."}
- 单步移动: {"type":"move","dx":<-1|0|1>,"dy":<-1|0|1>}
- 自由文本: {"type":"say","text":"..."}
- 结束游戏: {"type":"end","reason":"..."}

只在 situation==event 时用 choose；situation==combat 时用 combat；其余可用 move/say/end。`;

    const recentBlock = context.recent.join('\n');
    const charsBlock = context.chars.map(c =>
      `  ${c.name}(${c.id}) HP${c.hp} MP${c.mp}${c.alive ? '' : ' [倒下]'} 技能:${c.abilities.join('|') || '无'}`
    ).join('\n');

    let stateBlock = `情境: ${context.situation}\n回合: ${context.turn}\n位置: (${context.pos.x}, ${context.pos.y})\n`;
    stateBlock += `视野:\n${context.view.join('\n')}\n`;
    stateBlock += `POI: ${context.pois.join(', ')}\n`;
    stateBlock += `已完成: ${context.completed.join(', ') || '无'}\n`;
    stateBlock += `变量: ${JSON.stringify(context.variables)}\n`;
    stateBlock += `队伍:\n${charsBlock}\n`;

    if (context.situation === 'event' && context.detail) {
      stateBlock += `\n当前事件: ${context.detail.eventName} [${context.detail.eventType}]\n描述: ${context.detail.description}\n`;
      stateBlock += `可选:\n${context.detail.choices.map(c => `  ${c.id}: ${c.text}`).join('\n')}\n`;
    } else if (context.situation === 'combat' && context.detail) {
      const d = context.detail;
      stateBlock += `\n战斗第 ${d.round} 轮 — 现在轮到 ${d.yourTurn?.name}(${d.yourTurn?.id})\n`;
      stateBlock += `敌人:\n${d.enemies.map(e => `  ${e.id} ${e.name} HP=${e.hp}`).join('\n')}\n`;
      stateBlock += `本角色技能: ${d.yourTurn?.abilities?.join('|') || '无'}\n`;
    }

    stateBlock += `\n最近叙事:\n${recentBlock}\n\n请给出下一步决策（JSON）：`;

    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: stateBlock },
      ],
      temperature: 0.5,
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
      this.totalTokens += (data.usage.total_tokens || 0);
      this.totalPrompt += (data.usage.prompt_tokens || 0);
      this.totalCompletion += (data.usage.completion_tokens || 0);
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
// 主驱动循环
// ============================================================
async function applyDecision(app, action) {
  if (!action || !action.type) return 'noop';
  switch (action.type) {
    case 'choose': {
      const ev = app.gameState.activeEvent;
      if (!ev) return 'no-event';
      await app.resolveEventChoice(ev.id, action.choiceId);
      return 'choose-applied';
    }
    case 'combat': {
      if (!app.gameState.activeCombat) return 'no-combat';
      await app.handleCombatPlayerAction({
        actionType: action.actionType,
        actorId: action.actorId,
        targetId: action.targetId,
        abilityId: action.abilityId,
      });
      // 与 main.js 一致：玩家行动后推进回合
      await app.advanceTurn();
      return 'combat-applied';
    }
    case 'move': {
      if (app.gameState.activeEvent || app.gameState.activeCombat) return 'busy';
      const dx = Math.max(-1, Math.min(1, action.dx | 0));
      const dy = Math.max(-1, Math.min(1, action.dy | 0));
      // 禁止斜走
      if (dx !== 0 && dy !== 0) {
        await app.moveStep(dx, 0);
      } else {
        await app.moveStep(dx, dy);
      }
      return 'move-applied';
    }
    case 'say': {
      if (app.gameState.activeCombat) return 'busy';  // 创意行动暂不接
      await app.playerAction(String(action.text || '').slice(0, 200));
      return 'say-applied';
    }
    case 'end':
      return 'end';
    default:
      return 'unknown';
  }
}

/** 战斗中自动处理敌人 / 倒下的角色的回合 */
async function autoProcessNonPlayerTurns(app) {
  let safety = 0;
  while (app.gameState.activeCombat && safety++ < 40) {
    const c = app.gameState.activeCombat;
    const slot = c.turnOrder[c.currentActorIndex];
    if (!slot) break;
    const cs = app.engine.getSystem('CombatSystem');
    const combatant = cs.findCombatant(app.gameState, slot.id);
    if (slot.type === 'character') {
      if (combatant && combatant.stats.hpCurrent > 0) break;  // 玩家回合
      // 倒下了，跳过
      const r = await app.advanceTurn();
      if (r.combatEnd) return;
      continue;
    }
    if (slot.type === 'enemy') {
      if (!combatant || combatant.stats.hpCurrent <= 0) {
        const r = await app.advanceTurn();
        if (r.combatEnd) return;
        continue;
      }
      await app.driveCurrentActor();
      const r = await app.advanceTurn();
      if (r.combatEnd) return;
    } else {
      const r = await app.advanceTurn();
      if (r.combatEnd) return;
    }
  }
}

async function gameLoop(app, playerAI, maxIterations = 40) {
  let consecutiveErrors = 0;
  for (let i = 0; i < maxIterations; i++) {
    // 处理非玩家回合（敌人 / 死亡跳过）
    await autoProcessNonPlayerTurns(app);

    const gs = app.gameState;

    // 终止条件
    if (gs.completedEventIds.includes('ch10_epilogue')) {
      console.log('★ 主线完成（ch10）');
      return 'main-quest-done';
    }
    if (gs.activeCharacters.every(c => c.stats.hpCurrent <= 0)) {
      console.log('✗ 全队倒下');
      return 'party-wiped';
    }
    if (i > 0 && i % 8 === 0) {
      // 初始扫描一次（避免开场没站在 POI 上）
      const triggered = app.scanTriggers(TRIGGER_MOMENTS.MOVE);
      if (triggered.length && !gs.activeEvent && !gs.activeCombat) {
        const ev = triggered[0];
        gs.activeEvent = ev;
        gs.addNarrative('gm', ev.description);
      }
    }

    // 询问 Pro 模型
    const context = playerAI.buildContext(app);
    let decision;
    try {
      decision = await playerAI.decide(context);
      consecutiveErrors = 0;
    } catch (e) {
      consecutiveErrors++;
      console.warn(`[iter ${i+1}] Player AI 失败: ${e.message}`);
      if (consecutiveErrors >= 3) {
        console.warn('Player AI 连续失败 3 次，结束');
        return 'player-ai-failed';
      }
      // 兜底：随机方向走一格
      decision = { reasoning: '兜底', action: { type: 'move', dx: 0, dy: 1 } };
    }

    const shortAction = JSON.stringify(decision.action).slice(0, 100);
    console.log(`[iter ${i+1}] ${context.situation} | ${decision.reasoning || ''} → ${shortAction}`);

    const r = await applyDecision(app, decision.action);
    if (r === 'end') {
      console.log('Pro 模型选择结束');
      return 'player-end';
    }

    // 让事件循环消化
    await new Promise(r => setTimeout(r, 100));
  }
  return 'max-iterations';
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('=== TRPG AI vs AI 完整玩测 ===');
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
  // 把玩家放在起点 POI 上，让开场扫描能触发 ch1
  app.gameState.mapState.playerPosition = { x: 3, y: 7 };
  // 主动扫描一次，触发 ch1
  const initialTriggered = app.scanTriggers(TRIGGER_MOMENTS.MOVE);
  if (initialTriggered.length) {
    const ev = initialTriggered[0];
    app.gameState.activeEvent = ev;
    app.gameState.addNarrative('gm', ev.description);
    console.log(`开场事件触发: ${ev.name}`);
  }

  const playerAI = new PlayerAI(ENDPOINT, KEY, PLAYER_MODEL);

  const status = await gameLoop(app, playerAI, 60);
  console.log(`\n=== 终止状态: ${status} ===`);

  // 导出日志
  const logSystem = app.engine.getSystem('LogSystem');
  const md = logSystem.generateMarkdown(app.gameState, app.preset);
  const json = JSON.stringify(logSystem.generateReport(app.gameState, app.preset), null, 2);

  // 在末尾追加 AI vs AI 元数据
  const ts = new Date().toISOString().substring(0, 10);
  const playerStats = `\n## Pro Player AI 用量\n\n- 模型: ${PLAYER_MODEL}\n- 调用: ${playerAI.callCount} 次\n- Token: ${playerAI.totalTokens} (prompt ${playerAI.totalPrompt} / completion ${playerAI.totalCompletion})\n`;

  const outDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const mdFile = path.join(outDir, `playtest-ai-vs-ai-${ts}.md`);
  const jsonFile = path.join(outDir, `playtest-ai-vs-ai-${ts}.json`);
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
