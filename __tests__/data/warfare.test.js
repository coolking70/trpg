/**
 * warfare.js 单元测试（Phase 31 — 军团战争数据层 / 单位栈战术制）
 */

import {
  UNIT_TYPES, UNIT_KEYS, COUNTER_MATRIX, counterMultiplier,
  FORMATIONS, FORMATION_KEYS, canUseFormation,
  WAR_MACHINES, MACHINE_KEYS, BATTLE_TYPES, BATTLE_TYPE_KEYS,
  machineCarryLimit, terrainUnitFactor,
  TACTICS, tacticSuccessChance, generalHasTactic,
  MORALE_MAX, MORALE_BREAK, resolveAttack, moraleShift, resolveMachine,
  supplyDrain, aliveTroops, checkVictory,
  validateUnitStack, validateLegionBattle, DEFAULT_GENERAL_WARFARE,
} from '../../src/data/warfare.js';

const rngSeq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

describe('warfare — 数据表自洽', () => {
  test('兵种/阵型/器械/战型表非空', () => {
    expect(UNIT_KEYS).toEqual(expect.arrayContaining(['infantry', 'cavalry', 'archer', 'spearman', 'navy', 'siege']));
    expect(FORMATION_KEYS).toContain('fengshi');
    expect(MACHINE_KEYS).toEqual(expect.arrayContaining(['catapult', 'ram', 'ballista', 'towerShip', 'mengchong']));
    expect(BATTLE_TYPE_KEYS).toEqual(['field', 'siege', 'defense', 'naval']);
  });

  test('每个兵种含必要字段', () => {
    for (const k of UNIT_KEYS) {
      const u = UNIT_TYPES[k];
      expect(typeof u.melee).toBe('number');
      expect(typeof u.def).toBe('number');
      expect(typeof u.water).toBe('number');
    }
  });
});

describe('counterMultiplier — 兵种克制', () => {
  test('枪克骑 / 骑克弓 / 弓克枪', () => {
    expect(counterMultiplier('spearman', 'cavalry')).toBeGreaterThan(1);
    expect(counterMultiplier('cavalry', 'archer')).toBeGreaterThan(1);
    expect(counterMultiplier('archer', 'spearman')).toBeGreaterThan(1);
  });
  test('无克制关系返回 1.0', () => {
    expect(counterMultiplier('infantry', 'infantry')).toBe(1.0);
    expect(counterMultiplier('siege', 'navy')).toBe(1.0);
  });
});

describe('canUseFormation — 阵法门槛', () => {
  test('低阵法主将不能用高阶阵型', () => {
    const novice = { warfare: { tactics: 0 } };
    expect(canUseFormation(novice, 'fangyuan')).toBe(true);  // requiresTactics 0
    expect(canUseFormation(novice, 'fengshi')).toBe(false);  // requiresTactics 2
    expect(canUseFormation(novice, 'yanxing')).toBe(false);  // requiresTactics 3
  });
  test('高阵法主将解锁全部阵型', () => {
    const master = { warfare: { tactics: 3 } };
    for (const f of FORMATION_KEYS) expect(canUseFormation(master, f)).toBe(true);
  });
  test('无主将按 tactics=0', () => {
    expect(canUseFormation(null, 'yanxing')).toBe(false);
    expect(canUseFormation(null, 'none')).toBe(true);
  });
});

describe('machineCarryLimit / terrainUnitFactor', () => {
  test('攻城允许攻城锤但野战不允许', () => {
    expect(machineCarryLimit('siege', 'ram')).toBe(1);
    expect(machineCarryLimit('field', 'ram')).toBe(0);
  });
  test('水战非水军受罚，水军占优', () => {
    expect(terrainUnitFactor('naval', 'cavalry')).toBeLessThan(1);
    expect(terrainUnitFactor('naval', 'navy')).toBeGreaterThan(1);
    expect(terrainUnitFactor('field', 'cavalry')).toBe(1.0);
  });
});

