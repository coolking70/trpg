/**
 * presetNormalize 单元测试 —— 用一份典型"一次性 AI 生成"的缺陷预设
 * （缺 startingSceneId / 物品无 effect / 敌人无生态 / 变量设了不用 / 孤儿敌人 / 无结局）
 */

import { normalizePreset, formatNormalizeReport } from '../../src/data/presetNormalize.js';

function gappyPreset() {
  return {
    name: '失落王国（缺陷样例）',
    characters: [{ id: 'hero', name: '主角', stats: { hp: 100, atk: 10, def: 5 } }],
    enemies: [
      { id: 'e1', name: '沼泽利齿', stats: { hp: 20 }, difficulty: 1, tags: ['swamp', 'beast'] },
      { id: 'e2', name: '神秘水晶', stats: { hp: 30 }, difficulty: 2 }, // 无 tags → 无法推断 biome
    ],
    items: [
      { id: 'i1', name: '生命药水', type: 'consumable', description: '红色液体' },
      { id: 'i2', name: '强化护盾', type: 'equipment', description: '一面铁盾' },
      { id: 'i3', name: '古代符文石', type: 'quest' },
    ],
    scenes: [
      { id: 's1', name: '入口', connections: [{ to: 's2', label: '前进' }] },
      { id: 's2', name: '深处', connections: [{ to: 's1', label: '返回' }] },
    ],
    events: [
      {
        id: 'ev1', name: '遭遇', inScene: ['s1'],
        choices: [
          { text: '战斗', outcomes: [{ probability: 1, effects: [{ type: 'start_combat', enemyIds: ['e1'] }] }] },
          { text: '逃跑', outcomes: [{ probability: 1, effects: [{ type: 'set_variable', name: 'coward', value: true }] }] },
        ],
      },
    ],
    // 注意：故意缺 startingSceneId；e2 从不被 start_combat 引用（孤儿）；coward 设了没人读；无结局
  };
}

describe('normalizePreset', () => {
  test('补全 startingSceneId 为首个场景', () => {
    const { preset, report } = normalizePreset(gappyPreset());
    expect(preset.startingSceneId).toBe('s1');
    expect(report.startingSceneId).toEqual({ from: '(缺失)', to: 's1' });
  });

  test('自动布局缺失的场景坐标', () => {
    const { preset, report } = normalizePreset(gappyPreset());
    expect(report.coordsFilled).toBe(2);
    expect(typeof preset.scenes[0].coords.x).toBe('number');
  });

  test('消耗品补 heal、装备补 statModifiers，并规范 itemType/type', () => {
    const { preset } = normalizePreset(gappyPreset());
    const potion = preset.items.find(i => i.id === 'i1');
    const shield = preset.items.find(i => i.id === 'i2');
    expect(potion.itemType).toBe('consumable');
    expect(potion.type).toBe('item');               // card type 规范为 'item'
    expect(potion.consumeEffect).toMatchObject({ type: 'heal', stat: 'hp' });
    expect(shield.statModifiers.def).toBeGreaterThan(0); // 盾→def
  });

  test('敌人据 tags 推断 ecology 并烘焙掉落；无 tags 的敌人被记入 notes', () => {
    const { preset, report, lootItemsNeeded } = normalizePreset(gappyPreset());
    const e1 = preset.enemies.find(e => e.id === 'e1');
    expect(e1.ecology?.biome).toBe('swamp');
    expect(Array.isArray(e1.lootTable)).toBe(true);
    expect(e1.lootTable.length).toBeGreaterThan(0);
    expect(lootItemsNeeded.length).toBeGreaterThan(0);
    expect(report.notes.some(n => n.includes('e2'))).toBe(true); // e2 无法推断
  });

  test('报告：设了不用的变量 + 孤儿敌人 + 无结局', () => {
    const { report } = normalizePreset(gappyPreset());
    expect(report.variablesSetButUnused).toContain('coward');
    expect(report.orphanEnemies).toContain('e2');   // e2 从不被战斗引用
    expect(report.orphanEnemies).not.toContain('e1'); // e1 被 start_combat 引用
    expect(report.endings.hasEnding).toBe(false);
  });

  test('opts.addEndingScaffold 补一个结局事件脚手架', () => {
    const { preset, report } = normalizePreset(gappyPreset(), { addEndingScaffold: true });
    expect(report.endings.added).toBe(true);
    const ending = preset.events.find(e => (e.tags || []).includes('ending'));
    expect(ending).toBeTruthy();
  });

  test('不修改原始输入（纯函数）', () => {
    const input = gappyPreset();
    normalizePreset(input);
    expect(input.startingSceneId).toBeUndefined();
    expect(input.items[0].consumeEffect).toBeUndefined();
  });

  test('formatNormalizeReport 输出可读文本', () => {
    const { report, lootItemsNeeded } = normalizePreset(gappyPreset());
    const text = formatNormalizeReport(report, lootItemsNeeded);
    expect(text).toContain('剧本补全报告');
    expect(text).toContain('startingSceneId');
    expect(text).toContain('孤儿敌人');
  });
});
