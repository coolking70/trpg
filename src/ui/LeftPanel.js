/**
 * 左面板
 * 显示角色卡、敌人卡和道具卡的标签页列表
 */

import { CardRenderer } from '../rendering/CardRenderer.js';

export class LeftPanel {
  constructor(containerElement, eventSystem, engine) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this.engine = engine;
    this.currentTab = 'characters'; // characters | enemies | items
    this.gameState = null;

    this._tabBar = null;
    this._cardList = null;
  }

  render() {
    this.container.innerHTML = '';

    // 标签栏
    this._tabBar = document.createElement('div');
    this._tabBar.className = 'tab-bar';

    const tabs = [
      { key: 'characters', label: '角色' },
      { key: 'enemies', label: '敌人' },
      { key: 'items', label: '道具' },
    ];

    tabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = `tab-item${tab.key === this.currentTab ? ' active' : ''}`;
      el.textContent = tab.label;
      el.dataset.tab = tab.key;
      el.addEventListener('click', () => this._switchTab(tab.key));
      this._tabBar.appendChild(el);
    });

    this.container.appendChild(this._tabBar);

    // 卡牌列表区域
    this._cardList = document.createElement('div');
    this._cardList.className = 'left-panel__list';
    this.container.appendChild(this._cardList);

    this._renderCards();
  }

  update(gameState) {
    this.gameState = gameState;
    this._renderCards();
  }

  _switchTab(tabKey) {
    this.currentTab = tabKey;
    // 更新标签高亮
    this._tabBar.querySelectorAll('.tab-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tabKey);
    });
    this._renderCards();
  }

  _renderCards() {
    if (!this._cardList) return;
    this._cardList.innerHTML = '';

    if (!this.gameState) {
      this._cardList.innerHTML = '<div class="left-panel__empty">暂无数据</div>';
      return;
    }

    let entries = [];
    if (this.currentTab === 'characters') {
      entries = (this.gameState.activeCharacters || []).map(card => ({ card }));
    } else if (this.currentTab === 'enemies') {
      const enemies = this.gameState.activeCombat ? this.gameState.activeCombat.enemies : [];
      entries = enemies.map(card => ({ card }));
    } else if (this.currentTab === 'items') {
      // 真实查询 CardManager + 保留持有者信息
      const cardManager = this.engine ? this.engine.getSystem('CardManager') : null;
      for (const char of (this.gameState.activeCharacters || [])) {
        for (const itemId of (char.inventory || [])) {
          const card = cardManager ? cardManager.getCard(itemId) : null;
          if (card) {
            entries.push({ card, ownerCharId: char.id, ownerName: char.name });
          } else {
            entries.push({
              card: { id: itemId, type: 'item', name: itemId, description: '未知道具', image: '', itemType: 'unknown', statModifiers: {} },
              ownerCharId: char.id,
              ownerName: char.name,
            });
          }
        }
      }
    }

    if (entries.length === 0) {
      this._cardList.innerHTML = '<div class="left-panel__empty">暂无卡牌</div>';
      return;
    }

    entries.forEach(entry => {
      const card = entry.card;
      let cardEl;
      if (this.currentTab === 'characters') {
        cardEl = CardRenderer.renderCharacterMini(card);
      } else if (this.currentTab === 'enemies') {
        cardEl = CardRenderer.renderEnemyMini(card);
      } else {
        cardEl = CardRenderer.renderItemMini(card);
        // 在道具上叠加持有者标签
        if (entry.ownerName) {
          const ownerTag = document.createElement('div');
          ownerTag.className = 'card__owner';
          ownerTag.textContent = `持有: ${entry.ownerName}`;
          cardEl.appendChild(ownerTag);
        }
      }

      cardEl.addEventListener('click', () => {
        // 发布带 owner 上下文的选择事件
        this.eventSystem.publish('ui:cardSelect', {
          ...card,
          _ownerCharId: entry.ownerCharId,
          _ownerName: entry.ownerName,
        });
      });

      this._cardList.appendChild(cardEl);
    });
  }

  destroy() {
    this.container.innerHTML = '';
  }
}
