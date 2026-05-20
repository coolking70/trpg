/**
 * 卡牌详情模态框
 * 点击卡牌时弹出的详细信息面板
 */

import { CardRenderer } from '../rendering/CardRenderer.js';

export class CardDetailModal {
  constructor(containerElement, eventSystem) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this._backdrop = null;
  }

  /**
   * 显示卡牌详情
   * @param {object} card - 任意类型卡牌数据
   */
  show(card) {
    this.hide();

    this._backdrop = document.createElement('div');
    this._backdrop.className = 'modal-backdrop';
    this._backdrop.addEventListener('click', (e) => {
      if (e.target === this._backdrop) this.hide();
    });

    const modal = document.createElement('div');
    modal.className = 'modal';

    // 头部
    const header = document.createElement('div');
    header.className = 'modal__header';
    header.innerHTML = `
      <span class="modal__title">卡牌详情</span>
      <button class="modal__close">&times;</button>
    `;
    header.querySelector('.modal__close').addEventListener('click', () => this.hide());
    modal.appendChild(header);

    // 内容
    const body = document.createElement('div');
    body.className = 'modal__body';
    body.appendChild(CardRenderer.renderCardDetail(card));
    modal.appendChild(body);

    // 可用操作
    if (card.type === 'item' && card._ownerCharId) {
      const footer = document.createElement('div');
      footer.className = 'modal__footer';

      // 消耗品 → 使用
      if (card.consumeEffect) {
        const useBtn = document.createElement('button');
        useBtn.className = 'btn btn--primary';
        useBtn.textContent = '使用';
        useBtn.addEventListener('click', () => {
          this.eventSystem.publish('item:useRequest', {
            itemId: card.id,
            ownerCharId: card._ownerCharId,
            targetCharId: card._ownerCharId,
          });
          this.hide();
        });
        footer.appendChild(useBtn);
      }

      // 可装备道具 → 装备
      if (card.equipSlot) {
        const equipBtn = document.createElement('button');
        equipBtn.className = 'btn btn--primary';
        equipBtn.textContent = `装备到 ${this._slotLabel(card.equipSlot)}`;
        equipBtn.addEventListener('click', () => {
          this.eventSystem.publish('item:equipRequest', {
            itemId: card.id,
            ownerCharId: card._ownerCharId,
          });
          this.hide();
        });
        footer.appendChild(equipBtn);
      }

      if (footer.children.length > 0) modal.appendChild(footer);
    }

    this._backdrop.appendChild(modal);
    this.container.appendChild(this._backdrop);
    this.container.classList.add('active');
  }

  /** 隐藏模态框 */
  hide() {
    if (this._backdrop) {
      this._backdrop.remove();
      this._backdrop = null;
    }
    // 仅当没有其他模态框时取消active
    if (this.container.children.length === 0) {
      this.container.classList.remove('active');
    }
  }

  _slotLabel(slot) {
    return { weapon: '武器', armor: '护甲', accessory: '饰品' }[slot] || slot;
  }

  destroy() {
    this.hide();
  }
}
