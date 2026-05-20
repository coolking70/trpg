/**
 * TRPG AI跑团 — 应用入口
 * 初始化所有系统、渲染器、UI，加载默认预设并启动游戏引擎
 */

import './styles/main.css';

// 核心引擎
import { GameEngine } from './core/GameEngine.js';
import { EventSystem } from './core/EventSystem.js';
import { StateManager } from './core/StateManager.js';

// 数据模型
import { GamePreset } from './models/GamePreset.js';
import { GameState } from './models/GameState.js';

// 游戏系统
import { CardManager } from './systems/CardManager.js';
import { DiceSystem } from './systems/DiceSystem.js';
import { MapSystem } from './systems/MapSystem.js';
import { CombatSystem } from './systems/CombatSystem.js';
import { TurnManager } from './systems/TurnManager.js';
import { AIGMEngine } from './systems/AIGMEngine.js';
import { ImportExportSystem } from './systems/ImportExportSystem.js';
import { EventTriggerEngine, TRIGGER_MOMENTS } from './systems/EventTriggerEngine.js';
import { ProgressionSystem } from './systems/ProgressionSystem.js';
import { MemorySystem } from './systems/MemorySystem.js';
import { AllyAIController } from './systems/AllyAIController.js';
import { DifficultyTracker } from './systems/DifficultyTracker.js';
import { generateRandomPreset, getThemes } from './systems/WorldGenerator.js';

// 渲染
import { RenderEngine } from './rendering/RenderEngine.js';
import { MapRenderer } from './rendering/MapRenderer.js';
import { FloatingTextLayer } from './rendering/FloatingTextLayer.js';

// UI
import { GameUI } from './ui/GameUI.js';

// 数据
import { DEFAULT_PRESET } from './data/defaultPreset.js';

/**
 * 应用主类
 * 串联所有模块，管理游戏生命周期
 */
class TRPGApp {
  constructor() {
    /** @type {GameEngine} */
    this.engine = new GameEngine();

    /** @type {EventSystem} */
    this.eventSystem = new EventSystem();

    /** @type {StateManager} */
    this.stateManager = new StateManager();

    /** @type {GameState|null} */
    this.gameState = null;

    /** @type {GamePreset|null} */
    this.preset = null;

    /** @type {MapRenderer} */
    this.mapRenderer = new MapRenderer();

    /** @type {FloatingTextLayer} */
    this.floatingText = new FloatingTextLayer();

    /** @type {GameUI|null} */
    this.ui = null;

    /** @type {boolean} 操作锁定标志（AI处理期间禁止新操作） */
    this._actionLocked = false;

    // 让引擎的getGameState返回当前gameState
    this.engine.getGameState = () => this.gameState;
  }

  /**
   * 启动应用
   */
  async init() {
    console.log('TRPG AI跑团 正在初始化...');

    // 1. 注册所有系统到引擎（按优先级）
    this._registerSystems();

    // 2. 初始化UI
    this._initUI();

    // 3. 设置Canvas
    this._setupCanvas();

    // 4. 绑定事件
    this._bindEvents();

    // 5. 加载预设（优先尝试存档，否则用默认预设）
    this._loadInitialData();

    // 6. 启动引擎
    this.engine.start();

    console.log('TRPG AI跑团 初始化完成！');
  }

  /**
   * 注册所有游戏系统
   */
  _registerSystems() {
    // 事件系统最高优先级
    this.engine.registerSystem(this.eventSystem, 100);

    // 游戏逻辑系统
    this.engine.registerSystem(new CardManager(), 80);
    this.engine.registerSystem(new DiceSystem(), 70);
    this.engine.registerSystem(new MapSystem(), 60);
    this.engine.registerSystem(new CombatSystem(), 50);
    this.engine.registerSystem(new TurnManager(), 40);
    this.engine.registerSystem(new AIGMEngine(), 30);
    this.engine.registerSystem(new ImportExportSystem(), 20);
    this.engine.registerSystem(new EventTriggerEngine(), 35);
    this.engine.registerSystem(new ProgressionSystem(), 25);
    this.engine.registerSystem(new MemorySystem(), 28);
    this.engine.registerSystem(new AllyAIController(), 22);
    this.engine.registerSystem(new DifficultyTracker(), 21);

    // 渲染引擎最低优先级（最后更新 = 最后绘制）
    this.engine.registerSystem(new RenderEngine(), 10);
  }

  /**
   * 初始化UI
   */
  _initUI() {
    const appContainer = document.getElementById('app');
    this.ui = new GameUI(appContainer, this.eventSystem, this.engine);
  }

  /**
   * 设置Canvas与地图渲染器
   */
  _setupCanvas() {
    const canvas = document.getElementById('game-canvas');
    const renderEngine = this.engine.getSystem('RenderEngine');

    renderEngine.setupCanvas(canvas);

    // 注册地图渲染回调
    renderEngine.addRenderCallback((ctx, viewport, gameState) => {
      if (this.mapRenderer.mapData && gameState) {
        this.mapRenderer.render(ctx, viewport, gameState);
      }
    }, 0);

    // 浮动文字层（伤害飘字等）— 最后绘制，叠加在所有内容之上
    renderEngine.addRenderCallback((ctx, viewport) => {
      this.floatingText.render(ctx, viewport);
    }, 100);
  }

