/**
 * 明暗姿态 + 盟友响应 单测（Phase 41 W5）
 */
import { StrategicSystem } from '../../src/systems/StrategicSystem.js';

function makeSys(seed = 0.4) {
  const sys = new StrategicSystem(); sys.eventSystem = null;
  let x = seed; sys.rng = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  return sys;
}

const preset = () => ({
  factions: [{ id: 'shu', name: '蜀' }, { id: 'wei', name: '魏' }, { id: 'wu', name: '吴' }],
  strategicSetup: {
    playerFactionId: 'shu',
    regions: { yi: { name: '益州', adjacency: ['guan', 'jing'] }, guan: { name: '关中', adjacency: ['yi'] }, jing: { name: '荆州', adjacency: ['yi'] } },
    factions: {
      shu: { gold: 200, food: 400, troops: 12000, order: 60,
        holdings: [{ id: 'chengdu', name: '成都', type: 'capital', population: 30000, dev: 100, security: 60, region: 'yi' }],
        diplomacy: { wei: { stance: 'war', relation: -70 }, wu: { stance: 'ally', relation: 80 } } },
      wei: { gold: 400, food: 800, troops: 30000, order: 70, holdings: [{ id: 'changan', name: '长安', type: 'capital', population: 80000, dev: 110, security: 65, region: 'guan' }] },
      wu: { gold: 300, food: 600, troops: 16000, order: 68, holdings: [{ id: 'jianye', name: '建业', type: 'capital', population: 50000, dev: 105, security: 60, region: 'jing' }] },
    },
  },
});

describe('公开讨伐 → 盟友响应', () => {
  test('open 出兵：盟友（吴）一同出兵，军势更盛', () => {
    const sys = makeSys(); const gs = {}; sys.initFromPreset(gs, preset());
    const wuBefore = sys.getFactionState(gs, 'wu').troops;
    const m = sys.launchMarch(gs, 'shu', 'changan', { posture: 'open', troops: 6000 });
    expect(m.army.allies.length).toBeGreaterThan(0);          // 吴响应
    expect(m.army.allies[0].id).toBe('wu');
    expect(m.army.troops).toBeGreaterThan(6000);              // 含盟军
    expect(sys.getFactionState(gs, 'wu').troops).toBeLessThan(wuBefore); // 吴出兵扣兵
  });
  test('raid 突袭：盟友不响应', () => {
    const sys = makeSys(); const gs = {}; sys.initFromPreset(gs, preset());
    const m = sys.launchMarch(gs, 'shu', 'changan', { posture: 'raid', troops: 6000 });
    expect(m.army.allies.length).toBe(0);
    expect(m.army.troops).toBe(6000);
  });
});

describe('突袭使守方来不及调兵加固', () => {
  function siegeWorks(posture) {
    const sys = makeSys(); const gs = {}; sys.initFromPreset(gs, preset());
    const m = sys.launchMarch(gs, 'wei', 'chengdu', { posture, troops: 18000 });
    const r = sys.resolveEngagement(gs, m, 'hold');
    return r.siege;
  }
  test('raid 围城：城防与守军均低于 open', () => {
    const raid = siegeWorks('raid');
    const open = siegeWorks('open');
    expect(raid.works.gate).toBeLessThan(open.works.gate);   // 城防未及加固
    expect(raid.def.troops).toBeLessThan(open.def.troops);   // 来不及调兵
  });
  test('open 攻方士气更高（公开讨伐）', () => {
    expect(siegeWorks('open').atk.morale).toBeGreaterThan(siegeWorks('raid').atk.morale);
  });
});
