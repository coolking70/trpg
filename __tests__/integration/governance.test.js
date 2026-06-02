/**
 * 内政外交 RPC 集成测试（Phase 33 S3）
 * 验证 GameSession 把战略层接入 getState()/applyAction()：
 *  - loadPreset 初始化 strategicState；getState 带 strategy 概要
 *  - 位于「理政」场景 → situation:'governance' + 内政/外交/推进选项
 *  - applyAction govern/diplomacy/advance_season 改变战略态、宣战置 worldFlags
 */

import { GameSession } from '../../src/core/GameSession.js';

// 最小战略剧本：一个理政朝堂场景 + strategicSetup
function strategyPreset() {
  return {
    presetId: 'test_strategy', name: '战略测试', author: 't',
    lore: { worldName: '汉末' },
    factions: [{ id: 'shu', name: '蜀' }, { id: 'wei', name: '魏' }, { id: 'wu', name: '吴' }],
    characters: [{ id: 'char_player', name: '主公', stats: { hp: 100, hpCurrent: 100, mp: 0, mpCurrent: 0, attack: 10, defense: 5, speed: 8, luck: 1 } }],
    enemies: [], items: [], events: [],
    scenes: [{
      id: 'scene_court', name: '理政朝堂', type: 'settlement', icon: '🏛',
      coords: { x: 0, y: 0 }, tags: ['spawn', 'governance', 'safe'],
      description: '丞相府正堂，群僚议政之所。', connections: [], events: [], vignettes: [],
    }],
    startingSceneId: 'scene_court',
    strategicSetup: {
      playerFactionId: 'shu',
      factions: {
        shu: { gold: 300, food: 300, troops: 4000, order: 60, agg: { population: 20000, productionEfficiency: 100, security: 50 },
          diplomacy: { wei: { stance: 'war', relation: -70 }, wu: { stance: 'neutral', relation: 20 } } },
        wei: { gold: 400, food: 800, troops: 25000, order: 70, agg: { population: 90000, productionEfficiency: 110, security: 60 } },
        wu: { gold: 200, food: 400, troops: 10000, order: 65, agg: { population: 45000, productionEfficiency: 105, security: 55 } },
      },
    },
  };
}

describe('内政外交 — RPC 接线', () => {
  let sess, origRandom;
  beforeEach(async () => {
    origRandom = Math.random; Math.random = () => 0.4;
    sess = new GameSession({ combatMode: 'interactive' });
    sess.configureAI({ endpoint: '' }); // 关闭 AI → 即时本地兜底叙述
    sess.loadPreset(strategyPreset());
    await sess.kickoff();
  });
  afterEach(() => { Math.random = origRandom; sess.destroy(); });

  test('loadPreset 初始化 strategicState + getState 带 strategy 概要', () => {
    expect(sess.gameState.strategicState).toBeTruthy();
    const s = sess.getState();
    expect(s.strategy).toBeTruthy();
    expect(s.strategy.resources.troops).toBe(4000);
    expect(s.strategy.diplomacy.find(d => d.factionId === 'wei').stance).toBe('war');
  });

  test('位于理政朝堂 → situation:governance + 内政/外交/推进选项', () => {
    const s = sess.getState();
    expect(s.situation).toBe('governance');
    expect(s.options.some(o => o.type === 'govern' && o.policyId === 'conscript')).toBe(true);
    expect(s.options.some(o => o.type === 'diplomacy')).toBe(true);
    expect(s.options.some(o => o.type === 'advance_season')).toBe(true);
  });

  test('govern 征兵：兵增、金减', async () => {
    const before = { ...sess.gameState.strategicState.factions.shu };
    await sess.applyAction({ type: 'govern', policyId: 'conscript' });
    const after = sess.gameState.strategicState.factions.shu;
    expect(after.troops).toBeGreaterThan(before.troops);
    expect(after.gold).toBeLessThan(before.gold);
  });

  test('diplomacy 与吴朝贡后结盟', async () => {
    await sess.applyAction({ type: 'diplomacy', diplomacyAction: 'tribute', targetId: 'wu' }); // 20→35
    await sess.applyAction({ type: 'diplomacy', diplomacyAction: 'tribute', targetId: 'wu' }); // 35→50
    await sess.applyAction({ type: 'diplomacy', diplomacyAction: 'alliance', targetId: 'wu' });
    expect(sess.gameState.strategicState.factions.shu.diplomacy.wu.stance).toBe('ally');
  });

  test('对吴宣战 → 置 worldFlags.war_with_wu', async () => {
    await sess.applyAction({ type: 'diplomacy', diplomacyAction: 'declare_war', targetId: 'wu' });
    expect(sess.gameState.worldFlags.war_with_wu).toBe(true);
    expect(sess.gameState.strategicState.factions.shu.diplomacy.wu.stance).toBe('war');
  });

  test('advance_season 推进季度并跑敌国 AI', async () => {
    expect(sess.gameState.strategicState.season).toBe(1);
    await sess.applyAction({ type: 'advance_season' });
    expect(sess.gameState.strategicState.season).toBe(2);
  });

  test('序列化往返保留 strategicState', () => {
    const json = sess.gameState.toJSON();
    expect(json.strategicState.playerFactionId).toBe('shu');
  });
});

describe('内政外交 — 与军团战深耦合（drawFromStrategy）', () => {
  let sess, origRandom;
  beforeEach(async () => {
    origRandom = Math.random; Math.random = () => 0.4;
    sess = new GameSession({ combatMode: 'auto' });
    sess.configureAI({ endpoint: '' });
    sess.loadPreset(strategyPreset());
    await sess.kickoff();
  });
  afterEach(() => { Math.random = origRandom; sess.destroy(); });

  test('出征从国库扣兵屯粮，战后残部归队 + 民心/资源结算', async () => {
    const shu = sess.gameState.strategicState.factions.shu; // 兵 4000 / 粮 300
    const troopsBefore = shu.troops, foodBefore = shu.food;

    sess._startLegionBattle({
      battleType: 'field', drawFromStrategy: true, enemyFactionId: 'wei',
      units: [
        { id: 'p1', side: 'player', unitType: 'cavalry', troops: 3000, generalId: 'gA' },
        { id: 'e1', side: 'enemy', unitType: 'archer', troops: 1200, generalId: 'gB' },
      ],
      generals: {
        gA: { name: '甲', warfare: { command: 80, might: 90, intellect: 60, tactics: 2, abilities: ['charge', 'rally'] } },
        gB: { name: '乙', warfare: { command: 60, might: 60, intellect: 55, tactics: 1, abilities: ['rally'] } },
      },
    });

    // 起兵即从国库扣减兵力与粮草
    expect(sess.gameState.strategicState.factions.shu.troops).toBe(troopsBefore - 3000);
    expect(sess.gameState.strategicState.factions.shu.food).toBeLessThan(foodBefore);

    await sess._enterLegionBattle(); // auto 结算
    expect(sess.gameState.activeLegionBattle).toBeNull();

    // 战后残部归队（troops 较出征后回升）+ 战役结算上下文已清空
    const after = sess.gameState.strategicState.factions.shu;
    expect(after.troops).toBeGreaterThan(troopsBefore - 3000);
    expect(sess._legionStrategyCtx).toBeNull();
  });
});
