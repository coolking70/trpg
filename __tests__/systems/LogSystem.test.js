/**
 * LogSystem 测试：日志收集 / 报告生成 / Markdown / Console 拦截
 */

import { LogSystem } from '../../src/systems/LogSystem.js';

function makeGameState() {
  return {
    turnNumber: 5,
    currentPhase: 'exploration',
    gold: 250,
    mapState: { playerPosition: { x: 3, y: 7 } },
    completedEventIds: ['ch1', 'ch2'],
    variables: { quest: true },
    activeCharacters: [
      { id: 'c1', name: '艾拉', level: 3, experience: 50,
        stats: { hp: 120, hpCurrent: 100, mp: 40, mpCurrent: 30 },
        inventory: ['item_009'], equipment: { weapon: 'sword' }, statusEffects: [] },
    ],
    activeCombat: null,
    activeEvent: null,
    narrativeLog: [
      { speaker: 'gm', text: '一段叙事', timestamp: '2026-05-21T10:00:00Z' },
      { speaker: 'player', text: '我环顾四周', timestamp: '2026-05-21T10:01:00Z' },
    ],
    diceHistory: [
      { formula: 'd20', total: 18, target: 15, success: true, reason: '说服' },
    ],
    aiContext: {
      worldFacts: ['世界：艾尔大陆', '队伍：艾拉'],
      keyEvents: [{ summary: '接受任务' }, { summary: '获得护身符' }],
    },
  };
}

describe('LogSystem - 基础', () => {
  let ls;
  beforeEach(() => { ls = new LogSystem(); });
  afterEach(() => { ls.uninstallConsoleIntercept(); });

  test('初始 errorLog 为空', () => {
    expect(ls.errorLog).toEqual([]);
  });

  test('clearErrorLog 清空', () => {
    ls._appendError({ level: 'error', ts: 't', message: 'm' });
    ls.clearErrorLog();
    expect(ls.errorLog).toEqual([]);
  });

  test('环形缓冲超限丢弃最早', () => {
    for (let i = 0; i < 150; i++) {
      ls._appendError({ level: 'warn', ts: 't', message: `msg${i}` });
    }
    expect(ls.errorLog.length).toBe(100);
    expect(ls.errorLog[0].message).toBe('msg50');  // 前 50 被丢
    expect(ls.errorLog[99].message).toBe('msg149');
  });
});

describe('LogSystem - Console 拦截', () => {
  let ls, origWarn, origErr;
  beforeEach(() => {
    origWarn = console.warn;
    origErr = console.error;
    ls = new LogSystem();
  });
  afterEach(() => {
    ls.uninstallConsoleIntercept();
    console.warn = origWarn;
    console.error = origErr;
  });

  test('initialize 后拦截 console.warn 和 console.error', () => {
    // 静默掉原始 console，避免污染输出
    console.warn = jest.fn();
    console.error = jest.fn();
    ls.initialize({ getSystem: () => null });

    console.warn('warn message');
    console.error('error message');

    expect(ls.errorLog.length).toBe(2);
    expect(ls.errorLog[0].level).toBe('warn');
    expect(ls.errorLog[0].message).toContain('warn message');
    expect(ls.errorLog[1].level).toBe('error');
  });

  test('原始 console 仍被调用（不破坏开发体验）', () => {
    const warnSpy = jest.fn();
    console.warn = warnSpy;
    console.error = jest.fn();
    ls.initialize({ getSystem: () => null });

    console.warn('test');
    expect(warnSpy).toHaveBeenCalledWith('test');
  });

  test('uninstallConsoleIntercept 恢复原 console', () => {
    const origRealWarn = console.warn;
    ls.initialize({ getSystem: () => null });
    expect(console.warn).not.toBe(origRealWarn);
    ls.uninstallConsoleIntercept();
    expect(console.warn).toBe(origRealWarn);
  });

  test('safeStringify 处理对象/Error', () => {
    console.warn = jest.fn();
    console.error = jest.fn();
    ls.initialize({ getSystem: () => null });

    console.warn({ x: 1 });
    console.error(new Error('boom'));
    console.warn(null);
    console.warn(undefined);

    expect(ls.errorLog[0].message).toContain('"x":1');
    expect(ls.errorLog[1].message).toContain('boom');
    expect(ls.errorLog[2].message).toContain('null');
    expect(ls.errorLog[3].message).toContain('undefined');
  });
});

