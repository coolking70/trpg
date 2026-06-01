/**
 * AIGMEngine.shouldCallAI 单元测试（Phase 26B — AI Hooks gate）
 */

import { AIGMEngine } from '../../src/systems/AIGMEngine.js';
import { CardManager } from '../../src/systems/CardManager.js';
import { SceneSystem } from '../../src/systems/SceneSystem.js';

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

describe('AIGMEngine AI 参与度（权限）门', () => {
  afterEach(() => jest.restoreAllMocks());

  function mkAI(actions) {
    const ai = new AIGMEngine();
    ai.setAPIConfig({ endpoint: 'https://example.test/v1', apiKey: 'ok', model: 'm' });
    ai._cachedSystemPrompt = 'system';
    ai._callAIOnce = jest.fn().mockResolvedValue(JSON.stringify({ narrative: '裁决。', actions, diceRequests: [] }));
    return ai;
  }
  function gsAt(level) {
    return {
      aiAuthority: level,
      mapState: { playerPosition: { x: 0, y: 0 } },
      activeCharacters: [{ id: 'pc', name: '主角', inventory: ['item_iron_sword'], stats: { hp: 100, hpCurrent: 100 } }],
      variables: {},
      addNarrative: jest.fn(),
    };
  }

  test('L0 旁白：player_action 自由输入的 add_item 被拦（婉拒，不落地）', async () => {
    const ai = mkAI([{ type: 'add_item', itemId: 'item_gold' }]);
    const gs = gsAt(0);
    await ai.processGameAction('player_action', { text: '凭空变出金币' }, gs);
    expect(gs.activeCharacters[0].inventory).toEqual(['item_iron_sword']);
  });

  test('L2 裁决：add_item 放行，但 start_combat（需 L3）被拦', async () => {
    const ai = mkAI([{ type: 'add_item', itemId: 'item_gold' }, { type: 'start_combat', enemyIds: ['e1'] }]);
    const gs = gsAt(2);
    await ai.processGameAction('player_action', { text: '搜索并挑衅' }, gs);
    expect(gs.activeCharacters[0].inventory).toContain('item_gold'); // L2 放行
    // start_combat 需 L3，被拦 → 不应进入战斗（无 activeCombat 字段被设）
    expect(gs.activeCombat).toBeUndefined();
  });

  test('L3 编剧：start_combat 放行', async () => {
    const ai = mkAI([{ type: 'start_combat', enemyIds: ['e1'] }]);
    const gs = gsAt(3);
    const spy = jest.spyOn(ai.responseParser, 'applyActions');
    await ai.processGameAction('player_action', { text: '挑衅守卫' }, gs);
    // applyActions 收到了 start_combat（放行）
    const passed = spy.mock.calls.flatMap(c => c[0]).map(a => a.type);
    expect(passed).toContain('start_combat');
  });

  test('L3 编剧：narrate_event 里 AI 注入的 set_variable 现在会落地（叙述也可改状态）', async () => {
    const ai = mkAI([{ type: 'set_variable', target: 'omen_seen', value: true }]);
    const gs = gsAt(3);
    await ai.processGameAction('narrate_event', { event: { id: 'ev', name: '异象' } }, gs);
    expect(gs.variables.omen_seen).toBe(true);
  });

  test('L2 默认档：narrate_event 里 AI 的 set_variable 仍不落地（保留重复落地修复）', async () => {
    const ai = mkAI([{ type: 'set_variable', target: 'cheat', value: true }]);
    const gs = gsAt(2);
    await ai.processGameAction('narrate_event', { event: { id: 'ev', name: '事件' } }, gs);
    expect(gs.variables.cheat).toBeUndefined();
  });

  test('权限说明被注入 system 消息', () => {
    const ai = new AIGMEngine();
    ai._cachedSystemPrompt = 'sys';
    const msgs = ai._buildMessages('当前消息', { authorityHint: '【你的 GM 权限】当前：L0 旁白。' });
    expect(msgs.some(m => m.role === 'system' && m.content.includes('L0 旁白'))).toBe(true);
  });
});

