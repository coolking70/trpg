/**
 * 行军层 + 旬时钟 集成测试（Phase 41 W2）—— StrategicSystem 作战层
 */
import { StrategicSystem } from '../../src/systems/StrategicSystem.js';
import { MARCH_BASE_ETA } from '../../src/data/war.js';

function makeSys(seed = 0.5) {
  const sys = new StrategicSystem(); sys.eventSystem = null;
  let x = seed; sys.rng = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  return sys;
}

const warPreset = () => ({
  factions: [{ id: 'shu', name: '蜀' }, { id: 'wei', name: '魏' }],
  strategicSetup: {
    playerFactionId: 'shu',
    regions: {
      yizhou: { name: '益州', adjacency: ['hanzhong'] },
      hanzhong: { name: '汉中', adjacency: ['yizhou', 'guanzhong'] },
      guanzhong: { name: '关中', adjacency: ['hanzhong'] },
    },
    factions: {
      shu: { gold: 200, food: 400, troops: 10000, order: 60,
        holdings: [
          { id: 'chengdu', name: '成都', type: 'capital', population: 30000, dev: 100, security: 60, region: 'yizhou', governorWarfare: { command: 92, might: 60, intellect: 100 } },
          { id: 'hanzhong_city', name: '汉中', type: 'fortress', population: 10000, dev: 90, security: 55, region: 'hanzhong' },
        ],
        diplomacy: { wei: { stance: 'war', relation: -70 } } },
      wei: { gold: 400, food: 800, troops: 40000, order: 70,
        holdings: [{ id: 'changan', name: '长安', type: 'capital', population: 80000, dev: 110, security: 65, region: 'guanzhong' }] },
    },
  },
});

describe('init：作战层激活', () => {
  test('regions 加载 + marches/sieges/warXun 就位', () => {
    const sys = makeSys(); const gs = {}; sys.initFromPreset(gs, warPreset());
    expect(gs.strategicState.regions.hanzhong).toBeTruthy();
    expect(gs.strategicState.marches).toEqual([]);
    expect(gs.strategicState.warXun).toBe(0);
  });
});

describe('launchMarch：行军耗时，不瞬间兵临城下', () => {
  test('扣兵粮组军 + ETA>1（距离2区域）', () => {
    const sys = makeSys(); const gs = {}; sys.initFromPreset(gs, warPreset());
    const before = sys.getFactionState(gs, 'wei').troops;
    const m = sys.launchMarch(gs, 'wei', 'chengdu', { posture: 'open' }); // 长安(关中)→成都(益州) 距离2
    expect(m).toBeTruthy();
    expect(m.etaXun).toBeGreaterThan(1);
    expect(m.army.troops).toBeGreaterThan(0);
    expect(sys.getFactionState(gs, 'wei').troops).toBeLessThan(before); // 国库扣兵
    expect(m.defender).toBe('shu');
  });
});

describe('advanceWarXun：推进 + 情报 + 抵达', () => {
  test('逐旬递减 ETA；抵达产出 army_arrived', () => {
    const sys = makeSys(); const gs = {}; sys.initFromPreset(gs, warPreset());
    const m = sys.launchMarch(gs, 'wei', 'chengdu', { posture: 'open' });
    const eta = m.etaXun;
    let arrived = null;
    for (let i = 0; i < eta + 1 && !arrived; i++) {
      const evs = sys.advanceWarXun(gs);
      arrived = evs.find(e => e.type === 'army_arrived');
    }
    expect(arrived).toBeTruthy();
    expect(arrived.march.targetHoldingId).toBe('chengdu');
    expect(gs.strategicState.marches.length).toBe(0); // 抵达后移除
  });

  test('公开讨伐易被名守将探得（march_detected）', () => {
    const sys = makeSys(0.1); const gs = {}; sys.initFromPreset(gs, warPreset());
    sys.launchMarch(gs, 'wei', 'chengdu', { posture: 'open' }); // 成都守将诸葛亮(智100)情报半径大
    let detected = false;
    for (let i = 0; i < 8 && !detected; i++) {
      const evs = sys.advanceWarXun(gs);
      if (evs.some(e => e.type === 'march_detected')) detected = true;
    }
    expect(detected).toBe(true);
  });
});

describe('advanceSeason：敌国 AI 发行军（取代 instant invasion）', () => {
  test('一季推进 = 3 旬；魏军压境会发起行军而非瞬间开战', () => {
    const sys = makeSys(0.2); const gs = {}; sys.initFromPreset(gs, warPreset());
    const x0 = gs.strategicState.warXun;
    const r = sys.advanceSeason(gs);
    expect(gs.strategicState.warXun).toBe(x0 + 3); // 季=3旬
    // 不应再有 attack_intent（旧 instant 路径）
    expect(r.events.some(e => e.type === 'attack_intent')).toBe(false);
  });
});
