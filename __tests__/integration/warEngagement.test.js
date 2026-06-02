/**
 * 接敌抉择 RPC 集成测试（Phase 41 W3）
 * 行军抵达玩家城 → situation:'engagement' → 出城迎击(野战)/闭城固守(围城)。
 */
import { GameSession } from '../../src/core/GameSession.js';

function warPreset() {
  return {
    presetId: 't', name: '作战测试', author: 't', lore: { worldName: '汉末' },
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

async function newSess(mode = 'interactive') {
  const s = new GameSession({ combatMode: mode });
  s.loadPreset(warPreset());
  s.configureAI({ endpoint: '' });
  await s.kickoff();
  return s;
}

describe('Phase 41 W3 — 接敌抉择', () => {
  let origRandom;
  beforeEach(() => { origRandom = Math.random; Math.random = () => 0.4; });
  afterEach(() => { Math.random = origRandom; });

  test('行军抵达 → situation:engagement + 两选项', async () => {
    const s = await newSess();
    const ss = s.sys('StrategicSystem');
    ss.launchMarch(s.gameState, 'wei', 'chengdu', { posture: 'open' });
    // 反复处理政务推进至敌军抵达
    let st = s.getState();
    for (let i = 0; i < 8 && st.situation !== 'engagement'; i++) { await s.applyAction({ type: 'advance_season' }); st = s.getState(); }
    expect(st.situation).toBe('engagement');
    expect(st.options.some(o => o.type === 'engage' && o.choice === 'sally')).toBe(true);
    expect(st.options.some(o => o.type === 'engage' && o.choice === 'hold')).toBe(true);
    s.destroy();
  });

  test('出城迎击 → 进入野战（activeLegionBattle）', async () => {
    const s = await newSess('auto'); // auto 让野战自动结算完
    const ss = s.sys('StrategicSystem');
    ss.launchMarch(s.gameState, 'wei', 'chengdu', { posture: 'open' });
    let st = s.getState();
    for (let i = 0; i < 8 && st.situation !== 'engagement'; i++) { await s.applyAction({ type: 'advance_season' }); st = s.getState(); }
    expect(st.situation).toBe('engagement');
    await s.applyAction({ type: 'engage', choice: 'sally' });
    // auto 模式野战会自动打完；确认确实进过军团战（叙事含"出城列阵"或战果）
    const log = s.gameState.narrativeLog.map(n => n.text).join('\n');
    expect(/出城列阵|此役我军/.test(log)).toBe(true);
    s.destroy();
  });

  test('闭城固守 → 建立围城（strategicState.sieges）', async () => {
    const s = await newSess();
    const ss = s.sys('StrategicSystem');
    ss.launchMarch(s.gameState, 'wei', 'chengdu', { posture: 'raid' });
    let st = s.getState();
    for (let i = 0; i < 10 && st.situation !== 'engagement'; i++) { await s.applyAction({ type: 'advance_season' }); st = s.getState(); }
    expect(st.situation).toBe('engagement');
    await s.applyAction({ type: 'engage', choice: 'hold' });
    expect(s.gameState.strategicState.sieges.length).toBe(1);
    expect(s.gameState.strategicState.sieges[0].holdingId).toBe('chengdu');
    expect(s.gameState._pendingEngagement).toBeNull();
    s.destroy();
  });
});
