/**
 * AllyAIController 测试：启发式决策优先级 + LLM 决策校验
 */

import { AllyAIController } from '../../src/systems/AllyAIController.js';

function makeChar(overrides = {}) {
  return {
    id: 'c1', name: '艾拉',
    stats: { hp: 100, hpCurrent: 100, mp: 50, mpCurrent: 50, attack: 10, defense: 5, magicAttack: 5, magicDefense: 5, speed: 10 },
    abilities: [],
    ...overrides,
  };
}

function makeEnemy(overrides = {}) {
  return {
    id: 'e1', name: '狼',
    stats: { hp: 50, hpCurrent: 50, mp: 0, mpCurrent: 0, attack: 8, defense: 3, magicAttack: 0, magicDefense: 0, speed: 10 },
    ...overrides,
  };
}

describe('AllyAIController - 启发式决策', () => {
  let aic;
  beforeEach(() => { aic = new AllyAIController(); });

  test('默认 mode 是 heuristic', () => {
    expect(aic.mode).toBe('heuristic');
  });

  test('setMode 合法/非法', () => {
    aic.setMode('llm');
    expect(aic.mode).toBe('llm');
    aic.setMode('invalid');
    expect(aic.mode).toBe('llm');  // 保持原值
  });

  test('无 combat 返回 attack 占位', () => {
    const r = aic.decideAction(makeChar(), {});
    expect(r.actionType).toBe('attack');
    expect(r.reason).toBe('no-context');
  });

  test('无敌人返回 attack 占位', () => {
    const r = aic.decideAction(makeChar(), {
      activeCombat: { enemies: [] }, activeCharacters: [makeChar()],
    });
    expect(r.reason).toBe('no-enemies');
  });

  test('优先治疗低 HP 队友', () => {
    const healer = makeChar({
      abilities: [{ id: 'heal1', name: '治愈', cost: { mp: 10 }, effect: { heal: { formula: '20' } } }],
    });
    const wounded = makeChar({ id: 'c2', stats: { ...makeChar().stats, hpCurrent: 20 } });
    const gs = {
      activeCharacters: [healer, wounded],
      activeCombat: { enemies: [makeEnemy()] },
    };
    const r = aic.decideAction(healer, gs);
    expect(r.actionType).toBe('ability');
    expect(r.abilityId).toBe('heal1');
    expect(r.targetId).toBe('c2');
  });

  test('治疗技能 MP 不足时跳过', () => {
    const char = makeChar({
      stats: { ...makeChar().stats, mpCurrent: 5 },
      abilities: [
        { id: 'heal1', name: '治愈', cost: { mp: 10 }, effect: { heal: { formula: '20' } } },
        { id: 'dmg1', name: '攻击技', cost: { mp: 0 }, effect: { damage: { formula: 'attack' } } },
      ],
    });
    const wounded = makeChar({ id: 'c2', stats: { ...makeChar().stats, hpCurrent: 10 } });
    const gs = { activeCharacters: [char, wounded], activeCombat: { enemies: [makeEnemy()] } };
    const r = aic.decideAction(char, gs);
    // 治疗用不起，应用攻击技
    expect(r.abilityId).toBe('dmg1');
  });

  test('自疗：危急时治疗自己', () => {
    const char = makeChar({
      stats: { ...makeChar().stats, hpCurrent: 15 },  // < 25%
      abilities: [{ id: 'heal1', name: '治愈', cost: { mp: 10 }, effect: { heal: { formula: '20' } } }],
    });
    const gs = { activeCharacters: [char], activeCombat: { enemies: [makeEnemy()] } };
    const r = aic.decideAction(char, gs);
    // 危急自己 = 同时满足"低 HP 队友" + "自疗"两条规则；启发式优先级 1 命中
    expect(r.actionType).toBe('ability');
    expect(r.targetId).toBe('c1');
    expect(r.abilityId).toBe('heal1');
    // reason 是治疗类模板（heal/self-heal 任一都算通过）
    expect(r.reason).toMatch(/治愈|生机|绿光|绿|引导|温暖|调息|凝神|闭目|咬牙/);
  });

  test('无治疗目标也无伤害技能 → 普攻', () => {
    const char = makeChar({ abilities: [] });
    const gs = { activeCharacters: [char], activeCombat: { enemies: [makeEnemy()] } };
    const r = aic.decideAction(char, gs);
    expect(r.actionType).toBe('attack');
    expect(r.targetId).toBe('e1');
  });

  test('攻击技能选最低 HP 敌人', () => {
    const char = makeChar({
      abilities: [{ id: 'dmg', name: '强攻', cost: { mp: 0 }, effect: { damage: { formula: 'attack' } } }],
    });
    const lowHpEnemy = makeEnemy({ id: 'e2', stats: { ...makeEnemy().stats, hpCurrent: 5 } });
    const highHpEnemy = makeEnemy({ id: 'e3', stats: { ...makeEnemy().stats, hpCurrent: 50 } });
    const gs = { activeCharacters: [char], activeCombat: { enemies: [highHpEnemy, lowHpEnemy] } };
    const r = aic.decideAction(char, gs);
    expect(r.targetId).toBe('e2');
  });

  test('reason 使用模板库（非干涩 "X → Y"）', () => {
    const char = makeChar({
      abilities: [{ id: 'dmg', name: '火球术', cost: { mp: 15 }, effect: { damage: { formula: 'magicAttack' } } }],
    });
    const gs = { activeCharacters: [char], activeCombat: { enemies: [makeEnemy()] } };
    const r = aic.decideAction(char, gs);
    // 应是模板化的语句，不只是 "火球术 → 狼"
    expect(r.reason).not.toBe('火球术 → 狼');
    expect(r.reason.length).toBeGreaterThan(8);
  });
});

