/**
 * 主线进度追踪器
 * 在叙事面板上方显示：主线 X/Y 章 + 下一定点建议
 *
 * 主线事件 = events 中 tag 包含 'main' 的事件
 */

import './QuestTracker.css';

export class QuestTracker {
  constructor(containerElement, eventSystem, engine) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this.engine = engine;

    this._root = null;
    this._subIds = [];

    this._render();

    // 在游戏状态变化时刷新
    this._subscribe('game:stateChanged', (evt) => {
      this._update(evt.data.gameState);
    });
  }

  _subscribe(eventType, callback) {
    const id = this.eventSystem.subscribe(eventType, callback);
    this._subIds.push({ type: eventType, id });
  }

  _render() {
    this._root = document.createElement('div');
    this._root.className = 'quest-tracker';
    this._root.innerHTML = `
      <div class="quest-tracker__progress">
        <span class="quest-tracker__label">主线</span>
        <span class="quest-tracker__count">- / -</span>
        <div class="quest-tracker__bar"><div class="quest-tracker__bar-fill"></div></div>
      </div>
      <div class="quest-tracker__hint"></div>
    `;
    this.container.appendChild(this._root);
  }

  _update(gameState) {
    if (!this._root || !gameState) return;

    const cardManager = this.engine.getSystem('CardManager');
    const triggerEngine = this.engine.getSystem('EventTriggerEngine');
    if (!cardManager) return;

    // 找所有 main 标签事件
    const allEvents = cardManager.getCardsByType('event');
    const mainEvents = allEvents.filter(e => (e.tags || []).includes('main'));
    if (mainEvents.length === 0) {
      this._root.style.display = 'none';
      return;
    }
    this._root.style.display = '';

    // 完成度
    const completedSet = new Set(gameState.completedEventIds);
    const doneCount = mainEvents.filter(e => completedSet.has(e.id)).length;
    const total = mainEvents.length;
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

    this._root.querySelector('.quest-tracker__count').textContent = `${doneCount} / ${total}`;
    this._root.querySelector('.quest-tracker__bar-fill').style.width = pct + '%';

    // 下一定点：未完成的 main 事件中，已经"基本可达"的（条件接近满足）
    const hint = this._computeNextStepHint(gameState, mainEvents, completedSet, triggerEngine);
    const hintEl = this._root.querySelector('.quest-tracker__hint');
    if (hint) {
      hintEl.style.display = '';
      hintEl.innerHTML = `<span class="quest-tracker__hint-icon">💡</span>${hint}`;
    } else {
      hintEl.style.display = 'none';
    }
  }

  /**
   * 找一个最可能是"下一步"的事件，给出建议
   * 策略：未完成 + 静态条件（变量/前置事件）已满足 + 只差空间条件
   */
  _computeNextStepHint(gameState, mainEvents, completedSet, triggerEngine) {
    if (!triggerEngine) return null;
    const mapData = this.engine.getSystem('MapSystem')?.getMapData();

    // 找未完成的主线事件
    const candidates = mainEvents.filter(e => !completedSet.has(e.id));
    if (candidates.length === 0) {
      return '主线已完成，你可以继续探索或重新开始一段冒险。';
    }

    // 按 tag 中的 chapterN 数字升序排（剧情顺序）
    // 若无 chapter 标签则降级用 priority 升序，再降级 ID 字典序
    const chapterNum = (e) => {
      const tag = (e.tags || []).find(t => /^chapter\d+$/.test(t));
      return tag ? parseInt(tag.replace('chapter', ''), 10) : 9999;
    };
    candidates.sort((a, b) => {
      const ca = chapterNum(a), cb = chapterNum(b);
      if (ca !== cb) return ca - cb;
      const pa = a.priority || 0, pb = b.priority || 0;
      if (pa !== pb) return pa - pb;
      return String(a.id).localeCompare(String(b.id));
    });

    for (const ev of candidates) {
      const trigger = ev.trigger;
      if (!trigger || !trigger.condition) continue;
      const cond = trigger.condition;

      // 静态条件不满足 → 跳过
      if (cond.requireVariables) {
        const vars = gameState.variables || {};
        const allOk = Object.entries(cond.requireVariables).every(([k, v]) => vars[k] === v);
        if (!allOk) continue;
      }
      if (cond.requireCompletedEvents) {
        const allDone = cond.requireCompletedEvents.every(id => completedSet.has(id));
        if (!allDone) continue;
      }
      if (cond.excludeCompletedEvents) {
        const someExcluded = cond.excludeCompletedEvents.some(id => completedSet.has(id));
        if (someExcluded) continue;
      }
      if (cond.requireItems && cond.requireItems.length > 0) {
        const allInv = (gameState.activeCharacters || []).flatMap(c => c.inventory || []);
        if (!cond.requireItems.every(id => allInv.includes(id))) continue;
      }

      // 空间条件 → 给出具体提示
      if (cond.pointsOfInterest && cond.pointsOfInterest.length > 0 && mapData) {
        const poiName = this._findPOIName(mapData, cond.pointsOfInterest[0]);
        return `下一步建议：前往「${poiName || ev.name}」`;
      }
      if (cond.tileTypes && cond.tileTypes.length > 0) {
        const tileNames = cond.tileTypes
          .map(t => mapData?.tileTypes?.[t]?.name || t)
          .join('/');
        return `下一步建议：在 ${tileNames} 地块上探索，可能触发「${ev.name}」`;
      }
      if (cond.partyHpBelow !== undefined) {
        // 这种就别提示了（提示玩家"快受伤"很奇怪）
        continue;
      }

      // 无空间条件且静态都满足 → 应该自动触发；但若到这一步还没触发，说明概率没命中或链式延迟
      return `下一步建议：「${ev.name}」即将触发`;
    }

    return null;
  }

  _findPOIName(mapData, poiId) {
    if (!mapData || !mapData.pointsOfInterest) return null;
    const poi = mapData.pointsOfInterest.find(p => p.id === poiId);
    return poi ? poi.name : null;
  }

  destroy() {
    this._subIds.forEach(({ type, id }) => this.eventSystem.unsubscribe(type, id));
    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    this._root = null;
  }
}
