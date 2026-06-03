/**
 * 战略系统作为可选模块 — 解耦验证（Phase 47 P47a）
 * 确认：不含战略层(strategicSetup/strategicLayer)的剧本，基础架构完全正常运转，
 *       战略/局部战斗的一切代码路径均静默不激活（数据驱动的可选模块，零耦合泄漏）。
 */
import { GameSession } from '../../src/core/GameSession.js';

// 一个纯个人冒险剧本（无 factions / strategicSetup / 军团战）
function adventurePreset() {
  return {
    presetId: 'adv', name: '林中小径', author: 't', lore: { worldName: '幽林' },
    characters: [{ id: 'char_player', name: '旅人', stats: { hp: 60, hpCurrent: 60, mp: 10, mpCurrent: 10, attack: 9, defense: 5, speed: 7, luck: 2 } }],
    enemies: [{ id: 'wolf', name: '野狼', stats: { hp: 24, hpCurrent: 24, attack: 6, defense: 2, speed: 8, luck: 1 } }],
    items: [], events: [
      { id: 'ev_open', type: 'event', name: '岔路', description: '林中岔路。', eventType: 'story',
        trigger: { type: 'composite', condition: { inScene: ['scene_a'] } }, tags: [],
        choices: [{ id: 'c1', text: '向北', outcomes: [{ probability: 1, text: '你向北走去。', effects: [] }] }] },
    ],
    scenes: [
      { id: 'scene_a', name: '林口', type: 'wilderness', icon: '🌲', coords: { x: 0, y: 0 }, tags: ['spawn'], description: '幽暗林口。', connections: [{ to: 'scene_b', label: '深入' }], events: [], vignettes: [] },
      { id: 'scene_b', name: '林深处', type: 'wilderness', icon: '🌲', coords: { x: 1, y: 0 }, tags: [], description: '密林深处。', connections: [{ to: 'scene_a', label: '返回' }], events: [], vignettes: [] },
    ],
    startingSceneId: 'scene_a',
  };
}

describe('Phase 47 P47a — 无战略层时基础架构正常（可选模块解耦）', () => {
  test('加载/开局正常，且战略状态完全缺席', async () => {
    const s = new GameSession({ combatMode: 'interactive' });
    s.loadPreset(adventurePreset());
    s.configureAI({ endpoint: '' });
    await s.kickoff();
    expect(s.gameState.strategicState).toBeNull();      // 无战略层
    expect(s.gameState.activeSkirmish).toBeFalsy();
    const st = s.getState();
    expect(st.ready).toBe(true);
    expect(['travel', 'event']).toContain(st.situation); // 普通冒险态
    expect(st.strategy).toBeNull();                      // 无战略概要
    expect(st.skirmish).toBeFalsy();
    // 绝不出现战略/局部战斗的任何动作或情境
    expect(st.options.some(o => ['govern', 'diplomacy', 'advance_season', 'engage', 'siege_order', 'skirmish_join', 'skirmish'].includes(o.type))).toBe(false);
    s.destroy();
  });

  test('旅行/事件推进正常（战略代码路径全程静默）', async () => {
    const s = new GameSession({ combatMode: 'interactive' });
    s.loadPreset(adventurePreset());
    s.configureAI({ endpoint: '' });
    await s.kickoff();
    await s.applyAction({ type: 'travel', sceneId: 'scene_b' });
    let st = s.getState();
    expect(st.scene.id).toBe('scene_b');
    expect(st.situation).toBe('travel');
    // 即使误调战略动作也不崩（守卫生效）
    await s.applyAction({ type: 'advance_season' });
    st = s.getState();
    expect(st.ready).toBe(true);
    expect(st.strategy).toBeNull();
    s.destroy();
  });

  test('schemaOf 缺省回退（战略主题不影响普通剧本）', async () => {
    const s = new GameSession({ combatMode: 'interactive' });
    s.loadPreset(adventurePreset());
    s.configureAI({ endpoint: '' });
    await s.kickoff();
    // strategySchema 仍被解析（无害），但不驱动任何玩法
    expect(s.gameState.strategySchema).toBeTruthy();
    expect(s.sys('StrategicSystem').playerCommands(s.gameState)).toBe(true); // 无战略层 → 视作 ruler（默认）
    s.destroy();
  });
});
