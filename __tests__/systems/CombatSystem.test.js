/**
 * CombatSystem 单元测试
 * 覆盖：先攻顺序、攻击伤害、技能、回合推进、战斗结束判定
 */

import { CombatSystem } from '../../src/systems/CombatSystem.js';
import { DiceSystem } from '../../src/systems/DiceSystem.js';
import { resolveLootTable } from '../../src/data/ecology.js';

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
    ...(opts.lootMode ? { lootMode: opts.lootMode } : {}),
    ...(opts.ecology ? { ecology: opts.ecology } : {}),
    ...(opts.phases ? { phases: opts.phases } : {}),
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

    test('回归 Bug#5: 同种敌人多份用唯一 instanceId 时活敌不会被错误过滤', () => {
      // 场景：两只暗影狼，原始 ID 都是 enemy_002
      // 修复策略：_startCombat 给每只敌人加 #idx 后缀作为唯一 instance ID
      // 不修：findCombatant 用 enemies.find(id===) 总是返回第一只 → filter 把活敌也过滤掉
      const sys = makeSystem();
      const char = makeChar();
      const wolf1 = makeEnemy({ id: 'enemy_002#0', stats: { hp: 35, hpCurrent: 0 } });   // 死了
      const wolf2 = makeEnemy({ id: 'enemy_002#1', stats: { hp: 35, hpCurrent: 35 } });  // 还活着
      const gameState = {
        activeCharacters: [char],
        activeCombat: {
          enemies: [wolf1, wolf2],
          turnOrder: [
            { id: 'enemy_002#0', type: 'enemy' },
            { id: 'c1', type: 'character' },
            { id: 'enemy_002#1', type: 'enemy' },
          ],
          currentActorIndex: 1, round: 1, log: [],
        },
      };
      const r = sys.nextTurn(gameState);
      // 死的狼1被过滤，活的狼2留下
      expect(gameState.activeCombat.turnOrder.map(p => p.id)).toEqual(['c1', 'enemy_002#1']);
      expect(r.combatEnd).toBeFalsy();
      // 下一个应是 enemy_002#1
      expect(r.nextActor.id).toBe('enemy_002#1');
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

    // Phase 28 — 生态位动态掉落
    // 注意：用 0.3（健康 pivot），避免 Math.random=()=>0 触发 jest source-map quicksort 栈溢出
    test('lootMode=dynamic 时按 ecology 从掉落池抽取', () => {
      const sys = makeSystem();
      const original = Math.random;
      Math.random = () => 0.3;  // common 材料(0.55)/通用池(0.55)会命中
      try {
        const enemy = makeEnemy({
          experienceReward: 30,
          lootMode: 'dynamic',
          ecology: { biome: 'swamp', creatureType: 'beast', tier: 'common' },
        });
        enemy.lootTable = undefined;
        const gameState = {
          activeCharacters: [makeChar()],
          activeCombat: { enemies: [enemy], turnOrder: [], log: [] },
        };
        const r = sys.endCombat(gameState, 'victory');
        expect(r.totalExp).toBe(30);
        expect(r.loot.length).toBeGreaterThan(0);
        // 掉落应全部来自 swamp 生态池 / 通用池（用 resolveLootTable 的实际候选校验）
        const allowed = new Set(
          resolveLootTable({ biome: 'swamp', creatureType: 'beast', tier: 'common' }).map(e => e.itemId));
        expect(r.loot.every(id => allowed.has(id))).toBe(true);
      } finally {
        Math.random = original;
      }
    });

    test('有 ecology 但也有静态 lootTable 时，默认优先静态（向后兼容）', () => {
      const sys = makeSystem();
      const original = Math.random;
      Math.random = () => 0.3;
      try {
        const enemy = makeEnemy({
          ecology: { biome: 'swamp', creatureType: 'beast', tier: 'common' },
          lootTable: [{ itemId: 'fixed_drop', dropRate: 1.0 }],
        });
        const gameState = {
          activeCharacters: [makeChar()],
          activeCombat: { enemies: [enemy], turnOrder: [], log: [] },
        };
        const r = sys.endCombat(gameState, 'victory');
        expect(r.loot).toEqual(['fixed_drop']);
      } finally {
        Math.random = original;
      }
    });

    test('有 ecology 但无 lootTable 时自动走动态', () => {
      const sys = makeSystem();
      const original = Math.random;
      Math.random = () => 0.3;
      try {
        const enemy = makeEnemy({ ecology: { biome: 'desert', creatureType: 'beast', tier: 'common' } });
        enemy.lootTable = undefined;
        const gameState = {
          activeCharacters: [makeChar()],
          activeCombat: { enemies: [enemy], turnOrder: [], log: [] },
        };
        const r = sys.endCombat(gameState, 'victory');
        expect(r.loot.length).toBeGreaterThan(0);
      } finally {
        Math.random = original;
      }
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

  // Phase 26C — Status effects
  describe('Phase 26C — StatusEffects', () => {
    test('getEffectiveStat 应用 buff 加成', () => {
      const sys = makeSystem();
      const c = makeChar();
      c.statusEffects = [{ type: 'buff', stat: 'attack', value: 5, duration: 3 }];
      expect(sys.getEffectiveStat(c, 'attack')).toBe(15 + 5);
    });

    test('getEffectiveStat 应用 debuff 减成', () => {
      const sys = makeSystem();
      const c = makeChar();
      c.statusEffects = [{ type: 'debuff', stat: 'defense', value: 3, duration: 2 }];
      expect(sys.getEffectiveStat(c, 'defense')).toBe(8 - 3);
    });

    test('duration=0 的 effect 不再生效', () => {
      const sys = makeSystem();
      const c = makeChar();
      c.statusEffects = [{ type: 'buff', stat: 'attack', value: 5, duration: 0 }];
      expect(sys.getEffectiveStat(c, 'attack')).toBe(15);
    });

    test('applyStatusEffect 新增', () => {
      const sys = makeSystem();
      const c = makeChar();
      sys.applyStatusEffect(c, { type: 'dot', stat: 'hp', value: 5, duration: 3 });
      expect(c.statusEffects).toHaveLength(1);
      expect(c.statusEffects[0].type).toBe('dot');
    });

    test('applyStatusEffect 同 type+stat 续期不重复', () => {
      const sys = makeSystem();
      const c = makeChar();
      sys.applyStatusEffect(c, { type: 'buff', stat: 'attack', value: 3, duration: 2 });
      sys.applyStatusEffect(c, { type: 'buff', stat: 'attack', value: 5, duration: 4 });
      expect(c.statusEffects).toHaveLength(1);
      expect(c.statusEffects[0].value).toBe(5);     // 取较大
      expect(c.statusEffects[0].duration).toBe(4);  // 取较长
    });

    test('_processStatusEffectsTick: dot 扣血 + duration--', () => {
      const sys = makeSystem();
      const c = makeChar();
      c.statusEffects = [{ type: 'dot', stat: 'hp', value: 10, duration: 3 }];
      const t = sys._processStatusEffectsTick(c);
      expect(c.stats.hpCurrent).toBe(90);
      expect(c.statusEffects[0].duration).toBe(2);
      expect(t[0].type).toBe('dot');
      expect(t[0].amount).toBe(10);
    });

    test('_processStatusEffectsTick: regen 回血', () => {
      const sys = makeSystem();
      const c = makeChar({ stats: { hp: 100, hpCurrent: 30, mp: 50, mpCurrent: 50, attack: 15, defense: 8, magicAttack: 10, magicDefense: 6, speed: 12, luck: 5 } });
      c.statusEffects = [{ type: 'regen', value: 15, duration: 2 }];
      sys._processStatusEffectsTick(c);
      expect(c.stats.hpCurrent).toBe(45);
    });

    test('_processStatusEffectsTick: duration 到 0 后清除', () => {
      const sys = makeSystem();
      const c = makeChar();
      c.statusEffects = [{ type: 'dot', stat: 'hp', value: 5, duration: 1 }];
      sys._processStatusEffectsTick(c);
      expect(c.statusEffects).toHaveLength(0);
    });

    test('performAttack 使用 getEffectiveStat（buff 加伤害）', () => {
      const sys = makeSystem();
      sys.diceSystem.roll = (formula) => ({ total: formula === 'd20' ? 10 : 3, rolls: [formula === 'd20' ? 10 : 3], modifier: 0 });
      const attacker = makeChar({ id: 'a' });
      attacker.statusEffects = [{ type: 'buff', stat: 'attack', value: 10, duration: 2 }];
      const target = makeEnemy({ id: 't' });
      const gameState = { activeCharacters: [attacker], activeCombat: { enemies: [target], log: [] } };
      const r = sys.performAttack(gameState, 'a', 't');
      // 没 buff: attackTotal = 10 + 15 = 25; raw = max(0, 25-5) = 20; final = 20+3 = 23
      // 有 buff: attackTotal = 10 + 25 = 35; raw = 30; final = 33
      expect(r.finalDamage).toBe(Math.min(33, 50));   // 50 是 enemy 满 HP，cap 之
    });

    // ------ Phase 26C — AOE 多目标 ------
    test('ability.effect.aoe=true 时同时打多个敌人', () => {
      const sys = makeSystem();
      sys.diceSystem.evaluateExpression = () => ({ result: 15, details: '' });
      const caster = makeChar({ id: 'a', abilities: [{ id: 'storm', name: '风暴', type: 'active',
        effect: { damage: { formula: '15' }, aoe: true } }] });
      const e1 = makeEnemy({ id: 'e1' });
      const e2 = makeEnemy({ id: 'e2' });
      const e3 = makeEnemy({ id: 'e3' });
      const gameState = { activeCharacters: [caster], activeCombat: { enemies: [e1, e2, e3], log: [] } };
      const r = sys.useAbility(gameState, 'a', 'storm', 'e1');
      expect(r.isAoe).toBe(true);
      expect(r.subResults).toHaveLength(3);
      // 3 个敌人都 -15
      expect(e1.stats.hpCurrent).toBe(50 - 15);
      expect(e2.stats.hpCurrent).toBe(50 - 15);
      expect(e3.stats.hpCurrent).toBe(50 - 15);
    });

    test('ability.target="all_allies" 治疗类全队', () => {
      const sys = makeSystem();
      sys.diceSystem.evaluateExpression = () => ({ result: 20, details: '' });
      const a = makeChar({ id: 'a', stats: { hp: 100, hpCurrent: 50, mp: 50, mpCurrent: 50, attack: 15, defense: 8, magicAttack: 10, magicDefense: 6, speed: 12, luck: 5 } });
      a.abilities = [{ id: 'mass_heal', name: '群疗', type: 'active', effect: { heal: { formula: '20' }, target: 'all_allies' } }];
      const b = makeChar({ id: 'b', stats: { hp: 80, hpCurrent: 30, mp: 30, mpCurrent: 30, attack: 10, defense: 6, magicAttack: 4, magicDefense: 4, speed: 10, luck: 3 } });
      const gameState = { activeCharacters: [a, b], activeCombat: { enemies: [], log: [] } };
      const r = sys.useAbility(gameState, 'a', 'mass_heal', 'a');
      expect(r.isAoe).toBe(true);
      expect(a.stats.hpCurrent).toBe(70);
      expect(b.stats.hpCurrent).toBe(50);
    });

    test('ability.target="self" 只施于自己', () => {
      const sys = makeSystem();
      sys.diceSystem.evaluateExpression = () => ({ result: 25, details: '' });
      const a = makeChar({ id: 'a', stats: { hp: 100, hpCurrent: 50, mp: 50, mpCurrent: 50, attack: 15, defense: 8, magicAttack: 10, magicDefense: 6, speed: 12, luck: 5 } });
      a.abilities = [{ id: 'rest', name: '休息', type: 'active', effect: { heal: { formula: '25' }, target: 'self' } }];
      const gameState = { activeCharacters: [a], activeCombat: { enemies: [], log: [] } };
      const r = sys.useAbility(gameState, 'a', 'rest', 'wrong_target_id');
      expect(r.success).toBe(true);
      expect(r.subResults).toHaveLength(1);
      expect(a.stats.hpCurrent).toBe(75);
    });

    test('AOE 应用 status 到全部目标', () => {
      const sys = makeSystem();
      sys.diceSystem.evaluateExpression = () => ({ result: 5, details: '' });
      const caster = makeChar({ id: 'a', abilities: [{ id: 'plague', name: '瘟疫', type: 'active',
        effect: { damage: { formula: '5' }, target: 'all_enemies',
                  applyStatus: { type: 'dot', stat: 'hp', value: 3, duration: 3 } } }] });
      const e1 = makeEnemy({ id: 'e1' });
      const e2 = makeEnemy({ id: 'e2' });
      const gameState = { activeCharacters: [caster], activeCombat: { enemies: [e1, e2], log: [] } };
      sys.useAbility(gameState, 'a', 'plague', 'e1');
      expect(e1.statusEffects).toHaveLength(1);
      expect(e2.statusEffects).toHaveLength(1);
      expect(e1.statusEffects[0].type).toBe('dot');
    });

    // ------ Phase 26C — Boss 阶段战 ------
    describe('Boss phases', () => {
      test('_checkPhaseTransition: HP 跨阈值时激活 phase + 应用 statBoosts', () => {
        const sys = makeSystem();
        const boss = makeEnemy({
          stats: { hp: 200, hpCurrent: 80, mp: 0, mpCurrent: 0, attack: 10, defense: 5, magicAttack: 0, magicDefense: 0, speed: 8, luck: 0 },
        });
        boss.phases = [
          { id: 'enraged', hpThreshold: 0.5, statBoosts: { attack: 8, speed: 4 }, narrative: '愤怒！' },
        ];
        // hpCurrent / hp = 80/200 = 0.4 < 0.5 → 触发
        const t = sys._checkPhaseTransition(boss);
        expect(t).not.toBeNull();
        expect(t.phaseId).toBe('enraged');
        expect(boss.stats.attack).toBe(10 + 8);
        expect(boss.stats.speed).toBe(8 + 4);
      });

      test('已激活的 phase 不再触发第二次', () => {
        const sys = makeSystem();
        const boss = makeEnemy({ stats: { hp: 200, hpCurrent: 80, mp: 0, mpCurrent: 0, attack: 10, defense: 5, magicAttack: 0, magicDefense: 0, speed: 8, luck: 0 } });
        boss.phases = [{ id: 'p1', hpThreshold: 0.5, statBoosts: { attack: 5 } }];
        sys._checkPhaseTransition(boss);
        sys._checkPhaseTransition(boss);   // 再调一次
        expect(boss.stats.attack).toBe(15);   // 没翻倍
      });

      test('阶段 abilities 追加到 enemy.abilities', () => {
        const sys = makeSystem();
        const boss = makeEnemy({ stats: { hp: 100, hpCurrent: 30, mp: 0, mpCurrent: 0, attack: 10, defense: 5, magicAttack: 0, magicDefense: 0, speed: 8, luck: 0 } });
        boss.abilities = [{ id: 'a1', name: '普通', type: 'active' }];
        boss.phases = [{ id: 'desperate', hpThreshold: 0.4,
          abilities: [{ id: 'big_aoe', name: '绝杀', type: 'active', effect: { damage: { formula: '50' }, aoe: true } }] }];
        sys._checkPhaseTransition(boss);
        expect(boss.abilities).toHaveLength(2);
        expect(boss.abilities.map(a => a.id)).toContain('big_aoe');
      });

      test('多个 phase 按高 → 低 hpThreshold 依次激活', () => {
        const sys = makeSystem();
        const boss = makeEnemy({ stats: { hp: 100, hpCurrent: 20, mp: 0, mpCurrent: 0, attack: 10, defense: 5, magicAttack: 0, magicDefense: 0, speed: 8, luck: 0 } });
        boss.phases = [
          { id: 'p_75', hpThreshold: 0.75, statBoosts: { attack: 2 } },
          { id: 'p_50', hpThreshold: 0.50, statBoosts: { attack: 3 } },
          { id: 'p_25', hpThreshold: 0.25, statBoosts: { attack: 5 } },
        ];
        const t = sys._checkPhaseTransition(boss);
        expect(t.phaseId).toBe('p_75');  // 应当先激活最高 threshold
        expect(boss.stats.attack).toBe(12);
        const t2 = sys._checkPhaseTransition(boss);
        expect(t2.phaseId).toBe('p_50');
        const t3 = sys._checkPhaseTransition(boss);
        expect(t3.phaseId).toBe('p_25');
      });
    });

    test('ability.applyStatus 战中给目标加状态', () => {
      const sys = makeSystem();
      sys.diceSystem.roll = () => ({ total: 5, rolls: [5], modifier: 0 });
      sys.diceSystem.evaluateExpression = () => ({ result: 8, details: '' });
      const caster = makeChar({ id: 'a', abilities: [{ id: 'curse', name: '诅咒', type: 'active',
        effect: { damage: { formula: '8' }, applyStatus: { type: 'dot', stat: 'hp', value: 5, duration: 3 } } }] });
      const target = makeEnemy({ id: 't' });
      const gameState = { activeCharacters: [caster], activeCombat: { enemies: [target], log: [] } };
      sys.useAbility(gameState, 'a', 'curse', 't');
      expect(target.statusEffects).toHaveLength(1);
      expect(target.statusEffects[0].type).toBe('dot');
      expect(target.statusEffects[0].duration).toBe(3);
    });
  });
});
