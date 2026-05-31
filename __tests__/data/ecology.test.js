/**
 * ecology.js 单元测试（Phase 28 — 生态位 → 掉落表 → 图像）
 */

import {
  BIOMES, CREATURE_TYPES, TIERS,
  difficultyToTier, candidatesFor, resolveLootTable, rollDynamicLoot,
  ecologyTags, inferEcology, validateEcology, LOOT_POOLS,
} from '../../src/data/ecology.js';

describe('ecology — 词表 + 归一', () => {
  test('difficultyToTier 映射', () => {
    expect(difficultyToTier('easy')).toBe('trivial');
    expect(difficultyToTier('normal')).toBe('common');
    expect(difficultyToTier('hard')).toBe('elite');
    expect(difficultyToTier('boss')).toBe('boss');
    expect(difficultyToTier('???')).toBe('common');     // 兜底
    expect(difficultyToTier(undefined)).toBe('common');
  });

  test('词表非空且自洽', () => {
    expect(BIOMES).toContain('swamp');
    expect(CREATURE_TYPES).toContain('beast');
    expect(TIERS).toEqual(['trivial', 'common', 'elite', 'boss']);
  });
});

describe('candidatesFor — tier / type 门槛', () => {
  test('boss-only 战利品在低 tier 不出现', () => {
    const trivial = candidatesFor({ biome: 'swamp', creatureType: 'beast', tier: 'trivial' });
    expect(trivial.map(c => c.item)).not.toContain('item_loot_hydra_scale');  // minTier=boss
    const boss = candidatesFor({ biome: 'swamp', creatureType: 'beast', tier: 'boss' });
    expect(boss.map(c => c.item)).toContain('item_loot_hydra_scale');
  });

  test('types 门槛：ooze-only 材料只对 ooze 出现', () => {
    const beast = candidatesFor({ biome: 'swamp', creatureType: 'beast', tier: 'common' });
    expect(beast.map(c => c.item)).not.toContain('item_loot_toxic_slime_core'); // types=['ooze']
    const ooze = candidatesFor({ biome: 'swamp', creatureType: 'ooze', tier: 'common' });
    expect(ooze.map(c => c.item)).toContain('item_loot_toxic_slime_core');
  });

  test('通用池（金币/药水）始终参与', () => {
    const cands = candidatesFor({ biome: 'desert', creatureType: 'beast', tier: 'common' });
    expect(cands.map(c => c.item)).toContain('item_coin_pouch');
  });

  test('无对应 biome 时只剩通用池', () => {
    const cands = candidatesFor({ biome: 'nonexistent', creatureType: 'beast', tier: 'common' });
    expect(cands.map(c => c.item)).toEqual(['item_coin_pouch', 'item_healing_potion']);
  });
});

describe('resolveLootTable — 静态烘焙', () => {
  test('输出 combat 兼容格式 [{ itemId, dropRate }]', () => {
    const table = resolveLootTable({ biome: 'swamp', creatureType: 'beast', tier: 'common' });
    expect(table.length).toBeGreaterThan(0);
    for (const e of table) {
      expect(typeof e.itemId).toBe('string');
      expect(e.dropRate).toBeGreaterThan(0);
      expect(e.dropRate).toBeLessThanOrEqual(1);
    }
  });

  test('tier 越高条目越多（受 TIER_LOOT_CAP 控制）', () => {
    const trivial = resolveLootTable({ biome: 'mountain', creatureType: 'beast', tier: 'trivial' });
    const boss = resolveLootTable({ biome: 'mountain', creatureType: 'beast', tier: 'boss' });
    expect(boss.length).toBeGreaterThanOrEqual(trivial.length);
    expect(trivial.length).toBeLessThanOrEqual(2);
    expect(boss.length).toBeLessThanOrEqual(6);
  });

  test('tier 越高常见材料掉率越高', () => {
    const common = resolveLootTable({ biome: 'desert', creatureType: 'beast', tier: 'common' });
    const boss = resolveLootTable({ biome: 'desert', creatureType: 'beast', tier: 'boss' });
    const fang = (t) => t.find(e => e.itemId === 'item_loot_sand_viper_fang')?.dropRate ?? 0;
    expect(fang(boss)).toBeGreaterThan(fang(common));
  });

  test('luck 提升掉率（封顶 +20%）', () => {
    const noLuck = resolveLootTable({ biome: 'desert', creatureType: 'beast', tier: 'common', luck: 0 });
    const highLuck = resolveLootTable({ biome: 'desert', creatureType: 'beast', tier: 'common', luck: 50 });
    const rate = (t, id) => t.find(e => e.itemId === id)?.dropRate ?? 0;
    const id = noLuck[0].itemId;
    expect(rate(highLuck, id)).toBeGreaterThan(rate(noLuck, id));
  });

  test('无 biome 仍能产通用掉落', () => {
    const table = resolveLootTable({ biome: null, tier: 'common' });
    expect(table.map(e => e.itemId)).toContain('item_coin_pouch');
  });
});

