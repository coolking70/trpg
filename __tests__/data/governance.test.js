/**
 * governance.js 单元测试（Phase 33 — 内政外交数据层）
 */

import {
  RESOURCE_KEYS, STANCES, ORDER_BASELINE, stanceFromRelation, clampOrder, clampRelation,
  seasonProduction, POLICIES, POLICY_KEYS, applyPolicyPure,
  DIPLOMACY_ACTIONS, DIPLOMACY_KEYS, applyDiplomacyPure,
  decideEnemyStrategy, validateStrategicSetup, factionPower,
  HOLDING_TYPES, HOLDING_TYPE_KEYS, governorBonusFromWarfare, holdingEffectiveDev, holdingEffectiveSecurity,
} from '../../src/data/governance.js';

const mkState = (over = {}) => ({
  factionId: 'shu', name: '蜀', isPlayer: true,
  gold: 100, food: 100, troops: 3000, order: 60,
  agg: { population: 20000, productionEfficiency: 100, security: 50 },
  diplomacy: {},
  ...over,
});

describe('governance — 表与映射', () => {
  test('资源键 + 立场表', () => {
    expect(RESOURCE_KEYS).toEqual(['gold', 'food', 'troops', 'order']);
    expect(STANCES).toEqual(expect.arrayContaining(['ally', 'war', 'neutral', 'rival']));
    expect(POLICY_KEYS).toEqual(expect.arrayContaining(['farming', 'tax', 'conscript', 'fortify', 'relief', 'develop']));
    expect(DIPLOMACY_KEYS).toEqual(expect.arrayContaining(['alliance', 'declare_war', 'sue_peace', 'tribute', 'marriage', 'sow_discord']));
  });
  test('stanceFromRelation 阈值', () => {
    expect(stanceFromRelation(80)).toBe('ally');
    expect(stanceFromRelation(40)).toBe('trade');
    expect(stanceFromRelation(0)).toBe('neutral');
    expect(stanceFromRelation(-40)).toBe('rival');
    expect(stanceFromRelation(-80)).toBe('war');
  });
  test('clamp', () => {
    expect(clampOrder(200)).toBe(100);
    expect(clampOrder(-5)).toBe(0);
    expect(clampRelation(999)).toBe(100);
    expect(clampRelation(-999)).toBe(-100);
  });
});

describe('seasonProduction — 季度产出', () => {
  test('正常产出金粮，民心向基线回归', () => {
    const r = seasonProduction(mkState({ order: 40 }));
    expect(r.gold).toBeGreaterThan(0);
    expect(r._foodProduce).toBeGreaterThan(0);
    expect(r.order).toBeGreaterThan(0); // order 40 < 基线 → 回升
  });
  test('兵多则耗粮，缺粮时民心重挫', () => {
    const r = seasonProduction(mkState({ food: 0, troops: 50000, agg: { population: 3000, productionEfficiency: 80, security: 40 } }));
    expect(r._foodConsume).toBeGreaterThan(r._foodProduce); // 入不敷出
    expect(r.order).toBeLessThan(0); // 缺粮掉民心
  });
});

describe('applyPolicyPure — 政令', () => {
  test('征税得金损民心', () => {
    const r = applyPolicyPure(mkState(), 'tax');
    expect(r.ok).toBe(true);
    expect(r.deltas.gold).toBeGreaterThan(0);
    expect(r.deltas.order).toBeLessThan(0);
  });
  test('征兵得兵但耗金粮损民心', () => {
    const r = applyPolicyPure(mkState(), 'conscript');
    expect(r.deltas.troops).toBeGreaterThan(0);
    expect(r.deltas.gold).toBeLessThan(0);
    expect(r.deltas.order).toBeLessThan(0);
  });
  test('赈灾涨民心', () => {
    expect(applyPolicyPure(mkState(), 'relief').deltas.order).toBeGreaterThan(0);
  });
  test('屯田/筑城提升聚合产能/治安', () => {
    expect(applyPolicyPure(mkState(), 'develop').aggDeltas.productionEfficiency).toBeGreaterThan(0);
    expect(applyPolicyPure(mkState(), 'fortify').aggDeltas.security).toBeGreaterThan(0);
  });
  test('国库不足则拒绝', () => {
    const r = applyPolicyPure(mkState({ gold: 0 }), 'develop');
    expect(r.ok).toBe(false);
  });
});

