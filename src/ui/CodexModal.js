/**
 * 图鉴 / 元进度展示 Modal（Phase 24）
 *
 * 跨周目持久的"图鉴"，让玩家看到自己已发现的场景/事件/NPC/结局。
 * 数据源自 metaProgression（按 presetId 分键）。
 *
 * 设计：
 *   - 4 标签：🗺 场景 / 📜 事件 / 🧑 NPC / 🌅 结局
 *   - 每项显示 已发现/总数 + 进度条
 *   - 未发现的条目显示 "???" 不剧透名字
 *   - 顶部显示总通关数 / 总游玩时长
 *
 * 触发：
 *   - 工具栏 📖 图鉴 按钮 → publish('ui:openCodex')
 *   - CharacterCreationModal 完成新游戏前 → 可显示当前 preset 的进度（鼓励多周目）
 */

import './CodexModal.css';
import { metaProgression } from '../core/MetaProgression.js';

export class CodexModal {
  constructor(containerElement, eventSystem, engine) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this.engine = engine;
    this._backdrop = null;
    this._currentTab = 'scenes';
    this._meta = null;
    this._preset = null;

    this._subIds = [];
    this._subIds.push({
      type: 'ui:openCodex',
      id: eventSystem.subscribe('ui:openCodex', () => this.show()),
    });
  }

  async show() {
    this.hide();
    // 从 engine 拿当前 preset
    const app = window.__trpgApp;
    this._preset = app?.preset || null;
    if (!this._preset) {
      this._renderEmpty();
      return;
    }
    // 加载该 preset 的元进度
    this._meta = await metaProgression.load(this._preset.presetId);
    this._render();
  }

  _renderEmpty() {
    this._backdrop = document.createElement('div');
    this._backdrop.className = 'modal-backdrop codex-backdrop';
    this._backdrop.innerHTML = `
      <div class="modal codex-modal">
        <div class="codex-modal__title">📖 图鉴</div>
        <div class="codex-modal__empty">还没有加载预设，无法显示图鉴。先开始一局游戏吧。</div>
        <div class="codex-modal__footer">
          <button class="btn">关闭</button>
        </div>
      </div>
    `;
    this._backdrop.querySelector('button').addEventListener('click', () => this.hide());
    this._backdrop.addEventListener('click', (e) => {
      if (e.target === this._backdrop) this.hide();
    });
    this.container.appendChild(this._backdrop);
    this.container.classList.add('active');
  }

  _render() {
    this._backdrop = document.createElement('div');
    this._backdrop.className = 'modal-backdrop codex-backdrop';
    this._backdrop.addEventListener('click', (e) => {
      if (e.target === this._backdrop) this.hide();
    });

    const modal = document.createElement('div');
    modal.className = 'modal codex-modal';

    // 头部
    const header = document.createElement('div');
    header.className = 'codex-modal__header';
    header.innerHTML = `
      <div class="codex-modal__title">📖 ${this._preset.name} 图鉴</div>
      <div class="codex-modal__overview">
        <span>🔄 通关次数: <b>${this._meta.completedRuns} / ${this._meta.runCount}</b></span>
        <span>⏱ 累计游玩: <b>${this._formatPlayTime(this._meta.totalPlayTimeSeconds)}</b></span>
      </div>
    `;
    modal.appendChild(header);

    // Tab 栏
    const tabBar = document.createElement('div');
    tabBar.className = 'codex-modal__tabs';
    const tabs = [
      { id: 'scenes',   label: '🗺 场景' },
      { id: 'events',   label: '📜 事件' },
      { id: 'npcs',     label: '🧑 NPC' },
      { id: 'endings',  label: '🌅 结局' },
    ];
    for (const t of tabs) {
      const btn = document.createElement('button');
      btn.className = `codex-modal__tab${this._currentTab === t.id ? ' active' : ''}`;
      btn.textContent = t.label;
      btn.dataset.tab = t.id;
      btn.addEventListener('click', () => {
        this._currentTab = t.id;
        this._renderTab();
        tabBar.querySelectorAll('.codex-modal__tab').forEach(el => el.classList.toggle('active', el.dataset.tab === t.id));
      });
      tabBar.appendChild(btn);
    }
    modal.appendChild(tabBar);

    // 内容区
    const body = document.createElement('div');
    body.className = 'codex-modal__body';
    body.id = 'codex-body';
    modal.appendChild(body);

    // 底部按钮
    const footer = document.createElement('div');
    footer.className = 'codex-modal__footer';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn--ghost';
    closeBtn.textContent = '关闭';
    closeBtn.addEventListener('click', () => this.hide());
    footer.appendChild(closeBtn);
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn--danger';
    resetBtn.textContent = '🗑 清空本预设的图鉴进度';
    resetBtn.addEventListener('click', async () => {
      if (confirm(`确定要清空「${this._preset.name}」的所有元进度数据？通关记录、已发现条目都将归零。`)) {
        await metaProgression.clear(this._preset.presetId);
        this.hide();
      }
    });
    footer.appendChild(resetBtn);
    modal.appendChild(footer);

    this._backdrop.appendChild(modal);
    this.container.appendChild(this._backdrop);
    this.container.classList.add('active');

    this._renderTab();
  }

  _renderTab() {
    const body = document.getElementById('codex-body');
    if (!body) return;
    body.innerHTML = '';
    if (this._currentTab === 'scenes')   this._renderScenesTab(body);
    else if (this._currentTab === 'events')  this._renderEventsTab(body);
    else if (this._currentTab === 'npcs')    this._renderNPCsTab(body);
    else if (this._currentTab === 'endings') this._renderEndingsTab(body);
  }

  _renderScenesTab(body) {
    const all = this._preset.scenes || [];
    const discovered = new Set(this._meta.discoveredScenes || []);
    this._renderCollection(body, all, discovered, (item, found) => ({
      icon: item.icon || '📍',
      name: found ? item.name : '???',
      desc: found ? (item.description || '').slice(0, 80) : '尚未发现',
    }));
  }

  _renderEventsTab(body) {
    const all = (this._preset.events || []).filter(e => !(e.tags || []).includes('hidden'));
    const discovered = new Set(this._meta.discoveredEvents || []);
    this._renderCollection(body, all, discovered, (item, found) => ({
      icon: ({ story: '📖', encounter: '⚔', shop: '🏪', boss: '👹', rescue: '✨' }[item.eventType]) || '📜',
      name: found ? item.name : '???',
      desc: found ? (item.description || '').slice(0, 80) : '尚未发现',
    }));
  }

  _renderNPCsTab(body) {
    const all = this._preset.npcs || [];
    const discovered = new Set(this._meta.discoveredNpcs || []);
    if (all.length === 0) {
      body.innerHTML = '<div class="codex-modal__empty">此剧本未定义 NPC</div>';
      return;
    }
    this._renderCollection(body, all, discovered, (item, found) => ({
      icon: item.icon || '🧑',
      name: found ? item.name : '???',
      desc: found ? `${item.title || ''} — ${item.personality || ''}` : '尚未相遇',
    }));
  }

  _renderEndingsTab(body) {
    // 结局 = preset.events 中带 epilogue/ending tag 的事件
    const all = (this._preset.events || []).filter(e =>
      (e.tags || []).some(t => t === 'epilogue' || t === 'ending')
    );
    const discovered = new Set(this._meta.discoveredEndings || []);
    if (all.length === 0) {
      body.innerHTML = '<div class="codex-modal__empty">此剧本未定义结局事件</div>';
      return;
    }
    this._renderCollection(body, all, discovered, (item, found) => ({
      icon: '🌅',
      name: found ? item.name : '???',
      desc: found ? (item.description || '').slice(0, 80) : '尚未达成',
    }));
  }

  _renderCollection(body, all, discovered, getDisplay) {
    // 进度条
    const progress = document.createElement('div');
    progress.className = 'codex-modal__progress';
    const pct = all.length === 0 ? 0 : Math.round(discovered.size / all.length * 100);
    progress.innerHTML = `
      <div class="codex-modal__progress-label">已发现 ${discovered.size} / ${all.length}（${pct}%）</div>
      <div class="codex-modal__progress-bar">
        <div class="codex-modal__progress-fill" style="width:${pct}%"></div>
      </div>
    `;
    body.appendChild(progress);

    if (all.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'codex-modal__empty';
      empty.textContent = '空列表';
      body.appendChild(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'codex-modal__grid';
    for (const item of all) {
      const found = discovered.has(item.id);
      const view = getDisplay(item, found);
      const card = document.createElement('div');
      card.className = `codex-modal__card${found ? ' is-found' : ' is-locked'}`;
      card.innerHTML = `
        <div class="codex-modal__card-icon">${found ? view.icon : '❓'}</div>
        <div class="codex-modal__card-name">${view.name}</div>
        <div class="codex-modal__card-desc">${view.desc}</div>
      `;
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }

  _formatPlayTime(seconds) {
    if (!seconds || seconds < 60) return `${seconds || 0} 秒`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m} 分钟`;
    const h = Math.floor(m / 60);
    return `${h} 小时 ${m % 60} 分`;
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
