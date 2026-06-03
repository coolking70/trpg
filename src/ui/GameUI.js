/**
 * 主UI协调器
 * 初始化所有面板组件，协调面板间通信，统一管理游戏状态分发
 */

import './GameUI.css';
import './ToolbarPanel.css';
import './LeftPanel.css';
import './RightPanel.css';
import './NarrativePanel.css';
import './DiceOverlay.css';
import './CardDetailModal.css';
import './SettingsModal.css';

import { ToolbarPanel } from './ToolbarPanel.js';
import { LeftPanel } from './LeftPanel.js';
import { RightPanel } from './RightPanel.js';
import { CombatPanel } from './CombatPanel.js';
import { LegionBattlePanel } from './LegionBattlePanel.js';
import { SkirmishPanel } from './SkirmishPanel.js';
import { CombatResultModal } from './CombatResultModal.js';
import { EndgameModal } from './EndgameModal.js';
import { CharacterCreationModal } from './CharacterCreationModal.js';
import { CampModal } from './CampModal.js';
import { CodexModal } from './CodexModal.js';
import { ToastManager } from './ToastManager.js';
import { QuestTracker } from './QuestTracker.js';
import { NarrativePanel } from './NarrativePanel.js';
import { DiceOverlay } from './DiceOverlay.js';
import { CardDetailModal } from './CardDetailModal.js';
import { SettingsModal } from './SettingsModal.js';
import { SaveLoadModal } from './SaveLoadModal.js';
import { PresetEditorModal } from './PresetEditorModal.js';

export class GameUI {
  /**
   * @param {HTMLElement} containerElement - #app 根容器
   * @param {object} eventSystem - 事件系统实例（提供 subscribe / publish）
   * @param {object} engine - GameEngine 实例，供子面板访问其他系统（CardManager 等）
   */
  constructor(containerElement, eventSystem, engine) {
    /** @type {HTMLElement} */
    this.container = containerElement;

    /** @type {object} */
    this.eventSystem = eventSystem;

    /** @type {object} */
    this.engine = engine;

    /** @type {object|null} 缓存的最新游戏状态 */
    this.lastGameState = null;

    /* ---- 获取 index.html 中已有的容器节点 ---- */
    this.toolbarEl = this.container.querySelector('#toolbar-panel');
    this.leftPanelEl = this.container.querySelector('#left-panel');
    this.rightPanelEl = this.container.querySelector('#right-panel');
    this.narrativeEl = this.container.querySelector('#narrative-panel');
    this.questTrackerEl = this.container.querySelector('#quest-tracker-slot');
    this.diceOverlayEl = this.container.querySelector('#dice-overlay');
    this.modalContainerEl = this.container.querySelector('#modal-container');

    /* ---- 子组件实例 ---- */
    this.toolbar = null;
    this.leftPanel = null;
    this.rightPanel = null;
    this.combatPanel = null;
    this.combatResultModal = null;
    this.narrativePanel = null;
    this.diceOverlay = null;
    this.cardDetailModal = null;
    this.settingsModal = null;
    this.saveLoadModal = null;
    this.presetEditorModal = null;

    /** @type {string[]} 事件订阅 ID 列表，销毁时清理 */
    this._subscriptionIds = [];

    this._init();
  }

  /* ========== 初始化 ========== */

