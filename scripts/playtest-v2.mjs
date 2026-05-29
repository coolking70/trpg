/**
 * 纯后端完整玩测脚本 v2
 *
 * 与 v1 的差异：
 *   - 通过 _resolveEventChoice / _handleCombatPlayerAction 风格的封装方法
 *     发起所有玩家操作，保证 "[你]" 玩家叙事全程留痕
 *   - 模拟一段更完整的流程：开场扫描 → ch1 → ch2 → ch3 → 战斗（普攻+技能）→ 自由文本
 *
 * 使用：
 *   node scripts/playtest-v2.mjs
 * 环境变量（可选）：
 *   OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL
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
// requestAnimationFrame polyfill (GameEngine.start 调用)
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame
  || ((cb) => setTimeout(() => cb(Date.now()), 16));
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame
  || ((id) => clearTimeout(id));

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

const API_KEY = process.env.OPENAI_API_KEY || '';
const API_ENDPOINT = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1';
const API_MODEL = process.env.OPENAI_MODEL || 'qwen/qwen3.6-35b-a3b';

// ---------- HeadlessApp：复刻 TRPGApp 玩家路径中的关键方法 ----------
class HeadlessApp {
  constructor() {
    this.engine = new GameEngine();
    this.eventSystem = new EventSystem();
    this.gameState = null;
    this.preset = null;
    this._actionLocked = false;
    this.engine.getGameState = () => this.gameState;
    this._registerSystems();
  }

  _registerSystems() {
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
    const cardManager = this.engine.getSystem('CardManager');
    cardManager.loadFromPreset(this.preset);

    const mapSystem = this.engine.getSystem('MapSystem');
    if (this.preset.map) mapSystem.loadMap(this.preset.map);

    const aiEngine = this.engine.getSystem('AIGMEngine');
    aiEngine.setPreset(this.preset);

    this.gameState = GameState.fromPreset(this.preset);

    const memorySystem = this.engine.getSystem('MemorySystem');
    if (memorySystem) memorySystem.initializeFromPreset(this.gameState, this.preset);

    const lore = this.preset.lore || {};
    const greeting = lore.background
      ? `欢迎来到${lore.worldName || '未知世界'}。${lore.background}`
      : '冒险开始了...';
    this.gameState.addNarrative('gm', greeting);
  }

  // ---- 移动 ----
  setPlayerPosition(x, y) {
    this.gameState.mapState.playerPosition = { x, y };
  }

  /** 扫描触发器（基于当前 playerPosition）返回 eventCard 数组 */
  scanTriggers(moment = TRIGGER_MOMENTS.MOVE) {
    const engine = this.engine.getSystem('EventTriggerEngine');
    const mapSystem = this.engine.getSystem('MapSystem');
    const cardManager = this.engine.getSystem('CardManager');
    const pos = this.gameState.mapState.playerPosition;
    const ctx = { moment, tileX: pos.x, tileY: pos.y };
    if (moment === TRIGGER_MOMENTS.MOVE) {
      const mapData = mapSystem ? mapSystem.getMapData() : null;
      if (mapData) ctx.tileKey = mapData.getTileKey(pos.x, pos.y);
    }
    const ids = engine.scan(this.gameState, ctx);
    return ids.map(id => cardManager.getCard(id)).filter(Boolean);
  }

  /** 模拟玩家走到 (x,y)，扫触发，若有事件则返回事件 ID */
  async moveAndScan(x, y, label) {
    const pos = this.gameState.mapState.playerPosition;
    const dx = x - pos.x, dy = y - pos.y;
    let dirLabel = '';
    if (dy < 0) dirLabel = '北'; else if (dy > 0) dirLabel = '南';
    if (dx < 0) dirLabel += '西'; else if (dx > 0) dirLabel += '东';
    const actionText = `向${dirLabel || '原地'}移动${label ? ` - ${label}` : ''}`;
    this.gameState.addNarrative('player', actionText);

    this.setPlayerPosition(x, y);

    // 触发扫描
    const triggered = this.scanTriggers(TRIGGER_MOMENTS.MOVE);
    if (triggered.length > 0) {
      const eventCard = triggered[0];
      this.gameState.activeEvent = eventCard;
      this.gameState.addNarrative('gm', eventCard.description);
      return eventCard;
    }
    return null;
  }

  /** 复刻 _resolveEventChoice（含玩家叙事留痕 + AI 叙事） */
  async resolveEventChoice(eventId, choiceId) {
    const cardManager = this.engine.getSystem('CardManager');
    const aiEngine = this.engine.getSystem('AIGMEngine');
    const memorySystem = this.engine.getSystem('MemorySystem');

    const eventCard = cardManager.getCard(eventId);
    if (!eventCard) return null;
    const choice = (eventCard.choices || []).find(c => c.id === choiceId);
    if (!choice) return null;

    // 玩家叙事
    this.gameState.addNarrative('player', `选择：${choice.text}`);

    // 结果
    let outcome = null;
    if (choice.outcomes && choice.outcomes.length) {
      const rand = Math.random();
      let cum = 0;
      for (const o of choice.outcomes) {
        cum += o.probability || 0;
        if (rand <= cum) { outcome = o; break; }
      }
      if (!outcome) outcome = choice.outcomes[choice.outcomes.length - 1];
    }

    // 应用效果（简版）
    if (outcome && outcome.effects) {
      for (const eff of outcome.effects) this._applyEventEffect(eff);
    }

    if (!eventCard.repeatable) {
      if (!this.gameState.completedEventIds.includes(eventId)) {
        this.gameState.completedEventIds.push(eventId);
      }
    }
    this.gameState.activeEvent = null;

    if (memorySystem) {
      const summary = `${eventCard.name}：选择"${choice.text}"${outcome ? ` → ${outcome.text}` : ''}`;
      memorySystem.addKeyEvent(this.gameState, { summary, tags: ['event', eventCard.eventType].filter(Boolean) });
    }

    // AI 叙事
    try {
      const result = await aiEngine.processGameAction('narrate_event', {
        event: eventCard,
        choiceText: choice.text,
        outcomeText: outcome ? outcome.text : '',
      }, this.gameState);
      return { outcome, aiResult: result };
    } catch (e) {
      console.warn('AI narrate_event 失败:', e.message);
      return { outcome, aiResult: null };
    }
  }

  _applyEventEffect(effect) {
    switch (effect.type) {
      case 'add_item': {
        const char = this.gameState.activeCharacters[0];
        if (char) { (char.inventory ||= []).push(effect.itemId); }
        break;
      }
      case 'set_variable':
        this.gameState.variables[effect.name] = effect.value;
        break;
      case 'add_memory': {
        const memorySystem = this.engine.getSystem('MemorySystem');
        if (memorySystem) memorySystem.addKeyEvent(this.gameState, { summary: effect.value, tags: ['manual'] });
        break;
      }
      case 'start_combat':
        this._startCombat(effect.enemyIds || []);
        break;
      case 'heal':
        if (effect.target === 'all') {
          for (const c of this.gameState.activeCharacters) {
            c.stats.hpCurrent = Math.min(c.stats.hp, c.stats.hpCurrent + (effect.value || 0));
          }
        }
        break;
      case 'trigger_event':
        // 链式事件先不处理
        break;
    }
  }

  /** 开战（复刻 _startCombat 的实例化逻辑） */
  _startCombat(enemyIds) {
    const cardManager = this.engine.getSystem('CardManager');
    const combatSystem = this.engine.getSystem('CombatSystem');

    const enemies = enemyIds
      .map((id, idx) => ({ original: cardManager.getCard(id), idx }))
      .filter(o => o.original)
      .map(({ original, idx }) => {
        const clone = JSON.parse(JSON.stringify(original));
        clone._originalId = original.id;
        clone.id = `${original.id}#${idx}`;
        return clone;
      });
    if (enemies.length === 0) return;

    combatSystem.startCombat(this.gameState, enemies);
  }

  /** 复刻 _handleCombatPlayerAction（含玩家意图叙事） */
  async handleCombatPlayerAction({ actionType, actorId, targetId, abilityId }) {
    if (!this.gameState || !this.gameState.activeCombat) return null;

    const combatSystem = this.engine.getSystem('CombatSystem');
    const actorPre = combatSystem.findCombatant(this.gameState, actorId);
    const targetPre = combatSystem.findCombatant(this.gameState, targetId);
    if (actorPre) {
      let intent;
      if (actionType === 'attack') {
        intent = `指挥 ${actorPre.name} 普攻 ${targetPre?.name || '目标'}`;
      } else if (actionType === 'ability') {
        const ab = (actorPre.abilities || []).find(a => a.id === abilityId);
        intent = `指挥 ${actorPre.name} 释放「${ab?.name || abilityId}」对 ${targetPre?.name || '目标'}`;
      } else if (actionType === 'flee') {
        intent = `下令撤退`;
      } else {
        intent = `执行 ${actionType}`;
      }
      this.gameState.addNarrative('player', intent);
    }

    let result = null;
    if (actionType === 'attack') {
      result = combatSystem.performAttack(this.gameState, actorId, targetId);
    } else if (actionType === 'ability') {
      result = combatSystem.useAbility(this.gameState, actorId, abilityId, targetId);
    }

    if (result && result.success) {
      const action = actionType === 'attack' ? '普攻'
        : (combatSystem.findCombatant(this.gameState, actorId)?.abilities?.find(a => a.id === abilityId)?.name || '技能');
      const target = combatSystem.findCombatant(this.gameState, targetId);
      const actor = combatSystem.findCombatant(this.gameState, actorId);
      const dmg = result.finalDamage !== undefined ? result.finalDamage : result.damage;
      const heal = result.healing;
      let detail = '';
      if (dmg > 0) detail = `造成 ${dmg} 点伤害`;
      else if (heal > 0) detail = `恢复 ${heal} HP`;
      const defeated = result.targetDefeated ? '，击败！' : '。';
      this.gameState.addNarrative('system', `${actor?.name || ''} 对 ${target?.name || ''} 使用 ${action}${detail ? '，' + detail : ''}${defeated}`);
    }

    return result;
  }

  /** 推进一回合（敌人自动走 AI / 队友自动 / 玩家手动） */
  async advanceTurn() {
    if (!this.gameState.activeCombat) return { done: true };
    const combatSystem = this.engine.getSystem('CombatSystem');
    const turnResult = combatSystem.nextTurn(this.gameState);
    if (turnResult.combatEnd) {
      this._finalizeCombat(turnResult);
      return { combatEnd: true, turnResult };
    }
    return { combatEnd: false, turnResult };
  }

  _finalizeCombat(turnResult) {
    const combatSystem = this.engine.getSystem('CombatSystem');
    combatSystem.endCombat(this.gameState, turnResult.outcome || 'victory');
    const wasVictory = (turnResult.outcome || 'victory') === 'victory';
    this.gameState.addNarrative('system', wasVictory ? '战斗胜利！' : '战斗结束。');
  }

  /** 让当前行动者行动（自动判断队友 / 敌人） */
  async driveCurrentActor() {
    const combat = this.gameState.activeCombat;
    if (!combat) return null;
    const slot = combat.turnOrder[combat.currentActorIndex];
    if (!slot) return null;

    const combatSystem = this.engine.getSystem('CombatSystem');
    const allyAI = this.engine.getSystem('AllyAIController');

    if (slot.type === 'enemy') {
      // 敌人执行动作
      const enemy = combatSystem.findCombatant(this.gameState, slot.id);
      if (!enemy || enemy.stats.hpCurrent <= 0) return null;
      const target = this.gameState.activeCharacters.find(c => c.stats.hpCurrent > 0);
      if (!target) return null;
      const res = combatSystem.performAttack(this.gameState, slot.id, target.id);
      if (res && res.success) {
        const dmg = res.finalDamage !== undefined ? res.finalDamage : res.damage;
        this.gameState.addNarrative('system', `${enemy.name} 攻击 ${target.name}，造成 ${dmg} 点伤害。`);
      }
      return res;
    }

    if (slot.type === 'character') {
      // 队友：用 AllyAIController 启发式
      const character = this.gameState.activeCharacters.find(c => c.id === slot.id);
      if (!character || character.stats.hpCurrent <= 0) return null;
      const decision = allyAI.decideAction(character, this.gameState);
      if (!decision) return null;
      // 玩家留痕（队友自主行动也算队伍指令的延续）
      this.gameState.addNarrative('player', `让 ${character.name} ${decision.actionType === 'ability' ? '使用技能' : '行动'}`);
      let res;
      if (decision.actionType === 'attack') {
        res = combatSystem.performAttack(this.gameState, slot.id, decision.targetId);
      } else if (decision.actionType === 'ability') {
        res = combatSystem.useAbility(this.gameState, slot.id, decision.abilityId, decision.targetId);
      }
      if (res && res.success) {
        const dmg = res.finalDamage !== undefined ? res.finalDamage : res.damage;
        const target = combatSystem.findCombatant(this.gameState, decision.targetId);
        const actionName = decision.actionType === 'attack' ? '普攻'
          : (character.abilities?.find(a => a.id === decision.abilityId)?.name || '技能');
        this.gameState.addNarrative('system', `${character.name} 对 ${target?.name || ''} 使用 ${actionName}，造成 ${dmg} 点伤害${res.targetDefeated ? '，击败！' : '。'}`);
      }
      return res;
    }
    return null;
  }

  /** 玩家自由输入（非战斗） */
  async playerAction(text) {
    this.gameState.addNarrative('player', text);
    const aiEngine = this.engine.getSystem('AIGMEngine');
    try {
      return await aiEngine.processGameAction('player_action', { text, moved: false }, this.gameState);
    } catch (e) {
      console.warn('AI player_action 失败:', e.message);
      return null;
    }
  }
}

