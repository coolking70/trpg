/**
 * AI GM引擎
 * 调度AI API调用，管理对话上下文，实现智能叙事
 * 使用OpenAI兼容的chat/completions接口格式
 */

import { GameSystem } from '../core/GameEngine.js';
import { AIPromptBuilder } from './AIPromptBuilder.js';
import { AIResponseParser } from './AIResponseParser.js';

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

    if (this.isProcessing) {
      return { narrative: '正在思考中...', actions: [], diceRequests: [] };
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
   * 调用 AI API（带 30 秒超时 + 网络失败自动重试 1 次）
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Promise<string>} AI响应文本
   */
  async callAI(messages) {
    // 最多重试 1 次（仅网络错误/超时；4xx 不重试因为是请求本身问题）
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this._callAIOnce(messages);
      } catch (e) {
        lastErr = e;
        // 4xx 错误不重试
        if (/API请求失败 \(4\d\d\)/.test(e.message)) throw e;
        if (attempt === 0) {
          // 等 800ms 后重试
          await new Promise(r => setTimeout(r, 800));
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
      return data.choices[0].message.content;
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
   * 本地回退处理（AI不可用时）
   * @param {string} actionType
   * @param {object} actionData
   * @param {object} gameState
   * @returns {object}
   */
  _localFallback(actionType, actionData, gameState) {
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

      default:
        narrative = '...';
    }

    gameState.addNarrative('gm', narrative);
    return { narrative, actions: [], diceRequests: [], diceResults: [] };
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