describe('AllyAIController - LLM 决策校验', () => {
  let aic;
  beforeEach(() => {
    aic = new AllyAIController();
    // mock gameEngine.getSystem 返回 fake AIGMEngine
    aic.gameEngine = { getSystem: () => null };  // 默认无 AI
  });

  test('LLM 决策合法 attack', () => {
    const char = makeChar();
    const enemy = makeEnemy({ id: 'wolf1' });
    const gs = { activeCharacters: [char], activeCombat: { enemies: [enemy] } };
    const decision = { actionType: 'attack', targetId: 'wolf1', reason: '速杀' };
    const r = aic._validateLLMDecision(decision, char, gs);
    expect(r.actionType).toBe('attack');
    expect(r.targetId).toBe('wolf1');
    expect(r.reason).toMatch(/^\[LLM\]/);
  });

  test('LLM 决策非法 target → null', () => {
    const char = makeChar();
    const gs = { activeCharacters: [char], activeCombat: { enemies: [makeEnemy()] } };
    const decision = { actionType: 'attack', targetId: 'ghost' };
    expect(aic._validateLLMDecision(decision, char, gs)).toBeNull();
  });

  test('LLM 决策技能 MP 不足 → null', () => {
    const char = makeChar({
      stats: { ...makeChar().stats, mpCurrent: 0 },
      abilities: [{ id: 'a1', name: 'X', cost: { mp: 20 }, effect: { damage: { formula: 'attack' } } }],
    });
    const gs = { activeCharacters: [char], activeCombat: { enemies: [makeEnemy()] } };
    const decision = { actionType: 'ability', abilityId: 'a1', targetId: 'e1' };
    expect(aic._validateLLMDecision(decision, char, gs)).toBeNull();
  });

  test('LLM 决策非法技能 ID → null', () => {
    const char = makeChar({
      abilities: [{ id: 'real', name: 'X', cost: { mp: 0 }, effect: { damage: { formula: 'attack' } } }],
    });
    const gs = { activeCharacters: [char], activeCombat: { enemies: [makeEnemy()] } };
    const decision = { actionType: 'ability', abilityId: 'fake', targetId: 'e1' };
    expect(aic._validateLLMDecision(decision, char, gs)).toBeNull();
  });

  test('LLM 决策治疗技能目标应是友方', () => {
    const healer = makeChar({
      abilities: [{ id: 'h1', name: '治愈', cost: { mp: 5 }, effect: { heal: { formula: '20' } } }],
    });
    const ally = makeChar({ id: 'c2', stats: { ...makeChar().stats, hpCurrent: 50 } });
    const gs = { activeCharacters: [healer, ally], activeCombat: { enemies: [makeEnemy()] } };
    const decision = { actionType: 'ability', abilityId: 'h1', targetId: 'c2' };
    const r = aic._validateLLMDecision(decision, healer, gs);
    expect(r).toBeTruthy();
    expect(r.targetId).toBe('c2');
  });

  test('decideActionAsync 在无 LLM 配置时降级到启发式', async () => {
    aic.setMode('llm');
    const char = makeChar();
    const gs = { activeCharacters: [char], activeCombat: { enemies: [makeEnemy()] } };
    const r = await aic.decideActionAsync(char, gs);
    expect(r.actionType).toBe('attack');
    // 降级到启发式 → reason 不带 [LLM]
    expect(r.reason).not.toMatch(/^\[LLM\]/);
  });
});
