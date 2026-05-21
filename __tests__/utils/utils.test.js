/**
 * 工具函数测试：deepClone / idGenerator / jsonValidator / tokenEstimator
 */

import { deepClone } from '../../src/utils/deepClone.js';
import { generateId } from '../../src/utils/idGenerator.js';
import { validate, validateCard } from '../../src/utils/jsonValidator.js';
import { estimateTokens } from '../../src/utils/tokenEstimator.js';

describe('deepClone', () => {
  test('原始类型直接返回', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(null)).toBeNull();
  });

  test('对象深拷贝且引用独立', () => {
    const src = { a: 1, b: { c: 2 } };
    const cloned = deepClone(src);
    cloned.b.c = 99;
    expect(src.b.c).toBe(2);
    expect(cloned.b.c).toBe(99);
  });

  test('数组深拷贝', () => {
    const src = [1, [2, 3], { x: 'y' }];
    const cloned = deepClone(src);
    cloned[1].push(4);
    cloned[2].x = 'z';
    expect(src[1]).toEqual([2, 3]);
    expect(src[2].x).toBe('y');
  });

  test('嵌套结构（角色卡场景）', () => {
    const char = {
      id: 'c1', stats: { hp: 100, hpCurrent: 50 },
      inventory: ['item_009', 'item_010'],
      equipment: { weapon: 'item_001', armor: null },
    };
    const cloned = deepClone(char);
    cloned.stats.hpCurrent = 0;
    cloned.inventory.pop();
    expect(char.stats.hpCurrent).toBe(50);
    expect(char.inventory).toHaveLength(2);
  });
});

describe('generateId', () => {
  test('返回字符串且非空', () => {
    expect(typeof generateId()).toBe('string');
    expect(generateId().length).toBeGreaterThan(0);
  });

  test('带前缀', () => {
    expect(generateId('char')).toMatch(/^char_/);
    expect(generateId('event')).toMatch(/^event_/);
  });

  test('多次生成不重复', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(generateId('test'));
    expect(ids.size).toBe(100);
  });
});

describe('jsonValidator', () => {
  test('validate 缺必填字段', () => {
    const r = validate({ name: 'x' }, { required: ['id', 'type'] });
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(2);
  });

  test('validate 字段类型不匹配', () => {
    const r = validate({ count: 'abc' }, { fields: { count: { type: 'number' } } });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/类型/);
  });

  test('validate 数字范围', () => {
    expect(validate({ n: 5 }, { fields: { n: { type: 'number', min: 1, max: 10 } } }).valid).toBe(true);
    expect(validate({ n: 0 }, { fields: { n: { type: 'number', min: 1 } } }).valid).toBe(false);
    expect(validate({ n: 99 }, { fields: { n: { type: 'number', max: 10 } } }).valid).toBe(false);
  });

  test('validate enum 限制', () => {
    expect(validate({ t: 'a' }, { fields: { t: { enum: ['a', 'b'] } } }).valid).toBe(true);
    expect(validate({ t: 'z' }, { fields: { t: { enum: ['a', 'b'] } } }).valid).toBe(false);
  });

  test('validate 数组类型', () => {
    expect(validate({ xs: [] }, { fields: { xs: { type: 'array' } } }).valid).toBe(true);
    expect(validate({ xs: 'no' }, { fields: { xs: { type: 'array' } } }).valid).toBe(false);
  });

  test('validate 非对象返回 false', () => {
    expect(validate(null, {}).valid).toBe(false);
    expect(validate('str', {}).valid).toBe(false);
  });

  test('validateCard 合法卡', () => {
    const r = validateCard({ id: 'c1', type: 'character', name: '艾拉' });
    expect(r.valid).toBe(true);
  });

  test('validateCard 缺 name', () => {
    const r = validateCard({ id: 'c1', type: 'character' });
    expect(r.valid).toBe(false);
  });

  test('validateCard 非法 type', () => {
    const r = validateCard({ id: 'c1', type: 'fake', name: 'x' });
    expect(r.valid).toBe(false);
  });
});

describe('estimateTokens', () => {
  test('空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });

  test('英文按约 4 字符 1 token 估算', () => {
    expect(estimateTokens('hello')).toBeGreaterThan(0);
    expect(estimateTokens('hello world')).toBeGreaterThan(estimateTokens('hello'));
  });

  test('中文按约 1.5 字符 1 token', () => {
    const cnText = '艾拉举起圣徽';
    const t = estimateTokens(cnText);
    expect(t).toBeGreaterThan(3);
    expect(t).toBeLessThan(10);
  });

  test('混合英中文', () => {
    const mixed = '艾拉 character_001 (level 3)';
    expect(estimateTokens(mixed)).toBeGreaterThan(estimateTokens('艾拉'));
  });
});
