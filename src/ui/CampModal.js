/**
 * 营地 / 旅馆 Modal（Phase 20B）
 *
 * 进入 type='camp' / 'inn' 类型的场景时自动打开。
 * 4 标签页：💬 对话 / 🎁 赠礼 / 🙏 索物 / 😴 休息
 *
 * 事件流：
 *   - 'camp:open' { sceneId, npcIds[] } → 弹窗
 *   - 'camp:close' → 关闭
 *   - 内部所有玩法变更通过 EventSystem 转发给 main.js（dialogue:choose / camp:gift / camp:request / camp:rest）
 */

import './CampModal.css';

const REACTION_TEXT = {
  love: { emoji: '💖', label: '深深地喜爱', color: '#ec4899' },
  like: { emoji: '😊', label: '很开心', color: '#22c55e' },
  neutral: { emoji: '😐', label: '勉强接受', color: '#94a3b8' },
  dislike: { emoji: '😒', label: '不太喜欢', color: '#f59e0b' },
  hate: { emoji: '😠', label: '厌恶', color: '#ef4444' },
};

export class CampModal {
  constructor(containerElement, eventSystem, engine) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this.engine = engine;
    this._backdrop = null;
    this._currentTab = 'dialogue';
    this._selectedNpcId = null;
    this._sceneId = null;
    this._npcIds = [];
    this._subIds = [];

