/**
 * 战斗结算模态框
 * 战斗结束后弹出，展示结果、经验、掉落
 * 订阅 combat:resultShown 事件
 */

import './CombatResultModal.css';

const RESULT_TEXT = {
  victory: { title: '胜利！', color: '#22c55e', emoji: '🏆' },
  defeat: { title: '失败...', color: '#ef4444', emoji: '💀' },
  flee: { title: '已撤退', color: '#a78bfa', emoji: '↩' },
};

export class CombatResultModal {
  constructor(containerElement, eventSystem) {
    this.container = containerElement;
    this.eventSystem = eventSystem;

    this._backdrop = null;

    this._subId = eventSystem.subscribe('combat:resultShown', (evt) => {
      this.show(evt.data);
    });
  }

  /**
   * 展示模态框
   * @param {{result, totalExp, expEach, loot}} data
   */
  show(data) {
    this.hide();

    const meta = RESULT_TEXT[data.result] || { title: '战斗结束', color: '#a0a0b8', emoji: '⚔' };

    this._backdrop = document.createElement('div');
    this._backdrop.className = 'modal-backdrop combat-result-backdrop';
    this._backdrop.addEventListener('click', (e) => {
      if (e.target === this._backdrop) this.hide();
    });

    const modal = document.createElement('div');
    modal.className = 'modal combat-result-modal';

    // 头部
    const header = document.createElement('div');
    header.className = 'combat-result-modal__header';
    header.innerHTML = `
      <div class="combat-result-modal__emoji">${meta.emoji}</div>
      <div class="combat-result-modal__title" style="color:${meta.color}">${meta.title}</div>
    `;
    modal.appendChild(header);

    // 内容
    const body = document.createElement('div');
    body.className = 'combat-result-modal__body';

    if (data.result === 'victory') {
      // 经验
      if (data.expEach > 0) {
        const expRow = document.createElement('div');
        expRow.className = 'combat-result-modal__row';
        expRow.innerHTML = `<span class="combat-result-modal__label">每位获得经验</span><span class="combat-result-modal__value">+${data.expEach} XP</span>`;
        body.appendChild(expRow);
      }

      // 掉落（loot 元素为 {id, name, image} 由发布方预解析）
      if (data.loot && data.loot.length > 0) {
        const lootLabel = document.createElement('div');
        lootLabel.className = 'combat-result-modal__label';
        lootLabel.textContent = '战利品';
        body.appendChild(lootLabel);

        const lootGrid = document.createElement('div');
        lootGrid.className = 'combat-result-modal__loot-grid';

        for (const lootItem of data.loot) {
          const lootEl = document.createElement('div');
          lootEl.className = 'combat-result-modal__loot-item';
          lootEl.innerHTML = `
            <div class="combat-result-modal__loot-icon">${lootItem.image ? `<img src="${lootItem.image}">` : '🎁'}</div>
            <div class="combat-result-modal__loot-name">${lootItem.name || lootItem.id}</div>
          `;
          lootGrid.appendChild(lootEl);
        }
        body.appendChild(lootGrid);
      }

      if ((!data.expEach || data.expEach === 0) && (!data.loot || data.loot.length === 0)) {
        const noReward = document.createElement('div');
        noReward.className = 'combat-result-modal__empty';
        noReward.textContent = '（无奖励）';
        body.appendChild(noReward);
      }
    } else if (data.result === 'defeat') {
      const msg = document.createElement('div');
      msg.className = 'combat-result-modal__empty';
      msg.textContent = '你倒在了战场上...';
      body.appendChild(msg);
    } else {
      const msg = document.createElement('div');
      msg.className = 'combat-result-modal__empty';
      msg.textContent = '你成功脱身，回到探索状态。';
      body.appendChild(msg);
    }

    modal.appendChild(body);

    // 底部按钮
    const footer = document.createElement('div');
    footer.className = 'combat-result-modal__footer';
    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn--primary';
    okBtn.textContent = '确认';
    okBtn.addEventListener('click', () => this.hide());
    footer.appendChild(okBtn);
    modal.appendChild(footer);

    this._backdrop.appendChild(modal);
    this.container.appendChild(this._backdrop);
    this.container.classList.add('active');
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
    if (this._subId) this.eventSystem.unsubscribe('combat:resultShown', this._subId);
    this.hide();
  }
}
