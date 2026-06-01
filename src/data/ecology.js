/**
 * 生态位 → 掉落表 → 图像 显式结构层（Phase 28）
 *
 * 把「怪物生态位」这一隐性概念变成一等数据：
 *   ecology = { biome, creatureType, tier }
 *
 * 三者驱动两件事：
 *   1. 掉落表（loot）  —— LOOT_POOLS[biome] 给出主题一致的候选战利品 + 权重 + tier 门槛
 *   2. 图像资源（image）—— biome/creatureType/tier 同时作为 assetLibrary 的匹配标签
 *
 * 设计原则：
 *   - 纯数据 + 纯函数，无任何 import，runtime(ESM) 与 mcp-server(.mjs) 都能直接引用
 *   - 掉落物 id 与 assetLibrary 的 itemAsset('loot-xxx') 生成的 id 对齐：
 *       itemAsset('loot-swamp-leech-fang') → 'item_loot_swamp_leech_fang'
 *     这样烘焙出的 lootTable 既能配图、又能在 preset.items 里被物料化
 *   - resolveLootTable() 用于「生成时静态烘焙」；rollDynamicLoot() 用于「运行时实时抽取」
 */

// ============================================================
// 词表
// ============================================================
export const BIOMES = [
  'forest', 'swamp', 'snowfield', 'desert', 'mountain',
  'tunnel', 'ruins', 'urban', 'wasteland',
];

export const CREATURE_TYPES = [
  'beast', 'humanoid', 'undead', 'construct', 'elemental',
  'spirit', 'insect', 'dragon', 'ooze', 'plant', 'aberration',
];

// tier 从弱到强；同时是掉落门槛（boss-only 战利品要求 tier>=elite）
export const TIERS = ['trivial', 'common', 'elite', 'boss'];

const TIER_RANK = { trivial: 0, common: 1, elite: 2, boss: 3 };

/** difficulty(敌人卡常用) → tier 归一。兼容字符串(easy/normal/hard/boss)与数字(1~5+，AI 生成常用) */
export function difficultyToTier(difficulty) {
  // 数字难度（含数字字符串）：1→trivial, 2→common, 3→elite, ≥4→boss
  if (typeof difficulty === 'number' || (typeof difficulty === 'string' && /^\d+$/.test(difficulty.trim()))) {
    const n = Number(difficulty);
    if (n <= 1) return 'trivial';
    if (n === 2) return 'common';
    if (n === 3) return 'elite';
    return 'boss';
  }
  switch (String(difficulty || '').toLowerCase()) {
    case 'easy': return 'trivial';
    case 'normal': return 'common';
    case 'hard': return 'elite';
    case 'boss': return 'boss';
    default: return 'common';
  }
}

