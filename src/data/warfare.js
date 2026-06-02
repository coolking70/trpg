/**
 * 军团战争数据层（Phase 31）—— 单位栈战术制
 *
 * 与个人战斗（CombatSystem：HP/属性/先攻回合制）完全平行、零耦合的另一套战斗模型。
 * 本文件只放「兵种 / 克制 / 阵型 / 器械 / 战型 / 战法」的数据表与纯结算函数，
 * 由 runtime(LegionWarfareSystem) 与 mcp-server(builder/模拟器) 共享。
 *
 * 设计原则（对齐 ecology.js）：
 *   - 纯数据 + 纯函数，无任何 import，ESM 与 .mjs 都能直接引用
 *   - 所有随机点都接受可注入 rng（默认 Math.random），便于确定性测试与蒙特卡洛模拟
 *   - 数值偏抽象（troops 以「兵」为单位，常见数百~数万），由 L5 平衡模拟器校准
 *
 * 核心概念：
 *   unitStack = { id, side, unitType, troops, maxTroops, morale, zone, generalId?, formation?, machines:[] }
 *   general.warfare = { command 统率, might 武力, intellect 智力, tactics 阵法等级0-3, abilities:[战法key] }
 */

// ============================================================
// 兵种（UNIT_TYPES）
//   每兵种给「每兵基准战力」：melee 近战攻、def 防、ranged 远程攻(0=纯近战)、
//   speed 行动力、charge 冲锋系数、water 水战适应(1=如常,<1 受罚,>1 占优)
// ============================================================
export const UNIT_TYPES = {
  infantry: { name: '步兵', melee: 10, def: 9,  ranged: 0,  speed: 5, charge: 1.0, water: 0.5 },
  cavalry:  { name: '骑兵', melee: 14, def: 7,  ranged: 0,  speed: 9, charge: 1.6, water: 0.2 },
  archer:   { name: '弓兵', melee: 5,  def: 5,  ranged: 11, speed: 5, charge: 1.0, water: 0.6 },
  spearman: { name: '枪兵', melee: 9,  def: 11, ranged: 0,  speed: 5, charge: 1.0, water: 0.5 },
  navy:     { name: '水军', melee: 9,  def: 9,  ranged: 4,  speed: 6, charge: 1.0, water: 1.6 },
  siege:    { name: '器械兵', melee: 4, def: 6, ranged: 6,  speed: 3, charge: 1.0, water: 0.4 },
};

export const UNIT_KEYS = Object.keys(UNIT_TYPES);

// ============================================================
// 克制矩阵（COUNTER_MATRIX）—— 攻方兵种对守方兵种的伤害倍率，缺省 1.0
//   枪克骑 / 骑克弓 / 骑克器械 / 弓克步弓克枪(射程) / 步近身克弓
// ============================================================
export const COUNTER_MATRIX = {
  spearman: { cavalry: 1.6 },
  cavalry:  { archer: 1.5, siege: 1.4, infantry: 1.15 },
  archer:   { spearman: 1.3, infantry: 1.2 },
  infantry: { archer: 1.3 },
  navy:     { infantry: 1.3, cavalry: 1.5, archer: 1.2, spearman: 1.3, siege: 1.3 }, // 仅水战地形生效
};

/** 攻方→守方克制倍率（缺省 1.0）。matrix 可由题材 Schema 覆盖。 */
export function counterMultiplier(attackerType, defenderType, matrix = COUNTER_MATRIX) {
  return matrix[attackerType]?.[defenderType] ?? 1.0;
}

// ============================================================
// 阵型（FORMATIONS）—— statMods 为乘性修正；requiresTactics 为主将阵法等级门槛
// ============================================================
export const FORMATIONS = {
  none:     { name: '无阵', statMods: {}, requiresTactics: 0, note: '未列阵' },
  fangyuan: { name: '方圆', statMods: { def: 1.3, atk: 0.85, morale: 1.1 }, requiresTactics: 0, note: '防御阵，稳守' },
  changshe: { name: '长蛇', statMods: { speed: 1.3, def: 0.9 }, requiresTactics: 1, note: '机动阵，利转进' },
  yulin:    { name: '鱼鳞', statMods: { atk: 1.2, def: 1.05 }, requiresTactics: 1, note: '攻守均衡，中央突破' },
  fengshi:  { name: '锋矢', statMods: { atk: 1.35, charge: 1.3, def: 0.8 }, requiresTactics: 2, note: '突击阵，利冲锋' },
  heyi:     { name: '鹤翼', statMods: { atk: 1.15, range: 1.25, def: 0.95 }, requiresTactics: 2, note: '包抄阵，利远程合围' },
  yanxing:  { name: '雁行', statMods: { range: 1.4, atk: 1.05, def: 0.85 }, requiresTactics: 3, note: '远程阵，弓弩齐发' },
};

