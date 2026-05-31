/**
 * AI响应解析器
 * 解析AI返回的JSON并转化为游戏操作
 */

export class AIResponseParser {
  /**
   * 解析AI响应文本
   * @param {string} responseText - AI返回的原始文本
   * @returns {object} 解析后的结构化响应
   */
  parse(responseText) {
    if (!responseText) {
      return this._fallback('AI未返回内容');
    }

    // 尝试直接解析JSON
    try {
      const parsed = JSON.parse(responseText);
      return this._normalize(parsed);
    } catch (e) {
      // 尝试从markdown代码块中提取JSON
      const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          return this._normalize(parsed);
        } catch (e2) {
          // 继续尝试
        }
      }

      // 尝试找到第一个 { 和最后一个 } 之间的内容
      const firstBrace = responseText.indexOf('{');
      const lastBrace = responseText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          const parsed = JSON.parse(responseText.substring(firstBrace, lastBrace + 1));
          return this._normalize(parsed);
        } catch (e3) {
          // 放弃
        }
      }

      // 最终回退：尝试用宽松正则从损坏的 JSON 中抽出 narrative 字段
      // （AI 偶尔会在叙事中夹未转义的双引号导致 JSON.parse 失败）
      const lenient = this._tryExtractLenient(responseText);
      if (lenient) return lenient;

      // 还是不行就把整个文本作为叙事
      return this._fallback(responseText);
    }
  }

  /**
   * 宽松提取：从形如 `{ "narrative": "...", "actions": [...] }` 的损坏 JSON 中
   * 抽出 narrative 字段。容忍 narrative 内部未转义的引号。
   */
  _tryExtractLenient(text) {
    // 必须长得像 JSON 才尝试
    if (!/[{[]/.test(text)) return null;
    if (!/"narrative"\s*:/.test(text)) return null;

    // 从 "narrative": 后开始找内容，截至下一个未转义的 ", 后跟逗号/换行/} 的位置
    // 简化策略：找 `"narrative": "` 后到 `",\n` 或 `"\n  "actions"` 之前
    const startMatch = text.match(/"narrative"\s*:\s*"/);
    if (!startMatch) return null;
    const startIdx = startMatch.index + startMatch[0].length;

    // 找终止：尝试匹配 `",<空白>"<下一个标准字段>"`（兼容单行 / 多行 JSON）
    // 或文末的 `"}` 收尾
    const tail = text.slice(startIdx);
    let endRel = -1;
    for (const re of [
      /",\s*"actions"\s*:/,
      /",\s*"diceRequests"\s*:/,
      /",\s*"stateUpdate"\s*:/,
      /",\s*"creativeOutcome"\s*:/,
      /"\s*}\s*$/,
    ]) {
      const m = tail.match(re);
      if (m && (endRel === -1 || m.index < endRel)) endRel = m.index;
    }
    if (endRel === -1) return null;

    const narrative = tail.slice(0, endRel)
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"');

    return {
      narrative,
      actions: [],
      diceRequests: [],
      stateUpdate: null,
      creativeOutcome: null,
    };
  }

  /**
   * 标准化解析结果
   */
  _normalize(parsed) {
    const narrative = parsed.narrative
      ?? parsed.narr
      ?? parsed.story
      ?? parsed.text
      ?? '';
    return {
      narrative: typeof narrative === 'string' ? narrative : '',
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      diceRequests: Array.isArray(parsed.diceRequests) ? parsed.diceRequests : [],
      stateUpdate: parsed.stateUpdate || null,
      creativeOutcome: this._normalizeCreativeOutcome(parsed.creativeOutcome),
    };
  }

  /**
   * 标准化 creativeOutcome 结构（容错）
   */
  _normalizeCreativeOutcome(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const dc = parseInt(raw.dc);
    if (isNaN(dc) || dc < 1 || dc > 40) return null;
    return {
      dc,
      formula: typeof raw.formula === 'string' ? raw.formula : 'd20',
      onSuccess: {
        narrative: (raw.onSuccess && raw.onSuccess.narrative) || '',
        actions: (raw.onSuccess && Array.isArray(raw.onSuccess.actions)) ? raw.onSuccess.actions : [],
      },
      onFail: {
        narrative: (raw.onFail && raw.onFail.narrative) || '',
        actions: (raw.onFail && Array.isArray(raw.onFail.actions)) ? raw.onFail.actions : [],
      },
    };
  }

  /**
   * 回退响应
   * 防御性清洗：如果文本一看就像 JSON 残片（含 "narrative":），最少把这层壳剥掉，
   * 避免在游戏 UI 里直接秀出 `{"narrative":"..."` 这种露馅文本
   */
  _fallback(text) {
    let narrative = text;
    if (typeof narrative === 'string') {
      // 去掉首尾大括号
      narrative = narrative.trim().replace(/^\{+\s*/, '').replace(/\s*\}+$/, '');
      // 如果还能看出 "narrative":"..." 残片，剥掉前缀
      const head = narrative.match(/^\s*"narrative"\s*:\s*"/);
      if (head) narrative = narrative.slice(head[0].length);
      // 抹掉尾部常见 JSON 字段残骸
      narrative = narrative
        .replace(/",?\s*"actions"\s*:[\s\S]*$/, '')
        .replace(/",?\s*"diceRequests"\s*:[\s\S]*$/, '')
        .replace(/",?\s*"stateUpdate"\s*:[\s\S]*$/, '')
        .replace(/",?\s*"creativeOutcome"\s*:[\s\S]*$/, '');
      // 反转义
      narrative = narrative.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
    }
    return {
      narrative,
      actions: [],
      diceRequests: [],
      stateUpdate: null,
      creativeOutcome: null,
    };
  }

  /**
   * 应用游戏操作（带合法性校验）
   * @param {Array} actions - 操作列表
   * @param {object} gameState - 游戏状态
   * @param {object} eventSystem - 事件系统
   * @param {object} [cardManager] - 卡牌管理器（用于校验ID引用）
   */
  applyActions(actions, gameState, eventSystem, cardManager = null) {
    for (const action of actions) {
      try {
        const validation = this._validateAction(action, gameState, cardManager);
        if (!validation.valid) {
          console.warn('AI action 已丢弃:', validation.reason, action);
          continue;
        }
        this._applyAction(action, gameState, eventSystem);
      } catch (e) {
        console.error('应用AI操作失败:', action, e);
      }
    }
  }

  /**
   * 校验单个 AI action 的合法性
   * 防止 AI 编造不存在的实体/物品/事件，或返回越界数值
   * @returns {{valid: boolean, reason: string}}
   */
  _validateAction(action, gameState, cardManager) {
    if (!action || typeof action !== 'object' || !action.type) {
      return { valid: false, reason: '缺少 type 字段' };
    }

    switch (action.type) {
      case 'damage':
      case 'heal': {
        const value = parseInt(action.value);
        if (isNaN(value) || value < 0 || value > 100) {
          return { valid: false, reason: `${action.type} value 超出合理范围 [0,100]` };
        }
        if (action.target && !this._findEntity(gameState, action.target)) {
          return { valid: false, reason: `target ${action.target} 不存在` };
        }
        return { valid: true, reason: '' };
      }

      case 'add_item':
      case 'remove_item': {
        const itemId = action.value || action.itemId;
        if (!itemId || typeof itemId !== 'string') {
          return { valid: false, reason: '缺少 itemId' };
        }
        if (cardManager) {
          const card = cardManager.getCard(itemId);
          if (!card || card.type !== 'item') {
            return { valid: false, reason: `item ${itemId} 不存在` };
          }
        }
        return { valid: true, reason: '' };
      }

      case 'start_combat': {
        const enemyIds = action.value || action.enemyIds || [];
        if (!Array.isArray(enemyIds) || enemyIds.length === 0) {
          return { valid: false, reason: 'enemyIds 必须是非空数组' };
        }
        if (cardManager) {
          for (const id of enemyIds) {
            const card = cardManager.getCard(id);
            if (!card || card.type !== 'enemy') {
              return { valid: false, reason: `enemy ${id} 不存在` };
            }
          }
        }
        return { valid: true, reason: '' };
      }

      case 'end_combat':
        return { valid: true, reason: '' };

      case 'trigger_event': {
        const eventId = action.value || action.eventId;
        if (!eventId || typeof eventId !== 'string') {
          return { valid: false, reason: '缺少 eventId' };
        }
        if (cardManager) {
          const card = cardManager.getCard(eventId);
          if (!card || card.type !== 'event') {
            return { valid: false, reason: `event ${eventId} 不存在` };
          }
        }
        return { valid: true, reason: '' };
      }

      case 'set_variable': {
        if (!action.target || typeof action.target !== 'string') {
          return { valid: false, reason: 'set_variable 缺少 target' };
        }
        if (action.value === undefined) {
          return { valid: false, reason: 'set_variable 缺少 value' };
        }
        return { valid: true, reason: '' };
      }

      case 'add_memory': {
        if (!action.value || typeof action.value !== 'string') {
          return { valid: false, reason: 'add_memory 缺少 value (摘要文本)' };
        }
        if (action.value.length > 200) {
          return { valid: false, reason: 'add_memory value 太长 (> 200 字)' };
        }
        return { valid: true, reason: '' };
      }

      default:
        return { valid: false, reason: `未知 action 类型: ${action.type}` };
    }
  }

  _applyAction(action, gameState, eventSystem) {
    switch (action.type) {
      case 'damage': {
        const target = this._findEntity(gameState, action.target);
        if (target && target.stats) {
          const amount = Math.max(0, parseInt(action.value) || 0);
          target.stats.hpCurrent = Math.max(0, target.stats.hpCurrent - amount);
        }
        break;
      }

      case 'heal': {
        const target = this._findEntity(gameState, action.target);
        if (target && target.stats) {
          const amount = Math.max(0, parseInt(action.value) || 0);
          target.stats.hpCurrent = Math.min(target.stats.hp, target.stats.hpCurrent + amount);
        }
        break;
      }

      case 'add_item': {
        const itemId = action.value || action.itemId;
        if (itemId && gameState.activeCharacters.length > 0) {
          const char = gameState.activeCharacters[0];
          if (!char.inventory) char.inventory = [];
          char.inventory.push(itemId);
        }
        break;
      }

      case 'remove_item': {
        const itemId = action.value || action.itemId;
        if (itemId && gameState.activeCharacters.length > 0) {
          for (const char of gameState.activeCharacters) {
            const idx = (char.inventory || []).indexOf(itemId);
            if (idx !== -1) {
              char.inventory.splice(idx, 1);
              break;
            }
          }
        }
        break;
      }

      case 'start_combat': {
        if (eventSystem) {
          eventSystem.publish('combat:startRequest', {
            enemyIds: action.value || action.enemyIds || [],
          });
        }
        break;
      }

      case 'end_combat': {
        if (eventSystem) {
          eventSystem.publish('combat:endRequest', {
            result: action.value || 'victory',
          });
        }
        break;
      }

      case 'trigger_event': {
        if (eventSystem) {
          eventSystem.publish('event:triggerRequest', {
            eventId: action.value || action.eventId,
          });
        }
        break;
      }

      case 'set_variable': {
        if (action.target && action.value !== undefined) {
          if (!gameState.variables) gameState.variables = {};
          gameState.variables[action.target] = action.value;
          if (eventSystem) {
            eventSystem.publish('game:variableChanged', { name: action.target, value: action.value });
          }
        }
        break;
      }

      case 'add_memory': {
        // AI 主动标记重要事件供长期记忆持有
        if (eventSystem && action.value) {
          eventSystem.publish('memory:addRequest', {
            summary: String(action.value),
            tags: Array.isArray(action.tags) ? action.tags : ['ai'],
          });
        }
        break;
      }

      default:
        console.warn('未知的AI操作类型:', action.type);
    }
  }

  /**
   * 应用骰子请求
   * @param {Array} diceRequests
   * @param {object} diceSystem
   * @returns {Array} 骰子结果列表
   */
  applyDiceRequests(diceRequests, diceSystem) {
    const results = [];
    for (const req of diceRequests) {
      try {
        const formula = req.formula || 'd20';
        const result = req.target
          ? diceSystem.rollCheck(formula, req.target)
          : diceSystem.roll(formula);
        result.reason = req.reason || '';
        results.push(result);
      } catch (e) {
        console.error('骰子请求处理失败:', req, e);
      }
    }
    return results;
  }

  /**
   * 应用状态更新
   * @param {object} stateUpdate
   * @param {object} gameState
   */
  applyStateUpdate(stateUpdate, gameState) {
    if (!stateUpdate) return;
    if (stateUpdate.phase) {
      gameState.currentPhase = stateUpdate.phase;
    }
  }

  /**
   * 在游戏状态中查找实体
   */
  _findEntity(gameState, id) {
    if (!id) return null;
    // 角色
    const char = (gameState.activeCharacters || []).find(c => c.id === id);
    if (char) return char;
    // 战斗敌人
    if (gameState.activeCombat) {
      const enemy = (gameState.activeCombat.enemies || []).find(e => e.id === id);
      if (enemy) return enemy;
    }
    return null;
  }
}
