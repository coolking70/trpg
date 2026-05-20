/**
 * DiceSystem 单元测试
 */

import { DiceSystem } from '../../src/systems/DiceSystem.js';

describe('DiceSystem', () => {
  let dice;

  beforeEach(() => {
    dice = new DiceSystem();
  });

  describe('parseFormula', () => {
    test('解析 d20', () => {
      expect(dice.parseFormula('d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
    });

    test('解析 2d6+3', () => {
      expect(dice.parseFormula('2d6+3')).toEqual({ count: 2, sides: 6, modifier: 3 });
    });

    test('解析负修正 d20-2', () => {
      expect(dice.parseFormula('d20-2')).toEqual({ count: 1, sides: 20, modifier: -2 });
    });

    test('忽略空格与大小写', () => {
      expect(dice.parseFormula(' 3 D 8 + 5 ')).toEqual({ count: 3, sides: 8, modifier: 5 });
    });

    test('非法公式抛错', () => {
      expect(() => dice.parseFormula('hello')).toThrow();
      expect(() => dice.parseFormula('d')).toThrow();
    });
  });

  describe('roll', () => {
    test('d20 结果在 1-20', () => {
      for (let i = 0; i < 50; i++) {
        const r = dice.roll('d20');
        expect(r.total).toBeGreaterThanOrEqual(1);
        expect(r.total).toBeLessThanOrEqual(20);
        expect(r.rolls).toHaveLength(1);
      }
    });

    test('2d6+3 范围 5-15', () => {
      for (let i = 0; i < 50; i++) {
        const r = dice.roll('2d6+3');
        expect(r.total).toBeGreaterThanOrEqual(5);
        expect(r.total).toBeLessThanOrEqual(15);
        expect(r.rolls).toHaveLength(2);
        expect(r.modifier).toBe(3);
      }
    });

    test('total = subtotal + modifier', () => {
      const r = dice.roll('3d4+2');
      expect(r.total).toBe(r.subtotal + 2);
    });
  });

  describe('rollCheck', () => {
    test('成功判定 (mock 高骰)', () => {
      const original = Math.random;
      Math.random = () => 0.99;  // 接近最大
      const r = dice.rollCheck('d20', 10);
      expect(r.target).toBe(10);
      expect(r.success).toBe(true);
      Math.random = original;
    });

    test('失败判定 (mock 低骰)', () => {
      const original = Math.random;
      Math.random = () => 0.01;
      const r = dice.rollCheck('d20', 10);
      expect(r.success).toBe(false);
      Math.random = original;
    });
  });

  describe('rollD20 优势/劣势', () => {
    test('advantage 取两次中较大', () => {
      const r = dice.rollD20('advantage', 0);
      expect(r.rolls).toHaveLength(2);
      expect(r.advantageType).toBe('advantage');
    });

    test('disadvantage 取较小', () => {
      const r = dice.rollD20('disadvantage', 0);
      expect(r.advantageType).toBe('disadvantage');
    });

    test('normal 正常掷', () => {
      const r = dice.rollD20('normal', 3);
      expect(r.advantageType).toBe('normal');
      expect(r.modifier).toBe(3);
    });
  });

  describe('evaluateExpression', () => {
    test('替换变量', () => {
      const r = dice.evaluateExpression('attack * 2', { attack: 10 });
      expect(r.result).toBe(20);
    });

    test('计算骰子表达式 attack + d6', () => {
      const r = dice.evaluateExpression('attack + 1d6', { attack: 10 });
      expect(r.result).toBeGreaterThanOrEqual(11);
      expect(r.result).toBeLessThanOrEqual(16);
    });

    test('非法表达式返回 0', () => {
      const r = dice.evaluateExpression('foo+bar', {});
      expect(r.result).toBe(0);
    });

    test('result 是整数', () => {
      const r = dice.evaluateExpression('10 / 3', {});
      expect(Number.isInteger(r.result)).toBe(true);
    });
  });

  describe('quickRoll', () => {
    test('返回 1 到 sides 之间', () => {
      for (let i = 0; i < 30; i++) {
        const n = dice.quickRoll(6);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(6);
      }
    });
  });
});