    this._subIds.push({
      type: 'camp:open',
      id: eventSystem.subscribe('camp:open', (evt) => this.show(evt.data)),
    });
    this._subIds.push({
      type: 'dialogue:viewChanged',
      id: eventSystem.subscribe('dialogue:viewChanged', () => this._renderTab()),
    });
    this._subIds.push({
      type: 'game:stateChanged',
      id: eventSystem.subscribe('game:stateChanged', () => {
        if (this._backdrop) this._renderHeader();  // 刷新好感数值等
      }),
    });
  }

  show({ sceneId, npcIds, sceneName, sceneIcon }) {
    this.hide();
    this._sceneId = sceneId;
    this._npcIds = npcIds || [];
    this._selectedNpcId = this._npcIds[0] || null;
    this._currentTab = this._npcIds.length > 0 ? 'dialogue' : 'rest';
    this._sceneName = sceneName || '营地';
    this._sceneIcon = sceneIcon || '🏕';
    this._render();
  }

  _render() {
    this._backdrop = document.createElement('div');
    this._backdrop.className = 'modal-backdrop camp-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal camp-modal';

    // 头部 — 场景信息 + 故事时间
    const header = document.createElement('div');
    header.className = 'camp-modal__header';
    header.id = 'camp-header';
    modal.appendChild(header);

    // NPC 切换栏（>1 个 NPC 时显示）
    if (this._npcIds.length > 1) {
      const npcStrip = document.createElement('div');
      npcStrip.className = 'camp-modal__npc-strip';
      npcStrip.id = 'camp-npc-strip';
      modal.appendChild(npcStrip);
    }

    // Tab 栏
    const tabBar = document.createElement('div');
    tabBar.className = 'camp-modal__tabs';
    const tabs = [
      { id: 'dialogue', label: '💬 对话', requiresNpc: true },
      { id: 'gift',     label: '🎁 赠礼', requiresNpc: true },
      { id: 'request',  label: '🙏 索物', requiresNpc: true },
      { id: 'rest',     label: '😴 休息', requiresNpc: false },
    ];
    for (const t of tabs) {
      const btn = document.createElement('button');
      btn.className = `camp-modal__tab${this._currentTab === t.id ? ' active' : ''}`;
      btn.textContent = t.label;
      btn.dataset.tab = t.id;
      btn.disabled = t.requiresNpc && !this._selectedNpcId;
      btn.addEventListener('click', () => {
        this._currentTab = t.id;
        this._renderTab();
        tabBar.querySelectorAll('.camp-modal__tab').forEach(el => el.classList.toggle('active', el.dataset.tab === t.id));
      });
      tabBar.appendChild(btn);
    }
    modal.appendChild(tabBar);

    // 内容区
    const body = document.createElement('div');
    body.className = 'camp-modal__body';
    body.id = 'camp-body';
    modal.appendChild(body);

    // 关闭按钮
    const footer = document.createElement('div');
    footer.className = 'camp-modal__footer';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn--ghost';
    closeBtn.textContent = '⬅ 离开营地';
    closeBtn.addEventListener('click', () => {
      this.eventSystem.publish('camp:close');
      this.hide();
    });
    footer.appendChild(closeBtn);
    modal.appendChild(footer);

    this._backdrop.appendChild(modal);
    this.container.appendChild(this._backdrop);
    this.container.classList.add('active');

    this._renderHeader();
    if (this._npcIds.length > 1) this._renderNpcStrip();
    this._renderTab();
  }

  _renderHeader() {
    const el = document.getElementById('camp-header');
    if (!el) return;
    const gs = this.engine.getGameState();
    const st = gs?.storyTime || { day: 1, hour: 0 };
    const hh = String(Math.floor(st.hour || 0)).padStart(2, '0');
    el.innerHTML = `
      <div class="camp-modal__scene">
        <div class="camp-modal__scene-icon">${this._sceneIcon}</div>
        <div class="camp-modal__scene-info">
          <div class="camp-modal__scene-name">${this._sceneName}</div>
          <div class="camp-modal__scene-time">🕐 D${st.day} ${hh}:00</div>
        </div>
      </div>
    `;
  }

  _renderNpcStrip() {
    const el = document.getElementById('camp-npc-strip');
    if (!el) return;
    const npcSystem = this.engine.getSystem('NPCSystem');
    const gs = this.engine.getGameState();
    el.innerHTML = '';
    for (const npcId of this._npcIds) {
      const npc = npcSystem.getNPC(npcId);
      const st = npcSystem.getNPCState(gs, npcId);
      if (!npc) continue;
      const btn = document.createElement('button');
      btn.className = `camp-modal__npc-chip${npcId === this._selectedNpcId ? ' active' : ''}`;
      btn.innerHTML = `
        <span class="camp-modal__npc-icon">${npc.icon || '🧑'}</span>
        <span class="camp-modal__npc-name">${npc.name}</span>
        <span class="camp-modal__npc-aff">❤${st?.affection || 0}</span>
      `;
      btn.addEventListener('click', () => {
        this._selectedNpcId = npcId;
        this._renderTab();
        el.querySelectorAll('.camp-modal__npc-chip').forEach(c => c.classList.toggle('active', c === btn));
      });
      el.appendChild(btn);
    }
  }

  _renderTab() {
    const body = document.getElementById('camp-body');
    if (!body) return;
    body.innerHTML = '';
    if (this._currentTab === 'dialogue') this._renderDialogueTab(body);
    else if (this._currentTab === 'gift')    this._renderGiftTab(body);
    else if (this._currentTab === 'request') this._renderRequestTab(body);
    else if (this._currentTab === 'rest')    this._renderRestTab(body);
  }

  _renderDialogueTab(body) {
    if (!this._selectedNpcId) {
      body.innerHTML = '<div class="camp-modal__empty">此处空无一人</div>';
      return;
    }
    const dialogueSys = this.engine.getSystem('DialogueSystem');
    const gs = this.engine.getGameState();

    // 如果未开启对话或对话对象不一致，自动启动
    if (!gs.activeDialogue || gs.activeDialogue.npcId !== this._selectedNpcId) {
      const view = dialogueSys.start(gs, this._selectedNpcId);
      if (!view) {
        body.innerHTML = '<div class="camp-modal__empty">这位 NPC 暂时无话可说</div>';
        return;
      }
    }

    const view = dialogueSys.getCurrentView(gs);
    if (!view) {
      body.innerHTML = '<div class="camp-modal__empty">对话已结束</div>';
      return;
    }

    // 渲染对话气泡 + 选项
    body.innerHTML = `
      <div class="camp-modal__dialogue-bubble ${view.speaker === 'player' ? 'is-player' : 'is-npc'}">
        <div class="camp-modal__dialogue-speaker">${view.speaker === 'player' ? '🗨 你' : `${view.npcIcon} ${view.npcName}`}</div>
        <div class="camp-modal__dialogue-text">${view.text}</div>
      </div>
      <div class="camp-modal__dialogue-branches" id="dialogue-branches"></div>
    `;

    const branchesEl = document.getElementById('dialogue-branches');
    for (const b of view.branches) {
      if (b.hidden) continue;
      const btn = document.createElement('button');
      btn.className = `camp-modal__branch${b.disabled ? ' disabled' : ''}`;
      btn.innerHTML = `<span>${b.text}</span>${b.reason ? `<span class="camp-modal__branch-reason">${b.reason}</span>` : ''}`;
      btn.disabled = b.disabled;
      if (!b.disabled) {
        btn.addEventListener('click', () => {
          this.eventSystem.publish('dialogue:choose', { branchIndex: b.index });
          // main.js 应用后会发布 dialogue:viewChanged
        });
      }
      branchesEl.appendChild(btn);
    }

    // 没有可选分支 → 自动退出
    if (view.branches.filter(b => !b.hidden).length === 0) {
      const exitBtn = document.createElement('button');
      exitBtn.className = 'btn';
      exitBtn.textContent = '（结束对话）';
      exitBtn.addEventListener('click', () => {
        this.eventSystem.publish('dialogue:exit');
        this._renderTab();
      });
      branchesEl.appendChild(exitBtn);
    }
  }

  _renderGiftTab(body) {
    if (!this._selectedNpcId) {
      body.innerHTML = '<div class="camp-modal__empty">没有可赠送的对象</div>';
      return;
    }
    const npcSystem = this.engine.getSystem('NPCSystem');
    const cm = this.engine.getSystem('CardManager');
    const gs = this.engine.getGameState();
    const npc = npcSystem.getNPC(this._selectedNpcId);

    // 玩家可赠送的物品 = 主角 + 同行角色的 inventory（伙伴 NPC 物品不算）
    const pc = gs.activeCharacters?.[0];
    const allItems = new Map();
    if (pc) for (const iid of (pc.inventory || [])) {
      const card = cm.getCard(iid);
      if (card) allItems.set(iid, card);
    }

    if (allItems.size === 0) {
      body.innerHTML = '<div class="camp-modal__empty">你身上没有可赠送的物品</div>';
      return;
    }

    const header = document.createElement('div');
    header.className = 'camp-modal__gift-hint';
    header.textContent = `挑一件礼物送给 ${npc.name}（每件礼物只能送一次，效果取决于 ta 的喜好）`;
    body.appendChild(header);

    const list = document.createElement('div');
    list.className = 'camp-modal__gift-list';
    for (const [iid, item] of allItems.entries()) {
      const reaction = npcSystem.evaluateGiftReaction(this._selectedNpcId, item);
      const meta = REACTION_TEXT[reaction] || REACTION_TEXT.neutral;
      const card = document.createElement('button');
      card.className = 'camp-modal__gift-card';
      card.innerHTML = `
        <div class="camp-modal__gift-name">${item.name}</div>
        <div class="camp-modal__gift-type">${item.itemType || '物品'}</div>
        <div class="camp-modal__gift-hint-line" style="color:${meta.color}">⓵ 未知</div>
      `;
      // 仅当 NPC 已经透露过偏好（affection >= 30）才显示预期反应
      const st = npcSystem.getNPCState(gs, this._selectedNpcId);
      if ((st?.affection || 0) >= 30) {
        card.querySelector('.camp-modal__gift-hint-line').textContent = `${meta.emoji} 预期：${meta.label}`;
      } else {
        card.querySelector('.camp-modal__gift-hint-line').textContent = `❓ 你不确定 ta 会喜欢什么`;
      }
      card.addEventListener('click', () => {
        this.eventSystem.publish('camp:gift', { npcId: this._selectedNpcId, itemId: iid });
        // main.js 处理完后会刷新 state，CampModal 会自动 _renderTab
        setTimeout(() => this._renderTab(), 100);
      });
      list.appendChild(card);
    }
    body.appendChild(list);
  }

  _renderRequestTab(body) {
    if (!this._selectedNpcId) {
      body.innerHTML = '<div class="camp-modal__empty">没有可索物的对象</div>';
      return;
    }
    const npcSystem = this.engine.getSystem('NPCSystem');
    const cm = this.engine.getSystem('CardManager');
    const gs = this.engine.getGameState();
    const npc = npcSystem.getNPC(this._selectedNpcId);
    const st = npcSystem.getNPCState(gs, this._selectedNpcId);
    const affection = st?.affection || 0;

    if (affection < 50) {
      body.innerHTML = `
        <div class="camp-modal__empty">
          <div>${npc.icon || '🧑'} ${npc.name}</div>
          <div style="margin-top:8px;color:#94a3b8">好感 ${affection}/50 — 关系还不够亲近</div>
          <div style="margin-top:6px;font-size:12px;color:#64748b">先聊聊或送些喜欢的礼物，好感够了才能向 ta 索物</div>
        </div>
      `;
      return;
    }

    // NPC 持有的物品（仅普通物品；recruitable 同行 NPC 的装备不算）
    const inv = st.inventory || [];
    if (inv.length === 0) {
      body.innerHTML = `<div class="camp-modal__empty">${npc.name} 暂时没有东西可以给你</div>`;
      return;
    }

    const header = document.createElement('div');
    header.className = 'camp-modal__gift-hint';
    header.textContent = `${npc.name} 愿意分享一些物品（请求会消耗一点好感）`;
    body.appendChild(header);

    const list = document.createElement('div');
    list.className = 'camp-modal__gift-list';
    for (const iid of inv) {
      const item = cm.getCard(iid);
      if (!item) continue;
      const card = document.createElement('button');
      card.className = 'camp-modal__gift-card';
      card.innerHTML = `
        <div class="camp-modal__gift-name">${item.name}</div>
        <div class="camp-modal__gift-type">${item.itemType || '物品'}</div>
        <div class="camp-modal__gift-hint-line" style="color:#f59e0b">索要会 -5 好感</div>
      `;
      card.addEventListener('click', () => {
        this.eventSystem.publish('camp:request', { npcId: this._selectedNpcId, itemId: iid });
        setTimeout(() => this._renderTab(), 100);
      });
      list.appendChild(card);
    }
    body.appendChild(list);
  }

  _renderRestTab(body) {
    const gs = this.engine.getGameState();
    const st = gs?.storyTime || { day: 1, hour: 0 };
    const hh = String(Math.floor(st.hour || 0)).padStart(2, '0');
    body.innerHTML = `
      <div class="camp-modal__rest">
        <div class="camp-modal__rest-icon">🌙</div>
        <div class="camp-modal__rest-text">
          休息 8 小时（恢复全部 HP/MP）
          <div class="camp-modal__rest-current">当前：D${st.day} ${hh}:00</div>
        </div>
        <button class="btn btn--primary" id="camp-rest-btn">睡到天亮</button>
      </div>
    `;
    document.getElementById('camp-rest-btn').addEventListener('click', () => {
      this.eventSystem.publish('camp:rest', { hours: 8 });
      setTimeout(() => {
        this._renderHeader();
        this._renderTab();
      }, 100);
    });
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
    for (const { type, id } of this._subIds) this.eventSystem.unsubscribe(type, id);
    this._subIds = [];
    this.hide();
  }
}