describe('applyDiplomacyPure — 外交', () => {
  test('结盟需关系达标', () => {
    expect(applyDiplomacyPure(mkState(), 'alliance', { stance: 'neutral', relation: 10 }).ok).toBe(false);
    const ok = applyDiplomacyPure(mkState(), 'alliance', { stance: 'trade', relation: 50 });
    expect(ok.ok).toBe(true);
    expect(ok.setStance).toBe('ally');
  });
  test('宣战强制 war 且关系大跌', () => {
    const r = applyDiplomacyPure(mkState(), 'declare_war', { stance: 'neutral', relation: 50 });
    expect(r.setStance).toBe('war');
    expect(r.relationDelta).toBeLessThan(0);
  });
  test('求和仅在交战时可行', () => {
    expect(applyDiplomacyPure(mkState(), 'sue_peace', { stance: 'neutral', relation: 0 }).ok).toBe(false);
    const r = applyDiplomacyPure(mkState(), 'sue_peace', { stance: 'war', relation: -60 });
    expect(r.ok).toBe(true);
    expect(r.setStance).toBe('neutral');
  });
  test('朝贡耗金涨好感', () => {
    const r = applyDiplomacyPure(mkState(), 'tribute', { stance: 'neutral', relation: 0 });
    expect(r.srcDeltas.gold).toBeLessThan(0);
    expect(r.relationDelta).toBeGreaterThan(0);
  });
  test('离间返回 sow 意图与降幅', () => {
    const r = applyDiplomacyPure(mkState(), 'sow_discord', { stance: 'neutral', relation: 0 }, () => 0.5);
    expect(r.sow).toBe(true);
    expect(r.discordDelta).toBeLessThan(0);
  });
});

describe('decideEnemyStrategy — 敌国 AI', () => {
  const world = (states) => ({ factions: Object.fromEntries(states.map(s => [s.factionId, s])), playerId: 'shu' });

  test('缺粮 → 劝农', () => {
    const wei = mkState({ factionId: 'wei', food: 0, troops: 20000, isPlayer: false, agg: { population: 5000, productionEfficiency: 80, security: 50 } });
    expect(decideEnemyStrategy(wei, world([wei])).policyId).toBe('farming');
  });
  test('民心低 → 赈灾', () => {
    const wei = mkState({ factionId: 'wei', order: 20, food: 5000, troops: 1000, gold: 100, isPlayer: false });
    expect(decideEnemyStrategy(wei, world([wei])).policyId).toBe('relief');
  });
  test('碾压交战敌人 → 出兵进攻', () => {
    const wei = mkState({ factionId: 'wei', troops: 30000, food: 9999, gold: 999, order: 80, isPlayer: false, diplomacy: { shu: { stance: 'war', relation: -80 } } });
    const shu = mkState({ factionId: 'shu', troops: 5000 });
    const d = decideEnemyStrategy(wei, world([wei, shu]));
    expect(d.type).toBe('attack');
    expect(d.targetId).toBe('shu');
  });
});

describe('holdings — 逐城经营数据层（Phase 37）', () => {
  test('城池类型表 + 都城产出权重最高', () => {
    expect(HOLDING_TYPE_KEYS).toEqual(expect.arrayContaining(['capital', 'city', 'fortress', 'port', 'granary', 'pasture']));
    expect(HOLDING_TYPES.capital.prod).toBeGreaterThan(HOLDING_TYPES.fortress.prod);
    expect(HOLDING_TYPES.fortress.def).toBeGreaterThan(HOLDING_TYPES.capital.def);
  });
  test('太守加成：智力↑产能、统率↑治安、武力↑募兵', () => {
    const b = governorBonusFromWarfare({ command: 90, might: 60, intellect: 100 });
    expect(b.prod).toBeGreaterThan(1);
    expect(b.security).toBeGreaterThan(0);
    expect(b.recruit).toBeGreaterThan(1);
    expect(governorBonusFromWarfare(null)).toEqual({ prod: 1, security: 0, recruit: 1 });
  });
  test('有效营建度随类型与太守提升；有效治安夹 0–100', () => {
    const base = holdingEffectiveDev({ type: 'city', dev: 100 });
    const cap = holdingEffectiveDev({ type: 'capital', dev: 100 });
    expect(cap).toBeGreaterThan(base); // 都城产出权重更高
    const withGov = holdingEffectiveDev({ type: 'city', dev: 100, governorBonus: { prod: 1.3 } });
    expect(withGov).toBeGreaterThan(base);
    expect(holdingEffectiveSecurity({ security: 95, governorBonus: { security: 20 } })).toBe(100);
  });
});

describe('validateStrategicSetup / factionPower', () => {
  test('合法 setup 通过', () => {
    const setup = { playerFactionId: 'shu', factions: { shu: { gold: 100, troops: 3000, diplomacy: { wei: { stance: 'war', relation: -70 } } }, wei: {} } };
    expect(validateStrategicSetup(setup, ['shu', 'wei'])).toEqual([]);
  });
  test('未知势力/负资源/未知立场报错', () => {
    const setup = { playerFactionId: 'ghost', factions: { shu: { gold: -5, diplomacy: { x: { stance: 'foo' } } } } };
    const errs = validateStrategicSetup(setup, ['shu', 'wei']);
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
  test('factionPower 随兵力上升', () => {
    expect(factionPower(mkState({ troops: 9000 }))).toBeGreaterThan(factionPower(mkState({ troops: 1000 })));
  });
});
