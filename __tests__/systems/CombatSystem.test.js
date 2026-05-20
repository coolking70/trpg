/**
 * CombatSystem 单元测试
 * 覆盖：先攻顺序、攻击伤害、技能、回合推进、战斗结束判定
 */

import { CombatSystem } from '../../src/systems/CombatSystem.js';
import { DiceSystem } from '../../src/systems/DiceSystem.js';

function makeChar(opts = {}) {
  return {
    id: opts.id || 'c1',
    name: opts.name || '艾拉',
    stats: {
      hp: 100, hpCurrent: 100, mp: 50, mpCurrent: 50,
      attack: 15, defense: 8, magicAttack: 10, magicDefense: 6,
      speed: 12, luck: 5,
      ...(opts.stats || {}),
    },
    abilities: opts.abilities || [],
  };
}

function makeEnemy(opts = {}) {
  return {
    id: opts.id || 'e1',
    name: opts.name || '暗影狼',
    stats: {
      hp: 50, hpCurrent: 50, mp: 0, mpCurrent: 0,
      attack: 10, defense: 5, magicAttack: 0, magicDefense: 3,
      speed: 8, luck: 2,
      ...(opts.stats || {}),
    },
    abilities: opts.abilities || [],
    lootTable: opts.lootTable || [],
    experienceReward: opts.experienceReward || 10,
  };
}

function makeSystem() {
  const combat = new CombatSystem();
  combat.diceSystem = new DiceSystem();
  return combat;
}

