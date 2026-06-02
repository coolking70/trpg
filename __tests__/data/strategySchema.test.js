/**
 * 战略主题 Schema 解析单测（Phase 42 T3a）
 */
import { DEFAULT_SCHEMA, resolveSchema, schemaOf } from '../../src/data/strategySchema.js';
import { UNIT_TYPES } from '../../src/data/warfare.js';
import { StrategicSystem } from '../../src/systems/StrategicSystem.js';

describe('resolveSchema', () => {
  test('无覆盖 → 全用默认（三国）', () => {
    const s = resolveSchema({});
    expect(s.resources.gold.name).toBe('金');
    expect(s.unitTypes).toBe(UNIT_TYPES);
    expect(Object.keys(s.policies)).toContain('farming');
    expect(s.narration.settingTone).toContain('三国');
  });
  test('表字段整张替换（题材给 unitTypes 则不混入默认）', () => {
    const customUnits = { knight: { name: '骑士', melee: 16, def: 8 }, archer: { name: '弓手', ranged: 12 } };
    const s = resolveSchema({ strategySchema: { unitTypes: customUnits } });
    expect(s.unitTypes).toBe(customUnits);
    expect(s.unitTypes.infantry).toBeUndefined();     // 不混入三国步兵
    expect(s.formations).toBe(DEFAULT_SCHEMA.formations); // 未覆盖字段继承默认
  });
  test('标签字段深合并（resources 可只改个别项的 name/icon）', () => {
    const s = resolveSchema({ strategySchema: { resources: { gold: { name: '资金', icon: '💵' } } } });
    expect(s.resources.gold.name).toBe('资金');
    expect(s.resources.gold.icon).toBe('💵');
    expect(s.resources.food.name).toBe('粮');        // 未改项继承默认
    expect(s.resources.troops.name).toBe('兵');
  });
  test('narration 逐项深合并', () => {
    const s = resolveSchema({ strategySchema: { narration: { settingTone: '银河纪元', postures: { raid: '闪击' } } } });
    expect(s.narration.settingTone).toBe('银河纪元');
    expect(s.narration.postures.raid).toBe('闪击');
    expect(s.narration.postures.open).toBe('传檄旗号、公开讨伐'); // 未改项继承
  });
});

describe('schemaOf', () => {
  test('缺省回退 DEFAULT_SCHEMA', () => {
    expect(schemaOf(null)).toBe(DEFAULT_SCHEMA);
    expect(schemaOf({}).resources.gold.name).toBe('金');
  });
});

describe('initFromPreset 挂载 strategySchema', () => {
  test('始终解析并存到 gameState.strategySchema（即便无战略层）', () => {
    const ss = new StrategicSystem(); ss.eventSystem = null;
    const gs = {};
    ss.initFromPreset(gs, { presetId: 't', name: 't' }); // 无 strategicSetup/Layer
    expect(gs.strategySchema).toBeTruthy();
    expect(gs.strategySchema.resources.gold.name).toBe('金');
    expect(gs.strategicState).toBeNull();
  });
  test('题材剧本：资源标签换皮生效', () => {
    const ss = new StrategicSystem(); ss.eventSystem = null;
    const gs = { addNarrative() {} };
    ss.initFromPreset(gs, {
      presetId: 't', name: 't',
      strategySchema: { resources: { gold: { name: '资金', icon: '💵' }, order: { name: '民意', icon: '📊' } } },
      strategicSetup: { playerFactionId: 'a', factions: { a: { gold: 100, food: 100, troops: 1000, order: 50 } } },
    });
    expect(gs.strategySchema.resources.gold.name).toBe('资金');
    expect(gs.strategySchema.resources.order.name).toBe('民意');
  });
});