// ---------- 主流程 ----------
async function main() {
  console.log('=== TRPG 完整玩测 v2 启动 ===');
  console.log(`API: ${API_MODEL} @ ${API_ENDPOINT}`);

  const app = new HeadlessApp();

  // 配置 AI
  const aiEngine = app.engine.getSystem('AIGMEngine');
  aiEngine.setAPIConfig({
    endpoint: API_ENDPOINT,
    apiKey: API_KEY,
    model: API_MODEL,
    maxTokens: 3200,
    temperature: 0.7,
  });

  // 加载默认预设
  app.loadPreset(DEFAULT_PRESET);
  console.log(`已加载预设: ${app.preset.name}`);

  // ---- 开场：在起点 POI 上扫描，触发 ch1 ----
  console.log('\n--- 阶段 1：开场（起点 POI） ---');
  app.setPlayerPosition(3, 7);  // poi_spawn
  let triggered = app.scanTriggers(TRIGGER_MOMENTS.MOVE);
  if (triggered.length > 0) {
    const ev = triggered[0];
    app.gameState.activeEvent = ev;
    app.gameState.addNarrative('gm', ev.description);
    console.log(`触发事件: ${ev.name}`);
    await app.resolveEventChoice('ch1_start', 'accept_quest');
  }

  // ---- 沿道路移动，尝试触发 ch2 神秘旅人 ----
  console.log('\n--- 阶段 2：道路 → 神秘旅人 ---');
  Math.random = (() => {
    // 固定的伪随机序列，确保 ch2 必触发（probability 0.55）
    const seq = [0.1, 0.2, 0.3, 0.4, 0.5];
    let i = 0;
    return () => seq[(i++) % seq.length];
  })();
  // 几个道路 R 上的格子尝试
  const roadCandidates = [[4, 7], [5, 7], [5, 6], [6, 5], [7, 4], [7, 3]];
  let ch2Triggered = false;
  for (const [x, y] of roadCandidates) {
    const ev = await app.moveAndScan(x, y);
    if (ev && ev.id === 'ch2_traveler') {
      console.log(`触发事件: ${ev.name} @(${x},${y})`);
      await app.resolveEventChoice('ch2_traveler', 'accept_help');
      ch2Triggered = true;
      break;
    }
  }
  if (!ch2Triggered) console.log('ch2 未触发（地块/概率未命中）');

  // ---- 移动到 poi_village → 触发 ch3 ----
  console.log('\n--- 阶段 3：村落 ---');
  await app.moveAndScan(7, 1, '林间村落');
  triggered = app.scanTriggers(TRIGGER_MOMENTS.MOVE);
  if (app.gameState.activeEvent && app.gameState.activeEvent.id === 'ch3_village') {
    console.log(`触发事件: ch3_village`);
    await app.resolveEventChoice('ch3_village', 'ask_dark_knight');
  }

  // ---- 回到森林尝试触发 ch5 暗影狼 ----
  console.log('\n--- 阶段 4：森林 → 暗影狼伏击 ---');
  // 直接走森林，遇到任何事件就解析掉，确保 ch5 能上来
  Math.random = (() => {
    const seq = [0.1, 0.15, 0.18, 0.22, 0.12, 0.16, 0.2, 0.24];
    let i = 0;
    return () => seq[(i++) % seq.length];
  })();
  const forestCandidates = [[8, 2], [10, 4], [12, 6], [13, 8], [11, 10], [8, 12]];
  let combatStarted = false;
  for (const [x, y] of forestCandidates) {
    const ev = await app.moveAndScan(x, y, '森林深处');
    if (!ev) continue;
    console.log(`触发事件: ${ev.name} @(${x},${y})`);
    if (ev.id === 'ch5_wolves') {
      await app.resolveEventChoice('ch5_wolves', 'fight');
      combatStarted = true;
      break;
    } else if (ev.id === 'ch6_dark_knight') {
      // 选择唤醒，让他放行（避免堵住后续触发）
      await app.resolveEventChoice('ch6_dark_knight', 'redeem');
      if (app.gameState.activeCombat) { combatStarted = true; break; }
    } else {
      // 其它事件就第一个选项过掉
      const firstChoice = (ev.choices || [])[0];
      if (firstChoice) {
        await app.resolveEventChoice(ev.id, firstChoice.id);
        if (app.gameState.activeCombat) { combatStarted = true; break; }
      }
    }
  }
  // 如果探索完仍没触发战斗，主动调用 ch5 来保证战斗演示
  if (!combatStarted) {
    console.log('未自然触发战斗，主动启动 ch5 暗影狼伏击作演示');
    app.gameState.addNarrative('player', '主动迎战出现的暗影狼');
    app._applyEventEffect({ type: 'start_combat', enemyIds: ['enemy_002', 'enemy_002'] });
    if (!app.gameState.completedEventIds.includes('ch5_wolves')) {
      app.gameState.completedEventIds.push('ch5_wolves');
    }
  }

  // ---- 战斗循环：让玩家亲自下达指令 ----
  if (app.gameState.activeCombat) {
    console.log('\n--- 阶段 5：战斗（玩家手动操作） ---');
    Math.random = Math.random;  // 恢复
    let safety = 0;
    while (app.gameState.activeCombat && safety++ < 60) {
      const combat = app.gameState.activeCombat;
      const slot = combat.turnOrder[combat.currentActorIndex];
      if (!slot) break;

      const combatSystem = app.engine.getSystem('CombatSystem');
      const combatant = combatSystem.findCombatant(app.gameState, slot.id);
      if (!combatant || combatant.stats.hpCurrent <= 0) {
        // 死亡的跳过
        const r = await app.advanceTurn();
        if (r.combatEnd) break;
        continue;
      }

      if (slot.type === 'character') {
        // 第一个活着的角色：玩家亲自下令
        // 找一个活着的敌人
        const aliveEnemy = combat.enemies.find(e => e.stats.hpCurrent > 0);
        if (!aliveEnemy) { await app.advanceTurn(); continue; }

        // 不同角色用不同动作演示
        if (combatant.name === '艾拉') {
          await app.handleCombatPlayerAction({ actionType: 'attack', actorId: combatant.id, targetId: aliveEnemy.id });
        } else if (combatant.name === '薇拉' && combatant.abilities && combatant.abilities[0]) {
          await app.handleCombatPlayerAction({ actionType: 'ability', actorId: combatant.id, targetId: aliveEnemy.id, abilityId: combatant.abilities[0].id });
        } else if (combatant.name === '雷恩' && combatant.abilities && combatant.abilities[0]) {
          await app.handleCombatPlayerAction({ actionType: 'ability', actorId: combatant.id, targetId: aliveEnemy.id, abilityId: combatant.abilities[0].id });
        } else {
          await app.handleCombatPlayerAction({ actionType: 'attack', actorId: combatant.id, targetId: aliveEnemy.id });
        }
      } else {
        // 敌人自动
        await app.driveCurrentActor();
      }
      const adv = await app.advanceTurn();
      if (adv.combatEnd) break;
    }
    console.log(`战斗结束（${safety} 次迭代）`);

    // 让 AI 写一段战斗后叙事
    try {
      await aiEngine.processGameAction('narrate_combat_end', {
        outcome: 'victory',
        defeatedEnemies: [{ id: 'enemy_002', name: '暗影狼' }],
      }, app.gameState);
    } catch (e) { /* ignore */ }
  }

  // ---- 自由文本输入：玩家探索 ----
  console.log('\n--- 阶段 6：自由文本输入 ---');
  await app.playerAction('我蹲下检查地面，看有没有狼留下的痕迹或线索');

  await new Promise(r => setTimeout(r, 200));  // 让所有 await 完成

  // ---- 导出日志 ----
  console.log('\n--- 阶段 7：生成日志 ---');
  const logSystem = app.engine.getSystem('LogSystem');
  const md = logSystem.generateMarkdown(app.gameState, app.preset);
  const json = JSON.stringify(logSystem.generateReport(app.gameState, app.preset), null, 2);

  const outDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().substring(0, 10);
  const mdFile = path.join(outDir, `playtest-local-llm-${ts}-v2.md`);
  const jsonFile = path.join(outDir, `playtest-local-llm-${ts}-v2.json`);
  fs.writeFileSync(mdFile, md, 'utf-8');
  fs.writeFileSync(jsonFile, json, 'utf-8');
  console.log(`✓ Markdown 日志: ${mdFile}`);
  console.log(`✓ JSON 日志: ${jsonFile}`);

  // 打印玩家叙事条目数
  const playerCount = app.gameState.narrativeLog.filter(n => n.speaker === 'player').length;
  const gmCount = app.gameState.narrativeLog.filter(n => n.speaker === 'gm').length;
  const sysCount = app.gameState.narrativeLog.filter(n => n.speaker === 'system').length;
  console.log(`\n叙事统计: 总计 ${app.gameState.narrativeLog.length} 条 (玩家[你] ${playerCount} / GM ${gmCount} / 系统 ${sysCount})`);

  const tokenStats = aiEngine.getTokenStats();
  console.log(`AI 调用: ${tokenStats.totalCalls} 次, ${tokenStats.totalTokens} tokens`);

  app.engine.stop();
}

main().catch(e => {
  console.error('玩测失败:', e);
  process.exit(1);
});
