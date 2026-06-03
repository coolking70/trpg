/**
 * 局部战斗系统（Skirmish，Phase 44）—— 小兵实战参战的回合制小队战斗。
 *
 * 与默认个人战相似（同伤害口径），但面向"战略大战中的一小片战线"：
 *   - 敌我各为数人小队，连续作战；战损后按战线 tide 触发援兵补充波次；
 *   - 双方小队士气决定非全灭结局（溃逃/投降/俘虏）；上级可鸣金收兵/撤退休整；
 *   - 玩家个人英勇（杀敌/斩将）累积战功，几乎不左右全局——除非阵斩敌方关键将领（重大事件）。
 *
 * 时间放缓：skirmish 不推进战略时钟（季/旬），它是被放大的瞬间，由 GameSession 负责"不计时"。
 */

import { GameSystem } from '../core/GameEngine.js';
import {
  skirmishDamage, reinforcementChance, skirmishOutcome, recallChance,
  outcomeMeritBonus, OUTCOME_LABEL, effectiveMorale,
} from '../data/skirmish.js';

let _uid = 0;

export class SkirmishSystem extends GameSystem {
  constructor() {
    super('SkirmishSystem');
    this.eventSystem = null;
    this.rng = Math.random;
  }
  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.eventSystem = gameEngine.getSystem('EventSystem');
  }

  /**
   * 开战。def：
   *   playerChar  玩家角色卡（含 stats）—— 战斗以其真实 HP 进行，结束后回写（伤亡有后果）
   *   allies      盟军小队定义 [{ name, atk, def, hp }]（不含玩家；玩家自动并入）
   *   enemies     敌军小队定义 [{ name, atk, def, hp, isCommander? }]
   *   reserves    { ally, enemy } 预备队（援兵）人数
   *   tide        -1..+1 战线大势（>0 我方有利）
   *   parent      { kind:'siege'|'field', side, factionId, enemyFactionId, holdingId?, siegeId?, commanderName? }
   */
  startSkirmish(gameState, def = {}) {
    const mk = (d, isAlly, isPlayer = false) => ({
      id: `sk_${++_uid}`,
      name: d.name || (isAlly ? '袍泽' : '敌兵'),
      isPlayer, isAlly, isCommander: !!d.isCommander,
      hp: Math.max(1, Math.round(d.hp ?? 30)),
      hpMax: Math.max(1, Math.round(d.hpMax ?? d.hp ?? 30)),
      atk: d.atk ?? 6, def: d.def ?? 3, speed: d.speed ?? 5,
      _charRef: d._charRef || null,
    });

    const pc = def.playerChar;
    const pStats = pc?.stats || {};
    const player = mk({
      name: pc?.name || '你', _charRef: pc,
      hp: pStats.hpCurrent ?? pStats.hp ?? 30, hpMax: pStats.hp ?? 30,
      atk: pStats.attack ?? 8, def: pStats.defense ?? 4, speed: pStats.speed ?? 6,
    }, true, true);

    const allies = [player, ...((def.allies || []).map(d => mk(d, true)))];
    const enemies = (def.enemies || []).map(d => mk(d, false));

    const s = {
      id: `skirmish_${++_uid}`,
      parent: def.parent || { kind: 'field', side: 'attacker' },
      tide: Math.max(-1, Math.min(1, def.tide || 0)),
      round: 1,
      allies, enemies,
      reserves: { ally: Math.max(0, def.reserves?.ally || 0), enemy: Math.max(0, def.reserves?.enemy || 0) },
      // 士气按"已投入兵力中的战损比"动态计算（effectiveMorale）：
      committed: { ally: allies.length, enemy: enemies.length },
      deaths: { ally: 0, enemy: 0 },
      moraleBonus: { ally: 0, enemy: 0 }, // 鼓舞/援军到场的临时加成
      kills: 0, commanderKill: null, // 'slain' | 'captured'
      log: [], outcome: null,
    };
    gameState.activeSkirmish = s;
    this._publish('skirmish:start', { skirmish: s });
    return s;
  }

  livingAllies(s) { return s.allies.filter(u => u.hp > 0); }
  livingEnemies(s) { return s.enemies.filter(u => u.hp > 0); }
  player(s) { return s.allies.find(u => u.isPlayer) || null; }

  /** 玩家可击目标（存活敌人） */
  enemyTargets(gameState) {
    const s = gameState.activeSkirmish; if (!s) return [];
    return this.livingEnemies(s).map(u => ({ id: u.id, name: u.name, hp: u.hp, hpMax: u.hpMax, isCommander: u.isCommander }));
  }

  /**
   * 提交玩家本回合行动，推进一整轮（玩家→友军→敌军→援兵→鸣金→结局）。
   * action: { type:'attack', targetId } | {type:'defend'} | {type:'rally'} | {type:'flee'} | {type:'capture', targetId}
   * 返回 { log:[...], outcome }（outcome 非空表示战斗结束）。
   */
  submitPlayerAction(gameState, action = {}) {
    const s = gameState.activeSkirmish;
    if (!s || s.outcome) return { log: [], outcome: s?.outcome || null };
    const log = [];
    const p = this.player(s);
    if (!p || p.hp <= 0) { /* 玩家已倒，仍走收尾 */ }
    else {
      switch (action.type) {
        case 'flee': {
          s.outcome = { type: 'flee', winner: null };
          log.push(`${p.name}且战且退，脱离了这片战线。`);
          break;
        }
        case 'defend': p._defending = true; log.push(`${p.name}举盾据守，凝神戒备。`); break;
        case 'rally': {
          s.moraleBonus.ally += 15;
          log.push(`${p.name}振臂高呼，袍泽士气为之一振！`);
          break;
        }
        case 'capture': {
          const t = s.enemies.find(u => u.id === action.targetId);
          if (t && t.hp > 0 && t.hp <= Math.max(6, t.hpMax * 0.25)) {
            t.hp = 0; t._captured = true;
            this._onEnemyDown(s, t, log, true);
          } else if (t) { // 未达可俘条件 → 当作强攻
            this._attack(s, p, t, log);
          }
          break;
        }
        case 'attack':
        default: {
          const t = s.enemies.find(u => u.id === action.targetId && u.hp > 0) || this.livingEnemies(s)[0];
          if (t) this._attack(s, p, t, log);
          break;
        }
      }
    }
    if (s.outcome) return this._finalize(gameState, log);

    // 友军（非玩家）行动
    for (const a of this.livingAllies(s)) {
      if (a.isPlayer) continue;
      const t = this._pickTarget(this.livingEnemies(s));
      if (t) this._attack(s, a, t, log);
    }
    // 敌军行动
    for (const e of this.livingEnemies(s)) {
      const t = this._pickTarget(this.livingAllies(s), true);
      if (t) this._attack(s, e, t, log);
    }
    // 清理本回合的临时防御
    for (const u of s.allies) u._defending = false;

    // 援兵补充波次
    this._reinforce(s, log);

    // 上级鸣金（战线不利/久持）—— 仅当未分胜负时考虑
    let forcedRecall = false;
    if (!skirmishOutcome(s)) forcedRecall = recallChance(s.tide, s.round, this.rng);

    s.round += 1;
    const oc = skirmishOutcome(s, { forcedRecall });
    if (oc) { s.outcome = oc; return this._finalize(gameState, log); }
    return { log, outcome: null };
  }

  _attack(s, atk, def, log) {
    if (atk.hp <= 0 || def.hp <= 0) return;
    let dmg = skirmishDamage(atk, def, this.rng);
    if (def._defending) dmg = Math.max(1, Math.round(dmg * 0.5));
    def.hp = Math.max(0, def.hp - dmg);
    log.push(`${atk.name} 击中 ${def.name}，造成 ${dmg} 伤（余 ${def.hp}）。`);
    if (def.hp <= 0) {
      if (def.isAlly) this._onAllyDown(s, def, log);
      else this._onEnemyDown(s, def, log, false);
    }
  }

  _onEnemyDown(s, e, log, captured) {
    e._dieRound = s.round; s._enemyDiedThisRound = true;
    s.deaths.enemy += 1;
    if (e.isCommander) s.moraleBonus.enemy -= 25; // 主将殒落，全军夺气
    log.push(captured ? `${e.name} 力竭被擒！` : `${e.name} 力战而亡。`);
    // 玩家斩获记功（无法判定最后一击者时统一记给玩家方）
    s.kills += 1;
    if (e.isCommander) {
      s.commanderKill = captured ? 'captured' : 'slain';
      log.push(captured ? `⚑ 敌将 ${e.name} 被生擒！` : `⚑ 敌将 ${e.name} 殒于阵中！`);
    }
  }
  _onAllyDown(s, a, log) {
    a._dieRound = s.round; s._allyDiedThisRound = true;
    s.deaths.ally += 1;
    log.push(`${a.name} 倒在了血泊中。`);
  }

  _pickTarget(list, preferPlayerHurt = false) {
    if (!list || !list.length) return null;
    if (preferPlayerHurt) {
      // 敌人优先打血最少者（含玩家），制造压力
      return [...list].sort((a, b) => a.hp - b.hp)[0];
    }
    return [...list].sort((a, b) => a.hp - b.hp)[0];
  }

  _reinforce(s, log) {
    if (s._enemyDiedThisRound && reinforcementChance('enemy', s.tide, s.reserves.enemy, this.rng)) {
      s.reserves.enemy -= 1;
      const u = { id: `sk_${++_uid}`, name: '敌军援兵', isAlly: false, isCommander: false, hp: 28, hpMax: 28, atk: 6, def: 3, speed: 5 };
      s.enemies.push(u); s.committed.enemy += 1; s.moraleBonus.enemy += 8;
      log.push('🜸 敌军一队援兵杀入战团！');
    }
    if (s._allyDiedThisRound && reinforcementChance('ally', s.tide, s.reserves.ally, this.rng)) {
      s.reserves.ally -= 1;
      const u = { id: `sk_${++_uid}`, name: '我军援兵', isAlly: true, isCommander: false, hp: 28, hpMax: 28, atk: 7, def: 3, speed: 5 };
      s.allies.push(u); s.committed.ally += 1; s.moraleBonus.ally += 8;
      log.push('🜂 我军一队袍泽驰援而至！');
    }
    s._enemyDiedThisRound = false; s._allyDiedThisRound = false;
  }

  _finalize(gameState, log) {
    const s = gameState.activeSkirmish;
    const oc = s.outcome;
    // 回写玩家 HP（伤亡有后果；被俘/重伤则压到极低但不致死）
    const p = this.player(s);
    if (p && p._charRef?.stats) {
      let hp = p.hp;
      if (oc.type === 'captured') hp = Math.max(1, Math.round(p.hpMax * 0.1));
      p._charRef.stats.hpCurrent = Math.max(oc.type === 'captured' ? 1 : 0, hp);
    }
    oc.label = OUTCOME_LABEL[oc.type] || oc.type;
    oc.kills = s.kills;
    oc.merit = s.kills * 8 + outcomeMeritBonus(oc.type);
    oc.commanderKill = s.commanderKill;
    oc.parent = s.parent;
    this._publish('skirmish:end', { skirmish: s, outcome: oc });
    return { log, outcome: oc };
  }

  /** 自动跑完（auto 模式 / 模拟）：玩家用简单启发式行动直至结束。返回最终 outcome。 */
  autoResolve(gameState, maxRounds = 40) {
    const s = gameState.activeSkirmish; if (!s) return null;
    let guard = 0;
    while (!s.outcome && guard++ < maxRounds) {
      const p = this.player(s);
      let action = { type: 'attack' };
      if (p && p.hp > 0) {
        const enemies = this.livingEnemies(s);
        const weak = enemies.find(e => e.hp <= Math.max(6, e.hpMax * 0.25) && e.isCommander);
        if (weak) action = { type: 'capture', targetId: weak.id };
        else if (enemies[0]) action = { type: 'attack', targetId: enemies[0].id };
        // 血量危急且劣势 → 退却
        if (p.hp <= p.hpMax * 0.2 && s.tide < 0) action = { type: 'flee' };
      }
      this.submitPlayerAction(gameState, action);
    }
    return s.outcome;
  }

  _publish(topic, payload) { if (this.eventSystem) this.eventSystem.publish(topic, payload); }
  destroy() { this.eventSystem = null; super.destroy(); }
}