describe('CombatSystem', () => {
  describe('startCombat', () => {
    test('生成先攻顺序，按 initiative 倒序', () => {
      const sys = makeSystem();
      const gameState = {
        activeCharacters: [
          makeChar({ id: 'fast', stats: { hp: 50, hpCurrent: 50, mp: 0, mpCurrent: 0, attack: 10, defense: 5, magicAttack: 0, magicDefense: 0, speed: 30, luck: 0 } }),
          makeChar({ id: 'slow', stats: { hp: 50, hpCurrent: 50, mp: 0, mpCurrent: 0, attack: 10, defense: 5, magicAttack: 0, magicDefense: 0, speed: 1, luck: 0 } }),
        ],
        activeCombat: null,
      };
      sys.startCombat(gameState, [makeEnemy({ stats: { hp: 50, hpCurrent: 50, mp: 0, mpCurrent: 0, attack: 10, defense: 5, magicAttack: 0, magicDefense: 0, speed: 15, luck: 0 } })]);

      const order = gameState.activeCombat.turnOrder.map(p => p.id);
      // fast 应在 enemy 之前，enemy 在 slow 之前（初始化值 d20+speed，但 30 一定 > 15+20，1+20 一定 < 15）
      // 实际不确定，验证排序方向：initiative 递减
      const inits = gameState.activeCombat.turnOrder.map(p => p.initiative);
      for (let i = 1; i < inits.length; i++) {
        expect(inits[i - 1]).toBeGreaterThanOrEqual(inits[i]);
      }
    });

    test('排除 HP 为 0 的角色', () => {
      const sys = makeSystem();
      const gameState = {
        activeCharacters: [
          makeChar({ id: 'dead', stats: { hp: 100, hpCurrent: 0 } }),
          makeChar({ id: 'alive' }),
        ],
        activeCombat: null,
      };
      sys.startCombat(gameState, [makeEnemy()]);
      const ids = gameState.activeCombat.turnOrder.map(p => p.id);
      expect(ids).not.toContain('dead');
      expect(ids).toContain('alive');
    });

    test('phase 变为 combat', () => {
      const sys = makeSystem();
      const gameState = { activeCharacters: [makeChar()], activeCombat: null };
      sys.startCombat(gameState, [makeEnemy()]);
      expect(gameState.currentPhase).toBe('combat');
    });
  });

  describe('performAttack', () => {
    test('伤害 = max(1, atkTotal - defense + damageRoll)', () => {
      const sys = makeSystem();
      const attacker = makeChar({ stats: { hp: 100, hpCurrent: 100, mp: 0, mpCurrent: 0, attack: 20, defense: 0, magicAttack: 0, magicDefense: 0, speed: 0, luck: 0 } });
      const target = makeEnemy({ stats: { hp: 100, hpCurrent: 100, mp: 0, mpCurrent: 0, attack: 0, defense: 0, magicAttack: 0, magicDefense: 0, speed: 0, luck: 0 } });
      const gameState = {
        activeCharacters: [attacker],
        activeCombat: { enemies: [target], turnOrder: [], log: [] },
      };

      const r = sys.performAttack(gameState, attacker.id, target.id);
      expect(r.success).toBe(true);
      expect(r.finalDamage).toBeGreaterThanOrEqual(1);
      expect(target.stats.hpCurrent).toBeLessThan(100);
    });

    test('伤害不超过目标当前 HP', () => {
      const sys = makeSystem();
      const attacker = makeChar({ stats: { hp: 100, hpCurrent: 100, mp: 0, mpCurrent: 0, attack: 1000, defense: 0, magicAttack: 0, magicDefense: 0, speed: 0, luck: 0 } });
      const target = makeEnemy({ stats: { hp: 100, hpCurrent: 10, mp: 0, mpCurrent: 0, attack: 0, defense: 0, magicAttack: 0, magicDefense: 0, speed: 0, luck: 0 } });
      const gameState = {
        activeCharacters: [attacker],
        activeCombat: { enemies: [target], turnOrder: [], log: [] },
      };
      const r = sys.performAttack(gameState, attacker.id, target.id);
      expect(r.finalDamage).toBe(10);  // 至多扣到 0
      expect(target.stats.hpCurrent).toBe(0);
      expect(r.targetDefeated).toBe(true);
    });

    test('攻击者不存在返回失败', () => {
      const sys = makeSystem();
      const gameState = { activeCharacters: [], activeCombat: { enemies: [], turnOrder: [], log: [] } };
      const r = sys.performAttack(gameState, 'ghost', 'phantom');
      expect(r.success).toBe(false);
    });
  });

  describe('useAbility', () => {
    test('扣 MP 后造成伤害', () => {
      const sys = makeSystem();
      const ability = {
        id: 'a1', name: '火球术',
        cost: { mp: 15 },
        effect: { damage: { formula: 'magicAttack * 2', type: 'magic' } },
      };
      const caster = makeChar({ stats: { hp: 60, hpCurrent: 60, mp: 80, mpCurrent: 80, attack: 5, defense: 5, magicAttack: 20, magicDefense: 10, speed: 10, luck: 5 }, abilities: [ability] });
      const target = makeEnemy();
      const gameState = {
        activeCharacters: [caster],
        activeCombat: { enemies: [target], turnOrder: [], log: [] },
      };
      const r = sys.useAbility(gameState, caster.id, 'a1', target.id);
      expect(r.success).toBe(true);
      expect(r.damage).toBeGreaterThan(0);
      expect(caster.stats.mpCurrent).toBe(80 - 15);
    });

    test('MP 不足拒绝', () => {
      const sys = makeSystem();
      const ability = { id: 'big', name: '大招', cost: { mp: 100 }, effect: { damage: { formula: '50' } } };
      const caster = makeChar({ stats: { hp: 60, hpCurrent: 60, mp: 50, mpCurrent: 10, attack: 5, defense: 5, magicAttack: 20, magicDefense: 10, speed: 10, luck: 5 }, abilities: [ability] });
      const target = makeEnemy();
      const gameState = {
        activeCharacters: [caster],
        activeCombat: { enemies: [target], turnOrder: [], log: [] },
      };
      const r = sys.useAbility(gameState, caster.id, 'big', target.id);
      expect(r.success).toBe(false);
      expect(r.reason).toContain('MP');
    });

    test('治疗效果不超过目标上限', () => {
      const sys = makeSystem();
      const ability = { id: 'heal', name: '治愈', cost: { mp: 0 }, effect: { heal: { formula: '999' } } };
      const caster = makeChar({ abilities: [ability], stats: { hp: 100, hpCurrent: 100, mp: 50, mpCurrent: 50, attack: 10, defense: 8, magicAttack: 10, magicDefense: 6, speed: 12, luck: 5 } });
      const target = makeChar({ id: 'c2', stats: { hp: 80, hpCurrent: 30, mp: 0, mpCurrent: 0, attack: 0, defense: 0, magicAttack: 0, magicDefense: 0, speed: 0, luck: 0 } });
      const gameState = {
        activeCharacters: [caster, target],
        activeCombat: { enemies: [], turnOrder: [], log: [] },
      };
      const r = sys.useAbility(gameState, caster.id, 'heal', target.id);
      expect(r.success).toBe(true);
      expect(target.stats.hpCurrent).toBe(80);
      expect(r.healing).toBe(50);
    });
  });

  describe('nextTurn 战斗结束判定', () => {
    test('所有敌人死亡 → 胜利', () => {
      const sys = makeSystem();
      const enemy = makeEnemy({ stats: { hp: 50, hpCurrent: 0, mp: 0, mpCurrent: 0, attack: 0, defense: 0, magicAttack: 0, magicDefense: 0, speed: 0, luck: 0 } });
      const gameState = {
        activeCharacters: [makeChar()],
        activeCombat: {
          enemies: [enemy],
          turnOrder: [{ id: 'c1', type: 'character' }],
          currentActorIndex: 0, round: 1, log: [],
        },
      };
      const r = sys.nextTurn(gameState);
      expect(r.combatEnd).toBe(true);
      expect(r.result).toBe('victory');
    });

    test('所有角色死亡 → 失败', () => {
      const sys = makeSystem();
      const deadChar = makeChar({ stats: { hp: 100, hpCurrent: 0 } });
      const gameState = {
        activeCharacters: [deadChar],
        activeCombat: {
          enemies: [makeEnemy()],
          turnOrder: [{ id: 'e1', type: 'enemy' }],
          currentActorIndex: 0, round: 1, log: [],
        },
      };
      const r = sys.nextTurn(gameState);
      expect(r.combatEnd).toBe(true);
      expect(r.result).toBe('defeat');
    });

    test('新一轮 newRound=true', () => {
      const sys = makeSystem();
      const gameState = {
        activeCharacters: [makeChar()],
        activeCombat: {
          enemies: [makeEnemy()],
          turnOrder: [{ id: 'c1', type: 'character' }, { id: 'e1', type: 'enemy' }],
          currentActorIndex: 1, round: 1, log: [],
        },
      };
      const r = sys.nextTurn(gameState);
      expect(r.newRound).toBe(true);
      expect(gameState.activeCombat.round).toBe(2);
    });

    test('回归 #9.A：filter 移除当前 actor 之前的参与者时不跳号', () => {
      // 场景：turnOrder = [A, B, C, D, E]，currentActorIndex = 1 (B 刚行动完)
      // 在 nextTurn 之前 A 死亡（来自 DOT 之类的）→ filter 后 turnOrder = [B, C, D, E]
      // 期望：下一个行动者是 C（不应跳过 C 到 D）
      const sys = makeSystem();
      const A = makeChar({ id: 'A', stats: { hp: 100, hpCurrent: 0 } });  // 已死
      const B = makeChar({ id: 'B' });
      const C = makeChar({ id: 'C' });
      const D = makeChar({ id: 'D' });
      const E = makeEnemy({ id: 'E' });
      const gameState = {
        activeCharacters: [A, B, C, D],
        activeCombat: {
          enemies: [E],
          turnOrder: [
            { id: 'A', type: 'character' }, { id: 'B', type: 'character' },
            { id: 'C', type: 'character' }, { id: 'D', type: 'character' },
            { id: 'E', type: 'enemy' },
          ],
          currentActorIndex: 1, round: 1, log: [],
        },
      };
      const r = sys.nextTurn(gameState);
      expect(r.nextActor.id).toBe('C');
      expect(gameState.activeCombat.turnOrder.map(p => p.id)).toEqual(['B', 'C', 'D', 'E']);
    });

    test('回归 #9.A：当前 actor 自身死亡时，下一个仍然正确', () => {
      // 场景：B 是当前 actor 但刚刚自杀（如自爆技能）→ filter 后 B 也被移除
      // turnOrder 原本 [A, B, C, D]，currentActorIndex=1 (B)
      // filter 后 [A, C, D]，下一个应当是 C
      const sys = makeSystem();
      const A = makeChar({ id: 'A' });
      const B = makeChar({ id: 'B', stats: { hp: 100, hpCurrent: 0 } });  // 自爆死了
      const C = makeChar({ id: 'C' });
      const D = makeEnemy({ id: 'D' });
      const gameState = {
        activeCharacters: [A, B, C],
        activeCombat: {
          enemies: [D],
          turnOrder: [
            { id: 'A', type: 'character' }, { id: 'B', type: 'character' },
            { id: 'C', type: 'character' }, { id: 'D', type: 'enemy' },
          ],
          currentActorIndex: 1, round: 1, log: [],
        },
      };
      const r = sys.nextTurn(gameState);
      expect(r.nextActor.id).toBe('C');
    });
  });

  describe('endCombat', () => {
    test('胜利收集经验和掉落', () => {
      const sys = makeSystem();
      const original = Math.random;
      Math.random = () => 0.1;  // 总是命中掉落
      const enemy = makeEnemy({
        experienceReward: 50,
        lootTable: [
          { itemId: 'gold', dropRate: 1.0 },
          { itemId: 'gem', dropRate: 1.0 },
        ],
      });
      const gameState = {
        activeCharacters: [makeChar()],
        activeCombat: { enemies: [enemy], turnOrder: [], log: [] },
      };
      const r = sys.endCombat(gameState, 'victory');
      expect(r.totalExp).toBe(50);
      expect(r.loot).toEqual(['gold', 'gem']);
      expect(gameState.activeCombat).toBeNull();
      expect(gameState.currentPhase).toBe('exploration');
      Math.random = original;
    });

    test('失败无奖励', () => {
      const sys = makeSystem();
      const enemy = makeEnemy({ experienceReward: 100 });
      const gameState = {
        activeCharacters: [makeChar()],
        activeCombat: { enemies: [enemy], turnOrder: [], log: [] },
      };
      const r = sys.endCombat(gameState, 'defeat');
      expect(r.totalExp).toBe(0);
      expect(r.loot).toEqual([]);
    });
  });

  describe('findCombatant', () => {
    test('返回角色或敌人', () => {
      const sys = makeSystem();
      const char = makeChar({ id: 'c1' });
      const enemy = makeEnemy({ id: 'e1' });
      const gameState = {
        activeCharacters: [char],
        activeCombat: { enemies: [enemy] },
      };
      expect(sys.findCombatant(gameState, 'c1')).toBe(char);
      expect(sys.findCombatant(gameState, 'e1')).toBe(enemy);
      expect(sys.findCombatant(gameState, 'ghost')).toBeNull();
    });
  });
});