  /**
   * 绑定系统间事件
   */
  _bindEvents() {
    const es = this.eventSystem;

    // ---- 地图点击 → 仅高亮格子可点击，走锁定流程 ----
    es.subscribe('render:click', (evt) => {
      if (!this.gameState || this._actionLocked) return;
      const { worldX, worldY } = evt.data;
      const gridPos = this.mapRenderer.worldToGrid(worldX, worldY);
      if (!gridPos) return;

      // 只响应高亮的可移动格子
      if (!this.mapRenderer.isHighlighted(gridPos.x, gridPos.y)) return;

      const pos = this.gameState.mapState.playerPosition;
      const dx = gridPos.x - pos.x;
      const dy = gridPos.y - pos.y;

      // 计算方向文本
      let dirLabel = '';
      if (dy < 0) dirLabel = '北';
      else if (dy > 0) dirLabel = '南';
      if (dx < 0) dirLabel += '西';
      else if (dx > 0) dirLabel += '东';

      // 获取目标地块名称
      const mapData = this.engine.getSystem('MapSystem').getMapData();
      const targetTile = mapData ? mapData.getTile(gridPos.x, gridPos.y) : null;
      const tileName = targetTile ? targetTile.name : '';
      const actionText = `向${dirLabel}前进 - ${tileName}`;

      // 走统一操作流程：锁定 → 显示意图 → 移动 → AI叙事 → 解锁
      this._executeMovementAction(actionText);
    });

    // ---- 事件选择（普通事件卡，带锁定） ----
    es.subscribe('event:choice', (evt) => {
      if (this._actionLocked) return;
      const { eventId, choiceId } = evt.data;
      this._lockActions();
      this._resolveEventChoice(eventId, choiceId);
    });

    // ---- 玩家自由输入（对话/行动），带锁定 ----
    es.subscribe('player:action', (evt) => {
      const { text } = evt.data;
      if (!this.gameState || this._actionLocked) return;

      // 战斗中：路由到 AI 创意行动判定（仅在玩家回合）
      if (this.gameState.activeCombat) {
        const combat = this.gameState.activeCombat;
        const currentSlot = combat.turnOrder[combat.currentActorIndex];
        if (!currentSlot || currentSlot.type !== 'character') {
          this.gameState.addNarrative('system', '等敌人行动结束后再输入。');
          es.publish('game:stateChanged', { gameState: this.gameState });
          return;
        }
        this._handleCombatCreativeAction(text);
        return;
      }

      // 锁定操作
      this._lockActions();

      // 记录玩家发言
      this.gameState.addNarrative('player', text);
      es.publish('game:stateChanged', { gameState: this.gameState });

      // 尝试解析移动指令并立即执行地图移动
      const moved = this._tryTextMove(text);

      // 发送给AI GM处理（传入是否已移动，让AI进行场景叙事）
      const aiEngine = this.engine.getSystem('AIGMEngine');
      aiEngine.processGameAction('player_action', { text, moved }, this.gameState).then((result) => {
        es.publish('game:stateChanged', { gameState: this.gameState });
        if (result.diceResults && result.diceResults.length > 0) {
          for (const dr of result.diceResults) {
            if (dr && dr.total !== undefined) {
              es.publish('dice:show', dr);
            }
          }
        }
        this._advanceTurnCounter();
        this._unlockActions();
      }).catch(() => {
        this._unlockActions();
      });
    });

    // ---- 战斗请求 ----
    es.subscribe('combat:startRequest', (evt) => {
      const { enemyIds } = evt.data;
      this._startCombat(enemyIds);
    });

    es.subscribe('combat:endRequest', (evt) => {
      const combatSystem = this.engine.getSystem('CombatSystem');
      if (this.gameState.activeCombat) {
        combatSystem.endCombat(this.gameState, evt.data.result || 'victory');
        es.publish('game:stateChanged', { gameState: this.gameState });
      }
    });

    // ---- 战斗中玩家操作（来自 CombatPanel） ----
    es.subscribe('combat:playerAction', (evt) => {
      this._handleCombatPlayerAction(evt.data);
    });

    // ---- 工具栏操作 ----
    es.subscribe('toolbar:import', () => {
      const importExport = this.engine.getSystem('ImportExportSystem');
      importExport.importPreset().then((data) => {
        if (data) {
          this.loadPreset(data);
          this.gameState.addNarrative('system', '预设导入成功！');
          es.publish('game:stateChanged', { gameState: this.gameState });
        }
      }).catch(err => {
        console.error('导入失败:', err);
        if (this.gameState) {
          this.gameState.addNarrative('system', `导入失败: ${err.message}`);
          es.publish('game:stateChanged', { gameState: this.gameState });
        }
      });
    });

    es.subscribe('toolbar:export', () => {
      if (!this.preset) return;
      const importExport = this.engine.getSystem('ImportExportSystem');
      importExport.exportPreset(this.preset);
    });

    // 工具栏保存/读档按钮 → 打开多槽位 modal
    es.subscribe('toolbar:save', () => {
      es.publish('ui:openSaveModal');
    });
    es.subscribe('toolbar:load', () => {
      es.publish('ui:openLoadModal');
    });

    // 多槽位存档 API（由 SaveLoadModal 发布）
    es.subscribe('save:requestSlots', (evt) => {
      const slots = this.stateManager.listSlots();
      if (evt.data && typeof evt.data.callback === 'function') evt.data.callback(slots);
    });
    es.subscribe('save:requestSave', (evt) => {
      this._saveToSlot(evt.data.slotId, evt.data.name);
    });
    es.subscribe('save:requestLoad', (evt) => {
      this._loadFromSlot(evt.data.slotId);
    });
    es.subscribe('save:requestDelete', (evt) => {
      this.stateManager.deleteSlot(evt.data.slotId);
    });

    es.subscribe('toolbar:rollDice', (evt) => {
      const diceSystem = this.engine.getSystem('DiceSystem');
      const formula = (evt.data && evt.data.formula) || '1d20';
      const result = diceSystem.roll(formula);
      result.reason = '自由投掷';

      if (this.gameState) {
        this.gameState.diceHistory.push(result);
        this.gameState.addNarrative('system', `掷骰 ${formula}: ${result.total}`);
        es.publish('game:stateChanged', { gameState: this.gameState });
      }

      // 直接传递单个 DiceResult 对象（DiceOverlay.show 期望单个结果）
      es.publish('dice:show', result);
    });

    // 设置变更由 AIGMEngine 自己订阅 settings:changed

    // ---- 事件触发请求（来自AI响应） ----
    es.subscribe('event:triggerRequest', (evt) => {
      this._triggerEvent(evt.data.eventId);
    });

    // ---- 变量变化 → 扫描可能因此解锁的事件 ----
    es.subscribe('game:variableChanged', () => {
      this._scanEventTriggers(TRIGGER_MOMENTS.VARIABLE_CHANGE);
    });

    // ---- 一键生成随机世界 ----
    es.subscribe('toolbar:randomWorld', () => {
      const themes = getThemes();
      const themeNames = themes.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
      const choice = prompt(`选择主题（输入数字 1-${themes.length}）：\n${themeNames}`, '1');
      if (!choice) return;
      const idx = parseInt(choice) - 1;
      if (isNaN(idx) || idx < 0 || idx >= themes.length) return;

      const themeKey = themes[idx].key;
      const baseLibrary = this.preset ? {
        characters: JSON.parse(JSON.stringify(this.preset.characters || [])),
        enemies: JSON.parse(JSON.stringify(this.preset.enemies || [])),
        items: JSON.parse(JSON.stringify(this.preset.items || [])),
      } : {};

      const newPreset = generateRandomPreset({
        width: 20, height: 15, theme: themeKey, villages: 2,
        baseLibrary,
      });

      if (!confirm(`将生成新的 ${themes[idx].name} 主题世界。当前进度会丢失，是否继续？`)) return;
      this.loadPreset(newPreset);
      this.gameState.addNarrative('system', `🎲 已生成新的 ${themes[idx].name} 主题世界！`);
      es.publish('game:stateChanged', { gameState: this.gameState });
    });

    // ---- 编辑器：把当前 preset 传给编辑器作为初始值 ----
    es.subscribe('ui:openEditor', (evt) => {
      // 由 ToolbarPanel 触发时 evt.data 没有 preset → 注入当前 preset
      if (!evt.data || !evt.data.preset) {
        const current = this.preset ? this.preset.toJSON() : null;
        // 重新发布，附带当前预设（让 GameUI 收到完整数据）
        if (current) {
          // 设置 data 然后 GameUI 已订阅了 ui:openEditor，会用 evt.data.preset
          evt.data = { preset: current };
        }
      }
    }, 200);  // 高优先级先注入数据

    // ---- 编辑器：应用 draft 为新预设（重启游戏） ----
    es.subscribe('editor:applyPreset', (evt) => {
      if (!evt.data || !evt.data.preset) return;
      this.loadPreset(evt.data.preset);
      this.gameState.addNarrative('system', `📝 已应用编辑器中的预设「${evt.data.preset.name}」，游戏已重启。`);
      es.publish('game:stateChanged', { gameState: this.gameState });
    });

    // ---- 设置变更（接收难度 + 自动存档 + 动态难度开关）----
    es.subscribe('settings:changed', (evt) => {
      const cfg = evt.data || {};
      if (cfg.difficulty) this._difficulty = cfg.difficulty;
      this._autoSaveDisabled = cfg.autoSaveEnabled === false;
      // 动态难度开关
      const tracker = this.engine.getSystem('DifficultyTracker');
      if (tracker) tracker.setEnabled(cfg.dynamicDifficulty !== false);
      // AI 队友决策模式
      const ally = this.engine.getSystem('AllyAIController');
      if (ally && cfg.allyAIMode) ally.setMode(cfg.allyAIMode);
    });

    // ---- 键盘快捷键 ----
    this._bindKeyboardShortcuts();

    // ---- 角色升级通知 ----
    es.subscribe('character:levelUp', (evt) => {
      const { characterName, fromLevel, toLevel, growthSummary } = evt.data;
      if (!this.gameState) return;
      this.gameState.addNarrative('system', `🎉 ${characterName} 从 Lv.${fromLevel} 升至 Lv.${toLevel}！`);
      // 给每一级各加一行属性增长摘要
      for (const g of growthSummary) {
        const parts = [];
        if (g.delta.hp) parts.push(`HP+${g.delta.hp}`);
        if (g.delta.mp) parts.push(`MP+${g.delta.mp}`);
        if (g.delta.attack) parts.push(`攻+${g.delta.attack}`);
        if (g.delta.defense) parts.push(`防+${g.delta.defense}`);
        if (g.delta.magicAttack) parts.push(`魔攻+${g.delta.magicAttack}`);
        if (g.delta.magicDefense) parts.push(`魔防+${g.delta.magicDefense}`);
        if (g.delta.speed) parts.push(`速+${g.delta.speed}`);
        if (g.delta.luck) parts.push(`运+${g.delta.luck}`);
        this.gameState.addNarrative('system', `Lv.${g.level} 增长: ${parts.join(' ')}`);
      }
      // 升级飘字（如果在玩家身上）
      const playerPos = this.gameState.mapState.playerPosition;
      if (playerPos && this.mapRenderer.mapData) {
        const tileSize = this.mapRenderer.mapData.tileSize;
        this.floatingText.spawn({
          worldX: playerPos.x * tileSize + tileSize / 2,
          worldY: playerPos.y * tileSize + tileSize / 4,
          text: `LV.UP!`,
          color: '#fbbf24',
          lifeMs: 2200,
          fontSize: 24,
        });
      }
    });

    // ---- 道具使用请求（来自 UI） ----
    es.subscribe('item:useRequest', (evt) => {
      const { itemId, ownerCharId, targetCharId } = evt.data;
      this._useItem(itemId, ownerCharId, targetCharId);
    });

    // ---- 装备/卸下请求 ----
    es.subscribe('item:equipRequest', (evt) => {
      const { itemId, ownerCharId } = evt.data;
      const progression = this.engine.getSystem('ProgressionSystem');
      const result = progression.equipItem(this.gameState, itemId, ownerCharId);
      if (result.success) {
        this.gameState.addNarrative('system', `${result.equippedItem ? '装备' : ''}已应用。`);
      } else {
        this.gameState.addNarrative('system', `装备失败：${result.reason}`);
      }
      es.publish('game:stateChanged', { gameState: this.gameState });
    });

    es.subscribe('item:unequipRequest', (evt) => {
      const { slot, ownerCharId } = evt.data;
      const progression = this.engine.getSystem('ProgressionSystem');
      const result = progression.unequipItem(this.gameState, slot, ownerCharId);
      if (!result.success) {
        this.gameState.addNarrative('system', `卸下失败：${result.reason}`);
      }
      es.publish('game:stateChanged', { gameState: this.gameState });
    });

    // ---- 商店购买/出售 ----
    es.subscribe('shop:buyRequest', (evt) => {
      this._handleShopBuy(evt.data.itemId);
    });

    es.subscribe('shop:sellRequest', (evt) => {
      this._handleShopSell(evt.data.itemId, evt.data.ownerCharId);
    });

    // ---- AI 主动记忆请求 ----
    es.subscribe('memory:addRequest', (evt) => {
      const memorySystem = this.engine.getSystem('MemorySystem');
      if (memorySystem && this.gameState) {
        memorySystem.addKeyEvent(this.gameState, {
          summary: evt.data.summary,
          tags: evt.data.tags || ['ai'],
        });
      }
    });

    es.subscribe('shop:close', (evt) => {
      if (!this.gameState) return;
      const eventId = evt.data && evt.data.eventId;
      const event = this.gameState.activeEvent;
      // 商店可重复访问，所以不强制标记为完成
      this.gameState.activeEvent = null;
      this.gameState.addNarrative('system', `离开了 ${event ? event.name : '商店'}。`);
      es.publish('game:stateChanged', { gameState: this.gameState });
      this._updateTerrainCard();
    });
  }

