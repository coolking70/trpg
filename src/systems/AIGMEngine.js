/**
 * AI GM引擎
 * 调度AI API调用，管理对话上下文，实现智能叙事
 * 使用OpenAI兼容的chat/completions接口格式
 */

import { GameSystem } from '../core/GameEngine.js';
import { AIPromptBuilder } from './AIPromptBuilder.js';
import { AIResponseParser } from './AIResponseParser.js';
import { estimateTokens } from '../utils/tokenEstimator.js';

export class AIGMEngine extends GameSystem {
  constructor() {
    super('AIGMEngine');

    /** API配置 */
    this.apiConfig = {
      endpoint: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      maxTokens: 1000,  // 修复 Bug #6: 300 太小，复杂场景（creativeOutcome JSON）会截断
      temperature: 0.7,
      useStructuredOutput: true,
    };

    /** 提示词构建器 */
    this.promptBuilder = new AIPromptBuilder();

    /** 响应解析器 */
    this.responseParser = new AIResponseParser();

    /** 对话上下文窗口 */
    this.contextWindow = [];

    /** 最大上下文消息数 */
    this.maxContextMessages = 10;

    /** 历史摘要缓存 */
    this.summarizedHistory = '';

    /** 系统提示词缓存 */
    this._cachedSystemPrompt = '';

    /** 事件系统引用 */
    this.eventSystem = null;

    /** 骰子系统引用 */
    this.diceSystem = null;

    /** 当前预设 */
    this.preset = null;

    /** 是否正在请求中 */
    this.isProcessing = false;

    /** Token 使用统计（session 级，每次 reload 重置） */
    this.tokenStats = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCalls: 0,
      lastCall: null,  // { promptTokens, completionTokens, totalTokens, ts }
      budgetWarningTokens: null,  // 设为数字时超过此值发警告
      _warned: false,
    };

    /** 本地叙事模板（常规操作不调AI） */
    this.localTemplates = {
      move: [
        '{character}向{direction}移动了一步。',
        '{character}走到了{tileName}。',
        '你来到了{tileName}区域。',
      ],
      heal_item: [
        '{character}使用了{item}，恢复了{value}点生命值。',
        '{character}喝下{item}，伤口逐渐愈合，恢复了{value}HP。',
      ],
      mp_restore: [
        '{character}使用了{item}，恢复了{value}点魔力。',
      ],
      pickup: [
        '你获得了{item}。',
        '{item}已加入背包。',
      ],
    };
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.gameEngine = gameEngine;
    this.eventSystem = gameEngine.getSystem('EventSystem');
    this.diceSystem = gameEngine.getSystem('DiceSystem');

