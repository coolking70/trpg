/**
 * AIGMEngine.shouldCallAI 单元测试（Phase 26B — AI Hooks gate）
 */

import { AIGMEngine } from '../../src/systems/AIGMEngine.js';

function mkEngine({ preset, aiTier = 'standard' } = {}) {
  const ai = new AIGMEngine();
  ai.preset = preset;
  // 模拟 gameEngine.getGameState()
  ai.gameEngine = { getGameState: () => ({ aiTier }) };
  return ai;
}

const presetWithHooks = (overrides = {}) => ({
  aiHooks: {
    sceneArrival: 'optional',
    eventResolve: 'optional',
    npcDialogue: 'optional',
    vignette: 'never',
    worldRipple: 'optional',
    ...overrides,
  },
});

describe('AIGMEngine.shouldCallAI', () => {
  test('preset.aiHooks=never → 直接拒绝', () => {
    const ai = mkEngine({ preset: presetWithHooks({ sceneArrival: 'never' }), aiTier: 'advanced' });
    expect(ai.shouldCallAI('sceneArrival')).toBe(false);
  });

  test('preset.aiHooks=always → 总是允许（即便 tier=none）', () => {
    const ai = mkEngine({ preset: presetWithHooks({ sceneArrival: 'always' }), aiTier: 'none' });
    expect(ai.shouldCallAI('sceneArrival')).toBe(true);
  });

  test('optional + tier=none → 拒绝', () => {
    const ai = mkEngine({ preset: presetWithHooks(), aiTier: 'none' });
    expect(ai.shouldCallAI('sceneArrival')).toBe(false);
    expect(ai.shouldCallAI('eventResolve')).toBe(false);
    expect(ai.shouldCallAI('npcDialogue')).toBe(false);
  });

  test('optional + tier=advanced → 全开', () => {
    const ai = mkEngine({ preset: presetWithHooks(), aiTier: 'advanced' });
    expect(ai.shouldCallAI('sceneArrival')).toBe(true);
    expect(ai.shouldCallAI('eventResolve')).toBe(true);
    expect(ai.shouldCallAI('npcDialogue')).toBe(true);
  });

  test('optional + tier=light + firstVisit → 仅首访 sceneArrival 开', () => {
    const ai = mkEngine({ preset: presetWithHooks(), aiTier: 'light' });
    expect(ai.shouldCallAI('sceneArrival', { firstVisit: true })).toBe(true);
    expect(ai.shouldCallAI('sceneArrival', { firstVisit: false })).toBe(false);
  });

  test('optional + tier=light + main 事件才调 eventResolve', () => {
    const ai = mkEngine({ preset: presetWithHooks(), aiTier: 'light' });
    expect(ai.shouldCallAI('eventResolve', { importance: 'main' })).toBe(true);
    expect(ai.shouldCallAI('eventResolve', { importance: 'side' })).toBe(false);
  });

  test('optional + tier=light + npc 首遇才调', () => {
    const ai = mkEngine({ preset: presetWithHooks(), aiTier: 'light' });
    expect(ai.shouldCallAI('npcDialogue', { firstMeet: true })).toBe(true);
    expect(ai.shouldCallAI('npcDialogue', { firstMeet: false })).toBe(false);
  });

  test('vignette 默认 preset 是 never，不论 tier 都拒绝', () => {
    const ai = mkEngine({ preset: presetWithHooks(), aiTier: 'advanced' });
    expect(ai.shouldCallAI('vignette')).toBe(false);
  });

  test('vignette 设为 always 时 advanced tier 允许', () => {
    const ai = mkEngine({ preset: presetWithHooks({ vignette: 'always' }), aiTier: 'advanced' });
    expect(ai.shouldCallAI('vignette', { firstVisit: true })).toBe(true);
  });

  test('没有 preset 时默认调（保持向后兼容）', () => {
    const ai = mkEngine({ preset: null });
    expect(ai.shouldCallAI('sceneArrival')).toBe(true);
  });
});

describe('AIGMEngine._hookNameForAction', () => {
  test('narrate_scene_arrival → sceneArrival hook + firstVisit option', () => {
    const ai = new AIGMEngine();
    const r = ai._hookNameForAction('narrate_scene_arrival', { firstVisit: true }, {});
    expect(r).toEqual({ name: 'sceneArrival', options: { firstVisit: true } });
  });

  test('narrate_event 主线 → eventResolve + importance=main', () => {
    const ai = new AIGMEngine();
    const r = ai._hookNameForAction('narrate_event', { event: { tags: ['main'] } }, {});
    expect(r.name).toBe('eventResolve');
    expect(r.options.importance).toBe('main');
  });

  test('narrate_event 支线 → importance=side', () => {
    const ai = new AIGMEngine();
    const r = ai._hookNameForAction('narrate_event', { event: { tags: ['side'] } }, {});
    expect(r.options.importance).toBe('side');
  });

  test('narrate_combat 不走 hook gate（返回 null）', () => {
    const ai = new AIGMEngine();
    expect(ai._hookNameForAction('narrate_combat', {}, {})).toBe(null);
  });
});
