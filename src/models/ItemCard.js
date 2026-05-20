/**
 * 道具卡模型
 * 定义武器、防具、消耗品、任务物品等
 */

import { generateId } from '../utils/idGenerator.js';
import { deepClone } from '../utils/deepClone.js';

export class ItemCard {
  constructor(data = {}) {
    this.id = data.id || generateId('item');
    this.type = 'item';
    this.name = data.name || '未命名道具';
    this.description = data.description || '';
    this.image = data.image || '';

    // 道具类型：weapon | armor | accessory | consumable | quest | material
    this.itemType = data.itemType || 'material';

    // 装备后的属性修正（对应 CharacterCard.stats 的字段）
    this.statModifiers = data.statModifiers || {};

    // 消耗品效果
    this.consumeEffect = data.consumeEffect || null;
    // 示例: { type: 'heal', stat: 'hp', value: 30 }
    // 示例: { type: 'heal', stat: 'mp', value: 20 }
    // 示例: { type: 'buff', stat: 'attack', value: 5, duration: 3 }

    // 装备栏位：weapon | armor | accessory | null
    this.equipSlot = data.equipSlot || null;

    // 经济
    this.buyPrice = data.buyPrice || 0;
    this.sellPrice = data.sellPrice || 0;

    // 堆叠
    this.stackable = data.stackable !== undefined ? data.stackable : false;
    this.maxStack = data.maxStack || 1;

    this.tags = [...(data.tags || [])];
    this.notes = data.notes || '';
  }

  /** 是否可装备 */
  isEquippable() {
    return this.equipSlot !== null;
  }

  /** 是否是消耗品 */
  isConsumable() {
    return this.itemType === 'consumable' && this.consumeEffect !== null;
  }

  /** 压缩格式（用于AI提示词） */
  toCompactString() {
    const mods = Object.entries(this.statModifiers)
      .map(([k, v]) => `${k}:${v > 0 ? '+' : ''}${v}`)
      .join(' ');
    return `${this.name}(${this.itemType}) ${mods}`.trim();
  }

  clone() {
    return new ItemCard(this.toJSON());
  }

  toJSON() {
    return deepClone({
      id: this.id,
      type: this.type,
      name: this.name,
      description: this.description,
      image: this.image,
      itemType: this.itemType,
      statModifiers: this.statModifiers,
      consumeEffect: this.consumeEffect,
      equipSlot: this.equipSlot,
      buyPrice: this.buyPrice,
      sellPrice: this.sellPrice,
      stackable: this.stackable,
      maxStack: this.maxStack,
      tags: this.tags,
      notes: this.notes,
    });
  }

  static fromJSON(json) {
    return new ItemCard(json);
  }
}
