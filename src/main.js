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
import { generateScenePreset } from './systems/WorldGenerator.js';
import { LogSystem } from './systems/LogSystem.js';
import { SceneSystem } from './systems/SceneSystem.js';
import { NPCSystem } from './systems/NPCSystem.js';
import { DialogueSystem } from './systems/DialogueSystem.js';
import { ContextRetriever } from './systems/ContextRetriever.js';
import { presetStorage } from './core/PresetStorage.js';
import { metaProgression } from './core/MetaProgression.js';

// 渲染
import { RenderEngine } from './rendering/RenderEngine.js';
import { MapRenderer } from './rendering/MapRenderer.js';
import { SceneGraphRenderer } from './rendering/SceneGraphRenderer.js';
import { FloatingTextLayer } from './rendering/FloatingTextLayer.js';

// UI
import { GameUI } from './ui/GameUI.js';

// 数据
import { DEFAULT_PRESET } from './data/defaultPreset.js';
import { assignPresetImages } from './data/assetLibrary.js';

// Phase 26E — 项目自带预设清单（Vite 在构建时把 presets/*.json 都打入 bundle）
// keys 是 '/presets/xxx.json'，value 是原始 JSON 对象
const BUNDLED_PRESETS = import.meta.glob('/presets/*.json', { eager: true, import: 'default' });

