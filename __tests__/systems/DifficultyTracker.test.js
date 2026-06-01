/**
 * DifficultyTracker 测试：挑战分数算法 + 动态修正器
 */

import { DifficultyTracker } from '../../src/systems/DifficultyTracker.js';

describe('DifficultyTracker', () => {
  let dt;
  beforeEach(() => { dt = new DifficultyTracker(); });

  describe('初始状态', () => {
    test('空历史 → score 0 → 无修正', () => {
      expect(dt.computeChallengeScore()).toBe(0);
      const mod = dt.getDynamicModifier();
      expect(mod.hpMul).toBe(1);
      expect(mod.atkDelta).toBe(0);
      expect(mod.narrativeHint).toBeNull();
    });
  });

  describe('recordCombat', () => {
    test('胜利（轻松）+0.5', () => {
      dt.recordCombat({ result: 'victory', hpRatio: 0.9, rounds: 2 });
      expect(dt.computeChallengeScore()).toBeCloseTo(0.5);
    });

    test('胜利（残血+长战）-0.5', () => {
      dt.recordCombat({ result: 'victory', hpRatio: 0.2, rounds: 10 });
      expect(dt.computeChallengeScore()).toBeCloseTo(-0.5);
    });

    test('失败 -0.6', () => {
      dt.recordCombat({ result: 'defeat', hpRatio: 0, rounds: 5 });
      expect(dt.computeChallengeScore()).toBeCloseTo(-0.6);
    });

    test('逃跑 -0.2', () => {
      dt.recordCombat({ result: 'flee', hpRatio: 0.5, rounds: 3 });
      expect(dt.computeChallengeScore()).toBeCloseTo(-0.2);
    });

    test('滑动窗口：超过 5 场只保留最新', () => {
      for (let i = 0; i < 7; i++) dt.recordCombat({ result: 'victory', hpRatio: 0.9, rounds: 2 });
      expect(dt.history.length).toBe(5);
    });
  });

  describe('getDynamicModifier', () => {
    test('挣扎 (score <= -0.3) → 弱化敌人', () => {
      // 3 场连续艰难胜利
      for (let i = 0; i < 3; i++) dt.recordCombat({ result: 'victory', hpRatio: 0.2, rounds: 9 });
      const mod = dt.getDynamicModifier();
      expect(mod.hpMul).toBe(0.85);
      expect(mod.atkDelta).toBe(-1);
      expect(mod.narrativeHint).toContain('没那么可怕');
    });

    test('碾压 (score >= +0.3) → 强化敌人', () => {
      for (let i = 0; i < 3; i++) dt.recordCombat({ result: 'victory', hpRatio: 0.95, rounds: 2 });
      const mod = dt.getDynamicModifier();
      expect(mod.hpMul).toBe(1.15);
      expect(mod.atkDelta).toBe(1);
      expect(mod.narrativeHint).toContain('凶悍');
    });

    test('中等区间 (|score| < 0.3) → 不修正', () => {
      dt.recordCombat({ result: 'victory', hpRatio: 0.5, rounds: 5 });
      const mod = dt.getDynamicModifier();
      expect(mod.hpMul).toBe(1);
      expect(mod.atkDelta).toBe(0);
      expect(mod.narrativeHint).toBeNull();
    });
  });

  describe('setEnabled', () => {
    test('关闭后即使分数低也不修正', () => {
      for (let i = 0; i < 3; i++) dt.recordCombat({ result: 'defeat' });
      dt.setEnabled(false);
      const mod = dt.getDynamicModifier();
      expect(mod.hpMul).toBe(1);
      expect(mod.atkDelta).toBe(0);
    });
  });

  describe('reset', () => {
    test('清空历史', () => {
      dt.recordCombat({ result: 'victory', hpRatio: 0.9 });
      dt.recordCombat({ result: 'defeat' });
      dt.reset();
      expect(dt.history.length).toBe(0);
      expect(dt.computeChallengeScore()).toBe(0);
    });
  });

  describe('setManualBias（L3 编剧调难度）', () => {
    test('偏置累加并 clamp 到 [-1,1]，叠加进挑战分数', () => {
      expect(dt.setManualBias(0.3)).toBeCloseTo(0.3);
      expect(dt.computeChallengeScore()).toBeCloseTo(0.3); // 无战斗历史时分数=偏置
      dt.setManualBias(0.9);
      expect(dt.manualBias).toBe(1); // clamp 上限
      // 正偏置 → getDynamicModifier 增强敌人
      expect(dt.getDynamicModifier().hpMul).toBeGreaterThan(1);
      dt.setManualBias(-2.5);
      expect(dt.manualBias).toBe(-1); // clamp 下限
    });
  });

  describe('getSnapshot', () => {
    test('返回完整状态', () => {
      dt.recordCombat({ result: 'victory', hpRatio: 0.9, rounds: 2 });
      const snap = dt.getSnapshot();
      expect(snap.enabled).toBe(true);
      expect(snap.historyCount).toBe(1);
      expect(snap.challengeScore).toBeGreaterThan(0);
      expect(snap.modifier).toBeDefined();
    });
  });
});
