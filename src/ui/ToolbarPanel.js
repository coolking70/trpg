/**
 * 顶部工具栏面板
 * 包含导入、导出、设置、保存、读档、掷骰等按钮
 */

export class ToolbarPanel {
  /**
   * @param {HTMLElement} containerElement - #toolbar-panel 容器
   * @param {object} eventSystem - 事件系统
   */
  constructor(containerElement, eventSystem) {
    this.container = containerElement;
    this.eventSystem = eventSystem;

    /** 工具栏按钮定义 */
    this.buttons = [
      { id: 'import',   label: '导入', icon: '📥', event: 'toolbar:import' },
      { id: 'export',   label: '导出', icon: '📤', event: 'toolbar:export' },
      { id: 'save',     label: '保存', icon: '💾', event: 'toolbar:save' },
      { id: 'load',     label: '读档', icon: '📂', event: 'toolbar:load' },
      { id: 'editor',   label: '编辑器', icon: '📝', event: 'ui:openEditor' },
      { id: 'random',   label: '随机世界', icon: '🎲', event: 'toolbar:randomWorld' },
      { id: 'settings', label: '设置', icon: '⚙',  event: 'ui:openSettings' },
      { id: 'dice',     label: '掷骰', icon: '🎲', event: 'toolbar:rollDice' },
    ];

    /** @type {Map<string, HTMLButtonElement>} 按钮引用 */
    this._btnRefs = new Map();
  }

  /* ========== 公共方法 ========== */

  /** 渲染工具栏 */
  render() {
    this.container.innerHTML = '';

    /* 标题区域 */
    const title = document.createElement('div');
    title.className = 'toolbar__title';
    title.textContent = 'TRPG AI跑团';
    this.container.appendChild(title);

    /* 分隔线 */
    const sep = document.createElement('div');
    sep.className = 'toolbar__separator';
    this.container.appendChild(sep);

    /* 按钮组 */
    const btnGroup = document.createElement('div');
    btnGroup.className = 'toolbar__btn-group';

    this.buttons.forEach((def) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn--small toolbar__btn';
      btn.dataset.action = def.id;
      btn.title = def.label;
      btn.innerHTML = `<span class="toolbar__btn-icon">${def.icon}</span><span class="toolbar__btn-label">${def.label}</span>`;

      btn.addEventListener('click', () => {
        this.eventSystem.publish(def.event, { action: def.id });
      });

      this._btnRefs.set(def.id, btn);
      btnGroup.appendChild(btn);
    });

    this.container.appendChild(btnGroup);

    /* 右侧占位 */
    const spacer = document.createElement('div');
    spacer.className = 'toolbar__spacer';
    this.container.appendChild(spacer);

    /* 状态栏：金币 / 回合 / 当前章节 / 难度 */
    const statusBar = document.createElement('div');
    statusBar.className = 'toolbar__status';
    statusBar.innerHTML = `
      <span class="toolbar__status-item" data-key="gold" title="金币">💰 <span class="toolbar__status-value">0</span></span>
      <span class="toolbar__status-item" data-key="turn" title="回合">🔄 <span class="toolbar__status-value">1</span></span>
      <span class="toolbar__status-item" data-key="chapter" title="当前章节">📖 <span class="toolbar__status-value">序章</span></span>
      <span class="toolbar__status-item" data-key="difficulty" title="难度">⚔ <span class="toolbar__status-value">普通</span></span>
    `;
    this._statusBar = statusBar;
    this.container.appendChild(statusBar);
  }

  /**
   * 根据游戏状态更新按钮可用性 + 状态栏
   * @param {object} gameState
   */
  update(gameState) {
    /* 如果没有存档数据，禁用导出按钮 */
    const exportBtn = this._btnRefs.get('export');
    if (exportBtn) {
      exportBtn.disabled = !gameState;
    }

    if (!gameState || !this._statusBar) return;

    const setVal = (key, val) => {
      const el = this._statusBar.querySelector(`[data-key="${key}"] .toolbar__status-value`);
      if (!el) return;
      const newText = String(val);
      if (el.textContent !== newText) {
        el.textContent = newText;
        // 闪烁动画提示数值变化
        el.classList.remove('flash');
        // 触发 reflow 让动画重启
        void el.offsetWidth;
        el.classList.add('flash');
      }
    };

    setVal('gold', gameState.gold ?? 0);
    setVal('turn', gameState.turnNumber || 1);

    // 当前章节：最近完成的 ch* 事件
    const chapters = (gameState.completedEventIds || []).filter(id => /^ch\d+_/.test(id));
    const lastChapter = chapters[chapters.length - 1];
    if (lastChapter) {
      const chapterNum = lastChapter.match(/^ch(\d+)/)?.[1];
      setVal('chapter', chapterNum ? `第 ${chapterNum} 章` : '序章');
    } else {
      setVal('chapter', '序章');
    }

    // 难度：从 localStorage 读
    try {
      const cfg = JSON.parse(localStorage.getItem('trpg_ai_config') || '{}');
      const label = { easy: '简单', normal: '普通', hard: '困难' }[cfg.difficulty || 'normal'];
      setVal('difficulty', label);
    } catch (e) { /* 忽略 */ }
  }

  /** 销毁 */
  destroy() {
    this._btnRefs.clear();
    this.container.innerHTML = '';
  }
}
