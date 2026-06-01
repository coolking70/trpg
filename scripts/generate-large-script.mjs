#!/usr/bin/env node
/**
 * 大型剧本压力测试生成器
 *
 * 程序化生成一份 100+ 场景的剧本：「永燃之冠 (The Eternal Crown)」
 *
 * 结构：
 *   - 5 章主线（每章 5-8 个 main 节点）
 *   - 3 个城镇 hub（各 6-10 子场景）
 *   - 3 个野外区域（各 8-12 节点）
 *   - 2 个 dungeon
 *   - 4 个结局
 *   - 22 NPC，4 可招募
 *   - ~30 物品 / ~20 敌人 / ~150 事件
 *
 * 落盘到 presets/eternal-crown-stress-test.json
 *
 * 用法：
 *   node scripts/generate-large-script.mjs
 *   node scripts/generate-large-script.mjs --validate   # 同时跑 MCP 体检
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'presets', 'eternal-crown-stress-test.json');
const MCP_SERVER = path.join(ROOT, 'mcp-server', 'preset-server.mjs');

// ============================================================
// Preset 骨架
// ============================================================
const preset = {
  version: '1.0.0',
  presetId: 'eternal_crown_stress',
  name: '永燃之冠',
  author: 'AI 压力测试',
  createdAt: new Date().toISOString(),
  description: '一份用于压测 Phase 19-25 全部基础设施的中世纪奇幻剧本：5 章主线 / 3 城镇 / 多区域 / 4 结局 / 22 NPC 关系网。',
  lore: {
    worldName: '艾尔西亚',
    era: '王冠陨落之后的第三百二十年',
    background: '远古龙王封印将解。星辰塔的守护者已死，唯一能再封龙王的"永燃之冠"散作三份，沉睡于王国各处。你被选中（或被命运裹挟）去寻回它。',
    rules: '所有死亡都有重量。NPC 会记得你做过的事。三块冠片可以全部找到也可以放弃任何一块——结局各不相同。',
    gmStyle: '凝练，给玩家留白；战斗描述偏写实，情感处用诗意。',
  },
  characters: [],
  enemies: [],
  items: [],
  events: [],
  scenes: [],
  npcs: [],
  npcRelations: [],
  startingOptions: null,
  startingSceneRules: [],
  combatMode: 'solo',
  aiHooks: {
    sceneArrival: 'optional', eventResolve: 'optional',
    npcDialogue: 'optional', vignette: 'never', worldRipple: 'optional',
  },
  startingSceneId: null,
  displayMode: 'scene-graph',
  rules: { diceType: 'd20', combatFormula: '(attack + dice) - defense', maxPartySize: 4, startingGold: 80 },
  aiConfig: { temperature: 0.7, maxResponseTokens: 1000, useStructuredOutput: true, language: 'zh-CN' },
};

// ============================================================
// 辅助：坐标分配（按区域分片，避免冲突）
// ============================================================
const usedCoords = new Set();
function coord(x, y) {
  let k = `${x},${y}`;
  let dx = 0;
  while (usedCoords.has(k)) {
    dx++;
    k = `${x + dx},${y}`;
  }
  usedCoords.add(k);
  const [fx, fy] = k.split(',').map(Number);
  return { x: fx, y: fy };
}

function scene(id, name, type, opts = {}) {
  preset.scenes.push({
    id, name, type,
    icon: opts.icon || '',
    description: opts.description || '',
    coords: opts.coords || coord(opts.x ?? 0, opts.y ?? 0),
    connections: [],
    events: opts.events || [],
    vignettes: opts.vignettes || [],
    tags: opts.tags || [],
    ...(opts.variants ? { variants: opts.variants } : {}),
  });
}

function connect(fromId, toId, label, opts = {}) {
  const from = preset.scenes.find(s => s.id === fromId);
  const to = preset.scenes.find(s => s.id === toId);
  if (!from || !to) throw new Error(`connect: 不存在的场景 ${fromId} 或 ${toId}`);
  from.connections.push({ to: toId, label, ...(opts.gated ? { gated: opts.gated } : {}), ...(opts.discovered === false ? { discovered: false } : {}) });
  if (!opts.oneWay) {
    to.connections.push({ to: fromId, label: opts.returnLabel || `返回 ${from.name}` });
  }
}

function attachEvent(sceneId, eventId) {
  const s = preset.scenes.find(s => s.id === sceneId);
  if (!s) throw new Error(`attachEvent: 不存在 ${sceneId}`);
  if (!s.events.includes(eventId)) s.events.push(eventId);
}

// ============================================================
// 辅助：实体构造
// ============================================================
function character(id, name, opts = {}) {
  const stats = {
    hp: 100, mp: 30, attack: 12, defense: 8,
    magicAttack: 6, magicDefense: 8, speed: 10, luck: 5,
    ...(opts.stats || {}),
  };
  preset.characters.push({
    id, type: 'character',
    name, title: opts.title || '',
    description: opts.description || '',
    stats: { ...stats, hpCurrent: stats.hp, mpCurrent: stats.mp },
    abilities: opts.abilities || [],
    inventory: opts.inventory || [],
    equipment: opts.equipment || { weapon: null, armor: null, accessory: null },
    position: { x: 0, y: 0 },
    level: opts.level || 1,
    experience: 0,
    statusEffects: [],
    tags: opts.tags || [],
    notes: '',
  });
}

function enemy(id, name, opts = {}) {
  const stats = {
    hp: 40, mp: 0, attack: 10, defense: 6,
    magicAttack: 0, magicDefense: 4, speed: 8, luck: 1,
    ...(opts.stats || {}),
  };
  preset.enemies.push({
    id, type: 'enemy', name,
    description: opts.description || '',
    stats: { ...stats, hpCurrent: stats.hp, mpCurrent: stats.mp },
    abilities: opts.abilities || [],
    lootTable: opts.lootTable || [],
    behaviorHint: opts.behaviorHint || 'aggressive',
    experienceReward: opts.exp || 20,
    difficulty: opts.difficulty || 'normal',
    position: { x: 0, y: 0 },
    statusEffects: [],
    tags: opts.tags || [],
    notes: '',
  });
}

function item(id, name, itemType, opts = {}) {
  preset.items.push({
    id, type: 'item', name, itemType,
    description: opts.description || '',
    equipSlot: opts.equipSlot ?? (itemType === 'weapon' ? 'weapon' : itemType === 'armor' ? 'armor' : itemType === 'accessory' ? 'accessory' : null),
    statModifiers: opts.statModifiers || {},
    consumeEffect: opts.consumeEffect || null,
    buyPrice: opts.buyPrice || 0,
    sellPrice: opts.sellPrice || 0,
    stackable: opts.stackable ?? ['consumable', 'material'].includes(itemType),
    tags: opts.tags || [],
  });
}

function event(id, name, opts = {}) {
  const choices = (opts.choices || []).map((c, i) => ({
    id: c.id || `choice_${i + 1}`,
    text: c.text,
    requirements: null,
    outcomes: (c.outcomes || []).map(o => ({
      probability: o.probability ?? 1.0,
      text: o.text,
      effects: o.effects || [],
    })),
  }));
  preset.events.push({
    id, type: 'event', name,
    description: opts.description || '',
    eventType: opts.eventType || 'story',
    priority: opts.priority ?? 50,
    trigger: {
      type: 'composite',
      condition: {
        ...(opts.inScene ? { inScene: opts.inScene } : {}),
        ...(opts.requireVariables ? { requireVariables: opts.requireVariables } : {}),
        ...(opts.requireCompletedEvents ? { requireCompletedEvents: opts.requireCompletedEvents } : {}),
        excludeCompletedEvents: opts.excludeCompletedEvents || [id],
        probability: opts.probability ?? 1.0,
      },
    },
    choices,
    repeatable: opts.repeatable || false,
    maxOccurrences: opts.repeatable ? 99 : 1,
    aiPromptHint: opts.aiPromptHint || '',
    tags: opts.tags || [],
    notes: '',
  });
  if (opts.inScene) opts.inScene.forEach(sid => attachEvent(sid, id));
}

function npc(id, name, opts = {}) {
  preset.npcs.push({
    id, type: 'npc', name,
    title: opts.title || '',
    description: opts.description || '',
    icon: opts.icon || '🧑',
    personality: opts.personality || '',
    recruitable: !!opts.recruitable,
    spawnScene: opts.spawnScene,
    initialInventory: opts.initialInventory || [],
    giftPreferences: opts.giftPreferences || {},
    schedule: opts.schedule || [],
    stats: opts.stats,
    abilities: opts.abilities || [],
    dialogueTree: opts.dialogueTree || null,
    tags: opts.tags || [],
  });
}

function npcRel(from, to, strength, note = '') {
  preset.npcRelations.push({ from, to, strength, note });
}

// ============================================================
// 1. 角色创建选项（4 轴）
// ============================================================
preset.startingOptions = {
  races: [
    { id: 'human',   name: '人类',  icon: '👤', tags: ['race:human'],   description: '适应力极强，无明显短板。' },
    { id: 'elf',     name: '高精灵', icon: '🧝', tags: ['race:elf', 'longevity'], statBonus: { magicAttack: 4, hp: -10 }, description: '魔法亲和深厚，身体相对脆弱。' },
    { id: 'dwarf',   name: '山地矮人', icon: '🧔', tags: ['race:dwarf', 'hardy'], statBonus: { defense: 3, speed: -1, hp: 15 }, description: '体格坚韧，行动稍慢。' },
    { id: 'tiefling', name: '魅魔裔', icon: '😈', tags: ['race:tiefling', 'cursed_blood'], statBonus: { magicAttack: 2, luck: -1 }, description: '血脉带着古老的诅咒，被排斥也被需要。' },
  ],
  origins: [
    { id: 'noble',  name: '没落贵族', icon: '👑', tags: ['origin:noble', 'literate', 'wealthy:start'], description: '家道中落，但仍受礼敬。' },
    { id: 'orphan', name: '街头孤儿', icon: '🥀', tags: ['origin:orphan', 'street_wise'], statBonus: { speed: 2 }, description: '在阴影里长大。' },
    { id: 'farmer', name: '农夫', icon: '🌾', tags: ['origin:farmer'], statBonus: { hp: 15 }, description: '体格朴实，重情重义。' },
    { id: 'exile',  name: '流亡者', icon: '🚶', tags: ['origin:exile', 'wary'], statBonus: { luck: 2 }, description: '被故乡逐出，习惯了独自。' },
  ],
  backgrounds: [
    { id: 'soldier',  name: '退伍士兵', icon: '⚔', tags: ['bg:soldier', 'weapon_trained'], statBonus: { attack: 3, defense: 1 }, description: '武艺娴熟。' },
    { id: 'scholar',  name: '学者', icon: '📚', tags: ['bg:scholar', 'literate', 'arcane_lore'], statBonus: { magicAttack: 3 }, description: '博览群书，懂古语。' },
    { id: 'thief',    name: '盗贼', icon: '🗡', tags: ['bg:thief', 'lock_pick'], statBonus: { speed: 2, luck: 2 }, description: '手快眼疾。' },
    { id: 'priest',   name: '行游教士', icon: '🙏', tags: ['bg:priest', 'holy'], statBonus: { magicDefense: 3 }, description: '神圣低语者。' },
  ],
  faiths: [
    { id: 'sun',  name: '太阳神 索拉里斯', icon: '☀', tags: ['faith:sun', 'holy'], description: '正义、光明与誓约。' },
    { id: 'moon', name: '月神 露娜里斯',   icon: '🌙', tags: ['faith:moon', 'arcane'], description: '神秘、变化与梦境。' },
    { id: 'earth', name: '地母 伽娅',     icon: '🌳', tags: ['faith:earth', 'natural'], description: '土地、生命与循环。' },
    { id: 'none', name: '无信仰',          icon: '🚫', tags: ['faith:none', 'skeptic'], description: '只信自己的剑。' },
  ],
};

preset.startingSceneRules = [
  { when: { tags: ['origin:noble']  }, sceneId: 'scene_noble_manor' },
  { when: { tags: ['origin:orphan'] }, sceneId: 'scene_alley_dawn' },
  { when: { tags: ['origin:exile']  }, sceneId: 'scene_exile_camp' },
  { default: 'scene_farm_morning' },
];

// ============================================================
// 2. 物品
// ============================================================
// 起始装备 + 中后期升级链
item('item_iron_sword',     '铁剑',     'weapon',    { statModifiers: { attack: 5 }, buyPrice: 50, description: '普通的铁制单手剑。' });
item('item_silver_sword',   '银剑',     'weapon',    { statModifiers: { attack: 9 }, buyPrice: 200, description: '锋利的银制长剑，对不洁之物伤害加倍。' });
item('item_runed_blade',    '符文之刃', 'weapon',    { statModifiers: { attack: 14, magicAttack: 5 }, buyPrice: 600, tags: ['rune', 'enchanted'] });
item('item_leather_armor',  '皮甲',     'armor',     { statModifiers: { defense: 3 }, buyPrice: 40 });
item('item_chainmail',      '锁子甲',   'armor',     { statModifiers: { defense: 7, speed: -1 }, buyPrice: 200 });
item('item_dragon_scale',   '龙鳞胸甲', 'armor',     { statModifiers: { defense: 12, magicDefense: 6 }, buyPrice: 800, tags: ['legendary'] });
item('item_pendant_sun',    '太阳坠',   'accessory', { statModifiers: { magicDefense: 4 }, tags: ['holy'] });
item('item_pendant_moon',   '月之印',   'accessory', { statModifiers: { magicAttack: 4 }, tags: ['arcane'] });

// 消耗品
item('item_potion_minor',   '小治疗药水', 'consumable', { consumeEffect: { type: 'heal', stat: 'hp', value: 30 }, buyPrice: 15 });
item('item_potion_major',   '强效药水',   'consumable', { consumeEffect: { type: 'heal', stat: 'hp', value: 80 }, buyPrice: 60 });
item('item_mana_potion',    '法力药水',   'consumable', { consumeEffect: { type: 'heal', stat: 'mp', value: 25 }, buyPrice: 30 });
item('item_antidote',       '解毒剂',     'consumable', { buyPrice: 20 });
item('item_apple',          '苹果',       'consumable', { consumeEffect: { type: 'heal', stat: 'hp', value: 10 }, buyPrice: 2, tags: ['food'] });
item('item_bread',          '面包',       'consumable', { consumeEffect: { type: 'heal', stat: 'hp', value: 15 }, buyPrice: 4, tags: ['food'] });

// 材料
item('item_goblin_ear',     '哥布林之耳', 'material', { sellPrice: 5, tags: ['monster_part'] });
item('item_wolf_pelt',      '狼皮',       'material', { sellPrice: 12 });
item('item_iron_ore',       '铁矿',       'material', { sellPrice: 8, tags: ['metal'] });
item('item_silver_ore',     '银矿',       'material', { sellPrice: 20, tags: ['metal'] });
item('item_dragon_bone',    '龙骨残片',   'material', { sellPrice: 150, tags: ['legendary', 'dragon'] });
item('item_moonshade',      '月影草',     'material', { sellPrice: 18, tags: ['herb'] });

// 任务物品
item('item_crown_piece_a', '永燃之冠：火心', 'quest', { description: '冠之中央，温暖如尚有龙王心跳。', tags: ['crown_piece', 'main'] });
item('item_crown_piece_b', '永燃之冠：霜环', 'quest', { description: '蓝白色的细环，触手生寒。', tags: ['crown_piece', 'main'] });
item('item_crown_piece_c', '永燃之冠：星顶', 'quest', { description: '镶有七颗碎星，夜里会自发微光。', tags: ['crown_piece', 'main'] });
item('item_old_letter',    '父亲的信',     'quest', { description: '一封写于五年前的信。' });
item('item_seal_key',      '塔楼封印钥', 'quest', { description: '黑檀木制成，钥齿是星形的。' });
item('item_proof_of_kin',  '家族纹章',   'quest', { description: '只剩半枚的银纹章。' });
item('item_journal_witch', '巫女手记',   'quest', { description: '一本被泪水浸湿的羊皮纸日志。' });
item('item_mark_of_dragon','龙印',       'quest', { description: '被龙气浸染的青铜小印。' });

// ============================================================
// 3. 敌人
// ============================================================
enemy('enemy_goblin_scout',  '哥布林斥候', { stats: { hp: 30, attack: 8, defense: 4, speed: 12 }, exp: 8,  difficulty: 'easy',   lootTable: [{ itemId: 'item_goblin_ear', dropRate: 0.6 }] });
enemy('enemy_goblin_archer', '哥布林弓手', { stats: { hp: 25, attack: 11, defense: 3 }, exp: 10, difficulty: 'easy',   lootTable: [{ itemId: 'item_goblin_ear', dropRate: 0.5 }] });
enemy('enemy_goblin_shaman', '哥布林萨满', { stats: { hp: 35, attack: 6, defense: 4, magicAttack: 12 }, exp: 14, difficulty: 'normal' });
enemy('enemy_goblin_chief',  '哥布林头目', { stats: { hp: 80, attack: 14, defense: 8, hpCurrent: 80 }, exp: 40, difficulty: 'hard', lootTable: [{ itemId: 'item_iron_sword', dropRate: 0.4 }] });
enemy('enemy_wolf',          '森林狼',    { stats: { hp: 35, attack: 10, defense: 3, speed: 14 }, exp: 12, difficulty: 'easy',   lootTable: [{ itemId: 'item_wolf_pelt', dropRate: 0.7 }] });
enemy('enemy_wolf_alpha',    '狼王',      { stats: { hp: 90, attack: 16, defense: 8, speed: 16 }, exp: 50, difficulty: 'hard',   lootTable: [{ itemId: 'item_wolf_pelt', dropRate: 1.0 }] });
enemy('enemy_bandit',        '强盗',      { stats: { hp: 40, attack: 12, defense: 6 }, exp: 15 });
enemy('enemy_bandit_captain','强盗头子',  { stats: { hp: 110, attack: 18, defense: 9 }, exp: 60, difficulty: 'hard' });
enemy('enemy_marsh_lurker',  '沼泽潜行者', { stats: { hp: 50, attack: 14, defense: 5, magicDefense: 8 }, exp: 18 });
enemy('enemy_swamp_witch',   '沼泽女巫',  { stats: { hp: 60, attack: 8, defense: 4, magicAttack: 18, magicDefense: 12 }, exp: 30 });
enemy('enemy_skeleton',      '骷髅战士',  { stats: { hp: 45, attack: 11, defense: 7 }, exp: 16, tags: ['undead'] });
enemy('enemy_lich',          '巫妖',      { stats: { hp: 150, attack: 12, defense: 10, magicAttack: 22, magicDefense: 18 }, exp: 80, difficulty: 'boss', tags: ['undead', 'boss'] });
enemy('enemy_drake',         '小型龙崽',  { stats: { hp: 70, attack: 14, defense: 8, magicDefense: 6 }, exp: 35, tags: ['dragon'] });
enemy('enemy_drake_alpha',   '岩龙',      { stats: { hp: 170, attack: 16, defense: 14, magicAttack: 8 }, exp: 100, difficulty: 'boss', tags: ['dragon', 'boss'], lootTable: [{ itemId: 'item_dragon_bone', dropRate: 1.0 }] });
enemy('enemy_void_thing',    '虚空之物',  { stats: { hp: 200, attack: 16, defense: 12, magicAttack: 14 }, exp: 150, difficulty: 'boss', tags: ['void', 'boss'] });
enemy('enemy_dragon_king',   '龙王 厄尼斯', {
  // 平衡（2 人队基线）：基础与阶段加成下调，使满血能"带活口取胜"而非惨胜灭团
  stats: { hp: 280, attack: 19, defense: 22, magicAttack: 18, magicDefense: 22, speed: 14 },
  exp: 500, difficulty: 'boss', tags: ['dragon', 'boss', 'final'],
  abilities: [
    { id: 'dk_claw', name: '巨爪挥击', type: 'active',
      effect: { damage: { formula: 'attack+2d8' }, applyStatus: { type: 'debuff', stat: 'defense', value: 4, duration: 2 } } },
  ],
  // Phase 26C — 三阶段 boss（加成已软化）
  phases: [
    { id: 'rage_75', hpThreshold: 0.75, statBoosts: { attack: 3 },
      narrative: '⚡ 龙王厄尼斯怒吼，鳞片下渗出灼热的红光——它进入愤怒状态！' },
    { id: 'rage_50', hpThreshold: 0.50, statBoosts: { speed: 6, attack: 2 },
      abilities: [{ id: 'dk_breath', name: '龙息（群攻）', type: 'active',
        effect: { damage: { formula: '2d8+8' }, aoe: true, target: 'all_enemies' } }],
      narrative: '🔥 龙王张开獠牙，焦黑的浓烟从喉咙深处升起——龙息要来了！' },
    { id: 'desperate_25', hpThreshold: 0.25, statBoosts: { defense: -8, attack: 5 },
      abilities: [{ id: 'dk_final', name: '末日狂吟', type: 'active',
        effect: { damage: { formula: '2d10+12' }, aoe: true, target: 'all_enemies',
                  applyStatus: { type: 'dot', stat: 'hp', value: 6, duration: 3 } } }],
      narrative: '☠ 龙王身上裂出黑色伤口，它已无后退——这是最后的一搏！' },
  ],
});
enemy('enemy_corrupt_guard', '腐化守卫',  { stats: { hp: 70, attack: 16, defense: 12 }, exp: 25 });
enemy('enemy_giant_spider',  '巨蜘蛛',    { stats: { hp: 55, attack: 13, defense: 5 }, exp: 18 });
enemy('enemy_cave_troll',    '洞穴巨魔',  { stats: { hp: 140, attack: 22, defense: 10 }, exp: 70, difficulty: 'hard' });

// ============================================================
// 4. 角色（默认主角 + 后续可招募 companion 用 character_create 也行，但我们走 NPC.recruitable）
// ============================================================
character('char_protagonist', '冒险者', {
  title: '受命者',
  description: '被先知指认为"承继冠者"的人。出身、背景由玩家选择决定。',
  stats: { hp: 140, mp: 40, attack: 15, defense: 11, magicAttack: 8, magicDefense: 10, speed: 11, luck: 6 },
  abilities: [
    { id: 'ability_strike',  name: '强袭',  type: 'active', cost: { mp: 5 }, cooldown: 0,
      description: '一次蓄力的强力斩击。', effect: { damage: { formula: 'attack+2d6+5' } } },
    { id: 'ability_focus',   name: '集中',  type: 'active', cost: { mp: 0 }, cooldown: 1,
      description: '稳住呼吸，下一击必中。', effect: { damage: { formula: 'attack+d8+3' } } },
    { id: 'ability_recover', name: '小息',  type: 'active', cost: { mp: 8 }, cooldown: 2,
      description: '运行内息回复 30 HP。', effect: { heal: { formula: '30' } } },
    { id: 'ability_resolve', name: '不屈',  type: 'passive', cost: { mp: 0 }, cooldown: 0,
      description: 'HP 低于 30% 时防御+3。' },
  ],
  inventory: ['item_iron_sword', 'item_potion_minor', 'item_potion_minor', 'item_bread'],
  equipment: { weapon: 'item_iron_sword', armor: 'item_leather_armor', accessory: null },
});

// 起始小伙伴 — 一个忠诚的扈从，让早期战斗有最低限度的双人配置
character('char_squire', '芬恩', {
  title: '扈从',
  description: '一直跟着你的少年扈从。瘦小但敏捷，会一点剑术和点小法术。',
  stats: { hp: 90, mp: 25, attack: 10, defense: 8, magicAttack: 6, magicDefense: 7, speed: 12, luck: 5 },
  abilities: [
    { id: 'squire_slash',   name: '斩击',   type: 'active', cost: { mp: 4 }, effect: { damage: { formula: 'attack+d8+2' } } },
    { id: 'squire_bind',    name: '裹伤',   type: 'active', cost: { mp: 6 }, cooldown: 2, effect: { heal: { formula: '20' } } },
    { id: 'squire_quick',   name: '速攻',   type: 'active', cost: { mp: 3 }, effect: { damage: { formula: 'attack+d6+1' } } },
  ],
  inventory: ['item_potion_minor'],
  equipment: { weapon: null, armor: 'item_leather_armor', accessory: null },
});

// ============================================================
// 5. 场景：起始 spawn × 4（按出身分流）
// ============================================================
scene('scene_noble_manor',     '没落庄园',       'spawn', { icon: '🏛', x: -10, y: 0, tags: ['safe', 'main'],
  description: '清晨。家族庄园的钟仍能敲响，但仆人只剩老门房一个。父亲的最后一封信摊在桌上。',
  vignettes: ['老门房在打瞌睡。'] });
scene('scene_alley_dawn',      '黎明小巷',       'spawn', { icon: '🌃', x: -10, y: 2, tags: ['safe', 'main'],
  description: '湿漉漉的石板路，雨水里漂着昨晚某人的酒瓶。你蜷缩在屋檐下，盘算下一顿饭。' });
scene('scene_exile_camp',      '边境流亡营',     'spawn', { icon: '⛺', x: -10, y: 4, tags: ['safe', 'main'],
  description: '风口上的小帐篷。远处是国境线，更远处是你已不能回去的故乡。' });
scene('scene_farm_morning',    '田园清晨',       'spawn', { icon: '🌾', x: -10, y: 6, tags: ['safe', 'main'],
  description: '麦穗在风里波动。今天又是寻常的一天——直到你看见远处天空有什么东西在燃烧。' });

// 把起始事件占位写出来（事件本体后面统一定义）
attachEvent('scene_noble_manor', 'ev_intro_noble');
attachEvent('scene_alley_dawn', 'ev_intro_orphan');
attachEvent('scene_exile_camp', 'ev_intro_exile');
attachEvent('scene_farm_morning', 'ev_intro_farmer');

// ============================================================
// 6. 场景：第一城镇 Astralhaven（12 子场景）
// ============================================================
const ASTRA_X = 0;
const ASTRA = {
  square:    'scene_astra_square',
  inn:       'scene_astra_inn',
  smithy:    'scene_astra_smithy',
  market:    'scene_astra_market',
  temple:    'scene_astra_temple',
  mage:      'scene_astra_mage_shop',
  guild:     'scene_astra_guild',
  gate_n:    'scene_astra_gate_n',
  gate_s:    'scene_astra_gate_s',
  well:      'scene_astra_well',
  library:   'scene_astra_library',
  thieves:   'scene_astra_thieves_den',
};

scene(ASTRA.square,  '阿斯特拉广场', 'settlement', { icon: '🏘', x: ASTRA_X, y: 0,
  description: '阿斯特拉哈文城的中心。雨过后湿漉漉的石板上反着工匠木牌的光。',
  tags: ['safe', 'main', 'hub'], vignettes: ['广场依旧热闹。', '钟楼的钟刚刚敲过整点。'] });
scene(ASTRA.inn,     '夜风旅馆',     'inn',        { icon: '🛏', x: ASTRA_X - 1, y: 1, tags: ['safe', 'inn', 'camp'],
  description: '木梁低矮，炉火烧得旺。老板娘玛雅正在擦杯子。' });
scene(ASTRA.smithy,  '布朗铁铺',     'settlement', { icon: '🔨', x: ASTRA_X + 1, y: 1, tags: ['safe', 'shop'],
  description: '锤声震耳。老布朗的脸被火光映得通红。' });
scene(ASTRA.market,  '集市',         'settlement', { icon: '🏬', x: ASTRA_X, y: -1, tags: ['safe', 'shop'],
  description: '一排摊位，从香料到二手匕首应有尽有。', vignettes: ['集市照常喧闹。'] });
scene(ASTRA.temple,  '索拉里斯神殿', 'settlement', { icon: '⛪', x: ASTRA_X - 2, y: 0, tags: ['safe', 'temple'],
  description: '阳光透过彩窗。年迈的祭司艾兰正在擦拭祭坛。' });
scene(ASTRA.mage,    '银月法师店',   'settlement', { icon: '🔮', x: ASTRA_X + 2, y: 0, tags: ['safe', 'shop', 'arcane'],
  description: '弥漫着草药与硫磺的香气。柜台后是冷淡的精灵法师赛拉。' });
scene(ASTRA.guild,   '冒险者公会',   'settlement', { icon: '⚔', x: ASTRA_X - 1, y: -1, tags: ['safe', 'main', 'hub'],
  description: '公告板钉满了任务。前台是个戴着眼镜的精瘦男人，叫加尔德。' });
scene(ASTRA.gate_n,  '北门',         'settlement', { icon: '🏰', x: ASTRA_X, y: -2, tags: ['safe', 'main'],
  description: '北门通向广袤的黑松林。' });
scene(ASTRA.gate_s,  '南门',         'settlement', { icon: '🏰', x: ASTRA_X, y: 2,  tags: ['safe', 'main'],
  description: '南门通向沼泽与古道。' });
scene(ASTRA.well,    '古井',         'vignette',   { icon: '💧', x: ASTRA_X + 1, y: -1, tags: ['safe'],
  description: '城里最老的井，井沿被打满了刻痕。', vignettes: ['井水深而清。'] });
scene(ASTRA.library, '王立图书馆',   'settlement', { icon: '📚', x: ASTRA_X - 2, y: -1, tags: ['safe', 'arcane'],
  description: '高耸的书架直达穹顶。馆长哈罗德在写着什么。' });
scene(ASTRA.thieves, '盗贼地窖',     'dungeon',    { icon: '🗝', x: ASTRA_X + 2, y: 1, tags: ['hidden'],
  description: '潮湿的地下通道。空气里有金属和血的气息。' });

// 城内连接（hub-style）
connect(ASTRA.square, ASTRA.inn,    '走进旅馆');
connect(ASTRA.square, ASTRA.smithy, '走向铁铺');
connect(ASTRA.square, ASTRA.market, '走向集市');
connect(ASTRA.square, ASTRA.temple, '走进神殿');
connect(ASTRA.square, ASTRA.mage,   '推开法师店的门');
connect(ASTRA.square, ASTRA.guild,  '走向冒险者公会');
connect(ASTRA.square, ASTRA.gate_n, '走向北门');
connect(ASTRA.square, ASTRA.gate_s, '走向南门');
connect(ASTRA.market, ASTRA.well,   '绕到井边');
connect(ASTRA.temple, ASTRA.library, '走进图书馆');
// 隐藏的盗贼地窖入口
connect(ASTRA.market, ASTRA.thieves, '从集市暗格挤进去', { discovered: false });

// 起始 spawn 连到 Astralhaven
connect('scene_noble_manor',  ASTRA.square, '骑马进城');
connect('scene_alley_dawn',   ASTRA.square, '溜进广场');
connect('scene_exile_camp',   ASTRA.square, '入境进城');
connect('scene_farm_morning', ASTRA.square, '搭车进城');

// ============================================================
// 7. 黑松林（13 节点）
// ============================================================
const THORN = {
  edge:     'scene_thorn_edge',
  path:     'scene_thorn_path',
  fork:     'scene_thorn_fork',
  glade:    'scene_thorn_glade',
  shrine:   'scene_thorn_shrine',
  ravine:   'scene_thorn_ravine',
  hut:      'scene_thorn_hut',
  ruins:    'scene_thorn_ruins',
  cliff:    'scene_thorn_cliff',
  brook:    'scene_thorn_brook',
  camp:     'scene_thorn_camp',
  hidden_grove: 'scene_thorn_hidden_grove',
  goblin_cave_entry: 'scene_goblin_entry',
};
scene(THORN.edge,    '林缘',     'wilderness', { icon: '🌲', x: 1, y: -4, tags: ['main', 'forest'],
  description: '北门外不远，松树高耸入云。地面散落着松针和针叶。' });
scene(THORN.path,    '林中小径', 'wilderness', { icon: '🌲', x: 2, y: -5, tags: ['main', 'forest'] });
scene(THORN.fork,    '岔路口',   'wilderness', { icon: '🌲', x: 3, y: -5, tags: ['main', 'forest'] });
scene(THORN.glade,   '阳光草地', 'wilderness', { icon: '🌳', x: 4, y: -4, tags: ['forest'] });
scene(THORN.shrine,  '林中神龛', 'vignette',   { icon: '⛩', x: 4, y: -6, tags: ['forest', 'arcane'],
  description: '一座生满青苔的神龛。香台上残留着新近的祭品。' });
scene(THORN.ravine,  '黑松峡谷', 'wilderness', { icon: '🪨', x: 5, y: -5, tags: ['forest', 'main'] });
scene(THORN.hut,     '林间小屋', 'settlement', { icon: '🏚', x: 3, y: -6, tags: ['forest', 'npc'],
  description: '一间孤零零的圆木屋。烟囱有薄烟。' });
scene(THORN.ruins,   '坍塌神殿', 'dungeon',    { icon: '🏛', x: 6, y: -5, tags: ['forest', 'arcane'] });
scene(THORN.cliff,   '俯瞰悬崖', 'vignette',   { icon: '⛰', x: 5, y: -7, tags: ['forest'],
  description: '从这里能看见整片黑松林。', vignettes: ['风很大。'] });
scene(THORN.brook,   '冰冷溪流', 'wilderness', { icon: '💧', x: 2, y: -7, tags: ['forest'] });
scene(THORN.camp,    '猎人营地', 'wilderness', { icon: '🔥', x: 4, y: -7, tags: ['forest', 'camp'] });
scene(THORN.hidden_grove, '隐密林地', 'vignette', { icon: '🍃', x: 6, y: -6, tags: ['forest', 'hidden'],
  description: '只有在风向对了时才能看见的小空地。' });
scene(THORN.goblin_cave_entry, '哥布林矿坑入口', 'dungeon', { icon: '🕳', x: 7, y: -5, tags: ['forest', 'main', 'dungeon_entry'],
  description: '岩石间凿出来的洞口。空气里有皮毛和金属的味道。' });

// 黑松林连接
connect(ASTRA.gate_n, THORN.edge, '出北门');
connect(THORN.edge,   THORN.path, '沿小径深入');
connect(THORN.path,   THORN.fork, '走到岔路口');
connect(THORN.fork,   THORN.glade, '走向草地');
connect(THORN.fork,   THORN.ravine, '走向峡谷');
connect(THORN.fork,   THORN.hut,    '走向小屋');
connect(THORN.glade,  THORN.shrine, '上山去神龛');
connect(THORN.glade,  THORN.camp,   '走向营地');
connect(THORN.ravine, THORN.ruins,  '继续深入');
connect(THORN.ravine, THORN.goblin_cave_entry, '走向矿坑入口');
connect(THORN.shrine, THORN.cliff,  '攀上悬崖');
connect(THORN.camp,   THORN.brook,  '走到溪边');
connect(THORN.ruins,  THORN.hidden_grove, '绕到神殿后', { discovered: false });

// ============================================================
// 8. 哥布林矿坑（8 节点 dungeon）
// ============================================================
const GMINE = {
  entry: THORN.goblin_cave_entry,
  hall: 'scene_gmine_hall',
  side1: 'scene_gmine_side1',
  side2: 'scene_gmine_side2',
  forge: 'scene_gmine_forge',
  shaft: 'scene_gmine_shaft',
  prison: 'scene_gmine_prison',
  altar: 'scene_gmine_altar',
  throne: 'scene_gmine_throne',
};
scene(GMINE.hall,   '主厅',       'combat',  { icon: '🪨', x: 8, y: -5, tags: ['dungeon', 'goblin'] });
scene(GMINE.side1,  '废弃矿道',   'combat',  { icon: '⛏', x: 9, y: -6, tags: ['dungeon', 'goblin'] });
scene(GMINE.side2,  '坍塌通道',   'combat',  { icon: '⛏', x: 9, y: -4, tags: ['dungeon', 'goblin'] });
scene(GMINE.forge,  '哥布林锻炉', 'combat',  { icon: '🔥', x: 10, y: -5, tags: ['dungeon', 'goblin'] });
scene(GMINE.shaft,  '深井',       'combat',  { icon: '🕳', x: 10, y: -6, tags: ['dungeon'] });
scene(GMINE.prison, '俘虏笼',     'vignette',{ icon: '🔒', x: 10, y: -4, tags: ['dungeon'] });
scene(GMINE.altar,  '血祭坛',     'vignette',{ icon: '🩸', x: 11, y: -5, tags: ['dungeon', 'arcane'] });
scene(GMINE.throne, '头目王座',   'combat',  { icon: '👑', x: 12, y: -5, tags: ['dungeon', 'main', 'boss_room'],
  description: '雕成兽形的石椅上，哥布林头目盯着你。空气里有一种沉甸甸的压迫感——这是一战。如果状态不佳，最好先撤回去补给再来。' });

connect(GMINE.entry, GMINE.hall,  '进入矿坑');
connect(GMINE.hall,  GMINE.side1, '走入北矿道');
connect(GMINE.hall,  GMINE.side2, '走入南矿道');
connect(GMINE.side1, GMINE.shaft, '走到深井');
connect(GMINE.side1, GMINE.forge, '走到锻炉');
connect(GMINE.side2, GMINE.prison, '靠近俘虏笼');
connect(GMINE.forge, GMINE.altar, '走到祭坛');
connect(GMINE.altar, GMINE.throne, '推开石门');

// ============================================================
// 9. 苍白沼泽（12 节点）
// ============================================================
const MARSH = {
  edge:  'scene_marsh_edge',
  road:  'scene_marsh_road',
  ferry: 'scene_marsh_ferry',
  bog1:  'scene_marsh_bog1',
  bog2:  'scene_marsh_bog2',
  hut:   'scene_marsh_hut',
  shrine:'scene_marsh_shrine',
  willow:'scene_marsh_willow',
  ruins: 'scene_marsh_ruins',
  graves:'scene_marsh_graves',
  witch: 'scene_marsh_witch_hut',
  altar: 'scene_marsh_altar',
};
scene(MARSH.edge,  '沼泽边缘',   'wilderness', { icon: '🌫', x: 0, y: 4, tags: ['marsh', 'main'] });
scene(MARSH.road,  '泥泞古道',   'wilderness', { icon: '🌫', x: 1, y: 5, tags: ['marsh', 'main'] });
scene(MARSH.ferry, '老渡口',     'settlement', { icon: '⛵', x: 2, y: 5, tags: ['marsh', 'main', 'npc'] });
scene(MARSH.bog1,  '危险洼地 1', 'wilderness', { icon: '🌫', x: 3, y: 5, tags: ['marsh'] });
scene(MARSH.bog2,  '危险洼地 2', 'wilderness', { icon: '🌫', x: 3, y: 6, tags: ['marsh'] });
scene(MARSH.hut,   '渔夫小屋',   'settlement', { icon: '🛖', x: 2, y: 6, tags: ['marsh', 'npc'] });
scene(MARSH.shrine,'迷雾神龛',   'vignette',   { icon: '⛩', x: 4, y: 6, tags: ['marsh', 'arcane'] });
scene(MARSH.willow,'巨柳树下',   'vignette',   { icon: '🌳', x: 4, y: 5, tags: ['marsh'] });
scene(MARSH.ruins, '沉没村落',   'dungeon',    { icon: '🏚', x: 5, y: 5, tags: ['marsh'] });
scene(MARSH.graves,'乱葬岗',     'dungeon',    { icon: '⚰', x: 5, y: 6, tags: ['marsh', 'undead'] });
scene(MARSH.witch, '女巫小屋',   'settlement', { icon: '🧙', x: 6, y: 6, tags: ['marsh', 'main', 'arcane', 'npc', 'safe', 'rest_point'],
  description: '茅草屋低矮，但屋里的炉火旺。维克斯女巫的茶炉永远在沸。在这里可以稍作休整，再去面对祭坛。' });
scene(MARSH.altar, '霜环祭坛',   'combat',     { icon: '❄', x: 7, y: 6, tags: ['marsh', 'main', 'arcane', 'boss_room'],
  description: '寒气从祭坛中央渗出，霜环漂浮在冰柱顶端。守护者还未现身，但你能感到祭坛深处有什么在缓慢觉醒——这不是一场可以仓促应对的战斗。' });

connect(ASTRA.gate_s, MARSH.edge, '南行入沼泽');
connect(MARSH.edge,   MARSH.road, '沿古道西行');
connect(MARSH.road,   MARSH.ferry, '到达渡口');
connect(MARSH.ferry,  MARSH.bog1,  '坐船到对岸');
connect(MARSH.ferry,  MARSH.hut,   '走向小屋');
connect(MARSH.bog1,   MARSH.bog2,  '横穿洼地');
connect(MARSH.bog1,   MARSH.willow, '走向巨柳');
connect(MARSH.bog2,   MARSH.shrine, '走向神龛');
connect(MARSH.willow, MARSH.ruins,  '走入沉没村落');
connect(MARSH.shrine, MARSH.graves, '继续向北');
connect(MARSH.ruins,  MARSH.witch,  '深入沼泽中心');
connect(MARSH.graves, MARSH.witch,  '从墓园另一边过来');
connect(MARSH.witch,  MARSH.altar,  '走向霜环祭坛');

// ============================================================
// 10. 第二城镇 Thornwood Keep（12 节点）
// ============================================================
const KEEP = {
  gate:     'scene_keep_gate',
  yard:     'scene_keep_yard',
  hall:     'scene_keep_hall',
  barracks: 'scene_keep_barracks',
  kitchen:  'scene_keep_kitchen',
  chapel:   'scene_keep_chapel',
  lord:     'scene_keep_lord',
  balcony:  'scene_keep_balcony',
  dungeon:  'scene_keep_dungeon',
  war:      'scene_keep_war_room',
  garden:   'scene_keep_garden',
  stable:   'scene_keep_stable',
};
scene(KEEP.gate, '荆木堡门',     'settlement', { icon: '🏰', x: 9, y: 0,  tags: ['safe', 'main', 'hub'],
  description: '高耸的吊桥落下。卫兵在打瞌睡。' });
scene(KEEP.yard, '内庭',         'settlement', { icon: '🏰', x: 10, y: 0, tags: ['safe', 'main'] });
scene(KEEP.hall, '大厅',         'settlement', { icon: '🏰', x: 11, y: 0, tags: ['safe', 'main'] });
scene(KEEP.barracks, '兵营',     'settlement', { icon: '⚔', x: 10, y: -1, tags: ['safe', 'main'] });
scene(KEEP.kitchen,  '厨房',     'settlement', { icon: '🍲', x: 10, y: 1, tags: ['safe'] });
scene(KEEP.chapel,   '小礼拜堂', 'settlement', { icon: '⛪', x: 11, y: 1, tags: ['safe', 'temple'] });
scene(KEEP.lord,     '领主卧室', 'settlement', { icon: '🛏', x: 12, y: 0, tags: ['safe', 'main'] });
scene(KEEP.balcony,  '高塔阳台', 'vignette',   { icon: '🌄', x: 12, y: -1, tags: ['safe'] });
scene(KEEP.dungeon,  '地牢入口', 'dungeon',    { icon: '🔒', x: 11, y: 2, tags: ['main'] });
scene(KEEP.war,      '战争议事厅', 'settlement', { icon: '🗺', x: 12, y: 1, tags: ['safe', 'main'] });
scene(KEEP.garden,   '荒废庭院', 'vignette',   { icon: '🌹', x: 9, y: 1, tags: ['safe'] });
scene(KEEP.stable,   '马厩',     'settlement', { icon: '🐴', x: 9, y: -1, tags: ['safe'] });

connect(KEEP.gate, KEEP.yard, '进入内庭');
connect(KEEP.yard, KEEP.hall, '走入大厅');
connect(KEEP.yard, KEEP.barracks, '走向兵营');
connect(KEEP.yard, KEEP.kitchen, '走向厨房');
connect(KEEP.yard, KEEP.garden, '走向荒废庭院');
connect(KEEP.yard, KEEP.stable, '走向马厩');
connect(KEEP.hall, KEEP.lord, '走向领主卧室');
connect(KEEP.hall, KEEP.chapel, '走向礼拜堂');
connect(KEEP.kitchen, KEEP.dungeon, '从厨房暗门下去', { gated: { hint: '厨娘说"夜里才好溜下去"', requireCompletedEvents: ['ev_kitchen_intel'] } });
connect(KEEP.chapel, KEEP.war, '穿过礼拜堂去议事厅');
connect(KEEP.lord, KEEP.balcony, '走出阳台');

// Astralhaven 到 Keep 的中段道路
scene('scene_road_to_keep_1', '荒野中段', 'wilderness', { icon: '🛤', x: 6, y: 0, tags: ['main', 'road'] });
scene('scene_road_to_keep_2', '荆棘小道', 'wilderness', { icon: '🛤', x: 7, y: 0, tags: ['main', 'road'] });
scene('scene_road_to_keep_3', '断桥',     'wilderness', { icon: '🛤', x: 8, y: 0, tags: ['main', 'road'] });
connect(ASTRA.gate_n, 'scene_road_to_keep_1', '北行直走（绕过黑松林）');
connect('scene_road_to_keep_1', 'scene_road_to_keep_2', '继续向东');
connect('scene_road_to_keep_2', 'scene_road_to_keep_3', '过断桥');
connect('scene_road_to_keep_3', KEEP.gate, '抵达荆木堡门');
// 也可以从沼泽往东到 Keep（备用路径）
connect(MARSH.altar, KEEP.gate, '从霜环祭坛北上抵达荆木堡', { gated: { requireCompletedEvents: ['ev_marsh_boss'] } });

// ============================================================
// 11. 龙骨山脉 + 巫师塔（联通到 Keep 北）
// ============================================================
const RANGE = {
  foothill:'scene_range_foothill',
  pass:    'scene_range_pass',
  peak1:   'scene_range_peak1',
  peak2:   'scene_range_peak2',
  cave1:   'scene_range_cave1',
  cave2:   'scene_range_cave2',
  ledge:   'scene_range_ledge',
  shrine:  'scene_range_shrine',
  glacier: 'scene_range_glacier',
  bonefield:'scene_range_bonefield',
  rift:    'scene_range_rift',
  dragon_lair: 'scene_range_dragon_lair',
  refuge:  'scene_range_refuge',
  monastery:'scene_range_monastery',
};
scene(RANGE.foothill,  '山脚',       'wilderness', { icon: '⛰', x: 11, y: -3, tags: ['main', 'mountain'] });
scene(RANGE.pass,      '风口',       'wilderness', { icon: '🌬', x: 12, y: -3, tags: ['main', 'mountain'] });
scene(RANGE.peak1,     '碎石峰',     'wilderness', { icon: '⛰', x: 13, y: -3, tags: ['mountain'] });
scene(RANGE.peak2,     '哀风峰',     'wilderness', { icon: '⛰', x: 13, y: -4, tags: ['mountain'] });
scene(RANGE.cave1,     '风蚀洞窟',   'dungeon',    { icon: '🕳', x: 12, y: -4, tags: ['mountain'] });
scene(RANGE.cave2,     '深洞',       'dungeon',    { icon: '🕳', x: 13, y: -5, tags: ['mountain'] });
scene(RANGE.ledge,     '冰崖突岩',   'vignette',   { icon: '🧊', x: 14, y: -4, tags: ['mountain'] });
scene(RANGE.shrine,    '高山神龛',   'vignette',   { icon: '⛩', x: 14, y: -3, tags: ['mountain', 'arcane'] });
scene(RANGE.glacier,   '冰川裂隙',   'wilderness', { icon: '🧊', x: 14, y: -5, tags: ['mountain'] });
scene(RANGE.bonefield, '龙骨平原',   'wilderness', { icon: '💀', x: 15, y: -4, tags: ['mountain', 'main'] });
scene(RANGE.rift,      '虚空裂缝',   'wilderness', { icon: '🌀', x: 15, y: -5, tags: ['mountain', 'main', 'arcane'] });
scene(RANGE.dragon_lair, '岩龙巢穴', 'combat',     { icon: '🐉', x: 16, y: -4, tags: ['mountain', 'main', 'boss_room'],
  description: '巢穴顶上垂着钟乳石。岩龙缓慢起身，每一下呼吸都让地面震动——除非你已做好万全准备，否则这一战凶多吉少。' });
scene(RANGE.refuge,    '废弃避难所', 'settlement', { icon: '🏚', x: 15, y: -3, tags: ['mountain', 'camp', 'safe'] });
scene(RANGE.monastery, '山间隐修院', 'settlement', { icon: '⛪', x: 14, y: -2, tags: ['mountain', 'safe', 'npc'] });

connect(KEEP.balcony, RANGE.foothill, '从阳台走向北山', { gated: { hint: '高塔上需要先打听过某些消息', requireCompletedEvents: ['ev_keep_council'] } });
connect(RANGE.foothill, RANGE.pass, '攀上风口');
connect(RANGE.pass,     RANGE.peak1, '向东登峰');
connect(RANGE.pass,     RANGE.peak2, '向北登峰');
connect(RANGE.pass,     RANGE.cave1, '走入风蚀洞窟');
connect(RANGE.peak2,    RANGE.cave2, '钻入深洞');
connect(RANGE.peak1,    RANGE.ledge, '横切到冰崖');
connect(RANGE.peak1,    RANGE.shrine, '走到神龛');
connect(RANGE.cave2,    RANGE.glacier, '出洞到冰川');
connect(RANGE.glacier,  RANGE.bonefield, '走入龙骨平原');
connect(RANGE.bonefield, RANGE.rift, '走向虚空裂缝');
connect(RANGE.bonefield, RANGE.dragon_lair, '走向岩龙巢穴');
connect(RANGE.shrine,   RANGE.refuge, '下到避难所');
connect(RANGE.refuge,   RANGE.monastery, '走向隐修院');

// 巫师塔（10 节点 dungeon）
const SPIRE = {
  entry:     'scene_spire_entry',
  atrium:    'scene_spire_atrium',
  lab:       'scene_spire_lab',
  library:   'scene_spire_library',
  observatory:'scene_spire_observatory',
  conjuring: 'scene_spire_conjuring',
  archmage:  'scene_spire_archmage',
  lift:      'scene_spire_lift',
  void_chamber:'scene_spire_void',
  altar:     'scene_spire_altar',
  pinnacle:  'scene_spire_pinnacle',
};
scene(SPIRE.entry,     '黑曜塔基',     'dungeon',   { icon: '🗼', x: 17, y: -4, tags: ['spire', 'main'] });
scene(SPIRE.atrium,    '迎宾大厅',     'dungeon',   { icon: '🗼', x: 18, y: -4, tags: ['spire', 'main'] });
scene(SPIRE.lab,       '炼金实验室',   'dungeon',   { icon: '⚗', x: 18, y: -5, tags: ['spire'] });
scene(SPIRE.library,   '魔法藏书阁',   'dungeon',   { icon: '📕', x: 18, y: -3, tags: ['spire'] });
scene(SPIRE.observatory, '观星台',     'vignette',  { icon: '🔭', x: 19, y: -5, tags: ['spire'] });
scene(SPIRE.conjuring, '召唤大厅',     'combat',    { icon: '✨', x: 19, y: -4, tags: ['spire'] });
scene(SPIRE.archmage,  '大法师起居',   'vignette',  { icon: '🛏', x: 19, y: -3, tags: ['spire'] });
scene(SPIRE.lift,      '法力升降台',   'vignette',  { icon: '⬆', x: 20, y: -4, tags: ['spire'] });
scene(SPIRE.void_chamber, '虚空之厅', 'combat',     { icon: '🌀', x: 21, y: -4, tags: ['spire', 'main', 'boss_room'],
  description: '塔顶的天空被撕开一条裂缝，黑色的光从那里渗下来。大法师西拉斯漂浮在房间中央，背后是虚空触手——这是终局之战，不带满状态进来基本等于赴死。' });
// 献冠祭坛：虚空之厅与塔顶最终决战之间的安全休整点（避免两个 boss 背靠背、无回血暴毙）
scene(SPIRE.altar,     '献冠祭坛',     'vignette',  { icon: '🕯', x: 21, y: -3, tags: ['spire', 'main', 'safe', 'rest'],
  description: '虚空裂隙暂被祭坛的微光挡在门外。三片冠静静浮在石台上空，等待合一。这里安全——在踏上塔顶决战之前，最后一次整理状态吧。',
  vignettes: ['烛火在祭坛四周静静燃烧，给你片刻喘息。'] });
scene(SPIRE.pinnacle,  '塔顶',         'ending',    { icon: '👑', x: 22, y: -4, tags: ['spire', 'main', 'ending_room'] });

connect(RANGE.dragon_lair, SPIRE.entry, '从龙巢深处的传送门进入巫师塔', { gated: { requireItems: ['item_crown_piece_c'] } });
connect(SPIRE.entry,    SPIRE.atrium, '走入大厅');
connect(SPIRE.atrium,   SPIRE.lab, '走入实验室');
connect(SPIRE.atrium,   SPIRE.library, '走入藏书阁');
connect(SPIRE.lab,      SPIRE.observatory, '上到观星台');
connect(SPIRE.lab,      SPIRE.conjuring, '走入召唤大厅');
connect(SPIRE.library,  SPIRE.archmage, '走入大法师起居');
connect(SPIRE.observatory, SPIRE.lift, '搭乘升降台');
connect(SPIRE.conjuring,   SPIRE.lift, '走向升降台');
connect(SPIRE.archmage,    SPIRE.lift, '走向升降台');
connect(SPIRE.lift,        SPIRE.void_chamber, '升到虚空之厅');
connect(SPIRE.void_chamber, SPIRE.altar, '退入献冠祭坛喘息');
connect(SPIRE.altar, SPIRE.pinnacle, '走向塔顶（最终对决）',
  { gated: { hint: '冠的三片在这里合为一体', requireItems: ['item_crown_piece_a', 'item_crown_piece_b', 'item_crown_piece_c'] } });

// ============================================================
// 12. 结局节点（4 个 ending）
// ============================================================
scene('scene_ending_light',   '黎明加冕',   'ending', { icon: '☀', x: 24, y: -5, tags: ['ending', 'main'],
  description: '阳光穿过塔顶。你戴上永燃之冠，龙王俯首。一个新的时代开始了。' });
scene('scene_ending_dark',    '虚空契约',   'ending', { icon: '🌑', x: 24, y: -4, tags: ['ending', 'main'],
  description: '你选择了接受虚空。冠的火、霜、星都被你吞没。世界即将听见新王的脚步。' });
scene('scene_ending_neutral', '走向远方',   'ending', { icon: '🚪', x: 24, y: -3, tags: ['ending', 'main'],
  description: '你拒绝戴上冠。把它埋回大地，转身。前路漫漫。' });
scene('scene_ending_hidden',  '永燃合一',   'ending', { icon: '🔥', x: 25, y: -4, tags: ['ending', 'main', 'hidden'],
  description: '只有完整地爱过 / 拯救过同伴的人，才能听见星辰最后的耳语。你与冠合一，成为下一任守护者。' });

// pinnacle 到 4 个 ending（每个有不同的 gating）
connect(SPIRE.pinnacle, 'scene_ending_light',   '戴上冠，与龙王对峙', { oneWay: true });
connect(SPIRE.pinnacle, 'scene_ending_dark',    '接受虚空的低语',     { oneWay: true, gated: { requireVariables: { void_pact: true } } });
connect(SPIRE.pinnacle, 'scene_ending_neutral', '把冠埋回去，转身离开', { oneWay: true });
connect(SPIRE.pinnacle, 'scene_ending_hidden',  '让心与冠合一',       { oneWay: true,
  gated: { requireVariables: { saved_lyra: true, saved_aldric: true, saved_kael: true } } });

// ============================================================
// 13. NPCs（22 个，4 可招募）
// ============================================================
npc('npc_smith_bron',  '老布朗', { icon: '🔨', personality: 'gruff_but_kind',
  spawnScene: ASTRA.smithy, tags: ['shop_keeper', 'astra'],
  giftPreferences: { 'item_iron_ore': 'love', 'item_silver_ore': 'love', 'tag:metal': 'love', 'consumable': 'neutral' },
  schedule: [{ day: 'any', hour: [7, 19], scene: ASTRA.smithy }, { day: 'any', hour: [20, 6], scene: ASTRA.inn }],
});
npc('npc_maya',        '玛雅', { icon: '🍺', personality: 'warm_innkeeper',
  spawnScene: ASTRA.inn, tags: ['inn_keeper', 'astra'],
  giftPreferences: { 'tag:food': 'love', 'item_apple': 'love' },
  schedule: [{ day: 'any', hour: [6, 23], scene: ASTRA.inn }, { day: 'any', hour: [0, 5], scene: ASTRA.inn }],
});
npc('npc_priest_elan', '艾兰祭司', { icon: '⛪', personality: 'gentle_devout',
  spawnScene: ASTRA.temple, tags: ['priest', 'astra', 'sun'],
  giftPreferences: { 'item_pendant_sun': 'love', 'tag:holy': 'love' },
});
npc('npc_sera',        '赛拉法师', { icon: '🔮', personality: 'cold_curious',
  spawnScene: ASTRA.mage, tags: ['mage', 'astra', 'elf'],
  giftPreferences: { 'tag:arcane': 'love', 'item_moonshade': 'love', 'item_pendant_moon': 'love' },
});
npc('npc_garrick',     '加尔德', { icon: '👓', personality: 'cynical_practical',
  spawnScene: ASTRA.guild, tags: ['guild_master', 'astra'],
});
npc('npc_harold',      '哈罗德馆长', { icon: '📚', personality: 'absent_minded_scholar',
  spawnScene: ASTRA.library, tags: ['scholar', 'astra'],
  giftPreferences: { 'tag:literate': 'love', 'item_journal_witch': 'love' },
});
npc('npc_lyra',        '莉拉', { icon: '🏹', personality: 'sharp_loyal', recruitable: true,
  spawnScene: THORN.camp, tags: ['ranger', 'companion', 'forest'],
  stats: { hp: 95, mp: 25, attack: 14, defense: 7, magicAttack: 5, magicDefense: 7, speed: 14, luck: 7 },
  abilities: [
    { id: 'lyra_shoot',  name: '精准射击', type: 'active', cost: { mp: 5 }, effect: { damage: { formula: 'attack+d10+4' } } },
    { id: 'lyra_volley', name: '风暴箭雨', type: 'active', cost: { mp: 12 }, cooldown: 3, effect: { damage: { formula: 'attack+2d8' } } },
    { id: 'lyra_evade',  name: '风行',     type: 'passive' },
  ],
  giftPreferences: { 'tag:forest': 'love', 'item_wolf_pelt': 'like', 'item_apple': 'like' },
});
npc('npc_aldric',      '艾尔德里克', { icon: '🛡', personality: 'noble_burdened', recruitable: true,
  spawnScene: KEEP.barracks, tags: ['knight', 'companion', 'noble'],
  stats: { hp: 140, mp: 20, attack: 16, defense: 13, magicAttack: 3, magicDefense: 10, speed: 8, luck: 5 },
  abilities: [
    { id: 'aldric_shield', name: '盾击', type: 'active', cost: { mp: 4 }, effect: { damage: { formula: 'attack+d6+3' } } },
    { id: 'aldric_taunt',  name: '挑衅', type: 'active', cost: { mp: 6 }, cooldown: 2, effect: { damage: { formula: 'attack+d4' } } },
    { id: 'aldric_endure', name: '坚守', type: 'passive' },
  ],
  giftPreferences: { 'item_silver_sword': 'love', 'tag:noble': 'love', 'item_chainmail': 'like' },
});
npc('npc_kael',        '凯尔', { icon: '🗡', personality: 'witty_lonely', recruitable: true,
  spawnScene: ASTRA.thieves, tags: ['rogue', 'companion', 'thieves'],
  stats: { hp: 80, mp: 30, attack: 13, defense: 6, magicAttack: 8, magicDefense: 8, speed: 16, luck: 9 },
  abilities: [
    { id: 'kael_backstab', name: '背刺',   type: 'active', cost: { mp: 6 }, effect: { damage: { formula: 'attack+2d6+4' } } },
    { id: 'kael_smoke',    name: '烟雾弹', type: 'active', cost: { mp: 8 }, cooldown: 3, effect: { damage: { formula: 'attack+d6' } } },
    { id: 'kael_lucky',    name: '走运',   type: 'passive' },
  ],
  giftPreferences: { 'tag:thieves': 'love', 'item_potion_minor': 'like' },
});
npc('npc_witch_vex',   '维克斯女巫', { icon: '🧙', personality: 'cryptic_lonely', recruitable: true,
  spawnScene: MARSH.witch, tags: ['witch', 'companion', 'marsh', 'arcane'],
  stats: { hp: 75, mp: 60, attack: 6, defense: 5, magicAttack: 20, magicDefense: 14, speed: 10, luck: 6 },
  abilities: [
    { id: 'vex_curse', name: '诅咒',     type: 'active', cost: { mp: 8 },  effect: { damage: { formula: 'magicAttack+d10' } } },
    { id: 'vex_drain', name: '生命汲取', type: 'active', cost: { mp: 10 }, effect: { damage: { formula: 'magicAttack+d8+2' }, heal: { formula: '15' } } },
    { id: 'vex_ward',  name: '荆棘结界', type: 'active', cost: { mp: 15 }, cooldown: 4, effect: { damage: { formula: 'magicAttack+2d6' } } },
  ],
  giftPreferences: { 'item_moonshade': 'love', 'tag:arcane': 'love', 'item_journal_witch': 'love' },
});
npc('npc_ferryman',    '老渡口船夫', { icon: '⛵',  spawnScene: MARSH.ferry, tags: ['marsh'] });
npc('npc_lord_haran',  '荆木堡领主 哈兰', { icon: '👑', personality: 'tired_pragmatist',
  spawnScene: KEEP.lord, tags: ['noble', 'keep'] });
npc('npc_lady_haran',  '哈兰夫人', { icon: '👸', spawnScene: KEEP.garden, tags: ['noble', 'keep'] });
npc('npc_captain_dren','卫队长 德伦', { icon: '⚔', spawnScene: KEEP.barracks, tags: ['soldier', 'keep'] });
npc('npc_cook_meg',    '厨娘梅格', { icon: '🍲', spawnScene: KEEP.kitchen, tags: ['keep'],
  giftPreferences: { 'tag:food': 'love' } });
npc('npc_prisoner',    '地牢里的囚犯', { icon: '🥺', spawnScene: KEEP.dungeon, tags: ['keep'] });
npc('npc_hermit',      '山间隐士', { icon: '🧙‍♂️', spawnScene: RANGE.monastery, tags: ['mountain', 'arcane'],
  giftPreferences: { 'tag:legendary': 'love' } });
npc('npc_archmage_silas', '大法师 西拉斯', { icon: '🧙‍♂️', personality: 'broken_genius',
  spawnScene: SPIRE.archmage, tags: ['mage', 'spire', 'antagonist'] });
npc('npc_hunter_old',  '老猎人', { icon: '🏹', spawnScene: THORN.hut, tags: ['forest'] });
npc('npc_seer',        '盲眼先知', { icon: '👁', spawnScene: ASTRA.well, tags: ['arcane'],
  schedule: [{ day: 'any', hour: [20, 5], scene: ASTRA.well }] });
npc('npc_bandit_lord', '强盗头子', { icon: '🗡', spawnScene: ASTRA.thieves, tags: ['thieves', 'antagonist'] });
npc('npc_void_voice',  '虚空之声', { icon: '🌀', spawnScene: SPIRE.void_chamber, tags: ['void', 'antagonist'] });

// 关系网（典型八卦/师徒/敌对）
npcRel('npc_smith_bron', 'npc_maya',         0.5,  '老朋友');
npcRel('npc_maya',       'npc_smith_bron',   0.5,  '邀他来喝酒');
npcRel('npc_priest_elan','npc_harold',       0.6,  '学术挚友');
npcRel('npc_sera',       'npc_priest_elan', -0.4,  '不喜神职');
npcRel('npc_sera',       'npc_archmage_silas', 0.8, '昔日老师');
npcRel('npc_garrick',    'npc_kael',         0.3,  '默许走单帮');
npcRel('npc_lyra',       'npc_hunter_old',   0.7,  '师徒');
npcRel('npc_aldric',     'npc_lord_haran',   0.8,  '宣誓效忠');
npcRel('npc_lady_haran', 'npc_aldric',      -0.4,  '怀疑他的忠心');
npcRel('npc_witch_vex',  'npc_ferryman',     0.4,  '老相识');
npcRel('npc_witch_vex',  'npc_archmage_silas', -0.7, '宿敌');
npcRel('npc_seer',       'npc_archmage_silas', -0.5, '看穿了他');
npcRel('npc_bandit_lord','npc_garrick',     -0.7,  '势不两立');
npcRel('npc_void_voice', 'npc_archmage_silas', 0.9, '已契约');
npcRel('npc_captain_dren','npc_aldric',     -0.3, '嫉妒');
npcRel('npc_cook_meg',   'npc_lady_haran',  -0.5, '受过气');
npcRel('npc_prisoner',   'npc_lord_haran',  -0.8, '冤狱');

// 简单 dialogue tree（demo 一个，验证结构）
preset.npcs.find(n => n.id === 'npc_smith_bron').dialogueTree = {
  root: { speaker: 'self', text: '你又来了，小子。要打把好刀？还是来打听消息？',
    branches: [
      { text: '我想买把好刀。', next: 'buy' },
      { text: '听说北山有龙。', next: 'rumor', requireAffection: 10 },
      { text: '告辞。', exit: true },
    ] },
  buy: { speaker: 'self', text: '银剑卖你 180——比标价低，看你顺眼。', branches: [
    { text: '收下！', exit: true, effects: [{ type: 'add_item', itemId: 'item_silver_sword' }, { type: 'set_variable', name: 'gold', value: -180 }] },
    { text: '再想想。', next: 'root' },
  ] },
  rumor: { speaker: 'self', text: '真有。但那不是龙——那是龙骨。冠片在那。', branches: [
    { text: '多谢。', exit: true, effects: [{ type: 'set_worldFlag', name: 'rumor_dragon_north', value: true }] },
  ] },
};

// ============================================================
// 14. 事件（结构性骨架 + 主线 + 大量场景小事件）
// ============================================================
// 主线事件 — 4 个开场（按 spawn 分流）
event('ev_intro_noble',  '继承的使命', {
  inScene: ['scene_noble_manor'], tags: ['main', 'intro'], priority: 100,
  description: '父亲的最后一封信摊在桌上，提到"星辰塔的守护者已死"。你必须出发。',
  choices: [
    { text: '收拾行装出门', outcomes: [{ text: '你披上斗篷，向阿斯特拉哈文出发。',
      effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }, { type: 'add_item', itemId: 'item_old_letter' }] }] },
  ],
});
event('ev_intro_orphan', '逃出生天', {
  inScene: ['scene_alley_dawn'], tags: ['main', 'intro'], priority: 100,
  description: '帮派头目盯上了你。听说阿斯特拉哈文广场上有"招人手"的告示。',
  choices: [{ text: '溜进广场', outcomes: [{ text: '你消失在晨雾里。',
    effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }] }] }],
});
event('ev_intro_exile',  '召唤之梦', {
  inScene: ['scene_exile_camp'], tags: ['main', 'intro'], priority: 100,
  description: '梦里有人叫你的名字。她说"承继冠者"。她在哈文等你。',
  choices: [{ text: '收拾帐篷向南', outcomes: [{ text: '你拔起最后一根帐篷桩。',
    effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }] }] }],
});
event('ev_intro_farmer', '燃烧的天空', {
  inScene: ['scene_farm_morning'], tags: ['main', 'intro'], priority: 100,
  description: '天边有星辰在燃烧。叔叔说"那是冠在叫人"。',
  choices: [{ text: '辞别叔叔向城去', outcomes: [{ text: '你最后一次回望了麦田。',
    effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }] }] }],
});

// 主线 hub 事件 — 在 Astralhaven 广场推动
event('ev_astra_hub_intro', '广场公告', {
  inScene: [ASTRA.square], tags: ['main'], priority: 90,
  requireVariables: { quest_accepted: true },
  description: '公告板上贴着先知的告示："寻冠之人，请到神殿。"',
  choices: [{ text: '去神殿见祭司', outcomes: [{ text: '你记下了。',
    effects: [{ type: 'set_variable', name: 'seek_priest', value: true }] }] }],
});

event('ev_temple_blessing', '祭司的指引', {
  inScene: [ASTRA.temple], tags: ['main'], priority: 90,
  requireVariables: { seek_priest: true },
  description: '艾兰祭司双手按在你额上。"冠之三片：火心藏于黑松林深处，霜环沉睡在沼泽，星顶——只有龙骨之上才能取。" ',
  choices: [
    { text: '我会找回所有。', outcomes: [{ text: '祭司点头，给你一枚太阳坠。',
      effects: [
        { type: 'set_variable', name: 'quest_crown_started', value: true },
        { type: 'add_item', itemId: 'item_pendant_sun' },
        { type: 'set_worldFlag', name: 'priest_blessed', value: true },
      ] }] },
  ],
});

// —— 第一片：火心（黑松林 → 哥布林头目）
event('ev_thorn_hunter_meet', '猎人小屋的茶', {
  inScene: [THORN.hut], tags: ['main', 'side'], priority: 70,
  requireVariables: { quest_crown_started: true },
  description: '老猎人请你坐下。他说哥布林近来异常活跃，矿坑里有"会发光的东西"。',
  choices: [
    { text: '正是我要找的。', outcomes: [{ text: '老猎人画了张地图给你。',
      effects: [{ type: 'set_variable', name: 'know_mine_loc', value: true }] }] },
  ],
});

event('ev_goblin_throne', '哥布林头目的冠', {
  inScene: [GMINE.throne], tags: ['main', 'boss'], priority: 100,
  description: '头目盘腿坐在王座上。它头上有一圈微微发热的金属——那就是火心。它的两侧站着弓手与斥候，眼神都不善。一旦开战就没有回头路——确保自己状态足够再战。',
  choices: [
    { text: '冲上去！', outcomes: [{ text: '战斗一触即发。',
      effects: [{ type: 'start_combat', enemyIds: ['enemy_goblin_chief', 'enemy_goblin_archer', 'enemy_goblin_scout'] }] }] },
  ],
});

event('ev_goblin_throne_loot', '取回火心', {
  inScene: [GMINE.throne], tags: ['main'], priority: 95,
  requireCompletedEvents: ['ev_goblin_throne'],
  description: '头目倒下，火心从它头上滚落，温暖如尚有龙王心跳。',
  choices: [
    { text: '小心收起', outcomes: [{ text: '你收起了火心。',
      effects: [
        { type: 'add_item', itemId: 'item_crown_piece_a' },
        { type: 'set_variable', name: 'has_crown_a', value: true },
        { type: 'set_worldFlag', name: 'crown_a_taken', value: true },
      ] }] },
  ],
});

// —— 第二片：霜环（沼泽 → 女巫 → 祭坛）
event('ev_marsh_witch_meet', '女巫的代价', {
  inScene: [MARSH.witch], tags: ['main'], priority: 80,
  requireVariables: { quest_crown_started: true },
  description: '维克斯女巫淡淡看了你一眼。"霜环在我手上。你愿意付出什么？"',
  choices: [
    { text: '一份诚意，外加同行。', outcomes: [{ text: '女巫闭眼："那就同行吧。"',
      effects: [
        { type: 'set_variable', name: 'vex_agreed', value: true },
        { type: 'recruit_companion', npcId: 'npc_witch_vex' },
      ] }] },
    { text: '我可以用法力换。', outcomes: [{ text: '她笑了："那就在祭坛上证明你。"',
      effects: [{ type: 'set_variable', name: 'witch_test', value: true }] }] },
  ],
});

// —— Lyra 招募（在猎人营地）
// —— 旅馆休息 (repeatable, 治疗整队)
// 每次进 inn 都会触发；玩家手动选"休息"才回血并推进时间
event('ev_rest_astra', '夜风旅馆 — 住一晚', {
  inScene: ['scene_astra_inn'], tags: ['side', 'rest'], priority: 80,
  repeatable: true,
  description: '老板娘抬头："今天就在这住一晚？8 个银币，包早餐。"',
  choices: [
    { text: '住一晚（回满 HP/MP）', outcomes: [{
      text: '一夜好眠，醒来时阳光正好。',
      effects: [
        { type: 'heal', target: 'all', value: 999 },
        { type: 'advance_time', value: 8 },
      ],
    }] },
    { text: '不了，赶路要紧。', outcomes: [{ text: '老板娘耸肩。', effects: [] }] },
  ],
});

event('ev_recruit_lyra', '猎人营地的莉拉', {
  inScene: [THORN.camp], tags: ['side', 'recruit'], priority: 75,
  requireVariables: { quest_crown_started: true },
  description: '一个利落的少女正在收拾箭袋。她抬头打量你："你要去黑松林深处？听说那有人在不该有的地方挖矿。"',
  choices: [
    { text: '同行如何？', outcomes: [{ text: '她笑了："我正想看看那些挖矿的家伙。"',
      effects: [
        { type: 'set_variable', name: 'lyra_joined', value: true },
        { type: 'set_variable', name: 'saved_lyra', value: true },
        { type: 'recruit_companion', npcId: 'npc_lyra' },
      ] }] },
    { text: '只是路过。', outcomes: [{ text: '她耸耸肩，继续清理箭袋。', effects: [] }] },
  ],
});

// —— Kael 招募（盗贼地窖；需要先发现隐藏入口）
event('ev_recruit_kael', '盗贼地窖里的凯尔', {
  inScene: [ASTRA.thieves], tags: ['side', 'recruit'], priority: 75,
  description: '一个戴兜帽的男子从阴影里现身。"我注意你很久了。我厌倦了这地下的日子——带我离开，我帮你。"',
  choices: [
    { text: '欢迎加入。', outcomes: [{ text: '他露出狡黠的笑。',
      effects: [
        { type: 'set_variable', name: 'kael_joined', value: true },
        { type: 'set_variable', name: 'saved_kael', value: true },
        { type: 'recruit_companion', npcId: 'npc_kael' },
      ] }] },
    { text: '我不需要陌生人。', outcomes: [{ text: '他叹气："你会后悔的。"', effects: [] }] },
  ],
});

// 加一个 reveal_connection 事件让 AI 能找到盗贼地窖入口（不然永远隐藏）
event('ev_discover_thieves', '市集的暗语', {
  inScene: [ASTRA.market], tags: ['side', 'discover'], priority: 65,
  requireVariables: { quest_crown_started: true },
  description: '一个戴兜帽的商贩低声说："想找捷径？市集第三个摊位下有暗格。"',
  choices: [
    { text: '记下这条线索', outcomes: [{ text: '你点点头。',
      effects: [
        { type: 'set_worldFlag', name: 'know_thieves_entry', value: true },
        { type: 'reveal_connection', fromId: ASTRA.market, toId: ASTRA.thieves },
      ] }] },
  ],
});

event('ev_marsh_boss', '霜环的考验', {
  inScene: [MARSH.altar], tags: ['main', 'boss'], priority: 100,
  requireVariables: { vex_agreed: true },
  description: '霜环漂浮在祭坛中央，寒气逼人。从冰里慢慢站起两个潜行者，背后是隐入雾里的沼泽女巫。这是一战——一旦开始就没回头路。',
  choices: [
    { text: '应战', outcomes: [{ text: '战斗开始。',
      effects: [{ type: 'start_combat', enemyIds: ['enemy_marsh_lurker', 'enemy_marsh_lurker', 'enemy_swamp_witch'] }] }] },
  ],
});

event('ev_marsh_loot', '霜环到手', {
  inScene: [MARSH.altar], tags: ['main'], priority: 95,
  requireCompletedEvents: ['ev_marsh_boss'],
  description: '寒气退去。霜环静静悬浮，等你伸手。',
  choices: [
    { text: '取下', outcomes: [{ text: '你戴上后立刻收起。',
      effects: [
        { type: 'add_item', itemId: 'item_crown_piece_b' },
        { type: 'set_variable', name: 'has_crown_b', value: true },
        { type: 'set_worldFlag', name: 'crown_b_taken', value: true },
        { type: 'set_variable', name: 'saved_lyra', value: true },  // 简化：救一次同伴为隐藏结局铺垫
      ] }] },
  ],
});

// —— 中段过场：荆木堡议事
event('ev_keep_council', '荆木堡议事', {
  inScene: [KEEP.war], tags: ['main'], priority: 80,
  requireVariables: { has_crown_a: true, has_crown_b: true },
  description: '领主哈兰、夫人、卫队长、艾尔德里克都在议事厅。哈兰说"星顶在龙骨山脉。你需要一位领路人。"',
  choices: [
    { text: '请艾尔德里克同行', outcomes: [{ text: '艾尔德里克起身："我跟你去。"',
      effects: [
        { type: 'recruit_companion', npcId: 'npc_aldric' },
        { type: 'set_variable', name: 'aldric_joined', value: true },
        { type: 'set_variable', name: 'saved_aldric', value: true },
      ] }] },
  ],
});

event('ev_kitchen_intel', '厨娘的密报', {
  inScene: [KEEP.kitchen], tags: ['side'], priority: 60,
  description: '厨娘梅格压低声音："夜里溜进地牢——有人想被你听见。"',
  choices: [{ text: '记下', outcomes: [{ text: '你点点头。',
    effects: [{ type: 'set_variable', name: 'kitchen_intel', value: true }] }] }],
});

event('ev_dungeon_prisoner', '地牢里的真相', {
  inScene: [KEEP.dungeon], tags: ['side'], priority: 70,
  requireVariables: { kitchen_intel: true },
  description: '囚犯压低声音："大法师西拉斯——已经与虚空契约。冠到他手里，整个王国都完了。"',
  choices: [
    { text: '我会阻止他。', outcomes: [{ text: '囚犯朝你点头。',
      effects: [{ type: 'set_worldFlag', name: 'silas_corrupt', value: true }] }] },
    { text: '我现在不能放你出去。', outcomes: [{ text: '囚犯垂下头。', effects: [] }] },
  ],
});

// —— 第三片：星顶（龙骨山脉 → 岩龙）
event('ev_range_dragon', '岩龙之战', {
  inScene: [RANGE.dragon_lair], tags: ['main', 'boss'], priority: 100,
  requireVariables: { has_crown_a: true, has_crown_b: true },
  description: '巢穴中央，岩龙缓缓抬头，每一寸鳞片都映着幽光。它的额上嵌着星顶。脚边还有一只年幼的龙崽——一旦开战，无路可退。',
  choices: [
    { text: '战斗', outcomes: [{ text: '岩石震动。',
      effects: [{ type: 'start_combat', enemyIds: ['enemy_drake_alpha', 'enemy_drake'] }] }] },
  ],
});

event('ev_range_loot', '星顶到手', {
  inScene: [RANGE.dragon_lair], tags: ['main'], priority: 95,
  requireCompletedEvents: ['ev_range_dragon'],
  description: '岩龙倒下。星顶安静地躺在它额前。',
  choices: [
    { text: '收起星顶', outcomes: [{ text: '冠之三片，全在你手上。',
      effects: [
        { type: 'add_item', itemId: 'item_crown_piece_c' },
        { type: 'set_variable', name: 'has_crown_c', value: true },
        { type: 'set_worldFlag', name: 'crown_c_taken', value: true },
        { type: 'set_variable', name: 'saved_kael', value: true },
      ] }] },
  ],
});

// —— 巫师塔终局
event('ev_spire_void', '虚空之厅的契约', {
  inScene: [SPIRE.void_chamber], tags: ['main'], priority: 90,
  requireVariables: { has_crown_c: true },
  description: '大法师西拉斯漂浮在房间中央。"加入我，或为我而死。"虚空触手在他身后蠕动。',
  choices: [
    { text: '加入虚空契约', outcomes: [{ text: '你伸出了手。',
      effects: [{ type: 'set_variable', name: 'void_pact', value: true }] }] },
    { text: '拒绝。打。', outcomes: [{ text: '空气炸开。',
      effects: [{ type: 'start_combat', enemyIds: ['enemy_void_thing', 'enemy_corrupt_guard'] }] }] },
  ],
});

event('ev_spire_pinnacle', '塔顶最后对决', {
  inScene: [SPIRE.pinnacle], tags: ['main', 'epilogue', 'boss'], priority: 100,
  description: '塔顶。寒风。龙王正从远处升起。',
  choices: [
    { text: '与龙王决战', outcomes: [{ text: '永燃之冠在你手中点燃。',
      effects: [{ type: 'start_combat', enemyIds: ['enemy_dragon_king'] }] }] },
  ],
});

event('ev_ending_complete', '永燃之冠 — 终章', {
  inScene: ['scene_ending_light', 'scene_ending_dark', 'scene_ending_neutral', 'scene_ending_hidden'],
  tags: ['main', 'epilogue', 'ending'], priority: 100,
  description: '你的旅程到达了尽头。',
  choices: [
    { text: '让命运成为定数', outcomes: [{ text: '故事在此凝固。',
      effects: [{ type: 'set_variable', name: 'game_complete', value: true }] }] },
  ],
});

// ============================================================
// 15. 大量"小事件"散落在各场景 —— 这是 AI 上下文检索压力测试的重点
// ============================================================

// helper：批量生成小事件
let smallEventCount = 0;
function smallEvent(sceneId, name, description, opts = {}) {
  const id = `ev_small_${++smallEventCount}`;
  event(id, name, {
    inScene: [sceneId], tags: ['side', ...(opts.tags || [])],
    priority: opts.priority ?? 30,
    description,
    choices: opts.choices || [
      { text: '继续前进', outcomes: [{ text: '没有什么特别的事发生。', effects: [] }] },
    ],
  });
}

// 城镇小事件
smallEvent(ASTRA.market, '小偷扒窃', '一个孩子撞上你的口袋。', { choices: [
  { text: '抓住他', outcomes: [{ text: '孩子哭起来。你松了手。', effects: [{ type: 'set_variable', name: 'mercy_pts', value: 1 }] }] },
  { text: '让他走', outcomes: [{ text: '孩子飞快跑远。', effects: [{ type: 'set_variable', name: 'mercy_pts', value: 1 }] }] },
] });
smallEvent(ASTRA.well, '井底声音', '俯身能听见水里传来微弱的低语。', { tags: ['arcane'] });
smallEvent(ASTRA.library, '羊皮纸碎片', '一份残页提到"虚空契约"。', { choices: [
  { text: '收起', outcomes: [{ text: '你折好放进背包。', effects: [{ type: 'set_worldFlag', name: 'know_void_pact', value: true }] }] },
] });
smallEvent(ASTRA.guild, '公告板任务', '"狼群骚扰猎人，悬赏 30 金。"', {
  choices: [{ text: '接下', outcomes: [{ text: '加尔德把任务卡推过来。',
    effects: [{ type: 'set_variable', name: 'quest_wolves', value: true }] }] }],
});

// 黑松林小事件
smallEvent(THORN.path,  '野花',     '路边一束陌生的野花。', {
  choices: [{ text: '采一朵', outcomes: [{ text: '你嗅了嗅。', effects: [{ type: 'add_item', itemId: 'item_moonshade' }] }] }],
});
smallEvent(THORN.glade, '阳光下的小鹿', '一只小鹿出现在草地中央。', { tags: ['vignette'] });
smallEvent(THORN.shrine, '神龛的低语', '神龛上残留着血字："不要看下面"。', { tags: ['arcane'] });
smallEvent(THORN.ravine, '滚石',   '上方一块碎石滑落。', {
  choices: [
    { text: '躲开', outcomes: [{ text: '勉强避开。', effects: [] }] },
    { text: '看清来源', outcomes: [{ text: '上方有人影闪过。', effects: [{ type: 'set_worldFlag', name: 'someone_in_ravine', value: true }] }] },
  ],
});
smallEvent(THORN.cliff, '俯瞰',   '从悬崖看见远处的塔影。', { tags: ['vignette'] });
smallEvent(THORN.brook, '冷溪',   '溪水清澈刺骨。', {
  choices: [{ text: '装一瓶', outcomes: [{ text: '你装了一瓶水。', effects: [{ type: 'add_item', itemId: 'item_potion_minor' }] }] }],
});
smallEvent(THORN.camp,  '篝火残灰', '有人最近在这里露营过。', { tags: ['vignette'] });
smallEvent(THORN.hidden_grove, '林地秘密', '一块石碑：刻着古老的符文。', { tags: ['arcane', 'hidden'],
  choices: [{ text: '触摸石碑', outcomes: [{ text: '一阵暖流贯入你身体。', effects: [{ type: 'heal', target: 'all', value: 30 }] }] }],
});

// 沼泽小事件
smallEvent(MARSH.road,  '泥沼陷阱', '前方泥地有可疑的气泡。', {
  choices: [
    { text: '绕路', outcomes: [{ text: '安全通过。', effects: [] }] },
    { text: '硬走', outcomes: [{ text: '差点陷进去。', effects: [{ type: 'damage', target: 'all', value: 5 }] }] },
  ],
});
smallEvent(MARSH.ferry, '渡口闲谈', '船夫提到沼泽深处的女巫。', { tags: ['npc'] });
smallEvent(MARSH.willow, '挂在树上的纸条', '"如果你看见这个，往北。"', { tags: ['hint'] });
smallEvent(MARSH.graves, '坟头声音', '从其中一座坟里传出哭声。', { tags: ['undead', 'spooky'],
  choices: [
    { text: '走开', outcomes: [{ text: '你走开了。', effects: [] }] },
    { text: '走近', outcomes: [{ text: '骷髅突然从土里钻出！',
      effects: [{ type: 'start_combat', enemyIds: ['enemy_skeleton', 'enemy_skeleton'] }] }] },
  ],
});
smallEvent(MARSH.ruins, '沉没村落', '半埋在水里的小屋。', { tags: ['vignette'] });
smallEvent(MARSH.shrine, '迷雾神龛', '香炉里残着一炷将熄的香。', { tags: ['arcane'] });

// 荆木堡小事件
smallEvent(KEEP.yard,    '士兵闲谈', '"夫人最近脾气大。"', { tags: ['gossip'] });
smallEvent(KEEP.barracks,'磨剑',     '兵士在磨他们的剑。', { tags: ['vignette'] });
smallEvent(KEEP.chapel,  '蜡烛',     '一支蜡烛在祭坛上独自燃烧。', { tags: ['vignette'] });
smallEvent(KEEP.balcony, '远眺',     '能看见黑松林的轮廓。', { tags: ['vignette'] });
smallEvent(KEEP.garden,  '夫人的玫瑰', '夫人在剪玫瑰，没有抬头。', { tags: ['npc'] });
smallEvent(KEEP.stable,  '老马',     '一匹老灰马哼了一声。', { tags: ['vignette'] });

// 山脉小事件
smallEvent(RANGE.foothill, '山脚石碑', '"前方需注意落石。"', { tags: ['hint'] });
smallEvent(RANGE.pass,     '风口',    '冷风让你的眼睛流泪。', { tags: ['vignette'] });
smallEvent(RANGE.peak1,    '远眺王国', '你看见了整个王国。', { tags: ['vignette'] });
smallEvent(RANGE.peak2,    '哀风',    '风像是在哭。', { tags: ['vignette'] });
smallEvent(RANGE.cave1,    '岩缝',    '从缝里能看到某种发光的东西。', {
  choices: [{ text: '伸手去拿', outcomes: [{ text: '是一块龙骨。',
    effects: [{ type: 'add_item', itemId: 'item_dragon_bone' }] }] }],
});
smallEvent(RANGE.glacier,  '冰里的影子', '冰川深处有古老的轮廓。', { tags: ['arcane'] });
smallEvent(RANGE.bonefield, '龙骨平原', '巨大的脊骨横亘平原。', { tags: ['vignette'] });
smallEvent(RANGE.rift,     '虚空裂缝', '裂缝里渗出黑色的光。', { tags: ['arcane', 'void'],
  choices: [
    { text: '快速绕开', outcomes: [{ text: '一阵寒意。', effects: [] }] },
    { text: '凝视裂缝', outcomes: [{ text: '某种东西在凝视回你。',
      effects: [{ type: 'set_variable', name: 'void_glance', value: true }] }] },
  ],
});
smallEvent(RANGE.refuge,   '避难所炉火', '炉火早已熄了。', { tags: ['vignette'] });
smallEvent(RANGE.monastery, '隐士的茶', '隐士给你倒了一杯没有味道的茶。', { tags: ['npc'] });

// 巫师塔小事件
smallEvent(SPIRE.lab,        '残液',     '炼金台上残留的紫色液体仍在冒泡。', { tags: ['arcane'] });
smallEvent(SPIRE.library,    '禁书',     '一本书自己翻开了。', { tags: ['arcane'] });
smallEvent(SPIRE.observatory, '星图',    '挂在墙上的星图标着"第七星已殁"。', { tags: ['arcane'] });
smallEvent(SPIRE.conjuring,  '召唤阵',   '法阵里漂浮着半成形的虚空触手。', {
  choices: [
    { text: '迅速通过', outcomes: [{ text: '触手没抓到你。', effects: [] }] },
    { text: '攻击触手', outcomes: [{ text: '触手反击！',
      effects: [{ type: 'start_combat', enemyIds: ['enemy_void_thing'] }] }] },
  ],
});

// 重复战斗事件（在野外可重复触发的小遇）
function repeatableCombat(sceneId, eventName, enemyIds, priority = 25) {
  const id = `ev_combat_${sceneId}_${enemyIds[0]}`;
  event(id, eventName, {
    inScene: [sceneId], tags: ['combat', 'random'], priority,
    repeatable: true, probability: 0.12,
    description: `路上突然窜出${eventName}。`,
    choices: [{ text: '应战', outcomes: [{ text: '战斗。',
      effects: [{ type: 'start_combat', enemyIds }] }] }],
  });
}
repeatableCombat(THORN.path, '一群森林狼', ['enemy_wolf', 'enemy_wolf']);
repeatableCombat(THORN.ravine, '哥布林斥候', ['enemy_goblin_scout', 'enemy_goblin_archer']);
repeatableCombat(MARSH.bog1, '沼泽潜行者', ['enemy_marsh_lurker']);
repeatableCombat(MARSH.bog2, '巨蜘蛛', ['enemy_giant_spider']);
repeatableCombat(MARSH.graves, '骷髅', ['enemy_skeleton', 'enemy_skeleton']);
repeatableCombat(RANGE.peak1, '岩石巨魔', ['enemy_cave_troll']);
repeatableCombat(RANGE.cave2, '小型龙崽', ['enemy_drake']);
repeatableCombat(GMINE.hall, '哥布林巡逻', ['enemy_goblin_scout', 'enemy_goblin_scout']);
repeatableCombat(GMINE.side1, '哥布林萨满', ['enemy_goblin_shaman']);
repeatableCombat(SPIRE.atrium, '腐化守卫', ['enemy_corrupt_guard']);

// 场景变体（部分关键场景）
preset.scenes.find(s => s.id === ASTRA.square).variants = [
  { id: 'after_crown_a', when: { requireWorldFlags: { crown_a_taken: true } },
    description: '广场上的人们三两聚谈："听说有人从黑松林带回了不一样的东西。"' },
];
preset.scenes.find(s => s.id === KEEP.gate).variants = [
  { id: 'after_council', when: { requireCompletedEvents: ['ev_keep_council'] },
    description: '吊桥已经放下，守卫朝你举手致意。' },
];
preset.scenes.find(s => s.id === RANGE.dragon_lair).variants = [
  { id: 'after_dragon', when: { requireCompletedEvents: ['ev_range_dragon'] },
    description: '岩龙的尸体静静躺着。空气里有金属和血的味道。',
    vignettes: ['风穿过空巢。'] },
];

// ============================================================
// 15.5 补：霜原镇 (中段补给小镇) + 几个支线场景 凑齐 100+
// ============================================================
const FROST = {
  gate:    'scene_frost_gate',
  square:  'scene_frost_square',
  inn:     'scene_frost_inn',
  shop:    'scene_frost_shop',
  shrine:  'scene_frost_shrine',
  graves:  'scene_frost_graves',
  outpost: 'scene_frost_outpost',
};
scene(FROST.gate,    '霜原镇门',     'settlement', { icon: '🏘', x: 11, y: 1, tags: ['safe', 'frost'] });
scene(FROST.square,  '霜原小广场',   'settlement', { icon: '🏘', x: 12, y: 1, tags: ['safe', 'hub', 'frost'] });
scene(FROST.inn,     '霜原旅馆',     'inn',        { icon: '🛏', x: 12, y: 2, tags: ['safe', 'inn', 'frost'] });
scene(FROST.shop,    '霜原杂货',     'settlement', { icon: '🏬', x: 13, y: 1, tags: ['safe', 'shop', 'frost'] });
scene(FROST.shrine,  '霜原小神龛',   'vignette',   { icon: '⛩', x: 13, y: 2, tags: ['frost', 'arcane'] });
scene(FROST.graves,  '霜原墓地',     'vignette',   { icon: '⚰', x: 11, y: 2, tags: ['frost', 'undead'] });
scene(FROST.outpost, '北方哨站',     'settlement', { icon: '🏰', x: 12, y: -2, tags: ['safe', 'frost', 'main'] });
connect(KEEP.gate, FROST.gate, '北行去霜原镇');
connect(FROST.gate, FROST.square, '走入广场');
connect(FROST.square, FROST.inn, '走进旅馆');
connect(FROST.square, FROST.shop, '走进杂货');
connect(FROST.square, FROST.shrine, '走到神龛');
connect(FROST.square, FROST.graves, '走向墓地');
connect(FROST.square, FROST.outpost, '北上去哨站');
connect(FROST.outpost, RANGE.foothill, '继续北上去龙骨山脉');

smallEvent(FROST.square, '篝火集会',    '霜原人围着篝火说书。', { tags: ['vignette'] });
smallEvent(FROST.inn,    '酒馆故事',    '一个醉汉提到"巫师塔顶有龙"。', { tags: ['gossip'] });
smallEvent(FROST.shop,   '霜原杂货',    '老板娘冲你笑：要点什么？', { tags: ['shop'] });
smallEvent(FROST.graves, '风中纸钱',    '风把一张纸钱卷到你脚边。', { tags: ['undead'] });
smallEvent(FROST.outpost, '哨兵报告',   '"昨晚听到山里有龙吼。"', { tags: ['hint'] });

// 快速旅行 — 移到 FROST 定义之后，所有 hub 都已存在
event('ev_fast_travel_astra', '驿马服务（快速旅行）', {
  inScene: [ASTRA.square], tags: ['side', 'fast_travel'], priority: 50,
  repeatable: false,   // 只触发一次：首次到广场介绍驿马服务，之后不再每次进 hub 弹出
  description: '广场角落，驿马师傅吆喝："要去哪？只送已经走过的地方。"',
  choices: [
    { text: '前往荆木堡内庭', outcomes: [{ text: '驿马很快。',
      effects: [{ type: 'teleport_to_scene', sceneId: KEEP.yard }, { type: 'advance_time', value: 4 }] }] },
    { text: '前往霜原小广场', outcomes: [{ text: '寒风迎面。',
      effects: [{ type: 'teleport_to_scene', sceneId: FROST.square }, { type: 'advance_time', value: 6 }] }] },
    { text: '前往北方哨站', outcomes: [{ text: '驿马师傅摇头不语。',
      effects: [{ type: 'teleport_to_scene', sceneId: FROST.outpost }, { type: 'advance_time', value: 7 }] }] },
    { text: '算了。', outcomes: [{ text: '驿马师傅耸肩。', effects: [] }] },
  ],
});

event('ev_fast_travel_keep', '荆木堡马厩（快速旅行）', {
  inScene: [KEEP.stable], tags: ['side', 'fast_travel'], priority: 50,
  repeatable: false,   // 只触发一次（同上）
  description: '马夫认得你的样子："要回阿斯特拉哈文吗？"',
  choices: [
    { text: '回阿斯特拉哈文广场', outcomes: [{ text: '一路顺风。',
      effects: [{ type: 'teleport_to_scene', sceneId: ASTRA.square }, { type: 'advance_time', value: 4 }] }] },
    { text: '前往霜原小广场', outcomes: [{ text: '一路向北。',
      effects: [{ type: 'teleport_to_scene', sceneId: FROST.square }, { type: 'advance_time', value: 3 }] }] },
    { text: '不了。', outcomes: [{ text: '马夫继续刷马。', effects: [] }] },
  ],
});

// 沼泽休息点 — 维克斯女巫的茶炉
event('ev_rest_witch', '维克斯的茶炉', {
  inScene: [MARSH.witch], tags: ['side', 'rest'], priority: 70,
  repeatable: true,
  description: '维克斯朝你点头："想坐一会儿吗？茶炉永远在。不收钱，但别问太多问题。"',
  choices: [
    { text: '休息片刻（回满 HP/MP）', outcomes: [{
      text: '她递过一杯没有味道的茶。你眨眼之间，已经过去了几个小时。',
      effects: [
        { type: 'heal', target: 'all', value: 999 },
        { type: 'advance_time', value: 4 },
      ],
    }] },
    { text: '不了，直接去祭坛。', outcomes: [{ text: '维克斯耸肩。', effects: [] }] },
  ],
});

event('ev_rest_frost', '霜原旅馆 — 住一晚', {
  inScene: [FROST.inn], tags: ['side', 'rest'], priority: 80,
  repeatable: true,
  description: '炉火不旺，但被褥干净。老板招呼你坐下。"5 个银币一晚。"',
  choices: [
    { text: '住一晚（回满 HP/MP）', outcomes: [{
      text: '清晨的山风把你唤醒。',
      effects: [
        { type: 'heal', target: 'all', value: 999 },
        { type: 'advance_time', value: 8 },
      ],
    }] },
    { text: '不了。', outcomes: [{ text: '老板转身回炉前。', effects: [] }] },
  ],
});

// 几个秘密角落
scene('scene_thorn_grave',  '黑松林无名坟', 'vignette', { icon: '⚰', x: 5, y: -8, tags: ['forest', 'hidden'] });
connect(THORN.cliff, 'scene_thorn_grave', '绕到悬崖背后', { discovered: false });
smallEvent('scene_thorn_grave', '无名坟', '坟上没有名字，只插着一柄朽剑。', { choices: [
  { text: '拔出朽剑', outcomes: [{ text: '剑碎成粉。', effects: [] }] },
  { text: '默哀离开',  outcomes: [{ text: '你转身。', effects: [{ type: 'set_variable', name: 'mercy_pts', value: 2 }] }] },
] });

scene('scene_marsh_island', '雾岛',         'vignette', { icon: '🏝', x: 7, y: 7, tags: ['marsh', 'hidden'] });
connect(MARSH.witch, 'scene_marsh_island', '租维克斯的小舟', { discovered: false });
smallEvent('scene_marsh_island', '雾岛低语', '雾里有人在唱歌。', { tags: ['arcane'] });

// ============================================================
// 15.6 给 4 个 ending 场景挂结局事件，让 scale_check 识别多结局
// ============================================================
event('ev_ending_light', '黎明加冕（结局）', {
  inScene: ['scene_ending_light'], tags: ['main', 'epilogue', 'ending'], priority: 100,
  description: '你高举永燃之冠，阳光为你加冕。整个世界听见你的名字。',
  choices: [{ text: '让史书记下', outcomes: [{ text: '故事至此完结。',
    effects: [{ type: 'set_variable', name: 'ending', value: 'light' }] }] }],
});
event('ev_ending_dark', '虚空契约（结局）', {
  inScene: ['scene_ending_dark'], tags: ['main', 'epilogue', 'ending'], priority: 100,
  description: '冠在你掌中，与虚空交融。下一个时代将由你定义。',
  choices: [{ text: '迈出第一步', outcomes: [{ text: '世界陷入沉默。',
    effects: [{ type: 'set_variable', name: 'ending', value: 'dark' }] }] }],
});
event('ev_ending_neutral', '走向远方（结局）', {
  inScene: ['scene_ending_neutral'], tags: ['main', 'epilogue', 'ending'], priority: 100,
  description: '你把冠埋回大地，转身。前路尚长。',
  choices: [{ text: '上路', outcomes: [{ text: '你已不再回头。',
    effects: [{ type: 'set_variable', name: 'ending', value: 'neutral' }] }] }],
});
event('ev_ending_hidden', '永燃合一（隐藏结局）', {
  inScene: ['scene_ending_hidden'], tags: ['main', 'epilogue', 'ending', 'hidden'], priority: 100,
  description: '只有完整地爱过、拯救过同伴的人，才能听见星辰最后的耳语。',
  choices: [{ text: '与冠合一', outcomes: [{ text: '你成为下一任守护者。',
    effects: [{ type: 'set_variable', name: 'ending', value: 'hidden' }] }] }],
});

// ============================================================
// 16. 设置 startingSceneId（默认 farmer）
// ============================================================
preset.startingSceneId = 'scene_farm_morning';

// ============================================================
// 写盘
// ============================================================
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(preset, null, 2), 'utf-8');

console.log(`\n=== 大型剧本生成完成 ===`);
console.log(`  路径: ${OUT_PATH}`);
console.log(`  📍 场景: ${preset.scenes.length}`);
console.log(`  📜 事件: ${preset.events.length}`);
console.log(`  🧑 NPC: ${preset.npcs.length} (含 ${preset.npcs.filter(n => n.recruitable).length} 可招募)`);
console.log(`  🤝 关系: ${preset.npcRelations.length}`);
console.log(`  ⚔ 敌人: ${preset.enemies.length}`);
console.log(`  🎒 物品: ${preset.items.length}`);
console.log(`  🌅 结局: ${preset.scenes.filter(s => s.type === 'ending').length}`);

const fileSize = fs.statSync(OUT_PATH).size;
console.log(`  💾 文件大小: ${(fileSize / 1024).toFixed(1)} KB`);

// ============================================================
// 可选：跑 MCP 健康检查
// ============================================================
const args = process.argv.slice(2);
if (args.includes('--validate')) {
  console.log(`\n=== 启动 MCP 服务器跑体检 ===`);
  await runMcpValidation();
}

async function runMcpValidation() {
  return new Promise((resolve) => {
    const proc = spawn('node', [MCP_SERVER, OUT_PATH], { stdio: ['pipe', 'pipe', 'inherit'] });
    let nextId = 1, buffer = '';
    const pending = new Map();
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && pending.has(msg.id)) {
            const { resolve } = pending.get(msg.id);
            pending.delete(msg.id);
            resolve(msg);
          }
        } catch { /* ignore */ }
      }
    });

    const send = (method, params) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 30000);
    });

    const call = async (tool, args = {}) => {
      const r = await send('tools/call', { name: tool, arguments: args });
      return r.result?.content?.[0]?.text || '';
    };

    (async () => {
      try {
        await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gen-script', version: '1.0' } });
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        await call('preset_load');
        console.log('\n--- preset_validate ---');
        console.log(await call('preset_validate'));
        console.log('\n--- preset_analyze ---');
        console.log(await call('preset_analyze'));
        console.log('\n--- preset_scale_check ---');
        console.log(await call('preset_scale_check'));
      } catch (e) {
        console.error('MCP 校验出错:', e.message);
      } finally {
        proc.stdin.end();
        proc.kill();
        resolve();
      }
    })();
  });
}