  /** 商店购买处理：检查 stock + 调用 ProgressionSystem */
  _handleShopBuy(itemId) {
    if (!this.gameState || !this.gameState.activeEvent || !this.gameState.activeEvent.shop) return;
    const shop = this.gameState.activeEvent.shop;
    const entry = shop.inventory.find(e => e.itemId === itemId);
    if (!entry) return;
    if (entry.stock !== undefined && entry.stock <= 0) {
      this.gameState.addNarrative('system', '该商品已售罄。');
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      return;
    }

    const progression = this.engine.getSystem('ProgressionSystem');
    const result = progression.buyItem(this.gameState, itemId, entry.price);
    if (result.success) {
      if (entry.stock !== undefined) entry.stock--;
      this.gameState.addNarrative('system', `${result.buyerName} 购买了 ${result.itemName}（-${entry.price} 金币）。`);
    } else {
      this.gameState.addNarrative('system', `购买失败：${result.reason}`);
    }
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
  }

  /** 商店出售处理 */
  _handleShopSell(itemId, ownerCharId) {
    if (!this.gameState || !this.gameState.activeEvent || !this.gameState.activeEvent.shop) return;
    const shop = this.gameState.activeEvent.shop;
    const progression = this.engine.getSystem('ProgressionSystem');
    const result = progression.sellItem(this.gameState, itemId, ownerCharId, shop.sellMultiplier);
    if (result.success) {
      this.gameState.addNarrative('system', `${result.itemName} 已售出（+${result.price} 金币）。`);
    } else {
      this.gameState.addNarrative('system', `出售失败：${result.reason}`);
    }
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
  }

  /**
   * 使用道具的统一入口
   */
  _useItem(itemId, ownerCharId, targetCharId) {
    if (!this.gameState) return;
    const progression = this.engine.getSystem('ProgressionSystem');
    const result = progression.useItem(this.gameState, itemId, ownerCharId, targetCharId);
    if (!result.success) {
      this.gameState.addNarrative('system', `无法使用：${result.reason}`);
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      return;
    }
    const eff = result.effect;
    const parts = [`${eff.targetName} 使用 ${eff.itemName}`];
    if (eff.hpRestored) parts.push(`恢复 ${eff.hpRestored} HP`);
    if (eff.mpRestored) parts.push(`恢复 ${eff.mpRestored} MP`);
    if (eff.buffApplied) parts.push(`获得增益 ${eff.buffApplied}`);
    this.gameState.addNarrative('system', parts.join('，') + '。');

    // 飘字
    const target = this.gameState.activeCharacters.find(c => c.name === eff.targetName);
    if (target) {
      if (eff.hpRestored) this._spawnCombatFloatingText(target.id, eff.hpRestored);
      else if (eff.mpRestored) {
        const tileSize = this.mapRenderer.mapData ? this.mapRenderer.mapData.tileSize : 64;
        const pos = this.gameState.mapState.playerPosition;
        this.floatingText.spawn({
          worldX: pos.x * tileSize + tileSize / 2,
          worldY: pos.y * tileSize + tileSize * 0.3,
          text: `+${eff.mpRestored} MP`,
          color: '#3b82f6', lifeMs: 1500, fontSize: 18,
        });
      }
    }

    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
  }

