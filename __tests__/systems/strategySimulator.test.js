/**
 * 战略平衡模拟器测试（Phase 33 S5）
 */

import { simulateSeasons, makeSeededRng } from '../../src/systems/strategySimulator.js';

const setup = (over = {}) => ({
  factions: [{ id: 'shu', name: '蜀' }, { id: 'wei', name: '魏' }, { id: 'wu', name: '吴' }],
  strategicSetup: {
    playerFactionId: 'shu',
    factions: {
      shu: { gold: 200, food: 300, troops: 5000, order: 60, agg: { population: 30000, productionEfficiency: 100, security: 50 },
        diplomacy: { wei: { stance: 'rival', relation: -40 }, wu: { stance: 'neutral', relation: 10 } } },
      wei: { gold: 400, food: 800, troops: 25000, order: 70, agg: { population: 90000, productionEfficiency: 110, security: 60 } },
      wu: { gold: 200, food: 400, troops: 10000, order: 65, agg: { population: 45000, productionEfficiency: 105, security: 55 } },
      ...(over.factions || {}),
    },
  },
});

describe('strategySimulator', () => {
  test('跑 20 季返回完整摘要 + 轨迹', () => {
    const r = simulateSeasons(setup(), { seasons: 20, seed: 7 });
    expect(r.ok).toBe(true);
    expect(r.trajectory.length).toBe(20);
    expect(r.ranking.length).toBe(3);
    expect(['👑 一家独大', '✓ 稳健发展', '⚠ 势弱待援', '☠ 势力崩溃']).toContain(r.flag);
    expect(r.final.troops).toBeGreaterThanOrEqual(0);
  });

  test('玩家行动 → 实力通常优于完全不作为', () => {
    const acts = simulateSeasons(setup(), { seasons: 25, seed: 11, playerActs: true });
    const idle = simulateSeasons(setup(), { seasons: 25, seed: 11, playerActs: false });
    expect(acts.final.power).toBeGreaterThanOrEqual(idle.final.power * 0.8); // 行动不应显著更差
  });

  test('确定性：同 seed 同结果', () => {
    const a = simulateSeasons(setup(), { seasons: 15, seed: 42 });
    const b = simulateSeasons(setup(), { seasons: 15, seed: 42 });
    expect(a.final).toEqual(b.final);
    expect(a.flag).toBe(b.flag);
  });

  test('无战略设定 → ok:false', () => {
    expect(simulateSeasons({ factions: [{ id: 'x', name: 'X' }] }, {}).ok).toBe(false);
  });

  test('makeSeededRng 产出 [0,1)', () => {
    const rng = makeSeededRng(1);
    for (let i = 0; i < 50; i++) { const v = rng(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});
