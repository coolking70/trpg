/**
 * GameSession 核心集成测试
 * 验证权威对局核心在「未配置 AI GM」时（localFallback）也能正常推进：
 *  - 载入预设 + 开局扫描事件
 *  - getState() 快照结构正确
 *  - applyAction(choose) 落实 effect、推进状态
 *  - applyAction(travel) 单跳前往相邻场景
 */

import { GameSession } from '../../src/core/GameSession.js';
import { DEFAULT_PRESET } from '../../src/data/defaultPreset.js';

describe('GameSession 权威对局核心', () => {
  let session;
  let origRandom;

  beforeEach(async () => {
    origRandom = Math.random;
    Math.random = () => 0; // 确定性：取第一个 outcome，且不触发概率遭遇
    session = new GameSession(); // 不配置 AI → localFallback
    session.loadPreset(DEFAULT_PRESET);
    await session.kickoff();
  });

  afterEach(() => {
    Math.random = origRandom;
    session.destroy();
  });

  test('开局：定位起始场景并触发第一章事件', () => {
    const s = session.getState();
    expect(s.ready).toBe(true);
    expect(s.scene?.id).toBe('scene_spawn');
    expect(s.situation).toBe('event');
    expect(s.event?.id).toBe('ch1_start');
    expect(s.options.some(o => o.type === 'choose' && o.choiceId === 'accept_quest')).toBe(true);
    // 未配置 AI 也应有叙述（localFallback 供给）
    expect(s.narrative.length).toBeGreaterThan(0);
  });

  test('choose 选项：落实 effect 并回到旅行态', async () => {
    const s = await session.applyAction({ type: 'choose', choiceId: 'accept_quest' });
    expect(session.gameState.variables.quest_received).toBe(true);
    expect(session.gameState.completedEventIds).toContain('ch1_start');
    expect(s.situation).toBe('travel');
    // 旅行选项里应包含通往森林路径的相邻边
    expect(s.options.some(o => o.type === 'travel' && o.sceneId === 'scene_forest_path')).toBe(true);
  });

  test('travel 单跳：前往相邻场景并更新当前场景', async () => {
    await session.applyAction({ type: 'choose', choiceId: 'accept_quest' });
    const s = await session.applyAction({ type: 'travel', sceneId: 'scene_forest_path' });
    expect(session.gameState.mapState.currentSceneId).toBe('scene_forest_path');
    expect(s.scene?.id).toBe('scene_forest_path');
    expect(s.progress.scenesVisited).toBeGreaterThanOrEqual(2);
  });

  test('getState 在未就绪时返回 ready:false', () => {
    const fresh = new GameSession();
    expect(fresh.getState().ready).toBe(false);
    fresh.destroy();
  });

  test('party 快照含 hp/hpPct/alive 字段', () => {
    const s = session.getState();
    expect(s.party.length).toBeGreaterThan(0);
    const p = s.party[0];
    expect(typeof p.hp).toBe('number');
    expect(typeof p.hpPct).toBe('number');
    expect(p.alive).toBe(true);
  });

  test('战斗自动结算：start_combat 后 _autoResolveCombat 清空 activeCombat 且不挂起', async () => {
    Math.random = () => 0.3; // 非退化值（避免 DiceSystem 快排在全 0 下退化）
    // 起一场对弱敌的战斗（主角满血 vs 低血敌人）
    session._startCombat(['enemy_001']);
    expect(session.gameState.activeCombat).toBeTruthy();

    await session._autoResolveCombat();

    // 关键：战斗被结算清空（dedup 后 harness 依赖此自动结算路径）
    expect(session.gameState.activeCombat).toBeFalsy();
    // 产生了战斗系统叙述（攻击/胜负）
    const sysLines = session.gameState.narrativeLog.filter(n => n.speaker === 'system').map(n => n.text);
    expect(sysLines.some(t => /战斗胜利|战斗结束|使用|攻击/.test(t))).toBe(true);
  });
});
