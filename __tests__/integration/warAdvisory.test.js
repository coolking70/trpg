/**
 * 作战自由进谏 集成测试（Phase 42 T2）
 * 验证：launch_march / engage / siege_order 受 L3 参与度门控；
 *       AI 据玩家进谏经 _applyEngineActions 落地为行军 / 待执行作战令；
 *       GameSession 收尾待执行作战令（起野战 / 建围城）。
 */
import { requiredAuthority, filterActionsByAuthority, AI_AUTHORITY } from '../../src/systems/AIAuthority.js';
import { AIGMEngine } from '../../src/systems/AIGMEngine.js';
import { StrategicSystem } from '../../src/systems/StrategicSystem.js';
import { GameSession } from '../../src/core/GameSession.js';

function warPreset() {
  return {
    presetId: 't', name: '作战进谏测试', author: 't', lore: { worldName: '汉末' },
    factions: [{ id: 'shu', name: '蜀' }, { id: 'wei', name: '魏' }],
    characters: [{ id: 'char_player', name: '主公', stats: { hp: 100, hpCurrent: 100, mp: 0, mpCurrent: 0, attack: 10, defense: 5, speed: 8, luck: 1 } }],
    enemies: [], items: [], events: [],
    scenes: [{ id: 'scene_court', name: '理政朝堂', type: 'settlement', icon: '🏛', coords: { x: 0, y: 0 }, tags: ['spawn', 'governance'], description: '', connections: [], events: [], vignettes: [] }],
    startingSceneId: 'scene_court',
    strategicSetup: {
      playerFactionId: 'shu',
      regions: { yi: { name: '益州', adjacency: ['guan'] }, guan: { name: '关中', adjacency: ['yi'] } },
      factions: {
        shu: { gold: 200, food: 400, troops: 9000, order: 60,
          holdings: [{ id: 'chengdu', name: '成都', type: 'capital', population: 30000, dev: 100, security: 60, region: 'yi' }],
          diplomacy: { wei: { stance: 'war', relation: -70 } } },
        wei: { gold: 400, food: 800, troops: 40000, order: 70,
          holdings: [{ id: 'changan', name: '长安', type: 'capital', population: 80000, dev: 110, security: 65, region: 'guan' }] },
      },
    },
  };
}

function setup() {
  const gs = { addNarrative() {}, worldFlags: {} };
  const ss = new StrategicSystem(); ss.eventSystem = null;
  ss.initFromPreset(gs, warPreset());
  const ai = new AIGMEngine();
  ai.gameEngine = { getSystem: (n) => (n === 'StrategicSystem' ? ss : null) };
  return { gs, ss, ai };
}

describe('Phase 42 T2 — 作战动作权限门控', () => {
  test('launch_march/engage/siege_order 需 L3', () => {
    expect(requiredAuthority('launch_march')).toBe(AI_AUTHORITY.COAUTHOR);
    expect(requiredAuthority('engage')).toBe(AI_AUTHORITY.COAUTHOR);
    expect(requiredAuthority('siege_order')).toBe(AI_AUTHORITY.COAUTHOR);
  });
  test('L2 拦截、L3 放行 launch_march', () => {
    const acts = [{ type: 'launch_march', target: 'changan', posture: 'raid' }];
    expect(filterActionsByAuthority(acts, AI_AUTHORITY.ADJUDICATOR).allowed.length).toBe(0);
    expect(filterActionsByAuthority(acts, AI_AUTHORITY.COAUTHOR).allowed.length).toBe(1);
  });
});

describe('Phase 42 T2 — _applyEngineActions 落地作战动作', () => {
  test('launch_march 按城名/城id 入列一支行军（费时抵达）', () => {
    const { gs, ss, ai } = setup();
    ai._applyEngineActions([{ type: 'launch_march', target: '长安', posture: 'raid' }], gs, AI_AUTHORITY.COAUTHOR);
    const m = gs.strategicState.marches.find(x => x.attacker === 'shu');
    expect(m).toBeTruthy();
    expect(m.targetHoldingId).toBe('changan');
    expect(m.posture).toBe('raid');
    expect(m.etaXun).toBeGreaterThan(0);          // 行军费时，非即时
    expect(m.army.troops).toBeGreaterThan(0);
    // 公开讨伐 vs 密袭：公开士气更高
    const { gs: gs2, ai: ai2 } = setup();
    ai2._applyEngineActions([{ type: 'launch_march', target: 'changan', posture: 'open' }], gs2, AI_AUTHORITY.COAUTHOR);
    expect(gs2.strategicState.marches[0].posture).toBe('open');
  });
  test('launch_march 目标无法解析则不发兵', () => {
    const { gs, ai } = setup();
    ai._applyEngineActions([{ type: 'launch_march', target: '不存在的城', posture: 'open' }], gs, AI_AUTHORITY.COAUTHOR);
    expect(gs.strategicState.marches.length).toBe(0);
  });
  test('engage 仅在兵临城下时落为待执行作战令', () => {
    const { gs, ai } = setup();
    ai._applyEngineActions([{ type: 'engage', choice: 'sally' }], gs, AI_AUTHORITY.COAUTHOR);
    expect(gs._pendingWarOrder).toBeFalsy();        // 无 _pendingEngagement → 忽略
    gs._pendingEngagement = { attacker: 'wei', defender: 'shu', targetHoldingId: 'chengdu' };
    ai._applyEngineActions([{ type: 'engage', choice: 'sally' }], gs, AI_AUTHORITY.COAUTHOR);
    expect(gs._pendingWarOrder).toEqual({ kind: 'engage', choice: 'sally' });
  });
  test('siege_order 仅在围城时落为待执行作战令', () => {
    const { gs, ss, ai } = setup();
    ai._applyEngineActions([{ type: 'siege_order', order: 'hold' }], gs, AI_AUTHORITY.COAUTHOR);
    expect(gs._pendingWarOrder).toBeFalsy();
    gs.strategicState.sieges.push({ id: 's1', attacker: 'wei', defender: 'shu', holdingId: 'chengdu',
      atk: { troops: 30000, morale: 70, supply: 200 }, def: { troops: 6000, morale: 70, supply: 150 }, works: { gate: 200, wall: 300 }, mode: 'blockade', xun: 0 });
    ai._applyEngineActions([{ type: 'siege_order', order: 'relief', allyId: 'wu' }], gs, AI_AUTHORITY.COAUTHOR);
    expect(gs._pendingWarOrder).toEqual({ kind: 'siege_order', order: 'relief', allyId: 'wu' });
  });
});

describe('Phase 42 T2 — GameSession 收尾待执行作战令', () => {
  async function newSess(mode = 'interactive') {
    const s = new GameSession({ combatMode: mode });
    s.loadPreset(warPreset());
    s.configureAI({ endpoint: '' });
    await s.kickoff();
    return s;
  }
  test('engage:hold 待执行令 → 起围城战', async () => {
    const s = await newSess();
    // 模拟敌军已抵城下
    s.gameState._pendingEngagement = (() => {
      const ss = s.sys('StrategicSystem');
      return ss.launchMarch(s.gameState, 'wei', 'chengdu', { posture: 'open' });
    })();
    s.gameState._pendingWarOrder = { kind: 'engage', choice: 'hold' };
    await s._drainWarOrder();
    expect(s.sys('StrategicSystem').playerSiege(s.gameState)).toBeTruthy();  // 闭城固守 → 围城战起
    expect(s.gameState._pendingWarOrder).toBeNull();
    s.destroy();
  });
});