export const FORMATION_KEYS = Object.keys(FORMATIONS);

/** 主将阵法等级是否足以使用该阵型（无主将按 tactics=0）。formations 可由题材覆盖。 */
export function canUseFormation(general, formationKey, formations = FORMATIONS) {
  const f = formations[formationKey];
  if (!f) return false;
  const tactics = general?.warfare?.tactics ?? 0;
  return tactics >= (f.requiresTactics || 0);
}

// ============================================================
// 战争器械（WAR_MACHINES）
//   effect.vs: 'wall'(城墙) | 'gate'(城门) | 'unit'(部队) | 'naval'(舰船)
//   battleTypes: 允许出现的战型；mobility: 机动性(低=拖累移动)
// ============================================================
export const WAR_MACHINES = {
  catapult:  { name: '投石车', effect: { vs: 'wall', power: 40, area: true },  mobility: 0.3, battleTypes: ['siege', 'defense'] },
  ram:       { name: '攻城锤', effect: { vs: 'gate', power: 55, area: false }, mobility: 0.2, battleTypes: ['siege'] },
  ballista:  { name: '弩车',   effect: { vs: 'unit', power: 22, area: false }, mobility: 0.5, battleTypes: ['field', 'siege', 'defense'] },
  towerShip: { name: '楼船',   effect: { vs: 'naval', power: 30, area: true }, mobility: 0.5, battleTypes: ['naval'] },
  mengchong: { name: '蒙冲',   effect: { vs: 'naval', power: 26, area: false }, mobility: 0.9, battleTypes: ['naval'] },
};

export const MACHINE_KEYS = Object.keys(WAR_MACHINES);

// ============================================================
// 战型（BATTLE_TYPES）—— 分区 / 胜负条件 / 器械携带白名单+上限 / 地形对兵种影响
//   victory.type: 'rout'(歼灭或击溃) | 'breach'(攻破城门) | 'hold'(守住N回合) | 'control'(控制渡口)
// ============================================================
export const BATTLE_TYPES = {
  field: {
    name: '野战', zones: ['前阵', '侧翼', '后阵'],
    victory: { type: 'rout' },
    machineLimits: { ballista: 2 },
    terrain: 'plain', // 不偏向特定兵种
  },
  siege: {
    name: '攻城', zones: ['城外', '城门', '城墙', '城内'], gateZone: '城门',
    victory: { type: 'breach', target: 'gate', rounds: 12 }, // 攻方需在 rounds 内破门，否则攻方失败
    machineLimits: { catapult: 2, ram: 1, ballista: 2 },
    terrain: 'wall', // 守方在城墙享防御加成
    defenseWorks: { gate: 200, wall: 300 },
  },
  defense: {
    name: '守城', zones: ['城外', '城门', '城墙', '城内'], gateZone: '城门',
    victory: { type: 'hold', rounds: 10 }, // 守方守满 rounds 即胜；攻方破门或歼灭守方则攻方胜
    machineLimits: { catapult: 2, ballista: 3 },
    terrain: 'wall',
    defenseWorks: { gate: 220, wall: 320 },
  },
  naval: {
    name: '水战', zones: ['江心', '水寨', '渡口'],
    victory: { type: 'control', target: '渡口', rounds: 12 },
    machineLimits: { towerShip: 2, mengchong: 3 },
    terrain: 'water', // 非水军受罚（见 terrainUnitFactor）
  },
};

export const BATTLE_TYPE_KEYS = Object.keys(BATTLE_TYPES);

/** 某战型下某器械的携带上限（不允许=0）。battleTypes 可由题材覆盖。 */
export function machineCarryLimit(battleType, machineKey, battleTypes = BATTLE_TYPES) {
  return battleTypes[battleType]?.machineLimits?.[machineKey] ?? 0;
}

/** 地形对某兵种的战力系数（water 地形非水栖兵种受罚）。battleTypes/unitTypes 可由题材覆盖。 */
export function terrainUnitFactor(battleType, unitType, battleTypes = BATTLE_TYPES, unitTypes = UNIT_TYPES) {
  const terrain = battleTypes[battleType]?.terrain;
  if (terrain === 'water') {
    return unitTypes[unitType]?.water ?? 1.0;
  }
  return 1.0;
}

