/**
 * 军团战争系统（Phase 31）—— 单位栈战术制
 *
 * 与 CombatSystem（个人战：HP/属性/先攻回合制）完全平行、零耦合的另一套战斗模型。
 * 适用于野战 / 攻城 / 守城 / 水战；具备兵力 / 兵种 / 粮草 / 士气；按战型有限携带器械；
 * 战斗受主将属性（武力/统率/智力）、知识（阵法等级）、能力（战法）影响阵型与作战方式。
 *
 * 与 CombatSystem 一致的分工：本系统提供 startBattle/executeOrder/decideLegion/nextTurn/endBattle
 * 等原语；由 GameSession 负责 auto（启发式自动结算）/ interactive（轮到我方栈暂停等指令）的编排循环。
 *
 * 所有随机点走 this.rng（默认 Math.random，可注入以便确定性测试与蒙特卡洛模拟）。
 */

import { GameSystem } from '../core/GameEngine.js';
import {
  BATTLE_TYPES,
  MORALE_MAX, MORALE_BREAK, LOW_SUPPLY_MORALE_PENALTY,
  resolveAttack, resolveMachine, moraleShift, supplyDrain,
  counterMultiplier, canUseFormation, generalHasTactic, tacticSuccessChance,
  checkVictory, aliveTroops,
} from '../data/warfare.js';
import { schemaOf } from '../data/strategySchema.js';

const SAFETY_ROUND_CAP = 30;

/**
 * 某 side 在某战型下的默认起始分区。zones 取自题材 battleType（按 KEY 的攻守语义选位）。
 * battleType KEY（field/siege/defense/naval）为结构槽位，题材沿用并可重命名分区。
 */
function defaultZone(side, battleType, btDef) {
  const zones = btDef?.zones || [];
  const first = zones[0], last = zones[zones.length - 1];
  if (battleType === 'siege') return side === 'player' ? (first || '城外') : (zones[2] || last || '城墙');
  if (battleType === 'defense') return side === 'player' ? (zones[2] || last || '城墙') : (first || '城外');
  return first || (battleType === 'naval' ? '江心' : '前阵');
}

export class LegionWarfareSystem extends GameSystem {
  constructor() {
    super('LegionWarfareSystem');
    this.eventSystem = null;
    this.rng = Math.random;
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.eventSystem = gameEngine.getSystem('EventSystem');
  }

  /** 题材战术表（缺省=内置三国）。供本系统及 warfare 纯函数读取，换皮零改逻辑。 */
  _T(gameState) {
    const s = schemaOf(gameState);
    return {
      unitTypes: s.unitTypes, counterMatrix: s.counterMatrix, formations: s.formations,
      battleTypes: s.battleTypes, machines: s.machines, tactics: s.tactics,
    };
  }

  // ============================================================
  // 开战
  // ============================================================
  /**
   * @param {object} gameState
   * @param {object} battleDef - { battleType, generals:{id->general}, supply:{player,enemy}, units:[unitStackDef], objectiveName? }
   */
  startBattle(gameState, battleDef) {
    const T = this._T(gameState);
    const battleType = T.battleTypes[battleDef.battleType] ? battleDef.battleType : 'field';
    const btDef = T.battleTypes[battleType] || BATTLE_TYPES.field;
    const fallbackUnitKey = T.unitTypes.infantry ? 'infantry' : Object.keys(T.unitTypes)[0];

    const units = (battleDef.units || []).map((u, i) => ({
      id: u.id || `stack_${i + 1}`,
      side: u.side === 'enemy' ? 'enemy' : 'player',
      name: u.name || `${T.unitTypes[u.unitType]?.name || '部队'}`,
      unitType: T.unitTypes[u.unitType] ? u.unitType : fallbackUnitKey,
      troops: Math.max(1, Math.round(u.troops || 100)),
      maxTroops: Math.max(1, Math.round(u.troops || 100)),
      morale: u.morale != null ? u.morale : MORALE_MAX,
      zone: u.zone || defaultZone(u.side === 'enemy' ? 'enemy' : 'player', battleType, btDef),
      generalId: u.generalId || null,
      formation: T.formations[u.formation] ? u.formation : 'none',
      machines: Array.isArray(u.machines) ? u.machines.slice() : [],
    }));

    // 先攻：按兵种行动力降序（稳定）
    const turnOrder = units
      .map((u, idx) => ({ id: u.id, side: u.side, speed: T.unitTypes[u.unitType]?.speed || 5, idx }))
      .sort((a, b) => (b.speed - a.speed) || (a.idx - b.idx))
      .map(s => ({ id: s.id, side: s.side }));

    const works = btDef.defenseWorks ? { ...btDef.defenseWorks } : null;

    gameState.activeLegionBattle = {
      battleType,
      zones: btDef.zones.slice(),
      gateZone: btDef.gateZone || null,
      objectiveName: battleDef.objectiveName || btDef.victory.target || btDef.name,
      units,
      turnOrder,
      currentActorIndex: 0,
      round: 1,
      supply: {
        player: battleDef.supply?.player ?? 9999,
        enemy: battleDef.supply?.enemy ?? 9999,
      },
      works,
      control: null,
      generals: battleDef.generals || {},
      tacticsUsed: {}, // `${unitId}:${tacticKey}` → true（每栈每战法限一次）
      log: [],
    };
    gameState.currentPhase = 'legion';

    this._publish('legion:start', {
      battleType, objectiveName: gameState.activeLegionBattle.objectiveName,
      player: this._sideSummary(gameState, 'player'),
      enemy: this._sideSummary(gameState, 'enemy'),
    });
    return gameState.activeLegionBattle;
  }

