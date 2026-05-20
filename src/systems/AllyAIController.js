/**
 * 队友 AI 控制器（启发式）
 *
 * 决策优先级（从高到低）：
 * 1. 队友 HP 危急 + 自己会治疗 + MP 够 → 治疗最低 HP 的队友
 * 2. 自己 HP < 25% + 有治疗术 + MP 够 → 自疗
 * 3. 攻击技能 + MP 够 → 优先用伤害最高的技能打 HP 最低的敌人
 * 4. 否则普攻 HP 最低的敌人
 *
 * 不调用 OpenAI，节省 token。预留接口可升级为 LLM 决策。
 */

import { GameSystem } from '../core/GameEngine.js';

export class AllyAIController extends GameSystem {
  constructor() {
    super('AllyAIController');
    /** @type {'heuristic'|'llm'} 决策模式 */
    this.mode = 'heuristic';
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.gameEngine = gameEngine;
  }

  setMode(mode) {
    if (mode === 'heuristic' || mode === 'llm') this.mode = mode;
  }

  /**
   * 主决策入口（同步版本，启发式）
   */
  decideAction(actor, gameState) {
    return this._decideHeuristic(actor, gameState);
  }

  /**
   * 异步决策入口（按 mode 选择 LLM 或启发式）
   * @returns {Promise<{actionType, targetId, abilityId?, reason}>}
   */
  async decideActionAsync(actor, gameState) {
    if (this.mode === 'llm') {
      try {
        const llmDecision = await this._decideLLM(actor, gameState);
        if (llmDecision) return llmDecision;
      } catch (e) {
        console.warn('LLM 决策失败，退回启发式:', e.message);
      }
    }
    return this._decideHeuristic(actor, gameState);
  }

  /**
   * 启发式决策（原 decideAction 实现）
   * reason 字段使用模板库随机抽取，比"X → Y"更生动（修复 Bug #4）
   */
  _decideHeuristic(actor, gameState) {
    if (!actor || !gameState || !gameState.activeCombat) {
      return { actionType: 'attack', reason: 'no-context' };
    }
    const combat = gameState.activeCombat;
    const aliveEnemies = combat.enemies.filter(e => e.stats.hpCurrent > 0);
    const aliveAllies = gameState.activeCharacters.filter(c => c.stats.hpCurrent > 0);

    if (aliveEnemies.length === 0) {
      return { actionType: 'attack', reason: 'no-enemies' };
    }

    // === 优先级 1: 治疗危急队友 ===
    const healAbility = this._findHealAbility(actor);
    const lowHpAlly = this._findLowestHpAlly(aliveAllies, 0.35);
    if (healAbility && lowHpAlly && actor.stats.mpCurrent >= (healAbility.cost?.mp || 0)) {
      return {
        actionType: 'ability', actorId: actor.id,
        abilityId: healAbility.id, targetId: lowHpAlly.id,
        reason: this._pickHealTemplate(healAbility.name, lowHpAlly.name),
      };
    }

    // === 优先级 2: 自疗（仅当自己很危急且队伍只有自己） ===
    if (healAbility && actor.stats.hpCurrent < actor.stats.hp * 0.25 &&
        actor.stats.mpCurrent >= (healAbility.cost?.mp || 0)) {
      return {
        actionType: 'ability', actorId: actor.id,
        abilityId: healAbility.id, targetId: actor.id,
        reason: this._pickSelfHealTemplate(healAbility.name),
      };
    }

    // === 优先级 3: 用最强攻击技能 ===
    const damageAbility = this._findBestDamageAbility(actor);
    if (damageAbility && actor.stats.mpCurrent >= (damageAbility.cost?.mp || 0)) {
      const target = this._findLowestHpEnemy(aliveEnemies);
      const isAoe = damageAbility.effect && damageAbility.effect.target === 'all_enemies';
      return {
        actionType: 'ability', actorId: actor.id,
        abilityId: damageAbility.id, targetId: target.id,
        reason: isAoe
          ? this._pickAoeTemplate(damageAbility.name)
          : this._pickDamageTemplate(damageAbility.name, target.name),
      };
    }

    // === 优先级 4: 普通攻击 ===
    const attackTarget = this._findLowestHpEnemy(aliveEnemies);
    return {
      actionType: 'attack', actorId: actor.id,
      targetId: attackTarget.id,
      reason: this._pickAttackTemplate(attackTarget.name),
    };
  }