// ============================================================
// 掉落池
//
// 每个候选: { item, weight, kind, minTier?, types? }
//   item    —— 掉落物 id（与 preset.items / assetLibrary 对齐）
//   weight  —— 相对权重（同池内归一）
//   kind    —— 'common'(常见材料) / 'rare'(稀有/任务) / 'consumable'
//   minTier —— 最低 tier 才会出现（如 boss 战利品）
//   types   —— 仅当怪物 creatureType ∈ types 才出现（可选，生态精确化）
// ============================================================
export const LOOT_POOLS = {
  swamp: [
    { item: 'item_loot_swamp_leech_fang', weight: 5, kind: 'common', types: ['beast', 'insect'] },
    { item: 'item_loot_poison_frog_gland', weight: 4, kind: 'common', types: ['beast'] },
    { item: 'item_loot_toxic_slime_core', weight: 4, kind: 'common', types: ['ooze'] },
    { item: 'item_loot_wisp_ember', weight: 3, kind: 'rare', types: ['spirit', 'elemental'] },
    { item: 'item_loot_marsh_herb_bundle', weight: 4, kind: 'consumable' },
    { item: 'item_loot_swamp_lantern', weight: 2, kind: 'rare' },
    { item: 'item_loot_bog_map_fragment', weight: 1, kind: 'rare', minTier: 'elite' },
    { item: 'item_loot_hydra_scale', weight: 3, kind: 'rare', minTier: 'boss' },
  ],
  snowfield: [
    { item: 'item_loot_ice_wolf_pelt', weight: 5, kind: 'common', types: ['beast'] },
    { item: 'item_loot_frost_crystal_shard', weight: 4, kind: 'common', types: ['elemental', 'undead'] },
    { item: 'item_loot_aurora_vial', weight: 2, kind: 'rare' },
    { item: 'item_loot_frozen_rune_stone', weight: 2, kind: 'rare', minTier: 'elite' },
    { item: 'item_loot_snowfield_guide_marker', weight: 2, kind: 'rare' },
    { item: 'item_loot_white_wyrm_scale', weight: 3, kind: 'rare', minTier: 'boss', types: ['dragon'] },
  ],
  mountain: [
    { item: 'item_loot_mountain_goat_horn', weight: 5, kind: 'common', types: ['beast'] },
    { item: 'item_loot_harpy_feather', weight: 4, kind: 'common', types: ['beast'] },
    { item: 'item_loot_crystal_spider_gem', weight: 3, kind: 'common', types: ['beast', 'insect'] },
    { item: 'item_loot_rockslide_stone_heart', weight: 3, kind: 'rare', types: ['elemental', 'construct'] },
    { item: 'item_loot_yeti_horn', weight: 3, kind: 'rare', types: ['beast'], minTier: 'elite' },
    { item: 'item_loot_storm_glass_compass', weight: 2, kind: 'rare' },
    { item: 'item_loot_cliff_rope_bundle', weight: 2, kind: 'consumable' },
    { item: 'item_loot_way_shrine_tablet', weight: 1, kind: 'rare' },
    { item: 'item_loot_mountain_pass_token', weight: 2, kind: 'rare' },
    { item: 'item_loot_white_dragon_claw', weight: 3, kind: 'rare', minTier: 'boss', types: ['dragon'] },
  ],
  desert: [
    { item: 'item_loot_sand_viper_fang', weight: 5, kind: 'common', types: ['beast'] },
    { item: 'item_loot_scarab_shell', weight: 4, kind: 'common', types: ['insect'] },
    { item: 'item_loot_glass_scorpion_stinger', weight: 3, kind: 'common', types: ['beast', 'insect'] },
    { item: 'item_loot_mummy_linen_wrap', weight: 3, kind: 'common', types: ['undead'] },
    { item: 'item_loot_sand_elemental_core', weight: 3, kind: 'rare', types: ['elemental'] },
    { item: 'item_loot_vulture_demon_talon', weight: 3, kind: 'rare', types: ['beast', 'aberration'], minTier: 'elite' },
    { item: 'item_loot_oasis_water_charm', weight: 2, kind: 'rare' },
    { item: 'item_loot_sandworm_tooth', weight: 3, kind: 'rare', minTier: 'boss' },
  ],
  tunnel: [
    { item: 'item_loot_sewer_rat_tail', weight: 5, kind: 'common', types: ['beast'] },
    { item: 'item_loot_cave_bat_wing', weight: 4, kind: 'common', types: ['beast'] },
    { item: 'item_loot_fungal_spore_pod', weight: 4, kind: 'common', types: ['plant', 'beast'] },
    { item: 'item_loot_gray_ooze_residue', weight: 4, kind: 'common', types: ['ooze'] },
    { item: 'item_loot_cultist_ritual_dagger', weight: 2, kind: 'rare', types: ['humanoid'] },
    { item: 'item_loot_burrower_chitin_plate', weight: 3, kind: 'rare', types: ['beast', 'insect'], minTier: 'elite' },
    { item: 'item_loot_sewer_valve_wheel', weight: 2, kind: 'consumable' },
    { item: 'item_loot_rune_brick', weight: 2, kind: 'rare' },
    { item: 'item_loot_eye_horror_lens', weight: 3, kind: 'rare', minTier: 'boss', types: ['aberration'] },
  ],
  ruins: [
    { item: 'item_loot_rusted_gear', weight: 5, kind: 'common', types: ['construct'] },
    { item: 'item_loot_ancient_city_coin', weight: 4, kind: 'common' },
    { item: 'item_loot_salvage_crate', weight: 4, kind: 'common' },
    { item: 'item_loot_construct_power_core', weight: 3, kind: 'rare', types: ['construct'], minTier: 'elite' },
    { item: 'item_loot_old_district_key', weight: 2, kind: 'rare' },
    { item: 'item_loot_archive_seal', weight: 2, kind: 'rare' },
    { item: 'item_loot_broken_statue_hand', weight: 2, kind: 'rare' },
  ],
};

/**
 * 通用池 —— 不分 biome，所有生态都可掉（金币 / 通用药水）
 * 这些 id 引用 assetLibrary 的常驻物品（必定存在于大多数 preset）
 */
export const UNIVERSAL_LOOT = [
  { item: 'item_coin_pouch', weight: 6, kind: 'common' },
  { item: 'item_healing_potion', weight: 3, kind: 'consumable' },
];

// ============================================================
// dropRate 基准：按 kind × tier 给一个掉率，tier 越高掉率/数量越高
// ============================================================
const BASE_DROP_RATE = {
  common: { trivial: 0.45, common: 0.55, elite: 0.7, boss: 0.85 },
  rare: { trivial: 0.05, common: 0.12, elite: 0.25, boss: 0.6 },
  consumable: { trivial: 0.25, common: 0.35, elite: 0.45, boss: 0.6 },
};

