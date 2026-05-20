/**
 * 预设编辑器模态框
 * 全屏式编辑器，按标签页分类编辑世界观/角色/敌人/物品/事件
 * 支持基于当前预设修改、导入 JSON、导出 JSON、应用为新预设
 *
 * 地图编辑器留给 Phase 7.B（Canvas 绘制 + POI 摆放）
 */

import './PresetEditorModal.css';
import { renderWorldEditor } from './editor/WorldEditor.js';
import { renderCharacterEditor } from './editor/CharacterEditor.js';
import { renderEnemyEditor } from './editor/EnemyEditor.js';
import { renderItemEditor } from './editor/ItemEditor.js';
import { renderEventEditor } from './editor/EventEditor.js';
import { renderMapEditor } from './editor/MapEditor.js';

const TABS = [
  { id: 'world', label: '🌍 世界观', renderer: renderWorldEditor },
  { id: 'characters', label: '🧙 角色', renderer: renderCharacterEditor },
  { id: 'enemies', label: '👹 敌人', renderer: renderEnemyEditor },
  { id: 'items', label: '⚔ 物品', renderer: renderItemEditor },
  { id: 'events', label: '📜 事件', renderer: renderEventEditor },
  { id: 'map', label: '🗺 地图', renderer: renderMapEditor },
];

export class PresetEditorModal {
  constructor(containerElement, eventSystem) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this._backdrop = null;
    /** @type {object} 工作中的预设副本（编辑器只修改这个，应用时才生效） */
    this.draftPreset = null;
    this.currentTab = 'world';
  }

  show(initialPreset) {
    this.hide();
    // 深拷贝，避免直接改原预设
    this.draftPreset = initialPreset ? JSON.parse(JSON.stringify(initialPreset)) : this._blankPreset();

    this._backdrop = document.createElement('div');
    this._backdrop.className = 'modal-backdrop preset-editor-backdrop';
    this._backdrop.addEventListener('click', (e) => {
      if (e.target === this._backdrop && confirm('放弃编辑器内的修改？')) this.hide();
    });

    const modal = document.createElement('div');
    modal.className = 'modal preset-editor-modal';

    // 头部 + 标签栏
    const header = document.createElement('div');
    header.className = 'preset-editor__header';
    header.innerHTML = `
      <div class="preset-editor__title">📝 预设编辑器</div>
      <div class="preset-editor__tabs"></div>
      <div class="preset-editor__actions">
        <button class="btn" id="editor-import">📥 导入 JSON</button>
        <button class="btn" id="editor-export">📤 导出</button>
        <button class="btn btn--primary" id="editor-apply">🚀 应用</button>
        <button class="btn btn--danger" id="editor-close">关闭</button>
      </div>
    `;

    const tabsBar = header.querySelector('.preset-editor__tabs');
    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.className = `preset-editor__tab${tab.id === this.currentTab ? ' active' : ''}`;
      btn.textContent = tab.label;
      btn.dataset.tab = tab.id;
      btn.addEventListener('click', () => this._switchTab(tab.id));
      tabsBar.appendChild(btn);
    }

    header.querySelector('#editor-close').addEventListener('click', () => {
      if (confirm('放弃编辑器内的修改？')) this.hide();
    });
    header.querySelector('#editor-apply').addEventListener('click', () => this._applyDraft());
    header.querySelector('#editor-export').addEventListener('click', () => this._exportJson());
    header.querySelector('#editor-import').addEventListener('click', () => this._importJson());

    modal.appendChild(header);

    // 内容区
    const content = document.createElement('div');
    content.className = 'preset-editor__content';
    this._contentEl = content;
    modal.appendChild(content);

    this._backdrop.appendChild(modal);
    this.container.appendChild(this._backdrop);
    this.container.classList.add('active');

    this._renderCurrentTab();
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

  _switchTab(tabId) {
    this.currentTab = tabId;
    if (!this._backdrop) return;
    this._backdrop.querySelectorAll('.preset-editor__tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tabId);
    });
    this._renderCurrentTab();
  }

  _renderCurrentTab() {
    if (!this._contentEl) return;
    const tab = TABS.find(t => t.id === this.currentTab);
    if (!tab) return;
    this._contentEl.innerHTML = '';
    tab.renderer(this._contentEl, this.draftPreset, () => this._renderCurrentTab());
  }

  /** 应用 draft 为新预设 */
  _applyDraft() {
    if (!this.draftPreset) return;
    const errors = this._validate();
    if (errors.length > 0) {
      alert('预设校验失败：\n' + errors.join('\n'));
      return;
    }
    this.eventSystem.publish('editor:applyPreset', { preset: this.draftPreset });
    this.hide();
  }

  /** 导出 JSON 文件 */
  _exportJson() {
    if (!this.draftPreset) return;
    const json = JSON.stringify(this.draftPreset, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.draftPreset.name || 'preset'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** 导入 JSON 文件覆盖 draft */
  _importJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      if (input.files.length === 0) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          this.draftPreset = data;
          this._renderCurrentTab();
          alert('JSON 已加载到编辑器');
        } catch (e) {
          alert(`JSON 解析失败: ${e.message}`);
        }
      };
      reader.readAsText(input.files[0]);
    };
    input.click();
  }

  _validate() {
    const errors = [];
    const p = this.draftPreset;
    if (!p) return ['预设为空'];
    if (!p.name) errors.push('预设名称不能为空');
    if (!p.characters || p.characters.length === 0) errors.push('至少需要一个角色');
    if (!p.map) errors.push('缺少地图');

    // ID 唯一性
    const ids = new Set();
    for (const list of [p.characters, p.enemies, p.items, p.events]) {
      for (const c of (list || [])) {
        if (ids.has(c.id)) errors.push(`重复的 ID: ${c.id}`);
        ids.add(c.id);
      }
    }
    return errors;
  }

  _blankPreset() {
    return {
      version: '1.0.0',
      presetId: 'preset_' + Date.now(),
      name: '未命名冒险',
      author: '',
      createdAt: new Date().toISOString(),
      description: '',
      lore: { worldName: '', era: '', background: '', rules: '', gmStyle: '' },
      characters: [],
      enemies: [],
      events: [],
      items: [],
      map: null,
      rules: { diceType: 'd20', maxPartySize: 4, startingGold: 100 },
      aiConfig: { temperature: 0.7, maxResponseTokens: 300 },
    };
  }

  destroy() {
    this.hide();
  }
}
