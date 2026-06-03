/**
 * 学校系统 GameSession 接线 + 可选模块门控（Phase 48 SC3）
 */
import { GameSession } from '../../src/core/GameSession.js';

function schoolPreset() {
  return {
    presetId: 'sch', name: '青云学府', author: 't', lore: { worldName: '青云' },
    characters: [{ id: 'char_player', name: '学子', stats: { hp: 50, hpCurrent: 50, mp: 10, mpCurrent: 10, attack: 8, defense: 4, speed: 7, luck: 3, intellect: 12 }, skills: [] }],
    enemies: [], items: [], events: [],
    scenes: [
      { id: 'scene_campus', name: '学府广场', type: 'town', icon: '🏫', coords: { x: 0, y: 0 }, tags: ['spawn', 'school'], description: '青云学府的中庭。', connections: [{ to: 'scene_town', label: '出校门' }], events: [], vignettes: [] },
      { id: 'scene_town', name: '城镇', type: 'town', icon: '🏘️', coords: { x: 1, y: 0 }, tags: [], description: '校外市集。', connections: [{ to: 'scene_campus', label: '回校' }], events: [], vignettes: [] },
    ],
    startingSceneId: 'scene_campus',
    schoolSetup: { schoolName: '青云学府' },
  };
}
function adventurePreset() {
  return {
    presetId: 'adv', name: '林径', author: 't', lore: { worldName: '林' },
    characters: [{ id: 'char_player', name: '旅人', stats: { hp: 40, hpCurrent: 40, mp: 0, mpCurrent: 0, attack: 8, defense: 4, speed: 6, luck: 2 } }],
    enemies: [], items: [], events: [],
    scenes: [{ id: 'scene_a', name: '林口', type: 'wilderness', icon: '🌲', coords: { x: 0, y: 0 }, tags: ['spawn'], description: '林口。', connections: [], events: [], vignettes: [] }],
    startingSceneId: 'scene_a',
  };
}

async function boot(preset) {
  const s = new GameSession({ combatMode: 'interactive' });
  s.loadPreset(preset);
  s.configureAI({ endpoint: '' });
  await s.kickoff();
  return s;
}

describe('SC3 — 学校作为可选模块', () => {
  test('无 schoolSetup → schoolState 缺席、无 school 情境/动作（零耦合）', async () => {
    const s = await boot(adventurePreset());
    expect(s.gameState.schoolState).toBeNull();
    const st = s.getState();
    expect(st.school).toBeNull();
    expect(st.situation).not.toBe('school');
    expect(st.options.some(o => o.type === 'school')).toBe(false);
    s.destroy();
  });

  test('有 schoolSetup 且身处校园 → school 情境 + 就学动作', async () => {
    const s = await boot(schoolPreset());
    expect(s.gameState.schoolState).toBeTruthy();
    const st = s.getState();
    expect(st.situation).toBe('school');
    expect(st.school.schoolName).toBe('青云学府');
    const ops = st.options.filter(o => o.type === 'school').map(o => o.op);
    expect(ops).toContain('elect');
    expect(ops).toContain('advance_term');
    s.destroy();
  });

  test('离开校园场景 → 退出 school 情境（回到 travel）', async () => {
    const s = await boot(schoolPreset());
    await s.applyAction({ type: 'travel', sceneId: 'scene_town' });
    const st = s.getState();
    expect(st.scene.id).toBe('scene_town');
    expect(st.situation).toBe('travel');
    expect(s.gameState.schoolState).toBeTruthy(); // 状态仍在，仅不呈现就学动作
    s.destroy();
  });

  test('就学动作端到端：选课→上课长属性→快照学分推进', async () => {
    const s = await boot(schoolPreset());
    const before = s.gameState.activeCharacters[0].stats.intellect;
    await s.applyAction({ type: 'school', op: 'elect', courseId: 'c_letters' });
    await s.applyAction({ type: 'school', op: 'attend', courseId: 'c_letters' });
    const st = s.getState();
    expect(s.gameState.activeCharacters[0].stats.intellect).toBe(before + 2);
    expect(st.school.credits.earned).toBe(3);
    expect(st.school.completedCount).toBe(1);
    s.destroy();
  });

  test('误调 school 动作在无学校剧本中不崩', async () => {
    const s = await boot(adventurePreset());
    await s.applyAction({ type: 'school', op: 'elect', courseId: 'c_letters' });
    expect(s.getState().ready).toBe(true);
    s.destroy();
  });

  test('课程 eventHook → 触发 requireSchoolState.eventHook 门控的校园剧情', async () => {
    // 自定义 schema：实践课带 eventHook；剧本含一个 hook 门控事件
    const preset = {
      presetId: 'sch2', name: '钩子学院', author: 't', lore: { worldName: 'X' },
      characters: [{ id: 'char_player', name: '学子', stats: { hp: 40, hpCurrent: 40, mp: 10, mpCurrent: 10, attack: 8, defense: 4, speed: 7, luck: 3, intellect: 12 }, skills: [] }],
      enemies: [], items: [],
      schoolSchema: { courses: { c_prac: { name: '实践课', credits: 3, type: 'practical', attr: 'luck', prereqs: [], grants: { stats: { luck: 1 } }, eventHook: 'field_hook' } } },
      schoolSetup: { schoolName: '钩子学院' },
      events: [
        { id: 'ev_hooked', type: 'event', name: '实践奇遇', description: '实践途中你遇到一桩奇事。', eventType: 'story',
          trigger: { type: 'composite', condition: { requireSchoolState: { eventHook: 'field_hook' } } }, tags: [], maxTriggers: 1,
          choices: [{ id: 'c1', text: '一探究竟', outcomes: [{ probability: 1, text: '你揭开了真相。', effects: [{ type: 'set_variable', name: 'hook_fired', value: true }] }] }] },
      ],
      scenes: [{ id: 'scene_campus', name: '校园', type: 'town', icon: '🏫', coords: { x: 0, y: 0 }, tags: ['spawn', 'school'], description: '校园。', connections: [], events: [], vignettes: [] }],
      startingSceneId: 'scene_campus',
    };
    const s = await boot(preset);
    await s.applyAction({ type: 'school', op: 'elect', courseId: 'c_prac' });
    await s.applyAction({ type: 'school', op: 'attend', courseId: 'c_prac' });
    const st = s.getState();
    expect(st.situation).toBe('event');          // hook 触发了校园剧情事件
    expect(st.event.id).toBe('ev_hooked');
    s.destroy();
  });
});
