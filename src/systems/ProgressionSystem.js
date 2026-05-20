/**
 * 角色成长系统
 * 集中处理经验/升级 + 道具使用 + 装备替换
 * 通过事件系统向外发布 character:levelUp / item:used 等
 */

import { GameSystem } from '../core/GameEngine.js';

/** 升级所需经验：currentLevel * 50（调整后比原 100 节奏快 1 倍） */
export function getExperienceForNextLevel(currentLevel) {
  return Math.max(1, currentLevel) * 50;
}

/**
 * 应用一次升级的属性增长
 * @param {object} char - CharacterCard 数据
 * @returns {object} 增长摘要
 */
function applyLevelUpGrowth(char) {
  const before = {
    hp: char.stats.hp, mp: char.stats.mp,
    attack: char.stats.attack, defense: char.stats.defense,
    magicAttack: char.stats.magicAttack, magicDefense: char.stats.magicDefense,
    speed: char.stats.speed, luck: char.stats.luck,
  };

  char.level = (char.level || 1) + 1;
  char.stats.hp = Math.floor(char.stats.hp * 1.10);
  char.stats.mp = Math.floor(char.stats.mp * 1.10);
  char.stats.attack += 1;
  char.stats.defense += 1;
  char.stats.magicAttack += 1;
  char.stats.magicDefense += 1;
  // 速度和幸运每 2 级 +1
  if (char.level % 2 === 0) {
    char.stats.speed += 1;
    char.stats.luck += 1;
  }
  // 全恢复 HP/MP (RPG 惯例)
  char.stats.hpCurrent = char.stats.hp;
  char.stats.mpCurrent = char.stats.mp;

  return {
    hp: char.stats.hp - before.hp,
    mp: char.stats.mp - before.mp,
    attack: char.stats.attack - before.attack,
    defense: char.stats.defense - before.defense,
    magicAttack: char.stats.magicAttack - before.magicAttack,
    magicDefense: char.stats.magicDefense - before.magicDefense,
    speed: char.stats.speed - before.speed,
    luck: char.stats.luck - before.luck,
  };
}

export class ProgressionSystem extends GameSystem {
  constructor() {
    super('ProgressionSystem');
    this.eventSystem = null;
    this.cardManager = null;
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.eventSystem = gameEngine.getSystem('EventSystem');
    this.cardManager = gameEngine.getSystem('CardManager');
  }

  /**
   * 给角色加经验，自动处理可能的连续升级
   * @param {object} character - 角色数据（GameState.activeCharacters 中的对象）
   * @param {number} amount - 经验增量
   * @returns {{leveledUp: boolean, fromLevel: number, toLevel: number, growthSummary: object[]}}
   */
  grantExperience(character, amount) {
    if (!character || !amount || amount <= 0) {
      return { leveledUp: false };
    }

    const fromLevel = character.level || 1;
    character.experience = (character.experience || 0) + amount;

    const growthSummary = [];
    while (character.experience >= getExperienceForNextLevel(character.level || 1)) {
      character.experience -= getExperienceForNextLevel(character.level || 1);
      const delta = applyLevelUpGrowth(character);
      growthSummary.push({ level: character.level, delta });
    }

    const leveledUp = growthSummary.length > 0;

    if (this.eventSystem) {
      this.eventSystem.publish('character:expGained', {
        characterId: character.id,
        characterName: character.name,
        amount,
        newExperience: character.experience,
      });

      if (leveledUp) {
        this.eventSystem.publish('character:levelUp', {
          characterId: character.id,
          characterName: character.name,
          fromLevel,
          toLevel: character.level,
          growthSummary,
        });
      }
    }

    return { leveledUp, fromLevel, toLevel: character.level, growthSummary };
  }

