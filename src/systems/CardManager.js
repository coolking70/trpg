/**
 * 卡牌管理系统
 * 负责所有类型卡牌的增删查改和校验
 */

import { GameSystem } from '../core/GameEngine.js';
import { CharacterCard } from '../models/CharacterCard.js';
import { EnemyCard } from '../models/EnemyCard.js';
import { EventCard } from '../models/EventCard.js';
import { ItemCard } from '../models/ItemCard.js';

/** 卡牌类型到构造器的映射 */
const CARD_CONSTRUCTORS = {
  character: CharacterCard,
  enemy: EnemyCard,
  event: EventCard,
  item: ItemCard,
};

export class CardManager extends GameSystem {
  constructor() {
    super('CardManager');

    /** @type {Map<string, object>} 所有卡牌按ID索引 */
    this.cards = new Map();

    /** @type {Map<string, Set<string>>} 按类型分组的卡牌ID集合 */
    this.cardsByType = new Map([
      ['character', new Set()],
      ['enemy', new Set()],
      ['event', new Set()],
      ['item', new Set()],
    ]);
  }

  /**
   * 添加一张卡牌
   * @param {object} cardData - 卡牌数据
   * @returns {object} 创建的卡牌实例
   */
  addCard(cardData) {
    const Constructor = CARD_CONSTRUCTORS[cardData.type];
    if (!Constructor) {
      throw new Error(`未知的卡牌类型: ${cardData.type}`);
    }

    const card = cardData instanceof Constructor ? cardData : new Constructor(cardData);
    this.cards.set(card.id, card);

    const typeSet = this.cardsByType.get(card.type);
    if (typeSet) typeSet.add(card.id);

    return card;
  }

  /**
   * 批量添加卡牌
   * @param {object[]} cardsData
   */
  addCards(cardsData) {
    for (const data of cardsData) {
      this.addCard(data);
    }
  }

  /**
   * 移除一张卡牌
   * @param {string} id
   * @returns {boolean}
   */
  removeCard(id) {
    const card = this.cards.get(id);
    if (!card) return false;

    this.cards.delete(id);
    const typeSet = this.cardsByType.get(card.type);
    if (typeSet) typeSet.delete(id);

    return true;
  }

  /**
   * 根据ID获取卡牌
   * @param {string} id
   * @returns {object|undefined}
   */
  getCard(id) {
    return this.cards.get(id);
  }

  /**
   * 获取指定类型的所有卡牌
   * @param {string} type - 'character' | 'enemy' | 'event' | 'item'
   * @returns {object[]}
   */
  getCardsByType(type) {
    const ids = this.cardsByType.get(type);
    if (!ids) return [];
    return Array.from(ids).map(id => this.cards.get(id)).filter(Boolean);
  }

  /**
   * 根据标签查找卡牌
   * @param {string} tag
   * @returns {object[]}
   */
  getCardsByTag(tag) {
    const results = [];
    for (const card of this.cards.values()) {
      if (card.tags && card.tags.includes(tag)) {
        results.push(card);
      }
    }
    return results;
  }

  /**
   * 从GamePreset加载所有卡牌
   * @param {object} preset - GamePreset数据
   */
  loadFromPreset(preset) {
    this.clear();

    for (const char of (preset.characters || [])) {
      this.addCard({ ...char, type: 'character' });
    }
    for (const enemy of (preset.enemies || [])) {
      this.addCard({ ...enemy, type: 'enemy' });
    }
    for (const event of (preset.events || [])) {
      this.addCard({ ...event, type: 'event' });
    }
    for (const item of (preset.items || [])) {
      this.addCard({ ...item, type: 'item' });
    }
  }

  /** 清空所有卡牌 */
  clear() {
    this.cards.clear();
    for (const set of this.cardsByType.values()) {
      set.clear();
    }
  }

  /** 获取卡牌总数 */
  getCardCount() {
    return this.cards.size;
  }

  /** 获取各类型卡牌数量 */
  getCountByType() {
    const counts = {};
    for (const [type, ids] of this.cardsByType) {
      counts[type] = ids.size;
    }
    return counts;
  }
}
