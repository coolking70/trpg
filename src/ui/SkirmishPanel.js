/**
 * 局部战斗面板（Phase 45 P45c）—— 小兵实战参战时替代 RightPanel。
 *
 * 显示：战线（攻守/有利不利）+ 回合，敌我小队（含 HP 条），一排动作（斩击/据守/鼓舞/退却/生擒）。
 * 发布 skirmish:playerAction {skAction, targetId} 交 main.js 推进一回合。
 * 由 GameUI 在 game:stateChanged 时调用 update()。
 */
import './SkirmishPanel.css';

export class SkirmishPanel {
  constructor(containerElement, eventSystem, engine = null) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this.engine = engine;
    this.gameState = null;
    this._visible = false;
    this._busy = false;
  }

  show() { this._visible = true; if (this.gameState?.activeSkirmish) this._render(); }
  hide() {
    this._visible = false;
    this.container.innerHTML = '';
  }
  update(gameState) {
    this.gameState = gameState;
    if (!this._visible) return;
    if (!gameState || !gameState.activeSkirmish) { this.hide(); return; }
    this._busy = false;
    this._render();
  }

  _tideLabel(t) {
    if (t >= 0.33) return '战线有利';
    if (t <= -0.33) return '战线不利';
    return '势均力敌';
  }

  _render() {
    this.container.innerHTML = '';
    const s = this.gameState.activeSkirmish;
    if (!s) return;
    const root = document.createElement('div');
    root.className = 'skirmish-panel';

    const head = document.createElement('div');
    head.className = 'skirmish-panel__head';
    const p = s.parent || {};
    const where = p.kind === 'siege' ? (p.side === 'attacker' ? '攻城战线' : '守城战线') : '野战遭遇';
    head.innerHTML = `<span class="skirmish-panel__title">⚔ 局部战斗 · ${where}</span>`
      + `<span class="skirmish-panel__meta">第 ${s.round} 回合 · ${this._tideLabel(s.tide)} · 斩获 ${s.kills}</span>`;
    root.appendChild(head);

    root.appendChild(this._side('我方', s.allies, 'ally'));
    root.appendChild(this._side('敌方', s.enemies, 'enemy'));

    // 动作区
    const acts = document.createElement('div');
    acts.className = 'skirmish-panel__acts';
    const living = (s.enemies || []).filter(u => u.hp > 0);
    for (const t of living) {
      const cap = t.hp <= Math.max(6, t.hpMax * 0.25) && t.isCommander;
      acts.appendChild(this._btn(`${cap ? '🪢 生擒' : '⚔ 斩'} ${t.name}`, { skAction: cap ? 'capture' : 'attack', targetId: t.id }));
    }
    acts.appendChild(this._btn('🛡 据守', { skAction: 'defend' }));
    acts.appendChild(this._btn('📣 鼓舞', { skAction: 'rally' }));
    acts.appendChild(this._btn('↩ 退却', { skAction: 'flee' }));
    root.appendChild(acts);

    this.container.appendChild(root);
  }

  _side(label, units, cls) {
    const wrap = document.createElement('div');
    wrap.className = `skirmish-panel__side skirmish-panel__side--${cls}`;
    const h = document.createElement('div');
    h.className = 'skirmish-panel__side-h';
    h.textContent = `${label}（${(units || []).filter(u => u.hp > 0).length} 人在战）`;
    wrap.appendChild(h);
    for (const u of (units || []).filter(x => x.hp > 0)) {
      const row = document.createElement('div');
      row.className = 'skirmish-panel__unit' + (u.isPlayer ? ' is-player' : '') + (u.isCommander ? ' is-commander' : '');
      const pct = Math.max(0, Math.min(100, (u.hp / Math.max(1, u.hpMax)) * 100));
      row.innerHTML = `<span class="skirmish-panel__uname">${u.isPlayer ? '★ ' : ''}${u.isCommander ? '⚑ ' : ''}${u.name}</span>`
        + `<span class="skirmish-panel__bar"><i style="width:${pct}%"></i><b>${u.hp}/${u.hpMax}</b></span>`;
      wrap.appendChild(row);
    }
    return wrap;
  }

  _btn(label, payload) {
    const b = document.createElement('button');
    b.className = 'btn skirmish-panel__btn';
    b.textContent = label;
    b.disabled = this._busy;
    b.addEventListener('click', () => {
      if (this._busy) return;
      this._busy = true;
      this.eventSystem.publish('skirmish:playerAction', payload);
    });
    return b;
  }
}
