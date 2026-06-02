/**
 * 战役级连战测试（Phase 38）
 * 验证：领土后果纯函数、StrategicSystem 夺城/失地结算、敌国入侵战构建、
 *       GameSession 攻城获胜→夺取敌城 集成。
 */
import { battleTerritoryOutcome, campaignStatus, campaignSlug } from '../../src/data/campaign.js';
import { StrategicSystem } from '../../src/systems/StrategicSystem.js';
import { GameSession } from '../../src/core/GameSession.js';

const cityPreset = () => ({
  presetId: 't', name: '连战测试', author: 't', lore: { worldName: '汉末' },
  factions: [{ id: 'shu', name: '蜀' }, { id: 'wei', name: '魏' }],
  characters: [{ id: 'char_player', name: '主公', stats: { hp: 100, hpCurrent: 100, mp: 0, mpCurrent: 0, attack: 10, defense: 5, speed: 8, luck: 1 } }],
  enemies: [], items: [], events: [],
  scenes: [{ id: 'scene_court', name: '理政朝堂', type: 'settlement', icon: '🏛', coords: { x: 0, y: 0 }, tags: ['spawn', 'governance'], description: '', connections: [], events: [], vignettes: [] }],
  startingSceneId: 'scene_court',
  strategicSetup: {
    playerFactionId: 'shu',
    factions: {
      shu: { gold: 300, food: 500, troops: 12000, order: 65,
        holdings: [{ id: 'chengdu', name: '成都', type: 'capital', population: 30000, dev: 100, security: 60 }],
        diplomacy: { wei: { stance: 'war', relation: -70 } } },
      wei: { gold: 200, food: 400, troops: 3000, order: 60,
        holdings: [{ id: 'guandu', name: '官渡', type: 'fortress', population: 15000, dev: 90, security: 50 }] },
    },
  },
});

describe('campaign — 纯函数', () => {
  test('攻城胜→夺城；守城败→失城', () => {
    const atk = { battleType: 'field', objectiveHoldingId: 'guandu', campaignKey: '官渡' };
    expect(battleTerritoryOutcome(atk, true).captureHoldingId).toBe('guandu');
    expect(battleTerritoryOutcome(atk, false).captureHoldingId).toBeUndefined();
    const def = { battleType: 'defense', objectiveHoldingId: 'chengdu', campaignKey: '守成都' };
    expect(battleTerritoryOutcome(def, false).loseHoldingId).toBe('chengdu');
    expect(battleTerritoryOutcome(def, true).loseHoldingId).toBeUndefined();
  });
  test('flags 含胜负标记', () => {
    expect(battleTerritoryOutcome({ campaignKey: 'guandu' }, true).flags[0]).toMatch(/^won_/);
    expect(campaignSlug('官渡 之战!')).toMatch(/官渡/);
  });
  test('campaignStatus 极简一行', () => {
    const sys = new StrategicSystem(); sys.eventSystem = null; const gs = {};
    sys.initFromPreset(gs, cityPreset());
    const s = campaignStatus(gs.strategicState, 'shu');
    expect(s).toMatch(/据 1 城/);
    expect(s).toMatch(/交战 1 方/);
  });
});

describe('StrategicSystem — 领土结算 + 入侵战构建', () => {
  let sys, gs;
  beforeEach(() => { sys = new StrategicSystem(); sys.eventSystem = null; gs = {}; sys.initFromPreset(gs, cityPreset()); });

  test('recordBattleOutcome 攻城胜 → 城池易主', () => {
    const r = sys.recordBattleOutcome(gs, { battleType: 'field', attackerFactionId: 'shu', defenderFactionId: 'wei', objectiveHoldingId: 'guandu', campaignKey: '官渡' }, true);
    expect(r.flags[0]).toMatch(/^won_/);
    expect(sys.getFactionState(gs, 'shu').holdings.some(h => h.id === 'guandu')).toBe(true);
    expect(sys.getFactionState(gs, 'wei').holdings.some(h => h.id === 'guandu')).toBe(false);
  });

  test('buildInvasionBattle 产出守城战(玩家守、drawFromStrategy)', () => {
    const b = sys.buildInvasionBattle(gs, 'wei', 'shu');
    expect(b.battleType).toBe('defense');
    expect(b.drawFromStrategy).toBe(true);
    expect(b.defenderFactionId).toBe('shu');
    expect(b.objectiveHoldingId).toBe('chengdu');
    expect(b.units.some(u => u.side === 'player') && b.units.some(u => u.side === 'enemy')).toBe(true);
  });
});

describe('GameSession — 攻城获胜夺取敌城（auto）', () => {
  test('drawFromStrategy 攻城胜 → 夺取官渡 + worldFlags', async () => {
    const origRandom = Math.random; Math.random = () => 0.4;
    const sess = new GameSession({ combatMode: 'auto' });
    sess.configureAI({ endpoint: '' });
    sess.loadPreset(cityPreset());
    await sess.kickoff();
    sess._startLegionBattle({
      battleType: 'field', drawFromStrategy: true,
      attackerFactionId: 'shu', defenderFactionId: 'wei', enemyFactionId: 'wei',
      objectiveHoldingId: 'guandu', campaignKey: '官渡',
      units: [
        { id: 'p1', side: 'player', unitType: 'cavalry', troops: 9000, generalId: 'gA' },
        { id: 'e1', side: 'enemy', unitType: 'archer', troops: 1500, generalId: 'gB' },
      ],
      generals: { gA: { name: '甲', warfare: { command: 85, might: 90, intellect: 70, tactics: 2, abilities: ['charge', 'rally'] } }, gB: { name: '乙', warfare: { command: 60, might: 60, intellect: 55, tactics: 1, abilities: ['rally'] } } },
    });
    await sess._enterLegionBattle();
    expect(sess.gameState.activeLegionBattle).toBeNull();
    // 蜀兵力占绝对优势 → 应胜并夺城
    expect(sess.gameState.strategicState.factions.shu.holdings.some(h => h.id === 'guandu')).toBe(true);
    Math.random = origRandom; sess.destroy();
  });
});