    // 监听设置变更
    if (this.eventSystem) {
      this.eventSystem.subscribe('settings:changed', (evt) => {
        this.setAPIConfig(evt.data);
      });
      this.eventSystem.subscribe('settings:testApiRequest', (evt) => {
        const { requestId, config } = evt.data || {};
        this.testAPIConnection(config)
          .then(result => {
            this.eventSystem.publish('settings:testApiResponse', { requestId, ...result });
          })
          .catch(error => {
            this.eventSystem.publish('settings:testApiResponse', {
              requestId,
              ok: false,
              message: error.message,
            });
          });
      });
    }
  }

  /**
   * 设置API配置
   * @param {object} config
   */
  setAPIConfig(config) {
    Object.assign(this.apiConfig, config);
  }

  /**
   * 设置游戏预设并缓存系统提示词
   * @param {object} preset - GamePreset数据
   */
  setPreset(preset) {
    this.preset = preset;
    this._cachedSystemPrompt = this.promptBuilder.buildSystemPrompt(preset);
    this.contextWindow = [];
    this.summarizedHistory = '';

    // 应用预设中的AI配置
    if (preset.aiConfig) {
      if (preset.aiConfig.temperature) this.apiConfig.temperature = preset.aiConfig.temperature;
      if (preset.aiConfig.maxResponseTokens) this.apiConfig.maxTokens = preset.aiConfig.maxResponseTokens;
    }
  }

  /**
   * 检查AI是否已配置
   */
  isConfigured() {
    return !!(this.apiConfig.endpoint && this.apiConfig.apiKey);
  }

  /**
   * 测试 OpenAI-compatible API 连通性。
   * 只发一个很小的请求，不写入对话上下文，也不计入游戏 token 统计。
   * @param {object} config
   * @returns {Promise<{ok: boolean, message: string, latencyMs: number, model: string, usage: object|null, preview: string}>}
   */
  async testAPIConnection(config = {}) {
    const probeConfig = { ...this.apiConfig, ...config };
    const endpoint = String(probeConfig.endpoint || '').trim().replace(/\/+$/, '');
    const apiKey = String(probeConfig.apiKey || '').trim();
    const model = String(probeConfig.model || '').trim();

    if (!endpoint) throw new Error('请填写 API 端点');
    if (!apiKey) throw new Error('请填写 API 密钥');
    if (!model) throw new Error('请填写模型名称');

    const controller = new AbortController();
    const timeoutMs = Math.max(3000, Math.min(Number(probeConfig.timeoutMs) || 15000, 60000));
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();

    const body = {
      model,
      messages: [
        { role: 'system', content: 'You are a connection health-check endpoint. Return only JSON.' },
        { role: 'user', content: 'Return {"ok":true,"message":"pong"} to confirm connectivity.' },
      ],
      max_tokens: 32,
      temperature: 0,
    };

    if (probeConfig.useStructuredOutput !== false) {
      body.response_format = { type: 'json_object' };
    }

    let response;
    try {
      response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error(`API 测试超时（${Math.floor(timeoutMs / 1000)}秒）`);
      }
      throw new Error(`网络错误: ${e.message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Math.round(performance.now() - startedAt);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 测试失败 (${response.status}): ${errorText.substring(0, 300)}`);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('API 返回内容不是合法 JSON');
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('API 响应缺少 choices[0].message.content');
    }

    return {
      ok: true,
      message: '连接成功，模型已返回响应',
      latencyMs,
      model: data.model || model,
      usage: data.usage || null,
      preview: content.slice(0, 120),
    };
  }

  /**
   * Phase 26B — AI Hooks 决策门：根据 preset.aiHooks + gameState.aiTier 决定是否调 AI
   *
   * preset.aiHooks[hook] 值：
   *   - 'always'   → 总是调 AI
   *   - 'never'    → 永远本地兜底
   *   - 'optional' → 按 aiTier 决定
   *
   * gameState.aiTier 值（默认 'standard'）：
   *   - 'none'     → 全 fallback（省 token）
   *   - 'light'    → 仅首次访问 / 重要事件
   *   - 'standard' → 大部分都调（除了 vignette 重访）
   *   - 'advanced' → 全开 + 更长 prompt
   *
   * @param {string} hookName - 'sceneArrival' | 'eventResolve' | 'npcDialogue' | 'vignette' | 'worldRipple'
   * @param {object} options - { firstVisit, importance } 等
   * @returns {boolean}
   */
  shouldCallAI(hookName, options = {}) {
    if (!this.preset) return true;  // 没预设上下文，按调
    const hookValue = (this.preset.aiHooks || {})[hookName];
    if (hookValue === 'always') return true;
    if (hookValue === 'never') return false;
    // optional → 看 tier
    const tier = (this.gameEngine?.getGameState?.()?.aiTier) || 'standard';
    if (tier === 'none') return false;
    if (tier === 'advanced') return true;
    // light: 首次重要节点才调
    if (tier === 'light') {
      if (hookName === 'sceneArrival') return options.firstVisit === true;
      if (hookName === 'eventResolve') return options.importance === 'main';
      if (hookName === 'npcDialogue') return options.firstMeet === true;
      if (hookName === 'vignette') return false;
      if (hookName === 'worldRipple') return options.importance === 'main';
      return false;
    }
    // standard: 默认全开但 vignette 重访仅 30% 概率
    if (hookName === 'vignette' && options.firstVisit === false) {
      return Math.random() < 0.3;
    }
    return true;
  }

  /**
   * 处理游戏操作（主入口）
   * @param {string} actionType - 操作类型
   * @param {object} actionData - 操作数据
   * @param {object} gameState - 游戏状态
   * @returns {Promise<object>} 处理结果
   */
  async processGameAction(actionType, actionData, gameState) {
    if (!this.isConfigured()) {
      return this._localFallback(actionType, actionData, gameState);
    }

    // Phase 26B — AI Hooks 决策门
    // 把 actionType 映射到 hook 名 + 判断；不满足直接走 fallback
    const hookForAction = this._hookNameForAction(actionType, actionData, gameState);
    if (hookForAction && !this.shouldCallAI(hookForAction.name, hookForAction.options)) {
      return this._localFallback(actionType, actionData, gameState);
    }

    // 修复 Bug #8: 并发冲突时不能只返回占位结果而丢弃叙事
    // 改为等待当前请求完成（最多 30s）再串行处理
    if (this.isProcessing) {
      const startWait = performance.now();
      while (this.isProcessing && performance.now() - startWait < 30000) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (this.isProcessing) {
        // 真的超时了 → 退回 localFallback 保证叙事不丢
        console.warn('AI 并发等待超时，退回本地叙事');
        return this._localFallback(actionType, actionData, gameState);
      }
    }

    this.isProcessing = true;

    if (this.eventSystem) {
      this.eventSystem.publish('ai:request', { actionType });
    }

    try {
      // 构建用户消息（使用MapSystem中的MapData实例，而非原始JSON）
      let mapData = null;
      if (this.gameEngine) {
        const mapSystem = this.gameEngine.getSystem('MapSystem');
        if (mapSystem) mapData = mapSystem.getMapData();
      }
      if (!mapData && this.preset) mapData = this.preset.map;
      const userMessage = this.promptBuilder.buildActionMessage(actionType, actionData, gameState, mapData);

      // 获取长期记忆视图（World Facts + Key Events）
      const memorySystem = this.gameEngine ? this.gameEngine.getSystem('MemorySystem') : null;
      const memoryView = memorySystem ? memorySystem.getMemoryView(gameState) : null;

      // 构建消息列表
      const messages = this._buildMessages(userMessage, memoryView);

      // 调用AI API
      const responseText = await this.callAI(messages);

      // 解析响应
      const parsed = this.responseParser.parse(responseText);

      // 应用操作（带 CardManager 校验ID引用合法性）
      if (parsed.actions.length > 0) {
        const cardManager = this.gameEngine ? this.gameEngine.getSystem('CardManager') : null;
        this.responseParser.applyActions(parsed.actions, gameState, this.eventSystem, cardManager);
      }

      // 处理骰子请求
      let diceResults = [];
      if (parsed.diceRequests.length > 0 && this.diceSystem) {
        diceResults = this.responseParser.applyDiceRequests(parsed.diceRequests, this.diceSystem);
      }

      // 应用状态更新
      if (parsed.stateUpdate) {
        this.responseParser.applyStateUpdate(parsed.stateUpdate, gameState);
      }

      if (!parsed.narrative) {
        parsed.narrative = this._buildLocalFallbackNarrative(actionType, actionData, gameState);
        if (this.eventSystem) {
          this.eventSystem.publish('ai:error', { error: 'AI 返回了空叙事，已使用本地兜底。' });
        }
      }

      // 添加到上下文
      this.addToContext('user', userMessage);
      this.addToContext('assistant', responseText);

      // 记录叙事
      if (parsed.narrative) {
        gameState.addNarrative('gm', parsed.narrative);
      }

      if (this.eventSystem) {
        this.eventSystem.publish('ai:response', {
          narrative: parsed.narrative,
          actions: parsed.actions,
          diceResults,
        });
      }

      this.isProcessing = false;
      return { ...parsed, diceResults };

    } catch (error) {
      console.error('AI GM处理失败:', error);
      this.isProcessing = false;

      if (this.eventSystem) {
        this.eventSystem.publish('ai:error', { error: error.message });
      }

      // 把失败信息以系统消息形式呈现给玩家，避免"GM正在思考..."卡住的错觉
      gameState.addNarrative('system', `⚠ GM 失联: ${error.message}。已切换到本地叙事，请在设置中检查 API 配置。`);

      // 回退到本地处理
      return this._localFallback(actionType, actionData, gameState);
    }
  }

  /**
   * 调用 AI API（带 30 秒超时 + 网络失败指数退避重试 3 次）
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Promise<string>} AI响应文本
   */
  async callAI(messages) {
    // 最多 3 次重试（网络错误 / 5xx / 429；4xx-非 429 不重试因为是请求本身问题）
    const MAX_RETRIES = 3;
    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this._callAIOnce(messages);
      } catch (e) {
        lastErr = e;
        // 4xx 非 429 → 直接抛（请求构造问题，重试无意义）
        const m = e.message.match(/API请求失败 \((4\d\d)\)/);
        if (m && m[1] !== '429') throw e;
        if (attempt < MAX_RETRIES - 1) {
          const backoffMs = 800 * Math.pow(2, attempt) + Math.floor(Math.random() * 400);
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }
    }
    throw lastErr;
  }

  async _callAIOnce(messages) {
    const url = `${this.apiConfig.endpoint}/chat/completions`;

    const body = {
      model: this.apiConfig.model,
      messages,
      max_tokens: this.apiConfig.maxTokens,
      temperature: this.apiConfig.temperature,
    };

    if (this.apiConfig.useStructuredOutput) {
      body.response_format = { type: 'json_object' };
    }

    const controller = new AbortController();
    const timeoutMs = this.apiConfig.timeoutMs || 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiConfig.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error(`API请求超时（${Math.floor(timeoutMs / 1000)}秒）`);
      }
      throw new Error(`网络错误: ${e.message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API请求失败 (${response.status}): ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();

    if (data.choices && data.choices[0]) {
      const content = data.choices[0].message.content;
      // Token 用量：优先使用 API 返回的 usage（精确），否则本地估算
      const usage = data.usage;
      const promptTokens = usage?.prompt_tokens ?? estimateTokens(messages.map(m => m.content || '').join('\n'));
      const completionTokens = usage?.completion_tokens ?? estimateTokens(content);
      this._recordTokenUsage(promptTokens, completionTokens);
      return content;
    }

    throw new Error('无法解析API响应');
  }

  /**
   * 添加消息到上下文窗口
   * @param {string} role
   * @param {string} content
   */
  addToContext(role, content) {
    this.contextWindow.push({ role, content });

    // 上下文超限时压缩
    if (this.contextWindow.length > this.maxContextMessages) {
      this._compressContext();
    }
  }

  /**
   * 压缩上下文（将旧消息合并为摘要）
   */
  _compressContext() {
    // 保留最近6条消息
    const keep = 6;
    if (this.contextWindow.length <= keep) return;

    const oldMessages = this.contextWindow.splice(0, this.contextWindow.length - keep);

    // 将旧消息压缩为简要摘要
    const summaryParts = [];
    for (const msg of oldMessages) {
      if (msg.role === 'assistant') {
        // 尝试提取叙事部分
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.narrative) summaryParts.push(parsed.narrative);
        } catch {
          summaryParts.push(msg.content.substring(0, 50));
        }
      }
    }

    if (summaryParts.length > 0) {
      this.summarizedHistory = summaryParts.join(' ').substring(0, 200);
    }
  }

  /**
   * 构建完整的消息列表（分层记忆 + 上下文 + 当前消息）
   * @param {string} currentMessage - 当前用户消息
   * @param {object} [memoryView] - {worldFacts, keyEvents} 来自 MemorySystem
   * @returns {Array}
   */
  _buildMessages(currentMessage, memoryView = null) {
    const messages = [];

    // 系统提示词（preset 派生，静态缓存）
    messages.push({ role: 'system', content: this._cachedSystemPrompt });

    // 长期记忆注入（World Facts + Key Events）
    const memorySection = this._formatMemorySection(memoryView);
    if (memorySection) {
      messages.push({ role: 'system', content: memorySection });
    }

    // 历史摘要（近期 context 压缩结果）
    if (this.summarizedHistory) {
      messages.push({ role: 'system', content: `近期剧情摘要: ${this.summarizedHistory}` });
    }

    // 上下文窗口
    for (const msg of this.contextWindow) {
      messages.push(msg);
    }

    // 当前消息
    messages.push({ role: 'user', content: currentMessage });

    return messages;
  }

  /**
   * 记录一次 AI 调用的 token 用量
   * 超过 budgetWarningTokens 时发布 ai:budgetWarning 事件
   */
  _recordTokenUsage(promptTokens, completionTokens) {
    const total = promptTokens + completionTokens;
    this.tokenStats.totalPromptTokens += promptTokens;
    this.tokenStats.totalCompletionTokens += completionTokens;
    this.tokenStats.totalTokens += total;
    this.tokenStats.totalCalls += 1;
    this.tokenStats.lastCall = {
      promptTokens, completionTokens, totalTokens: total, ts: Date.now(),
    };
    // 预算告警（每个 session 只警告一次）
    if (this.tokenStats.budgetWarningTokens && !this.tokenStats._warned
        && this.tokenStats.totalTokens >= this.tokenStats.budgetWarningTokens) {
      this.tokenStats._warned = true;
      if (this.eventSystem) {
        this.eventSystem.publish('ai:budgetWarning', {
          totalTokens: this.tokenStats.totalTokens,
          budgetTokens: this.tokenStats.budgetWarningTokens,
        });
      }
    }
    // 每次调用都发布更新事件（让 UI 实时刷新）
    if (this.eventSystem) {
      this.eventSystem.publish('ai:tokenUpdate', { stats: this.getTokenStats() });
    }
  }

  /** 获取当前 token 统计快照 */
  getTokenStats() {
    const avgPerCall = this.tokenStats.totalCalls > 0
      ? Math.round(this.tokenStats.totalTokens / this.tokenStats.totalCalls)
      : 0;
    return {
      ...this.tokenStats,
      averagePerCall: avgPerCall,
    };
  }

  /** 重置统计（用户手动清零） */
  resetTokenStats() {
    this.tokenStats.totalPromptTokens = 0;
    this.tokenStats.totalCompletionTokens = 0;
    this.tokenStats.totalTokens = 0;
    this.tokenStats.totalCalls = 0;
    this.tokenStats.lastCall = null;
    this.tokenStats._warned = false;
    if (this.eventSystem) {
      this.eventSystem.publish('ai:tokenUpdate', { stats: this.getTokenStats() });
    }
  }

  /** 设置预算告警阈值（0 = 关闭） */
  setBudgetWarning(tokens) {
    this.tokenStats.budgetWarningTokens = tokens > 0 ? tokens : null;
    this.tokenStats._warned = false;
  }

  /** 把记忆视图格式化为 system 消息文本 */
  _formatMemorySection(memoryView) {
    if (!memoryView) return null;
    const parts = [];
    if (memoryView.worldFacts && memoryView.worldFacts.length > 0) {
      parts.push('【世界事实】\n' + memoryView.worldFacts.map(f => `- ${f}`).join('\n'));
    }
    if (memoryView.keyEvents && memoryView.keyEvents.length > 0) {
      parts.push('【已发生的关键事件】\n' + memoryView.keyEvents.map((e, i) => `${i + 1}. ${e}`).join('\n'));
    }
    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  /**
   * Phase 26B — actionType → hook 名映射 + 上下文 options
   * 返回 null 表示该 actionType 不走 hook gate（如 chat、player_input 等总是调）
   */
  _hookNameForAction(actionType, actionData, gameState) {
    switch (actionType) {
      case 'narrate_scene_arrival':
        return { name: 'sceneArrival', options: { firstVisit: actionData.firstVisit !== false } };
      case 'narrate_event': {
        const ev = actionData.event;
        const importance = (ev?.tags || []).includes('main') ? 'main' : 'side';
        return { name: 'eventResolve', options: { importance } };
      }
      case 'narrate_npc_dialogue':
        return { name: 'npcDialogue', options: { firstMeet: actionData.firstMeet === true } };
      case 'narrate_vignette':
        return { name: 'vignette', options: { firstVisit: actionData.firstVisit !== false } };
      case 'narrate_world_ripple':
        return { name: 'worldRipple', options: { importance: actionData.importance || 'side' } };
      // narrate_combat / chat / player_input 等不受 hooks 控制
      default: return null;
    }
  }

  /**
   * 本地回退处理（AI不可用时）
   * @param {string} actionType
   * @param {object} actionData
   * @param {object} gameState
   * @returns {object}
   */
  _localFallback(actionType, actionData, gameState) {
    const narrative = this._buildLocalFallbackNarrative(actionType, actionData, gameState);
    gameState.addNarrative('gm', narrative);
    return { narrative, actions: [], diceRequests: [], diceResults: [] };
  }

  _buildLocalFallbackNarrative(actionType, actionData, gameState) {
    let narrative = '';

    switch (actionType) {
      case 'narrate_event': {
        const evt = actionData.event;
        narrative = evt ? evt.description : '发生了一件事...';
        if (actionData.outcomeText) {
          narrative += ' ' + actionData.outcomeText;
        }
        break;
      }

      case 'narrate_combat': {
        const results = actionData.roundResults || [];
        // 检测特殊场景：战斗结束（_finalizeCombat 会传 narrative 形如"战斗胜利/逃脱/失败"）
        const endLabel = results.find(r => r.narrative && /战斗(胜利|逃脱|失败)/.test(r.narrative));
        if (endLabel) {
          if (endLabel.narrative.includes('胜利')) {
            narrative = '硝烟散去，敌人倒下。你们喘着粗气审视战场，准备整理装备继续前行。';
          } else if (endLabel.narrative.includes('逃脱')) {
            narrative = '你们终于挣脱了战斗，跌跌撞撞退入林中阴影深处，心跳尚未平息。';
          } else {
            narrative = '一切归于沉寂。你们倒在战场上...';
          }
          break;
        }
        // 普通战斗回合：从 log 拼出
        const parts = results.map(r => {
          if (r.attackerName) return `${r.attackerName}攻击${r.targetName}，造成${r.finalDamage||0}点伤害。`;
          if (r.abilityName) return `${r.casterName}使用了${r.abilityName}。`;
          return '';
        }).filter(Boolean);
        // 开场场景（无 results）走简单兜底
        narrative = parts.join(' ') || (results.length === 0 ? '双方对峙，剑拔弩张。' : '战斗继续...');
        break;
      }

      case 'player_action': {
        if (actionData.moved) {
          // 移动时描述当前地块
          let tileName = '未知区域';
          if (this.gameEngine) {
            const mapSystem = this.gameEngine.getSystem('MapSystem');
            const md = mapSystem ? mapSystem.getMapData() : null;
            if (md) {
              const pos = gameState.mapState.playerPosition;
              const tile = md.getTile(pos.x, pos.y);
              if (tile) tileName = tile.name;
              const poi = md.getPointOfInterest(pos.x, pos.y);
              if (poi) tileName = poi.name;
            }
          }
          narrative = `你移动到了${tileName}。`;
        } else {
          narrative = `你${actionData.text || '采取了行动'}。`;
        }
        break;
      }

      case 'scene_description':
        narrative = '你环顾四周，观察着周围的环境。';
        break;

      case 'narrate_scene_arrival': {
        const to = actionData.toScene;
        if (to) narrative = to.description ? `你们抵达了${to.name}。${to.description}` : `你们抵达了${to.name}。`;
        else narrative = '你们抵达了新的场景。';
        break;
      }

      default:
        narrative = '...';
    }

    return narrative;
  }

  /**
   * 使用本地模板生成叙事（不调用AI）
   * @param {string} templateKey
   * @param {object} vars - 模板变量
   * @returns {string}
   */
  generateLocalNarrative(templateKey, vars = {}) {
    const templates = this.localTemplates[templateKey];
    if (!templates || templates.length === 0) return '';

    // 随机选择一个模板
    const template = templates[Math.floor(Math.random() * templates.length)];

    // 替换变量
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return vars[key] !== undefined ? vars[key] : match;
    });
  }

  destroy() {
    this.eventSystem = null;
    this.diceSystem = null;
    this.preset = null;
    this.contextWindow = [];
    super.destroy();
  }
}
