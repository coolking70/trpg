/**
 * 军团战平衡模拟器测试（Phase 31 L5）
 * 验证 Monte Carlo 模拟器能按兵力/将略优劣给出单调、合理的胜率区间。
 */

import { simulateLegionBattle, simulateOnce, makeSeededRng, balanceFlag, collectLegionBattles }
  from '../../src/systems/legionSimulator.js';

const baseBattle = () => ({
  battleType: 'field',
  generals: {
    liubei: { name: '刘备', warfare: { command: 80, might: 65, intellect: 75, tactics: 2, abilities: ['rally', 'charge'] } },
    caocao: { name: '曹操', warfare: { command: 95, might: 70, intellect: 92, tactics: 3, abilities: ['fire', 'ambush', 'rally'] } },
  },
  supply: { player: 80, enemy: 60 },
  units: [
    { id: 'p1', side: 'player', unitType: 'infantry', troops: 5000, generalId: 'liubei', formation: 'yulin' },
    { id: 'p2', side: 'player', unitType: 'archer', troops: 2000, generalId: 'liubei' },
    { id: 'e1', side: 'enemy', unitType: 'cavalry', troops: 4000, generalId: 'caocao' },
    { id: 'e2', side: 'enemy', unitType: 'spearman', troops: 3000, generalId: 'caocao' },
  ],
});

describe('军团战平衡模拟器', () => {
  test('simulateOnce 产出胜负与损耗比', () => {
    const r = simulateOnce(baseBattle(), makeSeededRng(7));
    expect(['player', 'enemy']).toContain(r.winnerSide);
    expect(r.playerLossRatio).toBeGreaterThanOrEqual(0);
    expect(r.playerLossRatio).toBeLessThanOrEqual(1);
    expect(r.timedOut).toBe(false);
  });

  test('兵力优劣 → 胜率单调（碾压 > 均势 > 劣势）', () => {
    const crush = baseBattle(); crush.units[0].troops = 12000; crush.units[1].troops = 6000;
    const weak = baseBattle(); weak.units[0].troops = 1500; weak.units[1].troops = 800;

    const rCrush = simulateLegionBattle(crush, { runs: 300 });
    const rEven = simulateLegionBattle(baseBattle(), { runs: 300 });
    const rWeak = simulateLegionBattle(weak, { runs: 300 });

    expect(rCrush.winRate).toBeGreaterThan(rEven.winRate);
    expect(rEven.winRate).toBeGreaterThan(rWeak.winRate);
    expect(rCrush.winRate).toBeGreaterThan(0.8);
    expect(rWeak.winRate).toBeLessThan(0.2);
    expect(rCrush.timeouts).toBe(0);
  });

  test('确定性：同 seed 同结果', () => {
    const a = simulateLegionBattle(baseBattle(), { runs: 200, seed: 42 });
    const b = simulateLegionBattle(baseBattle(), { runs: 200, seed: 42 });
    expect(a.winRate).toBe(b.winRate);
  });

  test('balanceFlag 分档', () => {
    expect(balanceFlag(0.95)).toMatch(/白给/);
    expect(balanceFlag(0.7)).toMatch(/适中/);
    expect(balanceFlag(0.45)).toMatch(/偏难/);
    expect(balanceFlag(0.2)).toMatch(/过难/);
    expect(balanceFlag(0.05)).toMatch(/不可胜/);
  });

  test('collectLegionBattles 从预设事件抽取军团战', () => {
    const preset = { events: [
      { id: 'ev1', name: '官渡', choices: [{ outcomes: [{ effects: [
        { type: 'start_legion_battle', battle: { battleType: 'field', units: [] } },
      ] }] }] },
      { id: 'ev2', name: '普通', choices: [{ outcomes: [{ effects: [{ type: 'set_variable' }] }] }] },
    ] };
    const out = collectLegionBattles(preset);
    expect(out.length).toBe(1);
    expect(out[0].eventId).toBe('ev1');
  });
});
