/**
 * 事件卡模型
 * 定义故事事件、遭遇、陷阱、宝箱等
 */

import { generateId } from '../utils/idGenerator.js';
import { deepClone } from '../utils/deepClone.js';

export class EventCard {
  constructor(data = {}) {
    this.id = data.id || generateId('event');
    this.type = 'event';
    this.name = data.name || '未命名事件';
    this.description = data.description || '';
    this.image = data.image || '';

    // 事件类型：encounter | story | trap | treasure | rest | shop | boss
    this.eventType = data.eventType || 'encounter';

    // 触发条件
    this.trigger = data.trigger || {
      type: 'manual', // map_tile | turn_number | hp_threshold | manual | random
      condition: {},
    };

    // 玩家选项
    this.choices = (data.choices || []).map(c => deepClone(c));

    // 是否可重复触发
    this.repeatable = data.repeatable !== undefined ? data.repeatable : false;
    this.maxOccurrences = data.maxOccurrences || 1;

    // AI叙事风格提示
    this.aiPromptHint = data.aiPromptHint || '';

    // 商店配置（仅 eventType='shop' 时使用）
    // shop: { inventory: [{itemId, price, stock}], sellMultiplier: 0.5 }
    this.shop = data.shop ? {
      inventory: (data.shop.inventory || []).map(e => ({ ...e })),
      sellMultiplier: data.shop.sellMultiplier !== undefined ? data.shop.sellMultiplier : 0.5,
    } : null;

    // 触发优先级（多个事件同时匹配时高优先级先触发）
    this.priority = data.priority || 0;

    this.tags = [...(data.tags || [])];
    this.notes = data.notes || '';
  }

  /**
   * 检查是否可以在指定地块上触发
   * @param {string} tileType - 地块类型
   * @param {number} completedCount - 已触发次数
   * @returns {boolean}
   */
  canTriggerOnTile(tileType, completedCount = 0) {
    if (!this.repeatable && completedCount >= this.maxOccurrences) return false;
    if (this.trigger.type !== 'map_tile') return false;

    const cond = this.trigger.condition;
    if (cond.tileTypes && !cond.tileTypes.includes(tileType)) return false;

    // 概率检测
    if (cond.probability !== undefined) {
      return Math.random() <= cond.probability;
    }
    return true;
  }

  /**
   * 获取指定选项的随机结果
   * @param {string} choiceId - 选项ID
   * @returns {object|null} 结果对象
   */
  resolveChoice(choiceId) {
    const choice = this.choices.find(c => c.id === choiceId);
    if (!choice || !choice.outcomes || choice.outcomes.length === 0) return null;

    // 根据概率选择结果
    const roll = Math.random();
    let cumulative = 0;
    for (const outcome of choice.outcomes) {
      cumulative += outcome.probability;
      if (roll <= cumulative) {
        return deepClone(outcome);
      }
    }
    // 兜底：返回最后一个
    return deepClone(choice.outcomes[choice.outcomes.length - 1]);
  }

  /** 压缩格式（用于AI提示词） */
  toCompactString() {
    const choiceTexts = this.choices.map(c => c.text).join('|');
    return `[${this.eventType}]${this.name}: ${this.description.substring(0, 50)}... 选项:[${choiceTexts}]`;
  }

  clone() {
    return new EventCard(this.toJSON());
  }

  toJSON() {
    return deepClone({
      id: this.id,
      type: this.type,
      name: this.name,
      description: this.description,
      image: this.image,
      eventType: this.eventType,
      trigger: this.trigger,
      choices: this.choices,
      repeatable: this.repeatable,
      maxOccurrences: this.maxOccurrences,
      aiPromptHint: this.aiPromptHint,
      shop: this.shop,
      priority: this.priority,
      tags: this.tags,
      notes: this.notes,
    });
  }

  static fromJSON(json) {
    return new EventCard(json);
  }
}