  _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  _pickAttackTemplate(targetName) {
    return this._pick([
      `挥剑直击 ${targetName}`,
      `突进近身，向 ${targetName} 出手`,
      `寻找破绽对 ${targetName} 下手`,
      `稳住身形，向 ${targetName} 发起进攻`,
      `屏息凝神，刺向 ${targetName}`,
    ]);
  }

  _pickDamageTemplate(abilityName, targetName) {
    return this._pick([
      `凝聚力量发动 ${abilityName}，直击 ${targetName}`,
      `集中精神释放 ${abilityName}，锁定 ${targetName}`,
      `怒喝一声，${abilityName} 朝 ${targetName} 倾泻`,
      `屏息将 ${abilityName} 灌注于武器，目标 ${targetName}`,
    ]);
  }

  _pickAoeTemplate(abilityName) {
    return this._pick([
      `挥手释放 ${abilityName}，能量在敌阵中爆开`,
      `高声咏唱 ${abilityName}，光芒席卷战场`,
      `双手张开释放 ${abilityName}，狂风骤起`,
      `掌中能量喷薄而出，${abilityName} 覆盖整片战场`,
    ]);
  }

  _pickHealTemplate(abilityName, allyName) {
    return this._pick([
      `吟唱 ${abilityName}，柔光洒向 ${allyName}`,
      `伸手为 ${allyName} 引导生机，${abilityName} 之力涌动`,
      `咏唱 ${abilityName}，治愈之光环绕 ${allyName}`,
      `召唤 ${abilityName} 的能量，温暖覆盖 ${allyName} 的伤处`,
    ]);
  }

  _pickSelfHealTemplate(abilityName) {
    return this._pick([
      `咬牙集中精神，${abilityName} 灌入自身`,
      `闭目调息，${abilityName} 之力修复自身的伤口`,
      `凝神运起 ${abilityName}，缓解身上的伤势`,
    ]);
  }