  /** 初始化所有子面板并绑定事件 */
  _init() {
    /* 创建子组件 */
    this.toolbar = new ToolbarPanel(this.toolbarEl, this.eventSystem);
    this.leftPanel = new LeftPanel(this.leftPanelEl, this.eventSystem, this.engine);
    this.rightPanel = new RightPanel(this.rightPanelEl, this.eventSystem, this.engine);
    this.combatPanel = new CombatPanel(this.rightPanelEl, this.eventSystem, this.engine);
    this.legionPanel = new LegionBattlePanel(this.rightPanelEl, this.eventSystem, this.engine);
    this.skirmishPanel = new SkirmishPanel(this.rightPanelEl, this.eventSystem, this.engine);
    this.combatResultModal = new CombatResultModal(this.modalContainerEl, this.eventSystem);
    this.endgameModal = new EndgameModal(this.modalContainerEl, this.eventSystem);
    this.characterCreationModal = new CharacterCreationModal(this.modalContainerEl, this.eventSystem);
    this.campModal = new CampModal(this.modalContainerEl, this.eventSystem, this.engine);
    this.codexModal = new CodexModal(this.modalContainerEl, this.eventSystem, this.engine);
    // Toast 挂载在 body 级别，避免被面板裁切
    this.toastManager = new ToastManager(this.container, this.eventSystem);
    // QuestTracker 挂在叙事面板上方独立 slot（避免被 NarrativePanel.render 清空）
    this.questTracker = new QuestTracker(this.questTrackerEl, this.eventSystem, this.engine);
    this.narrativePanel = new NarrativePanel(this.narrativeEl, this.eventSystem);
    this.diceOverlay = new DiceOverlay(this.diceOverlayEl, this.eventSystem);
    this.cardDetailModal = new CardDetailModal(this.modalContainerEl, this.eventSystem);
    this.settingsModal = new SettingsModal(this.modalContainerEl, this.eventSystem);
    this.saveLoadModal = new SaveLoadModal(this.modalContainerEl, this.eventSystem);
    this.presetEditorModal = new PresetEditorModal(this.modalContainerEl, this.eventSystem);

    /* 订阅核心事件 */
    this._subscribe('game:stateChanged', (evt) => {
      this.update(evt.data.gameState);
    });

    this._subscribe('combat:start', (evt) => {
      this._onCombatStart(evt.data);
    });

    this._subscribe('legion:start', (evt) => {
      this._onLegionStart(evt.data);
    });
    this._subscribe('legion:end', (evt) => {
      this._onLegionEnd(evt.data);
    });

    this._subscribe('combat:end', (evt) => {
      this._onCombatEnd(evt.data);
    });

    this._subscribe('event:trigger', (evt) => {
      this._onEventTrigger(evt.data);
    });

    /* 骰子相关 */
    this._subscribe('dice:show', (evt) => {
      this.diceOverlay.show(evt.data);
    });

    this._subscribe('dice:hide', () => {
      this.diceOverlay.hide();
    });

    /* 卡牌详情模态框 */
    this._subscribe('ui:cardSelect', (evt) => {
      this.cardDetailModal.show(evt.data);
    });

    /* 设置模态框 */
    this._subscribe('ui:openSettings', () => {
      this.settingsModal.show();
    });

    /* 移动端抽屉切换（Phase 14） */
    this._subscribe('ui:toggleDrawer', (evt) => {
      this._toggleDrawer(evt.data.side);
    });

    /* 创建抽屉遮罩（点击关闭） */
    this._createDrawerBackdrop();

    /* 存档管理模态框 */
    this._subscribe('ui:openSaveModal', () => {
      this.saveLoadModal.showSave();
    });
    this._subscribe('ui:openLoadModal', () => {
      this.saveLoadModal.showLoad();
    });

    /* 预设编辑器 */
    this._subscribe('ui:openEditor', (evt) => {
      const initialPreset = evt.data && evt.data.preset;
      this.presetEditorModal.show(initialPreset);
    });

    /* 执行首次渲染 */
    this.render();
  }

  /* ========== 公共方法 ========== */

  /**
   * 渲染所有子面板
   */
  render() {
    this.toolbar.render();
    this.leftPanel.render();
    this.rightPanel.render();
    this.narrativePanel.render();
  }

  /**
   * 将游戏状态分发到所有子面板
   * 战斗中 RightPanel 让位给 CombatPanel
   * @param {object} gameState - 当前完整游戏状态
   */
  update(gameState) {
    this.lastGameState = gameState;
    this.toolbar.update(gameState);
    this.leftPanel.update(gameState);

    if (gameState && gameState.activeSkirmish) {
      this.skirmishPanel.show();
      this.skirmishPanel.update(gameState);
    } else if (gameState && gameState.activeLegionBattle) {
      this.legionPanel.update(gameState);
    } else if (gameState && gameState.activeCombat) {
      this.combatPanel.update(gameState);
    } else {
      this.skirmishPanel.hide();
      this.rightPanel.update(gameState);
    }
    this.narrativePanel.update(gameState);
  }

