/**
 * AI GM引擎
 * 调度AI API调用，管理对话上下文，实现智能叙事
 * 使用OpenAI兼容的chat/completions接口格式
 */

import { GameSystem } from '../core/GameEngine.js';
import { AIPromptBuilder } from './AIPromptBuilder.js';
import { AIResponseParser } from './AIResponseParser.js';
import { estimateTokens } from '../utils/tokenEstimator.js';
import {
  clampAuthority, filterActionsByAuthority, narrationCanMutate, authorityPromptSection, requiredAuthority,
} from './AIAuthority.js';

export class AIGMEngine extends GameSystem {
  constructor() {
    super('AIGMEngine');

    /** API配置 */
    this.apiConfig = {
      endpoint: 'http://127.0.0.1:1234/v1',
      apiKey: '',
      model: 'qwen/qwen3.6-35b-a3b',
      maxTokens: 3200,  // 本地推理模型会先产出 reasoning，过小会截断正式 JSON
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
    if (this.apiConfig.endpoint) {
      this.apiConfig.endpoint = this._normalizeEndpoint(this.apiConfig.endpoint);
    }
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
      if (preset.aiConfig.maxResponseTokens) {
        const presetMaxTokens = Number(preset.aiConfig.maxResponseTokens);
        this.apiConfig.maxTokens = this._isLocalEndpoint(this.apiConfig.endpoint)
          ? Math.max(this.apiConfig.maxTokens, presetMaxTokens)
          : presetMaxTokens;
      }
    }
  }

  /**
   * 检查AI是否已配置
   */
  isConfigured() {
    return !!(this.apiConfig.endpoint && this.apiConfig.model && this._hasRequiredAuth(this.apiConfig));
  }