// ============================================================
// 战法（TACTICS）—— 主将主动技；stat 决定成功率，effect 描述结算钩子
// ============================================================
export const TACTICS = {
  charge:  { name: '突击', stat: 'command',   baseChance: 0.55, note: '骑/锋矢突进，本次攻击附加冲锋加成' },
  fire:    { name: '火攻', stat: 'intellect', baseChance: 0.45, note: '大范围焚烧，水战/野战巨额杀伤(需风势)' },
  ambush:  { name: '伏兵', stat: 'intellect', baseChance: 0.5,  note: '奇袭一栈，无视部分阵型/工事' },
  rally:   { name: '鼓舞', stat: 'command',   baseChance: 0.7,  note: '提振本方士气' },
};

export const TACTIC_KEYS = Object.keys(TACTICS);

/** 战法成功率：基准 + 主将对应属性/100，封顶 0.95。tactics 可由题材覆盖。 */
export function tacticSuccessChance(general, tacticKey, tactics = TACTICS) {
  const t = tactics[tacticKey];
  if (!t) return 0;
  const statVal = general?.warfare?.[t.stat] ?? 0;
  return Math.max(0.05, Math.min(0.95, t.baseChance + statVal / 100));
}

/** 主将是否会该战法 */
export function generalHasTactic(general, tacticKey) {
  return (general?.warfare?.abilities || []).includes(tacticKey);
}

// ============================================================
// 士气（MORALE）
// ============================================================
export const MORALE_MAX = 100;
export const MORALE_BREAK = 25; // 低于此值该栈溃退

/** 阵型/主将对某结算属性的乘性修正（atk/def/range/speed/charge/morale）。formations 可由题材覆盖。 */
function formationMod(unit, stat, formations = FORMATIONS) {
  const f = formations[unit?.formation || 'none'];
  return f?.statMods?.[stat] ?? 1.0;
}

/** 主将对部队的影响系数：武力加近战、统率加防/士气、智力加远程 */
function generalFactor(general, kind) {
  const w = general?.warfare;
  if (!w) return 1.0;
  if (kind === 'melee') return 1 + (w.might || 0) / 120;
  if (kind === 'def') return 1 + (w.command || 0) / 200;
  if (kind === 'ranged') return 1 + (w.intellect || 0) / 200;
  return 1.0;
}

/** 士气对战力的系数：满士气 1.0，越低越弱，最低 0.5 */
function moraleFactor(unit) {
  const m = Math.max(0, Math.min(MORALE_MAX, unit?.morale ?? MORALE_MAX));
  return 0.5 + 0.5 * (m / MORALE_MAX);
}