describe('rollDynamicLoot — 运行时抽取', () => {
  test('rng 恒为 0（必掉）时返回所有 table 项', () => {
    const table = resolveLootTable({ biome: 'swamp', creatureType: 'beast', tier: 'common' });
    const dropped = rollDynamicLoot({ biome: 'swamp', creatureType: 'beast', tier: 'common' }, () => 0);
    expect(dropped.sort()).toEqual(table.map(e => e.itemId).sort());
  });

  test('rng 恒为 1（必不掉）时返回空', () => {
    const dropped = rollDynamicLoot({ biome: 'swamp', creatureType: 'beast', tier: 'common' }, () => 1);
    expect(dropped).toEqual([]);
  });

  test('1000 次抽样掉率落在 dropRate 附近（统计）', () => {
    const eco = { biome: 'desert', creatureType: 'beast', tier: 'common' };
    const table = resolveLootTable(eco);
    const target = table[0];
    let hits = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const dropped = rollDynamicLoot(eco, Math.random);
      if (dropped.includes(target.itemId)) hits++;
    }
    const observed = hits / N;
    expect(Math.abs(observed - target.dropRate)).toBeLessThan(0.06);  // ±6% 容差
  });
});

describe('inferEcology — 旧数据启发式', () => {
  test('优先用显式 enemy.ecology', () => {
    const eco = inferEcology({ ecology: { biome: 'snowfield', creatureType: 'undead', tier: 'elite' } });
    expect(eco).toEqual({ biome: 'snowfield', creatureType: 'undead', tier: 'elite' });
  });

  test('从 tags + difficulty 提取', () => {
    const eco = inferEcology({ tags: ['swamp', 'beast', 'crocodile'], difficulty: 'hard' });
    expect(eco.biome).toBe('swamp');
    expect(eco.creatureType).toBe('beast');
    expect(eco.tier).toBe('elite');
  });

  test('marsh → swamp、cave → tunnel、frost → snowfield 别名归一', () => {
    expect(inferEcology({ tags: ['marsh', 'beast'] }).biome).toBe('swamp');
    expect(inferEcology({ tags: ['cave', 'bat'] }).biome).toBe('tunnel');
    expect(inferEcology({ tags: ['frost', 'wraith', 'undead'] }).biome).toBe('snowfield');
  });
});

describe('validateEcology + ecologyTags', () => {
  test('合法 ecology 通过', () => {
    expect(validateEcology({ biome: 'swamp', creatureType: 'beast', tier: 'common' }).ok).toBe(true);
  });
  test('非法值报错', () => {
    const r = validateEcology({ biome: 'mars', creatureType: 'alien', tier: 'godlike' });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBe(3);
  });
  test('ecologyTags 摊平为标签集', () => {
    expect(ecologyTags({ biome: 'swamp', creatureType: 'beast', tier: 'boss' }))
      .toEqual(['swamp', 'beast', 'boss']);
    expect(ecologyTags({ biome: 'swamp' })).toEqual(['swamp']);
  });
});

describe('LOOT_POOLS — 数据完整性', () => {
  test('每个池条目都有 item/weight/kind', () => {
    for (const [biome, pool] of Object.entries(LOOT_POOLS)) {
      for (const c of pool) {
        expect(typeof c.item).toBe('string');
        expect(c.weight).toBeGreaterThan(0);
        expect(['common', 'rare', 'consumable']).toContain(c.kind);
      }
    }
  });
});
