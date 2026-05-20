/**
 * 战斗系统
 * 处理回合制战斗的逻辑：先攻判定、伤害计算、技能使用
 */

import { GameSystem } from '../core/GameEngine.js';

export class CombatSystem extends GameSystem {
  constructor() {
    super('CombatSystem');
    this.eventSystem = null;
    this.diceSystem = null;
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.eventSystem = gameEngine.getSystem('EventSystem');
    this.diceSystem = gameEngine.getSystem('DiceSystem');
  }

  /**
   * 开始战斗
   * @param {object} gameState - 游戏状态
   * @param {object[]} enemies - 敌人卡数据数组（副本）
   */
  startCombat(gameState, enemies) {
    // 计算先攻顺序
    const participants = [];

    for (const char of gameState.activeCharacters) {
      if (char.stats.hpCurrent > 0) {
        const initiative = this.diceSystem.quickRoll(20) + char.stats.speed;
        participants.push({
          id: char.id,
          name: char.name,
          type: 'character',
          initiative,
          data: char,
        });
      }
    }

    for (const enemy of enemies) {
      const initiative = this.diceSystem.quickRoll(20) + enemy.stats.speed;
      participants.push({
        id: enemy.id,
        name: enemy.name,
        type: 'enemy',
        initiative,
        data: enemy,
      });
    }

    // 按先攻从高到低排序
    participants.sort((a, b) => b.initiative - a.initiative);

    gameState.activeCombat = {
      enemies: enemies,
      turnOrder: participants,
      round: 1,
      currentActorIndex: 0,
      log: [],
    };

    gameState.currentPhase = 'combat';

    if (this.eventSystem) {
      this.eventSystem.publish('combat:start', {
        enemies: enemies.map(e => ({ id: e.id, name: e.name })),
        turnOrder: participants.map(p => ({ id: p.id, name: p.name, type: p.type, initiative: p.initiative })),
      });
    }
  }

  /**
   * 获取当前行动者
   * @param {object} gameState
   * @returns {object|null}
   */
  getCurrentActor(gameState) {
    const combat = gameState.activeCombat;
    if (!combat) return null;
    return combat.turnOrder[combat.currentActorIndex] || null;
  }

  /**
   * 执行普通攻击
   * @param {object} gameState
   * @param {string} attackerId - 攻击者ID
   * @param {string} targetId - 目标ID
   * @returns {object} 攻击结果
   */
  performAttack(gameState, attackerId, targetId) {
    const attacker = this.findCombatant(gameState, attackerId);
    const target = this.findCombatant(gameState, targetId);

    if (!attacker || !target) {
      return { success: false, reason: '攻击者或目标不存在' };
    }

    // 投掷攻击骰
    const attackRoll = this.diceSystem.roll('d20');
    const attackTotal = attackRoll.total + attacker.stats.attack;

    // 计算伤害
    const rawDamage = Math.max(0, attackTotal - target.stats.defense);
    const damageRoll = this.diceSystem.roll('d6');
    const finalDamage = rawDamage + damageRoll.total;

    // 应用伤害
    const actualDamage = Math.min(target.stats.hpCurrent, Math.max(1, finalDamage));
    target.stats.hpCurrent -= actualDamage;

    const result = {
      success: true,
      attackerId,
      targetId,
      attackerName: attacker.name,
      targetName: target.name,
      attackRoll: attackRoll.total,
      attackTotal,
      rawDamage,
      damageRoll: damageRoll.total,
      finalDamage: actualDamage,
      targetHpAfter: target.stats.hpCurrent,
      targetDefeated: target.stats.hpCurrent <= 0,
    };

    // 记录战斗日志
    if (gameState.activeCombat) {
      gameState.activeCombat.log.push(result);
    }

    if (this.eventSystem) {
      this.eventSystem.publish('combat:attack', result);
    }

    return result;
  }

  /**
   * 使用技能
   * @param {object} gameState
   * @param {string} casterId
   * @param {string} abilityId
   * @param {string} targetId
   * @returns {object}
   */
  useAbility(gameState, casterId, abilityId, targetId) {
    const caster = this.findCombatant(gameState, casterId);
    if (!caster) return { success: false, reason: '施放者不存在' };

    const ability = (caster.abilities || []).find(a => a.id === abilityId);
    if (!ability) return { success: false, reason: '技能不存在' };

    // 检查MP消耗
    if (ability.cost && ability.cost.mp) {
      if (caster.stats.mpCurrent < ability.cost.mp) {
        return { success: false, reason: 'MP不足' };
      }
      caster.stats.mpCurrent -= ability.cost.mp;
    }

    const target = this.findCombatant(gameState, targetId);
    if (!target) return { success: false, reason: '目标不存在' };

    // 计算效果
    let damage = 0;
    let healing = 0;
    let details = '';

    if (ability.effect && ability.effect.damage) {
      const formula = ability.effect.damage.formula || 'attack';
      const evaluated = this.diceSystem.evaluateExpression(formula, {
        attack: caster.stats.attack,
        magicAttack: caster.stats.magicAttack,
        defense: target.stats.defense,
        magicDefense: target.stats.magicDefense,
      });
      damage = Math.max(1, evaluated.result);
      details = evaluated.details;

      const actual = Math.min(target.stats.hpCurrent, damage);
      target.stats.hpCurrent -= actual;
      damage = actual;
    }

    if (ability.effect && ability.effect.heal) {
      const formula = ability.effect.heal.formula || '10';
      const evaluated = this.diceSystem.evaluateExpression(formula, {
        magicAttack: caster.stats.magicAttack,
      });
      const maxHeal = target.stats.hp - target.stats.hpCurrent;
      healing = Math.min(maxHeal, Math.max(0, evaluated.result));
      target.stats.hpCurrent += healing;
      details = evaluated.details;
    }

    const result = {
      success: true,
      casterId,
      targetId,
      casterName: caster.name,
      targetName: target.name,
      abilityName: ability.name,
      damage,
      healing,
      details,
      targetHpAfter: target.stats.hpCurrent,
      targetDefeated: target.stats.hpCurrent <= 0,
      mpCost: ability.cost?.mp || 0,
      casterMpAfter: caster.stats.mpCurrent,
    };

    if (gameState.activeCombat) {
      gameState.activeCombat.log.push(result);
    }

    if (this.eventSystem) {
      this.eventSystem.publish('combat:ability', result);
    }

    return result;
  }