  /**
   * 销毁所有子面板并取消事件订阅
   */
  destroy() {
    /* 取消订阅 */
    this._subscriptionIds.forEach(({ type, id }) => {
      this.eventSystem.unsubscribe(type, id);
    });
    this._subscriptionIds = [];

    /* 销毁子组件 */
    this.toolbar.destroy();
    this.leftPanel.destroy();
    this.rightPanel.destroy();
    this.combatPanel.destroy();
    this.legionPanel.destroy();
    this.combatResultModal.destroy();
    if (this.endgameModal) this.endgameModal.destroy();
    if (this.characterCreationModal) this.characterCreationModal.destroy();
    if (this.campModal) this.campModal.destroy();
    if (this.codexModal) this.codexModal.destroy();
    this.toastManager.destroy();
    this.questTracker.destroy();
    this.narrativePanel.destroy();
    this.diceOverlay.destroy();
    this.cardDetailModal.destroy();
    this.settingsModal.destroy();
    this.saveLoadModal.destroy();
    this.presetEditorModal.destroy();
  }

  /* ========== 内部方法 ========== */

  /**
   * 便捷订阅方法，自动记录 ID 以便统一清理
   * @param {string} eventType
   * @param {Function} callback
   */
  _subscribe(eventType, callback) {
    const id = this.eventSystem.subscribe(eventType, callback);
    this._subscriptionIds.push({ type: eventType, id });
  }

  /** 战斗开始时切换 UI 状态（叙事面板的禁用由 _lockActions/_unlockActions 按行动者类型管理） */
  _onCombatStart(data) {
    this.container.classList.add('combat-mode');
    this.combatPanel.show();
    if (this.lastGameState) {
      this.update(this.lastGameState);
    }
  }

  /** 战斗结束时恢复 UI 状态 */
  _onCombatEnd(data) {
    this.container.classList.remove('combat-mode');
    this.combatPanel.hide();
    this.rightPanel.render();
    this.narrativePanel.setDisabled(false);
    if (this.lastGameState) {
      this.update(this.lastGameState);
    }
  }

  /** 军团战开始：RightPanel/CombatPanel 让位给 LegionBattlePanel */
  _onLegionStart(data) {
    this.container.classList.add('combat-mode');
    this.combatPanel.hide();
    this.legionPanel.show();
    if (this.lastGameState) this.update(this.lastGameState);
  }

  /** 军团战结束：恢复 RightPanel */
  _onLegionEnd(data) {
    this.container.classList.remove('combat-mode');
    this.legionPanel.hide();
    this.rightPanel.render();
    this.narrativePanel.setDisabled(false);
    if (this.lastGameState) this.update(this.lastGameState);
  }

  /** 事件触发时更新右面板 */
  _onEventTrigger(data) {
    this.rightPanel.setActiveEvent(data.event || data);
    // 移动端：触发新事件时自动打开右抽屉让玩家看到
    if (window.matchMedia('(max-width: 768px)').matches) {
      this._openDrawer('right');
    }
  }

  /** 创建抽屉遮罩（点击关闭抽屉） */
  _createDrawerBackdrop() {
    const main = this.container.querySelector('#main-content');
    if (!main || main.querySelector('.drawer-backdrop')) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'drawer-backdrop';
    backdrop.addEventListener('click', () => this._closeAllDrawers());
    main.appendChild(backdrop);
  }

  _toggleDrawer(side) {
    const cls = `drawer-${side}-open`;
    const other = side === 'left' ? 'drawer-right-open' : 'drawer-left-open';
    if (document.body.classList.contains(cls)) {
      document.body.classList.remove(cls);
    } else {
      document.body.classList.remove(other);
      document.body.classList.add(cls);
    }
  }

  _openDrawer(side) {
    const cls = `drawer-${side}-open`;
    const other = side === 'left' ? 'drawer-right-open' : 'drawer-left-open';
    document.body.classList.remove(other);
    document.body.classList.add(cls);
  }

  _closeAllDrawers() {
    document.body.classList.remove('drawer-left-open', 'drawer-right-open');
  }
}