// ============================================================
// 核心结算：resolveAttack
//   一次「攻方栈 → 守方栈」的接战，返回双方兵力损耗 + 守方士气变化 + 是否溃退
//   ctx = { battleType, attackerGeneral, defenderGeneral, rng }
// ============================================================
export function resolveAttack(attacker, defender, ctx = {}) {
  const { battleType = 'field', attackerGeneral = null, defenderGeneral = null, rng = Math.random, tables = {} } = ctx;
  // 题材表（缺省=内置三国常量）
  const unitTypes = tables.unitTypes || UNIT_TYPES;
  const counterMatrix = tables.counterMatrix || COUNTER_MATRIX;
  const formations = tables.formations || FORMATIONS;
  const battleTypes = tables.battleTypes || BATTLE_TYPES;
  const fallbackUnit = unitTypes.infantry || Object.values(unitTypes)[0] || UNIT_TYPES.infantry;
  // water 地形的“水栖兵种”判定：本题材中有 water 加成(>1)者视为水军，免地形罚（取代硬编码 'navy'）
  const aType = attacker.unitType, dType = defender.unitType;
  const aBase = unitTypes[aType] || fallbackUnit;
  const dBase = unitTypes[dType] || fallbackUnit;

  // 攻方是否远程：远程兵且本次以远程结算（无近战反击）
  const ranged = (aBase.ranged || 0) > 0 && (aBase.melee || 0) < (aBase.ranged || 0);
  const atkStat = ranged ? aBase.ranged : aBase.melee;
  const atkKind = ranged ? 'ranged' : 'melee';

  // 水栖兵种(water>1)的克制仅在 water 地形生效（替代硬编码 navy）：
  //   非 water 地形 + 水栖攻方 → 不享克制；其余情形正常取克制倍率。
  const aquaticAtk = (aBase.water || 0) > 1;
  const isWaterTerrain = battleTypes[battleType]?.terrain === 'water';
  const counter = (isWaterTerrain || !aquaticAtk) ? counterMultiplier(aType, dType, counterMatrix) : 1.0;
  const terrainA = terrainUnitFactor(battleType, aType, battleTypes, unitTypes);
  const terrainD = terrainUnitFactor(battleType, dType, battleTypes, unitTypes);

  // 攻方总战力
  let power = attacker.troops * atkStat
    * counter
    * formationMod(attacker, 'atk', formations)
    * (atkKind === 'ranged' ? formationMod(attacker, 'range', formations) : 1.0)
    * ((aBase.charge || 1) > 1 ? formationMod(attacker, 'charge', formations) : 1.0)
    * generalFactor(attackerGeneral, atkKind)
    * terrainA
    * moraleFactor(attacker);

  // 守方坚韧度
  const toughness = dBase.def
    * formationMod(defender, 'def', formations)
    * generalFactor(defenderGeneral, 'def')
    * terrainD;

  // 规模优势（兵力差的平方根，封顶，避免一边倒过快）
  const sizeAdv = Math.max(0.5, Math.min(2.0, Math.sqrt(attacker.troops / Math.max(1, defender.troops))));

  const ratio = power / Math.max(1, defender.troops * toughness);
  const lossFrac = Math.max(0.02, Math.min(0.45, 0.10 * ratio * sizeAdv));
  // 随机波动 ±20%
  const variance = 0.8 + rng() * 0.4;
  const defenderLosses = Math.min(defender.troops, Math.round(defender.troops * lossFrac * variance));

  // 反击：守方近战兵种回敬（远程攻击守方近战可少量反击；守方亦远程则几乎无反击）
  const defMelee = dBase.melee > 0 ? 1 : 0;
  const counterFrac = ranged ? 0.1 : 0.4;
  const attackerLosses = Math.min(
    attacker.troops,
    Math.round(attacker.troops * lossFrac * counterFrac * defMelee * (0.8 + rng() * 0.4))
  );

  // 守方士气：按损失比例下挫，被克制额外掉，主将统率回稳
  const lossRatio = defenderLosses / Math.max(1, defender.troops);
  const counterPenalty = counter > 1.2 ? 6 : 0;
  const commandSteady = (defenderGeneral?.warfare?.command || 0) / 25;
  const moraleDelta = -Math.round(lossRatio * 60 + counterPenalty - commandSteady);

  return {
    attackerId: attacker.id, defenderId: defender.id,
    attackKind: atkKind, counter, lossFrac: +lossFrac.toFixed(3),
    defenderLosses, attackerLosses, moraleDelta,
    defenderRoutsAfter: (defender.morale + moraleDelta) < MORALE_BREAK
      || (defender.troops - defenderLosses) <= 0,
  };
}

/** 应用一次士气事件，返回新士气值（夹在 [0,MORALE_MAX]） */
export function moraleShift(unit, delta) {
  return Math.max(0, Math.min(MORALE_MAX, (unit?.morale ?? MORALE_MAX) + delta));
}

// ============================================================
// 器械结算：对工事（城门/城墙）或部队
// ============================================================
export function resolveMachine(machineKey, ctx = {}) {
  const machines = ctx.machines || WAR_MACHINES;
  const m = machines[machineKey];
  if (!m) return { power: 0, vs: null };
  const { rng = Math.random, crewTroops = 0 } = ctx;
  // 器械威力随操作兵力小幅提升，含 ±15% 波动
  const crewBonus = 1 + Math.min(0.5, crewTroops / 2000);
  const power = Math.round(m.effect.power * crewBonus * (0.85 + rng() * 0.3));
  return { power, vs: m.effect.vs, area: !!m.effect.area };
}

// ============================================================
// 粮草（SUPPLY）—— 每回合消耗 = 总兵力 / SUPPLY_PER_ROUND_DIVISOR；粮尽则全军掉士气
// ============================================================
export const SUPPLY_PER_ROUND_DIVISOR = 100; // 每 100 兵每回合耗 1 粮
export const LOW_SUPPLY_MORALE_PENALTY = 8;

/** 某回合一方的粮草消耗 */
export function supplyDrain(totalTroops) {
  return Math.ceil(Math.max(0, totalTroops) / SUPPLY_PER_ROUND_DIVISOR);
}

// ============================================================
// 胜负判定：checkVictory(battle) → 'player' | 'enemy' | null
//   battle = { battleType, units:[{side,troops}], round, works:{gate,wall}, control? }
//   约定：player=攻/守方视角的我方；victory.type 决定条件
// ============================================================
export function aliveTroops(units, side) {
  return (units || []).filter(u => u.side === side && u.troops > 0)
    .reduce((s, u) => s + u.troops, 0);
}

