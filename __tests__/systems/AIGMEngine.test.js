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

describe('AIGMEngine.testAPIConnection', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('发送最小 chat/completions 探测并返回成功信息', async () => {
    const ai = new AIGMEngine();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'mimo-v2.5',
        choices: [{ message: { content: '{"ok":true,"message":"pong"}' } }],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      }),
    });

    const result = await ai.testAPIConnection({
      endpoint: 'https://token-plan-cn.xiaomimimo.com/v1/',
      apiKey: 'test-key',
      model: 'mimo-v2.5',
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(true);
    expect(result.model).toBe('mimo-v2.5');
    expect(result.usage.total_tokens).toBe(12);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('HTTP 错误会返回可读错误', async () => {
    const ai = new AIGMEngine();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"bad key"}',
    });

    await expect(ai.testAPIConnection({
      endpoint: 'https://example.test/v1',
      apiKey: 'bad-key',
      model: 'mimo-v2.5',
    })).rejects.toThrow('API 测试失败 (401)');
  });
});

describe('AIGMEngine 空叙事兜底', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('AI 返回空 narrative 时写入本地兜底，避免界面无反馈', async () => {
    const ai = new AIGMEngine();
    ai.setAPIConfig({ endpoint: 'https://example.test/v1', apiKey: 'ok', model: 'm' });
    ai._cachedSystemPrompt = 'system';
    ai.eventSystem = { publish: jest.fn() };
    ai._callAIOnce = jest.fn().mockResolvedValue('{"narrative":"","actions":[],"diceRequests":[]}');
    const gameState = {
      mapState: { playerPosition: { x: 0, y: 0 } },
      addNarrative: jest.fn(),
    };

    const result = await ai.processGameAction('player_action', { text: '观察四周', moved: false }, gameState);

    expect(result.narrative).toBe('你观察四周。');
    expect(gameState.addNarrative).toHaveBeenCalledWith('gm', '你观察四周。');
    expect(ai.eventSystem.publish).toHaveBeenCalledWith('ai:error', expect.objectContaining({
      error: expect.stringContaining('空叙事'),
    }));
  });
});