  _sideSummary(gameState, side) {
    const b = gameState.activeLegionBattle;
    return (b.units || []).filter(u => u.side === side && u.troops > 0)
      .map(u => ({ id: u.id, name: u.name, unitType: u.unitType, troops: u.troops, morale: u.morale }));
  }

  // ============================================================
  // 查询
  // ============================================================
  findUnit(gameState, id) {
    return (gameState.activeLegionBattle?.units || []).find(u => u.id === id) || null;
  }

  getCurrentActor(gameState) {
    const b = gameState.activeLegionBattle;
    if (!b) return null;
    const slot = b.turnOrder[b.currentActorIndex];
    if (!slot) return null;
    return this.findUnit(gameState, slot.id);
  }

  _zoneIndex(battle, zone) {
    const i = battle.zones.indexOf(zone);
    return i < 0 ? 0 : i;
  }

  /** 单位可攻击的敌方栈（同区/邻区；远程兵放宽 1 区） */
  attackableTargets(gameState, unit) {
    const b = gameState.activeLegionBattle;
    if (!b || !unit) return [];
    const unitTypes = schemaOf(gameState).unitTypes;
    const reach = (unitTypes[unit.unitType]?.ranged || 0) > 0 ? 2 : 1;
    const zi = this._zoneIndex(b, unit.zone);
    return b.units.filter(t => t.side !== unit.side && t.troops > 0
      && Math.abs(this._zoneIndex(b, t.zone) - zi) <= reach);
  }

  /** 攻方能否打到城门（攻城/守城里，攻方贴近城门区） */
  _canHitGate(battle, unit) {
    if (!battle.works || battle.works.gate == null) return false;
    const attackerSide = battle.battleType === 'siege' ? 'player' : 'enemy';
    if (unit.side !== attackerSide) return false;
    const gateZone = battle.gateZone || '城门';
    const zi = this._zoneIndex(battle, unit.zone);
    return Math.abs(zi - this._zoneIndex(battle, gateZone)) <= 1;
  }

  // ============================================================
  // 指令结算
  //   order = { type:'attack'|'move'|'set_formation'|'bombard'|'tactic'|'hold'|'retreat',
  //             targetId?, zone?, formation?, tacticKey? }
  // ============================================================
  executeOrder(gameState, unitId, order = {}) {
    const b = gameState.activeLegionBattle;
    if (!b) return { ok: false, reason: '当前不在军团战中' };
    const unit = this.findUnit(gameState, unitId);
    if (!unit || unit.troops <= 0) return { ok: false, reason: '该部队不可行动' };

    const type = order.type || 'attack';
    const T = this._T(gameState);
    let result;
    switch (type) {
      case 'move': result = this._orderMove(b, unit, order); break;
      case 'set_formation': result = this._orderFormation(T, b, unit, order); break;
      case 'bombard': result = this._orderBombard(T, b, unit, order); break;
      case 'tactic': result = this._orderTactic(gameState, T, b, unit, order); break;
      case 'hold': result = this._orderHold(b, unit); break;
      case 'retreat': result = this._orderRetreat(b, unit); break;
      case 'attack':
      default: result = this._orderAttack(gameState, T, b, unit, order); break;
    }
    result = result || { ok: false, reason: '无效指令' };
    result.unitId = unitId;
    result.orderType = type;
    b.log.push(result);
    this._publish('legion:order', result);
    return result;
  }