function classifyPresetScale(sceneCount = 0, eventCount = 0) {
  const score = Math.max(sceneCount, eventCount);
  if (score >= 250) return { id: 'mega', label: '超大型剧本', icon: '🌐', order: 4 };
  if (score >= 80) return { id: 'large', label: '大型剧本', icon: '🗺', order: 3 };
  if (score >= 25) return { id: 'medium', label: '中型剧本', icon: '📚', order: 2 };
  return { id: 'short', label: '短篇剧本', icon: '🎲', order: 1 };
}

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

    /** @type {SceneGraphRenderer} */
    this.sceneRenderer = new SceneGraphRenderer();

    /** @type {FloatingTextLayer} */
    this.floatingText = new FloatingTextLayer();

    /** @type {GameUI|null} */
    this.ui = null;

    /** @type {boolean} 操作锁定标志（AI处理期间禁止新操作） */
    this._actionLocked = false;

    /** @type {Array<object>} public/generated-presets.json 提供的外部剧本索引 */
    this.externalPresetIndex = [];

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

    // 5. 加载外部剧本索引，然后加载预设（优先尝试存档，否则用默认预设）
    await this._loadExternalPresetIndex();

    // 6. 加载预设（优先尝试存档，否则用默认预设）
    this._loadInitialData();

    // 7. 启动引擎
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
    this.engine.registerSystem(new LogSystem(), 5);  // 低优先级即可，被动收集
    this.engine.registerSystem(new SceneSystem(), 33);  // 场景图（位于 EventTrigger 之上，AIGM 之下）
    this.engine.registerSystem(new NPCSystem(), 34);   // NPC 持久状态系统
    this.engine.registerSystem(new DialogueSystem(), 32);  // 对话树解析
    this.engine.registerSystem(new ContextRetriever(), 31); // AI 上下文检索（按相关性挑场景/NPC）

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

    // 注册地图渲染回调（按 displayMode 决定走哪个 renderer）
    renderEngine.addRenderCallback((ctx, viewport, gameState) => {
      if (!gameState) return;
      const sceneSystem = this.engine.getSystem('SceneSystem');
      if (sceneSystem && sceneSystem.hasScenes() && this.preset && this.preset.displayMode !== 'grid') {
        // 场景图模式
        this.sceneRenderer.render(ctx, viewport, gameState, sceneSystem);
      } else if (this.mapRenderer.mapData) {
        // 格子地图模式（向后兼容）
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

    // ---- Canvas 尺寸变化 → 重新居中（解决初始布局延迟导致节点偏离视口的问题）----
    es.subscribe('render:resize', () => {
      if (this.gameState) this._centerMapOnPlayer();
    });

    // ---- 地图点击 → 在场景图模式下点击节点，在格子模式下点击格子 ----
    es.subscribe('render:click', (evt) => {
      if (!this.gameState || this._actionLocked) return;
      const { worldX, worldY, screenX, screenY } = evt.data;

      // 场景图模式：点击场景节点
      const sceneSystem = this.engine.getSystem('SceneSystem');
      if (sceneSystem && sceneSystem.hasScenes() && this.preset && this.preset.displayMode !== 'grid') {
        const sceneId = this.sceneRenderer.hitTest(screenX, screenY);
        if (!sceneId) return;
        // 只允许跳到可达邻居（performTravel 会再校验一次）
        const check = sceneSystem.canTravelTo(this.gameState, sceneId);
        if (!check.ok) {
          this.gameState.addNarrative('system', `（${check.reason}）`);
          this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
          return;
        }
        es.publish('scene:travel', { sceneId });
        return;
      }

      // ====== 旧的格子模式 ======
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
      const actionText = `向${dirLabel} - ${tileName}`;

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

    // ---- 导出日志 ----
    es.subscribe('toolbar:exportLog', () => {
      this._handleExportLog();
    });

    // ---- 旧的"随机世界"已并入新游戏 modal，工具栏不再常驻按钮，留兜底订阅以防外部仍触发 ----
    es.subscribe('toolbar:randomWorld', () => {
      es.publish('ui:openEndgame');
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

    // ---- 工具栏"新游戏"按钮：拿当前局信息打开结算 modal ----
    // 通过 mutate evt.data 注入（高优先级在前），不要 re-publish 否则会引发循环 dispatch
    es.subscribe('ui:openEndgame', (evt) => {
      // 流程内调用已携带数据 → 跳过
      if (evt.data && (evt.data.manual || evt.data.completedMainQuest)) return;
      const stats = this._collectEndgameStats();
      const presetChoices = this._buildPresetChoices();
      evt.data = { manual: true, stats, presetChoices };
    }, 200);  // 高优先级，在 EndgameModal 之前先注入数据

    // ---- 新游戏：清空 gameState、可选清空存档、重载预设 ----
    es.subscribe('game:newGame', (evt) => {
      this._handleNewGame(evt.data || {}).catch(err => {
        console.error('新游戏启动失败:', err);
        this.eventSystem.publish('toast:show', { text: `新游戏启动失败：${err.message}`, type: 'error' });
      });
    });

    // ---- 角色创建完成 → 真正执行 loadPreset（带玩家选择） ----
    es.subscribe('character:complete', (evt) => {
      const { presetData, choices } = evt.data || {};
      if (!presetData) return;
      this._finalizeNewGame(presetData, choices, evt.data?.opts || {});
    });

    // ---- Phase 20B — 营地交互 ----
    es.subscribe('dialogue:choose', (evt) => {
      const dlg = this.engine.getSystem('DialogueSystem');
      if (!dlg || !this.gameState) return;
      const result = dlg.choose(this.gameState, evt.data.branchIndex);
      this.eventSystem.publish('dialogue:viewChanged', { result });
      if (result === 'exit') this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
    });

    es.subscribe('dialogue:exit', () => {
      const dlg = this.engine.getSystem('DialogueSystem');
      if (dlg && this.gameState) dlg.exit(this.gameState);
      this.eventSystem.publish('dialogue:viewChanged', {});
    });

    // 对话分支里写的 effects 由系统统一应用
    es.subscribe('dialogue:effects', (evt) => {
      for (const eff of (evt.data?.effects || [])) {
        this._applyEventEffect(eff);
      }
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
    });

    es.subscribe('camp:gift', (evt) => this._handleCampGift(evt.data));
    es.subscribe('camp:request', (evt) => this._handleCampRequest(evt.data));
    es.subscribe('camp:rest', (evt) => this._handleCampRest(evt.data));

    es.subscribe('camp:close', () => {
      // 关闭对话状态
      const dlg = this.engine.getSystem('DialogueSystem');
      if (dlg && this.gameState) dlg.exit(this.gameState);
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
    });

    // ---- 角色创建取消 → 重新打开新游戏对话框 ----
    es.subscribe('character:cancel', () => {
      this.eventSystem.publish('ui:openEndgame');
    });

    // ---- 场景图：玩家点击邻居节点请求前往 ----
    es.subscribe('scene:travel', (evt) => {
      if (this._actionLocked) return;
      this._travelToScene(evt.data.sceneId);
    });

    // 场景图：快速旅行。只允许前往已探索且有当前可通行路径的节点。
    es.subscribe('scene:fastTravel', (evt) => {
      if (this._actionLocked) return;
      this._fastTravelToScene(evt.data.sceneId);
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
      // Token 预算告警阈值
      const aiEngine = this.engine.getSystem('AIGMEngine');
      if (aiEngine && cfg.budgetWarningTokens !== undefined) {
        aiEngine.setBudgetWarning(cfg.budgetWarningTokens);
      }
      // Phase 26B — AI 叙事丰度 tier 同步到 gameState
      if (cfg.aiTier && this.gameState) {
        this.gameState.aiTier = cfg.aiTier;
        es.publish('game:stateChanged', { gameState: this.gameState });
      }
    });

    // ---- Token 统计请求/重置（SettingsModal 解耦用） ----
    es.subscribe('tokenStats:request', () => {
      const aiEngine = this.engine.getSystem('AIGMEngine');
      if (aiEngine) {
        es.publish('tokenStats:response', { stats: aiEngine.getTokenStats() });
      }
    });
    es.subscribe('tokenStats:resetRequest', () => {
      const aiEngine = this.engine.getSystem('AIGMEngine');
      if (aiEngine) {
        aiEngine.resetTokenStats();
        if (this.gameState) {
          this.gameState.addNarrative('system', 'Token 统计已重置');
          es.publish('game:stateChanged', { gameState: this.gameState });
        }
      }
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

    // Phase 26C — escape_combat 道具的额外副作用：真的结束战斗
    if (eff.requiresCombatEnd === 'flee' && this.gameState.activeCombat) {
      const combatSystem = this.engine.getSystem('CombatSystem');
      if (combatSystem) {
        this.gameState.addNarrative('system', `${eff.itemName} 化作浓雾，你们趁机脱离战场。`);
        combatSystem.endCombat(this.gameState, 'flee');
      }
    }

    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
  }

  /**
   * 加载初始数据（自动存档槽 → 旧 trpg_save → 默认预设）
   * 修复 Bug #9：之前只读旧 trpg_save，自动存档槽 'auto' 不被读取，刷新页面进度丢失
   */
  _loadInitialData() {
    // 优先尝试自动存档槽（_autoSave 写入的位置）
    const autoSlot = this.stateManager.loadFromSlot('auto');
    if (autoSlot && autoSlot.state) {
      this.gameState = GameState.fromJSON(autoSlot.state);
      // 字段名是 preset（JSON 字符串），不是 presetJson
      if (autoSlot.preset) {
        try {
          const presetData = JSON.parse(autoSlot.preset);
          this._applyPreset(presetData);
          this.gameState.addNarrative('system', '已从自动存档恢复游戏。');
        } catch (e) {
          console.warn('无法恢复自动存档的预设，使用默认预设:', e);
          this.loadPreset(DEFAULT_PRESET);
        }
      } else {
        this.loadPreset(DEFAULT_PRESET);
      }
    } else {
      // 兼容旧机制（trpg_save 单槽）
      const savedState = this.stateManager.loadFromLocal('trpg_save');
      if (savedState) {
        this.gameState = GameState.fromJSON(savedState);
        // Phase 23A — 通过 PresetStorage（IndexedDB-first）异步取回预设
        presetStorage.loadCurrent().then(presetData => {
          if (presetData) {
            this._applyPreset(presetData);
            this.gameState.addNarrative('system', '已从存档恢复游戏。');
            this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
          } else {
            this.loadPreset(DEFAULT_PRESET);
          }
        }).catch(e => {
          console.warn('PresetStorage 加载失败，回退默认预设:', e);
          this.loadPreset(DEFAULT_PRESET);
        });
      } else {
        // 没有任何存档，加载默认预设
        this.loadPreset(DEFAULT_PRESET);
      }
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
        if (config.budgetWarningTokens !== undefined) {
          const aiEngine = this.engine.getSystem('AIGMEngine');
          if (aiEngine) aiEngine.setBudgetWarning(config.budgetWarningTokens);
        }
        // Phase 26B — AI tier
        if (config.aiTier && this.gameState) {
          this.gameState.aiTier = config.aiTier;
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

  async _loadExternalPresetIndex() {
    try {
      const res = await fetch('/generated-presets.json', { cache: 'no-store' });
      if (!res.ok) {
        this.externalPresetIndex = [];
        return;
      }
      const list = await res.json();
      this.externalPresetIndex = Array.isArray(list)
        ? list.filter(item => item && item.key && item.path)
        : [];
    } catch (e) {
      console.warn('外部剧本索引加载失败:', e.message);
      this.externalPresetIndex = [];
    }
  }

  /**
   * 加载预设
   * @param {object} presetData - 原始预设数据
   */
  loadPreset(presetData, playerChoices = null) {
    this._applyPreset(presetData);

    // 重置主线完成标记，让新一局可以再次弹结算
    this._mainQuestCompleteFired = false;

    // 从预设创建新的游戏状态
    this.gameState = GameState.fromPreset(this.preset);

    // Phase 19A — 应用玩家角色创建选择（如果有）
    if (playerChoices) {
      this._applyPlayerCharacterChoices(playerChoices);
    }

    // Phase 19B — 初始化 NPC 运行时状态
    const npcSystem = this.engine.getSystem('NPCSystem');
    if (npcSystem) {
      npcSystem.initializeNPCState(this.gameState);
      npcSystem.refreshNPCLocations(this.gameState);
    }

    // 初始化 AI 长期记忆（从预设 lore 导入 World Facts）
    const memorySystem = this.engine.getSystem('MemorySystem');
    if (memorySystem) {
      memorySystem.initializeFromPreset(this.gameState, this.preset);
      const identity = playerChoices ? this._describeCharacter(playerChoices) : '';
      if (identity) {
        memorySystem.addWorldFact(this.gameState, `玩家身份：${identity}`);
      }
    }

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

      // 场景图模式：扫 SCENE_ENTER，让起始场景挂载的事件触发（如 ch1_start）
      const sceneSystem = this.engine.getSystem('SceneSystem');
      if (sceneSystem && sceneSystem.hasScenes() && this.preset && this.preset.displayMode !== 'grid') {
        const startScene = sceneSystem.getCurrentScene(this.gameState);
        if (startScene) {
          // 复用 _afterSceneEnter 同一套逻辑（含 trigger 条件过滤，保证多结局分支正确）
          this._afterSceneEnter(startScene);
        }
        return;
      }

      // 旧格子模式
      const pos = this.gameState.mapState.playerPosition;
      this._scanEventTriggers(TRIGGER_MOMENTS.MOVE, { tileX: pos.x, tileY: pos.y });
    }, 300);
  }

  /**
   * 应用预设到各系统（不重置gameState）
   */
  _applyPreset(presetData) {
    const presetWithImages = assignPresetImages(presetData);
    this.preset = new GamePreset(presetWithImages);

    // Phase 23A — 优先用 PresetStorage（IndexedDB），LS 兜底
    // 大于 1MB 的预设无法塞进 localStorage，必须走 IDB
    presetStorage.saveCurrent(presetWithImages).catch(e => {
      console.warn('PresetStorage.saveCurrent 失败：', e.message);
    });

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

    // 场景图加载（如果预设包含 scenes[]）
    const sceneSystem = this.engine.getSystem('SceneSystem');
    if (sceneSystem) {
      sceneSystem.loadFromPreset(this.preset);
      this.sceneRenderer.setScenes(sceneSystem.getAllScenes());
    }

    // Phase 19B — NPC 系统加载
    const npcSystem = this.engine.getSystem('NPCSystem');
    if (npcSystem) {
      npcSystem.loadFromPreset(this.preset);
    }

    const contextRetriever = this.engine.getSystem('ContextRetriever');
    if (contextRetriever) {
      contextRetriever.loadFromPreset(this.preset);
    }
  }

  /**
   * 将地图视口居中到玩家位置
   */
  _centerMapOnPlayer() {
    if (!this.gameState) return;
    const renderEngine = this.engine.getSystem('RenderEngine');

    // 场景图模式：把视口居中到整个图的几何中心，并自动 zoom 到全图可见
    const sceneSystem = this.engine.getSystem('SceneSystem');
    if (sceneSystem && sceneSystem.hasScenes() && this.preset && this.preset.displayMode !== 'grid') {
      // 先按当前 viewport 算出能装下全部节点的 zoom
      const fitZoom = this.sceneRenderer.getFitZoom(
        renderEngine.viewport.width,
        renderEngine.viewport.height
      );
      renderEngine.viewport.zoom = fitZoom;
      const c = this.sceneRenderer.getBoundsCenter();
      renderEngine.centerOn(c.x, c.y);
      return;
    }

    if (!this.mapRenderer.mapData) return;
    const pos = this.gameState.mapState.playerPosition;
    const tileSize = this.mapRenderer.mapData.tileSize;
    const worldX = pos.x * tileSize + tileSize / 2;
    const worldY = pos.y * tileSize + tileSize / 2;
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
        // 主线完成检测（默认 ch10_epilogue 走这条路径，因为它无 choices）
        this._checkMainQuestComplete(eventCard.id);
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

    // 玩家选择留痕（UI 上点击 / 测试调用都会经过这里）
    this.gameState.addNarrative('player', `选择：${choice.text}`);

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

    // 应用效果，并把“实际执行结果”传给 GM，避免系统拒绝但叙事写成成功。
    const effectResults = [];
    if (outcome && outcome.effects) {
      for (const effect of outcome.effects) {
        const effectResult = this._applyEventEffect(effect);
        if (effectResult) effectResults.push(effectResult);
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
      effectResults,
    }, this.gameState).then((result) => {
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      if (result.diceResults && result.diceResults.length > 0) {
        for (const dr of result.diceResults) {
          if (dr && dr.total !== undefined) this.eventSystem.publish('dice:show', dr);
        }
      }
      // 主线完成检测（带 choices 的事件也可能是 epilogue）
      this._checkMainQuestComplete(eventId);
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
    if (!this.gameState) return null;

    switch (effect.type) {
      case 'add_item': {
        const char = this.gameState.activeCharacters[0];
        if (char) {
          if (!char.inventory) char.inventory = [];
          char.inventory.push(effect.itemId);
          return { ok: true, type: effect.type, message: `获得物品 ${effect.itemId}` };
        }
        break;
      }
      case 'remove_item': {
        for (const char of this.gameState.activeCharacters) {
          const idx = (char.inventory || []).indexOf(effect.itemId);
          if (idx !== -1) {
            char.inventory.splice(idx, 1);
            return { ok: true, type: effect.type, message: `移除物品 ${effect.itemId}` };
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
        return { ok: true, type: effect.type, message: `造成 ${value} 点伤害` };
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
        return { ok: true, type: effect.type, message: `恢复 ${value} 点生命` };
      }
      case 'start_combat': {
        this._startCombat(effect.enemyIds || []);
        return { ok: true, type: effect.type, message: `进入战斗` };
      }
      case 'set_variable': {
        // 用于事件分支写状态机
        if (!this.gameState.variables) this.gameState.variables = {};
        if (effect.name) {
          this.gameState.variables[effect.name] = effect.value;
          this.eventSystem.publish('game:variableChanged', { name: effect.name, value: effect.value });
          return { ok: true, type: effect.type, message: `${effect.name} = ${effect.value}` };
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
      // Phase 19C — 推进故事时间
      case 'advance_time': {
        const hours = effect.hours ?? effect.value ?? 1;
        this._advanceStoryTime(hours);
        return { ok: true, type: effect.type, message: `时间推进 ${hours} 小时` };
      }
      // Phase 19B — NPC 互动效果
      case 'change_affection': {
        const npcSystem = this.engine.getSystem('NPCSystem');
        if (npcSystem && effect.npcId) npcSystem.changeAffection(this.gameState, effect.npcId, effect.delta || 0);
        break;
      }
      // Phase 22B — NPC 死亡 + 关系传播
      case 'kill_npc': {
        const npcSystem = this.engine.getSystem('NPCSystem');
        if (npcSystem && effect.npcId) {
          const npc = npcSystem.getNPC(effect.npcId);
          const effects = npcSystem.applyNPCDeath(this.gameState, effect.npcId);
          if (npc) this.gameState.addNarrative('system', `💀 ${npc.name} 已陨落。`);
          // 给关联 NPC 的反应留痕（让玩家感到"世界在反应"）
          for (const ef of effects) {
            const tgt = npcSystem.getNPC(ef.to);
            if (!tgt) continue;
            const verb = ef.delta < 0 ? '愤怒' : '欣慰';
            this.gameState.addNarrative('system',
              `${tgt.icon || '🧑'} ${tgt.name} 因此 ${verb}（好感 ${ef.delta >= 0 ? '+' : ''}${ef.delta}）`);
          }
          // 从同行队伍移除
          if (npc) {
            npcSystem.dismissCompanion(this.gameState, effect.npcId);
            const idx = this.gameState.activeCharacters.findIndex(c => c.id === effect.npcId && c._isCompanion);
            if (idx >= 0) this.gameState.activeCharacters.splice(idx, 1);
          }
        }
        break;
      }
      case 'recruit_companion': {
        const npcSystem = this.engine.getSystem('NPCSystem');
        if (npcSystem && effect.npcId) {
          const ok = npcSystem.recruitCompanion(this.gameState, effect.npcId);
          const npc = npcSystem.getNPC(effect.npcId);
          if (ok && npc) {
            // 把 NPC 当伙伴加入 activeCharacters（带 _isCompanion 标记，UI 据此隐藏装备编辑）
            // 仅当尚未在 activeCharacters 中时加入
            const exists = this.gameState.activeCharacters.some(c => c.id === effect.npcId);
            if (!exists) {
              const slot = JSON.parse(JSON.stringify(npc));
              slot._isCompanion = true;
              slot.type = 'character';  // 让战斗系统正确识别
              // 补齐 hpCurrent/mpCurrent
              if (slot.stats) {
                slot.stats.hpCurrent = slot.stats.hp;
                slot.stats.mpCurrent = slot.stats.mp;
              }
              this.gameState.activeCharacters.push(slot);
            }
            this.gameState.addNarrative('system', `🤝 ${npc.name} 加入了你的队伍。`);
            return { ok: true, type: effect.type, message: `${npc.name} 加入队伍` };
          }
        }
        break;
      }
      case 'dismiss_companion': {
        const npcSystem = this.engine.getSystem('NPCSystem');
        if (npcSystem && effect.npcId) {
          npcSystem.dismissCompanion(this.gameState, effect.npcId);
          // 同时从 activeCharacters 移除
          const idx = this.gameState.activeCharacters.findIndex(c => c.id === effect.npcId && c._isCompanion);
          if (idx >= 0) this.gameState.activeCharacters.splice(idx, 1);
          const npc = npcSystem.getNPC(effect.npcId);
          if (npc) this.gameState.addNarrative('system', `👋 ${npc.name} 离开了你的队伍。`);
        }
        break;
      }
      // Phase 22A — worldFlag（带玩家反馈）
      case 'set_worldFlag': {
        if (effect.name) {
          this.gameState.worldFlags = this.gameState.worldFlags || {};
          const oldVal = this.gameState.worldFlags[effect.name];
          this.gameState.worldFlags[effect.name] = effect.value;
          // 状态真的变化时给系统反馈（hint 可选 — 作者写就用，否则通用文案）
          if (oldVal !== effect.value) {
            const hint = effect.hint || `🌍 世界状态变化：${effect.name} = ${effect.value}`;
            this.gameState.addNarrative('system', hint);
          }
          return { ok: true, type: effect.type, message: `${effect.name} = ${effect.value}` };
        }
        break;
      }
      // Phase 21B — 解锁隐藏连接
      case 'reveal_connection': {
        const ss = this.engine.getSystem('SceneSystem');
        if (ss && effect.from && effect.to) {
          const ok = ss.revealConnection(this.gameState, effect.from, effect.to);
          if (ok) {
            const toScene = ss.getScene(effect.to);
            this.gameState.addNarrative('system',
              `🗺 你发现了一条新路径${toScene ? `（通向 ${toScene.name}）` : ''}。`);
            return { ok: true, type: effect.type, message: `发现通向 ${toScene ? toScene.name : effect.to} 的新路径` };
          }
        }
        break;
      }
      // Phase 26 — 快速旅行（仅允许传送到已访问过的安全场景，防止剧情跳关）
      case 'teleport_to_scene': {
        const ss = this.engine.getSystem('SceneSystem');
        const sceneId = effect.sceneId;
        if (!ss || !sceneId) break;
        const target = ss.getScene(sceneId);
        if (!target) return { ok: false, type: effect.type, message: `目标场景不存在` };
        const visited = this.gameState.mapState?.visitedSceneIds || [];
        const allowUnvisited = effect.allowUnvisited === true;
        if (!allowUnvisited && !visited.includes(sceneId)) {
          this.gameState.addNarrative('system', `（${target.name} 还未去过，不能直接传送）`);
          return { ok: false, type: effect.type, message: `${target.name} 还未去过，传送未发生` };
        }
        if (!allowUnvisited) {
          const check = ss.canFastTravelTo(this.gameState, sceneId);
          if (!check.ok) {
            this.gameState.addNarrative('system', `（无法快速旅行至 ${target.name}：${check.reason}）`);
            return { ok: false, type: effect.type, message: `无法快速旅行至 ${target.name}：${check.reason}` };
          }
        }
        this.gameState.mapState = this.gameState.mapState || {};
        this.gameState.mapState.currentSceneId = sceneId;
        if (target.coords) {
          this.gameState.mapState.playerPosition = { x: target.coords.x, y: target.coords.y };
        }
        const npcSystem = this.engine.getSystem('NPCSystem');
        if (npcSystem) npcSystem.refreshNPCLocations(this.gameState);
        this.gameState.addNarrative('system', `🛤 你来到了 ${target.name}。`);
        this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
        return { ok: true, type: effect.type, message: `抵达 ${target.name}` };
      }
      default:
        break;
    }
    return { ok: true, type: effect.type || 'unknown', message: `${effect.type || 'unknown'} 已处理` };
  }

  /**
   * Phase 19C — 推进故事时间，并自动同步 NPC schedule
   * @param {number} hours
   */
  _advanceStoryTime(hours) {
    if (!this.gameState) return;
    const st = this.gameState.storyTime || (this.gameState.storyTime = { day: 1, hour: 8 });
    st.hour = (st.hour || 0) + (hours || 0);
    while (st.hour >= 24) { st.hour -= 24; st.day = (st.day || 1) + 1; }
    while (st.hour < 0)   { st.hour += 24; st.day = Math.max(1, (st.day || 1) - 1); }

    // 同步 NPC 位置
    const npcSystem = this.engine.getSystem('NPCSystem');
    if (npcSystem) npcSystem.refreshNPCLocations(this.gameState);

    this.eventSystem.publish('game:storyTimeChanged', { storyTime: st });
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

    // 给每只敌人实例分配唯一 ID（修复 Bug #5：同种敌人多只时 findCombatant 冲突）
    const enemies = enemyIds
      .map((id, idx) => ({ original: cardManager.getCard(id), idx }))
      .filter(o => o.original)
      .map(({ original, idx }) => {
        const clone = JSON.parse(JSON.stringify(original));
        clone._originalId = original.id;  // 保留原 ID 供掉落/卡牌引用
        clone.id = `${original.id}#${idx}`;  // 唯一实例 ID
        return clone;
      });

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
    const { actionType, actorId, targetId, abilityId, itemId, ownerCharId, targetCharId } = payload;

    // 玩家意图留痕：UI 点击或测试调用都会经过这里
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
      } else if (actionType === 'use_item') {
        const cm = this.engine.getSystem('CardManager');
        const item = cm?.getCard(itemId);
        intent = `${actorPre.name} 使用 ${item?.name || itemId}`;
      } else {
        intent = `执行 ${actionType}`;
      }
      this.gameState.addNarrative('player', intent);
    }

    this._lockActions();

    let result = null;
    if (actionType === 'attack') {
      result = combatSystem.performAttack(this.gameState, actorId, targetId);
      this._showAttackDice(result, actorId);
    } else if (actionType === 'ability') {
      result = combatSystem.useAbility(this.gameState, actorId, abilityId, targetId);
      this._showAttackDice(result, actorId);
    } else if (actionType === 'flee') {
      this._attemptFlee(actorId);
      return;
    } else if (actionType === 'use_item') {
      // 战斗中使用消耗品 — 算消耗本回合
      this._useItem(itemId, ownerCharId || actorId, targetCharId || actorId);
      result = { success: true };
    }

    // 修复 Bug #3：玩家自己的战斗动作也写叙事
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
      // 修复 Bug #3：敌人攻击需要叙事条目（之前玩家完全不知道发生了什么）
      if (result && result.success) {
        const dmgStr = result.finalDamage > 0 ? `造成 ${result.finalDamage} 点伤害` : '未造成伤害';
        const defeatedStr = result.targetDefeated ? '，将其击倒！' : '。';
        this.gameState.addNarrative('system', `${enemy.name} 攻击 ${target.name}，${dmgStr}${defeatedStr}`);
      }
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

    // 记忆战斗结果（修复 Bug #7：activeCombat 此时已被 endCombat 清空，改用 endResult.defeatedEnemies）
    const memorySystem = this.engine.getSystem('MemorySystem');
    const defeatedList = endResult.defeatedEnemies || [];
    if (memorySystem && defeatedList.length > 0) {
      const notable = defeatedList.filter(e => ['boss', 'hard'].includes(e.difficulty));
      if (notable.length > 0 && endResult.result === 'victory') {
        memorySystem.addKeyEvent(this.gameState, {
          summary: `击败了 ${notable.map(e => e.name).join('、')}`,
          tags: ['combat', 'victory'],
        });
      } else if (endResult.result === 'defeat') {
        memorySystem.addKeyEvent(this.gameState, {
          summary: `被 ${defeatedList.map(e => e.name).join('、')} 击败`,
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
    const resultLabel = endResult.result === 'victory' ? '胜利' : endResult.result === 'flee' ? '逃脱' : '失败';
    aiEngine.processGameAction('narrate_combat', {
      roundResults: [{ narrative: `战斗${resultLabel}` }],
      enemies: [],
    }, this.gameState).catch(() => {
      // AI 失败兜底：写一个最简的结算叙事，避免战斗结束后什么也没说
      const fallbackText = endResult.result === 'victory'
        ? '硝烟散去，敌人倒下。你们喘着粗气审视战场，准备整理装备继续前行。'
        : endResult.result === 'flee'
        ? '你们终于挣脱了战斗，跌跌撞撞退入林中阴影深处，心跳仍未平息。'
        : '一切归于沉寂。你们倒在战场上...这是最后的画面。';
      this.gameState.addNarrative('gm', fallbackText);
    }).finally(() => {
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      // 战斗结束扫描可能因击败 boss 或获得物品触发的后续事件
      this._scanEventTriggers(TRIGGER_MOMENTS.COMBAT_END);
      // 同一场景内常见“boss 战后 loot/后续事件”使用 inScene + requireCompletedEvents，
      // 需要在战斗结束后重新扫一次 SCENE_ENTER 才能接上。
      if (!this.gameState.activeEvent && !this.gameState.activeCombat) {
        this._scanEventTriggers(TRIGGER_MOMENTS.SCENE_ENTER);
      }
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
    // 顺序很关键：对角线优先（含"北/南/西/东"子串），明确方向词优先于单字
    // 修复 Bug #1: 之前"前进"被绑在"北"导致"向东前进"被识别成北
    const directionMap = [
      // 对角线（必须排在前面，否则"西北"会先匹配单字"北"）
      { patterns: /西北|northwest/, dx: -1, dy: -1 },
      { patterns: /东北|northeast/, dx: 1, dy: -1 },
      { patterns: /西南|southwest/, dx: -1, dy: 1 },
      { patterns: /东南|southeast/, dx: 1, dy: 1 },
      // 明确方向短语
      { patterns: /向北|往北|north|↑/i, dx: 0, dy: -1 },
      { patterns: /向南|往南|south|↓/i, dx: 0, dy: 1 },
      { patterns: /向西|往西|west|←|向左/i, dx: -1, dy: 0 },
      { patterns: /向东|往东|east|→|向右/i, dx: 1, dy: 0 },
      // 单字 fallback（已排除上面被匹配的情况）
      { patterns: /北/, dx: 0, dy: -1 },
      { patterns: /南/, dx: 0, dy: 1 },
      { patterns: /西/, dx: -1, dy: 0 },
      { patterns: /东/, dx: 1, dy: 0 },
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
    if (!this.gameState) return null;

    // 场景图模式：构建"当前场景 + 邻居作为选项"的卡片
    const sceneSystem = this.engine.getSystem('SceneSystem');
    if (sceneSystem && sceneSystem.hasScenes() && this.preset && this.preset.displayMode !== 'grid') {
      const currentBase = sceneSystem.getCurrentScene(this.gameState);
      if (!currentBase) return null;
      // Phase 21A — 用活跃变体的视图（不动 connections — 那由 getAdjacent 内部处理）
      const current = sceneSystem.getActiveSceneView(currentBase, this.gameState) || currentBase;
      const visited = new Set(this.gameState.mapState.visitedSceneIds || []);
      const adjacent = sceneSystem.getAdjacent(this.gameState);
      const choices = adjacent.map(a => {
        // 锁定 + 没去过 → 不剧透名字
        const hideIdentity = !a.reachable && !visited.has(a.scene.id);
        const sceneLabel = hideIdentity ? '???' : a.scene.name;
        let text;
        if (a.reachable) {
          text = `${a.connection.label || '前往'} → ${sceneLabel}`;
        } else {
          text = `🔒 ${sceneLabel} — ${a.lockedReason}`;
        }
        return {
          id: `travel_${a.scene.id}`,
          text,
          _sceneId: a.scene.id,
          _reachable: a.reachable,
        };
      });
      // Phase 19B — 在场 NPC 列表（在场景描述下方显示）
      const npcSystem = this.engine.getSystem('NPCSystem');
      let npcsHere = [];
      if (npcSystem) {
        // 还会显示首次相遇的 NPC（includeUnknown=true 把未见过的也亮出来）
        const inScene = npcSystem.getNPCsInScene(this.gameState, current.id, true);
        npcsHere = inScene.map(({ npc, state }) => ({
          id: npc.id, name: npc.name, icon: npc.icon || '🧑',
          knownTo: state.knownTo, affection: state.affection,
          isCompanion: npcSystem.isCompanion(this.gameState, npc.id),
        }));
        // 进入场景时把未见过的标记为已见
        for (const { npc } of inScene) npcSystem.meetNPC(this.gameState, npc.id);
      }

      // 把 NPC 拼到 description 末尾（编辑器 UI 暂不改，先用最小可见呈现）
      let desc = current.description || '';
      if (npcsHere.length > 0) {
        const list = npcsHere.map(n => {
          const tag = n.isCompanion ? ' (同行)' : (n.knownTo ? ` ❤${n.affection}` : '');
          return `${n.icon} ${n.name}${tag}`;
        }).join('，');
        desc += `\n\n👥 在场：${list}`;
      }

      return {
        id: 'scene_current',
        type: 'event',
        eventType: 'scene',
        name: `${current.icon || '📍'} ${current.name}`,
        description: desc,
        image: '',
        choices,
        _isSceneCard: true,
        _npcsHere: npcsHere,
      };
    }

    if (!this.mapRenderer.mapData) return null;
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
      const choice = terrainCard.choices.find(c => c.id === choiceId);
      if (!choice) return;

      // 场景图模式：派发 scene:travel
      if (terrainCard._isSceneCard) {
        if (!choice._reachable) {
          this.gameState.addNarrative('system', `（${choice.text}）`);
          this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
          return;
        }
        this.eventSystem.publish('scene:travel', { sceneId: choice._sceneId });
        return;
      }

      // 旧格子模式
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

    // 战斗进行中不扫故事/相遇事件 — 避免 ch10 类"完成 boss 战的下一章"
    // 在战斗还没真正打完时就把 ending 写出来。COMBAT_END 时机会在战斗收尾后补扫。
    if (this.gameState.activeCombat && moment !== TRIGGER_MOMENTS.COMBAT_END) {
      return;
    }

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

  /**
   * 导出日志：弹出格式选择，调 LogSystem 触发下载
   */
  _handleExportLog() {
    const logSystem = this.engine.getSystem('LogSystem');
    if (!logSystem) return;

    const choice = prompt('选择导出格式：\n1 - JSON（机器可读，含完整数据，可用于 bug 报告）\n2 - Markdown（人类可读，叙事/战斗回顾）', '1');
    if (!choice) return;

    const format = choice.trim() === '2' ? 'markdown' : 'json';
    const ok = logSystem.exportToFile(this.gameState, format, this.preset);
    if (ok && this.gameState) {
      this.gameState.addNarrative('system', `📋 日志已导出为 ${format.toUpperCase()}`);
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
    }
  }

  // ==================== 场景图移动 ====================

  /**
   * 前往目标场景节点
   * 一次完整流程：校验 → 锁定 → 写"启程"叙事 → performTravel → 抵达 AI 叙事 → 扫描场景挂载事件
   * @param {string} sceneId
   */
  _travelToScene(sceneId) {
    if (!this.gameState) return;
    const sceneSystem = this.engine.getSystem('SceneSystem');
    if (!sceneSystem) return;

    const check = sceneSystem.canTravelTo(this.gameState, sceneId);
    if (!check.ok) {
      this.gameState.addNarrative('system', `（无法前往：${check.reason}）`);
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      return;
    }

    this._lockActions();

    const fromScene = sceneSystem.getCurrentScene(this.gameState);
    const result = sceneSystem.performTravel(this.gameState, sceneId);
    if (!result) {
      this._unlockActions();
      return;
    }
    const { scene, isFirstVisit, connection } = result;

    // Phase 19C — 旅行推进故事时间
    // 优先 connection.cost（小时），其次 scene.travelHours，否则 1 小时
    const hours = (connection?.cost) || scene.travelHours || 1;
    this._advanceStoryTime(hours);

    // 写玩家行动 + 简短启程叙事
    const label = (connection && connection.label) ? connection.label : `前往 ${scene.name}`;
    this.gameState.addNarrative('player', label);
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });

    // 重访 + 已有 vignette：用本地模板，不调 AI
    if (!isFirstVisit) {
      // Phase 21A — vignette 也从 variant 取（variant.vignettes 优先）
      const sceneViewForVignette = sceneSystem.getActiveSceneView(scene, this.gameState) || scene;
      const v = sceneSystem.pickVignette(sceneViewForVignette);
      if (v) {
        this.gameState.addNarrative('gm', v);
        this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      }
      this._afterSceneEnter(sceneViewForVignette);
      return;
    }

    // Phase 21A — 用 active variant 的 description（如果有命中的变体）
    const sceneView = sceneSystem.getActiveSceneView(scene, this.gameState) || scene;

    // 首访：AI 叙事 + 场景事件扫描
    const aiEngine = this.engine.getSystem('AIGMEngine');
    aiEngine.processGameAction('narrate_scene_arrival', {
      fromScene: fromScene ? { id: fromScene.id, name: fromScene.name } : null,
      toScene: { id: scene.id, name: scene.name, description: sceneView.description, type: scene.type, tags: scene.tags || [] },
      connectionLabel: connection?.label || '',
    }, this.gameState).then((aiResult) => {
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      if (aiResult.diceResults && aiResult.diceResults.length > 0) {
        for (const dr of aiResult.diceResults) {
          if (dr && dr.total !== undefined) this.eventSystem.publish('dice:show', dr);
        }
      }
      this._afterSceneEnter(sceneView);
    }).catch(() => {
      // AI 失败兜底：直接用变体 description 作为叙事
      if (sceneView.description) this.gameState.addNarrative('gm', sceneView.description);
      this._afterSceneEnter(sceneView);
    });
  }

  /**
   * 快速旅行：只到已探索且沿当前可通行路径连通的场景。
   * 路径、耗时和中途系统影响由代码结算；GM 只负责最终结果叙事。
   */
  _fastTravelToScene(sceneId) {
    if (!this.gameState) return;
    const sceneSystem = this.engine.getSystem('SceneSystem');
    if (!sceneSystem) return;

    const plan = sceneSystem.planFastTravel(this.gameState, sceneId);
    if (!plan.ok) {
      this.gameState.addNarrative('system', `（无法快速旅行：${plan.reason}）`);
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      return;
    }

    this._lockActions();
    const routeOutcome = this._resolveFastTravelRouteEffects(plan);
    const appliedPath = routeOutcome.interrupted
      ? plan.path.slice(0, routeOutcome.pathIndex + 1)
      : plan.path;
    const result = sceneSystem.applyFastTravelPath(this.gameState, appliedPath);
    if (!result) {
      this.gameState.addNarrative('system', '（无法快速旅行：路线状态更新失败）');
      this._unlockActions();
      return;
    }

    const routeNames = plan.path.map(id => sceneSystem.getScene(id)?.name || id);
    this._advanceStoryTime(routeOutcome.elapsedHours);
    this.gameState.addNarrative('player', routeOutcome.interrupted
      ? `快速旅行：${routeNames[0]} → ${sceneSystem.getScene(routeOutcome.sceneId)?.name || routeOutcome.sceneId}（遭遇中断）`
      : `快速旅行：${routeNames[0]} → ${routeNames[routeNames.length - 1]}`);

    if (routeOutcome.summary) {
      this.gameState.addNarrative('system', `（路途结算：${routeOutcome.summary}）`);
    }
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });

    if (routeOutcome.interrupted && routeOutcome.enemyIds?.length > 0) {
      this._startCombat(routeOutcome.enemyIds);
      return;
    }

    const aiEngine = this.engine.getSystem('AIGMEngine');
    aiEngine.processGameAction('narrate_scene_arrival', {
      fromScene: plan.from ? { id: plan.from.id, name: plan.from.name } : null,
      toScene: { id: plan.to.id, name: plan.to.name, description: plan.to.description, type: plan.to.type, tags: plan.to.tags || [] },
      connectionLabel: `快速旅行，经由 ${routeNames.join(' → ')}`,
      travelSummary: {
        path: routeNames,
        hours: routeOutcome.elapsedHours,
        encounterSummary: routeOutcome.summary,
      },
    }, this.gameState).then((aiResult) => {
      this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
      if (aiResult.diceResults && aiResult.diceResults.length > 0) {
        for (const dr of aiResult.diceResults) {
          if (dr && dr.total !== undefined) this.eventSystem.publish('dice:show', dr);
        }
      }
      const sceneView = sceneSystem.getActiveSceneView(plan.to, this.gameState) || plan.to;
      this._afterSceneEnter(sceneView);
    }).catch(() => {
      this.gameState.addNarrative('gm', `你们沿已知路线跋涉 ${routeOutcome.elapsedHours} 小时，抵达 ${plan.to.name}。`);
      const sceneView = sceneSystem.getActiveSceneView(plan.to, this.gameState) || plan.to;
      this._afterSceneEnter(sceneView);
    });
  }

  _resolveFastTravelRouteEffects(plan) {
    const sceneSystem = this.engine.getSystem('SceneSystem');
    const result = {
      interrupted: false,
      pathIndex: plan?.path?.length ? plan.path.length - 1 : 0,
      sceneId: plan?.to?.id,
      elapsedHours: plan?.travelHours || 0,
      enemyIds: [],
      summary: '一路顺利，未遭遇敌袭',
      incidents: [],
    };
    if (!plan || !Array.isArray(plan.path) || plan.path.length <= 1) {
      result.summary = '未发生路途事件';
      return result;
    }

    let elapsed = 0;
    for (let i = 1; i < plan.path.length; i++) {
      const prev = sceneSystem.getScene(plan.path[i - 1]);
      const scene = sceneSystem.getScene(plan.path[i]);
      if (!scene) continue;
      const segmentHours = this._getFastTravelSegmentHours(prev, scene, plan.path[i], sceneSystem);
      elapsed += segmentHours;

      const chance = this._getRouteEncounterChance(scene);
      if (chance > 0 && Math.random() < chance) {
        const enemyIds = this._pickRouteEncounterEnemies(scene);
        if (enemyIds.length > 0) {
          result.interrupted = true;
          result.pathIndex = i;
          result.sceneId = scene.id;
          result.elapsedHours = elapsed;
          result.enemyIds = enemyIds;
          result.summary = `在${scene.name}遭遇敌袭，快速旅行中断`;
          return result;
        }
      }

      const attritionChance = Math.max(0, chance - 0.25);
      if (attritionChance > 0 && Math.random() < attritionChance) {
        const damage = Math.max(1, Math.ceil(segmentHours));
        for (const c of this.gameState.activeCharacters || []) {
          if (!c.stats) continue;
          c.stats.hpCurrent = Math.max(1, (c.stats.hpCurrent ?? c.stats.hp) - damage);
        }
        result.incidents.push(`${scene.name}路况险恶，队伍各损失 ${damage} 点生命`);
      }
    }

    if (result.incidents.length > 0) {
      result.summary = result.incidents.join('；');
    } else {
      const dangerousCount = plan.path
        .slice(1)
        .map(id => sceneSystem.getScene(id))
        .filter(scene => this._getRouteEncounterChance(scene) > 0)
        .length;
      result.summary = dangerousCount > 0
        ? `途经 ${dangerousCount} 处危险地带，但未触发战斗`
        : '一路顺利，未遭遇敌袭';
    }
    return result;
  }

  _getFastTravelSegmentHours(fromScene, toScene, toSceneId, sceneSystem) {
    const conn = sceneSystem._getActiveConnections(fromScene, this.gameState).find(c => c.to === toSceneId);
    return Number(conn?.cost ?? toScene?.travelHours ?? 1) || 1;
  }

  _getRouteEncounterChance(scene) {
    if (!scene) return 0;
    const tags = new Set(scene.tags || []);
    let chance = 0;
    if (scene.type === 'combat') chance += 0.45;
    if (scene.type === 'dungeon') chance += 0.32;
    if (scene.type === 'wilderness') chance += 0.16;
    for (const tag of ['dangerous', 'combat', 'dungeon', 'wild', 'wilderness', 'monster', 'random']) {
      if (tags.has(tag)) chance += 0.08;
    }
    if (tags.has('safe') || scene.type === 'settlement' || scene.type === 'shop') chance = 0;
    return Math.min(0.65, chance);
  }

  _pickRouteEncounterEnemies(scene) {
    const cardManager = this.engine.getSystem('CardManager');
    const enemies = cardManager?.getCardsByType('enemy') || [];
    if (enemies.length === 0) return [];

    const sceneTags = new Set(scene.tags || []);
    const matching = enemies.filter(enemy => {
      const enemyTags = enemy.tags || [];
      return enemyTags.some(tag => sceneTags.has(tag)) || enemy.difficulty === 'easy' || enemy.difficulty === 'normal';
    });
    const pool = matching.length > 0 ? matching : enemies;
    const count = Math.min(pool.length, Math.random() < 0.25 ? 2 : 1);
    const picked = [];
    while (picked.length < count) {
      const enemy = pool[Math.floor(Math.random() * pool.length)];
      if (enemy && !picked.includes(enemy.id)) picked.push(enemy.id);
    }
    return picked;
  }

  /**
   * 抵达场景后：扫描挂载事件、自动存档、推进回合、解锁
   */
  _afterSceneEnter(scene) {
    // 0) Phase 19B — 入场景就自动 meetNPC（让图鉴 + 关系图能记录所有遇到过的 NPC）
    const npcSystem = this.engine.getSystem('NPCSystem');
    if (npcSystem && scene && scene.id) {
      // 用 includeUnknown=true 拿到所有活着的 NPC（不分已遇 / 未遇），然后只对未遇的喊一次 meet
      const inScene = npcSystem.getNPCsInScene(this.gameState, scene.id, true);
      for (const { npc } of inScene) {
        npcSystem.meetNPC(this.gameState, npc.id);
      }
      // 同行伙伴也算"遇见过"
      for (const cid of (this.gameState.companions || [])) {
        npcSystem.meetNPC(this.gameState, cid);
      }
    }

    // 1) 先尝试 SCENE_ENTER 时机的触发器（events 字段 + inScene 条件）
    if (scene.events && scene.events.length > 0) {
      const cardManager = this.engine.getSystem('CardManager');
      const triggerEngine = this.engine.getSystem('EventTriggerEngine');
      const pos = this.gameState.mapState.playerPosition;
      const ctx = { moment: TRIGGER_MOMENTS.SCENE_ENTER, tileX: pos?.x, tileY: pos?.y };

      // 过滤：未完成 + 触发条件满足（支持 requireVariables 等做多分支结局）
      const candidates = scene.events
        .map(id => cardManager.getCard(id))
        .filter(e => {
          if (!e) return false;
          if (!e.repeatable && this.gameState.completedEventIds.includes(e.id)) return false;
          // 尊重事件自身的 trigger 条件 — 让 ch10_redeemed/ch10_epilogue 这类
          // 同一场景多分支结局能正确按变量分流
          if (e.trigger && typeof triggerEngine?.evaluateTrigger === 'function') {
            return triggerEngine.evaluateTrigger(e, this.gameState, ctx);
          }
          return true;
        });
      candidates.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      const ev = candidates[0];
      if (ev) {
        this._triggerEvent(ev.id);
        return;
      }
    }

    // 2) 让 SCENE_ENTER 时机的触发器引擎跑一次（也能匹配 inScene 条件的事件）
    this._scanEventTriggers(TRIGGER_MOMENTS.SCENE_ENTER);

    // 3) Phase 20B — 如果是 camp/inn 场景，自动弹营地 modal
    if (scene && (scene.type === 'camp' || scene.type === 'inn')) {
      this._openCampForScene(scene);
    }

    // 4) 推进回合 + 自动存档 + 解锁 + 刷新场景卡
    this._advanceTurnCounter();
    this._autoSave();
    this._updateTerrainCard();
    this._unlockActions();
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
  }

  /**
   * 抵达营地/旅馆时打开 CampModal
   */
  _openCampForScene(scene) {
    const npcSystem = this.engine.getSystem('NPCSystem');
    if (!npcSystem) return;
    // 在场 NPC = 当前场景内 + 同行伙伴（伙伴永远跟随玩家）
    const inScene = npcSystem.getNPCsInScene(this.gameState, scene.id, true);
    for (const { npc } of inScene) npcSystem.meetNPC(this.gameState, npc.id);
    const npcIds = inScene.map(o => o.npc.id);
    // 同行伙伴也加入对话列表（即使他们的 currentScene 不一定在这）
    for (const cid of (this.gameState.companions || [])) {
      if (!npcIds.includes(cid)) npcIds.push(cid);
    }
    this.eventSystem.publish('camp:open', {
      sceneId: scene.id,
      sceneName: scene.name,
      sceneIcon: scene.icon || '🏕',
      npcIds,
    });
  }

  /**
   * Phase 20B — 赠礼处理
   */
  _handleCampGift({ npcId, itemId }) {
    if (!this.gameState) return;
    const npcSystem = this.engine.getSystem('NPCSystem');
    const cm = this.engine.getSystem('CardManager');
    const item = cm.getCard(itemId);
    const npc = npcSystem.getNPC(npcId);
    if (!item || !npc) return;

    // 从主角 inventory 取出
    const pc = this.gameState.activeCharacters?.[0];
    if (!pc?.inventory) return;
    const idx = pc.inventory.indexOf(itemId);
    if (idx < 0) return;
    pc.inventory.splice(idx, 1);

    // 判反应 + 改 affection + 加入 NPC inventory
    const reaction = npcSystem.evaluateGiftReaction(npcId, item);
    const delta = npcSystem.giftReactionDelta(reaction);
    npcSystem.changeAffection(this.gameState, npcId, delta);
    const st = npcSystem.getNPCState(this.gameState, npcId);
    if (st) (st.inventory ||= []).push(itemId);

    // 写叙事
    const reactionLabels = {
      love: '深深地喜爱', like: '很开心', neutral: '勉强接受', dislike: '不太喜欢', hate: '厌恶',
    };
    this.gameState.addNarrative('player', `把【${item.name}】送给了 ${npc.name}`);
    this.gameState.addNarrative('system',
      `${npc.icon || '🧑'} ${npc.name} ${reactionLabels[reaction]}（好感 ${delta >= 0 ? '+' : ''}${delta}，当前 ${st?.affection || 0}/100）`);
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
  }

  /**
   * Phase 20B — 索物处理
   */
  _handleCampRequest({ npcId, itemId }) {
    if (!this.gameState) return;
    const npcSystem = this.engine.getSystem('NPCSystem');
    const cm = this.engine.getSystem('CardManager');
    const item = cm.getCard(itemId);
    const npc = npcSystem.getNPC(npcId);
    if (!item || !npc) return;

    const st = npcSystem.getNPCState(this.gameState, npcId);
    if (!st || (st.affection || 0) < 50) return;

    // 从 NPC inventory 转移到玩家
    const idx = (st.inventory || []).indexOf(itemId);
    if (idx < 0) return;
    st.inventory.splice(idx, 1);
    const pc = this.gameState.activeCharacters?.[0];
    if (pc) (pc.inventory ||= []).push(itemId);

    npcSystem.changeAffection(this.gameState, npcId, -5);

    this.gameState.addNarrative('player', `向 ${npc.name} 索要了【${item.name}】`);
    this.gameState.addNarrative('system',
      `${npc.icon || '🧑'} ${npc.name} 把物品给了你，但有些不悦（好感 -5，当前 ${st.affection}/100）`);
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
  }

  /**
   * Phase 20B — 营地休息（推进时间 + 全恢复）
   */
  _handleCampRest({ hours }) {
    if (!this.gameState) return;
    const h = hours || 8;

    // 全队恢复
    for (const c of (this.gameState.activeCharacters || [])) {
      if (c.stats) {
        c.stats.hpCurrent = c.stats.hp;
        c.stats.mpCurrent = c.stats.mp;
      }
    }
    // 同行伙伴也回满
    const npcSystem = this.engine.getSystem('NPCSystem');
    for (const cid of (this.gameState.companions || [])) {
      const npc = npcSystem?.getNPC(cid);
      if (npc?.stats) {
        // NPC 的"当前 HP"借用 npcState.custom._companionStats，避免污染卡定义
        const st = npcSystem.getNPCState(this.gameState, cid);
        if (st) {
          st.custom = { ...(st.custom || {}), hpCurrent: npc.stats.hp, mpCurrent: npc.stats.mp };
        }
      }
    }

    this._advanceStoryTime(h);
    this.gameState.addNarrative('system', `😴 你们休息了 ${h} 小时，恢复了全部体力。`);
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
  }

  // ==================== Phase 19A — 角色创建 ====================

  /**
   * 应用玩家角色创建选项
   * @param {object} choices - { race, origin, background, faith }（每项是 id 字符串）
   */
  _applyPlayerCharacterChoices(choices) {
    if (!this.preset.startingOptions) return;
    const opts = this.preset.startingOptions;
    const tags = [];
    const statBonus = {};

    const apply = (kind, id) => {
      const list = opts[kind] || [];
      const found = list.find(o => o.id === id);
      if (!found) return;
      if (found.tags) tags.push(...found.tags);
      if (found.statBonus) {
        for (const [k, v] of Object.entries(found.statBonus)) {
          statBonus[k] = (statBonus[k] || 0) + v;
        }
      }
    };
    apply('races',       choices.race);
    apply('origins',     choices.origin);
    apply('backgrounds', choices.background);
    apply('faiths',      choices.faith);

    this.gameState.playerTags = [...new Set(tags)];
    this.gameState.variables.player_race = choices.race || null;
    this.gameState.variables.player_origin = choices.origin || null;
    this.gameState.variables.player_background = choices.background || null;
    this.gameState.variables.player_faith = choices.faith || null;

    // 应用属性加成到主角（activeCharacters[0]）
    const pc = this.gameState.activeCharacters?.[0];
    if (pc && pc.stats) {
      for (const [k, v] of Object.entries(statBonus)) {
        if (typeof pc.stats[k] === 'number') {
          pc.stats[k] += v;
          if (k === 'hp') pc.stats.hpCurrent = pc.stats.hp;
          if (k === 'mp') pc.stats.mpCurrent = pc.stats.mp;
        }
      }
    }

    // 按 startingSceneRules 路由起始场景
    const sceneSystem = this.engine.getSystem('SceneSystem');
    if (sceneSystem?.hasScenes() && this.preset.startingSceneRules?.length > 0) {
      const matched = this._resolveStartingScene();
      if (matched) {
        this.gameState.mapState.currentSceneId = matched;
        this.gameState.mapState.visitedSceneIds = [matched];
        const scene = sceneSystem.getScene(matched);
        if (scene?.coords) {
          this.gameState.mapState.playerPosition = { x: scene.coords.x, y: scene.coords.y };
        }
      }
    }
  }

  /**
   * 按 startingSceneRules 匹配玩家标签，决定起始场景 ID
   */
  _resolveStartingScene() {
    const tags = new Set(this.gameState.playerTags || []);
    for (const rule of this.preset.startingSceneRules || []) {
      if (rule.default && Object.keys(rule).length === 1) continue;  // 跳过 default 进入第二轮
      const whenTags = rule.when?.tags || [];
      const whenAnyTags = rule.when?.anyTags || [];
      const okAll = whenTags.every(t => tags.has(t));
      const okAny = whenAnyTags.length === 0 || whenAnyTags.some(t => tags.has(t));
      if (okAll && okAny && rule.sceneId) return rule.sceneId;
    }
    // 默认规则
    const def = (this.preset.startingSceneRules || []).find(r => r.default);
    return def?.default || null;
  }

  // ==================== 新游戏 / 结算 ====================

  /**
   * 收集结算/新游戏弹窗用的统计数据
   * @returns {object} stats — chapters/level/turn/gold/totalTokens/victories
   */
  _collectEndgameStats() {
    const gs = this.gameState;
    if (!gs) return {};
    const cm = this.engine.getSystem('CardManager');
    const aiEngine = this.engine.getSystem('AIGMEngine');

    const mainEvents = cm ? cm.getCardsByType('event').filter(e => (e.tags || []).includes('main')) : [];
    const completedSet = new Set(gs.completedEventIds || []);

    // 按 chapterN tag 去重（避免同一章的多结局变体导致 maxChapters 虚高）
    const chapterKey = (e) => {
      const tag = (e.tags || []).find(t => /^chapter\d+$/.test(t));
      return tag || e.id;
    };
    const allChapters = new Set(mainEvents.map(chapterKey));
    const completedChapters = new Set(
      mainEvents.filter(e => completedSet.has(e.id)).map(chapterKey)
    );
    const chapters = completedChapters.size;

    // 队伍平均等级（取整）
    const chars = gs.activeCharacters || [];
    const avgLevel = chars.length
      ? Math.round(chars.reduce((s, c) => s + (c.level || 1), 0) / chars.length)
      : 0;

    // 战斗胜场：从长期记忆里数 victory tag
    const memorySystem = this.engine.getSystem('MemorySystem');
    let victories = 0;
    if (memorySystem && gs.aiContext && gs.aiContext.keyEvents) {
      victories = gs.aiContext.keyEvents.filter(e => (e.tags || []).includes('victory')).length;
    }

    const tokenStats = aiEngine ? aiEngine.getTokenStats() : { totalTokens: 0, totalCalls: 0 };

    // 主线路径标识（用于结算 modal 告诉玩家走了哪条结局）
    let endingPath = null;
    if (completedSet.has('ch10_redeemed')) endingPath = 'redeemed';
    else if (completedSet.has('ch10_epilogue')) endingPath = 'default';

    return {
      chapters,
      maxChapters: allChapters.size || 10,
      level: avgLevel,
      turnNumber: gs.turnNumber || 0,
      gold: gs.gold || 0,
      victories,
      totalTokens: tokenStats.totalTokens || 0,
      aiCalls: tokenStats.totalCalls || 0,
      endingPath,
    };
  }

  /**
   * 处理新游戏请求
   * @param {{clearAutoSave?: boolean, clearAllSlots?: boolean}} opts
   */
  async _handleNewGame(opts = {}) {
    // 清理存档
    if (opts.clearAutoSave || opts.clearAllSlots) {
      try {
        if (this.stateManager.deleteSlot) this.stateManager.deleteSlot('auto');
        // Phase 26E 修复 — 清干净所有旧版兼容 LS key
        localStorage.removeItem('trpg_save');         // 旧版主存档
        localStorage.removeItem('trpg_game_state');   // 兼容更旧版本
      } catch (e) { /* */ }
    }
    if (opts.clearAllSlots) {
      try {
        if (this.stateManager.listSlots) {
          for (const slot of this.stateManager.listSlots()) {
            if (slot.id && slot.id !== 'auto') {
              this.stateManager.deleteSlot(slot.id);
            }
          }
        }
      } catch (e) { /* */ }
      // PresetStorage 当前预设缓存（同时清 IDB current + LS current）
      try { localStorage.removeItem('trpg_current_preset'); } catch (e) { /* */ }
      try { presetStorage.idbStore?.delete?.('__current__'); } catch (e) { /* */ }

      // Phase 26E — 清空后强制让玩家重新选剧本而不是默用旧 this.preset
      this._actionLocked = false;
      this.gameState = null;       // 清掉内存中的旧 gameState（narrativeLog 也跟着没）
      this.preset = null;          // 强制下面的 fallback 走 DEFAULT_PRESET 路径
      // 弹一个 toast 让用户知道清理完成（避免静默）
      this.eventSystem.publish('toast:show', { text: '🗑 所有存档已清空。请选择剧本开始新冒险。', type: 'info' });
      // 如果玩家在 clearAllSlots 时没传 presetKey/presetData，重新打开 EndgameModal 让 ta 选剧本
      if (!opts.presetKey && !opts.presetData) {
        const stats = this._collectEndgameStats();   // 此时 gameState 为 null，会返回空 stats
        const presetChoices = this._buildPresetChoices();
        this.eventSystem.publish('game:mainQuestComplete', {
          manual: true, stats, presetChoices,
        });
        return;
      }
    }

    // 重置 AI 引擎的对话上下文与 token 统计（新一局新账本）
    const aiEngine = this.engine.getSystem('AIGMEngine');
    if (aiEngine) {
      aiEngine.contextWindow = [];
      aiEngine.summarizedHistory = '';
      aiEngine.tokenStats = {
        totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0,
        totalCalls: 0, lastCall: null, budgetWarningTokens: aiEngine.tokenStats?.budgetWarningTokens || null,
        _warned: false,
      };
      this.eventSystem.publish('ai:tokenUpdate', { stats: aiEngine.tokenStats });
    }

    // 解锁、关闭活跃事件 / 战斗
    this._actionLocked = false;

    // 选择预设来源：
    //   1) opts.presetData 直接传入
    //   2) opts.presetKey 通过 _resolvePresetByKey 生成
    //   3) 否则用当前 preset
    //   4) 最后回退默认预设
    let presetData;
    if (opts.presetData) {
      presetData = opts.presetData;
    } else if (opts.presetKey) {
      presetData = await this._resolvePresetByKey(opts.presetKey);
      if (!presetData) {
        console.warn('未知的 presetKey:', opts.presetKey);
        this.eventSystem.publish('toast:show', { text: '未能加载所选剧本，已回退当前剧本。', type: 'warning' });
        presetData = this.preset ? this.preset.toJSON() : DEFAULT_PRESET;
      }
    } else {
      presetData = this.preset ? this.preset.toJSON() : DEFAULT_PRESET;
    }

    // Phase 19A — 如果预设有 startingOptions，先弹角色创建 modal
    // 否则直接 loadPreset（已有的流程）
    if (presetData.startingOptions && Object.values(presetData.startingOptions).some(arr => Array.isArray(arr) && arr.length > 0)) {
      // 把 opts 透传给 character:complete 处理器
      this.eventSystem.publish('character:open', { presetData, opts });
      return;
    }

    this._finalizeNewGame(presetData, null, opts);
  }

  /**
   * 真正执行 loadPreset（从角色创建 modal 回来 / 或无创建直接进）
   */
  _finalizeNewGame(presetData, choices, opts = {}) {
    this.loadPreset(presetData, choices);
    this._sessionStartTime = Date.now();   // Phase 23A — 用于元进度统计 playTime
    const who = choices ? this._describeCharacter(choices) : '';
    this.gameState.addNarrative('system', `🔄 新的一局开始了：${this.preset.name}${who ? ' · ' + who : ''}`);
    this.eventSystem.publish('game:stateChanged', { gameState: this.gameState });
  }

  /** 把玩家选择转成一句简短描述（用于叙事开场） */
  _describeCharacter(choices) {
    if (!this.preset?.startingOptions) return '';
    const parts = [];
    for (const [axisKey, choiceId] of [
      ['races', choices.race], ['origins', choices.origin],
      ['backgrounds', choices.background], ['faiths', choices.faith],
    ]) {
      const list = this.preset.startingOptions[axisKey] || [];
      const sel = list.find(o => o.id === choiceId);
      if (sel) parts.push(sel.name);
    }
    return parts.join(' · ');
  }

  /**
   * 检查是否完成主线（默认预设是 ch10_epilogue，但也兼容带 epilogue tag 的事件）
   * 在完成事件后调用，匹配则发布 game:mainQuestComplete 触发结算弹窗
   */
  _checkMainQuestComplete(justCompletedEventId) {
    if (!this.gameState || !justCompletedEventId) return;
    const cm = this.engine.getSystem('CardManager');
    const card = cm ? cm.getCard(justCompletedEventId) : null;
    if (!card) return;
    const tags = card.tags || [];
    const isEnding = tags.includes('ending') ||
      card.id === 'ch10_epilogue' ||
      this.gameState.variables?.game_complete === true;
    if (!isEnding) return;
    // 已经发过就不重发（防止反复触发）
    if (this._mainQuestCompleteFired) return;
    this._mainQuestCompleteFired = true;

    // Phase 23A — 元进度收尾：把这局发现的场景/事件/NPC/结局合并到全局元进度
    this._commitRunToMetaProgression(card.id).catch(e => console.warn('meta commit 失败:', e.message));

    // 1.2s 延迟，让 GM 的 ending 叙事先在面板里展示出来再弹结算
    setTimeout(() => {
      const stats = this._collectEndgameStats();
      const presetChoices = this._buildPresetChoices();
      this.eventSystem.publish('game:mainQuestComplete', {
        completedMainQuest: true,
        stats,
        presetChoices,
      });
    }, 1200);
  }

  /**
   * Phase 23A — 把本局成果合并到元进度（跨周目持久数据）
   */
  async _commitRunToMetaProgression(endingId) {
    if (!this.preset || !this.gameState) return;
    const presetId = this.preset.presetId;
    if (!presetId) return;

    // 收集发现的 NPC
    const knownNpcs = Object.entries(this.gameState.npcState || {})
      .filter(([, st]) => st && st.knownTo)
      .map(([id]) => id);

    await metaProgression.commitRun(presetId, {
      scenes: this.gameState.mapState?.visitedSceneIds || [],
      events: this.gameState.completedEventIds || [],
      npcs: knownNpcs,
      ending: endingId,
      completed: true,
      playTimeSeconds: this._sessionStartTime
        ? Math.round((Date.now() - this._sessionStartTime) / 1000)
        : 0,
    });
  }

  /**
   * 构建剧本库选项 — 默认主线 + 三个主题的随机场景图剧本
   * @returns {Array<{key, label, icon, description}>}
   */
  _buildPresetChoices() {
    const choices = [
      { key: 'dark_forest',  icon: '📖', label: '暗黑森林冒险',
        description: '默认主线剧本：10 章 + 12 场景节点，揭开暗黑森林的诅咒之谜。',
        sceneCount: 12, eventCount: 10 },
    ];
    // Phase 26E — 自动列出 presets/ 目录里所有打包的 JSON
    for (const [path, preset] of Object.entries(BUNDLED_PRESETS)) {
      if (!preset || !preset.presetId) continue;
      const sceneCount = (preset.scenes || []).length;
      const eventCount = (preset.events || []).length;
      choices.push({
        key: `bundled:${preset.presetId}`,
        icon: preset.icon || '📜',
        label: preset.name || preset.presetId,
        description: (preset.description ? preset.description.slice(0, 80) + (preset.description.length > 80 ? '…' : '') : '')
                     + ` (${sceneCount} 节点 / ${eventCount} 事件)`,
        sceneCount,
        eventCount,
        npcCount: (preset.npcs || []).length,
      });
    }
    for (const item of this.externalPresetIndex || []) {
      choices.push({
        key: item.key,
        icon: item.icon || '🌐',
        label: item.name || item.presetId || item.key,
        description: (item.description ? item.description.slice(0, 80) + (item.description.length > 80 ? '…' : '') : '外部生成剧本')
          + ` (${item.sceneCount || 0} 节点 / ${item.eventCount || 0} 事件)`,
        sceneCount: item.sceneCount || 0,
        eventCount: item.eventCount || 0,
        npcCount: item.npcCount || 0,
        externalPath: item.path,
      });
    }
    // 用户在 PresetStorage（IndexedDB）里保存过的预设（编辑器导入等）
    try {
      const saved = presetStorage.listSync();
      for (const p of saved) {
        // 已经被 BUNDLED_PRESETS 覆盖的（按 id 去重）跳过
        if (Object.values(BUNDLED_PRESETS).some(b => b?.presetId === p.id)) continue;
        choices.push({
          key: `saved:${p.id}`,
          icon: '💾',
          label: p.name || p.id,
          description: `${p.sceneCount || 0} 节点 / ${p.eventCount || 0} 事件（本地保存）`,
          sceneCount: p.sceneCount || 0,
          eventCount: p.eventCount || 0,
          saved: true,
        });
      }
    } catch (_) { /* */ }
    // 三个随机主题保留作为兜底
    choices.push(
      { key: 'random_forest', icon: '🌲', label: '随机：森林主题',
        description: '7 节点场景图小冒险，森林氛围，每次生成一段独特故事。', sceneCount: 7, eventCount: 7 },
      { key: 'random_desert', icon: '🏜', label: '随机：荒漠主题',
        description: '7 节点场景图小冒险，黄沙商队 + 法老陵墓。', sceneCount: 7, eventCount: 7 },
      { key: 'random_ruins',  icon: '🏚', label: '随机：废墟主题',
        description: '7 节点场景图小冒险，飞船坠落于异星废墟。', sceneCount: 7, eventCount: 7 },
    );
    return choices.map(choice => {
      const scale = classifyPresetScale(choice.sceneCount || 0, choice.eventCount || 0);
      return { ...choice, scaleId: scale.id, scaleLabel: scale.label, scaleIcon: scale.icon, scaleOrder: scale.order };
    }).sort((a, b) => (a.scaleOrder - b.scaleOrder) || String(a.label).localeCompare(String(b.label), 'zh-Hans-CN'));
  }

  /**
   * 根据剧本 key 解析出实际预设数据
   * @param {string} presetKey
   * @returns {object|null}
   */
  async _resolvePresetByKey(presetKey) {
    if (presetKey === 'dark_forest') return DEFAULT_PRESET;
    // Phase 26E — 项目自带预设 (bundled:<presetId>)
    if (presetKey.startsWith('bundled:')) {
      const id = presetKey.slice('bundled:'.length);
      const match = Object.values(BUNDLED_PRESETS).find(p => p && p.presetId === id);
      if (match) return JSON.parse(JSON.stringify(match));   // deep clone 防止被 mutate
      return null;
    }
    if (presetKey.startsWith('external:')) {
      const meta = (this.externalPresetIndex || []).find(p => p.key === presetKey);
      if (!meta?.path) return null;
      const res = await fetch(meta.path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`外部剧本加载失败 (${res.status})`);
      return await res.json();
    }
    // Phase 26E — PresetStorage 里用户保存过的
    if (presetKey.startsWith('saved:')) {
      const id = presetKey.slice('saved:'.length);
      return await presetStorage.load(id);
    }
    const baseLibrary = this.preset ? {
      characters: JSON.parse(JSON.stringify(this.preset.characters || [])),
      enemies: JSON.parse(JSON.stringify(this.preset.enemies || [])),
      items: JSON.parse(JSON.stringify(this.preset.items || [])),
    } : {};
    if (presetKey === 'random_forest')  return generateScenePreset({ theme: 'forest', baseLibrary });
    if (presetKey === 'random_desert')  return generateScenePreset({ theme: 'desert', baseLibrary });
    if (presetKey === 'random_ruins')   return generateScenePreset({ theme: 'ruins',  baseLibrary });
    return null;
  }
}

// ---- 启动应用 ----
const app = new TRPGApp();
app.init().catch(err => {
  console.error('应用启动失败:', err);
});

// 暴露到全局（方便调试）
window.__trpgApp = app;
