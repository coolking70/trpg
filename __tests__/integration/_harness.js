/**
 * 集成测试 Harness
 * 构建不依赖 DOM 的最小游戏环境，注册所有系统，可手动驱动事件
 *
 * 用法：
 *   const h = createHarness(presetData);
 *   h.triggerEvent('ch1_start');
 *   h.resolveChoice('ch1_start', 'accept_quest');
 *   expect(h.gameState.variables.quest_received).toBe(true);
 */

import { GameEngine } from '../../src/core/GameEngine.js';
import { EventSystem } from '../../src/core/EventSystem.js';
import { StateManager } from '../../src/core/StateManager.js';
import { GamePreset } from '../../src/models/GamePreset.js';
import { GameState } from '../../src/models/GameState.js';
import { CardManager } from '../../src/systems/CardManager.js';
import { DiceSystem } from '../../src/systems/DiceSystem.js';
import { MapSystem } from '../../src/systems/MapSystem.js';
import { CombatSystem } from '../../src/systems/CombatSystem.js';
import { TurnManager } from '../../src/systems/TurnManager.js';
import { AIGMEngine } from '../../src/systems/AIGMEngine.js';
import { ImportExportSystem } from '../../src/systems/ImportExportSystem.js';
import { EventTriggerEngine, TRIGGER_MOMENTS } from '../../src/systems/EventTriggerEngine.js';
import { ProgressionSystem } from '../../src/systems/ProgressionSystem.js';
import { MemorySystem } from '../../src/systems/MemorySystem.js';
import { SceneSystem } from '../../src/systems/SceneSystem.js';