  _general(b, unit) {
    return unit.generalId ? (b.generals[unit.generalId] || null) : null;
  }

  _orderMove(b, unit, order) {
    const target = order.zone;
    if (!b.zones.includes(target)) return { ok: false, reason: `无此分区: ${target}`, narrative: '' };
    const from = unit.zone;
    unit.zone = target;
    return { ok: true, narrative: `${unit.name} 由「${from}」移师「${target}」。` };
  }

  _orderFormation(T, b, unit, order) {
    const fk = order.formation;
    const fdef = T.formations[fk];
    if (!fdef) return { ok: false, reason: `无此阵型: ${fk}`, narrative: '' };
    const g = this._general(b, unit);
    if (!canUseFormation(g, fk, T.formations)) {
      return { ok: false, reason: '主将阵法不足', narrative: `${unit.name} 试图布「${fdef.name}」，但主将阵法造诣不足，未能成阵。` };
    }
    unit.formation = fk;
    return { ok: true, narrative: `${unit.name} 摆出「${fdef.name}」。` };
  }

  _orderBombard(T, b, unit, order) {
    const machineKey = (unit.machines || []).find(Boolean);
    if (!machineKey) return { ok: false, reason: '无器械可用', narrative: `${unit.name} 没有可用的攻城器械。` };
    const m = resolveMachine(machineKey, { rng: this.rng, crewTroops: unit.troops, machines: T.machines });
    // 对工事
    if ((m.vs === 'gate' || m.vs === 'wall') && b.works && this._canHitGate(b, unit)) {
      const key = m.vs;
      b.works[key] = Math.max(0, (b.works[key] ?? 0) - m.power);
      return { ok: true, machineKey, narrative: `${unit.name} 操${T.unitTypes[unit.unitType]?.name || ''}以器械猛攻${key === 'gate' ? '城门' : '城墙'}，造成 ${m.power} 点破坏（余 ${b.works[key]}）。`, worksAfter: { ...b.works } };
    }
    // 对部队（弩车等）
    const targets = this.attackableTargets({ activeLegionBattle: b, strategySchema: { unitTypes: T.unitTypes } }, unit);
    const target = this._pickTarget(targets, order.targetId);
    if (!target) return { ok: false, reason: '无可击目标', narrative: `${unit.name} 的器械暂无可击目标。` };
    const losses = Math.min(target.troops, Math.round(m.power * 6 * (0.85 + this.rng() * 0.3)));
    target.troops -= losses;
    target.morale = moraleShift(target, -Math.round((losses / Math.max(1, target.maxTroops)) * 50));
    return { ok: true, machineKey, targetId: target.id, narrative: `${unit.name} 以${machineName(machineKey, T.machines)}远程攒射 ${target.name}，杀伤约 ${losses} 众。` };
  }

  _orderTactic(gameState, T, b, unit, order) {
    const tk = order.tacticKey;
    const g = this._general(b, unit);
    if (!g || !generalHasTactic(g, tk)) return { ok: false, reason: '主将不会该战法', narrative: '' };
    const usedKey = `${unit.id}:${tk}`;
    if (b.tacticsUsed[usedKey]) return { ok: false, reason: '该战法本战已用', narrative: '' };
    b.tacticsUsed[usedKey] = true;
    const chance = tacticSuccessChance(g, tk, T.tactics);
    const success = this.rng() < chance;
    if (!success) return { ok: true, tacticKey: tk, success: false, narrative: `${g.name || unit.name} 施展「${tacticName(tk, T.tactics)}」未能奏效。` };

    if (tk === 'rally') {
      for (const u of b.units) if (u.side === unit.side && u.troops > 0) u.morale = moraleShift(u, 18);
      return { ok: true, tacticKey: tk, success: true, narrative: `${g.name || unit.name} 鼓舞三军，我方士气大振！` };
    }
    // fire / charge / ambush 都对一个目标造成额外杀伤
    const targets = this.attackableTargets(gameState, unit);
    const target = this._pickTarget(targets, order.targetId);
    if (!target) return { ok: true, tacticKey: tk, success: true, narrative: `${g.name || unit.name} 施展「${tacticName(tk, T.tactics)}」，然战场无当面之敌。` };
    const mult = tk === 'fire' ? 0.4 : (tk === 'ambush' ? 0.3 : 0.25);
    const losses = Math.min(target.troops, Math.round(target.troops * mult * (0.85 + this.rng() * 0.3)));
    target.troops -= losses;
    target.morale = moraleShift(target, -Math.round(mult * 80));
    return { ok: true, tacticKey: tk, success: true, targetId: target.id, narrative: `${g.name || unit.name} 「${tacticName(tk, T.tactics)}」奏效，${target.name} 折损约 ${losses} 众，阵脚动摇！` };
  }

