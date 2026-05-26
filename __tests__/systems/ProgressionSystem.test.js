/**
 * ProgressionSystem 单元测试
 * 覆盖：升级公式、连升、道具使用、装备替换、购买/出售
 */

import { ProgressionSystem, getExperienceForNextLevel } from '../../src/systems/ProgressionSystem.js';

function makeMockCardManager(cards) {
  const map = new Map(cards.map(c => [c.id, c]));
  return { getCard: (id) => map.get(id) };
}

function makeChar(opts = {}) {
  return {
    id: opts.id || 'c1',
    name: opts.name || '艾拉',
    level: opts.level || 1,
    experience: opts.experience || 0,
    stats: {
      hp: 100, hpCurrent: 100, mp: 50, mpCurrent: 50,
      attack: 10, defense: 8, magicAttack: 5, magicDefense: 5,
      speed: 10, luck: 5,
      ...(opts.stats || {}),
    },
    inventory: opts.inventory || [],
    equipment: opts.equipment || { weapon: null, armor: null, accessory: null },
  };
}

function makeSystem(cards = []) {
  const sys = new ProgressionSystem();
  sys.cardManager = makeMockCardManager(cards);
  return sys;
}

describe('ProgressionSystem', () => {
  describe('经验曲线', () => {
    test('getExperienceForNextLevel 线性 (level * 50)', () => {
      expect(getExperienceForNextLevel(1)).toBe(50);
      expect(getExperienceForNextLevel(3)).toBe(150);
      expect(getExperienceForNextLevel(10)).toBe(500);
    });
  });

  describe('grantExperience 升级', () => {
    test('经验不够不升级', () => {
      const sys = makeSystem();
      const char = makeChar({ level: 3, experience: 50 });
      const r = sys.grantExperience(char, 30);
      expect(r.leveledUp).toBe(false);
      expect(char.level).toBe(3);
      expect(char.experience).toBe(80);
    });

    test('单次升级（Lv.3 → Lv.4）', () => {
      const sys = makeSystem();
      const char = makeChar({ level: 3, experience: 50, stats: { hp: 100, hpCurrent: 50, mp: 50, mpCurrent: 30, attack: 10, defense: 8, magicAttack: 5, magicDefense: 5, speed: 10, luck: 5 } });
      const r = sys.grantExperience(char, 250);
      expect(r.leveledUp).toBe(true);
      expect(char.level).toBe(4);
      expect(char.stats.attack).toBe(11);
      expect(char.stats.defense).toBe(9);
      // 偶数级 +1 speed/luck
      expect(char.stats.speed).toBe(11);
      expect(char.stats.luck).toBe(6);
      // HP/MP 全恢复
      expect(char.stats.hpCurrent).toBe(char.stats.hp);
      expect(char.stats.mpCurrent).toBe(char.stats.mp);
    });

    test('连升（Lv.4 → Lv.6）', () => {
      const sys = makeSystem();
      const char = makeChar({ level: 4 });
      // 公式: getExperienceForNextLevel(L) = L*50
      // Lv4→5 需 200, Lv5→6 需 250, 总 450
      const r = sys.grantExperience(char, 470);
      expect(r.leveledUp).toBe(true);
      expect(char.level).toBe(6);
      expect(r.growthSummary).toHaveLength(2);
    });

    test('奇数级不加 speed/luck', () => {
      const sys = makeSystem();
      const char = makeChar({ level: 2, stats: { hp: 100, hpCurrent: 100, mp: 50, mpCurrent: 50, attack: 10, defense: 8, magicAttack: 5, magicDefense: 5, speed: 10, luck: 5 } });
      // 新公式 Lv2→3 需 100 XP；给恰好 100 升一次到 Lv3，不会跨级到 Lv4
      sys.grantExperience(char, 100);
      expect(char.level).toBe(3);
      expect(char.stats.speed).toBe(10);
      expect(char.stats.luck).toBe(5);
    });
  });

  describe('useItem 道具使用', () => {
    test('治疗药水恢复 HP', () => {
      const sys = makeSystem([
        { id: 'pot', type: 'item', name: '治疗药水', consumeEffect: { type: 'heal', stat: 'hp', value: 30 } },
      ]);
      const char = makeChar({ inventory: ['pot'], stats: { hp: 100, hpCurrent: 50, mp: 50, mpCurrent: 50, attack: 10, defense: 8, magicAttack: 5, magicDefense: 5, speed: 10, luck: 5 } });
      const r = sys.useItem({ activeCharacters: [char] }, 'pot', 'c1', 'c1');
      expect(r.success).toBe(true);
      expect(char.stats.hpCurrent).toBe(80);
      expect(char.inventory).toEqual([]);
    });

    test('魔力药水恢复 MP', () => {
      const sys = makeSystem([
        { id: 'mp_pot', type: 'item', name: '魔力药水', consumeEffect: { type: 'heal', stat: 'mp', value: 20 } },
      ]);
      const char = makeChar({ inventory: ['mp_pot'], stats: { hp: 100, hpCurrent: 100, mp: 50, mpCurrent: 20, attack: 10, defense: 8, magicAttack: 5, magicDefense: 5, speed: 10, luck: 5 } });
      const r = sys.useItem({ activeCharacters: [char] }, 'mp_pot', 'c1', 'c1');
      expect(r.success).toBe(true);
      expect(char.stats.mpCurrent).toBe(40);
    });

    test('不可用道具拒绝', () => {
      const sys = makeSystem([
        { id: 'sword', type: 'item', name: '剑', consumeEffect: null },
      ]);
      const char = makeChar({ inventory: ['sword'] });
      const r = sys.useItem({ activeCharacters: [char] }, 'sword', 'c1', 'c1');
      expect(r.success).toBe(false);
      expect(r.reason).toContain('不可使用');
    });

    test('背包没有道具拒绝', () => {
      const sys = makeSystem([
        { id: 'pot', type: 'item', name: '药水', consumeEffect: { type: 'heal', stat: 'hp', value: 10 } },
      ]);
      const char = makeChar({ inventory: [] });
      const r = sys.useItem({ activeCharacters: [char] }, 'pot', 'c1', 'c1');
      expect(r.success).toBe(false);
    });

    // Phase 26C — escape_combat
    test('escape_combat 道具：扣全队 HP 一定百分比 + 标记结束战斗', () => {
      const sys = makeSystem([
        { id: 'smoke', type: 'item', name: '烟雾弹',
          consumeEffect: { type: 'escape_combat', hpPenaltyPct: 0.20 } },
      ]);
      const a = makeChar({ id: 'a', inventory: ['smoke'], stats: { hp: 100, hpCurrent: 80, mp: 0, mpCurrent: 0, attack: 10, defense: 5, magicAttack: 0, magicDefense: 0, speed: 10, luck: 0 } });
      const b = makeChar({ id: 'b', inventory: [], stats: { hp: 80, hpCurrent: 60, mp: 0, mpCurrent: 0, attack: 8, defense: 4, magicAttack: 0, magicDefense: 0, speed: 8, luck: 0 } });
      const gs = { activeCharacters: [a, b], activeCombat: { enemies: [], log: [] } };
      const r = sys.useItem(gs, 'smoke', 'a', 'a');
      expect(r.success).toBe(true);
      expect(r.effect.requiresCombatEnd).toBe('flee');
      // a: 80 - 100*0.2 = 80-20 = 60
      // b: 60 - 80*0.2 = 60-16 = 44
      expect(a.stats.hpCurrent).toBe(60);
      expect(b.stats.hpCurrent).toBe(44);
      // 道具消耗
      expect(a.inventory).toEqual([]);
    });

    test('escape_combat 在非战斗时拒绝', () => {
      const sys = makeSystem([
        { id: 'smoke', type: 'item', name: '烟雾弹', consumeEffect: { type: 'escape_combat' } },
      ]);
      const a = makeChar({ inventory: ['smoke'] });
      const r = sys.useItem({ activeCharacters: [a], activeCombat: null }, 'smoke', 'c1', 'c1');
      expect(r.success).toBe(false);
      expect(r.reason).toContain('不在战斗');
    });

    test('escape_combat 永不把队员打死（最少留 1 HP）', () => {
      const sys = makeSystem([
        { id: 'smoke', type: 'item', name: '烟雾弹', consumeEffect: { type: 'escape_combat', hpPenaltyPct: 0.50 } },
      ]);
      const a = makeChar({ inventory: ['smoke'], stats: { hp: 100, hpCurrent: 10, mp: 0, mpCurrent: 0, attack: 10, defense: 5, magicAttack: 0, magicDefense: 0, speed: 10, luck: 0 } });
      const gs = { activeCharacters: [a], activeCombat: { enemies: [], log: [] } };
      sys.useItem(gs, 'smoke', 'c1', 'c1');
      // 10 - 50 = -40 → clamp to 1
      expect(a.stats.hpCurrent).toBe(1);
    });
  });

  describe('equipItem / unequipItem 装备', () => {
    test('装备武器加属性', () => {
      const sys = makeSystem([
        { id: 'bow', type: 'item', name: '长弓', equipSlot: 'weapon', statModifiers: { attack: 6, speed: 2 } },
      ]);
      const char = makeChar({ inventory: ['bow'], stats: { hp: 80, hpCurrent: 80, mp: 30, mpCurrent: 30, attack: 14, defense: 8, magicAttack: 5, magicDefense: 5, speed: 16, luck: 5 } });
      const r = sys.equipItem({ activeCharacters: [char] }, 'bow', 'c1');
      expect(r.success).toBe(true);
      expect(char.stats.attack).toBe(20);
      expect(char.stats.speed).toBe(18);
      expect(char.equipment.weapon).toBe('bow');
      expect(char.inventory).toEqual([]);
    });

    test('装备新武器自动卸下旧武器到背包', () => {
      const sys = makeSystem([
        { id: 'sword', type: 'item', name: '剑', equipSlot: 'weapon', statModifiers: { attack: 8 } },
        { id: 'bow', type: 'item', name: '弓', equipSlot: 'weapon', statModifiers: { attack: 6, speed: 2 } },
      ]);
      const char = makeChar({ inventory: ['bow'], equipment: { weapon: 'sword', armor: null, accessory: null } });
      const r = sys.equipItem({ activeCharacters: [char] }, 'bow', 'c1');
      expect(char.equipment.weapon).toBe('bow');
      expect(char.inventory).toContain('sword');
      // attack: 原值 - 8 (sword) + 6 (bow) = 原值 - 2
      expect(char.stats.attack).toBe(8);
      expect(char.stats.speed).toBe(12);
    });

    test('卸下回到背包 + 撤销属性', () => {
      const sys = makeSystem([
        { id: 'sword', type: 'item', name: '剑', equipSlot: 'weapon', statModifiers: { attack: 8 } },
      ]);
      const char = makeChar({ equipment: { weapon: 'sword', armor: null, accessory: null } });
      const r = sys.unequipItem({ activeCharacters: [char] }, 'weapon', 'c1');
      expect(r.success).toBe(true);
      expect(char.equipment.weapon).toBeNull();
      expect(char.inventory).toContain('sword');
      expect(char.stats.attack).toBe(2);  // 10 - 8
    });

    test('卸下空槽位拒绝', () => {
      const sys = makeSystem([]);
      const char = makeChar();
      const r = sys.unequipItem({ activeCharacters: [char] }, 'weapon', 'c1');
      expect(r.success).toBe(false);
    });

    test('hpCurrent 在装备减少时钳制到新上限', () => {
      const sys = makeSystem([
        { id: 'armor', type: 'item', name: 'armor', equipSlot: 'armor', statModifiers: { hp: 20 } },
      ]);
      const char = makeChar({ stats: { hp: 100, hpCurrent: 100, mp: 50, mpCurrent: 50, attack: 10, defense: 8, magicAttack: 5, magicDefense: 5, speed: 10, luck: 5 }, equipment: { weapon: null, armor: 'armor', accessory: null } });
      // 初始 hp=100, hpCurrent=100. armor 已穿戴但属性未在 stats 体现（preset 已含）
      // 卸下后 hp -= 20 → 80, hpCurrent 应钳到 80
      sys.unequipItem({ activeCharacters: [char] }, 'armor', 'c1');
      expect(char.stats.hp).toBe(80);
      expect(char.stats.hpCurrent).toBe(80);
    });
  });

  describe('buyItem / sellItem 商店', () => {
    test('购买扣金币 + 入背包', () => {
      const sys = makeSystem([
        { id: 'pot', type: 'item', name: '药水', buyPrice: 25, sellPrice: 12 },
      ]);
      const char = makeChar();
      const gs = { gold: 100, activeCharacters: [char] };
      const r = sys.buyItem(gs, 'pot', 25);
      expect(r.success).toBe(true);
      expect(gs.gold).toBe(75);
      expect(char.inventory).toContain('pot');
    });

    test('金币不足拒绝', () => {
      const sys = makeSystem([
        { id: 'expensive', type: 'item', name: '宝物', buyPrice: 999, sellPrice: 0 },
      ]);
      const gs = { gold: 100, activeCharacters: [makeChar()] };
      const r = sys.buyItem(gs, 'expensive', 999);
      expect(r.success).toBe(false);
      expect(gs.gold).toBe(100);
    });

    test('出售加金币 + 出背包', () => {
      const sys = makeSystem([
        { id: 'pot', type: 'item', name: '药水', buyPrice: 25, sellPrice: 12 },
      ]);
      const char = makeChar({ inventory: ['pot'] });
      const gs = { gold: 50, activeCharacters: [char] };
      const r = sys.sellItem(gs, 'pot', 'c1', 0.5);
      expect(r.success).toBe(true);
      expect(gs.gold).toBeGreaterThan(50);
      expect(char.inventory).toEqual([]);
    });

    test('出售不存在的道具拒绝', () => {
      const sys = makeSystem([]);
      const gs = { gold: 0, activeCharacters: [makeChar()] };
      const r = sys.sellItem(gs, 'fake', 'c1');
      expect(r.success).toBe(false);
    });
  });
});
