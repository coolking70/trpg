/**
 * 角色创建 Modal（Phase 19A）
 *
 * 当预设含 startingOptions（race/origin/background/faith 四轴）时，新游戏前弹出此 Modal
 * 让玩家从每轴选一个选项，最终把选择以 `{ race, origin, background, faith }` 形式发布。
 *
 * 事件流：
 *   - 'character:open' { presetData } → 弹窗
 *   - 'character:complete' { presetData, choices } → 关闭并继续 loadPreset
 *   - 'character:cancel' → 关闭，回到上一个 modal（通常是新游戏选择库）
 */

import './CharacterCreationModal.css';

const AXES = [
  { key: 'races',       label: '种族',  emoji: '🧬', state: 'race' },
  { key: 'origins',     label: '出身',  emoji: '🏛', state: 'origin' },
  { key: 'backgrounds', label: '背景',  emoji: '📜', state: 'background' },
  { key: 'faiths',      label: '信仰',  emoji: '☀',  state: 'faith' },
];

export class CharacterCreationModal {
  constructor(containerElement, eventSystem) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this._backdrop = null;
    this._presetData = null;
    this._choices = {};

    this._subIds = [];
    this._subIds.push({
      type: 'character:open',
      id: eventSystem.subscribe('character:open', (evt) => {
        this.show(evt.data?.presetData);
      }),
    });
  }

  show(presetData) {
    if (!presetData?.startingOptions) {
      // 没有 startingOptions 直接跳过角色创建
      this.eventSystem.publish('character:complete', { presetData, choices: null });
      return;
    }
    this.hide();
    this._presetData = presetData;
    this._choices = {};
    // 默认选每轴第一个
    for (const axis of AXES) {
      const list = presetData.startingOptions[axis.key] || [];
      if (list.length > 0) this._choices[axis.state] = list[0].id;
    }
    this._render();
  }

  _render() {
    this._backdrop = document.createElement('div');
    this._backdrop.className = 'modal-backdrop character-creation-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal character-creation-modal';

    // 头部
    const header = document.createElement('div');
    header.className = 'character-creation-modal__header';
    header.innerHTML = `
      <div class="character-creation-modal__emoji">🌟</div>
      <div class="character-creation-modal__title">塑造你的角色</div>
      <div class="character-creation-modal__subtitle">${this._presetData.name} — 不同的选择会带你走向不同的开端</div>
    `;
    modal.appendChild(header);

    // 四个 axis 选项
    const body = document.createElement('div');
    body.className = 'character-creation-modal__body';
    for (const axis of AXES) {
      const opts = (this._presetData.startingOptions[axis.key] || []);
      if (opts.length === 0) continue;
      body.appendChild(this._renderAxis(axis, opts));
    }
    modal.appendChild(body);

    // 当前选择摘要
    const summary = document.createElement('div');
    summary.className = 'character-creation-modal__summary';
    summary.id = 'cc-summary';
    modal.appendChild(summary);

    // 按钮
    const footer = document.createElement('div');
    footer.className = 'character-creation-modal__footer';

    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'btn btn--primary';
    btnConfirm.textContent = '🎬 开始冒险';
    btnConfirm.addEventListener('click', () => {
      this.eventSystem.publish('character:complete', {
        presetData: this._presetData,
        choices: this._choices,
      });
      this.hide();
    });
    footer.appendChild(btnConfirm);

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn--ghost';
    btnCancel.textContent = '取消';
    btnCancel.addEventListener('click', () => {
      this.eventSystem.publish('character:cancel');
      this.hide();
    });
    footer.appendChild(btnCancel);

    modal.appendChild(footer);

    this._backdrop.appendChild(modal);
    this.container.appendChild(this._backdrop);
    this.container.classList.add('active');

    this._refreshSummary();
  }

  _renderAxis(axis, opts) {
    const sec = document.createElement('div');
    sec.className = 'character-creation-modal__axis';
    sec.dataset.axis = axis.state;

    const title = document.createElement('div');
    title.className = 'character-creation-modal__axis-title';
    title.textContent = `${axis.emoji} ${axis.label}`;
    sec.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'character-creation-modal__axis-grid';
    for (const opt of opts) {
      const card = document.createElement('button');
      card.className = 'character-creation-modal__opt';
      card.dataset.id = opt.id;
      if (opt.id === this._choices[axis.state]) card.classList.add('active');

      const statBonus = opt.statBonus
        ? Object.entries(opt.statBonus).map(([k, v]) => `${k}${v >= 0 ? '+' : ''}${v}`).join(' ')
        : '';

      card.innerHTML = `
        <div class="character-creation-modal__opt-icon">${opt.icon || '◇'}</div>
        <div class="character-creation-modal__opt-name">${opt.name}</div>
        ${opt.description ? `<div class="character-creation-modal__opt-desc">${opt.description}</div>` : ''}
        ${statBonus ? `<div class="character-creation-modal__opt-bonus">${statBonus}</div>` : ''}
      `;
      card.addEventListener('click', () => {
        this._choices[axis.state] = opt.id;
        // 切高亮
        grid.querySelectorAll('.character-creation-modal__opt').forEach(el => el.classList.remove('active'));
        card.classList.add('active');
        this._refreshSummary();
      });
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    return sec;
  }

  _refreshSummary() {
    const el = document.getElementById('cc-summary');
    if (!el) return;
    const collectedTags = new Set();
    const parts = [];
    for (const axis of AXES) {
      const list = this._presetData.startingOptions[axis.key] || [];
      const sel = list.find(o => o.id === this._choices[axis.state]);
      if (sel) {
        parts.push(`<b>${sel.name}</b>`);
        (sel.tags || []).forEach(t => collectedTags.add(t));
      }
    }
    const tagPills = [...collectedTags].map(t => `<span class="character-creation-modal__tag">${t}</span>`).join('');
    el.innerHTML = `
      <div class="character-creation-modal__summary-line">${parts.join(' · ')}</div>
      ${tagPills ? `<div class="character-creation-modal__tag-row">${tagPills}</div>` : ''}
    `;
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
