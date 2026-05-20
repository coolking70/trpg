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
    test('getExperienceForNextLevel 线性', () => {
      expect(getExperienceForNextLevel(1)).toBe(100);
      expect(getExperienceForNextLevel(3)).toBe(300);
      expect(getExperienceForNextLevel(10)).toBe(1000);
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
      const r = sys.grantExperience(char, 950);  // 400+500=900 跨两级
      expect(r.leveledUp).toBe(true);
      expect(char.level).toBe(6);
      expect(r.growthSummary).toHaveLength(2);
    });

    test('奇数级不加 speed/luck', () => {
      const sys = makeSystem();
      const char = makeChar({ level: 2, stats: { hp: 100, hpCurrent: 100, mp: 50, mpCurrent: 50, attack: 10, defense: 8, magicAttack: 5, magicDefense: 5, speed: 10, luck: 5 } });
      sys.grantExperience(char, 200);  // 升到 3
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
