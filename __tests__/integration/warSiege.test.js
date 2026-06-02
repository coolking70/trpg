/**
 * 围城状态机 集成测试（Phase 41 W4）
 * 闭城固守→siege 态→坚守/反击/求援/突围；结局：退兵(守住)/城陷/夺城。
 */
import { GameSession } from '../../src/core/GameSession.js';
import { StrategicSystem } from '../../src/systems/StrategicSystem.js';

function warPreset(over = {}) {
  return {
    presetId: 't', name: '围城测试', author: 't', lore: { worldName: '汉末' },
    factions: [{ id: 'shu', name: '蜀' }, { id: 'wei', name: '魏' }, { id: 'wu', name: '吴' }],
    characters: [{ id: 'char_player', name: '主公', stats: { hp: 100, hpCurrent: 100, mp: 0, mpCurrent: 0, attack: 10, defense: 5, speed: 8, luck: 1 } }],
    enemies: [], items: [], events: [],
    scenes: [{ id: 'scene_court', name: '理政朝堂', type: 'settlement', icon: '🏛', coords: { x: 0, y: 0 }, tags: ['spawn', 'governance'], description: '', connections: [], events: [], vignettes: [] }],
    startingSceneId: 'scene_court',
    strategicSetup: {
      playerFactionId: 'shu',
      regions: { yi: { name: '益州', adjacency: ['guan', 'jing'] }, guan: { name: '关中', adjacency: ['yi'] }, jing: { name: '荆州', adjacency: ['yi'] } },
      factions: {
        shu: { gold: 200, food: 400, troops: 8000, order: 60,
          holdings: [{ id: 'chengdu', name: '成都', type: 'capital', population: 30000, dev: 100, security: 60, region: 'yi' }],
          diplomacy: { wei: { stance: 'war', relation: -70 }, wu: { stance: 'ally', relation: 75 } } },
        wei: { gold: 400, food: 800, troops: 30000, order: 70, holdings: [{ id: 'changan', name: '长安', type: 'capital', population: 80000, dev: 110, security: 65, region: 'guan' }] },
        wu: { gold: 300, food: 600, troops: 15000, order: 68, holdings: [{ id: 'jianye', name: '建业', type: 'capital', population: 50000, dev: 105, security: 60, region: 'jing' }] },
        ...over.factions,
      },
    },
  };
}

async function siegeAt(opts = {}) {
  const s = new GameSession({ combatMode: opts.mode || 'interactive' });
  s.loadPreset(warPreset(opts.preset)); s.configureAI({ endpoint: '' }); await s.kickoff();
  const ss = s.sys('StrategicSystem');
  // 直接建一支魏军行军 → 推进到抵达 → 闭城固守 → 进入围城
  ss.launchMarch(s.gameState, 'wei', 'chengdu', { posture: 'raid', troops: opts.atkTroops ?? 18000 });
  let st = s.getState();
  for (let i = 0; i < 12 && st.situation !== 'engagement'; i++) { await s.applyAction({ type: 'advance_season' }); st = s.getState(); }
  await s.applyAction({ type: 'engage', choice: 'hold' });
  return { s, ss };
}

describe('Phase 41 W4 — 围城状态机', () => {
  let origRandom;
  beforeEach(() => { origRandom = Math.random; Math.random = () => 0.4; });
  afterEach(() => { Math.random = origRandom; });

  test('闭城固守 → situation:siege + 守方四项操作', async () => {
    const { s } = await siegeAt();
    const st = s.getState();
    expect(st.situation).toBe('siege');
    expect(st.siege.holding).toBe('成都');
    const orders = st.options.filter(o => o.type === 'siege_order').map(o => o.order);
    expect(orders).toEqual(expect.arrayContaining(['hold', 'sortie', 'relief', 'breakout']));
    s.destroy();
  });

  test('强攻反击：挫敌兵力士气', async () => {
    const { s, ss } = await siegeAt();
    const sg = ss.playerSiege(s.gameState);
    const t0 = sg.atk.troops, m0 = sg.atk.morale;
    await s.applyAction({ type: 'siege_order', order: 'sortie' });
    const sg2 = ss.playerSiege(s.gameState) || sg;
    expect(sg2.atk.troops).toBeLessThan(t0);
    expect(sg2.atk.morale).toBeLessThanOrEqual(m0);
    s.destroy();
  });

  test('求援：召盟友（吴）发救援行军', async () => {
    const { s } = await siegeAt();
    const before = s.gameState.strategicState.marches.length;
    await s.applyAction({ type: 'siege_order', order: 'relief', allyId: 'wu' });
    const relief = s.gameState.strategicState.marches.find(m => m.reliefFor);
    expect(relief).toBeTruthy();
    expect(relief.attacker).toBe('wu');
    s.destroy();
  });

  test('坚守到敌退：攻城兵远不及守军 → 退兵解围（守住，城仍属蜀）', async () => {
    const { s, ss } = await siegeAt({ atkTroops: 2500 }); // 兵力不足守军四成 → 久攻必退
    let st = s.getState();
    for (let i = 0; i < 40 && st.situation === 'siege'; i++) { await s.applyAction({ type: 'siege_order', order: 'hold' }); st = s.getState(); }
    expect(st.situation).not.toBe('siege'); // 围城已解
    expect(ss.getFactionState(s.gameState, 'shu').holdings.some(h => h.id === 'chengdu')).toBe(true); // 成都仍属蜀
    s.destroy();
  });

  test('突围决战(auto)：发起野战并据胜负解围/城陷', async () => {
    const { s, ss } = await siegeAt({ mode: 'auto', atkTroops: 9000 });
    await s.applyAction({ type: 'siege_order', order: 'breakout' });
    // auto 野战打完后围城应已结算（不再 siege）
    expect(ss.playerSiege(s.gameState)).toBeNull();
    s.destroy();
  });
});
