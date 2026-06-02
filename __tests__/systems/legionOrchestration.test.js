/**
 * legionOrchestration 共享编排单测（Phase 39 收敛）
 * 锁定 assembleLegionBattle / settleLegionBattle 的契约（GameSession 与浏览器 main.js 共用）。
 */
import { assembleLegionBattle, settleLegionBattle } from '../../src/systems/legionOrchestration.js';
import { StrategicSystem } from '../../src/systems/StrategicSystem.js';

function ctxWith(setup) {
  const ss = new StrategicSystem(); ss.eventSystem = null;
  const gs = {};
  ss.initFromPreset(gs, setup);
  const cards = { gen: { id: 'gen', name: '某将', warfare: { command: 80, might: 90, intellect: 60 } } };
  return { gs, ss, cardManager: { getCard: (id) => cards[id] || null } };
}

const setup = () => ({
  factions: [{ id: 'shu', name: '蜀' }, { id: 'wei', name: '魏' }],
  strategicSetup: { playerFactionId: 'shu', factions: {
    shu: { gold: 100, food: 300, troops: 6000, order: 60, holdings: [{ id: 'chengdu', name: '成都', type: 'capital', population: 30000, dev: 100, security: 60 }], diplomacy: { wei: { stance: 'war', relation: -70 } } },
    wei: { gold: 200, food: 400, troops: 3000, order: 60, holdings: [{ id: 'guandu', name: '官渡', type: 'fortress', population: 15000, dev: 90, security: 50 }] },
  } },
});

describe('assembleLegionBattle', () => {
  test('drawFromStrategy 扣兵屯粮 + 主将武备补全 + 记录 strategyCtx', () => {
    const { gs, ss, cardManager } = ctxWith(setup());
    const { def, strategyCtx } = assembleLegionBattle({
      battleType: 'field', drawFromStrategy: true, enemyFactionId: 'wei',
      units: [{ id: 'p1', side: 'player', unitType: 'cavalry', troops: 4000, generalId: 'gen' }, { id: 'e1', side: 'enemy', unitType: 'archer', troops: 1500 }],
    }, { gameState: gs, strategicSystem: ss, cardManager });
    expect(ss.getFactionState(gs, 'shu').troops).toBe(2000); // 6000 - 4000 出征
    expect(def.supply.player).toBeGreaterThan(0);            // 随军粮
    expect(def.generals.gen.warfare.might).toBe(90);         // 卡牌补全武备
    expect(strategyCtx).toMatchObject({ fid: 'shu', mobilized: 4000, enemyFid: 'wei' });
  });
  test('无 drawFromStrategy → 不动国库、strategyCtx 为 null', () => {
    const { gs, ss, cardManager } = ctxWith(setup());
    const { strategyCtx } = assembleLegionBattle({ battleType: 'field', units: [{ id: 'p1', side: 'player', unitType: 'infantry', troops: 1000 }] }, { gameState: gs, strategicSystem: ss, cardManager });
    expect(strategyCtx).toBeNull();
    expect(ss.getFactionState(gs, 'shu').troops).toBe(6000);
  });
});

describe('settleLegionBattle', () => {
  test('胜：残部归队 + 民心涨 + 夺城 + flags', () => {
    const { gs, ss } = ctxWith(setup());
    ss.mobilize(gs, 'shu', 4000); // 模拟出征后国库 2000
    const { narratives } = settleLegionBattle({
      gameState: gs, strategicSystem: ss,
      strategyCtx: { fid: 'shu', mobilized: 4000, enemyFid: 'wei' },
      battleDef: { battleType: 'field', attackerFactionId: 'shu', defenderFactionId: 'wei', objectiveHoldingId: 'guandu', campaignKey: '官渡' },
      won: true, summary: { playerTroops: 2500 },
    });
    expect(ss.getFactionState(gs, 'shu').troops).toBe(4500);          // 2000 + 残部 2500
    expect(ss.getFactionState(gs, 'shu').holdings.some(h => h.id === 'guandu')).toBe(true); // 夺城
    expect(gs.worldFlags.won_官渡 || Object.keys(gs.worldFlags).some(k => /^won_/.test(k))).toBeTruthy();
    expect(narratives.some(n => /攻取/.test(n))).toBe(true);
  });
});
