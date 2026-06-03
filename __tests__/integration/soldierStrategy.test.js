/**
 * 底层视角战略自转 集成测试（Phase 43 P43a）
 * 验证：playerRole='soldier' 时——玩家所属势力由其 NPC 君主自治；战争（行军→围城→城池易主）
 *       在 advanceSeason 推进中全程幕后自结算，无需玩家任何作战/内政输入。
 */
import { StrategicSystem } from '../../src/systems/StrategicSystem.js';

function warWorld(playerRole) {
  return {
    presetId: 't', name: 't',
    strategicSetup: {
      playerFactionId: 'shu',
      playerRole,
      regions: { yi: { name: '益州', adjacency: ['guan'] }, guan: { name: '关中', adjacency: ['yi'] } },
      factions: {
        shu: { gold: 100, food: 200, troops: 6000, order: 60,
          holdings: [{ id: 'chengdu', name: '成都', type: 'capital', population: 20000, dev: 100, security: 50, region: 'yi' }],
          diplomacy: { wei: { stance: 'war', relation: -80 } } },
        wei: { gold: 500, food: 6000, troops: 50000, order: 75,
          holdings: [{ id: 'changan', name: '长安', type: 'capital', population: 90000, dev: 110, security: 70, region: 'guan' }],
          diplomacy: { shu: { stance: 'war', relation: -80 } } },
      },
    },
  };
}

function setup(playerRole) {
  const ss = new StrategicSystem(); ss.eventSystem = null; ss.rng = () => 0.1; // 确定性
  const gs = { addNarrative() {} };
  ss.initFromPreset(gs, warWorld(playerRole));
  return { ss, gs };
}

describe('Phase 43 P43a — playerRole', () => {
  test('默认 ruler；可经出身置 soldier', () => {
    expect(setup().gs.strategicState.playerRole).toBe('ruler');
    expect(setup('soldier').gs.strategicState.playerRole).toBe('soldier');
  });
  test('playerCommands：ruler=true，soldier=false', () => {
    const a = setup('ruler'), b = setup('soldier');
    expect(a.ss.playerCommands(a.gs)).toBe(true);
    expect(b.ss.playerCommands(b.gs)).toBe(false);
  });
});

describe('Phase 43 P43a — 小兵视角战争幕后自结算', () => {
  test('玩家势力自治：advanceSeason 产出 home_decision（自家也行一策）', () => {
    const { ss, gs } = setup('soldier');
    let sawHome = false;
    for (let i = 0; i < 5 && !sawHome; i++) {
      const { events } = ss.advanceSeason(gs);
      if (events.some(e => e.type === 'home_decision')) sawHome = true;
    }
    expect(sawHome).toBe(true);
  });

  test('强敌 wei 自动攻取玩家势力的城（城池易主，全程无玩家输入）', () => {
    const { ss, gs } = setup('soldier');
    const shuHoldings0 = ss.getFactionState(gs, 'shu').holdings.length;
    let resolved = false, transferred = false;
    for (let i = 0; i < 20 && !transferred; i++) {
      const { events } = ss.advanceSeason(gs);
      if (events.some(e => e.type === 'siege_resolved' && e.attackerWins)) resolved = true;
      // 城池真的易主：wei 持有了成都
      const weiHas = ss.getFactionState(gs, 'wei').holdings.some(h => h.id === 'chengdu');
      if (weiHas) transferred = true;
      // 关键：全程从不弹玩家接敌抉择
      expect(events.some(e => e.playerEngagement)).toBe(false);
    }
    expect(resolved).toBe(true);
    expect(transferred).toBe(true);
    expect(ss.getFactionState(gs, 'shu').holdings.length).toBeLessThan(shuHoldings0);
  });

  test('对照：ruler 守方遭袭会弹接敌抉择（playerEngagement），不自动结算', () => {
    const { ss, gs } = setup('ruler');
    let sawEngagement = false;
    for (let i = 0; i < 12 && !sawEngagement; i++) {
      const { events } = ss.advanceSeason(gs);
      if (events.some(e => e.playerEngagement)) sawEngagement = true;
    }
    expect(sawEngagement).toBe(true);
  });
});