describe('AIGMEngine L3 编剧引擎动作', () => {
  afterEach(() => jest.restoreAllMocks());

  function mkAIEngine(actions, systems) {
    const ai = new AIGMEngine();
    ai.setAPIConfig({ endpoint: 'https://example.test/v1', apiKey: 'ok', model: 'm' });
    ai._cachedSystemPrompt = 'sys';
    ai._callAIOnce = jest.fn().mockResolvedValue(JSON.stringify({ narrative: '编剧。', actions, diceRequests: [] }));
    ai.gameEngine = { getSystem: (n) => systems[n] };
    return ai;
  }
  function gs(level) {
    return {
      aiAuthority: level, mapState: { playerPosition: { x: 0, y: 0 } },
      activeCharacters: [{ id: 'pc', name: '主角', inventory: [], stats: { hp: 100, hpCurrent: 100 } }],
      variables: {}, addNarrative: jest.fn(),
    };
  }

  test('L3 spawn_event：注入事件到 CardManager 并设为 activeEvent', async () => {
    const cm = new CardManager();
    const ai = mkAIEngine([{ type: 'spawn_event', event: { name: '塌方', description: '巨石封住去路。', choices: [{ text: '搬开', effects: [] }] } }], { CardManager: cm });
    const state = gs(3);
    await ai.processGameAction('player_action', { text: '继续前进' }, state);
    const card = cm.getCard('ev_ai_spawn_1');
    expect(card).toBeTruthy();
    expect(card.name).toBe('塌方');
    expect(state.activeEvent?.id).toBe('ev_ai_spawn_1');
  });

  test('L3 spawn_event：选项里的 L4 effect 被剥离（防越权夹带），L2 effect 保留', async () => {
    const cm = new CardManager();
    const ai = mkAIEngine([{
      type: 'spawn_event',
      event: { name: '裂隙', description: '虚空裂开。', choices: [{ text: '凝视', effects: [{ type: 'set_variable', target: 'gazed', value: true }, { type: 'author_ending', endingId: 'x' }] }] },
    }], { CardManager: cm });
    await ai.processGameAction('player_action', { text: 'x' }, gs(3));
    const effs = cm.getCard('ev_ai_spawn_1').choices[0].outcomes[0].effects.map(e => e.type);
    expect(effs).toContain('set_variable');   // L2 保留
    expect(effs).not.toContain('author_ending'); // L4 剥离
  });

  test('L2 时 spawn_event 被权限门拦截（不注入）', async () => {
    const cm = new CardManager();
    const ai = mkAIEngine([{ type: 'spawn_event', event: { name: 'x', description: 'y' } }], { CardManager: cm });
    const state = gs(2);
    await ai.processGameAction('player_action', { text: 'x' }, state);
    expect(cm.getCard('ev_ai_spawn_1')).toBeUndefined();
    expect(state.activeEvent).toBeFalsy();
  });

  test('L3 scale_difficulty → DifficultyTracker.setManualBias', async () => {
    const tracker = { setManualBias: jest.fn(() => 0.2) };
    const ai = mkAIEngine([{ type: 'scale_difficulty', delta: 0.2 }], { DifficultyTracker: tracker });
    await ai.processGameAction('player_action', { text: 'x' }, gs(3));
    expect(tracker.setManualBias).toHaveBeenCalledWith(0.2);
  });

  test('L3 recruit_companion → NPCSystem.recruitCompanion + 入队', async () => {
    const ns = {
      recruitCompanion: jest.fn(() => true),
      getNPC: jest.fn(() => ({ id: 'npc_a', name: '同伴A', stats: { hp: 50, mp: 10 } })),
    };
    const ai = mkAIEngine([{ type: 'recruit_companion', npcId: 'npc_a' }], { NPCSystem: ns });
    const state = gs(3);
    await ai.processGameAction('player_action', { text: '邀请' }, state);
    expect(ns.recruitCompanion).toHaveBeenCalledWith(state, 'npc_a');
    expect(state.activeCharacters.some(c => c.id === 'npc_a')).toBe(true);
  });
});

