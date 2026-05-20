/**
 * EventTriggerEngine 单元测试
 * 覆盖：复合条件评估、各维度过滤、优先级排序、map_tile 兼容性
 */

import { EventTriggerEngine, TRIGGER_MOMENTS } from '../../src/systems/EventTriggerEngine.js';

function makeMockCardManager(events) {
  const map = new Map(events.map(e => [e.id, e]));
  return {
    getCard: (id) => map.get(id),
    getCardsByType: (type) => events.filter(e => e.type === type),
  };
}

function makeMockMapSystem(pois = []) {
  return {
    getMapData: () => ({
      getPointOfInterest: (x, y) => pois.find(p => p.x === x && p.y === y) || null,
    }),
  };
}

function makeEngine(events = [], pois = []) {
  const engine = new EventTriggerEngine();
  engine.cardManager = makeMockCardManager(events);
  engine.mapSystem = makeMockMapSystem(pois);
  return engine;
}

function makeGameState(opts = {}) {
  return {
    turnNumber: opts.turnNumber || 1,
    variables: opts.variables || {},
    completedEventIds: opts.completedEventIds || [],
    activeCharacters: opts.activeCharacters || [],
  };
}

describe('EventTriggerEngine', () => {
  describe('map_tile 旧格式兼容', () => {
    test('tileKey 匹配触发', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'map_tile', condition: { tileTypes: ['G'], probability: 1.0 } } },
      ]);
      const matched = engine.scan(makeGameState(), { moment: 'move', tileX: 0, tileY: 0, tileKey: 'G' });
      expect(matched).toContain('e1');
    });

    test('tileKey 不匹配不触发', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'map_tile', condition: { tileTypes: ['T'], probability: 1.0 } } },
      ]);
      const matched = engine.scan(makeGameState(), { moment: 'move', tileKey: 'G' });
      expect(matched).not.toContain('e1');
    });
  });

  describe('composite: requireVariables', () => {
    test('变量全匹配通过', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'composite', condition: {
          requireVariables: { quest: true, level: 5 }, probability: 1.0,
        }}},
      ]);
      const gs = makeGameState({ variables: { quest: true, level: 5 } });
      expect(engine.scan(gs, { moment: 'event_complete' })).toContain('e1');
    });

    test('一个不匹配就拒', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'composite', condition: {
          requireVariables: { quest: true, level: 5 }, probability: 1.0,
        }}},
      ]);
      const gs = makeGameState({ variables: { quest: true, level: 3 } });
      expect(engine.scan(gs, { moment: 'event_complete' })).not.toContain('e1');
    });
  });

  describe('composite: requireCompletedEvents / excludeCompletedEvents', () => {
    test('前置事件全部完成通过', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'composite', condition: {
          requireCompletedEvents: ['prev1', 'prev2'], probability: 1.0,
        }}},
      ]);
      const gs = makeGameState({ completedEventIds: ['prev1', 'prev2', 'other'] });
      expect(engine.scan(gs, { moment: 'event_complete' })).toContain('e1');
    });

    test('缺一个前置不触发', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'composite', condition: {
          requireCompletedEvents: ['prev1', 'prev2'], probability: 1.0,
        }}},
      ]);
      const gs = makeGameState({ completedEventIds: ['prev1'] });
      expect(engine.scan(gs, { moment: 'event_complete' })).not.toContain('e1');
    });

    test('excludeCompletedEvents 已存在拒绝', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'composite', condition: {
          excludeCompletedEvents: ['e1'], probability: 1.0,
        }}},
      ]);
      const gs = makeGameState({ completedEventIds: ['e1'] });
      expect(engine.scan(gs, { moment: 'event_complete' })).not.toContain('e1');
    });
  });

  describe('composite: partyHpBelow', () => {
    test('HP 低于阈值触发', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'composite', condition: {
          partyHpBelow: 0.3, probability: 1.0,
        }}},
      ]);
      const gs = makeGameState({
        activeCharacters: [
          { stats: { hp: 100, hpCurrent: 20 } },
          { stats: { hp: 80, hpCurrent: 10 } },
        ],
      });
      expect(engine.scan(gs, { moment: 'turn_end' })).toContain('e1');
    });

    test('HP 满血不触发', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'composite', condition: {
          partyHpBelow: 0.3, probability: 1.0,
        }}},
      ]);
      const gs = makeGameState({
        activeCharacters: [{ stats: { hp: 100, hpCurrent: 100 } }],
      });
      expect(engine.scan(gs, { moment: 'turn_end' })).not.toContain('e1');
    });
  });

  describe('composite: turnNumberAtLeast', () => {
    test('回合数足够触发', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'composite', condition: {
          turnNumberAtLeast: 10, probability: 1.0,
        }}},
      ]);
      const gs = makeGameState({ turnNumber: 15 });
      expect(engine.scan(gs, { moment: 'turn_end' })).toContain('e1');
    });

    test('回合数不够不触发', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'composite', condition: {
          turnNumberAtLeast: 10, probability: 1.0,
        }}},
      ]);
      const gs = makeGameState({ turnNumber: 5 });
      expect(engine.scan(gs, { moment: 'turn_end' })).not.toContain('e1');
    });
  });

  describe('composite: requireItems', () => {
    test('任一角色持有即匹配', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'composite', condition: {
          requireItems: ['amulet'], probability: 1.0,
        }}},
      ]);
      const gs = makeGameState({
        activeCharacters: [
          { inventory: ['sword'] },
          { inventory: ['amulet', 'potion'] },
        ],
      });
      expect(engine.scan(gs, { moment: 'event_complete' })).toContain('e1');
    });

    test('全队都没有不触发', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', trigger: { type: 'composite', condition: {
          requireItems: ['amulet'], probability: 1.0,
        }}},
      ]);
      const gs = makeGameState({ activeCharacters: [{ inventory: ['sword'] }] });
      expect(engine.scan(gs, { moment: 'event_complete' })).not.toContain('e1');
    });
  });

  describe('composite: 空间条件 + EVENT_COMPLETE 时机', () => {
    test('pointsOfInterest 仅 MOVE 时机评估', () => {
      const engine = makeEngine(
        [{ id: 'e1', type: 'event', trigger: { type: 'composite', condition: {
          pointsOfInterest: ['poi_village'], probability: 1.0,
        }}}],
        [{ id: 'poi_village', x: 7, y: 1 }]
      );
      const gs = makeGameState();
      // EVENT_COMPLETE 时机：空间条件强制拒绝
      expect(engine.scan(gs, { moment: 'event_complete' })).not.toContain('e1');
      // MOVE 时机 + 位置匹配：触发
      expect(engine.scan(gs, { moment: 'move', tileX: 7, tileY: 1 })).toContain('e1');
    });
  });

  describe('priority 排序', () => {
    test('高优先级排在前', () => {
      const engine = makeEngine([
        { id: 'low', type: 'event', priority: 1, trigger: { type: 'composite', condition: { probability: 1.0 } } },
        { id: 'high', type: 'event', priority: 100, trigger: { type: 'composite', condition: { probability: 1.0 } } },
        { id: 'mid', type: 'event', priority: 50, trigger: { type: 'composite', condition: { probability: 1.0 } } },
      ]);
      const matched = engine.scan(makeGameState(), { moment: 'event_complete' });
      expect(matched).toEqual(['high', 'mid', 'low']);
    });
  });

  describe('repeatable / 最大次数', () => {
    test('不可重复 + 已完成 → 跳过', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', repeatable: false, trigger: { type: 'composite', condition: { probability: 1.0 } } },
      ]);
      const gs = makeGameState({ completedEventIds: ['e1'] });
      expect(engine.scan(gs, { moment: 'event_complete' })).not.toContain('e1');
    });

    test('可重复事件每次都能触发', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', repeatable: true, trigger: { type: 'composite', condition: { probability: 1.0 } } },
      ]);
      const gs = makeGameState({ completedEventIds: ['e1', 'e1'] });
      expect(engine.scan(gs, { moment: 'event_complete' })).toContain('e1');
    });

    test('maxOccurrences 限制', () => {
      const engine = makeEngine([
        { id: 'e1', type: 'event', repeatable: true, maxOccurrences: 2, trigger: { type: 'composite', condition: { probability: 1.0 } } },
      ]);
      const gs = makeGameState({ completedEventIds: ['e1', 'e1'] });
      expect(engine.scan(gs, { moment: 'event_complete' })).not.toContain('e1');
    });
  });
});