/** 一个 tier 最多产出多少条 lootTable 项（控制掉落规模） */
const TIER_LOOT_CAP = { trivial: 2, common: 3, elite: 4, boss: 6 };

// ============================================================
// 候选筛选
// ============================================================
function poolFor(biome) {
  return LOOT_POOLS[biome] || [];
}

/** 给定生态位，返回符合 tier/type 门槛的候选（含通用池） */
export function candidatesFor({ biome, creatureType, tier = 'common' } = {}) {
  const rank = TIER_RANK[tier] ?? 1;
  const matchType = (c) => !c.types || (creatureType && c.types.includes(creatureType));
  const matchTier = (c) => !c.minTier || rank >= (TIER_RANK[c.minTier] ?? 0);

  const biomeCands = poolFor(biome).filter(c => matchType(c) && matchTier(c));
  // 通用池始终参与，但不重复 biome 已有的
  const seen = new Set(biomeCands.map(c => c.item));
  const universal = UNIVERSAL_LOOT.filter(c => !seen.has(c.item) && matchTier(c));
  return [...biomeCands, ...universal];
}

// ============================================================
// 1) 生成时静态烘焙：resolveLootTable
//    输出 combat 现有消费格式 [{ itemId, dropRate }]
// ============================================================
export function resolveLootTable({ biome, creatureType, tier = 'common', luck = 0 } = {}) {
  const cands = candidatesFor({ biome, creatureType, tier });
  if (cands.length === 0) return [];

  const cap = TIER_LOOT_CAP[tier] ?? 3;
  // 按权重降序挑前 cap 个（boss 多、杂兵少），保证"重要战利品"稳定出现
  const ranked = [...cands].sort((a, b) => (b.weight || 1) - (a.weight || 1)).slice(0, cap);

  const luckBonus = Math.max(0, Math.min(0.2, (luck || 0) * 0.01)); // luck 每点 +1% 掉率，封顶 +20%
  return ranked.map(c => {
    const base = (BASE_DROP_RATE[c.kind] || BASE_DROP_RATE.common)[tier] ?? 0.3;
    const rate = Math.max(0.01, Math.min(1, +(base + luckBonus).toFixed(3)));
    return { itemId: c.item, dropRate: rate };
  });
}

// ============================================================
// 2) 运行时实时抽取：rollDynamicLoot
//    每次击杀独立掷骰，返回实际掉落的 itemId 列表
//    rng: () => [0,1) 可注入（测试用），默认 Math.random
// ============================================================
export function rollDynamicLoot({ biome, creatureType, tier = 'common', luck = 0 } = {}, rng = Math.random) {
  const table = resolveLootTable({ biome, creatureType, tier, luck });
  const dropped = [];
  for (const entry of table) {
    if (rng() <= entry.dropRate) dropped.push(entry.itemId);
  }
  return dropped;
}

// ============================================================
// 3) 图像匹配辅助：把生态位摊平成 assetLibrary 可用的标签集
// ============================================================
export function ecologyTags({ biome, creatureType, tier } = {}) {
  return [biome, creatureType, tier].filter(Boolean);
}

/**
 * 从一张敌人卡推断生态位（用于旧数据 / 未显式标注的敌人）
 * 优先用显式 enemy.ecology，否则从 tags + difficulty 启发式提取
 */
export function inferEcology(enemy = {}) {
  if (enemy.ecology && enemy.ecology.biome) return { ...enemy.ecology };
  const tags = (enemy.tags || []).map(t => String(t).toLowerCase());
  const biome = BIOMES.find(b => tags.includes(b))
    || (tags.includes('marsh') ? 'swamp' : null)
    || (tags.includes('cave') || tags.includes('sewer') || tags.includes('underground') ? 'tunnel' : null)
    || (tags.includes('snow') || tags.includes('ice') || tags.includes('frost') ? 'snowfield' : null);
  const creatureType = CREATURE_TYPES.find(t => tags.includes(t)) || null;
  const tier = difficultyToTier(enemy.difficulty);
  return { biome: biome || null, creatureType, tier };
}

/** 校验一个 ecology 对象，返回 { ok, errors[] } */
export function validateEcology(eco = {}) {
  const errors = [];
  if (eco.biome && !BIOMES.includes(eco.biome)) errors.push(`未知 biome: ${eco.biome}`);
  if (eco.creatureType && !CREATURE_TYPES.includes(eco.creatureType)) errors.push(`未知 creatureType: ${eco.creatureType}`);
  if (eco.tier && !TIERS.includes(eco.tier)) errors.push(`未知 tier: ${eco.tier}`);
  return { ok: errors.length === 0, errors };
}
