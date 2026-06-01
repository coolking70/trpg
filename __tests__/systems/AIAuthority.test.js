/**
 * AIAuthority — AI 参与度（权限）模型单测
 */
import {
  AI_AUTHORITY, DEFAULT_AUTHORITY, AUTHORITY_LEVELS, ACTION_AUTHORITY,
  clampAuthority, requiredAuthority, filterActionsByAuthority,
  canAdjudicateFreeInput, narrationCanMutate, authorityName, authorityPromptSection,
} from '../../src/systems/AIAuthority.js';

describe('AIAuthority 权限模型', () => {
  test('5 档常量与默认值', () => {
    expect(AI_AUTHORITY).toMatchObject({ NARRATOR: 0, HOST: 1, ADJUDICATOR: 2, COAUTHOR: 3, WORLDSMITH: 4 });
    expect(DEFAULT_AUTHORITY).toBe(2);
    expect(AUTHORITY_LEVELS).toHaveLength(5);
    expect(AUTHORITY_LEVELS.map(l => l.level)).toEqual([0, 1, 2, 3, 4]);
  });

  test('clampAuthority 规整到 0–4', () => {
    expect(clampAuthority(-3)).toBe(0);
    expect(clampAuthority(9)).toBe(4);
    expect(clampAuthority(2.4)).toBe(2);
    expect(clampAuthority(undefined)).toBe(DEFAULT_AUTHORITY);
    expect(clampAuthority('x')).toBe(DEFAULT_AUTHORITY);
  });

  test('requiredAuthority：有界改动=L2 / 生成内容=L3 / 改写世界=L4 / 未知=L3 保守', () => {
    expect(requiredAuthority('heal')).toBe(2);
    expect(requiredAuthority('set_variable')).toBe(2);
    expect(requiredAuthority('add_item')).toBe(2);
    expect(requiredAuthority('start_combat')).toBe(3);
    expect(requiredAuthority('trigger_event')).toBe(3);
    expect(requiredAuthority('author_ending')).toBe(4);
    expect(requiredAuthority('rewrite_scene')).toBe(4);
    expect(requiredAuthority('something_unknown')).toBe(3);
  });

  test('filterActionsByAuthority 按档放行/拦截', () => {
    const acts = [{ type: 'heal' }, { type: 'start_combat' }, { type: 'author_ending' }];
    // L0：全拦
    let r = filterActionsByAuthority(acts, 0);
    expect(r.allowed).toHaveLength(0);
    expect(r.blocked.map(a => a.type)).toEqual(['heal', 'start_combat', 'author_ending']);
    // L2：仅 heal 放行
    r = filterActionsByAuthority(acts, 2);
    expect(r.allowed.map(a => a.type)).toEqual(['heal']);
    expect(r.blocked.map(a => a.type)).toEqual(['start_combat', 'author_ending']);
    // L3：heal + start_combat 放行
    r = filterActionsByAuthority(acts, 3);
    expect(r.allowed.map(a => a.type)).toEqual(['heal', 'start_combat']);
    // L4：全放行
    r = filterActionsByAuthority(acts, 4);
    expect(r.allowed).toHaveLength(3);
    expect(r.blocked).toHaveLength(0);
  });

  test('canAdjudicateFreeInput：仅 ≥L2', () => {
    expect(canAdjudicateFreeInput(0)).toBe(false);
    expect(canAdjudicateFreeInput(1)).toBe(false);
    expect(canAdjudicateFreeInput(2)).toBe(true);
    expect(canAdjudicateFreeInput(4)).toBe(true);
  });

  test('narrationCanMutate：脚本叙述里改状态仅 ≥L3', () => {
    expect(narrationCanMutate(2)).toBe(false); // 默认档：叙述不改状态（保留重复落地修复）
    expect(narrationCanMutate(3)).toBe(true);
  });

  test('authorityPromptSection 各档文本明确且不同', () => {
    const texts = [0, 1, 2, 3, 4].map(authorityPromptSection);
    expect(texts[0]).toContain('L0 旁白');
    expect(texts[0]).toContain('婉拒');
    expect(texts[2]).toContain('L2 裁决');
    expect(texts[4]).toContain('L4 创世');
    expect(new Set(texts).size).toBe(5); // 五档文本互不相同
  });

  test('authorityName', () => {
    expect(authorityName(0)).toBe('旁白');
    expect(authorityName(4)).toBe('创世');
    expect(authorityName(99)).toBe('创世'); // clamp
  });

  test('ACTION_AUTHORITY 覆盖 responseParser 的写动作类型', () => {
    for (const t of ['heal', 'damage', 'add_item', 'remove_item', 'set_variable', 'add_memory', 'start_combat', 'trigger_event']) {
      expect(ACTION_AUTHORITY[t]).toBeGreaterThanOrEqual(2);
    }
  });
});