export function checkVictory(battle, battleTypes = BATTLE_TYPES) {
  const { battleType, units = [], round = 1, works = {} } = battle;
  const def = battleTypes[battleType] || battleTypes.field || BATTLE_TYPES.field;
  const playerAlive = aliveTroops(units, 'player');
  const enemyAlive = aliveTroops(units, 'enemy');

  // 任意一方全灭：另一方胜（所有战型通用）
  if (playerAlive <= 0) return 'enemy';
  if (enemyAlive <= 0) return 'player';

  switch (def.victory.type) {
    case 'rout': // 野战：歼灭对方即胜（上面已覆盖全灭），否则继续
      return null;
    case 'breach': // 攻城：我方为攻方，破门(gate<=0)即胜；超时(round>rounds)攻方失败
      if ((works.gate ?? 1) <= 0) return 'player';
      if (round > (def.victory.rounds || 12)) return 'enemy';
      return null;
    case 'hold': // 守城：我方为守方，守满回合即胜；门破则攻方(enemy)胜
      if ((works.gate ?? 1) <= 0) return 'enemy';
      if (round > (def.victory.rounds || 10)) return 'player';
      return null;
    case 'control': // 水战：控制渡口（battle.control==='player'）即胜，或超时按存活兵力多者
      if (battle.control === 'player') return 'player';
      if (battle.control === 'enemy') return 'enemy';
      if (round > (def.victory.rounds || 12)) return playerAlive >= enemyAlive ? 'player' : 'enemy';
      return null;
    default:
      return null;
  }
}

// ============================================================
// 校验：单位栈 / 军团编制（供 preset 校验复用）
// ============================================================
/** 校验一个 unitStack 定义，返回 errors[]（空=通过）。tables 可由题材 Schema 覆盖。 */
export function validateUnitStack(u = {}, tables = {}) {
  const unitTypes = tables.unitTypes || UNIT_TYPES;
  const formations = tables.formations || FORMATIONS;
  const machines = tables.machines || WAR_MACHINES;
  const errs = [];
  if (!u.unitType || !unitTypes[u.unitType]) errs.push(`未知兵种: ${u.unitType}`);
  if (!(u.troops > 0)) errs.push(`兵力须为正: ${u.troops}`);
  if (u.formation && !formations[u.formation]) errs.push(`未知阵型: ${u.formation}`);
  for (const mk of (u.machines || [])) {
    if (!machines[mk]) errs.push(`未知器械: ${mk}`);
  }
  return errs;
}

/**
 * 校验一场军团战编制是否合法（器械携带上限 / 兵种 / 阵型 / 主将引用）
 * @param {object} battle - { battleType, units:[unitStack], generalIds?:Set|Array }
 * @returns {string[]} errors（空=通过）
 */
export function validateLegionBattle(battle = {}, knownGeneralIds = null, tables = {}) {
  const battleTypes = tables.battleTypes || BATTLE_TYPES;
  const machines = tables.machines || WAR_MACHINES;
  const errs = [];
  const bt = battle.battleType;
  if (!battleTypes[bt]) { errs.push(`未知战型: ${bt}`); return errs; }
  const genSet = knownGeneralIds ? new Set(knownGeneralIds) : null;
  // 按 side 统计器械数量，校验携带上限
  const machineCount = {}; // `${side}:${machineKey}` → n
  for (const u of (battle.units || [])) {
    for (const e of validateUnitStack(u, tables)) errs.push(e);
    if (u.generalId && genSet && !genSet.has(u.generalId)) errs.push(`未知主将引用: ${u.generalId}`);
    for (const mk of (u.machines || [])) {
      const key = `${u.side}:${mk}`;
      machineCount[key] = (machineCount[key] || 0) + 1;
      if (!(machines[mk]?.battleTypes || []).includes(bt)) {
        errs.push(`器械 ${mk} 不可用于 ${bt}`);
      }
    }
  }
  for (const [key, n] of Object.entries(machineCount)) {
    const mk = key.split(':')[1];
    const limit = machineCarryLimit(bt, mk, battleTypes);
    if (n > limit) errs.push(`器械 ${mk} 超携带上限(${n}>${limit}) @${bt}`);
  }
  return errs;
}

// ============================================================
// 默认主将武备（供 builder 给未指定 warfare 的角色兜底）
// ============================================================
export const DEFAULT_GENERAL_WARFARE = { command: 50, might: 50, intellect: 50, tactics: 1, abilities: ['rally'] };
