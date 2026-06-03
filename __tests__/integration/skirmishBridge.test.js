/**
 * 局部战斗 × 战略桥接 集成测试（Phase 44 P44b）
 * 验证：底层视角(soldier)下其势力卷入战事时可"请缨参战"→局部战斗；
 *       局部时间放缓——参战不推进战略时钟（季/旬）；交互模式逐回合、auto 模式一战到底。
 */
import { GameSession } from '../../src/core/GameSession.js';

function preset(playerRole) {
  return {
    presetId: 't', name: 't', lore: { worldName: '汉末' },
    characters: [{ id: 'char_player', name: '某卒', stats: { hp: 80, hpCurrent: 80, mp: 0, mpCurrent: 0, attack: 12, defense: 6, speed: 7, luck: 2 } }],
    enemies: [], items: [], events: [],
    scenes: [{ id: 'scene_camp', name: '军营', type: 'settlement', icon: '⛺', coords: { x: 0, y: 0 }, tags: ['spawn'], description: '', connections: [], events: [], vignettes: [] }],
    startingSceneId: 'scene_camp',
    strategicSetup: {
      playerFactionId: 'shu', playerRole,
      regions: { yi: { name: '益州', adjacency: ['guan'] }, guan: { name: '关中', adjacency: ['yi'] } },
      factions: {
        shu: { gold: 100, food: 200, troops: 8000, order: 60, holdings: [{ id: 'chengdu', name: '成都', type: 'capital', population: 20000, dev: 100, security: 50, region: 'yi' }], diplomacy: { wei: { stance: 'war', relation: -70 } } },
        wei: { gold: 400, food: 6000, troops: 30000, order: 70, holdings: [{ id: 'changan', name: '长安', type: 'capital', population: 80000, dev: 110, security: 65, region: 'guan' }] },
      },
    },
  };
}
async function load(role, mode = 'auto') {
  const s = new GameSession({ combatMode: mode });
  s.loadPreset(preset(role)); s.configureAI({ endpoint: '' }); await s.kickoff();
  return s;
}
// 把战事推到玩家势力被围（构造一个 shu 守方围城）
function forceSiege(s) {
  const ss = s.sys('StrategicSystem');
  ss.launchMarch(s.gameState, 'wei', 'chengdu', { posture: 'open' });
  // 直接推进行军直到 chengdu 起围（soldier 下守将自动闭城固守）
  for (let i = 0; i < 12 && !s.gameState.strategicState.sieges.some(g => g.holdingId === 'chengdu'); i++) {
    ss.advanceWarXun(s.gameState);
  }
}

describe('Phase 44 P44b — 请缨参战 + 局部时间放缓', () => {
  test('soldier 势力被围 → getState 出现 skirmish_join；ruler 不出现', async () => {
    const s = await load('soldier', 'interactive');
    forceSiege(s);
    const st = s.getState();
    expect(st.options.some(o => o.type === 'skirmish_join')).toBe(true);
    s.destroy();
    const r = await load('ruler', 'interactive');
    forceSiege(r);
    expect(r.getState().options.some(o => o.type === 'skirmish_join')).toBe(false);
    r.destroy();
  });

  test('参战不推进战略时钟（局部时间放缓）', async () => {
    const s = await load('soldier', 'auto');
    forceSiege(s);
    const season0 = s.gameState.strategicState.season;
    const xun0 = s.gameState.strategicState.warXun;
    s.sys('SkirmishSystem').rng = (() => { let x = 5; return () => { x = (1103515245 * x + 12345) >>> 0; return x / 4294967296; }; })();
    await s.applyAction({ type: 'skirmish_join' });
    // auto 模式：一战到底，战斗已结束
    expect(s.gameState.activeSkirmish).toBeNull();
    // 战略时钟纹丝不动
    expect(s.gameState.strategicState.season).toBe(season0);
    expect(s.gameState.strategicState.warXun).toBe(xun0);
    // 记录了一场战斗 + 战功
    expect(s.gameState.soldierCareer.battles).toBe(1);
    s.destroy();
  });

  test('交互模式：参战进入 skirmish 态，逐回合推进直至结束', async () => {
    const s = await load('soldier', 'interactive');
    forceSiege(s);
    s.sys('SkirmishSystem').rng = (() => { let x = 11; return () => { x = (1103515245 * x + 12345) >>> 0; return x / 4294967296; }; })();
    let st = await s.applyAction({ type: 'skirmish_join' });
    expect(st.situation).toBe('skirmish');
    expect(st.skirmish).toBeTruthy();
    let guard = 0;
    while (st.situation === 'skirmish' && guard++ < 60) {
      const atk = st.options.find(o => o.type === 'skirmish' && o.skAction === 'attack')
        || st.options.find(o => o.type === 'skirmish');
      st = await s.applyAction({ type: 'skirmish', skAction: atk.skAction, targetId: atk.targetId });
    }
    expect(st.situation).not.toBe('skirmish');
    expect(s.gameState.soldierCareer.battles).toBe(1);
    s.destroy();
  });
});