describe('LogSystem - generateReport', () => {
  let ls;
  beforeEach(() => {
    ls = new LogSystem();
    ls.gameEngine = { getSystem: (n) => null };
  });

  test('返回完整结构', () => {
    const r = ls.generateReport(makeGameState());
    expect(r.meta).toBeDefined();
    expect(r.meta.generatedAt).toBeTruthy();
    expect(r.meta.version).toBe('1.0.0');
    expect(r.gameState).toBeDefined();
    expect(r.narrativeLog).toHaveLength(2);
    expect(r.diceHistory).toHaveLength(1);
    expect(r.aiContext.worldFacts).toHaveLength(2);
  });

  test('gameState 字段被精简（不含完整 enemies array 等）', () => {
    const gs = makeGameState();
    gs.activeCombat = {
      round: 2, currentActorIndex: 1,
      enemies: [{ id: 'e1', name: '狼', stats: { hp: 50, hpCurrent: 20 } }],
      turnOrder: [{ id: 'c1', name: '艾拉', type: 'character' }],
      log: [{ x: 1 }, { x: 2 }, { x: 3 }],
    };
    const r = ls.generateReport(gs);
    expect(r.gameState.activeCombat.round).toBe(2);
    expect(r.gameState.activeCombat.enemies[0].hpCurrent).toBe(20);
    expect(r.gameState.activeCombat.logEntryCount).toBe(3);
  });

  test('preset 信息正确摘要', () => {
    const preset = {
      presetId: 'p1', name: 'Test', version: '1.0',
      characters: [{ id: 'c1' }, { id: 'c2' }],
      enemies: [{ id: 'e1' }],
      events: [],
      items: [{}, {}, {}],
      map: { width: 20, height: 15 },
    };
    const r = ls.generateReport(makeGameState(), preset);
    expect(r.preset.name).toBe('Test');
    expect(r.preset.characterCount).toBe(2);
    expect(r.preset.enemyCount).toBe(1);
    expect(r.preset.itemCount).toBe(3);
    expect(r.preset.mapSize).toBe('20×15');
  });

  test('null gameState 安全处理', () => {
    const r = ls.generateReport(null);
    expect(r.gameState).toBeNull();
    expect(r.narrativeLog).toEqual([]);
  });

  test('包含错误日志', () => {
    ls._appendError({ level: 'error', ts: 't', message: 'oops' });
    const r = ls.generateReport(makeGameState());
    expect(r.errorLog).toHaveLength(1);
    expect(r.errorLog[0].message).toBe('oops');
  });

  test('tokenStats 来自 AIGMEngine', () => {
    ls.gameEngine = {
      getSystem: (name) => name === 'AIGMEngine' ? {
        getTokenStats: () => ({ totalCalls: 5, totalTokens: 6000 }),
      } : null,
    };
    const r = ls.generateReport(makeGameState());
    expect(r.tokenStats.totalCalls).toBe(5);
  });
});

describe('LogSystem - generateMarkdown', () => {
  let ls;
  beforeEach(() => {
    ls = new LogSystem();
    ls.gameEngine = { getSystem: () => null };
  });

  test('生成 Markdown 字符串', () => {
    const md = ls.generateMarkdown(makeGameState());
    expect(typeof md).toBe('string');
    expect(md).toContain('# TRPG AI 跑团 — 诊断日志');
    expect(md).toContain('## 游戏状态');
    expect(md).toContain('艾拉');  // 角色名应在 ## 角色 部分
  });

  test('叙事日志按格式渲染', () => {
    const md = ls.generateMarkdown(makeGameState());
    expect(md).toContain('**[GM]** 一段叙事');
    expect(md).toContain('**[你]** 我环顾四周');
  });

  test('骰子历史含 DC 显示', () => {
    const md = ls.generateMarkdown(makeGameState());
    expect(md).toContain('`d20`');
    expect(md).toContain('vs DC 15');
    expect(md).toContain('✓');  // 成功标记
  });

  test('World Facts 和 Key Events 都列出', () => {
    const md = ls.generateMarkdown(makeGameState());
    expect(md).toContain('World Facts');
    expect(md).toContain('Key Events');
    expect(md).toContain('艾尔大陆');
    expect(md).toContain('接受任务');
  });

  test('错误日志含代码块', () => {
    ls._appendError({ level: 'error', ts: '2026-05-21T10:00:00Z', message: 'fail' });
    const md = ls.generateMarkdown(makeGameState());
    expect(md).toContain('## 错误日志');
    expect(md).toContain('```');
    expect(md).toContain('[ERROR]');
  });
});

describe('LogSystem - exportToFile', () => {
  let ls, origCreate, origRevoke;
  beforeEach(() => {
    ls = new LogSystem();
    ls.gameEngine = { getSystem: () => null };
    // JSDOM 不内置 URL.createObjectURL，mock 它
    origCreate = URL.createObjectURL;
    origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:fake-url');
    URL.revokeObjectURL = jest.fn();
  });
  afterEach(() => {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  });

  test('JSON 格式：创建 Blob + 触发下载', () => {
    const ok = ls.exportToFile(makeGameState(), 'json');
    expect(ok).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalled();
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toMatch(/application\/json/);
  });

  test('Markdown 格式：mime + ext 正确', () => {
    const ok = ls.exportToFile(makeGameState(), 'markdown');
    expect(ok).toBe(true);
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toMatch(/text\/markdown/);
  });

  test('未知格式默认走 JSON', () => {
    const ok = ls.exportToFile(makeGameState(), 'unknown-fmt');
    expect(ok).toBe(true);
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toMatch(/application\/json/);
  });
});
