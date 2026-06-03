/**
 * 右面板
 * 显示当前活跃的事件卡或地形事件卡及其选项
 */

import { CardRenderer } from '../rendering/CardRenderer.js';
import { schemaOf } from '../data/strategySchema.js';
import { campaignStatus } from '../data/campaign.js';
import { skirmishContext } from '../systems/skirmishOrchestration.js';
import { schoolSchemaOf, creditProgress, computeGpa, canElect, eligibleRecruits } from '../data/school.js';

const STANCE_LABEL = { ally: '盟', trade: '睦', neutral: '中', rival: '隙', war: '战', vassal: '附' };

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

    // 战略国势条（极简，仅在剧本含战略层时显示）—— 置于事件之上
    this._strategyEl = document.createElement('div');
    this._strategyEl.className = 'right-panel__strategy';
    this.container.appendChild(this._strategyEl);

    // 学校就学条（极简，仅在剧本含学校层且身处校园时显示）
    this._schoolEl = document.createElement('div');
    this._schoolEl.className = 'right-panel__school';
    this.container.appendChild(this._schoolEl);

    const header = document.createElement('div');
    header.className = 'right-panel__header';
    header.textContent = '当前事件';
    this.container.appendChild(header);

    this._contentArea = document.createElement('div');
    this._contentArea.className = 'right-panel__content';
    this.container.appendChild(this._contentArea);

    this._renderStrategyStrip();
    this._renderSchoolStrip();
    this._renderEvent();
  }

  update(gameState) {
    this.gameState = gameState;
    if (gameState && gameState.activeEvent) {
      this.activeEvent = gameState.activeEvent;
      this._isTerrainCard = false;
      this._customChoiceCallback = null;
    }
    this._renderStrategyStrip();
    this._renderSchoolStrip();
    this._renderEvent();
  }

  /** 极简就学呈现：学籍条（年级/学期/学分/绩点）+ 校园场景的就学动作（选课/上课/社团/考试/推进/招募） */
  _renderSchoolStrip() {
    if (!this._schoolEl) return;
    const st = this.gameState?.schoolState;
    // 仅在校 + 身处校园场景显示
    const scene = this.gameState?.scene || this._currentScene();
    const onCampus = scene && ((scene.tags || []).includes('school') || (scene.tags || []).includes('campus'));
    if (!st || st.status !== 'enrolled' || !onCampus) {
      this._schoolEl.style.display = 'none'; this._schoolEl.innerHTML = ''; return;
    }
    this._schoolEl.style.display = '';
    this._schoolEl.innerHTML = '';
    const schema = schoolSchemaOf(this.gameState);
    const terms = schema.narration?.terms || {};
    const prog = creditProgress(st, schema);
    const gpa = computeGpa(st);

    // 学籍条
    const bar = document.createElement('div');
    bar.className = 'right-panel__school-bar';
    bar.innerHTML = `<span title="学院">🏫 ${st.schoolName}</span>`
      + `<span title="方向">${schema.majors?.[st.major]?.name || st.major}</span>`
      + `<span title="年级/${terms.term || '学期'}">${st.year}年级·${terms.term || '学期'}${st.term}</span>`
      + `<span title="学分">📚${prog.earned}/${prog.toGraduate}</span>`
      + `<span title="绩点">GPA ${gpa.toFixed(2)}</span>`
      + (st.demerits ? `<span class="right-panel__school-demerit" title="${terms.demerit || '记过'}">⚠${st.demerits}</span>` : '');
    this._schoolEl.appendChild(bar);
    if (st.pendingPenalty) {
      const warn = document.createElement('div');
      warn.className = 'right-panel__school-warn';
      warn.textContent = st.pendingPenalty === 'expel' ? '⚠ 考试不合格，面临退学' : '⚠ 考试不合格，面临留级';
      this._schoolEl.appendChild(warn);
    }

    // 就学动作
    const acts = document.createElement('div');
    acts.className = 'right-panel__school-acts';
    const mk = (text, payload, title = '') => {
      const b = document.createElement('button');
      b.className = 'btn right-panel__school-btn';
      b.textContent = text; if (title) b.title = title;
      b.addEventListener('click', () => this.eventSystem.publish('school:uiAction', payload));
      acts.appendChild(b);
    };
    // 可选课程（限 4 个，避免刷屏）
    let elected = 0;
    for (const [cid, c] of Object.entries(schema.courses || {})) {
      if (elected >= 4) break;
      if (canElect(st, schema, cid).ok) { mk(`选课·${c.name}`, { op: 'elect', courseId: cid }, `${c.credits}学分`); elected++; }
    }
    // 在修课程上课
    for (const cid of (st.enrolled || [])) {
      const c = schema.courses[cid]; if (c) mk(`上课·${c.name}`, { op: 'attend', courseId: cid });
    }
    // 社团
    for (const [clid, cl] of Object.entries(schema.clubs || {})) {
      if (!(st.clubs || []).includes(clid)) mk(`社团·${cl.name}`, { op: 'club', clubId: clid });
    }
    // 考试 / 竞赛
    for (const [eid, e] of Object.entries(schema.exams || {})) mk(`${e.name}`, { op: 'exam', examId: eid });
    for (const [eid, e] of Object.entries(schema.competitions || {})) mk(`${e.name}`, { op: 'exam', examId: eid });
    // 推进学期
    mk(`结束本${terms.term || '学期'}`, { op: 'advance_term' }, '推进学期：升级/留级/毕业/退学判定');
    // 毕业招募
    if (eligibleRecruits(st, schema).length) mk('招募师友', { op: 'recruit' }, '关系达标的同窗师友入队');
    this._schoolEl.appendChild(acts);
  }

  _currentScene() {
    try {
      const ss = this.engine?.getSystem?.('SceneSystem');
      return ss ? ss.getCurrentScene(this.gameState) : null;
    } catch { return null; }
  }

  /** 极简战略呈现：国势条（必要数值 + 外交立场）+ 理政场景的少量情境选项 + 高权限进谏提示 */
  _renderStrategyStrip() {
    if (!this._strategyEl) return;
    const st = this.gameState?.strategicState;
    if (!st) { this._strategyEl.style.display = 'none'; this._strategyEl.innerHTML = ''; return; }
    this._strategyEl.style.display = '';
    this._strategyEl.innerHTML = '';

    const me = st.factions?.[st.playerFactionId];
    if (!me) return;

    // 国势条：资源标签取自题材 Schema（缺省=三国 金/粮/兵/民心）
    const rs = (this.gameState?.strategySchema?.resources) || {};
    const rlabel = (k, fallbackName, fallbackIcon) => {
      const r = rs[k] || {};
      return { name: r.name || fallbackName, icon: r.icon || fallbackIcon };
    };
    const rg = rlabel('gold', '金', '💰'), rf = rlabel('food', '粮', '🌾');
    const rt = rlabel('troops', '兵力', '🪖'), ro = rlabel('order', '民心', '❤');
    const res = document.createElement('div');
    res.className = 'right-panel__strategy-res';
    res.innerHTML = `<span title="${rg.name}">${rg.icon}${me.gold}</span><span title="${rf.name}">${rf.icon}${me.food}</span>`
      + `<span title="${rt.name}">${rt.icon}${me.troops}</span><span title="${ro.name}">${ro.icon}${me.order}</span>`
      + `<span class="right-panel__strategy-season">第${st.season}季</span>`;
    this._strategyEl.appendChild(res);

    // 战局一行（极简）—— 据城数 / 交战方 / 势力位次
    const camp = campaignStatus(st, st.playerFactionId);
    if (camp) {
      const cEl = document.createElement('div');
      cEl.className = 'right-panel__strategy-campaign';
      cEl.textContent = camp;
      this._strategyEl.appendChild(cEl);
    }

    // 外交立场小标
    const dip = Object.entries(me.diplomacy || {});
    if (dip.length) {
      const drow = document.createElement('div');
      drow.className = 'right-panel__strategy-dip';
      for (const [fid, rel] of dip) {
        const name = st.factions[fid]?.name || fid;
        const chip = document.createElement('span');
        chip.className = `right-panel__dip-chip dip--${rel.stance}`;
        chip.textContent = `${name}·${STANCE_LABEL[rel.stance] || rel.stance}`;
        drow.appendChild(chip);
      }
      this._strategyEl.appendChild(drow);
    }

    // 城池列表（极简，可折叠）—— 仅当有城池
    if (Array.isArray(me.holdings) && me.holdings.length) {
      const det = document.createElement('details');
      det.className = 'right-panel__cities';
      if (this._citiesOpen) det.open = true;
      det.addEventListener('toggle', () => { this._citiesOpen = det.open; });
      const sum = document.createElement('summary');
      sum.textContent = `城池 ${me.holdings.length}`;
      det.appendChild(sum);
      for (const h of me.holdings) {
        const row = document.createElement('div');
        row.className = 'right-panel__city';
        const tName = schemaOf(this.gameState).holdingTypes[h.type]?.name || h.type;
        row.innerHTML = `<span class="right-panel__city-name">${h.name}<span class="right-panel__city-type">${tName}</span></span>`
          + `<span class="right-panel__city-stat">众${(h.population / 10000).toFixed(1)}万 治${h.security}</span>`
          + `<span class="right-panel__city-gov">${h.governorName ? '守·' + h.governorName : '（无守将）'}</span>`;
        det.appendChild(row);
      }
      this._strategyEl.appendChild(det);
    }

    // 作战层（Phase 41 W6）：接敌抉择 / 围城操作（优先于理政情境选项）
    const mkWar = (label, payload, title) => {
      const b = document.createElement('button');
      b.className = 'btn right-panel__strategy-btn';
      b.textContent = label; if (title) b.title = title;
      b.addEventListener('click', () => this.eventSystem.publish('strategy:uiAction', payload));
      return b;
    };
    const pend = this.gameState._pendingEngagement;
    const ss = this.engine?.getSystem?.('StrategicSystem');
    const commands = ss ? ss.playerCommands(this.gameState) : true;
    const sg = !pend && ss ? ss.playerSiege(this.gameState) : null;
    // 底层视角（soldier/officer）：不给指挥按钮——其势力卷入战事时给"请缨参战"+"静观时局"
    if (!commands && st.regions) {
      const ctx = ss ? skirmishContext(this.gameState, ss) : null;
      const wrap = document.createElement('div');
      wrap.className = 'right-panel__strategy-acts';
      if (ctx) {
        const banner = document.createElement('div');
        banner.className = 'right-panel__strategy-campaign';
        banner.textContent = `⚔ 战事将至：${ctx.desc}（${ctx.tide >= 0.33 ? '战线有利' : ctx.tide <= -0.33 ? '战线吃紧' : '胜负难料'}）`;
        this._strategyEl.appendChild(banner);
        wrap.appendChild(mkWar('⚔ 请缨参战', { kind: 'skirmish_join' }, '投身当前战线的一片厮杀（局部时间放缓）'));
      }
      wrap.appendChild(mkWar('静观时局（一季流转）', { kind: 'season' }, '势力自治、战争幕后自结算'));
      this._strategyEl.appendChild(wrap);
      return;
    }
    if (commands && pend) {
      const wrap = document.createElement('div');
      wrap.className = 'right-panel__strategy-acts';
      const banner = document.createElement('div');
      banner.className = 'right-panel__strategy-campaign';
      banner.textContent = `⚔ ${st.factions[pend.attacker]?.name || pend.attacker}大军（约${pend.army.troops}众）兵临${this._cityName(st, pend.targetHoldingId)}城下`;
      this._strategyEl.appendChild(banner);
      wrap.appendChild(mkWar('出城迎击', { kind: 'engage', choice: 'sally' }, '按野战决胜'));
      wrap.appendChild(mkWar('闭城固守', { kind: 'engage', choice: 'hold' }, '凭城消耗，待敌粮尽士衰'));
      this._strategyEl.appendChild(wrap);
      return;
    }
    if (commands && sg) {
      const pid = st.playerFactionId;
      const banner = document.createElement('div');
      banner.className = 'right-panel__strategy-campaign';
      banner.textContent = `🏰 ${this._cityName(st, sg.holdingId)}围城[${sg.mode === 'blockade' ? '围困' : '强攻'}] 攻${sg.atk.troops}/士${sg.atk.morale} · 守${sg.def.troops}/粮${sg.def.supply} 门${sg.works.gate}`;
      this._strategyEl.appendChild(banner);
      const wrap = document.createElement('div');
      wrap.className = 'right-panel__strategy-acts';
      if (sg.defender === pid) {
        wrap.appendChild(mkWar('坚守', { kind: 'siege_order', order: 'hold' }, '凭城消耗，待敌退'));
        wrap.appendChild(mkWar('强攻反击', { kind: 'siege_order', order: 'sortie' }, '开城突袭，挫敌兵锐'));
        const ally = this._stratBestAlly(st, pid);
        if (ally) wrap.appendChild(mkWar(`求援·${st.factions[ally]?.name || ally}`, { kind: 'siege_order', order: 'relief', allyId: ally }, '急召盟友来援'));
        wrap.appendChild(mkWar('突围', { kind: 'siege_order', order: 'breakout' }, '倾力出城决战'));
      } else {
        wrap.appendChild(mkWar('强攻', { kind: 'siege_order', order: 'assault' }, '破门夺城，伤亡大'));
        wrap.appendChild(mkWar('围困', { kind: 'siege_order', order: 'blockade' }, '断粮相持，待其献城'));
        wrap.appendChild(mkWar('退兵', { kind: 'siege_order', order: 'lift' }, '解围撤还'));
      }
      this._strategyEl.appendChild(wrap);
      return;
    }

    // 情境选项：仅号令权(ruler)且处于「理政」场景（scene.tags 含 governance）
    const scene = this._currentScene();
    const atCourt = commands && scene && (scene.tags || []).includes('governance');
    if (atCourt) {
      const acts = document.createElement('div');
      acts.className = 'right-panel__strategy-acts';
      const mkBtn = (label, payload, title) => {
        const b = document.createElement('button');
        b.className = 'btn right-panel__strategy-btn';
        b.textContent = label; if (title) b.title = title;
        b.addEventListener('click', () => this.eventSystem.publish('strategy:uiAction', payload));
        return b;
      };
      // 政令快捷：取自题材 Schema（优先常用 4 项，缺失则补足前若干项）
      const sc = schemaOf(this.gameState);
      const POL = sc.policies, DIP = sc.diplomacyActions;
      const quick = ['farming', 'tax', 'conscript', 'relief'].filter(k => POL[k]);
      for (const k of Object.keys(POL)) { if (quick.length >= 4) break; if (!quick.includes(k)) quick.push(k); }
      for (const pid of quick) {
        acts.appendChild(mkBtn(POL[pid].name, { kind: 'govern', policyId: pid }, POL[pid].note));
      }
      // 外交：对每个其它势力一个"睦邻/绝交"快捷（朝贡 / 宣战），细节交自由进谏
      for (const [fid, rel] of dip) {
        const name = st.factions[fid]?.name || fid;
        if (DIP.tribute && rel.stance !== 'ally' && rel.relation < 40) acts.appendChild(mkBtn(`厚结${name}`, { kind: 'diplomacy', action: 'tribute', targetId: fid }, DIP.tribute.note));
        if (DIP.declare_war && rel.stance !== 'war') acts.appendChild(mkBtn(`讨${name}`, { kind: 'diplomacy', action: 'declare_war', targetId: fid }, DIP.declare_war.note));
      }
      acts.appendChild(mkBtn('处理政务', { kind: 'season' }, '推进一季，敌国亦各有动作'));
      this._strategyEl.appendChild(acts);
    }

    // 进谏提示（高参与度 ≥ L3）
    if ((this.gameState.aiAuthority ?? 2) >= 3) {
      const hint = document.createElement('div');
      hint.className = 'right-panel__strategy-hint';
      hint.textContent = '💬 可直接进言：在下方说出你的方略，自有人去办';
      this._strategyEl.appendChild(hint);
    }
  }

  _currentScene() {
    const ss = this.engine?.getSystem?.('SceneSystem');
    if (ss && this.gameState) { try { return ss.getCurrentScene(this.gameState); } catch { /* */ } }
    return null;
  }

  _cityName(st, id) { for (const f of Object.values(st.factions || {})) { const h = (f.holdings || []).find(x => x.id === id); if (h) return h.name; } return id; }
  _stratBestAlly(st, fid) { const me = st.factions[fid]; let best = null, r = 39; for (const [tid, rel] of Object.entries(me?.diplomacy || {})) { if ((rel.stance === 'ally' || rel.relation >= 40) && rel.relation > r) { r = rel.relation; best = tid; } } return best; }

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
