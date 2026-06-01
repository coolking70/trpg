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
        model: 'test-model',
        choices: [{ message: { content: '{"ok":true,"message":"pong"}' } }],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      }),
    });

    const result = await ai.testAPIConnection({
      endpoint: 'https://example.test/v1/',
      apiKey: 'test-key',
      model: 'test-model',
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(true);
    expect(result.model).toBe('test-model');
    expect(result.usage.total_tokens).toBe(12);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
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
      model: 'test-model',
    })).rejects.toThrow('API 测试失败 (401)');
  });

  test('本地 OpenAI 兼容端点可不填 API 密钥，并自动补 /v1', async () => {
    const ai = new AIGMEngine();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'qwen/qwen3.6-35b-a3b',
        choices: [{ message: { content: '{"ok":true,"message":"pong"}' } }],
        usage: { total_tokens: 10 },
      }),
    });

    const result = await ai.testAPIConnection({
      endpoint: 'http://127.0.0.1:1234',
      apiKey: '',
      model: 'qwen/qwen3.6-35b-a3b',
    });

    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
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

describe('AIGMEngine narrate_* 不重复应用 AI 的状态变更 actions（Phase 28 修复）', () => {
  afterEach(() => jest.restoreAllMocks());

  function mkGameState() {
    return {
      mapState: { playerPosition: { x: 0, y: 0 } },
      activeCharacters: [{ id: 'pc', name: '主角', inventory: ['item_iron_sword'], stats: { hp: 100, hpCurrent: 100 } }],
      variables: {},
      addNarrative: jest.fn(),
    };
  }

  test('narrate_event：AI 回的 add_item 被忽略（预设 effect 才权威，避免重复加物品）', async () => {
    const ai = new AIGMEngine();
    ai.setAPIConfig({ endpoint: 'https://example.test/v1', apiKey: 'ok', model: 'm' });
    ai._cachedSystemPrompt = 'system';
    // AI 响应里"好心"回了一个 add_item（呼应 outcomeText 给一枚太阳坠）
    ai._callAIOnce = jest.fn().mockResolvedValue(JSON.stringify({
      narrative: '祭司将太阳坠交到你手中。',
      actions: [{ type: 'add_item', itemId: 'item_pendant_sun' }],
      diceRequests: [],
    }));
    const gs = mkGameState();

    await ai.processGameAction('narrate_event', { event: { id: 'ev_temple', name: '祭司的指引' }, outcomeText: '给你一枚太阳坠' }, gs);

    // narrate_event 不应让 AI 的 add_item 落地（预设 outcome.effects 已经加过了）
    expect(gs.activeCharacters[0].inventory).toEqual(['item_iron_sword']);
  });

  test('narrate_scene_arrival / narrate_combat 同样忽略 AI 的状态变更', async () => {
    const ai = new AIGMEngine();
    ai.setAPIConfig({ endpoint: 'https://example.test/v1', apiKey: 'ok', model: 'm' });
    ai._cachedSystemPrompt = 'system';
    ai._callAIOnce = jest.fn().mockResolvedValue(JSON.stringify({
      narrative: '你抵达了新场景。',
      actions: [{ type: 'add_item', itemId: 'item_gold' }, { type: 'set_variable', name: 'cheat', value: true }],
      diceRequests: [],
    }));
    const gs = mkGameState();

    await ai.processGameAction('narrate_scene_arrival', { toScene: { id: 's', name: '场景' } }, gs);

    expect(gs.activeCharacters[0].inventory).toEqual(['item_iron_sword']);
    expect(gs.variables.cheat).toBeUndefined();
  });

  test('player_action（自由输入）仍允许 AI 的 actions 落地（AI 担任裁决者）', async () => {
    const ai = new AIGMEngine();
    ai.setAPIConfig({ endpoint: 'https://example.test/v1', apiKey: 'ok', model: 'm' });
    ai._cachedSystemPrompt = 'system';
    ai._callAIOnce = jest.fn().mockResolvedValue(JSON.stringify({
      narrative: '你从尸体上搜到一枚金币。',
      actions: [{ type: 'add_item', itemId: 'item_gold' }],
      diceRequests: [],
    }));
    const gs = mkGameState();

    await ai.processGameAction('player_action', { text: '搜索尸体', moved: false }, gs);

    expect(gs.activeCharacters[0].inventory).toContain('item_gold');
  });
});