  /**
   * 加载初始数据（存档或默认预设）
   */
  _loadInitialData() {
    // 尝试读取存档
    const savedState = this.stateManager.loadFromLocal('trpg_save');
    if (savedState) {
      this.gameState = GameState.fromJSON(savedState);
      // 需要重新加载预设来恢复卡牌等数据
      const savedPresetRaw = localStorage.getItem('trpg_current_preset');
      if (savedPresetRaw) {
        try {
          const presetData = JSON.parse(savedPresetRaw);
          this._applyPreset(presetData);
          this.gameState.addNarrative('system', '已从存档恢复游戏。');
        } catch (e) {
          console.warn('无法恢复预设，使用默认预设:', e);
          this.loadPreset(DEFAULT_PRESET);
        }
      } else {
        this.loadPreset(DEFAULT_PRESET);
      }
    } else {
      // 没有存档，加载默认预设
      this.loadPreset(DEFAULT_PRESET);
    }

    // 加载AI设置（如有）+ 游戏设置
    const savedConfig = localStorage.getItem('trpg_ai_config');
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig);
        const aiEngine = this.engine.getSystem('AIGMEngine');
        aiEngine.setAPIConfig(config);
        // 应用游戏设置
        if (config.difficulty) this._difficulty = config.difficulty;
        if (config.autoSaveEnabled === false) this._autoSaveDisabled = true;
        if (config.dynamicDifficulty === false) {
          const tracker = this.engine.getSystem('DifficultyTracker');
          if (tracker) tracker.setEnabled(false);
        }
        if (config.allyAIMode) {
          const ally = this.engine.getSystem('AllyAIController');
          if (ally) ally.setMode(config.allyAIMode);
        }
      } catch (e) {
        // 忽略
      }
    }

    // 初始状态广播
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });

    // 初始化地形卡和地图高亮
    this._updateTerrainCard();
    this._updateMapHighlights();
  }

  /**
   * 加载预设
   * @param {object} presetData - 原始预设数据
   */
  loadPreset(presetData) {
    this._applyPreset(presetData);

    // 从预设创建新的游戏状态
    this.gameState = GameState.fromPreset(this.preset);

    // 初始化 AI 长期记忆（从预设 lore 导入 World Facts）
    const memorySystem = this.engine.getSystem('MemorySystem');
    if (memorySystem) memorySystem.initializeFromPreset(this.gameState, this.preset);

    // 初始叙事
    const lore = this.preset.lore || {};
    const greeting = lore.background
      ? `欢迎来到${lore.worldName || '未知世界'}。${lore.background}`
      : '冒险开始了...';
    this.gameState.addNarrative('gm', greeting);

    // 广播
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });

    // 居中地图
    this._centerMapOnPlayer();

    // 初始化地形卡和地图高亮
    this._updateTerrainCard();
    this._updateMapHighlights();

    // 加载完成后扫描一次（让开场事件 / 起点 POI 事件能触发）
    setTimeout(() => {
      if (!this.gameState) return;
      const pos = this.gameState.mapState.playerPosition;
      this._scanEventTriggers(TRIGGER_MOMENTS.MOVE, { tileX: pos.x, tileY: pos.y });
    }, 300);
  }

  /**
   * 应用预设到各系统（不重置gameState）
   */
  _applyPreset(presetData) {
    this.preset = new GamePreset(presetData);

    // 保存当前预设到localStorage以便存档恢复
    try {
      localStorage.setItem('trpg_current_preset', JSON.stringify(presetData));
    } catch (e) {
      console.warn('预设数据过大，无法保存到localStorage');
    }

    // 卡牌管理器加载
    const cardManager = this.engine.getSystem('CardManager');
    cardManager.loadFromPreset(this.preset);

    // 地图系统加载
    const mapSystem = this.engine.getSystem('MapSystem');
    if (this.preset.map) {
      mapSystem.loadMap(this.preset.map);
      this.mapRenderer.setMapData(mapSystem.getMapData());
    }

    // AI GM引擎加载
    const aiEngine = this.engine.getSystem('AIGMEngine');
    aiEngine.setPreset(this.preset);
  }

  /**
   * 将地图视口居中到玩家位置
   */
  _centerMapOnPlayer() {
    if (!this.gameState || !this.mapRenderer.mapData) return;

    const pos = this.gameState.mapState.playerPosition;
    const tileSize = this.mapRenderer.mapData.tileSize;
    const worldX = pos.x * tileSize + tileSize / 2;
    const worldY = pos.y * tileSize + tileSize / 2;

    const renderEngine = this.engine.getSystem('RenderEngine');
    renderEngine.centerOn(worldX, worldY);
  }

  /**
   * 触发事件卡
   * @param {string} eventId
   */
  _triggerEvent(eventId) {
    if (!this.gameState) return;

    const cardManager = this.engine.getSystem('CardManager');
    const eventCard = cardManager.getCard(eventId);
    if (!eventCard) return;

    // 检查是否已完成且不可重复
    if (!eventCard.repeatable && this.gameState.completedEventIds.includes(eventId)) {
      return;
    }

    // 锁定操作
    this._lockActions();

    // 设置当前事件（覆盖地形卡）
    this.gameState.activeEvent = eventCard;
    this.eventSystem.publish('event:trigger', { event: eventCard });

    // 请求AI叙事
    const aiEngine = this.engine.getSystem('AIGMEngine');
    aiEngine.processGameAction('narrate_event', { event: eventCard }, this.gameState).then((result) => {
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      if (result.diceResults && result.diceResults.length > 0) {
        for (const dr of result.diceResults) {
          if (dr && dr.total !== undefined) this.eventSystem.publish('dice:show', dr);
        }
      }
      // 商店事件：保持 activeEvent 显示，等待 shop:close 关闭
      if (eventCard.shop) {
        this._actionLocked = false;
        this.ui.narrativePanel.setDisabled(true);
        this.ui.narrativePanel.hideLoading();
      } else if (!eventCard.choices || eventCard.choices.length === 0) {
        this.gameState.activeEvent = null;
        // 无选项事件：直接标记为完成（否则会重复触发）
        if (!eventCard.repeatable && !this.gameState.completedEventIds.includes(eventCard.id)) {
          this.gameState.completedEventIds.push(eventCard.id);
        }
        // 完成后扫描可能的链式触发
        this._scanEventTriggers(TRIGGER_MOMENTS.EVENT_COMPLETE);
        this._unlockActions();
      } else {
        // 有选项，解锁让玩家选择（事件卡的选项仍然可点击）
        this._actionLocked = false;
        this.ui.narrativePanel.setDisabled(false);
        this.ui.narrativePanel.hideLoading();
        // 不恢复地形卡，保持事件卡显示
      }
    }).catch(() => {
      this._unlockActions();
    });
  }

  /**
   * 解析事件选择
   * @param {string} eventId
   * @param {string} choiceId
   */
  _resolveEventChoice(eventId, choiceId) {
    if (!this.gameState) return;

    const cardManager = this.engine.getSystem('CardManager');
    const eventCard = cardManager.getCard(eventId);
    if (!eventCard) return;

    // 查找选择项
    const choice = (eventCard.choices || []).find(c => c.id === choiceId);
    if (!choice) return;

    // 按概率解算结果
    let outcome = null;
    if (choice.outcomes && choice.outcomes.length > 0) {
      const rand = Math.random();
      let cumulative = 0;
      for (const o of choice.outcomes) {
        cumulative += o.probability || 0;
        if (rand <= cumulative) {
          outcome = o;
          break;
        }
      }
      if (!outcome) {
        outcome = choice.outcomes[choice.outcomes.length - 1];
      }
    }

    // 应用效果
    if (outcome && outcome.effects) {
      for (const effect of outcome.effects) {
        this._applyEventEffect(effect);
      }
    }

    // 标记事件完成
    if (!eventCard.repeatable) {
      this.gameState.completedEventIds.push(eventId);
    }

    // 清除当前事件
    this.gameState.activeEvent = null;

    // 自动记忆：把"完成事件 + 选择 + 结果"作为关键事件归档
    const memorySystem = this.engine.getSystem('MemorySystem');
    if (memorySystem) {
      const summary = `${eventCard.name}：选择"${choice.text}"${outcome ? ` → ${outcome.text}` : ''}`;
      memorySystem.addKeyEvent(this.gameState, { summary, tags: ['event', eventCard.eventType].filter(Boolean) });
    }

    // 请求AI叙事（锁定已在event:choice处理器中完成）
    const aiEngine = this.engine.getSystem('AIGMEngine');
    aiEngine.processGameAction('narrate_event', {
      event: eventCard,
      choiceText: choice.text,
      outcomeText: outcome ? outcome.text : '',
    }, this.gameState).then((result) => {
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      if (result.diceResults && result.diceResults.length > 0) {
        for (const dr of result.diceResults) {
          if (dr && dr.total !== undefined) this.eventSystem.publish('dice:show', dr);
        }
      }
      // 事件完成后扫描可能的链式触发（变量已被 set_variable 改写过）
      this._scanEventTriggers(TRIGGER_MOMENTS.EVENT_COMPLETE);
      this._advanceTurnCounter();
      this._autoSave();
      this._unlockActions();
    }).catch(() => {
      this._unlockActions();
    });
  }

  /**
   * 应用事件效果
   * @param {object} effect
   */
  _applyEventEffect(effect) {
    if (!this.gameState) return;

    switch (effect.type) {
      case 'add_item': {
        const char = this.gameState.activeCharacters[0];
        if (char) {
          if (!char.inventory) char.inventory = [];
          char.inventory.push(effect.itemId);
        }
        break;
      }
      case 'remove_item': {
        for (const char of this.gameState.activeCharacters) {
          const idx = (char.inventory || []).indexOf(effect.itemId);
          if (idx !== -1) {
            char.inventory.splice(idx, 1);
            break;
          }
        }
        break;
      }
      case 'damage': {
        const value = effect.value || 0;
        if (effect.target === 'all') {
          for (const c of this.gameState.activeCharacters) {
            if (c.stats) c.stats.hpCurrent = Math.max(0, c.stats.hpCurrent - value);
          }
        } else {
          const target = this.gameState.activeCharacters.find(c => c.id === effect.target) ||
                         this.gameState.activeCharacters[0];
          if (target && target.stats) {
            target.stats.hpCurrent = Math.max(0, target.stats.hpCurrent - value);
          }
        }
        break;
      }
      case 'heal': {
        const value = effect.value || 0;
        if (effect.target === 'all') {
          for (const c of this.gameState.activeCharacters) {
            if (c.stats) c.stats.hpCurrent = Math.min(c.stats.hp, c.stats.hpCurrent + value);
          }
        } else {
          const target = this.gameState.activeCharacters.find(c => c.id === effect.target) ||
                         this.gameState.activeCharacters[0];
          if (target && target.stats) {
            target.stats.hpCurrent = Math.min(target.stats.hp, target.stats.hpCurrent + value);
          }
        }
        break;
      }
      case 'start_combat': {
        this._startCombat(effect.enemyIds || []);
        break;
      }
      case 'set_variable': {
        // 用于事件分支写状态机
        if (!this.gameState.variables) this.gameState.variables = {};
        if (effect.name) {
          this.gameState.variables[effect.name] = effect.value;
          this.eventSystem.publish('game:variableChanged', { name: effect.name, value: effect.value });
        }
        break;
      }
      case 'trigger_event': {
        // 链式触发后续事件
        if (effect.eventId) {
          // 用 setTimeout 让当前事件流程先完成
          setTimeout(() => this._triggerEvent(effect.eventId), 0);
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * 开始战斗
   * combat:start 由 CombatSystem.startCombat 内部发布，main 不再重复
   * @param {string[]} enemyIds
   */
  _startCombat(enemyIds) {
    if (!this.gameState) return;

    const cardManager = this.engine.getSystem('CardManager');
    const combatSystem = this.engine.getSystem('CombatSystem');

    const enemies = enemyIds
      .map(id => cardManager.getCard(id))
      .filter(Boolean)
      .map(e => JSON.parse(JSON.stringify(e)));

    if (enemies.length === 0) return;

    // 应用难度修正
    this._applyDifficultyToEnemies(enemies);

    // 给敌人分配玩家周围的格子（避免堆叠）
    this._assignEnemyPositions(enemies);

    this._lockActions();
    combatSystem.startCombat(this.gameState, enemies);
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });

    // 开战叙事 → 完成后驱动首个行动者
    const aiEngine = this.engine.getSystem('AIGMEngine');
    aiEngine.processGameAction('narrate_combat', {
      roundResults: [],
      enemies,
    }, this.gameState).then(() => {
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      this._driveCurrentActor();
    }).catch(() => {
      this._driveCurrentActor();
    });
  }

  // ==================== 战斗循环 ====================

  /**
   * 处理战斗中玩家文本输入的创意行动（Option B 灵魂）
   * AI 评估难度返回 creativeOutcome，骰子判定成败后应用对应分支
   * @param {string} text - 玩家输入文本
   */
  async _handleCombatCreativeAction(text) {
    if (!this.gameState || !this.gameState.activeCombat) return;
    if (this._actionLocked) return;

    this._lockActions();
    this.gameState.addNarrative('player', text);
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });

    const aiEngine = this.engine.getSystem('AIGMEngine');

    let result;
    try {
      result = await aiEngine.processGameAction('combat_creative', { text }, this.gameState);
    } catch (e) {
      this._unlockActions();
      return;
    }

    const outcome = result.creativeOutcome;

    if (!outcome) {
      // AI 判定为常规行动或拒绝处理，不消耗回合
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      this._unlockActions();
      return;
    }

    // 投骰判定
    const diceSystem = this.engine.getSystem('DiceSystem');
    const diceResult = diceSystem.rollCheck(outcome.formula || 'd20', outcome.dc);
    diceResult.reason = `创意行动判定 (DC ${outcome.dc})`;
    this.gameState.diceHistory.push(diceResult);
    this.eventSystem.publish('dice:show', diceResult);

    // 让骰子动画展示一会
    await new Promise(r => setTimeout(r, 1200));

    // 应用对应分支
    const branch = diceResult.success ? outcome.onSuccess : outcome.onFail;
    if (branch && branch.narrative) {
      this.gameState.addNarrative('gm', branch.narrative);
    }
    if (branch && branch.actions && branch.actions.length > 0) {
      const cardManager = this.engine.getSystem('CardManager');
      aiEngine.responseParser.applyActions(branch.actions, this.gameState, this.eventSystem, cardManager);

      // 给伤害/治疗 action 生成飘字
      for (const a of branch.actions) {
        if (a.type === 'damage' && a.target) {
          this._spawnCombatFloatingText(a.target, -(parseInt(a.value) || 0));
        } else if (a.type === 'heal' && a.target) {
          this._spawnCombatFloatingText(a.target, parseInt(a.value) || 0);
        }
      }
    }

    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });

    // 创意行动消耗一个回合
    setTimeout(() => this._advanceTurn(), 500);
  }

  /**
   * 处理玩家在 CombatPanel 上的操作
   * @param {{actionType, actorId, targetId?, abilityId?}} payload
   */
  _handleCombatPlayerAction(payload) {
    if (!this.gameState || !this.gameState.activeCombat) return;
    if (this._actionLocked) return;

    const combatSystem = this.engine.getSystem('CombatSystem');
    const { actionType, actorId, targetId, abilityId } = payload;

    this._lockActions();

    let result = null;
    if (actionType === 'attack') {
      result = combatSystem.performAttack(this.gameState, actorId, targetId);
      this._showAttackDice(result, actorId);
    } else if (actionType === 'ability') {
      result = combatSystem.useAbility(this.gameState, actorId, abilityId, targetId);
    } else if (actionType === 'flee') {
      this._attemptFlee(actorId);
      return;
    }

    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });

    // 玩家行动后推进回合（500ms 让玩家看清结果）
    setTimeout(() => this._advanceTurn(), 500);
  }

  /**
   * 推进到下一个行动者
   * 处理战斗结束 / 新回合叙事 / 敌人自动行动
   */
  _advanceTurn() {
    if (!this.gameState || !this.gameState.activeCombat) {
      this._unlockActions();
      return;
    }

    const combatSystem = this.engine.getSystem('CombatSystem');
    const turnResult = combatSystem.nextTurn(this.gameState);

    if (turnResult.combatEnd) {
      this._finalizeCombat(turnResult);
      return;
    }

    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });

    if (turnResult.newRound) {
      // 战斗新一轮 = 推进游戏回合计数
      this._advanceTurnCounter();
      // 新一轮：AI 叙事一段后继续
      this._narrateCombatRound().finally(() => this._driveCurrentActor());
    } else {
      this._driveCurrentActor();
    }
  }

  /** 根据当前行动者类型，驱动敌人自动行动 / AI 队友 / 玩家手动 */
  _driveCurrentActor() {
    const combat = this.gameState && this.gameState.activeCombat;
    if (!combat) {
      this._unlockActions();
      return;
    }

    const actor = combat.turnOrder[combat.currentActorIndex];
    if (!actor) {
      this._unlockActions();
      return;
    }

    if (actor.type === 'enemy') {
      this._executeEnemyTurn(actor.id);
    } else if (this._isPlayerControlled(actor.id)) {
      // 玩家主角：解锁等待输入
      this._unlockActions();
    } else {
      // AI 队友：自动决策行动
      this._executeAllyAITurn(actor.id);
    }
  }

  /** 当前角色是否由玩家手动控制（默认仅 activeCharacters[0] 为主角） */
  _isPlayerControlled(charId) {
    if (!this.gameState || !this.gameState.activeCharacters.length) return false;
    if (this._playerControlMode === 'all') return true;  // 手动控制全队（设置可切）
    return this.gameState.activeCharacters[0].id === charId;
  }

  /** 由 AllyAIController 决策并执行一次行动 */
  async _executeAllyAITurn(actorId) {
    const combatSystem = this.engine.getSystem('CombatSystem');
    const allyAI = this.engine.getSystem('AllyAIController');
    const actor = this.gameState.activeCharacters.find(c => c.id === actorId);
    if (!actor || actor.stats.hpCurrent <= 0) {
      this._advanceTurn();
      return;
    }

    // 异步决策（支持 LLM 模式 + 启发式 fallback）
    const decision = await allyAI.decideActionAsync(actor, this.gameState);

    // 短暂延迟让玩家看到这是 AI 在思考
    setTimeout(() => {
      if (!this.gameState || !this.gameState.activeCombat) return;

      let result = null;
      if (decision.actionType === 'attack' && decision.targetId) {
        result = combatSystem.performAttack(this.gameState, actor.id, decision.targetId);
        this._showAttackDice(result, actor.id);
      } else if (decision.actionType === 'ability' && decision.abilityId && decision.targetId) {
        result = combatSystem.useAbility(this.gameState, actor.id, decision.abilityId, decision.targetId);
        if (result && result.success) this._showAttackDice(result, actor.id);
      }

      if (decision.reason) {
        this.gameState.addNarrative('system', `${actor.name} ${decision.reason}`);
      }

      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      setTimeout(() => this._advanceTurn(), 600);
    }, 400);
  }

  /** 敌人 AI：随机选活着的角色攻击 */
  _executeEnemyTurn(enemyId) {
    const combatSystem = this.engine.getSystem('CombatSystem');
    const enemy = combatSystem.findCombatant(this.gameState, enemyId);

    if (!enemy || enemy.stats.hpCurrent <= 0) {
      this._advanceTurn();
      return;
    }

    const aliveChars = this.gameState.activeCharacters.filter(c => c.stats.hpCurrent > 0);
    if (aliveChars.length === 0) {
      this._finalizeCombat(combatSystem.endCombat(this.gameState, 'defeat'));
      return;
    }

    const target = aliveChars[Math.floor(Math.random() * aliveChars.length)];

    // 800ms 延迟让玩家看清敌人在行动
    setTimeout(() => {
      if (!this.gameState || !this.gameState.activeCombat) return;
      const result = combatSystem.performAttack(this.gameState, enemyId, target.id);
      this._showAttackDice(result, enemyId);
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      setTimeout(() => this._advanceTurn(), 600);
    }, 800);
  }

  /** 逃跑判定：50% 成功 */
  _attemptFlee(actorId) {
    const combatSystem = this.engine.getSystem('CombatSystem');
    const success = Math.random() < 0.5;

    if (success) {
      this.gameState.addNarrative('system', '逃跑成功！');
      this._finalizeCombat(combatSystem.endCombat(this.gameState, 'flee'));
    } else {
      this.gameState.addNarrative('system', '逃跑失败！');
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      setTimeout(() => this._advanceTurn(), 500);
    }
  }

  /** 战斗结束：应用经验/掉落 + 触发结算 modal + AI 总结叙事 */
  _finalizeCombat(endResult) {
    this._applyCombatRewards(endResult);

    // 记录战斗表现到动态难度跟踪器
    const tracker = this.engine.getSystem('DifficultyTracker');
    if (tracker && this.gameState.activeCombat) {
      const combat = this.gameState.activeCombat;
      const chars = this.gameState.activeCharacters;
      const totalHp = chars.reduce((sum, c) => sum + c.stats.hp, 0);
      const currentHp = chars.reduce((sum, c) => sum + Math.max(0, c.stats.hpCurrent), 0);
      const hpRatio = totalHp > 0 ? currentHp / totalHp : 0;
      tracker.recordCombat({
        result: endResult.result,
        hpRatio,
        rounds: combat.round || 1,
      });
    }

    // combat:end 已由 CombatSystem.endCombat 内部发布，无需重复
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });

    // 记忆战斗结果（仅保留 boss/精英级别和重要结局）
    const memorySystem = this.engine.getSystem('MemorySystem');
    const combat = this.gameState.activeCombat;
    if (memorySystem && combat && combat.enemies) {
      const defeated = combat.enemies.filter(e => e.stats.hpCurrent <= 0);
      const notable = defeated.filter(e => ['boss', 'hard'].includes(e.difficulty));
      if (notable.length > 0 && endResult.result === 'victory') {
        memorySystem.addKeyEvent(this.gameState, {
          summary: `击败了 ${notable.map(e => e.name).join('、')}`,
          tags: ['combat', 'victory'],
        });
      } else if (endResult.result === 'defeat') {
        memorySystem.addKeyEvent(this.gameState, {
          summary: `被 ${combat.enemies.map(e => e.name).join('、')} 击败`,
          tags: ['combat', 'defeat'],
        });
      }
    }

    // 发布结算事件给 CombatResultModal
    const cardManager = this.engine.getSystem('CardManager');
    const aliveCount = this.gameState.activeCharacters.filter(c => c.stats.hpCurrent > 0).length;
    const expEach = endResult.result === 'victory' && aliveCount > 0
      ? Math.floor((endResult.totalExp || 0) / aliveCount)
      : 0;
    const lootItems = (endResult.loot || []).map(id => {
      const card = cardManager.getCard(id);
      return { id, name: card ? card.name : id, image: card ? card.image : '' };
    });
    this.eventSystem.publish('combat:resultShown', {
      result: endResult.result,
      totalExp: endResult.totalExp || 0,
      expEach,
      loot: lootItems,
    });

    // AI 总结叙事
    const aiEngine = this.engine.getSystem('AIGMEngine');
    aiEngine.processGameAction('narrate_combat', {
      roundResults: [{ narrative: `战斗${endResult.result === 'victory' ? '胜利' : endResult.result === 'flee' ? '逃脱' : '失败'}` }],
      enemies: [],
    }, this.gameState).finally(() => {
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      // 战斗结束扫描可能因击败 boss 或获得物品触发的后续事件
      this._scanEventTriggers(TRIGGER_MOMENTS.COMBAT_END);
      this._advanceTurnCounter();
      this._autoSave();
      this._unlockActions();
    });
  }

  /** 应用战斗奖励：经验（含升级检测）、掉落 */
  _applyCombatRewards(endResult) {
    if (endResult.result !== 'victory') return;

    const aliveChars = this.gameState.activeCharacters.filter(c => c.stats.hpCurrent > 0);
    if (aliveChars.length === 0) return;

    const expEach = Math.floor((endResult.totalExp || 0) / aliveChars.length);
    if (expEach > 0) {
      const progression = this.engine.getSystem('ProgressionSystem');
      for (const char of aliveChars) {
        progression.grantExperience(char, expEach);
      }
      this.gameState.addNarrative('system', `每位幸存者获得 ${expEach} 经验。`);
    }

    if (endResult.loot && endResult.loot.length > 0) {
      const lootHolder = aliveChars[0];
      if (!lootHolder.inventory) lootHolder.inventory = [];
      const cardManager = this.engine.getSystem('CardManager');
      const lootNames = endResult.loot.map(id => {
        const card = cardManager.getCard(id);
        lootHolder.inventory.push(id);
        return card ? card.name : id;
      });
      this.gameState.addNarrative('system', `获得战利品:${lootNames.join('、')}。`);
    }
  }

  /** AI 叙述一轮战斗 */
  _narrateCombatRound() {
    const combat = this.gameState && this.gameState.activeCombat;
    if (!combat) return Promise.resolve();

    const aiEngine = this.engine.getSystem('AIGMEngine');
    const recentLog = (combat.log || []).slice(-Math.min(3, combat.log.length));
    return aiEngine.processGameAction('narrate_combat', {
      roundResults: recentLog,
      enemies: combat.enemies,
    }, this.gameState).then(() => {
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
    }).catch(() => {});
  }

  /** 战斗动作后的视觉反馈：飘字 + (仅普通攻击) 骰子动画 */
  _showAttackDice(result, attackerId) {
    if (!result || !result.success) return;

    // 飘字（独立于骰子，普通攻击和技能都会用到）
    const damage = result.finalDamage !== undefined ? result.finalDamage : result.damage;
    const healing = result.healing;
    if (result.targetId && (damage > 0 || healing > 0)) {
      this._spawnCombatFloatingText(result.targetId, damage > 0 ? -damage : healing);
    }

    // 普通攻击才显示 d20 骰子动画
    if (result.attackRoll !== undefined) {
      const attackerName = result.attackerName || result.casterName || '';
      this.eventSystem.publish('dice:show', {
        formula: 'd20',
        sides: 20,
        count: 1,
        rolls: [result.attackRoll],
        modifier: 0,
        subtotal: result.attackRoll,
        total: result.attackRoll,
        reason: `${attackerName} 攻击`,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 给战斗中的实体生成飘字
   * @param {string} entityId
   * @param {number} value - 正数=治疗(绿), 负数=伤害(红)
   */
  _spawnCombatFloatingText(entityId, value) {
    if (!value || !this.mapRenderer.mapData) return;
    const tileSize = this.mapRenderer.mapData.tileSize;

    // 查找实体位置
    let pos = null;
    const combat = this.gameState && this.gameState.activeCombat;
    if (combat) {
      const enemy = combat.enemies.find(e => e.id === entityId);
      if (enemy) pos = enemy.position;
    }
    if (!pos) {
      const char = this.gameState.activeCharacters.find(c => c.id === entityId);
      if (char) pos = this.gameState.mapState.playerPosition;
    }
    if (!pos) return;

    const worldX = pos.x * tileSize + tileSize / 2;
    const worldY = pos.y * tileSize + tileSize * 0.3;

    this.floatingText.spawn({
      worldX,
      worldY,
      text: value > 0 ? `+${value}` : `${value}`,
      color: value > 0 ? '#22c55e' : '#ef4444',
      lifeMs: 1500,
      fontSize: 22,
    });
  }

  /**
   * 根据静态难度 + 动态难度跟踪器修正敌人属性
   */
  _applyDifficultyToEnemies(enemies) {
    // 静态难度
    const difficulty = this._difficulty || 'normal';
    let hpMul = 1, atkDelta = 0;
    if (difficulty === 'easy') { hpMul = 0.7; atkDelta = -2; }
    else if (difficulty === 'hard') { hpMul = 1.3; atkDelta = 2; }

    // 动态难度叠加
    const dynamicTracker = this.engine.getSystem('DifficultyTracker');
    if (dynamicTracker) {
      const dyn = dynamicTracker.getDynamicModifier();
      hpMul *= dyn.hpMul;
      atkDelta += dyn.atkDelta;
      // 触发沉浸式叙事提示（仅在显著变化时）
      if (dyn.narrativeHint && this.gameState) {
        this.gameState.addNarrative('system', dyn.narrativeHint);
      }
    }

    if (hpMul === 1 && atkDelta === 0) return;

    for (const e of enemies) {
      if (!e.stats) continue;
      e.stats.hp = Math.max(1, Math.floor(e.stats.hp * hpMul));
      e.stats.hpCurrent = e.stats.hp;
      e.stats.attack = Math.max(1, e.stats.attack + atkDelta);
    }
  }

  /**
   * 给敌人分配玩家周围的格子位置
   * 用 BFS 找最近的可行走格子
   */
  _assignEnemyPositions(enemies) {
    if (!this.gameState || !this.mapRenderer.mapData) return;
    const mapSystem = this.engine.getSystem('MapSystem');
    const playerPos = this.gameState.mapState.playerPosition;
    const mapData = this.mapRenderer.mapData;

    // BFS 收集足够多的候选格子
    const candidates = [];
    const visited = new Set([`${playerPos.x},${playerPos.y}`]);
    const queue = [{ x: playerPos.x, y: playerPos.y, d: 0 }];

    while (queue.length > 0 && candidates.length < enemies.length + 2) {
      const node = queue.shift();
      if (node.d > 0 && node.d <= 3) candidates.push({ x: node.x, y: node.y });
      if (node.d >= 3) continue;
      for (const n of mapSystem.getWalkableNeighbors(node.x, node.y)) {
        const key = `${n.x},${n.y}`;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ x: n.x, y: n.y, d: node.d + 1 });
      }
    }

    // 按曼哈顿距离排序，最近的先分配
    candidates.sort((a, b) => {
      const da = Math.abs(a.x - playerPos.x) + Math.abs(a.y - playerPos.y);
      const db = Math.abs(b.x - playerPos.x) + Math.abs(b.y - playerPos.y);
      return da - db;
    });

    enemies.forEach((enemy, i) => {
      const slot = candidates[i] || candidates[candidates.length - 1] || playerPos;
      enemy.position = { x: slot.x, y: slot.y };
    });
  }

  /**
   * 尝试将文本指令解析为地图移动
   * 支持：北/南/东/西/前/后/左/右/上/下 及英文方向
   * @param {string} text - 玩家输入的文本
   * @returns {boolean} 是否成功移动
   */
  _tryTextMove(text) {
    if (!this.gameState || !this.mapRenderer.mapData) return false;

    // 方向 → 偏移量映射（dx, dy）
    const directionMap = [
      { patterns: /北|向北|往北|north|up|↑|前进/, dx: 0, dy: -1 },
      { patterns: /南|向南|往南|south|down|↓|后退/, dx: 0, dy: 1 },
      { patterns: /西|向西|往西|west|left|←|向左/, dx: -1, dy: 0 },
      { patterns: /东|向东|往东|east|right|→|向右/, dx: 1, dy: 0 },
      { patterns: /西北|northwest/, dx: -1, dy: -1 },
      { patterns: /东北|northeast/, dx: 1, dy: -1 },
      { patterns: /西南|southwest/, dx: -1, dy: 1 },
      { patterns: /东南|southeast/, dx: 1, dy: 1 },
    ];

    // 尝试解析移动步数（支持"向北走2步"）
    const stepMatch = text.match(/(\d+)\s*步/);
    const steps = stepMatch ? Math.min(parseInt(stepMatch[1]), 5) : 1; // 最多5步

    for (const dir of directionMap) {
      if (dir.patterns.test(text)) {
        const mapSystem = this.engine.getSystem('MapSystem');
        const pos = this.gameState.mapState.playerPosition;
        let moved = false;

        // 逐步移动（movePlayer 签名: gameState, toX, toY; 返回 { success, poi }）
        for (let i = 0; i < steps; i++) {
          const curPos = this.gameState.mapState.playerPosition;
          const toX = curPos.x + dir.dx;
          const toY = curPos.y + dir.dy;
          const result = mapSystem.movePlayer(this.gameState, toX, toY);
          if (result.success) {
            moved = true;
            // 检查兴趣点事件
            if (result.poi && result.poi.linkedEventId) {
              this._triggerEvent(result.poi.linkedEventId);
            }
          } else {
            break; // 遇到障碍停止
          }
        }

        if (moved) {
          this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
          // 居中视口到玩家位置
          this._centerMapOnPlayer();
          // 扫描移动触发的事件（含复合条件）
          const newPos = this.gameState.mapState.playerPosition;
          this._scanEventTriggers(TRIGGER_MOMENTS.MOVE, {
            tileX: newPos.x,
            tileY: newPos.y,
          });
        }
        return moved;
      }
    }
    return false; // 未识别为移动指令
  }

  // ==================== 操作锁定系统 ====================

  /** 锁定所有操作（AI 处理或敌人回合期间） */
  _lockActions() {
    this._actionLocked = true;
    this.ui.narrativePanel.setDisabled(true);
    this.ui.narrativePanel.showLoading();

    if (this.gameState && this.gameState.activeCombat) {
      this.ui.combatPanel.setDisabled(true);
    } else {
      this.ui.rightPanel.setDisabled(true);
      this.mapRenderer.clearHighlights();
    }
  }

  /** 解锁所有操作（AI响应到达或玩家回合到来） */
  _unlockActions() {
    this._actionLocked = false;
    this.ui.narrativePanel.hideLoading();

    if (this.gameState && this.gameState.activeCombat) {
      // 战斗中：仅玩家回合启用输入与按钮（Slice 1.B 允许文本创意行动）
      const combat = this.gameState.activeCombat;
      const current = combat.turnOrder[combat.currentActorIndex];
      const isPlayerTurn = current && current.type === 'character';
      this.ui.narrativePanel.setDisabled(!isPlayerTurn);
      this.ui.combatPanel.setDisabled(!isPlayerTurn);
    } else {
      this.ui.narrativePanel.setDisabled(false);
      if (!this.gameState || !this.gameState.activeEvent) {
        this._updateTerrainCard();
      }
      this._updateMapHighlights();
    }
  }

  // ==================== 地形事件卡 ====================

  /**
   * 根据玩家当前位置生成地形事件卡数据
   * @returns {object|null} 合成事件卡结构
   */
  _generateTerrainCard() {
    if (!this.gameState || !this.mapRenderer.mapData) return null;

    const mapData = this.engine.getSystem('MapSystem').getMapData();
    if (!mapData) return null;

    const pos = this.gameState.mapState.playerPosition;
    const currentTile = mapData.getTile(pos.x, pos.y);
    if (!currentTile) return null;

    // 构建方向选项（仅可行走的相邻格子）
    const directions = [
      { id: 'north', label: '北', dx: 0, dy: -1 },
      { id: 'south', label: '南', dx: 0, dy: 1 },
      { id: 'west',  label: '西', dx: -1, dy: 0 },
      { id: 'east',  label: '东', dx: 1, dy: 0 },
    ];

    const choices = [];
    const directionMap = {};

    for (const dir of directions) {
      const nx = pos.x + dir.dx;
      const ny = pos.y + dir.dy;
      if (mapData.isInBounds(nx, ny) && mapData.isWalkable(nx, ny)) {
        const neighborTile = mapData.getTile(nx, ny);
        const tileName = neighborTile ? neighborTile.name : '未知';
        choices.push({
          id: dir.id,
          text: `向${dir.label} - ${tileName}`,
        });
        directionMap[dir.id] = { dx: dir.dx, dy: dir.dy };
      }
    }

    // 构建描述文字（给GM参考）
    const descParts = [`你站在${currentTile.name}上。`];

    // 当前脚下的兴趣点
    const currentPOI = mapData.getPointOfInterest(pos.x, pos.y);
    if (currentPOI) {
      descParts.push(`这里是「${currentPOI.name}」。`);
    }

    // 周围环境概要
    const surroundings = [];
    for (const dir of directions) {
      const nx = pos.x + dir.dx;
      const ny = pos.y + dir.dy;
      if (!mapData.isInBounds(nx, ny)) {
        surroundings.push(`${dir.label}方是地图边界`);
      } else {
        const tile = mapData.getTile(nx, ny);
        const name = tile ? tile.name : '未知';
        surroundings.push(`${dir.label}方是${name}${tile && !tile.walkable ? '(不可通行)' : ''}`);
      }
    }
    descParts.push(surroundings.join('，') + '。');

    return {
      id: 'terrain_current',
      type: 'event',
      eventType: 'terrain',
      name: currentTile.name,
      description: descParts.join(''),
      image: '',
      choices,
      _directionMap: directionMap,
    };
  }

  /** 更新右面板地形事件卡 */
  _updateTerrainCard() {
    if (!this.ui) return;
    const terrainCard = this._generateTerrainCard();
    if (!terrainCard) return;

    this.ui.rightPanel.setTerrainEvent(terrainCard, (choiceId) => {
      if (this._actionLocked) return;
      // 获取方向信息
      const choice = terrainCard.choices.find(c => c.id === choiceId);
      if (!choice) return;
      // 走统一操作流程
      this._executeMovementAction(choice.text);
    });
  }

  /** 更新地图上可行走相邻格子的高亮 */
  _updateMapHighlights() {
    if (!this.gameState || !this.mapRenderer.mapData) {
      this.mapRenderer.clearHighlights();
      return;
    }

    const mapSystem = this.engine.getSystem('MapSystem');
    const pos = this.gameState.mapState.playerPosition;
    const walkableNeighbors = mapSystem.getWalkableNeighbors(pos.x, pos.y);

    // 仅高亮已揭示的格子
    const revealed = new Set(this.gameState.mapState.revealedTiles);
    const highlightTiles = walkableNeighbors.filter(t => revealed.has(`${t.x},${t.y}`));

    this.mapRenderer.setHighlights(highlightTiles);
  }

  // ==================== 统一操作流程 ====================

  /**
   * 执行移动操作的统一流程
   * 锁定 → 显示意图 → 移动 → AI叙事 → 解锁
   * @param {string} actionText - 操作文本（如 "向北 - 草地"）
   */
  _executeMovementAction(actionText) {
    if (this._actionLocked || !this.gameState) return;

    // 锁定
    this._lockActions();

    // 在叙事面板显示玩家意图
    this.gameState.addNarrative('player', actionText);
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });

    // 执行地图移动
    const moved = this._tryTextMove(actionText);

    // AI叙事
    const aiEngine = this.engine.getSystem('AIGMEngine');
    aiEngine.processGameAction('player_action', { text: actionText, moved }, this.gameState).then((result) => {
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      if (result.diceResults && result.diceResults.length > 0) {
        for (const dr of result.diceResults) {
          if (dr && dr.total !== undefined) {
            this.eventSystem.publish('dice:show', dr);
          }
        }
      }
      this._advanceTurnCounter();
      this._unlockActions();
    }).catch(() => {
      this._unlockActions();
    });
  }

  // ==================== 键盘快捷键 ====================

  _bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // 输入框聚焦时不响应（避免打字时误触发）
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      // 修饰键组合：Ctrl+S 快速存档到 auto 槽
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        this._autoSave();
        if (this.gameState) {
          this.gameState.addNarrative('system', '已快速存档到自动槽。');
          this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
        }
        return;
      }

      // ESC：关闭模态框 / 取消选择
      if (e.key === 'Escape') {
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) {
          // 模拟点击外部关闭（兼容已有 click-outside 逻辑）
          backdrop.click();
        }
        return;
      }

      // 无修饰键：单键快捷
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      switch (e.key.toLowerCase()) {
        case 's':
          this.eventSystem.publish('ui:openSaveModal');
          break;
        case 'l':
          this.eventSystem.publish('ui:openLoadModal');
          break;
        case 'i':
          // 切到道具标签
          if (this.ui && this.ui.leftPanel) {
            this.ui.leftPanel._switchTab('items');
          }
          break;
        case 'c':
          // 切到角色标签
          if (this.ui && this.ui.leftPanel) {
            this.ui.leftPanel._switchTab('characters');
          }
          break;
        case ',':
        case '?':
          this.eventSystem.publish('ui:openSettings');
          break;
      }
    });
  }

  // ==================== 存档系统 ====================

  /**
   * 保存到指定槽位
   */
  _saveToSlot(slotId, name) {
    if (!this.gameState) return;
    this.stateManager.setState(this.gameState);
    const presetJson = this.preset ? JSON.stringify(this.preset) : null;
    const ok = this.stateManager.saveToSlot(slotId, name, presetJson);
    if (ok) {
      this.gameState.addNarrative('system', `已保存到「${name || slotId}」。`);
    } else {
      this.gameState.addNarrative('system', '保存失败。');
    }
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
  }

  /**
   * 从指定槽位加载
   */
  _loadFromSlot(slotId) {
    const loaded = this.stateManager.loadFromSlot(slotId);
    if (!loaded || !loaded.state) {
      if (this.gameState) {
        this.gameState.addNarrative('system', '没有找到存档。');
        this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      }
      return;
    }

    // 恢复预设（如果存档带了预设数据）
    if (loaded.preset) {
      try {
        const presetData = typeof loaded.preset === 'string' ? JSON.parse(loaded.preset) : loaded.preset;
        this._applyPreset(presetData);
      } catch (e) {
        console.warn('恢复预设失败:', e);
      }
    }

    this.gameState = GameState.fromJSON(loaded.state);
    this.gameState.addNarrative('system', '存档已读取。');
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
    this._centerMapOnPlayer();
    this._updateTerrainCard();
    this._updateMapHighlights();
  }

  /**
   * 静默自动存档（写到 auto 槽，不显示提示）
   */
  _autoSave() {
    if (!this.gameState) return;
    if (this._autoSaveDisabled) return;
    this.stateManager.setState(this.gameState);
    const presetJson = this.preset ? JSON.stringify(this.preset) : null;
    this.stateManager.saveToSlot('auto', '自动存档', presetJson);
  }

  /**
   * 推进游戏回合计数器
   * 在玩家完成一次"主动作 + AI 响应"循环后调用
   * - 战斗外：触发 TurnManager.endTurn（处理 DoT/HoT 等状态效果）
   * - 战斗内：跳过状态效果衰减（由 CombatSystem.nextTurn 内部管理）
   * 触发 TURN_END 事件扫描，让 turnNumberAtLeast 条件可用
   */
  _advanceTurnCounter() {
    if (!this.gameState) return;
    this.gameState.turnNumber++;

    if (!this.gameState.activeCombat) {
      const turnManager = this.engine.getSystem('TurnManager');
      if (turnManager) turnManager.endTurn(this.gameState);
    }

    this._scanEventTriggers(TRIGGER_MOMENTS.TURN_END);
  }

  /**
   * 检查随机事件触发（统一走 EventTriggerEngine）
   * @param {string} moment - 触发时机 (TRIGGER_MOMENTS.*)
   * @param {object} [extraContext] - 额外上下文（如 tileX/tileY）
   */
  _scanEventTriggers(moment, extraContext = {}) {
    if (!this.gameState) return;
    const triggerEngine = this.engine.getSystem('EventTriggerEngine');
    if (!triggerEngine) return;

    let context = { moment, ...extraContext };

    // 若是移动时机但没传 tileKey，从地图自动补
    if (moment === TRIGGER_MOMENTS.MOVE && context.tileX !== undefined && !context.tileKey) {
      const mapSystem = this.engine.getSystem('MapSystem');
      const mapData = mapSystem ? mapSystem.getMapData() : null;
      if (mapData) context.tileKey = mapData.getTileKey(context.tileX, context.tileY);
    }

    const matchedIds = triggerEngine.scan(this.gameState, context);
    if (matchedIds.length === 0) return;

    // 每次扫描只触发优先级最高的一个，避免事件爆炸
    this._triggerEvent(matchedIds[0]);
  }
}

// ---- 启动应用 ----
const app = new TRPGApp();
app.init().catch(err => {
  console.error('应用启动失败:', err);
});

// 暴露到全局（方便调试）
window.__trpgApp = app;
