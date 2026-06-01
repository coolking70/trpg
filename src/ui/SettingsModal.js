/**
 * 设置模态框
 * AI API配置、游戏参数设置
 */

import { AUTHORITY_LEVELS, DEFAULT_AUTHORITY } from '../systems/AIAuthority.js';

const STORAGE_KEY = 'trpg_ai_config';

export class SettingsModal {
  constructor(containerElement, eventSystem) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this._backdrop = null;

    // 默认配置
    this.config = {
      endpoint: 'http://127.0.0.1:1234/v1',
      apiKey: '',
      model: 'qwen/qwen3.6-35b-a3b',
      temperature: 0.7,
      maxTokens: 3200,
      difficulty: 'normal',      // easy | normal | hard
      autoSaveEnabled: true,
      dynamicDifficulty: true,   // 动态难度（基于战斗表现）
      allyAIMode: 'heuristic',   // 'heuristic' | 'llm' - AI 队友决策模式
      budgetWarningTokens: 0,    // Token 预算告警阈值（0 = 关闭）
      aiTier: 'standard',        // Phase 26B - AI 叙事丰度 (none/light/standard/advanced)
      aiAuthority: DEFAULT_AUTHORITY, // AI 参与度/主导度（0–4，权限轴）
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
            value="${this.config.endpoint}" placeholder="http://127.0.0.1:1234/v1">
          <span class="settings__hint">支持所有OpenAI兼容接口；本地 127.0.0.1/localhost 端点可不填密钥。</span>
        </div>

        <div class="settings__field">
          <label class="settings__label">API 密钥</label>
          <input type="password" class="input settings__input" id="setting-apikey"
            value="${this.config.apiKey}" placeholder="本地模型可留空">
        </div>

        <div class="settings__field">
          <label class="settings__label">模型名称</label>
          <input type="text" class="input settings__input" id="setting-model"
            value="${this.config.model}" placeholder="qwen/qwen3.6-35b-a3b">
          <span class="settings__hint">如：qwen/qwen3.6-35b-a3b、deepseek-chat、qwen2.5:7b</span>
        </div>

        <div class="settings__field">
          <label class="settings__label">温度 (Temperature): <span id="temp-value">${this.config.temperature}</span></label>
          <input type="range" class="settings__range" id="setting-temperature"
            min="0" max="1" step="0.1" value="${this.config.temperature}">
        </div>

        <div class="settings__field">
          <label class="settings__label">最大响应Token</label>
          <input type="number" class="input settings__input" id="setting-maxtokens"
            value="${this.config.maxTokens}" min="50" max="6000" step="50">
        </div>

        <div class="settings__field">
          <button class="btn settings__test-btn" id="setting-test-api" type="button">测试 API 连接</button>
          <div class="settings__api-test-result" id="setting-api-test-result" aria-live="polite"></div>
          <span class="settings__hint">会向当前端点发送一次极小的 chat/completions 请求，并显示成功、错误原因和耗时。</span>
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

        <div class="settings__field">
          <label class="settings__label">🤖 AI 叙事丰度</label>
          <select class="input settings__input" id="setting-ai-tier">
            <option value="none"     ${this.config.aiTier === 'none'     ? 'selected' : ''}>关闭 — 全部走预设兜底（0 token）</option>
            <option value="light"    ${this.config.aiTier === 'light'    ? 'selected' : ''}>轻量 — 仅首访场景/主线事件/首遇 NPC</option>
            <option value="standard" ${this.config.aiTier === 'standard' ? 'selected' : ''}>标准 — 绝大多数节点都调（推荐）</option>
            <option value="advanced" ${this.config.aiTier === 'advanced' ? 'selected' : ''}>丰富 — 全开，含 vignette 重访叙事</option>
          </select>
          <span class="settings__hint">控制 AI 在何时介入叙事（频率）。预设作者可通过 preset.aiHooks 强制 always/never 某个 hook。</span>
        </div>

        <div class="settings__field">
          <label class="settings__label">🎚 AI 参与度（主导度）</label>
          <input type="range" class="settings__range" id="setting-ai-authority"
            min="0" max="4" step="1" value="${this.config.aiAuthority ?? DEFAULT_AUTHORITY}"
            style="width:100%">
          <div id="setting-ai-authority-label" class="settings__authority-label">
            ${this._authorityLabelHTML(this.config.aiAuthority ?? DEFAULT_AUTHORITY)}
          </div>
          <span class="settings__hint">控制 AI 操作的 GM 对游戏进程的<b>控制力度</b>（权限）。可随时拖动，下次 AI 行动即生效。
            ⬅ 越左 AI 越克制（仅氛围）｜越右 AI 越主导（高档可改写剧情/结局）。</span>
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

    const testBtn = body.querySelector('#setting-test-api');
    if (testBtn) {
      testBtn.addEventListener('click', () => this._testAPI(body));
    }

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

    // AI 参与度滑条：拖动即实时生效（无需保存/关闭），并实时更新档位说明
    const authEl = body.querySelector('#setting-ai-authority');
    const authLabel = body.querySelector('#setting-ai-authority-label');
    if (authEl) {
      authEl.addEventListener('input', () => {
        const lv = Math.max(0, Math.min(4, parseInt(authEl.value, 10) || 0));
        if (authLabel) authLabel.innerHTML = this._authorityLabelHTML(lv);
        this.config.aiAuthority = lv;
        // 专用事件：只改 gameState.aiAuthority，不触动其它设置
        this.eventSystem.publish('settings:authorityLive', { aiAuthority: lv });
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
    this.config = this._readFormConfig(body);

    this._saveConfig();
    this.eventSystem.publish('settings:changed', this.config);
    this.hide();
  }

  /** AI 参与度档位的展示文本（名称 + 能力简述） */
  _authorityLabelHTML(level) {
    const lv = Math.max(0, Math.min(4, Math.round(Number(level)) || 0));
    const meta = AUTHORITY_LEVELS[lv] || AUTHORITY_LEVELS[DEFAULT_AUTHORITY];
    return `<b>L${lv} ${meta.name}</b> — ${meta.blurb}`;
  }

  /** 从表单读取当前配置，不要求用户先保存 */
  _readFormConfig(body) {
    const tierEl = body.querySelector('#setting-ai-tier');
    const authEl = body.querySelector('#setting-ai-authority');
    return {
      ...this.config,
      aiAuthority: authEl ? Math.max(0, Math.min(4, parseInt(authEl.value, 10) || 0)) : this.config.aiAuthority,
      endpoint: body.querySelector('#setting-endpoint').value.trim(),
      apiKey: body.querySelector('#setting-apikey').value.trim(),
      model: body.querySelector('#setting-model').value.trim(),
      temperature: parseFloat(body.querySelector('#setting-temperature').value),
      maxTokens: parseInt(body.querySelector('#setting-maxtokens').value),
      difficulty: body.querySelector('#setting-difficulty').value,
      autoSaveEnabled: body.querySelector('#setting-autosave').checked,
      dynamicDifficulty: body.querySelector('#setting-dynamic-difficulty').checked,
      allyAIMode: body.querySelector('#setting-ally-mode').value,
      budgetWarningTokens: parseInt(body.querySelector('#setting-budget').value) || 0,
      aiTier: tierEl ? tierEl.value : this.config.aiTier,
    };
  }

  /** 测试当前表单中的 API 配置 */
  _testAPI(body) {
    const btn = body.querySelector('#setting-test-api');
    const resultEl = body.querySelector('#setting-api-test-result');
    if (!btn || !resultEl) return;

    const config = this._readFormConfig(body);
    const requestId = `api_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    btn.disabled = true;
    btn.textContent = '测试中...';
    resultEl.className = 'settings__api-test-result settings__api-test-result--pending';
    resultEl.textContent = '正在请求模型，请稍候。';

    const cleanup = (subId, timeoutId) => {
      if (subId) this.eventSystem.unsubscribe('settings:testApiResponse', subId);
      if (timeoutId) clearTimeout(timeoutId);
      btn.disabled = false;
      btn.textContent = '测试 API 连接';
    };

    let subId = null;
    const timeoutId = setTimeout(() => {
      cleanup(subId, null);
      resultEl.className = 'settings__api-test-result settings__api-test-result--error';
      resultEl.textContent = '测试请求没有返回结果，请检查网络、端点地址或浏览器控制台。';
    }, 65000);

    subId = this.eventSystem.subscribe('settings:testApiResponse', (evt) => {
      const data = evt.data || {};
      if (data.requestId !== requestId) return true;

      cleanup(subId, timeoutId);
      if (data.ok) {
        const usageText = data.usage?.total_tokens ? `，${data.usage.total_tokens} tokens` : '';
        resultEl.className = 'settings__api-test-result settings__api-test-result--ok';
        resultEl.textContent = `${data.message || '连接成功'}。模型：${data.model || config.model}，耗时 ${data.latencyMs || 0}ms${usageText}。`;
      } else {
        resultEl.className = 'settings__api-test-result settings__api-test-result--error';
        resultEl.textContent = data.message || '连接失败，但没有返回具体错误。';
      }
      return false;
    });

    this.eventSystem.publish('settings:testApiRequest', { requestId, config });
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
