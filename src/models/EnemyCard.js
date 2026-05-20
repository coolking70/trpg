/**
 * 敌人卡模型
 * 定义敌方单位的属性、行为提示和掉落表
 */

import { generateId } from '../utils/idGenerator.js';
import { deepClone } from '../utils/deepClone.js';

function createDefaultStats() {
  return {
    hp: 50,
    hpCurrent: 50,
    mp: 0,
    mpCurrent: 0,
    attack: 8,
    defense: 5,
    magicAttack: 3,
    magicDefense: 3,
    speed: 6,
    luck: 2,
  };
}

export class EnemyCard {
  constructor(data = {}) {
    this.id = data.id || generateId('enemy');
    this.type = 'enemy';
    this.name = data.name || '未命名敌人';
    this.description = data.description || '';
    this.image = data.image || '';

    this.stats = { ...createDefaultStats(), ...(data.stats || {}) };
    this.abilities = (data.abilities || []).map(a => ({ ...a }));

    // 掉落表
    this.lootTable = (data.lootTable || []).map(l => ({ ...l }));

    // AI行为提示：aggressive | defensive | random | support
    this.behaviorHint = data.behaviorHint || 'aggressive';

    // 奖励
    this.experienceReward = data.experienceReward || 10;

    // 难度：easy | normal | hard | boss
    this.difficulty = data.difficulty || 'normal';

    this.position = { x: 0, y: 0, ...(data.position || {}) };
    this.statusEffects = [...(data.statusEffects || [])];
    this.tags = [...(data.tags || [])];
    this.notes = data.notes || '';
  }

  isAlive() {
    return this.stats.hpCurrent > 0;
  }

  takeDamage(amount) {
    const actual = Math.min(this.stats.hpCurrent, Math.max(0, Math.floor(amount)));
    this.stats.hpCurrent -= actual;
    return actual;
  }

  heal(amount) {
    const maxHeal = this.stats.hp - this.stats.hpCurrent;
    const actual = Math.min(maxHeal, Math.max(0, Math.floor(amount)));
    this.stats.hpCurrent += actual;
    return actual;
  }

  /**
   * 从掉落表中随机获取掉落物
   * @returns {string[]} 掉落的道具ID列表
   */
  rollLoot() {
    const drops = [];
    for (const entry of this.lootTable) {
      if (Math.random() <= entry.dropRate) {
        drops.push(entry.itemId);
      }
    }
    return drops;
  }

  /** 压缩格式（用于AI提示词） */
  toCompactString() {
    const s = this.stats;
    return `${this.name}[${this.difficulty}] HP:${s.hpCurrent}/${s.hp} ATK:${s.attack} DEF:${s.defense} SPD:${s.speed} 行为:${this.behaviorHint}`;
  }

  clone() {
    return new EnemyCard(this.toJSON());
  }

  toJSON() {
    return deepClone({
      id: this.id,
      type: this.type,
      name: this.name,
      description: this.description,
      image: this.image,
      stats: this.stats,
      abilities: this.abilities,
      lootTable: this.lootTable,
      behaviorHint: this.behaviorHint,
      experienceReward: this.experienceReward,
      difficulty: this.difficulty,
      position: this.position,
      statusEffects: this.statusEffects,
      tags: this.tags,
      notes: this.notes,
    });
  }

  static fromJSON(json) {
    return new EnemyCard(json);
  }
}