  _orderHold(b, unit) {
    unit.morale = moraleShift(unit, 4);
    return { ok: true, narrative: `${unit.name} 据守不动，稳住阵脚。` };
  }

  _orderRetreat(b, unit) {
    unit._fled = true;
    const before = unit.troops;
    unit.troops = 0;
    // 友军见有人退却，士气小挫
    for (const u of b.units) if (u.side === unit.side && u.troops > 0) u.morale = moraleShift(u, -4);
    return { ok: true, fled: true, narrative: `${unit.name}（约 ${before} 众）脱离战场，向后撤退。` };
  }

  _pickTarget(targets, preferredId) {
    if (!targets || targets.length === 0) return null;
    if (preferredId) {
      const t = targets.find(x => x.id === preferredId);
      if (t) return t;
    }
    return targets[0];
  }

  _orderAttack(gameState, T, b, unit, order) {
    // 攻方贴城门 → 默认砸门（无器械则徒手破门，效率低）
    if (b.works && b.works.gate > 0 && this._canHitGate(b, unit) && !order.targetId) {
      const hasMachine = (unit.machines || []).some(Boolean);
      if (hasMachine) return this._orderBombard(T, b, unit, order);
      const dmg = Math.round(8 * (0.7 + this.rng() * 0.6));
      b.works.gate = Math.max(0, b.works.gate - dmg);
      return { ok: true, narrative: `${unit.name} 蚁附攻门，劈砍冲撞，城门受损 ${dmg}（余 ${b.works.gate}）。`, worksAfter: { ...b.works } };
    }

    const targets = this.attackableTargets(gameState, unit);
    const target = this._pickTarget(targets, order.targetId);
    if (!target) {
      // 无当面之敌 → 自动向敌方分区推进一格
      return this._advanceToward(b, unit);
    }
    const r = resolveAttack(unit, target, {
      battleType: b.battleType,
      attackerGeneral: this._general(b, unit),
      defenderGeneral: this._general(b, target),
      rng: this.rng,
      tables: { unitTypes: T.unitTypes, counterMatrix: T.counterMatrix, formations: T.formations, battleTypes: T.battleTypes },
    });
    target.troops = Math.max(0, target.troops - r.defenderLosses);
    unit.troops = Math.max(0, unit.troops - r.attackerLosses);
    target.morale = moraleShift(target, r.moraleDelta);
    if (target.troops <= 0) unit.morale = moraleShift(unit, 8); // 全歼敌栈，士气大振

    const counterNote = r.counter > 1.2 ? '（兵种相克，势如破竹）' : '';
    const narrative = `${unit.name} ${r.attackKind === 'ranged' ? '攒射' : '冲杀'} ${target.name}${counterNote}，` +
      `敌折 ${r.defenderLosses}${r.attackerLosses ? `、我损 ${r.attackerLosses}` : ''}众` +
      `${target.troops <= 0 ? '，敌栈溃灭！' : `（敌余 ${target.troops}，士气 ${target.morale}）`}`;
    return { ok: true, targetId: target.id, ...r, narrative };
  }

  /** 无当面敌 → 朝最近敌栈方向推进一个分区 */
  _advanceToward(b, unit) {
    const enemies = b.units.filter(t => t.side !== unit.side && t.troops > 0);
    if (enemies.length === 0) return { ok: true, narrative: `${unit.name} 按兵观望。` };
    const zi = this._zoneIndex(b, unit.zone);
    const targetZi = this._zoneIndex(b, enemies[0].zone);
    const step = targetZi > zi ? 1 : (targetZi < zi ? -1 : 0);
    if (step === 0) return { ok: true, narrative: `${unit.name} 按兵观望。` };
    const nz = b.zones[Math.max(0, Math.min(b.zones.length - 1, zi + step))];
    const from = unit.zone;
    unit.zone = nz;
    return { ok: true, narrative: `${unit.name} 由「${from}」进逼「${nz}」。` };
  }

