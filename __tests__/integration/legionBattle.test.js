/**
 * 军团战争 RPC 集成测试（Phase 31 L3）
 * 验证 GameSession 把军团战接入 getState()/applyAction() 边界：
 *  - 事件效果 start_legion_battle 装配并进入军团战
 *  - auto 模式自动结算到胜负
 *  - interactive 模式：getState 给出 legion 快照 + 指令选项，逐条 applyAction 推进至结束
 */

import { GameSession } from '../../src/core/GameSession.js';
import { DEFAULT_PRESET } from '../../src/data/defaultPreset.js';

const generals = {
  zhao: { name: '赵将军', warfare: { command: 80, might: 90, intellect: 60, tactics: 2, abilities: ['charge', 'rally'] } },
  zhang: { name: '张将军', warfare: { command: 60, might: 60, intellect: 55, tactics: 1, abilities: ['rally'] } },
};

function fieldBattle() {
  return {
    battleType: 'field',
    generals,
    supply: { player: 80, enemy: 70 },
    units: [
      { id: 'p1', side: 'player', unitType: 'cavalry', troops: 4000, generalId: 'zhao' },
      { id: 'p2', side: 'player', unitType: 'spearman', troops: 3000, generalId: 'zhao' },
      { id: 'e1', side: 'enemy', unitType: 'archer', troops: 1500, generalId: 'zhang' },
      { id: 'e2', side: 'enemy', unitType: 'infantry', troops: 1500, generalId: 'zhang' },
    ],
  };
}

describe('军团战争 — RPC 接线（auto）', () => {
  let session, origRandom;
  beforeEach(async () => {
    origRandom = Math.random; Math.random = () => 0.4;
    session = new GameSession(); // auto
    session.configureAI({ endpoint: '' }); // 关闭 AI → 走即时本地兜底叙述（不打网络）
    session.loadPreset(DEFAULT_PRESET);
    await session.kickoff();
  });
  afterEach(() => { Math.random = origRandom; session.destroy(); });

  test('start_legion_battle 效果装配军团战状态', () => {
    session._applyEventEffect({ type: 'start_legion_battle', battle: fieldBattle() });
    expect(session.gameState.activeLegionBattle).toBeTruthy();
    expect(session.gameState.activeLegionBattle.battleType).toBe('field');
    expect(session.gameState.currentPhase).toBe('legion');
  });

  test('auto 模式：进入后自动结算到胜负并回到探索态', async () => {
    session._startLegionBattle(fieldBattle());
    await session._enterLegionBattle();
    expect(session.gameState.activeLegionBattle).toBeNull();
    expect(session.gameState.currentPhase).toBe('exploration');
    // 应有开战 + 结果叙述
    const log = session.gameState.narrativeLog.map(n => n.text).join('\n');
    expect(/我军/.test(log)).toBe(true);
  });

  test('getState 在军团战中 situation=legion 且含快照', async () => {
    const isess = new GameSession({ combatMode: 'interactive' });
    isess.configureAI({ endpoint: '' });
    isess.loadPreset(DEFAULT_PRESET);
    await isess.kickoff();
    isess._startLegionBattle(fieldBattle());
    await isess._enterLegionBattle();
    const s = isess.getState();
    expect(s.situation).toBe('legion');
    expect(s.legion).toBeTruthy();
    expect(s.legion.battleType).toBe('field');
    expect(s.legion.player.length).toBeGreaterThan(0);
    expect(s.legion.enemy.length).toBeGreaterThan(0);
    // 轮到我方部队 → 给出 legion 指令选项
    expect(s.legion.awaitingInput).toBe(true);
    expect(s.options.some(o => o.type === 'legion')).toBe(true);
    isess.destroy();
  });
});

describe('军团战争 — RPC 接线（interactive 逐令推进）', () => {
  test('反复 applyAction(legion) 直至战斗结束', async () => {
    const origRandom = Math.random; Math.random = () => 0.4;
    const isess = new GameSession({ combatMode: 'interactive' });
    isess.configureAI({ endpoint: '' });
    isess.loadPreset(DEFAULT_PRESET);
    await isess.kickoff();
    isess._startLegionBattle(fieldBattle());
    await isess._enterLegionBattle();

    let s = isess.getState();
    let guard = 0;
    while (s.situation === 'legion' && guard++ < 300) {
      const opt = s.options.find(o => o.type === 'legion' && o.orderType === 'attack')
        || s.options.find(o => o.type === 'legion');
      s = await isess.applyAction({
        type: 'legion', orderType: opt.orderType, targetId: opt.targetId,
        formation: opt.formation, tacticKey: opt.tacticKey,
      });
    }
    expect(guard).toBeLessThan(300);          // 收敛
    expect(isess.gameState.activeLegionBattle).toBeNull();
    expect(s.situation).not.toBe('legion');
    Math.random = origRandom;
    isess.destroy();
  });
});