  /**
   * 推进到下一个行动者
   * 正确处理 filter 移除当前/之前参与者时索引调整（修复 #9.A 索引跳号 bug）
   * @param {object} gameState
   * @returns {{ nextActor: object|null, newRound: boolean, combatEnd: boolean }}
   */
  nextTurn(gameState) {
    const combat = gameState.activeCombat;
    if (!combat) return { nextActor: null, newRound: false, combatEnd: false };

    // 在过滤前记下 oldOrder 和 oldIdx，用于精确调整新索引
    const oldOrder = combat.turnOrder.slice();
    const oldIdx = combat.currentActorIndex;

    // 移除已被击败的参与者
    combat.turnOrder = oldOrder.filter(p => {
      const entity = this.findCombatant(gameState, p.id);
      return entity && entity.stats.hpCurrent > 0;
    });

    // 检查战斗是否结束
    const aliveEnemies = combat.enemies.filter(e => e.stats.hpCurrent > 0);
    const aliveChars = gameState.activeCharacters.filter(c => c.stats.hpCurrent > 0);

    if (aliveEnemies.length === 0) {
      return this.endCombat(gameState, 'victory');
    }
    if (aliveChars.length === 0) {
      return this.endCombat(gameState, 'defeat');
    }

    // 调整当前索引：从 oldIdx（含）之前被移除的数量
    const survivorIds = new Set(combat.turnOrder.map(p => p.id));
    let removedBeforeOrAt = 0;
    for (let i = 0; i <= oldIdx && i < oldOrder.length; i++) {
      if (!survivorIds.has(oldOrder[i].id)) removedBeforeOrAt++;
    }
    combat.currentActorIndex = oldIdx - removedBeforeOrAt;

    // 推进到下一个
    combat.currentActorIndex++;
    let newRound = false;

    if (combat.currentActorIndex >= combat.turnOrder.length) {
      combat.currentActorIndex = 0;
      combat.round++;
      newRound = true;

      if (this.eventSystem) {
        this.eventSystem.publish('combat:round', { round: combat.round });
      }
    }

    const nextActor = combat.turnOrder[combat.currentActorIndex] || null;
    return { nextActor, newRound, combatEnd: false };
  }

  /**
   * 结束战斗
   * @param {object} gameState
   * @param {string} result - 'victory' | 'defeat' | 'flee'
   */
  endCombat(gameState, result) {
    const combat = gameState.activeCombat;
    let loot = [];
    let totalExp = 0;

    if (result === 'victory' && combat) {
      // 收集掉落和经验
      for (const enemy of combat.enemies) {
        totalExp += enemy.experienceReward || 0;
        if (enemy.lootTable) {
          for (const entry of enemy.lootTable) {
            if (Math.random() <= entry.dropRate) {
              loot.push(entry.itemId);
            }
          }
        }
      }
    }

    // 在清空 activeCombat 之前快照击败的敌人（供 _finalizeCombat 等后续逻辑使用）
    const defeatedEnemies = combat
      ? combat.enemies.filter(e => e.stats.hpCurrent <= 0)
          .map(e => ({
            id: e._originalId || e.id,
            name: e.name,
            difficulty: e.difficulty,
          }))
      : [];

    gameState.activeCombat = null;
    gameState.currentPhase = 'exploration';

    const endResult = {
      result,
      totalExp,
      loot,
      defeatedEnemies,
      combatEnd: true,
      nextActor: null,
      newRound: false,
    };

    if (this.eventSystem) {
      this.eventSystem.publish('combat:end', endResult);
    }

    return endResult;
  }

  /**
   * 在战斗参与者中查找实体
   * @param {object} gameState
   * @param {string} id
   * @returns {object|null}
   */
  findCombatant(gameState, id) {
    // 先查角色
    const char = gameState.activeCharacters.find(c => c.id === id);
    if (char) return char;

    // 再查敌人
    if (gameState.activeCombat) {
      const enemy = gameState.activeCombat.enemies.find(e => e.id === id);
      if (enemy) return enemy;
    }

    return null;
  }

  destroy() {
    this.eventSystem = null;
    this.diceSystem = null;
    super.destroy();
  }
}
