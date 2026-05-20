/**
 * 存档管理模态框
 * 支持多槽位 + 自动槽 + 删除 + 命名
 * 由 toolbar:save / toolbar:load 事件唤起，根据 mode 进入不同视图
 */

import './SaveLoadModal.css';

/** 槽位定义：1 个自动槽 + 3 个手动槽 */
const SLOT_TEMPLATE = [
  { id: 'auto', defaultName: '自动存档', isAuto: true },
  { id: 'slot1', defaultName: '槽位 1', isAuto: false },
  { id: 'slot2', defaultName: '槽位 2', isAuto: false },
  { id: 'slot3', defaultName: '槽位 3', isAuto: false },
];

export class SaveLoadModal {
  constructor(containerElement, eventSystem) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this._backdrop = null;
    this.mode = 'save';  // 'save' | 'load'
  }

  /** 打开存档视图 */
  showSave() {
    this.mode = 'save';
    this._render();
  }

  /** 打开读档视图 */
  showLoad() {
    this.mode = 'load';
    this._render();
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

  _render() {
    this.hide();
    this._backdrop = document.createElement('div');
    this._backdrop.className = 'modal-backdrop';
    this._backdrop.addEventListener('click', (e) => {
      if (e.target === this._backdrop) this.hide();
    });

    const modal = document.createElement('div');
    modal.className = 'modal save-load-modal';

    // 头部
    const header = document.createElement('div');
    header.className = 'modal__header';
    header.innerHTML = `
      <span class="modal__title">${this.mode === 'save' ? '💾 保存游戏' : '📂 读取存档'}</span>
      <button class="modal__close">&times;</button>
    `;
    header.querySelector('.modal__close').addEventListener('click', () => this.hide());
    modal.appendChild(header);

    // 槽位列表
    const body = document.createElement('div');
    body.className = 'modal__body save-load-modal__body';

    // 读取索引
    const existingSlots = new Map();
    this.eventSystem.publish('save:requestSlots', { callback: (slots) => {
      for (const s of slots) existingSlots.set(s.id, s);
    }});

    for (const tmpl of SLOT_TEMPLATE) {
      const existing = existingSlots.get(tmpl.id);
      body.appendChild(this._renderSlotRow(tmpl, existing));
    }

    modal.appendChild(body);
    this._backdrop.appendChild(modal);
    this.container.appendChild(this._backdrop);
    this.container.classList.add('active');
  }

  _renderSlotRow(tmpl, existing) {
    const row = document.createElement('div');
    row.className = `save-slot${existing ? ' has-save' : ' empty'}${tmpl.isAuto ? ' auto-slot' : ''}`;

    if (existing) {
      const meta = existing.meta || {};
      const dt = existing.savedAt ? new Date(existing.savedAt).toLocaleString('zh-CN', { hour12: false }) : '';

      row.innerHTML = `
        <div class="save-slot__main">
          <div class="save-slot__name">${tmpl.isAuto ? '🔄 ' : ''}${existing.name || tmpl.defaultName}</div>
          <div class="save-slot__meta">
            <span>${dt}</span>
            <span>回合 ${meta.turnNumber || 1}</span>
            ${meta.lastChapter ? `<span>${meta.lastChapter}</span>` : ''}
            ${meta.gold !== undefined ? `<span>💰 ${meta.gold}</span>` : ''}
          </div>
          <div class="save-slot__party">${meta.partyHpSummary || ''}</div>
        </div>
        <div class="save-slot__actions"></div>
      `;
    } else {
      row.innerHTML = `
        <div class="save-slot__main">
          <div class="save-slot__name save-slot__name--empty">${tmpl.isAuto ? '🔄 ' : ''}${tmpl.defaultName}</div>
          <div class="save-slot__meta"><span>（空）</span></div>
        </div>
        <div class="save-slot__actions"></div>
      `;
    }

    const actions = row.querySelector('.save-slot__actions');

    if (this.mode === 'save') {
      if (!tmpl.isAuto) {
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn--primary';
        saveBtn.textContent = existing ? '覆盖保存' : '保存';
        saveBtn.addEventListener('click', () => {
          const name = existing ? existing.name : (prompt('存档名称', tmpl.defaultName) || tmpl.defaultName);
          if (!name) return;
          this.eventSystem.publish('save:requestSave', { slotId: tmpl.id, name });
          this.hide();
        });
        actions.appendChild(saveBtn);
      } else {
        const note = document.createElement('span');
        note.className = 'save-slot__note';
        note.textContent = '（自动写入）';
        actions.appendChild(note);
      }
    } else {
      if (existing) {
        const loadBtn = document.createElement('button');
        loadBtn.className = 'btn btn--primary';
        loadBtn.textContent = '读取';
        loadBtn.addEventListener('click', () => {
          this.eventSystem.publish('save:requestLoad', { slotId: tmpl.id });
          this.hide();
        });
        actions.appendChild(loadBtn);
      } else {
        const note = document.createElement('span');
        note.className = 'save-slot__note';
        note.textContent = '空槽位';
        actions.appendChild(note);
      }
    }

    // 删除按钮（任意模式，仅对存在的非 auto 槽显示）
    if (existing && !tmpl.isAuto) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn--danger save-slot__del';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        if (confirm(`确定删除"${existing.name}"？`)) {
          this.eventSystem.publish('save:requestDelete', { slotId: tmpl.id });
          this._render();  // 重新渲染
        }
      });
      actions.appendChild(delBtn);
    }

    return row;
  }

  destroy() {
    this.hide();
  }
}
