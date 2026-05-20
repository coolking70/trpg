/**
 * 右面板
 * 显示当前活跃的事件卡或地形事件卡及其选项
 */

import { CardRenderer } from '../rendering/CardRenderer.js';

export class RightPanel {
  constructor(containerElement, eventSystem, engine) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this.engine = engine;
    this.activeEvent = null;
    this.gameState = null;

    /** @type {boolean} 当前是否为地形卡 */
    this._isTerrainCard = false;

    /** @type {Function|null} 地形卡选项的自定义回调 */
    this._customChoiceCallback = null;

    /** @type {HTMLElement|null} */
    this._contentArea = null;
  }

  render() {
    this.container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'right-panel__header';
    header.textContent = '当前事件';
    this.container.appendChild(header);

    this._contentArea = document.createElement('div');
    this._contentArea.className = 'right-panel__content';
    this.container.appendChild(this._contentArea);

    this._renderEvent();
  }

  update(gameState) {
    this.gameState = gameState;
    if (gameState && gameState.activeEvent) {
      this.activeEvent = gameState.activeEvent;
      this._isTerrainCard = false;
      this._customChoiceCallback = null;
    }
    this._renderEvent();
  }

  /**
   * 设置当前活跃事件（普通事件卡）
   * @param {object} eventCard - 事件卡数据
   */
  setActiveEvent(eventCard) {
    this.activeEvent = eventCard;
    this._isTerrainCard = false;
    this._customChoiceCallback = null;
    this._renderEvent();
  }

  /**
   * 设置地形事件卡（带自定义选项回调）
   * @param {object} terrainCard - 地形事件卡数据
   * @param {Function} onChoiceClick - 选项点击回调(choiceId)
   */
  setTerrainEvent(terrainCard, onChoiceClick) {
    this.activeEvent = terrainCard;
    this._isTerrainCard = true;
    this._customChoiceCallback = onChoiceClick;
    this._renderEvent();
  }

  /** 清除当前事件，恢复占位符 */
  clearEvent() {
    this.activeEvent = null;
    this._isTerrainCard = false;
    this._customChoiceCallback = null;
    this._renderEvent();
  }

  /**
   * 设置所有选项按钮的禁用状态
   * @param {boolean} disabled
   */
  setDisabled(disabled) {
    if (!this._contentArea) return;
    const buttons = this._contentArea.querySelectorAll('.event-card__choice');
    buttons.forEach(btn => {
      btn.disabled = disabled;
    });
  }

  _renderEvent() {
    if (!this._contentArea) return;
    this._contentArea.innerHTML = '';

    if (!this.activeEvent) {
      this._contentArea.innerHTML = `
        <div class="right-panel__placeholder">
          <div class="right-panel__placeholder-icon">📜</div>
          <div class="right-panel__placeholder-text">探索地图以触发事件</div>
        </div>
      `;
      return;
    }

    // 商店事件 → 渲染商店 UI 而非普通事件卡
    if (this.activeEvent.shop) {
      this._renderShop();
      return;
    }

    // 选择回调：地形卡用自定义回调，普通事件卡用event:choice事件
    const choiceCallback = this._isTerrainCard && this._customChoiceCallback
      ? this._customChoiceCallback
      : (choiceId) => {
          this.eventSystem.publish('event:choice', {
            eventId: this.activeEvent.id,
            choiceId,
          });
        };

    const eventEl = CardRenderer.renderEventCard(this.activeEvent, choiceCallback);

    // 地形卡添加特殊样式类
    if (this._isTerrainCard) {
      eventEl.classList.add('event-card--terrain');
    }

    this._contentArea.appendChild(eventEl);
  }

  /** 渲染商店 UI */
  _renderShop() {
    const event = this.activeEvent;
    const shop = event.shop;
    const cardManager = this.engine ? this.engine.getSystem('CardManager') : null;
    const gold = this.gameState ? (this.gameState.gold || 0) : 0;

    const root = document.createElement('div');
    root.className = 'shop-view';

    // 头部：商店名 + 金币
    root.innerHTML = `
      <div class="shop-view__header">
        <span class="shop-view__name">🛒 ${event.name}</span>
        <span class="shop-view__gold">💰 ${gold}</span>
      </div>
      <div class="shop-view__desc">${event.description || ''}</div>
    `;

    // 商品列表
    const list = document.createElement('div');
    list.className = 'shop-view__items';
    for (const entry of shop.inventory) {
      const itemCard = cardManager ? cardManager.getCard(entry.itemId) : null;
      const itemName = itemCard ? itemCard.name : entry.itemId;
      const itemDesc = itemCard ? itemCard.description : '';
      const soldOut = entry.stock !== undefined && entry.stock <= 0;
      const cantAfford = gold < entry.price;

      const row = document.createElement('div');
      row.className = `shop-item${soldOut ? ' sold-out' : ''}`;
      row.innerHTML = `
        <div class="shop-item__main">
          <div class="shop-item__name">${itemName}</div>
          <div class="shop-item__desc">${itemDesc}</div>
        </div>
        <div class="shop-item__buy">
          <div class="shop-item__price">${entry.price} 💰</div>
          <div class="shop-item__stock">${entry.stock !== undefined ? `存货 ${entry.stock}` : '无限'}</div>
        </div>
      `;

      const buyBtn = document.createElement('button');
      buyBtn.className = 'btn btn--primary shop-item__btn';
      buyBtn.textContent = soldOut ? '售罄' : '购买';
      buyBtn.disabled = soldOut || cantAfford;
      if (cantAfford && !soldOut) buyBtn.title = '金币不足';
      buyBtn.addEventListener('click', () => {
        this.eventSystem.publish('shop:buyRequest', { itemId: entry.itemId });
      });
      row.appendChild(buyBtn);
      list.appendChild(row);
    }
    root.appendChild(list);

    // 离开商店按钮
    const leaveBtn = document.createElement('button');
    leaveBtn.className = 'btn shop-view__leave';
    leaveBtn.textContent = '离开商店';
    leaveBtn.addEventListener('click', () => {
      // 商店事件标记为完成（避免重复触发），清掉 activeEvent
      this.eventSystem.publish('shop:close', { eventId: event.id });
    });
    root.appendChild(leaveBtn);

    this._contentArea.appendChild(root);
  }

  destroy() {
    this.container.innerHTML = '';
  }
}
