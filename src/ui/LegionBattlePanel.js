/**
 * 军团战面板（Phase 36）—— 混合：简洁战况 + 高阶令
 *
 * 军团战期间替代 RightPanel 显示：双方单位栈简表（兵力/士气/兵种/阵型）+ 战型目标 +
 * 城门/渡口等战况，底部一排"高阶令"（总攻/固守/火攻/突击/器械/撤退/自动）。
 * 不做逐栈微操——发布 legion:playerAction {posture} 交 main.js 推进一回合。
 * 与 CombatPanel 一样由 GameUI 在 game:stateChanged 时调用 update()。
 */

import './LegionBattlePanel.css';
import { schemaOf } from '../data/strategySchema.js';

const BATTLE_TYPE_NAME = { field: '野战', siege: '攻城', defense: '守城', naval: '水战' };
const POSTURES = [
  { key: 'assault', label: '⚔ 总攻' },
  { key: 'hold', label: '🛡 固守' },
  { key: 'fire', label: '🔥 火攻' },
  { key: 'charge', label: '🐎 突击' },
  { key: 'bombard', label: '🏰 器械' },
  { key: 'retreat', label: '↩ 撤退' },
  { key: 'auto', label: '⏩ 自动一回合' },
];

export class LegionBattlePanel {
  constructor(containerElement, eventSystem, engine = null) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this.engine = engine;
    this.gameState = null;
    this._visible = false;
    this._root = null;
    this._busy = false; // 一回合推进中，禁按
  }

  show() {
    this._visible = true;
    if (this.gameState && this.gameState.activeLegionBattle) this._render();
  }

  hide() {
    this._visible = false;
    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    this._root = null;
    this.container.innerHTML = '';
  }

  update(gameState) {
    this.gameState = gameState;
    if (!this._visible) return;
    if (!gameState || !gameState.activeLegionBattle) { this.hide(); return; }
    this._busy = false;
    this._render();
  }

  _render() {
    this.container.innerHTML = '';
    const b = this.gameState.activeLegionBattle;
    if (!b) return;
    this._root = document.createElement('div');
    this._root.className = 'legion-panel';

    // 顶部：战型 + 目标 + 回合
    const header = document.createElement('div');
    header.className = 'legion-panel__header';
    header.innerHTML = `
      <span class="legion-panel__title">🎖 ${BATTLE_TYPE_NAME[b.battleType] || '军团战'}</span>
      <span class="legion-panel__round">第 ${b.round} 回合</span>`;
    this._root.appendChild(header);

    const obj = document.createElement('div');
    obj.className = 'legion-panel__objective';
    obj.textContent = `目标：${b.objectiveName || '击溃敌军'}`;
    this._root.appendChild(obj);

    // 战况：粮草 + 工事/渡口
    const status = document.createElement('div');
    status.className = 'legion-panel__status';
    const parts = [`粮草 我${b.supply?.player ?? '∞'} · 敌${b.supply?.enemy ?? '∞'}`];
    if (b.works) {
      if (b.works.gate != null) parts.push(`城门 ${b.works.gate}`);
      if (b.works.wall != null) parts.push(`城墙 ${b.works.wall}`);
    }
    if (b.battleType === 'naval') parts.push(`渡口 ${b.control === 'player' ? '我控' : b.control === 'enemy' ? '敌控' : '争夺中'}`);
    status.textContent = parts.join('　|　');
    this._root.appendChild(status);

    // 双方单位栈
    this._root.appendChild(this._renderSide('player', '我军', b));
    this._root.appendChild(this._renderSide('enemy', '敌军', b));

    // 高阶令
    this._root.appendChild(this._renderPostures(b));

    const hint = document.createElement('div');
    hint.className = 'legion-panel__hint';
    hint.textContent = '亦可在下方直接进言，授军师临机决断。';
    this._root.appendChild(hint);

    this.container.appendChild(this._root);
  }

  _renderSide(side, label, b) {
    const wrap = document.createElement('div');
    wrap.className = `legion-panel__side legion-panel__side--${side}`;
    const stacks = (b.units || []).filter(u => u.side === side && u.troops > 0);
    const total = stacks.reduce((s, u) => s + u.troops, 0);
    const head = document.createElement('div');
    head.className = 'legion-panel__side-head';
    head.textContent = `${label}（共 ${total} 众）`;
    wrap.appendChild(head);

    if (stacks.length === 0) {
      const none = document.createElement('div');
      none.className = 'legion-panel__stack legion-panel__stack--empty';
      none.textContent = '——全军溃没——';
      wrap.appendChild(none);
      return wrap;
    }

    for (const u of stacks) {
      const row = document.createElement('div');
      row.className = 'legion-panel__stack';
      const sc = schemaOf(this.gameState);
      const utName = sc.unitTypes[u.unitType]?.name || u.unitType;
      const fName = sc.formations[u.formation]?.name;
      const troopPct = Math.max(0, Math.min(100, (u.troops / Math.max(1, u.maxTroops)) * 100));
      const moralePct = Math.max(0, Math.min(100, u.morale));
      row.innerHTML = `
        <div class="legion-panel__stack-name">${u.name || utName}<span class="legion-panel__stack-tag">${utName}${fName ? '·' + fName : ''}</span></div>
        <div class="legion-panel__bar legion-panel__bar--troops"><div style="width:${troopPct}%"></div><span>${u.troops}</span></div>
        <div class="legion-panel__bar legion-panel__bar--morale"><div style="width:${moralePct}%"></div><span>士气 ${u.morale}</span></div>`;
      wrap.appendChild(row);
    }
    return wrap;
  }

  _renderPostures(b) {
    const bar = document.createElement('div');
    bar.className = 'legion-panel__postures';
    const playerAlive = (b.units || []).some(u => u.side === 'player' && u.troops > 0);
    for (const p of POSTURES) {
      const btn = document.createElement('button');
      btn.className = 'btn legion-panel__btn';
      btn.textContent = p.label;
      btn.disabled = this._busy || !playerAlive;
      btn.addEventListener('click', () => {
        if (this._busy) return;
        this._busy = true;
        this._setDisabledAll(true);
        this.eventSystem.publish('legion:playerAction', { posture: p.key });
      });
      bar.appendChild(btn);
    }
    return bar;
  }

  _setDisabledAll(disabled) {
    if (!this._root) return;
    this._root.querySelectorAll('button').forEach(b => { b.disabled = disabled; });
  }

  destroy() { this.hide(); }
}
