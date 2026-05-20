/**
 * 卡牌渲染器
 * 生成卡牌的HTML元素用于面板展示
 */

export class CardRenderer {
  /**
   * 渲染角色卡迷你卡片
   * @param {object} card - CharacterCard数据
   * @returns {HTMLElement}
   */
  static renderCharacterMini(card) {
    const el = document.createElement('div');
    el.className = 'card card--character';
    el.dataset.cardId = card.id;

    const hpPercent = card.stats.hp > 0 ? (card.stats.hpCurrent / card.stats.hp * 100) : 0;
    const mpPercent = card.stats.mp > 0 ? (card.stats.mpCurrent / card.stats.mp * 100) : 0;

    el.innerHTML = `
      <div class="card__image">
        ${card.image ? `<img src="${card.image}" alt="${card.name}">` : '角色图片'}
      </div>
      <div class="card__name">${card.name}</div>
      <div class="card__desc">${card.title || card.description}</div>
      <div class="stat-bar">
        <span class="stat-bar__label" style="color:var(--color-hp)">HP</span>
        <div class="stat-bar__track">
          <div class="stat-bar__fill" style="width:${hpPercent}%;background:var(--color-hp)"></div>
        </div>
        <span class="stat-bar__value">${card.stats.hpCurrent}/${card.stats.hp}</span>
      </div>
      <div class="stat-bar">
        <span class="stat-bar__label" style="color:var(--color-mp)">MP</span>
        <div class="stat-bar__track">
          <div class="stat-bar__fill" style="width:${mpPercent}%;background:var(--color-mp)"></div>
        </div>
        <span class="stat-bar__value">${card.stats.mpCurrent}/${card.stats.mp}</span>
      </div>
    `;

    return el;
  }

  /**
   * 渲染敌人卡迷你卡片
   * @param {object} card - EnemyCard数据
   * @returns {HTMLElement}
   */
  static renderEnemyMini(card) {
    const el = document.createElement('div');
    el.className = 'card card--enemy';
    el.dataset.cardId = card.id;

    const hpPercent = card.stats.hp > 0 ? (card.stats.hpCurrent / card.stats.hp * 100) : 0;
    const difficultyColors = { easy: '#22c55e', normal: '#3b82f6', hard: '#f97316', boss: '#ef4444' };
    const diffColor = difficultyColors[card.difficulty] || '#6b7280';

    el.innerHTML = `
      <div class="card__image">
        ${card.image ? `<img src="${card.image}" alt="${card.name}">` : '敌人图片'}
      </div>
      <div class="card__name">${card.name} <span style="color:${diffColor};font-size:11px">[${card.difficulty}]</span></div>
      <div class="stat-bar">
        <span class="stat-bar__label" style="color:var(--color-hp)">HP</span>
        <div class="stat-bar__track">
          <div class="stat-bar__fill" style="width:${hpPercent}%;background:var(--color-hp)"></div>
        </div>
        <span class="stat-bar__value">${card.stats.hpCurrent}/${card.stats.hp}</span>
      </div>
      <div class="card__desc">ATK:${card.stats.attack} DEF:${card.stats.defense} SPD:${card.stats.speed}</div>
    `;

    return el;
  }

  /**
   * 渲染道具卡迷你卡片
   * @param {object} card - ItemCard数据
   * @returns {HTMLElement}
   */
  static renderItemMini(card) {
    const el = document.createElement('div');
    el.className = 'card card--item';
    el.dataset.cardId = card.id;

    const mods = Object.entries(card.statModifiers || {})
      .map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`)
      .join(' ');

    el.innerHTML = `
      <div class="card__image card__image--small">
        ${card.image ? `<img src="${card.image}" alt="${card.name}">` : '道具'}
      </div>
      <div class="card__name">${card.name}</div>
      <div class="card__desc">${card.itemType} ${mods}</div>
    `;

    return el;
  }

  /**
   * 渲染事件卡（用于右面板）
   * @param {object} card - EventCard数据
   * @param {Function} onChoiceClick - 选项点击回调
   * @returns {HTMLElement}
   */
  static renderEventCard(card, onChoiceClick) {
    const el = document.createElement('div');
    el.className = 'event-card';

    let choicesHTML = '';
    if (card.choices && card.choices.length > 0) {
      choicesHTML = card.choices.map(choice => `
        <button class="btn btn--primary event-card__choice" data-choice-id="${choice.id}">
          ${choice.text}
        </button>
      `).join('');
    }

    el.innerHTML = `
      <div class="event-card__image">
        ${card.image ? `<img src="${card.image}" alt="${card.name}">` : '<div class="event-card__image-placeholder">事件图片</div>'}
      </div>
      <div class="event-card__type">${card.eventType}</div>
      <div class="event-card__name">${card.name}</div>
      <div class="event-card__desc">${card.description}</div>
      <div class="event-card__choices">${choicesHTML}</div>
    `;

    // 绑定选项点击
    if (onChoiceClick) {
      el.querySelectorAll('.event-card__choice').forEach(btn => {
        btn.addEventListener('click', () => {
          onChoiceClick(btn.dataset.choiceId);
        });
      });
    }

    return el;
  }

  /**
   * 渲染卡牌详情（用于模态框）
   * @param {object} card - 任意类型卡牌数据
   * @returns {HTMLElement}
   */
  static renderCardDetail(card) {
    const el = document.createElement('div');
    el.className = 'card-detail';

    let content = `
      <div class="card-detail__image">
        ${card.image ? `<img src="${card.image}" alt="${card.name}">` : '暂无图片'}
      </div>
      <h2 class="card-detail__name">${card.name}</h2>
      <p class="card-detail__type">${card.type} ${card.title || card.itemType || card.eventType || ''}</p>
      <p class="card-detail__desc">${card.description}</p>
    `;

    // 属性面板
    if (card.stats) {
      const statEntries = Object.entries(card.stats)
        .filter(([k]) => !k.endsWith('Current'))
        .map(([k, v]) => {
          const current = card.stats[k + 'Current'];
          return current !== undefined ? `<span>${k}: ${current}/${v}</span>` : `<span>${k}: ${v}</span>`;
        })
        .join('');
      content += `<div class="card-detail__stats">${statEntries}</div>`;
    }

    // 技能列表
    if (card.abilities && card.abilities.length > 0) {
      const abilitiesHTML = card.abilities.map(a =>
        `<div class="card-detail__ability"><strong>${a.name}</strong>: ${a.description}</div>`
      ).join('');
      content += `<div class="card-detail__abilities"><h3>技能</h3>${abilitiesHTML}</div>`;
    }

    // 标签
    if (card.tags && card.tags.length > 0) {
      content += `<div class="card-detail__tags">${card.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>`;
    }

    el.innerHTML = content;
    return el;
  }
}