describe('TACTICS — 战法成功率', () => {
  test('属性越高成功率越高，封顶 0.95', () => {
    const weak = { warfare: { intellect: 0 } };
    const strong = { warfare: { intellect: 100 } };
    expect(tacticSuccessChance(strong, 'fire')).toBeGreaterThan(tacticSuccessChance(weak, 'fire'));
    expect(tacticSuccessChance({ warfare: { intellect: 999 } }, 'fire')).toBeLessThanOrEqual(0.95);
  });
  test('generalHasTactic', () => {
    const g = { warfare: { abilities: ['fire', 'ambush'] } };
    expect(generalHasTactic(g, 'fire')).toBe(true);
    expect(generalHasTactic(g, 'charge')).toBe(false);
  });
});

describe('resolveAttack — 接战结算', () => {
  const mk = (over = {}) => ({ id: 'u', side: 'player', unitType: 'infantry', troops: 1000, morale: MORALE_MAX, formation: 'none', ...over });

  test('克制方造成更多损失', () => {
    const rng = () => 0.5; // 固定波动
    const vsCav = resolveAttack(mk({ unitType: 'spearman' }), mk({ unitType: 'cavalry', side: 'enemy' }), { rng });
    const vsInf = resolveAttack(mk({ unitType: 'spearman' }), mk({ unitType: 'infantry', side: 'enemy' }), { rng });
    expect(vsCav.defenderLosses).toBeGreaterThan(vsInf.defenderLosses);
    expect(vsCav.counter).toBeGreaterThan(1);
  });

  test('损失与士气下挫成正比，触发溃退标记', () => {
    const rng = () => 0.9;
    // 悬殊兵力 + 克制 → 守方重创
    const r = resolveAttack(
      mk({ unitType: 'cavalry', troops: 5000 }),
      mk({ unitType: 'archer', side: 'enemy', troops: 300, morale: 30 }),
      { rng });
    expect(r.defenderLosses).toBeGreaterThan(0);
    expect(r.moraleDelta).toBeLessThan(0);
    expect(r.defenderRoutsAfter).toBe(true);
  });

  test('远程攻击反击很小', () => {
    const rng = () => 0.5;
    const r = resolveAttack(mk({ unitType: 'archer' }), mk({ unitType: 'infantry', side: 'enemy' }), { rng });
    expect(r.attackKind).toBe('ranged');
    expect(r.attackerLosses).toBeLessThan(r.defenderLosses);
  });

  test('主将武力提升近战杀伤', () => {
    const rng = () => 0.5;
    const noG = resolveAttack(mk({ unitType: 'cavalry' }), mk({ side: 'enemy' }), { rng });
    const withG = resolveAttack(mk({ unitType: 'cavalry' }), mk({ side: 'enemy' }), {
      rng, attackerGeneral: { warfare: { might: 100 } },
    });
    expect(withG.defenderLosses).toBeGreaterThan(noG.defenderLosses);
  });
});

describe('moraleShift / supplyDrain / resolveMachine', () => {
  test('moraleShift 夹在 [0, MAX]', () => {
    expect(moraleShift({ morale: 10 }, -50)).toBe(0);
    expect(moraleShift({ morale: 90 }, 50)).toBe(MORALE_MAX);
  });
  test('supplyDrain 随兵力增加', () => {
    expect(supplyDrain(1000)).toBeGreaterThan(supplyDrain(100));
    expect(supplyDrain(0)).toBe(0);
  });
  test('resolveMachine 产出攻城威力', () => {
    const r = resolveMachine('ram', { rng: () => 0.5, crewTroops: 500 });
    expect(r.vs).toBe('gate');
    expect(r.power).toBeGreaterThan(0);
    expect(resolveMachine('unknown').power).toBe(0);
  });
});

