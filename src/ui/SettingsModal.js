/**
 * 设置模态框
 * AI API配置、游戏参数设置
 */

const STORAGE_KEY = 'trpg_ai_config';

export class SettingsModal {
  constructor(containerElement, eventSystem) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this._backdrop = null;

    // 默认配置
    this.config = {
      endpoint: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 1000,
      difficulty: 'normal',      // easy | normal | hard
      autoSaveEnabled: true,
      dynamicDifficulty: true,   // 动态难度（基于战斗表现）
      allyAIMode: 'heuristic',   // 'heuristic' | 'llm' - AI 队友决策模式
      budgetWarningTokens: 0,    // Token 预算告警阈值（0 = 关闭）
    };

    this._loadConfig();
  }

  /** 显示设置面板 */
  show() {
    this.hide();

    this._backdrop = document.createElement('div');
    this._backdrop.className = 'modal-backdrop';
    this._backdrop.addEventListener('click', (e) => {
      if (e.target === this._backdrop) this.hide();
    });

    const modal = document.createElement('div');
    modal.className = 'modal settings-modal';

    // 头部
    const header = document.createElement('div');
    header.className = 'modal__header';
    header.innerHTML = `
      <span class="modal__title">设置</span>
      <button class="modal__close">&times;</button>
    `;
    header.querySelector('.modal__close').addEventListener('click', () => this.hide());
    modal.appendChild(header);

    // 表单
    const body = document.createElement('div');
    body.className = 'modal__body';
    body.innerHTML = `
      <div class="settings__section">
        <h3 class="settings__section-title">AI API 配置</h3>

        <div class="settings__field">
          <label class="settings__label">API 端点</label>
          <input type="text" class="input settings__input" id="setting-endpoint"
            value="${this.config.endpoint}" placeholder="https://api.openai.com/v1">
          <span class="settings__hint">支持所有OpenAI兼容接口（OpenAI/Claude代理/DeepSeek/Ollama等）</span>
        </div>

        <div class="settings__field">
          <label class="settings__label">API 密钥</label>
          <input type="password" class="input settings__input" id="setting-apikey"
            value="${this.config.apiKey}" placeholder="sk-...">
        </div>

        <div class="settings__field">
          <label class="settings__label">模型名称</label>
          <input type="text" class="input settings__input" id="setting-model"
            value="${this.config.model}" placeholder="gpt-4o-mini">
          <span class="settings__hint">如：gpt-4o-mini、deepseek-chat、qwen2.5:7b</span>
        </div>

        <div class="settings__field">
          <label class="settings__label">温度 (Temperature): <span id="temp-value">${this.config.temperature}</span></label>
          <input type="range" class="settings__range" id="setting-temperature"
            min="0" max="1" step="0.1" value="${this.config.temperature}">
        </div>

        <div class="settings__field">
          <label class="settings__label">最大响应Token</label>
          <input type="number" class="input settings__input" id="setting-maxtokens"
            value="${this.config.maxTokens}" min="50" max="2000" step="50">
        </div>
      </div>

      <div class="settings__section">
        <h3 class="settings__section-title">游戏设置</h3>

        <div class="settings__field">
          <label class="settings__label">难度</label>
          <select class="input settings__input" id="setting-difficulty">
            <option value="easy" ${this.config.difficulty === 'easy' ? 'selected' : ''}>简单（敌人 HP ×0.7，攻击 -2）</option>
            <option value="normal" ${this.config.difficulty === 'normal' ? 'selected' : ''}>普通（默认数值）</option>
            <option value="hard" ${this.config.difficulty === 'hard' ? 'selected' : ''}>困难（敌人 HP ×1.3，攻击 +2）</option>
          </select>
        </div>

        <div class="settings__field">
          <label class="settings__label">
            <input type="checkbox" id="setting-autosave" ${this.config.autoSaveEnabled ? 'checked' : ''}>
            启用自动存档
          </label>
          <span class="settings__hint">在事件完成、战斗结束时自动写入"自动存档"槽位</span>
        </div>

        <div class="settings__field">
          <label class="settings__label">
            <input type="checkbox" id="setting-dynamic-difficulty" ${this.config.dynamicDifficulty ? 'checked' : ''}>
            动态难度
          </label>
          <span class="settings__hint">根据最近 5 场战斗表现自动调整后续敌人强度（±15% HP, ±1 ATK）</span>
        </div>

        <div class="settings__field">
          <label class="settings__label">AI 队友决策模式</label>
          <select class="input settings__input" id="setting-ally-mode">
            <option value="heuristic" ${this.config.allyAIMode === 'heuristic' ? 'selected' : ''}>启发式（快速，零成本）</option>
            <option value="llm" ${this.config.allyAIMode === 'llm' ? 'selected' : ''}>LLM 智能（慢，每回合调一次 API）</option>
          </select>
          <span class="settings__hint">LLM 模式让 AI 队友的战术更灵活，但每个队友回合会调用一次 API（增加 token 消耗）</span>
        </div>
      </div>

      <div class="settings__section">
        <h3 class="settings__section-title">🪙 Token 使用统计</h3>
        <div class="settings__token-stats" id="token-stats-display">
          <!-- 由 _refreshTokenStats 动态填充 -->
        </div>
        <div class="settings__field">
          <label class="settings__label">预算告警阈值（Token）</label>
          <input type="number" class="input settings__input" id="setting-budget"
            value="${this.config.budgetWarningTokens}" min="0" step="1000">
          <span class="settings__hint">超过此值时弹出告警 toast（0 = 关闭）。例如填 50000 适合短时游玩限额。</span>
        </div>
        <div class="settings__field">
          <button class="btn" id="setting-reset-tokens" type="button">重置 Token 统计</button>
        </div>
      </div>
    `;

    // 温度滑块实时显示
    const tempRange = body.querySelector('#setting-temperature');
    const tempValue = body.querySelector('#temp-value');
    tempRange.addEventListener('input', () => {
      tempValue.textContent = tempRange.value;
    });

    modal.appendChild(body);

    // 底部按钮
    const footer = document.createElement('div');
    footer.className = 'modal__footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => this.hide());

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn--primary';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', () => this._save(body));

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    modal.appendChild(footer);

    this._backdrop.appendChild(modal);
    this.container.appendChild(this._backdrop);
    this.container.classList.add('active');

    // Token 统计：填充 + 订阅实时更新
    this._refreshTokenStats(body);
    if (!this._tokenSubId) {
      this._tokenSubId = this.eventSystem.subscribe('ai:tokenUpdate', () => {
        const open = this._backdrop && this._backdrop.querySelector('#token-stats-display');
        if (open) this._refreshTokenStats(this._backdrop);
      });
    }

    // 重置 token 按钮
    const resetBtn = body.querySelector('#setting-reset-tokens');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.eventSystem.publish('tokenStats:resetRequest');
      });
    }
  }

  /** 填充 token 统计区 */
  _refreshTokenStats(rootEl) {
    const slot = rootEl.querySelector('#token-stats-display');
    if (!slot) return;
    // 通过事件系统请求最新 stats（避免直接耦合 AIGMEngine）
    let stats = null;
    const onResp = (e) => { stats = e.data.stats; };
    const subId = this.eventSystem.subscribe('tokenStats:response', onResp);
    this.eventSystem.publish('tokenStats:request');
    this.eventSystem.unsubscribe('tokenStats:response', subId);

    if (!stats) {
      slot.innerHTML = '<div class="settings__hint">尚无 AI 调用记录</div>';
      return;
    }
    const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
    slot.innerHTML = `
      <div class="settings__token-row"><span>调用次数</span><strong>${stats.totalCalls}</strong></div>
      <div class="settings__token-row"><span>累计 Tokens</span><strong>${fmt(stats.totalTokens)}</strong></div>
      <div class="settings__token-row"><span>Prompt</span><strong>${fmt(stats.totalPromptTokens)}</strong></div>
      <div class="settings__token-row"><span>Completion</span><strong>${fmt(stats.totalCompletionTokens)}</strong></div>
      <div class="settings__token-row"><span>平均/次</span><strong>${fmt(stats.averagePerCall)}</strong></div>
      ${stats.lastCall ? `<div class="settings__token-row settings__token-last"><span>最近一次</span><strong>${fmt(stats.lastCall.totalTokens)}</strong></div>` : ''}
    `;
  }

  /** 隐藏设置面板 */
  hide() {
    if (this._backdrop) {
      this._backdrop.remove();
      this._backdrop = null;
    }
    if (this.container.children.length === 0) {
      this.container.classList.remove('active');
    }
  }

  /** 获取当前配置 */
  getConfig() {
    return { ...this.config };
  }

  /** 保存配置 */
  _save(body) {
    this.config.endpoint = body.querySelector('#setting-endpoint').value.trim();
    this.config.apiKey = body.querySelector('#setting-apikey').value.trim();
    this.config.model = body.querySelector('#setting-model').value.trim();
    this.config.temperature = parseFloat(body.querySelector('#setting-temperature').value);
    this.config.maxTokens = parseInt(body.querySelector('#setting-maxtokens').value);
    this.config.difficulty = body.querySelector('#setting-difficulty').value;
    this.config.autoSaveEnabled = body.querySelector('#setting-autosave').checked;
    this.config.dynamicDifficulty = body.querySelector('#setting-dynamic-difficulty').checked;
    this.config.allyAIMode = body.querySelector('#setting-ally-mode').value;
    this.config.budgetWarningTokens = parseInt(body.querySelector('#setting-budget').value) || 0;

    this._saveConfig();
    this.eventSystem.publish('settings:changed', this.config);
    this.hide();
  }

  /** 保存到localStorage */
  _saveConfig() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch (e) {
      console.error('保存设置失败:', e);
    }
  }

  /** 从localStorage加载 */
  _loadConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        Object.assign(this.config, JSON.parse(saved));
      }
    } catch (e) {
      console.error('加载设置失败:', e);
    }
  }

  destroy() {
    if (this._tokenSubId) {
      this.eventSystem.unsubscribe('ai:tokenUpdate', this._tokenSubId);
      this._tokenSubId = null;
    }
    this.hide();
  }
}
