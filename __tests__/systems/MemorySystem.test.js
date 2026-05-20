/**
 * MemorySystem 单元测试
 * 覆盖：初始化、添加事件、容量归档、视图查询
 */

import { MemorySystem } from '../../src/systems/MemorySystem.js';

function makeGameState() {
  return { aiContext: {} };
}

describe('MemorySystem', () => {
  let mem;

  beforeEach(() => {
    mem = new MemorySystem();
  });

  describe('initializeFromPreset', () => {
    test('从 lore 导入世界、背景、规则、风格', () => {
      const gs = makeGameState();
      mem.initializeFromPreset(gs, {
        lore: {
          worldName: '艾尔大陆',
          era: '黑暗纪元',
          background: '森林被诅咒...',
          rules: 'D20 骰子',
          gmStyle: '氛围浓厚',
        },
      });
      expect(gs.aiContext.worldFacts.some(f => f.includes('艾尔大陆'))).toBe(true);
      expect(gs.aiContext.worldFacts.some(f => f.includes('森林'))).toBe(true);
      expect(gs.aiContext.worldFacts.some(f => f.includes('D20'))).toBe(true);
    });

    test('队伍成员加入 worldFacts', () => {
      const gs = makeGameState();
      mem.initializeFromPreset(gs, {
        characters: [
          { name: '艾拉', title: '圣骑士' },
          { name: '雷恩', title: '游侠' },
        ],
      });
      expect(gs.aiContext.worldFacts.some(f => f.includes('艾拉') && f.includes('雷恩'))).toBe(true);
    });

    test('去重相同 fact', () => {
      const gs = makeGameState();
      mem.initializeFromPreset(gs, { lore: { worldName: 'X' } });
      mem.initializeFromPreset(gs, { lore: { worldName: 'X' } });
      const matches = gs.aiContext.worldFacts.filter(f => f.includes('世界：X'));
      expect(matches.length).toBe(1);
    });
  });

  describe('addKeyEvent', () => {
    test('正常添加', () => {
      const gs = makeGameState();
      mem.addKeyEvent(gs, { summary: '击败暗影狼', tags: ['combat'] });
      expect(gs.aiContext.keyEvents).toHaveLength(1);
      expect(gs.aiContext.keyEvents[0].summary).toBe('击败暗影狼');
      expect(gs.aiContext.keyEvents[0].ts).toBeDefined();
    });

    test('缺 summary 不添加', () => {
      const gs = makeGameState();
      mem.addKeyEvent(gs, {});
      expect(gs.aiContext.keyEvents).toHaveLength(0);
    });

    test('超长摘要被截断', () => {
      const gs = makeGameState();
      mem.addKeyEvent(gs, { summary: 'X'.repeat(500) });
      expect(gs.aiContext.keyEvents[0].summary.length).toBeLessThanOrEqual(120);
    });

    test('tags 最多保留 4 个', () => {
      const gs = makeGameState();
      mem.addKeyEvent(gs, { summary: 'x', tags: ['a', 'b', 'c', 'd', 'e', 'f'] });
      expect(gs.aiContext.keyEvents[0].tags).toHaveLength(4);
    });
  });

  describe('容量归档', () => {
    test('超过 20 条时归档最早 5 条到 worldFacts', () => {
      const gs = makeGameState();
      for (let i = 1; i <= 22; i++) {
        mem.addKeyEvent(gs, { summary: `事件 ${i}` });
      }
      // 22 - 5 = 17 ? Actually after 21st add, size > 20 → splice 5 → size 16. After 22nd add, size 17.
      expect(gs.aiContext.keyEvents.length).toBe(17);
      // 归档应包含前 5 条
      expect(gs.aiContext.worldFacts.some(f => f.startsWith('早期事件') && f.includes('事件 1'))).toBe(true);
      // 当前 keyEvents 应从第 6 条开始
      expect(gs.aiContext.keyEvents[0].summary).toBe('事件 6');
    });
  });

  describe('getMemoryView', () => {
    test('返回浅副本', () => {
      const gs = makeGameState();
      mem.addWorldFact(gs, 'fact 1');
      mem.addKeyEvent(gs, { summary: 'event 1' });
      const view = mem.getMemoryView(gs);
      expect(view.worldFacts).toEqual(['fact 1']);
      expect(view.keyEvents).toEqual(['event 1']);
      // 修改 view 不影响原状态
      view.worldFacts.push('hacked');
      expect(gs.aiContext.worldFacts).toHaveLength(1);
    });

    test('旧存档自动迁移：缺字段时初始化', () => {
      const gs = { aiContext: { recentMessages: [] } };  // 无 worldFacts/keyEvents
      const view = mem.getMemoryView(gs);
      expect(view.worldFacts).toEqual([]);
      expect(view.keyEvents).toEqual([]);
    });
  });

  describe('reset', () => {
    test('清空所有记忆', () => {
      const gs = makeGameState();
      mem.addWorldFact(gs, 'x');
      mem.addKeyEvent(gs, { summary: 'y' });
      mem.reset(gs);
      expect(gs.aiContext.worldFacts).toEqual([]);
      expect(gs.aiContext.keyEvents).toEqual([]);
    });
  });
});
