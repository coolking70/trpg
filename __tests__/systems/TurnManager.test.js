/**
 * TurnManager 测试：回合推进 + 阶段切换 + DoT/HoT 状态效果
 */

import { TurnManager, PHASES } from '../../src/systems/TurnManager.js';

function makeChar(overrides = {}) {
  return {
    id: 'c1', name: 'X',
    stats: { hp: 100, hpCurrent: 50, mp: 50, mpCurrent: 30 },
    statusEffects: [],
    ...overrides,
  };
}

describe('TurnManager', () => {
  let tm;
  beforeEach(() => { tm = new TurnManager(); });

  test('PHASES 枚举', () => {
    expect(PHASES.EXPLORATION).toBe('exploration');
    expect(PHASES.COMBAT).toBe('combat');
  });

  test('startTurn 推进回合号', () => {
    const gs = { turnNumber: 5, currentPhase: 'combat', activeCharacters: [] };
    tm.startTurn(gs);
    expect(gs.turnNumber).toBe(6);
    expect(gs.currentPhase).toBe(PHASES.EXPLORATION);
  });

  test('changePhase 切换阶段', () => {
    const gs = { currentPhase: 'exploration', turnNumber: 1, activeCharacters: [] };
    tm.changePhase(gs, PHASES.COMBAT);
    expect(gs.currentPhase).toBe('combat');
  });

  test('getCurrentPhase 返回 phase', () => {
    expect(tm.getCurrentPhase(null)).toBe(PHASES.EXPLORATION);
    expect(tm.getCurrentPhase({ currentPhase: 'rest' })).toBe('rest');
  });

  describe('processEndOfTurnEffects', () => {
    test('DoT 持续掉血', () => {
      const char = makeChar({ statusEffects: [{ type: 'dot', value: 10, duration: 3 }] });
      const gs = { activeCharacters: [char] };
      tm.endTurn(gs);
      expect(char.stats.hpCurrent).toBe(40);  // 50 - 10
      expect(char.statusEffects[0].duration).toBe(2);
    });

    test('HoT 持续回血', () => {
      const char = makeChar({ statusEffects: [{ type: 'hot', value: 15, duration: 2 }] });
      const gs = { activeCharacters: [char] };
      tm.endTurn(gs);
      expect(char.stats.hpCurrent).toBe(65);  // 50 + 15
    });

    test('过期效果被移除', () => {
      const char = makeChar({ statusEffects: [
        { type: 'dot', value: 5, duration: 1 },  // 这次后过期
        { type: 'buff', stat: 'attack', value: 3, duration: 3 },
      ] });
      const gs = { activeCharacters: [char] };
      tm.endTurn(gs);
      // duration 减到 0 被移除
      expect(char.statusEffects).toHaveLength(1);
      expect(char.statusEffects[0].type).toBe('buff');
    });

    test('HoT 不超过 HP 上限', () => {
      const char = makeChar({ stats: { hp: 100, hpCurrent: 95, mp: 50, mpCurrent: 50 },
        statusEffects: [{ type: 'hot', value: 20, duration: 2 }] });
      const gs = { activeCharacters: [char] };
      tm.endTurn(gs);
      expect(char.stats.hpCurrent).toBe(100);
    });

    test('DoT 不低于 0', () => {
      const char = makeChar({ stats: { hp: 100, hpCurrent: 5, mp: 50, mpCurrent: 50 },
        statusEffects: [{ type: 'dot', value: 50, duration: 2 }] });
      const gs = { activeCharacters: [char] };
      tm.endTurn(gs);
      expect(char.stats.hpCurrent).toBe(0);
    });

    test('无 statusEffects 时安全', () => {
      const char = makeChar({ statusEffects: undefined });
      const gs = { activeCharacters: [char] };
      expect(() => tm.endTurn(gs)).not.toThrow();
    });
  });
});
