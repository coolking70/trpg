/**
 * StrategicSystem 单元测试（Phase 33 — 内政外交运行时）
 */

import { StrategicSystem } from '../../src/systems/StrategicSystem.js';

function makeSys(seed = 0.5) {
  const sys = new StrategicSystem();
  sys.eventSystem = null;
  let x = seed;
  sys.rng = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  return sys;
}

const presetWithSetup = () => ({
  factions: [{ id: 'shu', name: '蜀' }, { id: 'wei', name: '魏' }, { id: 'wu', name: '吴' }],
  strategicSetup: {
    playerFactionId: 'shu',
    factions: {
      shu: { gold: 200, food: 200, troops: 4000, order: 60, agg: { population: 20000, productionEfficiency: 100, security: 50 },
        diplomacy: { wei: { stance: 'war', relation: -70 }, wu: { stance: 'neutral', relation: 10 } } },
      wei: { gold: 300, food: 600, troops: 20000, order: 70, agg: { population: 80000, productionEfficiency: 110, security: 60 } },
      wu: { gold: 150, food: 300, troops: 8000, order: 65, agg: { population: 40000, productionEfficiency: 105, security: 55 } },
    },
  },
});

describe('StrategicSystem — 初始化', () => {
  test('从 strategicSetup 建活状态 + 玩家标记 + 对称外交', () => {
    const sys = makeSys(); const gs = {};
    sys.initFromPreset(gs, presetWithSetup());
    const s = gs.strategicState;
    expect(s.playerFactionId).toBe('shu');
    expect(s.factions.shu.isPlayer).toBe(true);
    expect(s.factions.shu.troops).toBe(4000);
    // 外交对称
    expect(s.factions.shu.diplomacy.wei.stance).toBe('war');
    expect(s.factions.wei.diplomacy.shu.stance).toBe('war');
  });

  test('从 strategicLayer 描述数据推导（无 setup）', () => {
    const sys = makeSys(); const gs = {};
    sys.initFromPreset(gs, {
      factions: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      strategicLayer: { playerFactionId: 'a', factions: {
        a: { holdings: [{ population: 10000, productionEfficiency: 120, security: 60 }], diplomacy: [{ targetFactionId: 'b', stance: 'rival' }] },
        b: { holdings: [{ population: 5000 }], diplomacy: [] },
      } },
    });
    expect(gs.strategicState.factions.a.agg.population).toBe(10000);
    expect(gs.strategicState.factions.a.troops).toBeGreaterThan(0);
    expect(gs.strategicState.factions.a.diplomacy.b.stance).toBe('rival');
  });

  test('无战略数据 → strategicState 为 null（向后兼容）', () => {
    const sys = makeSys(); const gs = {};
    sys.initFromPreset(gs, { factions: [{ id: 'x', name: 'X' }] });
    expect(gs.strategicState).toBeNull();
  });
});

describe('StrategicSystem — 内政/外交动作', () => {
  let sys, gs;
  beforeEach(() => { sys = makeSys(); gs = {}; sys.initFromPreset(gs, presetWithSetup()); });

  test('征兵增兵减金粮', () => {
    const before = { ...sys.getFactionState(gs, 'shu') };
    const r = sys.applyPolicy(gs, 'shu', 'conscript');
    expect(r.ok).toBe(true);
    expect(sys.getFactionState(gs, 'shu').troops).toBeGreaterThan(before.troops);
    expect(sys.getFactionState(gs, 'shu').gold).toBeLessThan(before.gold);
  });

  test('与吴结盟（关系不足则失败，朝贡后达标则成功）', () => {
    expect(sys.applyDiplomacy(gs, 'shu', 'alliance', 'wu').ok).toBe(false); // relation 10 < 40
    sys.applyDiplomacy(gs, 'shu', 'tribute', 'wu'); // +15
    sys.applyDiplomacy(gs, 'shu', 'tribute', 'wu'); // +15 → 40
    const r = sys.applyDiplomacy(gs, 'shu', 'alliance', 'wu');
    expect(r.ok).toBe(true);
    expect(sys.relationOf(gs, 'shu', 'wu').stance).toBe('ally');
    expect(sys.relationOf(gs, 'wu', 'shu').stance).toBe('ally'); // 对称
  });

  test('宣战置双向 war', () => {
    sys.applyDiplomacy(gs, 'shu', 'declare_war', 'wu');
    expect(sys.relationOf(gs, 'shu', 'wu').stance).toBe('war');
    expect(sys.relationOf(gs, 'wu', 'shu').stance).toBe('war');
  });

  test('mobilize 扣兵并返回出征数', () => {
    const n = sys.mobilize(gs, 'shu', 1500);
    expect(n).toBe(1500);
    expect(sys.getFactionState(gs, 'shu').troops).toBe(2500);
    expect(sys.mobilize(gs, 'shu', 99999)).toBe(2500); // 不超池
  });
});

describe('StrategicSystem — 季度推进', () => {
  test('upkeep 产金、季度自增', () => {
    const sys = makeSys(); const gs = {}; sys.initFromPreset(gs, presetWithSetup());
    const goldBefore = sys.getFactionState(gs, 'shu').gold;
    const r = sys.advanceSeason(gs);
    expect(gs.strategicState.season).toBe(2);
    expect(sys.getFactionState(gs, 'shu').gold).toBeGreaterThan(goldBefore);
    expect(Array.isArray(r.events)).toBe(true);
  });

  test('敌国 AI 一季后有所行动（资源/外交变化）', () => {
    const sys = makeSys(0.2); const gs = {}; sys.initFromPreset(gs, presetWithSetup());
    const weiBefore = { ...sys.getFactionState(gs, 'wei') };
    sys.advanceSeason(gs);
    const weiAfter = sys.getFactionState(gs, 'wei');
    // 魏国资源应因 upkeep/AI 政令而变化
    expect(weiAfter.gold !== weiBefore.gold || weiAfter.troops !== weiBefore.troops || weiAfter.food !== weiBefore.food).toBe(true);
  });

  test('多季模拟收敛不崩（10 季）', () => {
    const sys = makeSys(); const gs = {}; sys.initFromPreset(gs, presetWithSetup());
    for (let i = 0; i < 10; i++) sys.advanceSeason(gs);
    expect(gs.strategicState.season).toBe(11);
    expect(sys.ranking(gs).length).toBe(3);
  });
});