export function createHarness(presetData) {
  const engine = new GameEngine();
  const eventSystem = new EventSystem();
  const stateManager = new StateManager();

  // 注册所有系统
  engine.registerSystem(eventSystem, 100);
  engine.registerSystem(new CardManager(), 80);
  engine.registerSystem(new DiceSystem(), 70);
  engine.registerSystem(new MapSystem(), 60);
  engine.registerSystem(new CombatSystem(), 50);
  engine.registerSystem(new TurnManager(), 40);
  engine.registerSystem(new EventTriggerEngine(), 35);
  engine.registerSystem(new AIGMEngine(), 30);
  engine.registerSystem(new MemorySystem(), 28);
  engine.registerSystem(new ProgressionSystem(), 25);
  engine.registerSystem(new ImportExportSystem(), 20);
  engine.registerSystem(new SceneSystem(), 33);

  // 初始化所有系统
  engine.systems.forEach(s => s.initialize(engine));

  // 加载预设
  const preset = new GamePreset(presetData);
  engine.getSystem('CardManager').loadFromPreset(preset);
  if (preset.map) engine.getSystem('MapSystem').loadMap(preset.map);
  engine.getSystem('SceneSystem').loadFromPreset(preset);

  const aiEngine = engine.getSystem('AIGMEngine');
  aiEngine.setPreset(preset);
  // Mock：默认不调真 API
  aiEngine.isConfigured = () => false;

  // 创建初始状态
  const gameState = GameState.fromPreset(preset);
  engine.getGameState = () => gameState;
  engine.getSystem('MemorySystem').initializeFromPreset(gameState, preset);

  // ============================================================
  // 简化版的 main.js 事件协调（精简到测试需要的最小集合）
  // ============================================================
  const harness = {
    engine,
    eventSystem,
    stateManager,
    gameState,
    preset,

    /** 同步触发一个事件（绕过 AI 异步，仅设 activeEvent） */
    triggerEvent(eventId) {
      const card = engine.getSystem('CardManager').getCard(eventId);
      if (!card) return false;
      if (!card.repeatable && gameState.completedEventIds.includes(eventId)) return false;

      gameState.activeEvent = card;

      // 无选项事件：立刻完成（用于自动叙事的尾声事件）
      if (!card.shop && (!card.choices || card.choices.length === 0)) {
        if (!card.repeatable && !gameState.completedEventIds.includes(card.id)) {
          gameState.completedEventIds.push(card.id);
        }
        engine.getSystem('MemorySystem').addKeyEvent(gameState, {
          summary: `${card.name}：${card.description.substring(0, 40)}`,
          tags: ['event', card.eventType].filter(Boolean),
        });
        gameState.activeEvent = null;
        // 自动扫描后续
        this.scanTriggers(TRIGGER_MOMENTS.EVENT_COMPLETE);
      }
      return true;
    },

    /** 解析事件选项 */
    resolveChoice(eventId, choiceId) {
      const card = engine.getSystem('CardManager').getCard(eventId);
      if (!card) return false;
      const choice = (card.choices || []).find(c => c.id === choiceId);
      if (!choice) return false;

      // 解算 outcome（取第一个，或按概率）
      let outcome = null;
      if (choice.outcomes && choice.outcomes.length > 0) {
        const rand = Math.random();
        let cumulative = 0;
        for (const o of choice.outcomes) {
          cumulative += o.probability || 0;
          if (rand <= cumulative) { outcome = o; break; }
        }
        if (!outcome) outcome = choice.outcomes[choice.outcomes.length - 1];
      }

      if (outcome && outcome.effects) {
        for (const e of outcome.effects) this.applyEffect(e);
      }

      if (!card.repeatable) {
        gameState.completedEventIds.push(eventId);
      }
      gameState.activeEvent = null;

      // 记忆
      engine.getSystem('MemorySystem').addKeyEvent(gameState, {
        summary: `${card.name}：选择"${choice.text}"${outcome ? ` → ${outcome.text}` : ''}`,
        tags: ['event', card.eventType].filter(Boolean),
      });

      // 扫描后续
      this.scanTriggers(TRIGGER_MOMENTS.EVENT_COMPLETE);
      return true;
    },

    /** 应用事件 outcome 的 effect */
    applyEffect(effect) {
      switch (effect.type) {
        case 'add_item': {
          const c = gameState.activeCharacters[0];
          if (c) { c.inventory = c.inventory || []; c.inventory.push(effect.itemId); }
          break;
        }
        case 'set_variable': {
          if (!gameState.variables) gameState.variables = {};
          if (effect.name) gameState.variables[effect.name] = effect.value;
          this.scanTriggers(TRIGGER_MOMENTS.VARIABLE_CHANGE);
          break;
        }
        case 'heal': {
          const value = effect.value || 0;
          if (effect.target === 'all') {
            for (const c of gameState.activeCharacters) {
              if (c.stats) c.stats.hpCurrent = Math.min(c.stats.hp, c.stats.hpCurrent + value);
            }
          } else {
            const t = gameState.activeCharacters.find(c => c.id === effect.target) || gameState.activeCharacters[0];
            if (t?.stats) t.stats.hpCurrent = Math.min(t.stats.hp, t.stats.hpCurrent + value);
          }
          break;
        }
        case 'damage': {
          const t = gameState.activeCharacters.find(c => c.id === effect.target) || gameState.activeCharacters[0];
          if (t?.stats) t.stats.hpCurrent = Math.max(0, t.stats.hpCurrent - (effect.value || 0));
          break;
        }
        case 'start_combat': {
          this.startCombat(effect.enemyIds || []);
          break;
        }
        case 'trigger_event': {
          if (effect.eventId) this.triggerEvent(effect.eventId);
          break;
        }
        case 'add_memory': {
          if (effect.value) {
            engine.getSystem('MemorySystem').addKeyEvent(gameState, { summary: effect.value, tags: ['effect'] });
          }
          break;
        }
      }
    },

    /** 移动到指定地块（含 POI 触发 + scan） */
    moveTo(x, y) {
      gameState.mapState.playerPosition = { x, y };
      const mapData = engine.getSystem('MapSystem').getMapData();
      const tileKey = mapData ? mapData.getTileKey(x, y) : null;
      this.scanTriggers(TRIGGER_MOMENTS.MOVE, { tileX: x, tileY: y, tileKey });
      // 兼容：如果该格子坐标对应某个场景节点，也走 scene travel（让 inScene 事件触发）
      const sceneSystem = engine.getSystem('SceneSystem');
      if (sceneSystem.hasScenes()) {
        const sceneAt = sceneSystem.getAllScenes().find(s => s.coords && s.coords.x === x && s.coords.y === y);
        if (sceneAt) this.travelTo(sceneAt.id);
      }
    },

    /** 场景图模式：跳转到指定场景节点（更新 currentSceneId + 扫 SCENE_ENTER） */
    travelTo(sceneId) {
      const sceneSystem = engine.getSystem('SceneSystem');
      const result = sceneSystem.performTravel(gameState, sceneId);
      if (!result) return false;
      this.scanTriggers(TRIGGER_MOMENTS.SCENE_ENTER);
      return true;
    },

    /** 扫描事件触发器 */
    scanTriggers(moment, extra = {}) {
      const ids = engine.getSystem('EventTriggerEngine').scan(gameState, { moment, ...extra });
      if (ids.length > 0) {
        this.triggerEvent(ids[0]);
      }
    },

    /** 启动战斗 + 立刻判定结果（测试用一击致死） */
    startCombat(enemyIds, autoResult = 'victory') {
      const cardManager = engine.getSystem('CardManager');
      const combatSystem = engine.getSystem('CombatSystem');
      const enemies = enemyIds.map(id => cardManager.getCard(id)).filter(Boolean).map(e => JSON.parse(JSON.stringify(e)));
      if (enemies.length === 0) return;

      combatSystem.startCombat(gameState, enemies);

      if (autoResult === 'victory') {
        gameState.activeCombat.enemies.forEach(e => e.stats.hpCurrent = 0);
      } else if (autoResult === 'defeat') {
        gameState.activeCharacters.forEach(c => c.stats.hpCurrent = 0);
      }

      const result = combatSystem.endCombat(gameState, autoResult);

      // 应用奖励
      const progression = engine.getSystem('ProgressionSystem');
      if (result.result === 'victory') {
        const alive = gameState.activeCharacters.filter(c => c.stats.hpCurrent > 0);
        const expEach = alive.length > 0 ? Math.floor((result.totalExp || 0) / alive.length) : 0;
        for (const c of alive) progression.grantExperience(c, expEach);
        if (result.loot && result.loot.length > 0) {
          const holder = alive[0] || gameState.activeCharacters[0];
          if (holder) {
            holder.inventory = holder.inventory || [];
            holder.inventory.push(...result.loot);
          }
        }
      }

      // 战斗结束扫描
      this.scanTriggers(TRIGGER_MOMENTS.COMBAT_END);
    },

    /** 模拟低 HP 状态 */
    setPartyHpRatio(ratio) {
      gameState.activeCharacters.forEach(c => {
        c.stats.hpCurrent = Math.max(0, Math.floor(c.stats.hp * ratio));
      });
    },

    /** 推进回合并扫描 */
    advanceTurns(n = 1) {
      for (let i = 0; i < n; i++) {
        gameState.turnNumber++;
        this.scanTriggers(TRIGGER_MOMENTS.TURN_END);
      }
    },
  };

  return harness;
}