  /**
   * 使用道具
   * @param {object} gameState
   * @param {string} itemId - 道具卡 ID
   * @param {string} ownerCharId - 持有者角色 ID
   * @param {string} targetCharId - 使用目标角色 ID
   * @returns {{success: boolean, reason?: string, effect?: object}}
   */
  useItem(gameState, itemId, ownerCharId, targetCharId) {
    const item = this.cardManager ? this.cardManager.getCard(itemId) : null;
    if (!item || item.type !== 'item') {
      return { success: false, reason: '道具不存在' };
    }
    if (!item.consumeEffect) {
      return { success: false, reason: '该道具不可使用' };
    }

    const owner = gameState.activeCharacters.find(c => c.id === ownerCharId);
    if (!owner || !owner.inventory) return { success: false, reason: '持有者不存在' };
    const slotIdx = owner.inventory.indexOf(itemId);
    if (slotIdx === -1) return { success: false, reason: '持有者背包中没有该道具' };

    const target = gameState.activeCharacters.find(c => c.id === targetCharId) || owner;

    const eff = item.consumeEffect;
    const summary = { itemId, itemName: item.name, ownerName: owner.name, targetName: target.name };

    switch (eff.type) {
      case 'heal': {
        const stat = eff.stat || 'hp';
        const value = eff.value || 0;
        if (stat === 'hp') {
          const before = target.stats.hpCurrent;
          target.stats.hpCurrent = Math.min(target.stats.hp, target.stats.hpCurrent + value);
          summary.hpRestored = target.stats.hpCurrent - before;
        } else if (stat === 'mp') {
          const before = target.stats.mpCurrent;
          target.stats.mpCurrent = Math.min(target.stats.mp, target.stats.mpCurrent + value);
          summary.mpRestored = target.stats.mpCurrent - before;
        }
        break;
      }
      case 'buff': {
        if (!target.statusEffects) target.statusEffects = [];
        target.statusEffects.push({
          type: 'buff',
          stat: eff.stat,
          value: eff.value,
          duration: eff.duration || 3,
        });
        summary.buffApplied = `${eff.stat}+${eff.value} (${eff.duration || 3}回合)`;
        break;
      }
      default:
        return { success: false, reason: `未知效果类型: ${eff.type}` };
    }

    // 从背包移除
    owner.inventory.splice(slotIdx, 1);

    if (this.eventSystem) {
      this.eventSystem.publish('item:used', summary);
    }

    return { success: true, effect: summary };
  }

  /**
   * 装备道具到角色身上（自动卸下原装备并交换到背包）
   * @returns {{success, reason?, equippedItem?, unequippedItem?}}
   */
  equipItem(gameState, itemId, ownerCharId) {
    const card = this.cardManager ? this.cardManager.getCard(itemId) : null;
    if (!card || card.type !== 'item') return { success: false, reason: '道具不存在' };
    if (!card.equipSlot) return { success: false, reason: '该道具不可装备' };

    const char = gameState.activeCharacters.find(c => c.id === ownerCharId);
    if (!char) return { success: false, reason: '角色不存在' };

    if (!char.inventory) char.inventory = [];
    const itemIdx = char.inventory.indexOf(itemId);
    if (itemIdx === -1) return { success: false, reason: '不在背包中' };

    if (!char.equipment) char.equipment = { weapon: null, armor: null, accessory: null };
    const slot = card.equipSlot;

    // 先卸下原装备（属性回退、移回背包）
    let unequippedItem = null;
    const currentId = char.equipment[slot];
    if (currentId) {
      const currentCard = this.cardManager.getCard(currentId);
      if (currentCard) this._applyStatModifiers(char, currentCard.statModifiers, -1);
      char.inventory.push(currentId);
      unequippedItem = currentId;
    }

    // 装备新道具
    char.equipment[slot] = itemId;
    char.inventory.splice(itemIdx, 1);
    this._applyStatModifiers(char, card.statModifiers, +1);

    // 当前 HP/MP 钳制到新上限
    char.stats.hpCurrent = Math.min(char.stats.hpCurrent, char.stats.hp);
    char.stats.mpCurrent = Math.min(char.stats.mpCurrent, char.stats.mp);

    if (this.eventSystem) {
      this.eventSystem.publish('item:equipped', {
        characterId: char.id, characterName: char.name,
        itemId, itemName: card.name, slot, unequippedItem,
      });
    }
    return { success: true, equippedItem: itemId, unequippedItem };
  }

