/**
 * 主线结算 / 新游戏选择模态框
 *
 * 两种打开方式：
 *   1) 主线完成：展示统计 + 几个推进选项（再来一局 / 继续探索 / 清空存档）
 *   2) 工具栏"新游戏"：展示预设剧本选择库（默认主线 / 随机森林/荒漠/废墟）
 *
 * 订阅事件：
 *   - game:mainQuestComplete  { stats, presetChoices }
 *   - ui:openEndgame          { manual, stats, presetChoices }
 *
 * 发布事件：
 *   - game:newGame  { presetData?, clearAutoSave?, clearAllSlots? }
 */

import './EndgameModal.css';
import { AUTHORITY_LEVELS, DEFAULT_AUTHORITY } from '../systems/AIAuthority.js';

const AI_CONFIG_KEY = 'trpg_ai_config';

export class EndgameModal {
  constructor(containerElement, eventSystem) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this._backdrop = null;
    this._subIds = [];

    this._subIds.push({
      type: 'game:mainQuestComplete',
      id: eventSystem.subscribe('game:mainQuestComplete', (evt) => {
        this.show(evt.data || {});
      }),
    });
    this._subIds.push({
      type: 'ui:openEndgame',
      id: eventSystem.subscribe('ui:openEndgame', (evt) => {
        this.show(evt.data || { manual: true });
      }),
    });
  }

  /**
   * 展示结算窗口
   * @param {object} data
   *   { stats?, manual?, completedMainQuest? }
   *   stats: { chapters, maxChapters, level, turnNumber, gold, totalTokens, aiCalls, defeatedEnemies }
   */
  show(data = {}) {
    this.hide();
    const stats = data.stats || {};
    const isMainQuestComplete = !!data.completedMainQuest;
    const isManual = !!data.manual;
    const presetChoices = data.presetChoices || [];

    this._backdrop = document.createElement('div');
    this._backdrop.className = 'modal-backdrop endgame-backdrop';
    this._backdrop.addEventListener('click', (e) => {
      if (e.target === this._backdrop && !isMainQuestComplete) this.hide();
    });

    const modal = document.createElement('div');
    modal.className = 'modal endgame-modal';

    // 头部
    const header = document.createElement('div');
    header.className = 'endgame-modal__header';
    if (isMainQuestComplete) {
      // 根据 endingPath 显示不同的副标题（多结局支持）
      const endingPath = stats.endingPath;
      const endingMeta = {
        redeemed: { emoji: '✨', title: '救赎之黎明', subtitle: '诅咒散去，迷失的骑士也重归光明' },
        default:  { emoji: '🌅', title: '主线完成', subtitle: '三年的诅咒已被打破，黎明终于降临' },
      };
      const m = endingMeta[endingPath] || endingMeta.default;
      header.innerHTML = `
        <div class="endgame-modal__emoji">${m.emoji}</div>
        <div class="endgame-modal__title">${m.title}</div>
        <div class="endgame-modal__subtitle">${m.subtitle}</div>
      `;
    } else if (isManual) {
      header.innerHTML = `
        <div class="endgame-modal__emoji">🔄</div>
        <div class="endgame-modal__title">开启新冒险</div>
        <div class="endgame-modal__subtitle">所有当前进度将会被重置</div>
      `;
    } else {
      header.innerHTML = `
        <div class="endgame-modal__emoji">📜</div>
        <div class="endgame-modal__title">游戏结算</div>
      `;
    }
    modal.appendChild(header);

    // 统计板
    if (Object.keys(stats).length > 0) {
      const body = document.createElement('div');
      body.className = 'endgame-modal__body';

      const items = [
        { icon: '📖', label: '章节', value: `${stats.chapters ?? 0} / ${stats.maxChapters ?? 10}` },
        { icon: '⭐', label: '队伍等级', value: stats.level ? `Lv.${stats.level}` : '—' },
        { icon: '🔄', label: '总回合', value: stats.turnNumber ?? 0 },
        { icon: '💰', label: '剩余金币', value: stats.gold ?? 0 },
        { icon: '⚔', label: '战斗胜场', value: stats.victories ?? 0 },
        { icon: '🪙', label: 'AI Token', value: (stats.totalTokens || 0).toLocaleString() },
      ];

      const grid = document.createElement('div');
      grid.className = 'endgame-modal__grid';
      for (const it of items) {
        const cell = document.createElement('div');
        cell.className = 'endgame-modal__cell';
        cell.innerHTML = `
          <div class="endgame-modal__cell-icon">${it.icon}</div>
          <div class="endgame-modal__cell-label">${it.label}</div>
          <div class="endgame-modal__cell-value">${it.value}</div>
        `;
        grid.appendChild(cell);
      }
      body.appendChild(grid);
      modal.appendChild(body);
    }

    // 预设剧本选择库（手动新游戏 + 主线完成时都显示）
    if (presetChoices.length > 0) {
      const libBody = document.createElement('div');
      libBody.className = 'endgame-modal__body';
      const libLabel = document.createElement('div');
      libLabel.className = 'endgame-modal__lib-label';
      libLabel.textContent = isMainQuestComplete ? '🎬 开启下一段冒险' : '📚 选择你的剧本';
      libBody.appendChild(libLabel);

      // 🎚 AI 参与度滑条（新游戏时选择；与设置里的滑条共用持久化）
      const initAuth = this._readAuthority();
      const authWrap = document.createElement('div');
      authWrap.className = 'endgame-modal__authority';
      authWrap.innerHTML = `
        <label class="endgame-modal__authority-label">🎚 AI 参与度（主导度）</label>
        <input type="range" id="endgame-ai-authority" min="0" max="4" step="1" value="${initAuth}" style="width:100%">
        <div id="endgame-ai-authority-desc" class="endgame-modal__authority-desc">${this._authorityLabelHTML(initAuth)}</div>
        <div class="endgame-modal__authority-hint">越左 AI 越克制（仅氛围）｜越右越主导（高档可改写剧情/结局）。游戏中可随时在设置里调整。</div>
      `;
      libBody.appendChild(authWrap);
      const authSlider = authWrap.querySelector('#endgame-ai-authority');
      const authDesc = authWrap.querySelector('#endgame-ai-authority-desc');
      authSlider.addEventListener('input', () => {
        authDesc.innerHTML = this._authorityLabelHTML(parseInt(authSlider.value, 10) || 0);
      });

      const libGrid = document.createElement('div');
      libGrid.className = 'endgame-modal__lib-grid';
      const groups = new Map();
      for (const choice of presetChoices) {
        const groupKey = choice.scaleId || 'other';
        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            id: groupKey,
            label: choice.scaleLabel || '其他剧本',
            icon: choice.scaleIcon || '📜',
            order: choice.scaleOrder || 99,
            choices: [],
          });
        }
        groups.get(groupKey).choices.push(choice);
      }
      for (const group of [...groups.values()].sort((a, b) => a.order - b.order)) {
        const section = document.createElement('section');
        section.className = 'endgame-modal__lib-section';
        const heading = document.createElement('div');
        heading.className = 'endgame-modal__lib-section-title';
        heading.textContent = `${group.icon} ${group.label}`;
        section.appendChild(heading);

        const groupGrid = document.createElement('div');
        groupGrid.className = 'endgame-modal__lib-group-grid';
        for (const choice of group.choices) {
          const card = document.createElement('button');
          card.className = 'endgame-modal__lib-card';
          const sizeText = `${choice.sceneCount || 0} 节点 / ${choice.eventCount || 0} 事件`;
          card.innerHTML = `
            <div class="endgame-modal__lib-icon">${choice.icon || '📜'}</div>
            <div class="endgame-modal__lib-title">${choice.label}</div>
            <div class="endgame-modal__lib-meta">${sizeText}</div>
            <div class="endgame-modal__lib-desc">${choice.description || ''}</div>
          `;
          card.addEventListener('click', () => {
            // 新游戏选择的 AI 参与度：持久化进 config（loadPreset 会读它应用到新局）
            const lv = this._readSliderValue(libBody);
            this._persistAuthority(lv);
            // 让 main.js 实际去生成/获取预设数据
            this.eventSystem.publish('game:newGame', { presetKey: choice.key, aiAuthority: lv });
            this.hide();
          });
          groupGrid.appendChild(card);
        }
        section.appendChild(groupGrid);
        libGrid.appendChild(section);
      }
      libBody.appendChild(libGrid);
      modal.appendChild(libBody);
    }

    // 按钮区
    const footer = document.createElement('div');
    footer.className = 'endgame-modal__footer';

    const btnExport = document.createElement('button');
    btnExport.className = 'btn';
    btnExport.textContent = '📋 导出本局日志';
    btnExport.addEventListener('click', () => {
      this.eventSystem.publish('toolbar:exportLog');
    });
    footer.appendChild(btnExport);

    if (isMainQuestComplete) {
      const btnExplore = document.createElement('button');
      btnExplore.className = 'btn btn--ghost';
      btnExplore.textContent = '🗺 继续当前世界';
      btnExplore.addEventListener('click', () => this.hide());
      footer.appendChild(btnExplore);
    } else {
      const btnCancel = document.createElement('button');
      btnCancel.className = 'btn btn--ghost';
      btnCancel.textContent = '取消';
      btnCancel.addEventListener('click', () => this.hide());
      footer.appendChild(btnCancel);
    }

    const btnClearSave = document.createElement('button');
    btnClearSave.className = 'btn btn--danger';
    btnClearSave.textContent = '🗑 清空全部存档';
    btnClearSave.addEventListener('click', () => {
      if (confirm('确定要清空所有存档槽位和自动存档吗？此操作不可撤销。')) {
        this.eventSystem.publish('game:newGame', { clearAutoSave: true, clearAllSlots: true });
        this.hide();
      }
    });
    footer.appendChild(btnClearSave);

    modal.appendChild(footer);

    this._backdrop.appendChild(modal);
    this.container.appendChild(this._backdrop);
    this.container.classList.add('active');
  }

  /** 读取已持久化的 AI 参与度（缺失→默认） */
  _readAuthority() {
    try {
      const cfg = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || '{}');
      if (cfg.aiAuthority !== undefined && cfg.aiAuthority !== null) {
        return Math.max(0, Math.min(4, Math.round(Number(cfg.aiAuthority)) || 0));
      }
    } catch { /* */ }
    return DEFAULT_AUTHORITY;
  }

  /** 把选择的参与度写回持久化 config（与设置滑条共用同一存储） */
  _persistAuthority(level) {
    try {
      const cfg = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || '{}');
      cfg.aiAuthority = Math.max(0, Math.min(4, Math.round(Number(level)) || 0));
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(cfg));
    } catch { /* localStorage 不可用则忽略，payload 里仍带值 */ }
  }

  _readSliderValue(root) {
    const el = root && root.querySelector('#endgame-ai-authority');
    return el ? Math.max(0, Math.min(4, parseInt(el.value, 10) || 0)) : this._readAuthority();
  }

  _authorityLabelHTML(level) {
    const lv = Math.max(0, Math.min(4, Math.round(Number(level)) || 0));
    const meta = AUTHORITY_LEVELS[lv] || AUTHORITY_LEVELS[DEFAULT_AUTHORITY];
    return `<b>L${lv} ${meta.name}</b> — ${meta.blurb}`;
  }

  hide() {
    if (this._backdrop) {
      this._backdrop.remove();
      this._backdrop = null;
    }
    if (this.container.children.length === 0) {
      this.container.classList.remove('active');
    }
  }

  destroy() {
    for (const { type, id } of this._subIds) this.eventSystem.unsubscribe(type, id);
    this._subIds = [];
    this.hide();
  }
}
