/**
 * 主题包端到端 集成测试（Phase 42 T4）
 * 验证：中世纪西幻 / 现代战争 示范剧本经 GameSession 加载后，
 *       战略层资源/政令标签、战略→军团战兵种、围城作战 全部按题材 Schema 工作。
 */
import { GameSession } from '../../src/core/GameSession.js';
import { medievalFantasyPreset } from '../../src/data/themes/medievalFantasyPreset.js';
import { modernWarPreset } from '../../src/data/themes/modernWarPreset.js';

async function load(preset, mode = 'auto') {
  const s = new GameSession({ combatMode: mode });
  s.loadPreset(JSON.parse(JSON.stringify(preset)));
  s.configureAI({ endpoint: '' });
  await s.kickoff();
  return s;
}

describe('Phase 42 T4 — 中世纪西幻主题包', () => {
  test('题材资源/城池/政令标签生效', async () => {
    const s = await load(medievalFantasyPreset);
    expect(s.gameState.strategySchema.resources.gold.name).toBe('金币');
    const holds = s.gameState.strategicState.factions.silvermoon.holdings;
    expect(holds.find(h => h.id === 'silver_keep').type).toBe('capital');
    // 政令标签换皮
    expect(s.gameState.strategySchema.policies.conscript.name).toBe('募兵');
    s.destroy();
  });
  test('战略→军团战使用题材兵种（守军长枪兵/攻军骑士）', async () => {
    const s = await load(medievalFantasyPreset, 'auto');
    const ss = s.sys('StrategicSystem');
    // 敌国进军玩家要塞 → 抵达 → 玩家出城迎击 → 题材野战
    ss.launchMarch(s.gameState, 'ironhold', 'wardstone', { posture: 'open' });
    let st = s.getState();
    for (let i = 0; i < 10 && st.situation !== 'engagement'; i++) { await s.applyAction({ type: 'advance_season' }); st = s.getState(); }
    expect(st.situation).toBe('engagement');
    // 出城迎击（auto 模式自动结算野战），断言战斗确曾以题材兵种发生
    const seenUnitNames = [];
    s.engine.getSystem('EventSystem').subscribe('legion:start', (e) => {
      for (const u of [...(e.data.player || []), ...(e.data.enemy || [])]) seenUnitNames.push(u.unitType);
    });
    await s.applyAction({ type: 'engage', choice: 'sally' });
    // 题材兵种 KEY：守 pikeman、攻 swordsman/knight
    expect(seenUnitNames.some(k => ['pikeman', 'swordsman', 'knight', 'archer'].includes(k))).toBe(true);
    expect(seenUnitNames.includes('spearman')).toBe(false); // 不应出现三国兵种
    s.destroy();
  });
});

describe('Phase 42 T4 — 现代战争主题包', () => {
  test('题材资源/政令标签生效 + 政令落地', async () => {
    const s = await load(modernWarPreset, 'interactive');
    expect(s.gameState.strategySchema.resources.gold.name).toBe('资金');
    expect(s.gameState.strategySchema.resources.order.name).toBe('民意');
    const ss = s.sys('StrategicSystem');
    const before = ss.getFactionState(s.gameState, 'blue').troops;
    await s.applyAction({ type: 'govern', policyId: 'conscript' }); // 征召增兵力
    expect(ss.getFactionState(s.gameState, 'blue').troops).toBeGreaterThan(before);
    s.destroy();
  });
  test('战略→军团战使用题材兵种（装甲/步兵）', async () => {
    const s = await load(modernWarPreset, 'auto');
    const ss = s.sys('StrategicSystem');
    ss.launchMarch(s.gameState, 'red', 'fort_line', { posture: 'open' });
    let st = s.getState();
    for (let i = 0; i < 10 && st.situation !== 'engagement'; i++) { await s.applyAction({ type: 'advance_season' }); st = s.getState(); }
    expect(st.situation).toBe('engagement');
    const seen = [];
    s.engine.getSystem('EventSystem').subscribe('legion:start', (e) => {
      for (const u of [...(e.data.player || []), ...(e.data.enemy || [])]) seen.push(u.unitType);
    });
    await s.applyAction({ type: 'engage', choice: 'sally' });
    expect(seen.some(k => ['infantry', 'armor', 'artillery'].includes(k))).toBe(true);
    s.destroy();
  });
});