  /**
   * LLM 决策：构造紧凑战况 + 调用 AI，解析返回
   * @returns {Promise<object|null>}
   */
  async _decideLLM(actor, gameState) {
    const aiEngine = this.gameEngine && this.gameEngine.getSystem('AIGMEngine');
    if (!aiEngine || !aiEngine.isConfigured()) return null;

    const combat = gameState.activeCombat;
    if (!combat) return null;

    const aliveEnemies = combat.enemies.filter(e => e.stats.hpCurrent > 0);
    const aliveAllies = gameState.activeCharacters.filter(c => c.stats.hpCurrent > 0);
    if (aliveEnemies.length === 0) return null;

    // 构造紧凑战况
    const allyDesc = aliveAllies.map(c =>
      `${c.id}(${c.name},HP:${c.stats.hpCurrent}/${c.stats.hp})`).join(', ');
    const enemyDesc = aliveEnemies.map(e =>
      `${e.id}(${e.name},HP:${e.stats.hpCurrent}/${e.stats.hp})`).join(', ');

    const abilities = (actor.abilities || []).map(a => {
      const cost = (a.cost && a.cost.mp) || 0;
      const canCast = actor.stats.mpCurrent >= cost;
      const target = a.effect?.heal ? '友方' : '敌方';
      return `${a.id}(${a.name},MP:${cost}${canCast ? '' : '不足'},${target})`;
    }).join(', ');

    const prompt = `战斗决策请求。
当前行动者: ${actor.name}(HP:${actor.stats.hpCurrent}/${actor.stats.hp}, MP:${actor.stats.mpCurrent}/${actor.stats.mp})
我方: ${allyDesc}
敌方: ${enemyDesc}
可用技能: ${abilities || '（无）'}

请决定本回合最优行动。仅返回 JSON：
{"actionType":"attack"|"ability","targetId":"<目标id>","abilityId":"<技能id仅 ability 时>","reason":"<一句话原因>"}

规则：
- attack: 必须填 targetId 为敌方 id
- ability: 必须填 abilityId 和 targetId（治疗类目标是友方，伤害类是敌方）
- 不允许使用 MP 不足的技能
- 选择高效行动：HP 低队友优先治疗，集中火力击杀低 HP 敌人`;

    const messages = [
      { role: 'system', content: '你是一个 TRPG 战斗 AI，专精战术决策。仅返回 JSON，不要任何其他文字。' },
      { role: 'user', content: prompt },
    ];

    let responseText;
    try {
      responseText = await aiEngine.callAI(messages);
    } catch (e) {
      return null;
    }

    // 解析 JSON
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      const m = responseText.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { return null; }
      } else {
        return null;
      }
    }

    return this._validateLLMDecision(parsed, actor, gameState);
  }

  /**
   * 校验 LLM 返回的决策合法性
   */
  _validateLLMDecision(decision, actor, gameState) {
    if (!decision || typeof decision !== 'object') return null;
    const combat = gameState.activeCombat;

    if (decision.actionType === 'attack') {
      if (!decision.targetId) return null;
      const target = combat.enemies.find(e => e.id === decision.targetId && e.stats.hpCurrent > 0);
      if (!target) return null;
      return {
        actionType: 'attack', actorId: actor.id, targetId: decision.targetId,
        reason: `[LLM] ${decision.reason || `普攻 ${target.name}`}`,
      };
    }

    if (decision.actionType === 'ability') {
      if (!decision.abilityId || !decision.targetId) return null;
      const ability = (actor.abilities || []).find(a => a.id === decision.abilityId);
      if (!ability) return null;
      const cost = (ability.cost && ability.cost.mp) || 0;
      if (actor.stats.mpCurrent < cost) return null;
      // 校验目标
      const isHeal = !!(ability.effect && ability.effect.heal);
      const targetList = isHeal ? gameState.activeCharacters : combat.enemies;
      const target = targetList.find(e => e.id === decision.targetId && e.stats.hpCurrent > 0);
      if (!target) return null;
      return {
        actionType: 'ability', actorId: actor.id,
        abilityId: decision.abilityId, targetId: decision.targetId,
        reason: `[LLM] ${decision.reason || `${ability.name} → ${target.name}`}`,
      };
    }

    return null;
  }

  /** 找治疗类技能（heal 或 healing 关键字） */
  _findHealAbility(actor) {
    return (actor.abilities || []).find(a => {
      const effect = a.effect || {};
      return effect.heal || (a.name && /治愈|治疗|恢复/.test(a.name));
    }) || null;
  }

  /** 找伤害最高的技能（按 formula 粗略估算） */
  _findBestDamageAbility(actor) {
    const damages = (actor.abilities || [])
      .filter(a => a.effect && a.effect.damage)
      .map(a => ({ ability: a, est: this._estimateDamage(a, actor) }));
    if (damages.length === 0) return null;
    damages.sort((a, b) => b.est - a.est);
    return damages[0].ability;
  }

  /** 粗略估算技能伤害（按 formula 中的系数） */
  _estimateDamage(ability, actor) {
    const formula = ability.effect?.damage?.formula || '';
    // 提取 attack/magicAttack 后面的乘数
    const atkMatch = formula.match(/attack\s*\*\s*([\d.]+)/);
    const matkMatch = formula.match(/magicAttack\s*\*\s*([\d.]+)/);
    let est = 0;
    if (atkMatch) est += actor.stats.attack * parseFloat(atkMatch[1]);
    if (matkMatch) est += actor.stats.magicAttack * parseFloat(matkMatch[1]);
    if (est === 0) est = actor.stats.attack;  // 默认按物攻
    return est;
  }

  /** 找 HP 比例低于阈值的最低 HP 队友 */
  _findLowestHpAlly(allies, threshold) {
    let candidate = null;
    let lowestRatio = threshold;
    for (const c of allies) {
      const ratio = c.stats.hpCurrent / c.stats.hp;
      if (ratio < lowestRatio) {
        candidate = c;
        lowestRatio = ratio;
      }
    }
    return candidate;
  }

  /** 找 HP 最低的敌人（优先击杀） */
  _findLowestHpEnemy(enemies) {
    return enemies.slice().sort((a, b) => a.stats.hpCurrent - b.stats.hpCurrent)[0];
  }
}
