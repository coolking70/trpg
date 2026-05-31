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

  // Phase 19A — 玩家 tags
  describe('Phase 19A — composite: 玩家 tags', () => {
    test('requireTags 全匹配通过', () => {
      const engine = makeEngine([
        { id: 'e_elf_noble', type: 'event', trigger: { type: 'composite', condition: { requireTags: ['race:elf', 'origin:noble'], probability: 1.0 } } },
      ]);
      const gs = { ...makeGameState(), playerTags: ['race:elf', 'origin:noble', 'faith:moon'] };
      expect(engine.scan(gs, { moment: 'scene_enter' })).toContain('e_elf_noble');
    });

    test('requireTags 缺一个则拒', () => {
      const engine = makeEngine([
        { id: 'e_elf_noble', type: 'event', trigger: { type: 'composite', condition: { requireTags: ['race:elf', 'origin:noble'], probability: 1.0 } } },
      ]);
      const gs = { ...makeGameState(), playerTags: ['race:elf'] };
      expect(engine.scan(gs, { moment: 'scene_enter' })).not.toContain('e_elf_noble');
    });

    test('requireAnyTags 任一命中', () => {
      const engine = makeEngine([
        { id: 'e_caster', type: 'event', trigger: { type: 'composite', condition: { requireAnyTags: ['bg:scholar', 'bg:mage'], probability: 1.0 } } },
      ]);
      const gs = { ...makeGameState(), playerTags: ['bg:mage'] };
      expect(engine.scan(gs, { moment: 'scene_enter' })).toContain('e_caster');
    });

    test('requireNoTags 排除指定 tag', () => {
      const engine = makeEngine([
        { id: 'e_living', type: 'event', trigger: { type: 'composite', condition: { requireNoTags: ['undead'], probability: 1.0 } } },
      ]);
      const okGs = { ...makeGameState(), playerTags: ['race:human'] };
      const banGs = { ...makeGameState(), playerTags: ['undead'] };
      expect(engine.scan(okGs, { moment: 'scene_enter' })).toContain('e_living');
      expect(engine.scan(banGs, { moment: 'scene_enter' })).not.toContain('e_living');
    });
  });

  // Phase 19C — 故事时间
  describe('Phase 19C — composite: requireStoryTime', () => {
    test('minDay/maxDay 范围匹配', () => {
      const engine = makeEngine([
        { id: 'e_week1', type: 'event', trigger: { type: 'composite', condition: { requireStoryTime: { minDay: 1, maxDay: 7 }, probability: 1.0 } } },
      ]);
      const okGs = { ...makeGameState(), storyTime: { day: 3, hour: 10 } };
      const lateGs = { ...makeGameState(), storyTime: { day: 8, hour: 10 } };
      expect(engine.scan(okGs, { moment: 'scene_enter' })).toContain('e_week1');
      expect(engine.scan(lateGs, { moment: 'scene_enter' })).not.toContain('e_week1');
    });

    test('hourRange 普通时段', () => {
      const engine = makeEngine([
        { id: 'e_day', type: 'event', trigger: { type: 'composite', condition: { requireStoryTime: { hourRange: [8, 18] }, probability: 1.0 } } },
      ]);
      const okGs = { ...makeGameState(), storyTime: { day: 1, hour: 12 } };
      const nightGs = { ...makeGameState(), storyTime: { day: 1, hour: 22 } };
      expect(engine.scan(okGs, { moment: 'scene_enter' })).toContain('e_day');
      expect(engine.scan(nightGs, { moment: 'scene_enter' })).not.toContain('e_day');
    });

    test('hourRange 跨午夜（lo>hi）', () => {
      const engine = makeEngine([
        { id: 'e_night', type: 'event', trigger: { type: 'composite', condition: { requireStoryTime: { hourRange: [22, 6] }, probability: 1.0 } } },
      ]);
      const midnightGs = { ...makeGameState(), storyTime: { day: 1, hour: 2 } };
      const lateGs = { ...makeGameState(), storyTime: { day: 1, hour: 23 } };
      const noonGs = { ...makeGameState(), storyTime: { day: 1, hour: 12 } };
      expect(engine.scan(midnightGs, { moment: 'scene_enter' })).toContain('e_night');
      expect(engine.scan(lateGs, { moment: 'scene_enter' })).toContain('e_night');
      expect(engine.scan(noonGs, { moment: 'scene_enter' })).not.toContain('e_night');
    });
  });

  // Phase 22 预留 — worldFlags
  describe('Phase 22 — composite: requireWorldFlags', () => {
    test('worldFlag 匹配', () => {
      const engine = makeEngine([
        { id: 'e_war', type: 'event', trigger: { type: 'composite', condition: { requireWorldFlags: { war_declared: true }, probability: 1.0 } } },
      ]);
      const wartime = { ...makeGameState(), worldFlags: { war_declared: true } };
      const peace = { ...makeGameState(), worldFlags: {} };
      expect(engine.scan(wartime, { moment: 'scene_enter' })).toContain('e_war');
      expect(engine.scan(peace, { moment: 'scene_enter' })).not.toContain('e_war');
    });
  });

  // Phase 29 — 随机遭遇每次进入场景只触发一次（修复战斗后补扫 SCENE_ENTER 背靠背重复触发）
  describe('Phase 29 — 概率随机遭遇的单次访问冷却', () => {
    function encEngine() {
      // probability < 1.0 → 真随机遭遇，参与单次访问冷却
      return makeEngine([
        { id: 'e_enc', type: 'event', repeatable: true, trigger: { type: 'composite', condition: { inScene: ['s1'], probability: 0.5 } } },
      ]);
    }
    function gsInScene(sceneId = 's1') {
      return { ...makeGameState(), mapState: { currentSceneId: sceneId } };
    }

    let origRandom;
    beforeEach(() => { origRandom = Math.random; Math.random = () => 0.1; }); // 0.1 < 0.5 → 命中
    afterEach(() => { Math.random = origRandom; });

    test('同一次进入场景内，第二次 SCENE_ENTER 扫描不再触发', () => {
      const engine = encEngine();
      const gs = gsInScene();
      // 首扫触发并打上冷却标记
      expect(engine.scan(gs, { moment: 'scene_enter' })).toContain('e_enc');
      expect(gs.mapState._encounterFiredSceneId).toBe('s1');
      // 战斗后补扫 SCENE_ENTER（未移动）→ 不再触发
      expect(engine.scan(gs, { moment: 'scene_enter' })).not.toContain('e_enc');
    });

    test('清空标记（模拟重新进入场景）后可再次触发', () => {
      const engine = encEngine();
      const gs = gsInScene();
      expect(engine.scan(gs, { moment: 'scene_enter' })).toContain('e_enc');
      // performTravel 会把该标记清空
      gs.mapState._encounterFiredSceneId = null;
      expect(engine.scan(gs, { moment: 'scene_enter' })).toContain('e_enc');
    });

    test('确定性 inScene 后续事件（无 probability）不受冷却影响，仍可在战斗后补扫触发', () => {
      const engine = makeEngine([
        { id: 'e_followup', type: 'event', trigger: { type: 'composite', condition: { inScene: ['s1'] } } },
      ]);
      const gs = gsInScene();
      gs.mapState._encounterFiredSceneId = 's1'; // 即使本场景已触发过随机遭遇
      expect(engine.scan(gs, { moment: 'scene_enter' })).toContain('e_followup');
      expect(engine.scan(gs, { moment: 'scene_enter' })).toContain('e_followup');
    });
  });
});
