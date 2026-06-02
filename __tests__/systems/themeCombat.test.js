/**
 * 题材战术换皮 集成测试（Phase 42 T3b）
 * 验证：军团战实际读 gameState.strategySchema 的兵种/克制/阵型（非硬编码三国），
 *       且无 schema 时行为与三国默认完全一致（零回归）。
 */
import { LegionWarfareSystem } from '../../src/systems/LegionWarfareSystem.js';
import { makeSeededRng } from '../../src/systems/legionSimulator.js';
import { DEFAULT_SCHEMA, resolveSchema } from '../../src/data/strategySchema.js';

function themeGS() {
  const schema = resolveSchema({
    strategySchema: {
      unitTypes: {
        mech: { name: '机甲', melee: 14, def: 10, ranged: 0, speed: 6, charge: 1, water: 0.5, wishFormation: 'wedge' },
        drone: { name: '无人机', melee: 4, def: 4, ranged: 12, speed: 9, charge: 1, water: 0.5 },
      },
      counterMatrix: { mech: { drone: 2.0 } },
      formations: { none: { name: '无队形', statMods: {} }, wedge: { name: '楔形', statMods: { atk: 1.3 }, requiresTactics: 0 } },
      machines: {}, tactics: {},
    },
  });
  return { strategySchema: schema };
}

describe('Phase 42 T3b — 军团战读题材 Schema', () => {
  test('startBattle 用题材兵种名 + 合法兵种校验', () => {
    const gs = themeGS();
    const sys = new LegionWarfareSystem(); sys.rng = makeSeededRng(7); sys.eventSystem = null;
    sys.startBattle(gs, { battleType: 'field', units: [
      { id: 'p', side: 'player', unitType: 'mech', troops: 1000 },
      { id: 'e', side: 'enemy', unitType: 'drone', troops: 1000 },
    ] });
    const u = gs.activeLegionBattle.units;
    expect(u.find(x => x.id === 'p').name).toBe('机甲');
    expect(u.find(x => x.id === 'e').name).toBe('无人机');
  });
  test('克制矩阵取自题材（mech 克 drone counter=2.0）', () => {
    const gs = themeGS();
    const sys = new LegionWarfareSystem(); sys.rng = makeSeededRng(3); sys.eventSystem = null;
    sys.startBattle(gs, { battleType: 'field', units: [
      { id: 'p', side: 'player', unitType: 'mech', troops: 1000 },
      { id: 'e', side: 'enemy', unitType: 'drone', troops: 1000 },
    ] });
    const T = sys._T(gs);
    const r = sys._orderAttack(gs, T, gs.activeLegionBattle, gs.activeLegionBattle.units[0], { targetId: 'e' });
    expect(r.counter).toBe(2.0);
    expect(r.defenderLosses).toBeGreaterThan(0);
  });
  test('题材偏好阵型 wishFormation 生效', () => {
    const gs = themeGS();
    const sys = new LegionWarfareSystem(); sys.rng = makeSeededRng(1); sys.eventSystem = null;
    const T = sys._T(gs);
    expect(sys._wishFormation(T, { unitType: 'mech', side: 'player' })).toBe('wedge');
  });
  test('无 schema → 与三国默认一致（零回归）：步兵名仍为步兵', () => {
    const gs = {}; // schemaOf 回退 DEFAULT_SCHEMA
    const sys = new LegionWarfareSystem(); sys.rng = makeSeededRng(5); sys.eventSystem = null;
    sys.startBattle(gs, { battleType: 'field', units: [
      { id: 'p', side: 'player', unitType: 'infantry', troops: 1000 },
      { id: 'e', side: 'enemy', unitType: 'cavalry', troops: 1000 },
    ] });
    expect(gs.activeLegionBattle.units[0].name).toBe('步兵');
    expect(gs.strategySchema).toBeUndefined();  // 未污染 gameState
  });
});
