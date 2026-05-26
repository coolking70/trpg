/**
 * 战斗面板
 * 战斗期间替代 RightPanel 显示，提供攻击/技能/逃跑/目标选择等操作
 * 发布 combat:playerAction 事件交由 main.js 调用 CombatSystem
 */

import './CombatPanel.css';

export class CombatPanel {
  constructor(containerElement, eventSystem, engine = null) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this.engine = engine;
    this.gameState = null;

    /** @type {string|null} 待选目标的行动类型: 'attack' | 'ability:<id>' | null */
    this.pendingActionType = null;

    /** @type {boolean} 是否显示物品菜单 */
    this._showItemMenu = false;

    /** @type {boolean} 是否处于显示状态 */
    this._visible = false;

    /** @type {HTMLElement|null} */
    this._root = null;
  }

  /** 显示面板（实际渲染在拿到 gameState 后进行） */
  show() {
    this._visible = true;
    if (this.gameState && this.gameState.activeCombat) {
      this._render();
    }
  }

  /** 隐藏面板并清空 DOM */
  hide() {
    this._visible = false;
    this.pendingActionType = null;
    if (this._root && this._root.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._root = null;
    this.container.innerHTML = '';
  }

  /** 由 GameUI 在 game:stateChanged 时调用 */
  update(gameState) {
    this.gameState = gameState;
    if (!this._visible) return;
    if (!gameState || !gameState.activeCombat) {
      this.hide();
      return;
    }
    this._render();
  }

  /** 锁定/解锁所有按钮（AI 处理或敌人回合期间） */
  setDisabled(disabled) {
    if (!this._root) return;
    this._root.querySelectorAll('button, .combat-panel__enemy-card.selectable')
      .forEach(el => {
        if (el.tagName === 'BUTTON') {
          el.disabled = disabled;
        } else {
          el.classList.toggle('disabled', disabled);
        }
      });
  }

  _render() {
    // 清空容器并重建
    this.container.innerHTML = '';
    this._root = document.createElement('div');
    this._root.className = 'combat-panel';

    const combat = this.gameState.activeCombat;
    if (!combat) return;

    // 顶部标题 + 回合
    const header = document.createElement('div');
    header.className = 'combat-panel__header';
    header.innerHTML = `
      <span class="combat-panel__title">⚔ 战斗</span>
      <span class="combat-panel__round">第 ${combat.round} 回合</span>
    `;
    this._root.appendChild(header);

    // 先攻顺序
    this._root.appendChild(this._renderTurnOrder(combat));

    // 敌人列表
    this._root.appendChild(this._renderEnemiesList(combat));

    // 当前行动者：turnOrder 条目只有 id/name/type，实体数据需要从 gameState 查找
    const currentSlot = combat.turnOrder[combat.currentActorIndex];
    if (currentSlot) {
      const entity = this._findEntity(currentSlot.id);

      // 玩家主角 = activeCharacters[0]
      const isPlayerHero = currentSlot.type === 'character'
        && this.gameState.activeCharacters[0]?.id === currentSlot.id;
      const isAIAlly = currentSlot.type === 'character' && !isPlayerHero;

      const info = document.createElement('div');
      info.className = `combat-panel__current combat-panel__current--${currentSlot.type}`;
      const tag = isAIAlly ? ' <span class="combat-panel__ai-tag">🤖 AI</span>' : '';
      info.innerHTML = `<strong>${currentSlot.name}</strong> 的回合${tag}`;
      this._root.appendChild(info);

      if (isPlayerHero && entity) {
        if (this.pendingActionType) {
          this._root.appendChild(this._renderTargetSelector());
        } else {
          this._root.appendChild(this._renderActionButtons(entity));
        }
      } else {
        const waitEl = document.createElement('div');
        waitEl.className = 'combat-panel__waiting';
        waitEl.textContent = isAIAlly ? `${currentSlot.name} 决策中...` : '敌人行动中...';
        this._root.appendChild(waitEl);
      }
    }

    this.container.appendChild(this._root);
  }

  _renderTurnOrder(combat) {
    const bar = document.createElement('div');
    bar.className = 'combat-panel__turn-order';

    combat.turnOrder.forEach((p, idx) => {
      const slot = document.createElement('div');
      slot.className = `combat-panel__turn-slot combat-panel__turn-slot--${p.type}`;
      if (idx === combat.currentActorIndex) slot.classList.add('active');

      const entity = this._findEntity(p.id);
      if (entity && entity.stats.hpCurrent <= 0) {
        slot.classList.add('dead');
      }

      slot.title = `${p.name} (先攻 ${p.initiative})`;
      slot.textContent = p.name.substring(0, 2);
      bar.appendChild(slot);
    });

    return bar;
  }

  _renderEnemiesList(combat) {
    const list = document.createElement('div');
    list.className = 'combat-panel__enemies';

    for (const enemy of combat.enemies) {
      const card = document.createElement('div');
      const defeated = enemy.stats.hpCurrent <= 0;
      card.className = `combat-panel__enemy-card${defeated ? ' defeated' : ''}`;

      const hpPct = enemy.stats.hp > 0
        ? Math.max(0, (enemy.stats.hpCurrent / enemy.stats.hp) * 100)
        : 0;

      card.innerHTML = `
        <div class="combat-panel__enemy-name">${enemy.name}</div>
        <div class="combat-panel__enemy-hp">
          <div class="combat-panel__enemy-hp-fill" style="width:${hpPct}%"></div>
          <span class="combat-panel__enemy-hp-text">${enemy.stats.hpCurrent}/${enemy.stats.hp}</span>
        </div>
      `;

      // 目标选择模式下，活着的敌人可点击
      if (this.pendingActionType && !defeated) {
        card.classList.add('selectable');
        card.addEventListener('click', () => this._selectTarget(enemy.id));
      }

      list.appendChild(card);
    }

    return list;
  }

  _renderActionButtons(actor) {
    const bar = document.createElement('div');
    bar.className = 'combat-panel__actions';

    // 攻击
    bar.appendChild(this._makeButton('⚔ 攻击', 'btn--primary', () => {
      this.pendingActionType = 'attack';
      this._render();
    }));

    // 技能
    for (const ability of (actor.abilities || [])) {
      const mpCost = (ability.cost && ability.cost.mp) || 0;
      const enough = actor.stats.mpCurrent >= mpCost;
      const label = `✦ ${ability.name}${mpCost > 0 ? ` (${mpCost}MP)` : ''}`;
      const btn = this._makeButton(label, '', () => {
        this.pendingActionType = `ability:${ability.id}`;
        this._render();
      });
      if (!enough) btn.disabled = true;
      btn.title = ability.description || '';
      bar.appendChild(btn);
    }

    // 使用道具（消耗品）
    const usableItems = this._getUsableItems(actor);
    if (usableItems.length > 0) {
      const itemBtn = this._makeButton(`🧪 使用道具 (${usableItems.length})`, '', () => {
        this._showItemMenu = !this._showItemMenu;
        this._render();
      });
      bar.appendChild(itemBtn);
    }

    // 逃跑
    bar.appendChild(this._makeButton('↩ 逃跑', 'btn--danger', () => {
      this.eventSystem.publish('combat:playerAction', {
        actionType: 'flee',
        actorId: actor.id,
      });
    }));

    // 物品菜单（展开时）
    if (this._showItemMenu && usableItems.length > 0) {
      const menu = document.createElement('div');
      menu.className = 'combat-panel__item-menu';
      for (const u of usableItems) {
        const btn = this._makeButton(`${u.icon || '🧪'} ${u.name} [${u.ownerName} 持有]`, '', () => {
          this.eventSystem.publish('combat:playerAction', {
            actionType: 'use_item',
            actorId: actor.id,
            itemId: u.itemId,
            ownerCharId: u.ownerId,
            targetCharId: actor.id,
          });
          this._showItemMenu = false;
        });
        btn.title = u.description || '';
        menu.appendChild(btn);
      }
      bar.appendChild(menu);
    }

    return bar;
  }

  /** 取队伍中所有可用的消耗品（含 owner 上下文） */
  _getUsableItems(actor) {
    const out = [];
    if (!this.gameState || !this.engine) return out;
    const cm = this.engine.getSystem('CardManager');
    if (!cm) return out;
    for (const c of (this.gameState.activeCharacters || [])) {
      for (const iid of (c.inventory || [])) {
        const card = cm.getCard(iid);
        if (!card || card.type !== 'item') continue;
        if (!card.consumeEffect) continue;
        out.push({
          itemId: card.id, name: card.name, icon: card.icon,
          description: card.description,
          ownerId: c.id, ownerName: c.name,
        });
      }
    }
    return out;
  }

  _renderTargetSelector() {
    const bar = document.createElement('div');
    bar.className = 'combat-panel__target-prompt';

    const label = this.pendingActionType === 'attack' ? '选择攻击目标' : '选择技能目标';
    const hint = document.createElement('div');
    hint.className = 'combat-panel__hint';
    hint.textContent = `→ ${label}（点击上方敌人）`;
    bar.appendChild(hint);

    bar.appendChild(this._makeButton('取消', '', () => {
      this.pendingActionType = null;
      this._render();
    }));

    return bar;
  }

  _selectTarget(targetId) {
    if (!this.pendingActionType) return;
    const combat = this.gameState && this.gameState.activeCombat;
    if (!combat) return;

    const actor = combat.turnOrder[combat.currentActorIndex];
    if (!actor || actor.type !== 'character') return;

    let payload;
    if (this.pendingActionType === 'attack') {
      payload = { actionType: 'attack', actorId: actor.id, targetId };
    } else if (this.pendingActionType.startsWith('ability:')) {
      const abilityId = this.pendingActionType.slice('ability:'.length);
      payload = { actionType: 'ability', actorId: actor.id, abilityId, targetId };
    } else {
      return;
    }

    this.pendingActionType = null;
    this.eventSystem.publish('combat:playerAction', payload);
  }

  _findEntity(id) {
    if (!this.gameState) return null;
    const char = (this.gameState.activeCharacters || []).find(c => c.id === id);
    if (char) return char;
    const combat = this.gameState.activeCombat;
    if (combat) {
      const enemy = combat.enemies.find(e => e.id === id);
      if (enemy) return enemy;
    }
    return null;
  }

  _makeButton(label, extraClass, onClick) {
    const btn = document.createElement('button');
    btn.className = `btn combat-panel__btn ${extraClass}`.trim();
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  destroy() {
    this.hide();
  }
}