describe('AIGMEngine prompt context', () => {
  test('把本地权威状态和检索上下文注入 system 消息，当前 user 消息保持最后', () => {
    const ai = new AIGMEngine();
    ai._cachedSystemPrompt = 'system prompt';
    const messages = ai._buildMessages('玩家行动: 观察石门', {
      localStateDigest: '当前场景:遗迹之门(scene_ruin_gate)\n关键变量:opened_gate=true',
      retrievedContext: '【当前场景】遗迹之门: 布满藤蔓的巨大石门',
      memoryView: {
        worldFacts: ['世界：艾尔大陆'],
        keyEvents: ['用护身符开启了遗迹之门'],
      },
    });

    expect(messages[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(messages.some(m => m.role === 'system' && m.content.includes('【本地权威状态】'))).toBe(true);
    expect(messages.some(m => m.role === 'system' && m.content.includes('【当前局面检索】'))).toBe(true);
    expect(messages.some(m => m.role === 'system' && m.content.includes('用护身符开启了遗迹之门'))).toBe(true);
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: '玩家行动: 观察石门' });
  });

  test('上下文压缩后保留的短期历史从 user 开始，兼容本地 chat template', () => {
    const ai = new AIGMEngine();
    ai.contextWindow = [
      { role: 'assistant', content: '{"narrative":"旧叙事1"}' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: '{"narrative":"a1"}' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: '{"narrative":"a2"}' },
      { role: 'user', content: 'u3' },
      { role: 'assistant', content: '{"narrative":"a3"}' },
      { role: 'user', content: 'u4' },
    ];

    ai._compressContext();

    expect(ai.contextWindow[0].role).toBe('user');
    expect(ai.summarizedHistory).toContain('旧叙事1');
  });
});

describe('AIGMEngine 复读缓解 _buildAntiRepetitionHint（Phase 29）', () => {
  test('无叙事历史时返回 null', () => {
    const ai = new AIGMEngine();
    expect(ai._buildAntiRepetitionHint({ narrativeLog: [] })).toBeNull();
    expect(ai._buildAntiRepetitionHint({})).toBeNull();
    expect(ai._buildAntiRepetitionHint(null)).toBeNull();
  });

  test('提取最近 GM 叙述并要求换说法', () => {
    const ai = new AIGMEngine();
    const gs = { narrativeLog: [
      { speaker: 'player', text: '走向北门' },
      { speaker: 'gm', text: '你点头，握紧剑柄，目光投向深处的密林。' },
    ] };
    const hint = ai._buildAntiRepetitionHint(gs);
    expect(hint).toContain('避免复读');
    expect(hint).toContain('握紧剑柄');
    expect(hint).toContain('伙伴');
  });

  test('检出跨多条叙述的高频复读短语', () => {
    const ai = new AIGMEngine();
    const gs = { narrativeLog: [
      { speaker: 'gm', text: '芬恩低声说这地方安静得有些诡异要小心' },
      { speaker: 'gm', text: '穿过矿道芬恩又说这地方安静得有些诡异要小心' },
      { speaker: 'gm', text: '深入之后这地方安静得有些诡异的感觉更重了' },
    ] };
    const hint = ai._buildAntiRepetitionHint(gs);
    expect(hint).toContain('禁止再用');
    expect(hint).toContain('这地方安静');
  });

  test('只统计 GM 说话方，忽略 player/system', () => {
    const ai = new AIGMEngine();
    const gs = { narrativeLog: [
      { speaker: 'player', text: '重复台词重复台词重复台词' },
      { speaker: 'system', text: '重复台词重复台词重复台词' },
    ] };
    expect(ai._buildAntiRepetitionHint(gs)).toBeNull();
  });
});

describe('AIGMEngine Responses-API 适配（hy3-preview 等 /responses 端点）', () => {
  test('_useResponsesApi: 显式 apiStyle 优先，否则按 endpoint 探测', () => {
    const ai = new AIGMEngine();
    ai.apiConfig.apiStyle = 'responses';
    expect(ai._useResponsesApi('https://x/v1')).toBe(true);
    ai.apiConfig.apiStyle = 'chat';
    expect(ai._useResponsesApi('https://x/v1/responses')).toBe(false);
    ai.apiConfig.apiStyle = undefined;
    expect(ai._useResponsesApi('https://x/v1/responses')).toBe(true);
    expect(ai._useResponsesApi('https://x/v1')).toBe(false);
  });

  test('_messagesToResponsesInput: system→instructions，单条 user→input 原文', () => {
    const ai = new AIGMEngine();
    const r = ai._messagesToResponsesInput([
      { role: 'system', content: '你是GM' },
      { role: 'system', content: '本地权威状态：HP100' },
      { role: 'user', content: '玩家推门' },
    ]);
    expect(r.instructions).toContain('你是GM');
    expect(r.instructions).toContain('本地权威状态');
    expect(r.input).toBe('玩家推门');
  });

  test('_messagesToResponsesInput: 多轮对话→转录文本', () => {
    const ai = new AIGMEngine();
    const r = ai._messagesToResponsesInput([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
    ]);
    expect(r.input).toContain('玩家: u1');
    expect(r.input).toContain('GM: a1');
    expect(r.input).toContain('玩家: u2');
  });

  test('_extractResponsesText: 解析 output[].content[].text（hy3 实际结构）', () => {
    const ai = new AIGMEngine();
    const data = { output: [{ type: 'message', content: [{ type: 'output_text', text: '厚重的石门缓缓开启。' }] }] };
    expect(ai._extractResponsesText(data)).toBe('厚重的石门缓缓开启。');
  });

  test('_extractResponsesText: 优先 output_text，兜底兼容 chat 结构', () => {
    const ai = new AIGMEngine();
    expect(ai._extractResponsesText({ output_text: '直接文本' })).toBe('直接文本');
    expect(ai._extractResponsesText({ choices: [{ message: { content: 'chat兜底' } }] })).toBe('chat兜底');
    expect(ai._extractResponsesText({})).toBe('');
  });
});