  // ============================================================
  // 敌方/自动启发式：为一个栈选一条指令
  // ============================================================
  decideLegion(gameState, unit) {
    const b = gameState.activeLegionBattle;
    if (!b || !unit || unit.troops <= 0) return { type: 'hold' };
    const T = this._T(gameState);
    const g = this._general(b, unit);

    // 士气濒溃 → 退却或死守
    if (unit.morale < MORALE_BREAK + 8) {
      return this.rng() < 0.4 ? { type: 'retreat' } : { type: 'hold' };
    }
    // 首轮未列阵 + 主将能列好阵 → 列阵
    if (unit.formation === 'none') {
      const wish = this._wishFormation(T, unit);
      if (wish && canUseFormation(g, wish, T.formations)) return { type: 'set_formation', formation: wish };
    }
    // 攻方有器械且城门未破 → 轰门（移动到位或直接轰）
    if (b.works && b.works.gate > 0 && (unit.machines || []).some(Boolean)) {
      if (this._canHitGate(b, unit)) return { type: 'bombard' };
      // 向城门推进
      const zi = this._zoneIndex(b, unit.zone);
      const gi = this._zoneIndex(b, b.gateZone || '城门');
      const nz = b.zones[Math.max(0, Math.min(b.zones.length - 1, zi + (gi > zi ? 1 : -1)))];
      return { type: 'move', zone: nz };
    }
    // 有强战法且有目标 → 一定概率用战法
    const tactics = (g?.warfare?.abilities || []).filter(t => t !== 'rally');
    const targets = this.attackableTargets(gameState, unit);
    if (tactics.length > 0 && targets.length > 0 && this.rng() < 0.5) {
      for (const tk of tactics) {
        if (!b.tacticsUsed[`${unit.id}:${tk}`]) {
          const best = this._bestTarget(T, unit, targets);
          return { type: 'tactic', tacticKey: tk, targetId: best?.id };
        }
      }
    }
    // 鼓舞：友军普遍士气低 → rally
    if (g && generalHasTactic(g, 'rally') && !b.tacticsUsed[`${unit.id}:rally`]) {
      const allies = b.units.filter(u => u.side === unit.side && u.troops > 0);
      const avg = allies.reduce((s, u) => s + u.morale, 0) / Math.max(1, allies.length);
      if (avg < 55) return { type: 'tactic', tacticKey: 'rally' };
    }
    // 默认：攻击最优目标（无目标则推进）
    if (targets.length === 0) return { type: 'attack' }; // 内部会自动推进
    const best = this._bestTarget(T, unit, targets);
    return { type: 'attack', targetId: best?.id };
  }

  /**
   * 该兵种的偏好阵型：优先题材 unitType.wishFormation；否则按三国启发式（仅三国兵种 key 命中，
   * 其它题材未提供 wishFormation 时返回 null=不列阵，优雅降级）。
   */
  _wishFormation(T, unit) {
    const ut = unit.unitType;
    const hinted = T.unitTypes[ut]?.wishFormation;
    if (hinted) return T.formations[hinted] ? hinted : null;
    if (ut === 'cavalry') return 'fengshi';     // 骑兵→锋矢突击
    if (ut === 'archer') return 'yanxing';       // 弓兵→雁行
    if (ut === 'spearman' || ut === 'infantry') return unit.side === 'player' ? 'yulin' : 'fangyuan';
    return T.formations.yulin ? 'yulin' : null;
  }

  /** 选克制优势最大、其次兵力最少的目标 */
  _bestTarget(T, unit, targets) {
    return [...targets].sort((a, bb) => {
      const ca = counterMultiplier(unit.unitType, a.unitType, T.counterMatrix);
      const cb = counterMultiplier(unit.unitType, bb.unitType, T.counterMatrix);
      if (cb !== ca) return cb - ca;
      return a.troops - bb.troops;
    })[0] || null;
  }

