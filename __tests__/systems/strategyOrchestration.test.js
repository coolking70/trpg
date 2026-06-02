/**
 * strategyOrchestration 共享编排单测（Phase 40 收敛阶段2）
 * 锁定 applyStrategyEffect / applySeasonEvents 契约（GameSession 与 main.js 共用）。
 */
import { applyStrategyEffect, applySeasonEvents } from '../../src/systems/strategyOrchestration.js';
import { StrategicSystem } from '../../src/systems/StrategicSystem.js';

function ctx() {
  const ss = new StrategicSystem(); ss.eventSystem = null; const gs = {};
  ss.initFromPreset(gs, {
    factions: [{ id: 'shu', name: '蜀' }, { id: 'wu', name: '吴' }],
    strategicSetup: { playerFactionId: 'shu', factions: {
      shu: { gold: 100, food: 200, troops: 5000, order: 60, diplomacy: { wu: { stance: 'neutral', relation: 10 } } },
      wu: { gold: 100, food: 200, troops: 4000, order: 60 },
    } },
  });
  return { gs, ss };
}

describe('applyStrategyEffect', () => {
  test('set_diplomacy 改立场（对称）', () => {
    const { gs, ss } = ctx();
    const handled = applyStrategyEffect({ type: 'set_diplomacy', factionId: 'shu', targetId: 'wu', stance: 'ally', relation: 70 }, { gameState: gs, strategicSystem: ss });
    expect(handled).toBe(true);
    expect(ss.relationOf(gs, 'shu', 'wu').stance).toBe('ally');
    expect(ss.relationOf(gs, 'wu', 'shu').stance).toBe('ally');
  });
  test('adjust_resource 改国库（默认玩家势力）', () => {
    const { gs, ss } = ctx();
    applyStrategyEffect({ type: 'adjust_resource', gold: 50, food: -30 }, { gameState: gs, strategicSystem: ss });
    expect(ss.getFactionState(gs, 'shu').gold).toBe(150);
    expect(ss.getFactionState(gs, 'shu').food).toBe(170);
  });
  test('mobilize 扣兵；非战略效果返回 false', () => {
    const { gs, ss } = ctx();
    applyStrategyEffect({ type: 'mobilize', value: 1000 }, { gameState: gs, strategicSystem: ss });
    expect(ss.getFactionState(gs, 'shu').troops).toBe(4000);
    expect(applyStrategyEffect({ type: 'add_item', itemId: 'x' }, { gameState: gs, strategicSystem: ss })).toBe(false);
  });
});

describe('applySeasonEvents', () => {
  test('宣战/来犯/粮荒 → worldFlags + 叙述 + 入侵意图', () => {
    const { gs } = ctx();
    const events = [
      { type: 'war_declared', by: 'wu', against: 'shu' },
      { type: 'attack_intent', by: 'wu', against: 'shu' },
      { type: 'famine', faction: 'wu' },
    ];
    const { narratives, invasion } = applySeasonEvents(gs, events);
    expect(gs.worldFlags.war_with_wu).toBe(true);
    expect(gs.worldFlags.invasion_from_wu).toBe(true);
    expect(invasion).toEqual({ by: 'wu' });
    expect(narratives.length).toBe(3);
  });
  test('无针对玩家事件 → 无入侵', () => {
    const { gs } = ctx();
    expect(applySeasonEvents(gs, [{ type: 'war_declared', by: 'wu', against: 'other' }]).invasion).toBeNull();
  });
});
