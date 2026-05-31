/**
 * 战斗系统
 * 处理回合制战斗的逻辑：先攻判定、伤害计算、技能使用
 */

import { GameSystem } from '../core/GameEngine.js';
import { rollDynamicLoot, inferEcology } from '../data/ecology.js';

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
    // Phase 26C — buff/debuff 影响 stat
    const effAtk = this.getEffectiveStat(attacker, 'attack');
    const effDef = this.getEffectiveStat(target, 'defense');
    const attackTotal = attackRoll.total + effAtk;

    // 计算伤害
    const rawDamage = Math.max(0, attackTotal - effDef);
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

    // Phase 26C — AOE / 多目标技能
    //   ability.effect.aoe = true   → 打全场敌人（伤害类）或回全队（治疗类）
    //   ability.effect.target='all_enemies' / 'all_allies' / 'self' / 'single' (默认)
    const targetMode = ability.effect?.target || (ability.effect?.aoe ? (ability.effect?.heal ? 'all_allies' : 'all_enemies') : 'single');
    const targets = this._resolveTargets(gameState, caster, targetId, targetMode);
    if (targets.length === 0) return { success: false, reason: '目标不存在' };

    // 多目标 → 聚合 result.subResults，主 result 取第一目标兼容旧 UI
    const subResults = [];
    for (const target of targets) {
      const r = this._applyAbilityToOne(gameState, caster, ability, target);
      subResults.push(r);
    }

    const primary = subResults[0];
    const result = {
      success: true,
      casterId,
      targetId: primary.targetId,
      casterName: caster.name,
      targetName: primary.targetName,
      abilityName: ability.name,
      damage: primary.damage,
      healing: primary.healing,
      details: primary.details,
      targetHpAfter: primary.targetHpAfter,
      targetDefeated: primary.targetDefeated,
      mpCost: ability.cost?.mp || 0,
      casterMpAfter: caster.stats.mpCurrent,
      isAoe: targets.length > 1,
      subResults,
    };

    if (gameState.activeCombat) {
      gameState.activeCombat.log.push(result);
    }

    // status 应用到全部目标
    if (ability.effect && ability.effect.applyStatus) {
      const s = ability.effect.applyStatus;
      for (const target of targets) {
        this.applyStatusEffect(target, {
          type: s.type || 'buff',
          stat: s.stat,
          value: s.value || 0,
          duration: s.duration || 3,
          source: caster.name,
        });
      }
      result.statusApplied = s.type;
    }

    if (this.eventSystem) {
      this.eventSystem.publish('combat:ability', result);
    }
    return result;
  }

  /**
   * Phase 26C — 解析技能的目标集合
   */
  _resolveTargets(gameState, caster, singleTargetId, mode) {
    const combat = gameState.activeCombat;
    if (mode === 'self') return [caster];
    if (mode === 'all_enemies') {
      return (combat?.enemies || []).filter(e => e.stats.hpCurrent > 0);
    }
    if (mode === 'all_allies') {
      return (gameState.activeCharacters || []).filter(c => c.stats.hpCurrent > 0);
    }
    if (mode === 'random_enemy') {
      const alive = (combat?.enemies || []).filter(e => e.stats.hpCurrent > 0);
      if (alive.length === 0) return [];
      return [alive[Math.floor(Math.random() * alive.length)]];
    }
    // 默认 single
    const t = this.findCombatant(gameState, singleTargetId);
    return t ? [t] : [];
  }

  /**
   * Phase 26C — 把 ability 的伤害/治疗应用到单个目标，返回结果摘要
   */
  _applyAbilityToOne(gameState, caster, ability, target) {
    let damage = 0, healing = 0, details = '';
    if (ability.effect && ability.effect.damage) {
      const formula = ability.effect.damage.formula || 'attack';
      const evaluated = this.diceSystem.evaluateExpression(formula, {
        attack: this.getEffectiveStat(caster, 'attack'),
        magicAttack: this.getEffectiveStat(caster, 'magicAttack'),
        defense: this.getEffectiveStat(target, 'defense'),
        magicDefense: this.getEffectiveStat(target, 'magicDefense'),
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
        magicAttack: this.getEffectiveStat(caster, 'magicAttack'),
      });
      const maxHeal = target.stats.hp - target.stats.hpCurrent;
      healing = Math.min(maxHeal, Math.max(0, evaluated.result));
      target.stats.hpCurrent += healing;
      details = evaluated.details;
    }
    return {
      targetId: target.id, targetName: target.name,
      damage, healing, details,
      targetHpAfter: target.stats.hpCurrent,
      targetDefeated: target.stats.hpCurrent <= 0,
    };
  }

  /**
   * Phase 26C — 取属性"等效值"（base + 所有 buff/debuff stat 修改求和）
   */
  getEffectiveStat(combatant, statName) {
    let base = combatant.stats?.[statName] || 0;
    for (const e of (combatant.statusEffects || [])) {
      if ((e.type === 'buff' || e.type === 'debuff') && e.stat === statName && (e.duration || 0) > 0) {
        base += (e.type === 'buff' ? 1 : -1) * (e.value || 0);
      }
    }
    return Math.max(0, base);
  }

  /**
   * Phase 26C — 应用一个 status effect 到 combatant
   * 同 stat 同 type 已存在 → 续 duration / 取较大 value
   */
  applyStatusEffect(combatant, effect) {
    if (!combatant) return;
    combatant.statusEffects = combatant.statusEffects || [];
    const existing = combatant.statusEffects.find(e =>
      e.type === effect.type && e.stat === effect.stat && (e.duration || 0) > 0);
    if (existing) {
      existing.duration = Math.max(existing.duration, effect.duration);
      existing.value = Math.max(existing.value || 0, effect.value || 0);
    } else {
      combatant.statusEffects.push({ ...effect });
    }
    if (this.eventSystem) {
      this.eventSystem.publish('combat:statusApplied', { targetId: combatant.id, effect });
    }
  }

  /**
   * Phase 26C — 处理 combatant 回合开始时的 status ticks（dot 扣血 / buff 倒计时）
   * 在 nextTurn 推进到该 combatant 后立即调用
   */
  _processStatusEffectsTick(combatant) {
    if (!combatant || !combatant.statusEffects || combatant.statusEffects.length === 0) return [];
    const ticks = [];
    for (const e of combatant.statusEffects) {
      if ((e.duration || 0) <= 0) continue;
      if (e.type === 'dot') {
        const dmg = Math.min(combatant.stats.hpCurrent, e.value || 0);
        combatant.stats.hpCurrent -= dmg;
        ticks.push({ targetId: combatant.id, targetName: combatant.name, type: 'dot', stat: e.stat || 'hp', amount: dmg, defeated: combatant.stats.hpCurrent <= 0 });
      } else if (e.type === 'regen') {
        const heal = Math.min((combatant.stats.hp || 0) - combatant.stats.hpCurrent, e.value || 0);
        combatant.stats.hpCurrent += heal;
        ticks.push({ targetId: combatant.id, targetName: combatant.name, type: 'regen', amount: heal });
      }
      e.duration--;
    }
    // 清理过期
    combatant.statusEffects = combatant.statusEffects.filter(e => (e.duration || 0) > 0);
    if (ticks.length > 0 && this.eventSystem) {
      this.eventSystem.publish('combat:statusTick', { ticks });
    }
    return ticks;
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

    // Phase 26C — boss 阶段切换（每轮开始时扫描所有 boss enemy）
    let phaseTransitions = [];
    if (newRound) {
      for (const enemy of (combat.enemies || [])) {
        const t = this._checkPhaseTransition(enemy);
        if (t) phaseTransitions.push(t);
      }
    }

    // Phase 26C — nextActor 的回合开始：触发 status effect ticks（dot 扣血 / regen 回血）
    let statusTicks = [];
    if (nextActor) {
      const entity = this.findCombatant(gameState, nextActor.id);
      if (entity) {
        statusTicks = this._processStatusEffectsTick(entity);
        // tick 可能直接打死 combatant — 此时跳过其回合，递归找下一个
        if (entity.stats.hpCurrent <= 0) {
          return this.nextTurn(gameState);
        }
      }
    }

    return { nextActor, newRound, combatEnd: false, statusTicks, phaseTransitions };
  }

  /**
   * Phase 26C — Boss 阶段切换检查
   *   enemy.phases = [{ hpThreshold: 0.5, abilities: [...], statBoosts: { attack: +5, defense: -2 }, narrative: '...' }]
   *   当 hpCurrent/hp 跨过某 hpThreshold 时切换到该 phase（一次性）
   */
  _checkPhaseTransition(enemy) {
    if (!enemy || !enemy.phases || enemy.phases.length === 0) return null;
    const ratio = enemy.stats.hpCurrent / Math.max(1, enemy.stats.hp);
    enemy._activatedPhases = enemy._activatedPhases || new Set();
    if (typeof enemy._activatedPhases === 'object' && !enemy._activatedPhases.has) {
      // 反序列化后是普通 object — 兼容
      enemy._activatedPhases = new Set(Object.keys(enemy._activatedPhases));
    }
    // 按 hpThreshold 从高到低排序，找第一个 ratio < threshold 且未激活的
    const sortedPhases = [...enemy.phases].sort((a, b) => (b.hpThreshold || 0) - (a.hpThreshold || 0));
    for (const phase of sortedPhases) {
      const id = phase.id || `phase_${phase.hpThreshold}`;
      if (enemy._activatedPhases.has(id)) continue;
      if (ratio < (phase.hpThreshold || 0)) {
        enemy._activatedPhases.add(id);
        // 应用 statBoosts
        if (phase.statBoosts) {
          for (const [k, v] of Object.entries(phase.statBoosts)) {
            enemy.stats[k] = (enemy.stats[k] || 0) + v;
          }
        }
        // 追加 abilities
        if (phase.abilities && phase.abilities.length > 0) {
          enemy.abilities = [...(enemy.abilities || []), ...phase.abilities];
        }
        const transition = {
          enemyId: enemy.id, enemyName: enemy.name,
          phaseId: id, hpThreshold: phase.hpThreshold,
          statBoosts: phase.statBoosts || {},
          narrative: phase.narrative || `${enemy.name} 进入新形态！`,
        };
        if (this.eventSystem) this.eventSystem.publish('combat:phaseTransition', transition);
        return transition;
      }
    }
    return null;
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
        // Phase 28 — 生态位动态掉落：enemy.lootMode === 'dynamic' 或 (有 ecology 且无静态 lootTable)
        //   时按 biome/creatureType/tier 实时从掉落池抽取；否则走静态 lootTable（向后兼容）
        const useDynamic = enemy.lootMode === 'dynamic'
          || (!enemy.lootTable?.length && enemy.ecology && enemy.ecology.biome);
        if (useDynamic) {
          const eco = inferEcology(enemy);
          if (eco.biome) {
            const luck = enemy._killerLuck || 0;
            for (const itemId of rollDynamicLoot({ ...eco, luck })) loot.push(itemId);
          }
        } else if (enemy.lootTable) {
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