  /**
   * 卸下指定槽位的装备
   */
  unequipItem(gameState, slot, ownerCharId) {
    const char = gameState.activeCharacters.find(c => c.id === ownerCharId);
    if (!char || !char.equipment) return { success: false, reason: '角色或装备不存在' };

    const itemId = char.equipment[slot];
    if (!itemId) return { success: false, reason: '该槽位为空' };

    const card = this.cardManager.getCard(itemId);
    if (card) this._applyStatModifiers(char, card.statModifiers, -1);

    char.equipment[slot] = null;
    if (!char.inventory) char.inventory = [];
    char.inventory.push(itemId);

    char.stats.hpCurrent = Math.min(char.stats.hpCurrent, char.stats.hp);
    char.stats.mpCurrent = Math.min(char.stats.mpCurrent, char.stats.mp);

    if (this.eventSystem) {
      this.eventSystem.publish('item:unequipped', {
        characterId: char.id, characterName: char.name,
        itemId, itemName: card ? card.name : itemId, slot,
      });
    }
    return { success: true };
  }

  /**
   * 购买道具：扣金币 + 加入第一个活着的角色背包
   */
  buyItem(gameState, itemId, price) {
    const card = this.cardManager ? this.cardManager.getCard(itemId) : null;
    if (!card || card.type !== 'item') return { success: false, reason: '道具不存在' };

    if ((gameState.gold || 0) < price) return { success: false, reason: '金币不足' };

    gameState.gold -= price;
    const buyer = gameState.activeCharacters.find(c => c.stats.hpCurrent > 0) || gameState.activeCharacters[0];
    if (!buyer.inventory) buyer.inventory = [];
    buyer.inventory.push(itemId);

    if (this.eventSystem) {
      this.eventSystem.publish('shop:bought', { itemId, itemName: card.name, price, buyerName: buyer.name });
    }
    return { success: true, itemName: card.name, buyerName: buyer.name };
  }

  /**
   * 出售道具：从持有者背包移除 + 加金币
   */
  sellItem(gameState, itemId, ownerCharId, sellMultiplier = 0.5) {
    const card = this.cardManager ? this.cardManager.getCard(itemId) : null;
    if (!card || card.type !== 'item') return { success: false, reason: '道具不存在' };

    const char = gameState.activeCharacters.find(c => c.id === ownerCharId);
    if (!char || !char.inventory) return { success: false, reason: '持有者不存在' };

    const idx = char.inventory.indexOf(itemId);
    if (idx === -1) return { success: false, reason: '持有者背包中没有该道具' };

    // 售出价 = 道具 sellPrice * shop multiplier（如果 sellPrice 为 0 用 buyPrice * multiplier）
    const baseSell = card.sellPrice || Math.floor((card.buyPrice || 0) * 0.5);
    const finalPrice = Math.max(1, Math.floor(baseSell * sellMultiplier * 2));  // sellMultiplier 通常0.5 → finalPrice ≈ baseSell

    char.inventory.splice(idx, 1);
    gameState.gold = (gameState.gold || 0) + finalPrice;

    if (this.eventSystem) {
      this.eventSystem.publish('shop:sold', { itemId, itemName: card.name, price: finalPrice, sellerName: char.name });
    }
    return { success: true, itemName: card.name, price: finalPrice };
  }

  /** 应用/移除属性修正 */
  _applyStatModifiers(char, modifiers, sign) {
    if (!modifiers) return;
    for (const [key, value] of Object.entries(modifiers)) {
      if (typeof char.stats[key] === 'number') {
        char.stats[key] += value * sign;
      }
    }
  }

  destroy() {
    this.eventSystem = null;
    this.cardManager = null;
    super.destroy();
  }
}