  // ============================================================
  // 回合推进
  // ============================================================
  nextTurn(gameState) {
    const b = gameState.activeLegionBattle;
    if (!b) return { nextActor: null, newRound: false, battleEnd: false };
    const battleTypes = schemaOf(gameState).battleTypes;

    // 清理：阵亡/退却的栈移出 turnOrder（精确调整 index，复用 CombatSystem 思路）
    const oldOrder = b.turnOrder.slice();
    const oldIdx = b.currentActorIndex;
    b.turnOrder = oldOrder.filter(s => {
      const u = this.findUnit(gameState, s.id);
      return u && u.troops > 0;
    });

    // 胜负（任意时刻全灭/达成条件）
    const v1 = checkVictory(b, battleTypes);
    if (v1) return this.endBattle(gameState, v1);

    const survivorIds = new Set(b.turnOrder.map(s => s.id));
    let removedBeforeOrAt = 0;
    for (let i = 0; i <= oldIdx && i < oldOrder.length; i++) {
      if (!survivorIds.has(oldOrder[i].id)) removedBeforeOrAt++;
    }
    b.currentActorIndex = oldIdx - removedBeforeOrAt;
    b.currentActorIndex++;

    let newRound = false;
    if (b.currentActorIndex >= b.turnOrder.length) {
      b.currentActorIndex = 0;
      b.round++;
      newRound = true;
      this._roundUpkeep(gameState, b);
      this._publish('legion:round', { round: b.round, supply: { ...b.supply }, control: b.control });
    }

    // upkeep 可能触发溃退/胜负
    const v2 = checkVictory(b);
    if (v2) return this.endBattle(gameState, v2);

    // 安全阀：回合数超上限 → 按存活兵力裁定
    if (b.round > SAFETY_ROUND_CAP) {
      const winner = aliveTroops(b.units, 'player') >= aliveTroops(b.units, 'enemy') ? 'player' : 'enemy';
      return this.endBattle(gameState, winner);
    }

    const slot = b.turnOrder[b.currentActorIndex];
    const nextActor = slot ? this.findUnit(gameState, slot.id) : null;
    return { nextActor, newRound, battleEnd: false };
  }

  /** 回合开始的维护：粮草消耗 + 缺粮掉士气 + 士气崩溃溃退 + 水战控渡口 */
  _roundUpkeep(gameState, b) {
    for (const side of ['player', 'enemy']) {
      const total = aliveTroops(b.units, side);
      b.supply[side] = (b.supply[side] ?? 9999) - supplyDrain(total);
      if (b.supply[side] <= 0) {
        for (const u of b.units) if (u.side === side && u.troops > 0) u.morale = moraleShift(u, -LOW_SUPPLY_MORALE_PENALTY);
        this._publish('legion:lowSupply', { side });
      }
    }
    // 士气崩溃 → 溃退
    for (const u of b.units) {
      if (u.troops > 0 && u.morale < MORALE_BREAK) {
        u._routed = true;
        const before = u.troops;
        u.troops = 0;
        b.log.push({ ok: true, unitId: u.id, orderType: 'rout', narrative: `${u.name}（约 ${before} 众）士气崩溃，全军溃散！` });
        this._publish('legion:rout', { unitId: u.id });
      }
    }
    // 水战：控制渡口
    if (b.battleType === 'naval') {
      const atFord = (side) => b.units.some(u => u.side === side && u.troops > 0 && u.zone === '渡口');
      const p = atFord('player'), e = atFord('enemy');
      if (p && !e) b.control = 'player';
      else if (e && !p) b.control = 'enemy';
    }
  }

  // ============================================================
  // 结束
  // ============================================================
  endBattle(gameState, winnerSide) {
    const b = gameState.activeLegionBattle;
    const summary = b ? {
      battleType: b.battleType,
      round: b.round,
      playerTroops: aliveTroops(b.units, 'player'),
      enemyTroops: aliveTroops(b.units, 'enemy'),
      playerLosses: this._totalLosses(b, 'player'),
      enemyLosses: this._totalLosses(b, 'enemy'),
    } : {};
    const result = winnerSide === 'player' ? 'victory' : 'defeat';

    gameState.activeLegionBattle = null;
    gameState.currentPhase = 'exploration';

    const endResult = { battleEnd: true, result, winnerSide, summary, nextActor: null, newRound: false };
    this._publish('legion:end', endResult);
    return endResult;
  }

  _totalLosses(b, side) {
    return (b.units || []).filter(u => u.side === side)
      .reduce((s, u) => s + Math.max(0, (u.maxTroops || 0) - (u.troops || 0)), 0);
  }

  _publish(topic, payload) {
    if (this.eventSystem) this.eventSystem.publish(topic, payload);
  }

  destroy() {
    this.eventSystem = null;
    super.destroy();
  }
}

// 小工具：器械/战法显示名（取自题材表，缺省回退通用词）
function machineName(key, machines = {}) {
  return machines[key]?.name || '器械';
}
function tacticName(key, tactics = {}) {
  return tactics[key]?.name || '战法';
}