  _normalizeEndpoint(endpoint) {
    const trimmed = String(endpoint || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    try {
      const url = new URL(trimmed);
      if (!url.pathname || url.pathname === '/') {
        url.pathname = '/v1';
        return url.toString().replace(/\/+$/, '');
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }

  _isLocalEndpoint(endpoint) {
    try {
      const host = new URL(this._normalizeEndpoint(endpoint)).hostname;
      return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    } catch {
      return false;
    }
  }

  _hasRequiredAuth(config) {
    return this._isLocalEndpoint(config.endpoint) || !!String(config.apiKey || '').trim();
  }

  _buildAPIHeaders(config) {
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = String(config.apiKey || '').trim();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  /**
   * 测试 OpenAI-compatible API 连通性。
   * 只发一个很小的请求，不写入对话上下文，也不计入游戏 token 统计。
   * @param {object} config
   * @returns {Promise<{ok: boolean, message: string, latencyMs: number, model: string, usage: object|null, preview: string}>}
   */
  async testAPIConnection(config = {}) {
    const probeConfig = { ...this.apiConfig, ...config };
    const endpoint = this._normalizeEndpoint(probeConfig.endpoint);
    const apiKey = String(probeConfig.apiKey || '').trim();
    const model = String(probeConfig.model || '').trim();

    if (!endpoint) throw new Error('请填写 API 端点');
    if (!this._isLocalEndpoint(endpoint) && !apiKey) throw new Error('请填写 API 密钥');
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
      max_tokens: this._isLocalEndpoint(endpoint) ? 512 : 32,
      temperature: 0,
    };

    const isLocalEndpoint = this._isLocalEndpoint(endpoint);
    if (isLocalEndpoint) {
      body.reasoning_effort = 'none';
    }

    if (probeConfig.useStructuredOutput !== false && !isLocalEndpoint) {
      body.response_format = { type: 'json_object' };
    }

    let response;
    try {
      response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: this._buildAPIHeaders({ ...probeConfig, endpoint, apiKey }),
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

      // 获取本地持久化记忆与检索出的当前局面切片。
      const memorySystem = this.gameEngine ? this.gameEngine.getSystem('MemorySystem') : null;
      const memoryView = memorySystem ? memorySystem.getMemoryView(gameState, {
        worldFactLimit: 10,
        keyEventLimit: 10,
      }) : null;
      const contextRetriever = this.gameEngine ? this.gameEngine.getSystem('ContextRetriever') : null;
      const retrievedContext = contextRetriever
        ? contextRetriever.buildContextDigest(gameState, { sceneLimit: 5, npcLimit: 5 })
        : '';
      const localStateDigest = this._buildLocalStateDigest(actionType, actionData, gameState);
      // 复读缓解：仅对纯叙事类调用注入（player_action 等裁决类不需要）
      const NARRATE_ACTIONS = new Set([
        'narrate_event', 'narrate_scene_arrival', 'narrate_combat',
        'narrate_legion_start', 'narrate_legion_result',
        'narrate_npc_dialogue', 'narrate_vignette', 'narrate_world_ripple',
      ]);
      const antiRepetition = NARRATE_ACTIONS.has(actionType)
        ? this._buildAntiRepetitionHint(gameState)
        : null;
      // AI 参与度（权限）说明：每次实时读 gameState.aiAuthority（滑条可中途调整），让 AI 自我约束
      const authorityHint = authorityPromptSection(clampAuthority(gameState?.aiAuthority));

      // 构建消息列表
      const messages = this._buildMessages(userMessage, {
        memoryView,
        retrievedContext,
        localStateDigest,
        antiRepetition,
        authorityHint,
      });

      // 调用AI API
      const responseText = await this.callAI(messages);

      // 解析响应
      const parsed = this.responseParser.parse(responseText);

      // 应用操作（带 CardManager 校验ID引用合法性）
      // Phase 28 修复：narrate_* 是「纯叙事」调用 —— 状态由预设 outcome.effects / 引擎权威应用过，
      //   此处不能再让 AI 的响应 actions 改状态，否则会重复加物品/改变量（如祭司给的太阳坠被加两次）。
      //   只有 player_action（玩家自由输入，AI 担任裁决者）才允许 AI 的 actions 真正落地。
      // —— AI 参与度（权限）门：按 gameState.aiAuthority 决定 AI 返回的动作能否落地 ——
      // narrate_* 是脚本化叙述流（预设/引擎已是权威）：仅 ≥L3 编剧才允许 AI 在其中注入改状态动作，
      //   否则一律不落地（保留"祭司太阳坠被加两次"那类重复落地 bug 的修复）。
      // 其余流（如 player_action 自由输入裁决）：按权限表过滤后落地（L0/L1 → 全拦=婉拒，L2 有界，…）。
      const NARRATION_ONLY = new Set([
        'narrate_event', 'narrate_scene_arrival', 'narrate_combat',
        'narrate_legion_start', 'narrate_legion_result',
        'narrate_npc_dialogue', 'narrate_vignette', 'narrate_world_ripple',
      ]);
      const authLevel = clampAuthority(gameState?.aiAuthority);
      const isScriptedNarration = NARRATION_ONLY.has(actionType);
      const mayMutateHere = isScriptedNarration ? narrationCanMutate(authLevel) : true;
      if (parsed.actions.length > 0 && mayMutateHere) {
        const { allowed, blocked } = filterActionsByAuthority(parsed.actions, authLevel);
        if (blocked.length > 0 && this.eventSystem) {
          this.eventSystem.publish('ai:authority_blocked', { level: authLevel, blocked: blocked.map(a => a.type) });
        }
        if (allowed.length > 0) {
          // 引擎级动作（spawn_event / scale_difficulty / recruit_companion / change_affection）
          // 需要引擎系统支撑，由 _applyEngineActions 处理；其余简单状态改动交 responseParser。
          const ENGINE_ACTION_TYPES = new Set(['spawn_event', 'scale_difficulty', 'recruit_companion', 'change_affection']);
          // L4 创世：改写世界结构/结局，走带护栏（校验/快照/可撤销/审计）的专用通道
          const WORLDSMITH_ACTION_TYPES = new Set(['rewrite_scene', 'edit_connection', 'author_ending', 'override_outcome', 'kill_npc']);
          const worldsmithActions = allowed.filter(a => WORLDSMITH_ACTION_TYPES.has(a.type));
          const engineActions = allowed.filter(a => ENGINE_ACTION_TYPES.has(a.type));
          const parserActions = allowed.filter(a => !ENGINE_ACTION_TYPES.has(a.type) && !WORLDSMITH_ACTION_TYPES.has(a.type));
          if (parserActions.length > 0) {
            const cardManager = this.gameEngine ? this.gameEngine.getSystem('CardManager') : null;
            this.responseParser.applyActions(parserActions, gameState, this.eventSystem, cardManager);
          }
          if (engineActions.length > 0) this._applyEngineActions(engineActions, gameState, authLevel);
          if (worldsmithActions.length > 0) this._applyWorldsmithActions(worldsmithActions, gameState);
        }
      } else if (parsed.actions.length > 0 && this.eventSystem) {
        this.eventSystem.publish('ai:authority_blocked', {
          level: authLevel, blocked: parsed.actions.map(a => a.type), reason: 'narration-only-at-level',
        });
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

      // 健壮性：个别模型/接口（如 Responses-API + 结构化输出）偶尔会让解析后的 narrative
      // 仍残留 JSON 片段（如 `narrative":"…`）。这里做一次兜底清洗，把真正的叙事抠出来。
      parsed.narrative = this._sanitizeNarrative(parsed.narrative);

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
   * 调用 AI API（远端默认 30 秒、本地默认 120 秒 + 网络失败指数退避重试 3 次）
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
    const endpoint = this._normalizeEndpoint(this.apiConfig.endpoint);
    const isLocalEndpoint = this._isLocalEndpoint(endpoint);
    const useResponses = this._useResponsesApi(endpoint);
    const base = endpoint.replace(/\/(responses|chat\/completions)$/, '');
    const url = useResponses ? `${base}/responses` : `${base}/chat/completions`;

    let body;
    if (useResponses) {
      // OpenAI Responses API（如 hy3-preview）：system → instructions，其余对话 → input 文本
      const { instructions, input } = this._messagesToResponsesInput(messages);
      body = {
        model: this.apiConfig.model,
        instructions,
        input,
        stream: false,
        max_output_tokens: this.apiConfig.maxTokens,
      };
    } else {
      body = {
        model: this.apiConfig.model,
        messages,
        max_tokens: this.apiConfig.maxTokens,
        temperature: this.apiConfig.temperature,
      };
      if (isLocalEndpoint) {
        body.reasoning_effort = 'none';
      }
      if (this.apiConfig.useStructuredOutput && !isLocalEndpoint) {
        body.response_format = { type: 'json_object' };
      }
    }

    const controller = new AbortController();
    const timeoutMs = this.apiConfig.timeoutMs || (isLocalEndpoint ? 120000 : 30000);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this._buildAPIHeaders(this.apiConfig),
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

    const content = useResponses
      ? this._extractResponsesText(data)
      : data.choices?.[0]?.message?.content;

    if (content != null && content !== '') {
      // Token 用量：优先使用 API 返回的 usage（精确），否则本地估算
      // Chat 用 prompt/completion_tokens；Responses 用 input/output_tokens
      const usage = data.usage || {};
      const promptTokens = usage.prompt_tokens ?? usage.input_tokens
        ?? estimateTokens(messages.map(m => m.content || '').join('\n'));
      const completionTokens = usage.completion_tokens ?? usage.output_tokens
        ?? estimateTokens(content);
      this._recordTokenUsage(promptTokens, completionTokens);
      return content;
    }

    throw new Error('无法解析API响应');
  }

  /** 是否走 OpenAI Responses API（/responses + instructions/input），否则用 Chat Completions */
  _useResponsesApi(endpoint) {
    const style = this.apiConfig.apiStyle;
    if (style === 'responses') return true;
    if (style === 'chat') return false;
    return /\/responses\/?$/.test(String(endpoint || '')); // 自动探测：endpoint 直指 /responses
  }

  /** messages[] → Responses API 的 {instructions(系统), input(对话文本)} */
  _messagesToResponsesInput(messages) {
    const sys = messages.filter(m => m.role === 'system').map(m => m.content).filter(Boolean);
    const rest = messages.filter(m => m.role !== 'system');
    const instructions = sys.join('\n\n');
    const input = rest.length === 1
      ? rest[0].content
      : rest.map(m => `${m.role === 'assistant' ? 'GM' : '玩家'}: ${m.content}`).join('\n\n');
    return { instructions, input: input || '(开始)' };
  }

  /** 从 Responses API 返回里抽取文本（output_text / output[].content[].text / 兼容 chat） */
  _extractResponsesText(data) {
    if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
    if (Array.isArray(data.output)) {
      const parts = [];
      for (const item of data.output) {
        for (const c of (item.content || [])) {
          if (typeof c.text === 'string') parts.push(c.text);
        }
      }
      if (parts.length) return parts.join('');
    }
    if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
    return '';
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

    while (this.contextWindow.length > 0 && this.contextWindow[0].role !== 'user') {
      this.contextWindow.shift();
    }
  }

  /**
   * 构建完整的消息列表（本地权威状态 + 检索上下文 + 有限短期衔接 + 当前消息）
   * @param {string} currentMessage - 当前用户消息
   * @param {object} [promptContext] - {memoryView, retrievedContext, localStateDigest}
   * @returns {Array}
   */
  _buildMessages(currentMessage, promptContext = null) {
    const messages = [];
    const memoryView = promptContext?.memoryView || promptContext;
    const retrievedContext = promptContext?.retrievedContext || '';
    const localStateDigest = promptContext?.localStateDigest || '';
    const antiRepetition = promptContext?.antiRepetition || '';
    const authorityHint = promptContext?.authorityHint || '';

    // 系统提示词（preset 派生，静态缓存）
    messages.push({ role: 'system', content: this._cachedSystemPrompt });

    // AI 参与度（权限）说明：非缓存，随 gameState.aiAuthority 实时变化
    if (authorityHint) {
      messages.push({ role: 'system', content: authorityHint });
    }

    if (localStateDigest) {
      messages.push({ role: 'system', content: `【本地权威状态】\n${localStateDigest}` });
    }

    if (retrievedContext) {
      messages.push({ role: 'system', content: `【当前局面检索】\n${retrievedContext}` });
    }

    // 有限长期记忆注入（World Facts + Key Events）
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

    // 复读缓解约束（紧贴当前消息之前，权重更高）
    if (antiRepetition) {
      messages.push({ role: 'system', content: antiRepetition });
    }

    // 当前消息
    messages.push({ role: 'user', content: currentMessage });

    return messages;
  }

  _buildLocalStateDigest(actionType, actionData, gameState) {
    if (!gameState) return '';
    const lines = [
      '以下内容由本地系统维护，优先级高于聊天历史；只允许在这些事实范围内叙述。',
      `阶段:${gameState.currentPhase || 'unknown'} 回合:${gameState.turnNumber || 0}`,
    ];

    const mapState = gameState.mapState || {};
    if (mapState.currentSceneId) {
      const scene = this.preset?.scenes?.find(s => s.id === mapState.currentSceneId);
      lines.push(`当前场景:${scene ? `${scene.name}(${scene.id})` : mapState.currentSceneId}`);
      if (scene?.description) lines.push(`场景事实:${scene.description}`);
      const connections = (scene?.connections || []).map(c => c.to).slice(0, 6);
      if (connections.length > 0) lines.push(`可达场景:${connections.join(', ')}`);
    } else if (mapState.playerPosition) {
      lines.push(`当前位置:(${mapState.playerPosition.x},${mapState.playerPosition.y})`);
    }

    const variables = Object.entries(gameState.variables || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== false)
      .slice(0, 16)
      .map(([key, value]) => `${key}=${String(value)}`);
    if (variables.length > 0) lines.push(`关键变量:${variables.join(', ')}`);

    const completed = (gameState.completedEventIds || []).slice(-12);
    if (completed.length > 0) lines.push(`最近已完成事件:${completed.join(', ')}`);

    const party = (gameState.activeCharacters || []).map(c => {
      const hp = `${c.stats?.hpCurrent ?? '?'} / ${c.stats?.hp ?? '?'}`.replace(/\s/g, '');
      const mp = `${c.stats?.mpCurrent ?? '?'} / ${c.stats?.mp ?? '?'}`.replace(/\s/g, '');
      return `${c.name}(${c.id}) HP:${hp} MP:${mp}`;
    });
    if (party.length > 0) lines.push(`队伍状态:${party.join('；')}`);

    if (gameState.activeCombat) {
      const enemies = (gameState.activeCombat.enemies || [])
        .filter(e => e.stats?.hpCurrent > 0)
        .map(e => `${e.name}(${e.id}) HP:${e.stats.hpCurrent}/${e.stats.hp}`)
        .join('；');
      if (enemies) lines.push(`当前战斗敌人:${enemies}`);
    }

    const activeEvent = actionData?.event || gameState.activeEvent;
    if (activeEvent) {
      lines.push(`当前事件:${activeEvent.name}(${activeEvent.id})`);
      if (activeEvent.description) lines.push(`事件事实:${activeEvent.description}`);
    }
    lines.push(`当前请求类型:${actionType}`);
    return lines.join('\n');
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
   * 复读缓解（Phase 29）：把最近若干条 GM 叙述喂回模型，要求"换一种说法"。
   * 本地中小模型（如非思考 qwen）跨回合缺乏措辞去重记忆，常把伙伴台词与
   * 句尾套话（"你点头，握紧剑柄……"/"小心点，这地方不太对劲"）反复复读。
   * 这里抽取最近 GM 叙述 + 高频复读短语，作为一条 system 约束注入。
   * @param {object} gameState
   * @returns {string|null}
   */
  _buildAntiRepetitionHint(gameState) {
    const log = gameState?.narrativeLog;
    if (!Array.isArray(log) || log.length === 0) return null;
    const gmLines = log.filter(n => n && n.speaker === 'gm' && typeof n.text === 'string')
      .slice(-5).map(n => n.text.trim()).filter(Boolean);
    if (gmLines.length === 0) return null;

    // 统计高频复读短语（4~12 字的连续片段，跨多条叙述重复出现）
    const freq = new Map();
    for (const line of gmLines) {
      const seen = new Set();
      for (let len = 5; len <= 10; len++) {
        for (let i = 0; i + len <= line.length; i++) {
          const frag = line.slice(i, i + len);
          if (/[，。！？、：；""''…]/.test(frag)) continue; // 跨标点的片段跳过
          if (seen.has(frag)) continue;
          seen.add(frag);
          freq.set(frag, (freq.get(frag) || 0) + 1);
        }
      }
    }
    const repeated = [...freq.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[0].length - a[0].length || b[1] - a[1])
      .slice(0, 6)
      .map(([frag]) => frag);

    const parts = ['【避免复读】最近的叙述如下，请勿照搬其句式、措辞或伙伴台词，换一种全新的说法与角度：'];
    gmLines.slice(-3).forEach((l, i) => parts.push(`${i + 1}. ${l.slice(0, 120)}`));
    if (repeated.length > 0) {
      parts.push(`已被反复使用、本回合禁止再用的措辞：${repeated.map(s => `「${s}」`).join('、')}`);
    }
    parts.push('伙伴的反应/台词需要轮换，不要每次都用相同的警示或动作。');
    return parts.join('\n');
  }

  // ============================================================
  // L3 编剧：引擎级动作执行（spawn_event / scale_difficulty / recruit_companion / change_affection）
  //   已通过权限过滤器（≥L3 才会到这里），此处负责真正落地到引擎系统。
  // ============================================================
  _applyEngineActions(actions, gameState, level) {
    for (const action of actions) {
      try {
        switch (action.type) {
          case 'spawn_event': this._spawnEvent(action, gameState, level); break;
          case 'scale_difficulty': {
            const tracker = this.gameEngine?.getSystem('DifficultyTracker');
            const delta = Number(action.delta ?? action.value ?? 0);
            if (tracker && delta) {
              tracker.setManualBias(delta);
              gameState.addNarrative('system', `（GM 调整了难度倾向：${delta > 0 ? '更具挑战' : '稍作宽限'}）`);
            }
            break;
          }
          case 'recruit_companion': {
            const ns = this.gameEngine?.getSystem('NPCSystem');
            const npcId = action.npcId;
            if (ns && npcId) {
              const ok = ns.recruitCompanion(gameState, npcId);
              const npc = ns.getNPC(npcId);
              if (ok && npc && npc.stats && !gameState.activeCharacters.some(c => c.id === npcId)) {
                const slot = JSON.parse(JSON.stringify(npc));
                slot._isCompanion = true; slot.type = 'character';
                slot.stats.hpCurrent = slot.stats.hp; slot.stats.mpCurrent = slot.stats.mp || 0;
                gameState.activeCharacters.push(slot);
              }
              if (ok && npc) gameState.addNarrative('system', `🤝 ${npc.name} 加入了你的队伍。`);
            }
            break;
          }
          case 'change_affection': {
            const ns = this.gameEngine?.getSystem('NPCSystem');
            if (ns && action.npcId !== undefined) ns.changeAffection(gameState, action.npcId, Number(action.value) || 0);
            break;
          }
        }
      } catch (e) {
        console.error('应用 L3 引擎动作失败:', action, e);
      }
    }
  }

  /**
   * spawn_event：AI 即兴编写并注入一个支线/遭遇事件（L3 编剧的标志能力）。
   * 安全：事件各选项的 effects 在注入时按当前权限过滤（剥离超出档位的 effect），
   *   防止经"自造事件的 outcome"绕过权限门夹带 L4 改写。
   */
  _spawnEvent(action, gameState, level) {
    const ev = action.event || action;
    if (!ev || !ev.name || !ev.description) return;
    const cm = this.gameEngine?.getSystem('CardManager');
    if (!cm) return;

    gameState._aiSpawnSeq = (gameState._aiSpawnSeq || 0) + 1;
    const id = `ev_ai_spawn_${gameState._aiSpawnSeq}`;

    // 过滤每个选项的 effects（effect.type 与动作类型共用权限表）
    const choices = Array.isArray(ev.choices) ? ev.choices.map((c, i) => {
      const rawEffects = Array.isArray(c.effects) ? c.effects
        : (Array.isArray(c.outcomes) ? (c.outcomes[0]?.effects || []) : []);
      const effects = rawEffects.filter(e => e && requiredAuthority(e.type) <= clampAuthority(level));
      return {
        id: c.id || `choice_${i + 1}`,
        text: c.text || `选项 ${i + 1}`,
        outcomes: [{ probability: 1.0, text: c.outcomeText || '', effects }],
      };
    }) : [];

    const card = {
      id, type: 'event', name: ev.name, description: ev.description,
      eventType: 'ai_spawn', repeatable: false,
      tags: ['ai_spawn', ...(Array.isArray(ev.tags) ? ev.tags : [])],
      choices,
    };
    cm.addCard(card);
    // 设为当前事件，交由引擎/UI 走正常的事件解析（选项→outcome.effects 落地）
    gameState.activeEvent = card;
    gameState.addNarrative('system', `（一个新的转折出现了：${ev.name}）`);
    if (this.eventSystem) this.eventSystem.publish('ai:spawnedEvent', { eventId: id, name: ev.name });
  }

  // ============================================================
  // L4 创世：世界改写（护栏：校验 → 快照 → 落地 → 审计；硬禁项不受档位影响）
  //   仅 ≥L4 的动作能到这里（已过权限门）。每次改写记录可撤销快照 + 审计日志。
  // ============================================================
  _applyWorldsmithActions(actions, gameState) {
    for (const action of actions) {
      try {
        const r = this._applyWorldsmithOne(action, gameState);
        if (r && r.ok) {
          (gameState._aiRewrites ||= []).push(r.undo);
          (gameState._aiAuthorityLog ||= []).push({ ts: Date.now(), type: action.type, summary: r.summary });
          gameState.addNarrative('system', `（世界被改写：${r.summary}）`);
          if (this.eventSystem) this.eventSystem.publish('ai:worldRewrite', { type: action.type, summary: r.summary });
        } else if (r && r.reason) {
          gameState.addNarrative('system', `（GM 的改写被护栏拦下：${r.reason}）`);
          if (this.eventSystem) this.eventSystem.publish('ai:rewriteRejected', { type: action.type, reason: r.reason });
        }
      } catch (e) {
        console.error('应用 L4 世界改写失败:', action, e);
      }
    }
  }

  _applyWorldsmithOne(action, gameState) {
    const ss = this.gameEngine?.getSystem('SceneSystem');
    const cm = this.gameEngine?.getSystem('CardManager');
    switch (action.type) {
      case 'rewrite_scene': {
        if (!ss) return { ok: false, reason: '场景系统不可用' };
        const scene = ss.getScene(action.sceneId);
        if (!scene) return { ok: false, reason: `场景不存在: ${action.sceneId}` };
        const before = { name: scene.name, description: scene.description };
        if (typeof action.name === 'string' && action.name.trim()) scene.name = action.name.trim();
        if (typeof action.description === 'string' && action.description.trim()) scene.description = action.description.trim();
        return { ok: true, summary: `重写场景「${scene.name}」`, undo: { type: 'rewrite_scene', sceneId: action.sceneId, before } };
      }
      case 'edit_connection': {
        if (!ss) return { ok: false, reason: '场景系统不可用' };
        const from = ss.getScene(action.from);
        const to = ss.getScene(action.to);
        if (!from || !to) return { ok: false, reason: `连接端点不存在: ${action.from} / ${action.to}` };
        const before = JSON.parse(JSON.stringify(from.connections || []));
        const op = action.op === 'remove' ? 'remove' : 'add';
        if (op === 'add') {
          if ((from.connections || []).some(c => c.to === action.to)) return { ok: false, reason: '连接已存在' };
          (from.connections ||= []).push({ to: action.to, label: action.label || `前往 ${to.name}` });
        } else {
          // 硬禁项：移除连接不得减少玩家当前位置的可达场景集（防困死/孤立）
          const sim = (from.connections || []).filter(c => c.to !== action.to);
          const cur = gameState.mapState?.currentSceneId;
          const beforeSet = this._reachableSet(ss, cur, {});
          const afterSet = this._reachableSet(ss, cur, { [from.id]: sim });
          if (afterSet.size < beforeSet.size) return { ok: false, reason: '移除该连接会令场景不可达（护栏拦截）' };
          from.connections = sim;
        }
        return { ok: true, summary: `${op === 'add' ? '新增' : '移除'}连接 ${action.from}→${action.to}`, undo: { type: 'edit_connection', sceneId: from.id, before } };
      }
      case 'author_ending': {
        if (!cm) return { ok: false, reason: '卡牌系统不可用' };
        if (!action.description) return { ok: false, reason: '结局缺少描述' };
        if (action.sceneId && ss && !ss.getScene(action.sceneId)) return { ok: false, reason: `结局所属场景不存在: ${action.sceneId}` };
        const sceneId = action.sceneId || gameState.mapState?.currentSceneId;
        gameState._aiSpawnSeq = (gameState._aiSpawnSeq || 0) + 1;
        const id = `ev_ai_ending_${gameState._aiSpawnSeq}`;
        cm.addCard({
          id, type: 'event', name: action.name || '新的结局', description: action.description,
          eventType: 'ai_ending', repeatable: false, tags: ['ending', 'main', 'ai_authored'],
          inScene: sceneId ? [sceneId] : [],
          choices: [{ id: 'embrace', text: '迎接这一结局', outcomes: [{ probability: 1.0, text: '', effects: [{ type: 'set_variable', target: 'game_complete', value: true }] }] }],
        });
        return { ok: true, summary: `新增结局「${action.name || '新的结局'}」`, undo: { type: 'add_card', cardId: id } };
      }
      case 'override_outcome': {
        const before = {};
        const vars = (action.setVariables && typeof action.setVariables === 'object') ? action.setVariables : {};
        for (const [k, v] of Object.entries(vars)) { before[k] = gameState.variables[k]; gameState.variables[k] = v; }
        if (action.gameComplete) { before.game_complete = gameState.variables.game_complete; gameState.variables.game_complete = true; }
        if (action.narrative) gameState.addNarrative('gm', String(action.narrative));
        return { ok: true, summary: '覆盖了既定结果', undo: { type: 'set_variables', before } };
      }
      case 'kill_npc': {
        const ns = this.gameEngine?.getSystem('NPCSystem');
        const protagId = gameState.activeCharacters?.[0]?.id;
        if (!action.npcId) return { ok: false, reason: '缺少 npcId' };
        if (action.npcId === protagId) return { ok: false, reason: '不可对主角执行（硬禁项）' };
        if (ns) ns.applyNPCDeath(gameState, action.npcId);
        return { ok: true, summary: `${action.npcId} 退场`, undo: { type: 'none' } };
      }
      default:
        return { ok: false, reason: `未知世界改写: ${action.type}` };
    }
  }

  /** BFS：从 startId 出发、以 overrides 覆盖部分场景连接后的可达场景集 */
  _reachableSet(ss, startId, overrides = {}) {
    const seen = new Set();
    if (!startId || !ss.getScene(startId)) return seen;
    seen.add(startId);
    const q = [startId];
    while (q.length) {
      const id = q.shift();
      const conns = overrides[id] !== undefined ? overrides[id] : (ss.getScene(id)?.connections || []);
      for (const c of conns) {
        if (c && c.to && !seen.has(c.to)) { seen.add(c.to); q.push(c.to); }
      }
    }
    return seen;
  }

  /** 撤销最近一次 L4 世界改写（护栏：可撤销） */
  undoLastRewrite(gameState) {
    const stack = gameState._aiRewrites;
    if (!stack || stack.length === 0) return { ok: false, reason: '没有可撤销的改写' };
    const u = stack.pop();
    const ss = this.gameEngine?.getSystem('SceneSystem');
    const cm = this.gameEngine?.getSystem('CardManager');
    try {
      switch (u.type) {
        case 'rewrite_scene': { const s = ss?.getScene(u.sceneId); if (s) { s.name = u.before.name; s.description = u.before.description; } break; }
        case 'edit_connection': { const s = ss?.getScene(u.sceneId); if (s) s.connections = u.before; break; }
        case 'add_card': { cm?.removeCard(u.cardId); break; }
        case 'set_variables': { for (const [k, v] of Object.entries(u.before)) { if (v === undefined) delete gameState.variables[k]; else gameState.variables[k] = v; } break; }
        default: break;
      }
      (gameState._aiAuthorityLog ||= []).push({ ts: Date.now(), type: 'undo', summary: `撤销 ${u.type}` });
      return { ok: true, undone: u.type };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
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

  /**
   * 清洗叙事文本：若解析后仍残留 `narrative":"…` / 前后多余的 JSON 括号引号（个别接口的边角情况），
   * 尽量抠出真正的叙事内容；正常文本原样返回。
   */
  _sanitizeNarrative(narrative) {
    if (typeof narrative !== 'string') return narrative;
    let s = narrative.trim();
    // 残留形如  narrative":"正文...  或  {"narrative":"正文...
    const m = s.match(/^\{?\s*"?narrative"?\s*:\s*"([\s\S]*)$/);
    if (m) {
      s = m[1];
      // 截到 "," 后接其它字段（actions/stateUpdate 等）或收尾的 "}
      s = s.replace(/"\s*,\s*"(?:actions|stateUpdate|diceRequests)"[\s\S]*$/, '');
      s = s.replace(/"\s*\}?\s*$/, '');
      // 反转义
      s = s.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
    }
    return s.trim();
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

      case 'narrate_legion_start': {
        const bt = actionData.battleTypeName || '大战';
        narrative = `${actionData.objectiveName || ''}${actionData.objectiveName ? '——' : ''}${bt}一触即发，两军列阵，旌旗蔽空，杀气腾腾。`;
        break;
      }

      case 'narrate_legion_result': {
        narrative = actionData.won
          ? '鼓角声渐歇，敌阵土崩瓦解，残兵败将四散奔逃。我军将士欢声雷动，旌旗指处，尽是降幡。'
          : '阵脚终究没能稳住，我军且战且退，丢盔弃甲。残部退入暮色，喘息未定，徒留满地狼藉。';
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