describe('AIGMEngine L4 创世（世界改写 + 护栏）', () => {
  afterEach(() => jest.restoreAllMocks());

  function mkScenes() {
    const ss = new SceneSystem();
    ss.loadFromPreset({ scenes: [
      { id: 'A', name: '入口', description: '旧描述', connections: [{ to: 'B', label: '前往B' }] },
      { id: 'B', name: '中庭', description: 'B', connections: [{ to: 'A', label: '回A' }] },
      { id: 'C', name: '密室', description: 'C', connections: [] },
    ] });
    return ss;
  }
  function mkAIW(actions, systems) {
    const ai = new AIGMEngine();
    ai.setAPIConfig({ endpoint: 'https://example.test/v1', apiKey: 'ok', model: 'm' });
    ai._cachedSystemPrompt = 'sys';
    ai._callAIOnce = jest.fn().mockResolvedValue(JSON.stringify({ narrative: '创世。', actions, diceRequests: [] }));
    ai.gameEngine = { getSystem: (n) => systems[n] };
    return ai;
  }
  function gsW(level, current = 'A') {
    return {
      aiAuthority: level, mapState: { currentSceneId: current, playerPosition: { x: 0, y: 0 } },
      activeCharacters: [{ id: 'pc', name: '主角', inventory: [], stats: { hp: 100, hpCurrent: 100 } }],
      variables: {}, addNarrative: jest.fn(),
    };
  }

  test('L4 rewrite_scene 改写场景描述 + 记录审计 + 可撤销', async () => {
    const ss = mkScenes();
    const ai = mkAIW([{ type: 'rewrite_scene', sceneId: 'A', description: '崭新的描述' }], { SceneSystem: ss });
    const state = gsW(4);
    await ai.processGameAction('player_action', { text: '改写此地' }, state);
    expect(ss.getScene('A').description).toBe('崭新的描述');
    expect(state._aiAuthorityLog.some(e => e.type === 'rewrite_scene')).toBe(true);
    // 撤销
    ai.undoLastRewrite(state);
    expect(ss.getScene('A').description).toBe('旧描述');
  });

  test('L4 edit_connection 新增连接', async () => {
    const ss = mkScenes();
    const ai = mkAIW([{ type: 'edit_connection', op: 'add', from: 'A', to: 'C', label: '暗门' }], { SceneSystem: ss });
    await ai.processGameAction('player_action', { text: '开暗门' }, gsW(4));
    expect(ss.getScene('A').connections.some(c => c.to === 'C')).toBe(true);
  });

  test('L4 edit_connection 移除会令场景不可达 → 护栏拦截', async () => {
    const ss = mkScenes();
    // 玩家在 A，A→B 是唯一通往 B 的边；移除会让 B 不可达
    const ai = mkAIW([{ type: 'edit_connection', op: 'remove', from: 'A', to: 'B' }], { SceneSystem: ss });
    await ai.processGameAction('player_action', { text: '封路' }, gsW(4, 'A'));
    expect(ss.getScene('A').connections.some(c => c.to === 'B')).toBe(true); // 仍在（被拦）
  });

  test('L4 author_ending 注入结局事件（tag=ending）', async () => {
    const ss = mkScenes();
    const cm = new CardManager();
    const ai = mkAIW([{ type: 'author_ending', name: '灰烬结局', description: '一切归于灰烬。', sceneId: 'C' }], { SceneSystem: ss, CardManager: cm });
    await ai.processGameAction('player_action', { text: '写下结局' }, gsW(4));
    const ending = cm.getCardsByType('event').find(e => (e.tags || []).includes('ending') && e.name === '灰烬结局');
    expect(ending).toBeTruthy();
  });

  test('L4 kill_npc 对主角 → 硬禁项拦截', async () => {
    const ns = { applyNPCDeath: jest.fn() };
    const ai = mkAIW([{ type: 'kill_npc', npcId: 'pc' }], { NPCSystem: ns });
    await ai.processGameAction('player_action', { text: '弑主角' }, gsW(4));
    expect(ns.applyNPCDeath).not.toHaveBeenCalled();
  });

  test('L3 时 rewrite_scene 被权限门拦截（需 L4）', async () => {
    const ss = mkScenes();
    const ai = mkAIW([{ type: 'rewrite_scene', sceneId: 'A', description: 'x' }], { SceneSystem: ss });
    await ai.processGameAction('player_action', { text: 'x' }, gsW(3));
    expect(ss.getScene('A').description).toBe('旧描述'); // 未改
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
