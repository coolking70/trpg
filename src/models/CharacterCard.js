/**
 * 角色卡模型
 * 定义玩家角色的所有属性和行为
 */

import { generateId } from '../utils/idGenerator.js';
import { deepClone } from '../utils/deepClone.js';

/**
 * 创建默认属性
 */
function createDefaultStats() {
  return {
    hp: 100,
    hpCurrent: 100,
    mp: 50,
    mpCurrent: 50,
    attack: 10,
    defense: 8,
    magicAttack: 5,
    magicDefense: 5,
    speed: 10,
    luck: 5,
  };
}

export class CharacterCard {
  /**
   * @param {object} data - 角色卡数据
   */
  constructor(data = {}) {
    this.id = data.id || generateId('char');
    this.type = 'character';
    this.name = data.name || '未命名角色';
    this.title = data.title || '';
    this.description = data.description || '';
    this.image = data.image || '';

    // 属性
    this.stats = { ...createDefaultStats(), ...(data.stats || {}) };

    // 技能列表
    this.abilities = (data.abilities || []).map(a => ({ ...a }));

    // 装备栏
    this.equipment = {
      weapon: null,
      armor: null,
      accessory: null,
      ...(data.equipment || {}),
    };

    // 背包（道具卡ID列表）
    this.inventory = [...(data.inventory || [])];

    // 地图上的位置
    this.position = { x: 0, y: 0, ...(data.position || {}) };

    // 等级与经验
    this.level = data.level || 1;
    this.experience = data.experience || 0;

    // 状态效果
    this.statusEffects = [...(data.statusEffects || [])];

    // 标签和备注
    this.tags = [...(data.tags || [])];
    this.notes = data.notes || '';
  }

  /** 角色是否存活 */
  isAlive() {
    return this.stats.hpCurrent > 0;
  }

  /**
   * 受到伤害
   * @param {number} amount - 伤害量（已经过防御计算的净伤害）
   * @returns {number} 实际扣除的HP
   */
  takeDamage(amount) {
    const actual = Math.min(this.stats.hpCurrent, Math.max(0, Math.floor(amount)));
    this.stats.hpCurrent -= actual;
    return actual;
  }

  /**
   * 治疗
   * @param {number} amount - 治疗量
   * @returns {number} 实际恢复的HP
   */
  heal(amount) {
    const maxHeal = this.stats.hp - this.stats.hpCurrent;
    const actual = Math.min(maxHeal, Math.max(0, Math.floor(amount)));
    this.stats.hpCurrent += actual;
    return actual;
  }

  /**
   * 消耗MP
   * @param {number} amount - 消耗量
   * @returns {boolean} 是否消耗成功
   */
  spendMp(amount) {
    if (this.stats.mpCurrent < amount) return false;
    this.stats.mpCurrent -= amount;
    return true;
  }

  /**
   * 恢复MP
   * @param {number} amount - 恢复量
   * @returns {number} 实际恢复的MP
   */
  restoreMp(amount) {
    const maxRestore = this.stats.mp - this.stats.mpCurrent;
    const actual = Math.min(maxRestore, Math.max(0, Math.floor(amount)));
    this.stats.mpCurrent += actual;
    return actual;
  }

  /**
   * 获取压缩格式的属性字符串（用于AI提示词）
   * @returns {string}
   */
  toCompactString() {
    const s = this.stats;
    const abilities = this.abilities.map(a => a.name).join(',');
    return `${this.name} L${this.level} HP:${s.hpCurrent}/${s.hp} MP:${s.mpCurrent}/${s.mp} ATK:${s.attack} DEF:${s.defense} MATK:${s.magicAttack} MDEF:${s.magicDefense} SPD:${s.speed} LCK:${s.luck} [${abilities}]`;
  }

  /** 深拷贝 */
  clone() {
    return new CharacterCard(this.toJSON());
  }

  /** 序列化为纯对象 */
  toJSON() {
    return deepClone({
      id: this.id,
      type: this.type,
      name: this.name,
      title: this.title,
      description: this.description,
      image: this.image,
      stats: this.stats,
      abilities: this.abilities,
      equipment: this.equipment,
      inventory: this.inventory,
      position: this.position,
      level: this.level,
      experience: this.experience,
      statusEffects: this.statusEffects,
      tags: this.tags,
      notes: this.notes,
    });
  }

  /**
   * 从纯对象创建实例
   * @param {object} json
   * @returns {CharacterCard}
   */
  static fromJSON(json) {
    return new CharacterCard(json);
  }
}