describe('checkVictory — 各战型胜负', () => {
  test('野战：一方全灭对方胜', () => {
    const battle = { battleType: 'field', round: 3, units: [
      { side: 'player', troops: 800 }, { side: 'enemy', troops: 0 },
    ] };
    expect(checkVictory(battle)).toBe('player');
  });
  test('攻城：破门则攻方(player)胜，超时攻方败', () => {
    const base = { battleType: 'siege', units: [{ side: 'player', troops: 500 }, { side: 'enemy', troops: 500 }] };
    expect(checkVictory({ ...base, round: 2, works: { gate: 0 } })).toBe('player');
    expect(checkVictory({ ...base, round: 99, works: { gate: 50 } })).toBe('enemy');
    expect(checkVictory({ ...base, round: 2, works: { gate: 50 } })).toBe(null);
  });
  test('守城：守满回合守方(player)胜，门破攻方胜', () => {
    const base = { battleType: 'defense', units: [{ side: 'player', troops: 500 }, { side: 'enemy', troops: 500 }] };
    expect(checkVictory({ ...base, round: 99, works: { gate: 100 } })).toBe('player');
    expect(checkVictory({ ...base, round: 2, works: { gate: 0 } })).toBe('enemy');
  });
  test('水战：控制渡口即胜', () => {
    const base = { battleType: 'naval', round: 2, units: [{ side: 'player', troops: 500 }, { side: 'enemy', troops: 500 }] };
    expect(checkVictory({ ...base, control: 'player' })).toBe('player');
    expect(checkVictory({ ...base })).toBe(null);
  });
  test('aliveTroops 累计存活兵力', () => {
    const units = [{ side: 'player', troops: 300 }, { side: 'player', troops: 200 }, { side: 'enemy', troops: 100 }];
    expect(aliveTroops(units, 'player')).toBe(500);
    expect(aliveTroops(units, 'enemy')).toBe(100);
  });
});

describe('validateUnitStack / validateLegionBattle', () => {
  test('合法单位栈无错误', () => {
    expect(validateUnitStack({ unitType: 'infantry', troops: 500, formation: 'fangyuan' })).toEqual([]);
  });
  test('非法兵种/兵力/阵型报错', () => {
    const errs = validateUnitStack({ unitType: 'wizard', troops: 0, formation: 'phalanx' });
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
  test('器械超携带上限报错', () => {
    const battle = { battleType: 'siege', units: [
      { side: 'player', unitType: 'siege', troops: 300, machines: ['ram', 'ram'] }, // 上限 1
    ] };
    const errs = validateLegionBattle(battle);
    expect(errs.some(e => /超携带上限/.test(e))).toBe(true);
  });
  test('器械用于不支持的战型报错', () => {
    const battle = { battleType: 'field', units: [
      { side: 'player', unitType: 'siege', troops: 300, machines: ['catapult'] }, // 野战不允许投石车
    ] };
    const errs = validateLegionBattle(battle);
    expect(errs.some(e => /不可用于/.test(e) || /超携带上限/.test(e))).toBe(true);
  });
  test('未知主将引用报错', () => {
    const battle = { battleType: 'field', units: [
      { side: 'player', unitType: 'infantry', troops: 300, generalId: 'ghost' },
    ] };
    const errs = validateLegionBattle(battle, ['real_general']);
    expect(errs.some(e => /未知主将/.test(e))).toBe(true);
  });
  test('合法编制通过', () => {
    const battle = { battleType: 'naval', units: [
      { side: 'player', unitType: 'navy', troops: 1000, machines: ['mengchong', 'mengchong'], generalId: 'zhouyu' },
      { side: 'enemy', unitType: 'navy', troops: 1200, machines: ['towerShip'] },
    ] };
    expect(validateLegionBattle(battle, ['zhouyu'])).toEqual([]);
  });
});

describe('DEFAULT_GENERAL_WARFARE', () => {
  test('含五项武备字段', () => {
    expect(DEFAULT_GENERAL_WARFARE).toEqual(expect.objectContaining({
      command: expect.any(Number), might: expect.any(Number), intellect: expect.any(Number),
      tactics: expect.any(Number), abilities: expect.any(Array),
    }));
  });
});
