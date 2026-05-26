/**
 * AIResponseParser 单元测试
 * 覆盖：三级 fallback 解析、creativeOutcome 标准化、action 合法性校验
 */

import { AIResponseParser } from '../../src/systems/AIResponseParser.js';

describe('AIResponseParser', () => {
  let parser;

  beforeEach(() => {
    parser = new AIResponseParser();
  });

  describe('parse 三级 fallback', () => {
    test('Level 1: 直接 JSON', () => {
      const r = parser.parse('{"narrative":"hello","actions":[],"diceRequests":[]}');
      expect(r.narrative).toBe('hello');
      expect(r.actions).toEqual([]);
    });

    test('Level 2: markdown code block 包裹', () => {
      const r = parser.parse('```json\n{"narrative":"in block"}\n```');
      expect(r.narrative).toBe('in block');
    });

    test('Level 3: 首尾 brace 提取', () => {
      const r = parser.parse('Some preamble {"narrative":"extracted"} trailing text');
      expect(r.narrative).toBe('extracted');
    });

    test('完全无效返回原文作为 narrative', () => {
      const r = parser.parse('just plain text');
      expect(r.narrative).toBe('just plain text');
      expect(r.actions).toEqual([]);
    });

    test('空字符串返回 fallback', () => {
      const r = parser.parse('');
      expect(r.actions).toEqual([]);
    });

    test('Level 4: narrative 内含未转义引号时宽松抽取（多行格式）', () => {
      // 真实玩测中 AI 偶尔会在 narrative 字段里夹未转义的中文/英文引号导致 JSON.parse 失败
      const broken = `{
  "narrative": ""那位骑士..."村民压低声音，"曾是英雄"。今已迷失。",
  "actions": [],
  "diceRequests": [],
  "stateUpdate": null,
  "creativeOutcome": null
}`;
      const r = parser.parse(broken);
      // 应抽出 narrative 主体（含引号），且 actions 为空数组
      expect(r.narrative).toContain('那位骑士');
      expect(r.narrative).toContain('村民压低声音');
      expect(r.narrative).not.toContain('"actions"');
      expect(r.actions).toEqual([]);
    });

    test('Level 4: 单行 JSON 含未转义引号也能宽松抽取', () => {
      // 来自真实玩测 — single-line 损坏 JSON，narrative 里夹未转义引号
      const broken = `{"narrative":"你们拨开荒草向北，薇拉低语："这水里有腐化气息，别碰。"雷恩观察周围。", "actions":[], "diceRequests":[], "stateUpdate":null, "creativeOutcome":null}`;
      const r = parser.parse(broken);
      expect(r.narrative).toContain('拨开荒草');
      expect(r.narrative).toContain('腐化气息');
      expect(r.narrative).not.toContain('"actions"');
      expect(r.narrative).not.toContain('diceRequests');
      expect(r.actions).toEqual([]);
    });

    test('fallback 防御性清洗：剥掉 JSON 残壳', () => {
      // 当宽松抽取也失败时，至少不应让 UI 显示生 JSON
      // 这里给一个连 narrative 字段都被破坏到无法定位结尾的串
      const broken = `{"narrative":"残破内容`;  // 不完整、无尾巴
      const r = parser.parse(broken);
      expect(r.narrative).not.toContain('"narrative"');
      expect(r.narrative).not.toMatch(/^\{/);
    });
  });

  describe('creativeOutcome 标准化', () => {
    test('合法 creativeOutcome', () => {
      const r = parser.parse(JSON.stringify({
        narrative: '...',
        creativeOutcome: {
          dc: 15, formula: 'd20',
          onSuccess: { narrative: 'ok', actions: [{ type: 'damage', target: 'x', value: 5 }] },
          onFail: { narrative: 'no' },
        },
      }));
      expect(r.creativeOutcome).toBeTruthy();
      expect(r.creativeOutcome.dc).toBe(15);
      expect(r.creativeOutcome.onSuccess.actions).toHaveLength(1);
      expect(r.creativeOutcome.onFail.actions).toEqual([]);
    });

    test('DC 超出范围 → null', () => {
      const r = parser.parse(JSON.stringify({
        narrative: '...',
        creativeOutcome: { dc: 100, onSuccess: {}, onFail: {} },
      }));
      expect(r.creativeOutcome).toBeNull();
    });

    test('缺 DC → null', () => {
      const r = parser.parse(JSON.stringify({
        narrative: '...',
        creativeOutcome: { onSuccess: {}, onFail: {} },
      }));
      expect(r.creativeOutcome).toBeNull();
    });
  });

  describe('_validateAction', () => {
    test('damage 在 [0,100] 内合法', () => {
      const v = parser._validateAction({ type: 'damage', target: 'x', value: 50 }, { activeCharacters: [{ id: 'x', stats: { hpCurrent: 100 } }] }, null);
      expect(v.valid).toBe(true);
    });

    test('damage 超出 100 拒绝', () => {
      const v = parser._validateAction({ type: 'damage', value: 999 }, {}, null);
      expect(v.valid).toBe(false);
      expect(v.reason).toContain('超出');
    });

    test('damage target 不存在拒绝', () => {
      const v = parser._validateAction({ type: 'damage', target: 'ghost', value: 10 }, { activeCharacters: [] }, null);
      expect(v.valid).toBe(false);
    });

    test('add_item 未知 ID 拒绝（cardManager 提供时）', () => {
      const cm = { getCard: () => null };
      const v = parser._validateAction({ type: 'add_item', value: 'fake' }, {}, cm);
      expect(v.valid).toBe(false);
    });

    test('add_item 类型不是 item 拒绝', () => {
      const cm = { getCard: () => ({ id: 'x', type: 'enemy' }) };
      const v = parser._validateAction({ type: 'add_item', value: 'x' }, {}, cm);
      expect(v.valid).toBe(false);
    });

    test('start_combat enemyIds 非数组拒绝', () => {
      const v = parser._validateAction({ type: 'start_combat', enemyIds: 'enemy_001' }, {}, null);
      expect(v.valid).toBe(false);
    });

    test('start_combat 空数组拒绝', () => {
      const v = parser._validateAction({ type: 'start_combat', enemyIds: [] }, {}, null);
      expect(v.valid).toBe(false);
    });

    test('未知 action 类型拒绝', () => {
      const v = parser._validateAction({ type: 'nuke_world' }, {}, null);
      expect(v.valid).toBe(false);
    });

    test('add_memory 超长拒绝', () => {
      const v = parser._validateAction({ type: 'add_memory', value: 'x'.repeat(300) }, {}, null);
      expect(v.valid).toBe(false);
    });

    test('add_memory 合法', () => {
      const v = parser._validateAction({ type: 'add_memory', value: '玩家见到了主角' }, {}, null);
      expect(v.valid).toBe(true);
    });
  });

  describe('applyActions 校验集成', () => {
    test('非法 action 不应用，合法 action 应用', () => {
      const gameState = {
        activeCharacters: [{ id: 'c1', stats: { hp: 100, hpCurrent: 100 } }],
      };
      const actions = [
        { type: 'damage', target: 'c1', value: 10 },  // 合法
        { type: 'damage', target: 'c1', value: 9999 },  // 非法
        { type: 'unknown' },  // 非法
      ];
      parser.applyActions(actions, gameState, null);
      expect(gameState.activeCharacters[0].stats.hpCurrent).toBe(90);
    });
  });

  describe('applyDiceRequests', () => {
    test('调用 diceSystem.roll 或 rollCheck', () => {
      const mockDice = {
        roll: jest.fn(() => ({ total: 10 })),
        rollCheck: jest.fn(() => ({ total: 15, success: true })),
      };
      parser.applyDiceRequests([
        { formula: 'd20', reason: 'attack' },
        { formula: 'd20', target: 15, reason: 'check' },
      ], mockDice);

      expect(mockDice.roll).toHaveBeenCalledWith('d20');
      expect(mockDice.rollCheck).toHaveBeenCalledWith('d20', 15);
    });
  });
});
