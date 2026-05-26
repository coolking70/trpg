#!/usr/bin/env node
/**
 * 末日生存题材预设生成器
 *
 * 主题：「最后的避难所」— 核冬天后的废土幸存者故事
 * 规模目标：
 *   - 60+ 场景节点
 *   - 12+ NPC（2-3 可招募）
 *   - 80+ 事件
 *   - 4 章主线 + 3 个 ending
 *   - 演示 Phase 26C 新机制：phases (突变体 boss) / status (辐射中毒 dot) / AOE
 *
 * 用法: node scripts/generate-survival-preset.mjs [--validate]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'presets', 'last-shelter-survival.json');
const MCP_SERVER = path.join(ROOT, 'mcp-server', 'preset-server.mjs');

// ============================================================
// 预设骨架
// ============================================================
const preset = {
  version: '1.0.0',
  presetId: 'last_shelter_survival',
  name: '最后的避难所',
  author: 'D1 生成',
  createdAt: new Date().toISOString(),
  description: '核冬天后的废土生存。寻找失散的家人、躲避辐射风暴、与突变体抗争——你能撑到春天吗？',
  lore: {
    worldName: '废土 2087',
    era: '大战后 35 年',
    background: '85 年前，三大势力的核战略让大半地球归于灰烬。35 年后，幸存者在地下避难所与变异生态间挣扎。你刚收到一封无线电——你弟弟可能还活着。',
    rules: '辐射伤害会持续叠加，必须按时服药。突变体强大但行动迟缓。资源管理是关键。',
    gmStyle: '冷峻、克制，环境描写偏荒凉细节。情感处用沉默胜过言辞。',
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
  rules: { diceType: 'd20', combatFormula: '(attack + dice) - defense', maxPartySize: 3, startingGold: 0 },
  aiConfig: { temperature: 0.6, maxResponseTokens: 900, useStructuredOutput: true, language: 'zh-CN' },
};

// ============================================================
// 辅助函数
// ============================================================
const usedCoords = new Set();
function coord(x, y) {
  let k = `${x},${y}`, dx = 0;
  while (usedCoords.has(k)) { dx++; k = `${x + dx},${y}`; }
  usedCoords.add(k);
  const [fx, fy] = k.split(',').map(Number);
  return { x: fx, y: fy };
}
function scene(id, name, type, opts = {}) {
  preset.scenes.push({
    id, name, type, icon: opts.icon || '',
    description: opts.description || '',
    coords: opts.coords || coord(opts.x ?? 0, opts.y ?? 0),
    connections: [], events: opts.events || [], vignettes: opts.vignettes || [],
    tags: opts.tags || [],
    ...(opts.variants ? { variants: opts.variants } : {}),
  });
}
function connect(fromId, toId, label, opts = {}) {
  const f = preset.scenes.find(s => s.id === fromId);
  const t = preset.scenes.find(s => s.id === toId);
  if (!f || !t) throw new Error(`connect: 不存在 ${fromId} 或 ${toId}`);
  f.connections.push({ to: toId, label, ...(opts.gated ? { gated: opts.gated } : {}), ...(opts.discovered === false ? { discovered: false } : {}) });
  if (!opts.oneWay) t.connections.push({ to: fromId, label: opts.returnLabel || `返回 ${f.name}` });
}
function attachEvent(sceneId, eventId) {
  const s = preset.scenes.find(s => s.id === sceneId);
  if (!s) throw new Error(`attachEvent: 不存在 ${sceneId}`);
  if (!s.events.includes(eventId)) s.events.push(eventId);
}
function character(id, name, opts = {}) {
  const stats = { hp: 100, mp: 30, attack: 12, defense: 8, magicAttack: 4, magicDefense: 8, speed: 10, luck: 5, ...(opts.stats || {}) };
  preset.characters.push({
    id, type: 'character', name, title: opts.title || '', description: opts.description || '',
    stats: { ...stats, hpCurrent: stats.hp, mpCurrent: stats.mp },
    abilities: opts.abilities || [], inventory: opts.inventory || [],
    equipment: opts.equipment || { weapon: null, armor: null, accessory: null },
    position: { x: 0, y: 0 }, level: opts.level || 1, experience: 0,
    statusEffects: [], tags: opts.tags || [], notes: '',
  });
}
function enemy(id, name, opts = {}) {
  const stats = { hp: 40, mp: 0, attack: 10, defense: 6, magicAttack: 0, magicDefense: 4, speed: 8, luck: 1, ...(opts.stats || {}) };
  preset.enemies.push({
    id, type: 'enemy', name, description: opts.description || '',
    stats: { ...stats, hpCurrent: stats.hp, mpCurrent: stats.mp },
    abilities: opts.abilities || [], lootTable: opts.lootTable || [],
    behaviorHint: opts.behaviorHint || 'aggressive',
    experienceReward: opts.exp || 20, difficulty: opts.difficulty || 'normal',
    position: { x: 0, y: 0 }, statusEffects: [], tags: opts.tags || [], notes: '',
    ...(opts.phases ? { phases: opts.phases } : {}),
  });
}
function item(id, name, itemType, opts = {}) {
  preset.items.push({
    id, type: 'item', name, itemType, description: opts.description || '',
    equipSlot: opts.equipSlot ?? (itemType === 'weapon' ? 'weapon' : itemType === 'armor' ? 'armor' : itemType === 'accessory' ? 'accessory' : null),
    statModifiers: opts.statModifiers || {}, consumeEffect: opts.consumeEffect || null,
    buyPrice: opts.buyPrice || 0, sellPrice: opts.sellPrice || 0,
    stackable: opts.stackable ?? ['consumable', 'material'].includes(itemType),
    tags: opts.tags || [],
  });
}
function event(id, name, opts = {}) {
  const choices = (opts.choices || []).map((c, i) => ({
    id: c.id || `choice_${i + 1}`, text: c.text, requirements: null,
    outcomes: (c.outcomes || []).map(o => ({
      probability: o.probability ?? 1.0, text: o.text, effects: o.effects || [],
    })),
  }));
  preset.events.push({
    id, type: 'event', name, description: opts.description || '',
    eventType: opts.eventType || 'story', priority: opts.priority ?? 50,
    trigger: { type: 'composite', condition: {
      ...(opts.inScene ? { inScene: opts.inScene } : {}),
      ...(opts.requireVariables ? { requireVariables: opts.requireVariables } : {}),
      ...(opts.requireCompletedEvents ? { requireCompletedEvents: opts.requireCompletedEvents } : {}),
      excludeCompletedEvents: opts.excludeCompletedEvents || [id],
      probability: opts.probability ?? 1.0,
    }},
    choices, repeatable: opts.repeatable || false,
    maxOccurrences: opts.repeatable ? 99 : 1,
    aiPromptHint: opts.aiPromptHint || '', tags: opts.tags || [], notes: '',
  });
  if (opts.inScene) opts.inScene.forEach(sid => attachEvent(sid, id));
}
function npcRel(from, to, strength, note = '') {
  preset.npcRelations.push({ from, to, strength, note });
}
function npc(id, name, opts = {}) {
  preset.npcs.push({
    id, type: 'npc', name, title: opts.title || '', description: opts.description || '',
    icon: opts.icon || '🧑', personality: opts.personality || '',
    recruitable: !!opts.recruitable, spawnScene: opts.spawnScene,
    initialInventory: opts.initialInventory || [], giftPreferences: opts.giftPreferences || {},
    schedule: opts.schedule || [], stats: opts.stats, abilities: opts.abilities || [],
    dialogueTree: opts.dialogueTree || null, tags: opts.tags || [],
  });
}
function smallEvent(sceneId, name, desc, opts = {}) {
  const id = `ev_small_${preset.events.length}`;
  event(id, name, {
    inScene: [sceneId], tags: ['side', ...(opts.tags || [])],
    priority: opts.priority ?? 30, description: desc,
    choices: opts.choices || [{ text: '继续', outcomes: [{ text: '没有特别的事情发生。', effects: [] }] }],
    repeatable: opts.repeatable || false,
  });
}

// ============================================================
// 1. 角色创建（生存特色：体质 / 出身 / 专长）
// ============================================================
preset.startingOptions = {
  races: [
    { id: 'normal',  name: '普通人', icon: '🧑', tags: ['race:normal'], description: '从前的普通生活让你保留了一些人性。' },
    { id: 'ghoul',   name: '尸鬼后裔', icon: '☢', tags: ['race:ghoul', 'rad_resistant'], statBonus: { hp: -10, defense: 2, magicDefense: 6 }, description: '辐射没有杀死你，但也改写了你。免疫低剂量辐射。' },
    { id: 'augmented', name: '改造人', icon: '🤖', tags: ['race:augmented', 'cybernetic'], statBonus: { attack: 3, hp: 10, luck: -2 }, description: '战前科技的产物——金属的身体，褪色的灵魂。' },
  ],
  origins: [
    { id: 'vault',  name: '避难所原住民', icon: '🏚', tags: ['origin:vault', 'literate'], description: '从未见过太阳，但读过很多书。' },
    { id: 'raider', name: '前掠夺者', icon: '🗡', tags: ['origin:raider', 'street_wise'], statBonus: { attack: 2, magicDefense: -2 }, description: '你曾经做过糟糕的事。' },
    { id: 'doctor', name: '游医', icon: '⚕', tags: ['origin:doctor', 'medic'], statBonus: { magicAttack: 3 }, description: '残破的世界里仍想救人。' },
  ],
  backgrounds: [
    { id: 'scavenger', name: '拾荒者', icon: '🔧', tags: ['bg:scavenger'], statBonus: { luck: 3 }, description: '能从垃圾堆里淘出宝贝。' },
    { id: 'sniper',    name: '冷狙', icon: '🎯', tags: ['bg:sniper'], statBonus: { attack: 3, speed: 1 }, description: '一击必杀。' },
    { id: 'survivor',  name: '老兵',  icon: '⚔', tags: ['bg:survivor', 'weapon_trained'], statBonus: { hp: 15, defense: 2 }, description: '挨过的子弹比你吃的子弹多。' },
  ],
  faiths: [
    { id: 'atom',  name: '原子信徒', icon: '☢', tags: ['faith:atom'], description: '辐射是终极洗礼。' },
    { id: 'old_world', name: '旧世怀念者', icon: '📻', tags: ['faith:old_world'], description: '相信文明还能回来。' },
    { id: 'none',  name: '虚无',     icon: '🚫', tags: ['faith:none', 'skeptic'], description: '没人会来救你。只有你自己。' },
  ],
};
preset.startingSceneRules = [
  { when: { tags: ['origin:vault'] }, sceneId: 'scene_vault_door' },
  { when: { tags: ['origin:raider'] }, sceneId: 'scene_raider_camp_ruin' },
  { default: 'scene_wanderers_hill' },
];

// ============================================================
// 2. 物品
// ============================================================
item('item_pistol_9mm',   '9mm 手枪',    'weapon', { statModifiers: { attack: 5 }, buyPrice: 80, description: '弹匣 12 发。' });
item('item_rifle_hunting','猎枪',         'weapon', { statModifiers: { attack: 9, speed: -1 }, buyPrice: 200 });
item('item_smg',          '突击步枪',     'weapon', { statModifiers: { attack: 12 }, buyPrice: 400, tags: ['military'] });
item('item_combat_knife', '战术匕首',     'weapon', { statModifiers: { attack: 4, speed: 2 }, buyPrice: 30 });
item('item_leather_jkt',  '皮夹克',       'armor', { statModifiers: { defense: 3 }, buyPrice: 40 });
item('item_combat_armor', '战术背心',     'armor', { statModifiers: { defense: 7 }, buyPrice: 200, tags: ['military'] });
item('item_geiger',       '盖革计数器',   'accessory', { statModifiers: { luck: 2 }, tags: ['detector'] });
item('item_radlight',     '放射灯',       'accessory', { statModifiers: { magicDefense: 3 } });

// 消耗品
item('item_stimpak',      '医疗针',       'consumable', { consumeEffect: { type: 'heal', stat: 'hp', value: 50 }, buyPrice: 20 });
item('item_rad_pill',     '辐射药',       'consumable', { consumeEffect: { type: 'heal', stat: 'hp', value: 15 }, buyPrice: 12, tags: ['anti_radiation'] });
item('item_water',        '净化水',       'consumable', { consumeEffect: { type: 'heal', stat: 'hp', value: 8 }, buyPrice: 3 });
item('item_can_food',     '军用罐头',     'consumable', { consumeEffect: { type: 'heal', stat: 'hp', value: 20 }, buyPrice: 8 });
item('item_smoke_grenade','烟雾弹',       'consumable', { consumeEffect: { type: 'escape_combat', hpPenaltyPct: 0.10 }, buyPrice: 35, tags: ['utility'] });
item('item_emp_grenade',  'EMP 手雷',     'consumable', { buyPrice: 60, tags: ['utility'] });

// 材料
item('item_scrap_metal',  '金属碎片',     'material', { sellPrice: 3 });
item('item_circuit',      '电路板',       'material', { sellPrice: 15, tags: ['tech'] });
item('item_pure_water',   '纯水',         'material', { sellPrice: 8, tags: ['rare'] });
item('item_mutant_organ', '突变体器官',   'material', { sellPrice: 25, tags: ['monster_part'] });

// 任务物品
item('item_radio',        '军用无线电',   'quest', { description: '弟弟的最后通讯设备。', tags: ['main'] });
item('item_vault_key',    '避难所门禁卡', 'quest', { description: '"控制中心" 的访问令牌。', tags: ['main'] });
item('item_brother_photo','弟弟的照片',   'quest', { description: '他笑着对你比 V。', tags: ['main'] });
item('item_old_map',      '战前地图',     'quest', { description: '85 年前的城市规划。' });

// ============================================================
// 3. 敌人（含 phases boss）
// ============================================================
enemy('enemy_raider',         '掠夺者',     { stats: { hp: 50, attack: 12, defense: 5 }, exp: 12, lootTable: [{ itemId: 'item_scrap_metal', dropRate: 0.5 }, { itemId: 'item_pistol_9mm', dropRate: 0.1 }] });
enemy('enemy_raider_chief',   '掠夺者头目', { stats: { hp: 120, attack: 18, defense: 10 }, exp: 60, difficulty: 'hard',
  lootTable: [{ itemId: 'item_smg', dropRate: 0.3 }, { itemId: 'item_combat_armor', dropRate: 0.4 }],
  abilities: [{ id: 'rc_burst', name: '点射', type: 'active', effect: { damage: { formula: 'attack+d8+2' } } }],
});
enemy('enemy_ghoul_wild',     '野尸鬼',     { stats: { hp: 35, attack: 9, defense: 3, speed: 11 }, exp: 8 });
enemy('enemy_ghoul_glowing',  '辐光尸鬼',   { stats: { hp: 60, attack: 14, defense: 6, magicAttack: 12 }, exp: 25,
  abilities: [{ id: 'rad_burst', name: '辐射爆发', type: 'active', cost: { mp: 0 },
    effect: { damage: { formula: 'magicAttack+d6' }, aoe: true, target: 'all_enemies',
              applyStatus: { type: 'dot', stat: 'hp', value: 3, duration: 3 } } }],
});
enemy('enemy_mole_rat',       '巨鼠',       { stats: { hp: 28, attack: 8, defense: 2, speed: 13 }, exp: 6 });
enemy('enemy_radroach',       '辐光蟑螂',   { stats: { hp: 12, attack: 5, defense: 1, speed: 15 }, exp: 3 });
enemy('enemy_super_mutant',   '超级变种人', { stats: { hp: 150, attack: 20, defense: 10 }, exp: 70, difficulty: 'hard' });
enemy('enemy_deathclaw',      '死亡爪',     { stats: { hp: 200, attack: 28, defense: 14, speed: 16 }, exp: 120, difficulty: 'boss', tags: ['boss'],
  abilities: [{ id: 'dc_claw', name: '撕裂', type: 'active', effect: { damage: { formula: 'attack+2d6' }, applyStatus: { type: 'debuff', stat: 'defense', value: 3, duration: 2 } } }],
});
enemy('enemy_robot_sentry',   '废墟哨兵机', { stats: { hp: 80, attack: 16, defense: 14, magicDefense: 14 }, exp: 40, tags: ['robot'] });
// 最终 boss — phases 演示
enemy('enemy_mutant_lord',    '变种领主 莱昂',
  { stats: { hp: 320, attack: 26, defense: 18, magicAttack: 18, magicDefense: 14, speed: 11 }, exp: 400, difficulty: 'boss',
    tags: ['mutant', 'boss', 'final'],
    abilities: [{ id: 'ml_swing', name: '巨锤横扫', type: 'active', effect: { damage: { formula: 'attack+d10' } } }],
    phases: [
      { id: 'mutated_50', hpThreshold: 0.50, statBoosts: { attack: 6 },
        narrative: '🩸 莱昂身上长出第二只手臂——突变在加深！',
        abilities: [{ id: 'ml_quake', name: '废土震荡', type: 'active',
          effect: { damage: { formula: '2d10+10' }, aoe: true, target: 'all_enemies' } }] },
      { id: 'frenzy_25', hpThreshold: 0.25, statBoosts: { speed: 6, attack: 4 },
        narrative: '☢ 莱昂全身辐射光泛起，他已不再是人。',
        abilities: [{ id: 'ml_meltdown', name: '熔融', type: 'active',
          effect: { damage: { formula: '3d8+15' }, aoe: true, target: 'all_enemies',
                    applyStatus: { type: 'dot', stat: 'hp', value: 6, duration: 3 } } }] },
    ],
  });

// ============================================================
// 4. 主角
// ============================================================
character('char_protagonist', '幸存者', {
  title: '寻弟者',
  description: '收到弟弟无线电后离开避难所的普通人。',
  stats: { hp: 130, mp: 30, attack: 14, defense: 10, magicAttack: 5, magicDefense: 9, speed: 11, luck: 6 },
  abilities: [
    { id: 'sv_aimed_shot', name: '瞄准射击', type: 'active', cost: { mp: 4 }, effect: { damage: { formula: 'attack+d8+3' } } },
    { id: 'sv_bandage',    name: '包扎',     type: 'active', cost: { mp: 5 }, cooldown: 2, effect: { heal: { formula: '25' } } },
    { id: 'sv_focus',      name: '凝神',     type: 'active', cost: { mp: 3 }, effect: { applyStatus: { type: 'buff', stat: 'attack', value: 5, duration: 3 }, target: 'self' } },
  ],
  inventory: ['item_pistol_9mm', 'item_stimpak', 'item_stimpak', 'item_water', 'item_water', 'item_brother_photo'],
  equipment: { weapon: 'item_pistol_9mm', armor: 'item_leather_jkt', accessory: null },
});

// ============================================================
// 5. 场景（约 65 个）
// ============================================================
// — 起始 spawn × 3
scene('scene_vault_door',        '避难所大门',    'spawn', { icon: '🚪', x: -8, y: 0, tags: ['safe', 'main'],
  description: '厚重的金属门缓缓合上。外面是 35 年没人见过的太阳。你的呼吸罩在面罩里。' });
scene('scene_raider_camp_ruin',  '废弃掠夺者营',  'spawn', { icon: '🔥', x: -8, y: 2, tags: ['main'],
  description: '篝火已熄。你的旧伙伴们都死了——只剩你和那台旧无线电。' });
scene('scene_wanderers_hill',    '流浪者高地',    'spawn', { icon: '⛰', x: -8, y: 4, tags: ['main'],
  description: '风穿过你的破雨衣。山下能看见废墟城市的轮廓——你今天必须下去。' });
attachEvent('scene_vault_door',       'ev_intro_vault');
attachEvent('scene_raider_camp_ruin', 'ev_intro_raider');
attachEvent('scene_wanderers_hill',   'ev_intro_drifter');

// — 中心 hub: 旧城废墟
const HUB = {
  market:  'scene_blackmarket',
  clinic:  'scene_clinic',
  bar:     'scene_neon_bar',
  square:  'scene_collapsed_square',
  gas:     'scene_gas_station',
  rooftop: 'scene_rooftop_camp',
};
scene(HUB.square,  '坍塌广场',     'settlement', { icon: '🏙', x: 0, y: 1, tags: ['safe', 'main', 'hub'],
  description: '昔日的中央广场，巨大喷泉只剩一具被锈蚀的钢筋骨架。这是幸存者交换情报的地方。' });
scene(HUB.market,  '地下黑市',     'settlement', { icon: '🏬', x: 1, y: 0, tags: ['safe', 'shop'],
  description: '钢筋撑起的地下空间，挂着 80 年代海报的残片。买卖一切——从子弹到记忆。' });
scene(HUB.clinic,  '废墟诊所',     'settlement', { icon: '⚕', x: -1, y: 0, tags: ['safe', 'shop', 'medic'],
  description: '昏黄灯光下，一位戴着护目镜的医生在缝合伤口。她不收钱，只要故事。' });
scene(HUB.bar,     '霓虹酒馆',     'inn',        { icon: '🍷', x: 0, y: 2, tags: ['safe', 'inn', 'camp', 'rest_point'],
  description: '霓虹"OPEN"招牌还会闪烁。老板是个改造人，记得所有人的名字。' });
scene(HUB.gas,     '加油站站口',   'wilderness', { icon: '⛽', x: 2, y: 1, tags: ['main'] });
scene(HUB.rooftop, '屋顶营地',     'wilderness', { icon: '🏕', x: 0, y: -1, tags: ['camp'] });

connect('scene_vault_door',        HUB.square, '走下避难所地面');
connect('scene_raider_camp_ruin',  HUB.square, '徒步穿越废土');
connect('scene_wanderers_hill',    HUB.square, '下山进城');
connect(HUB.square, HUB.market,  '溜进黑市');
connect(HUB.square, HUB.clinic,  '前往诊所');
connect(HUB.square, HUB.bar,     '走进酒馆');
connect(HUB.square, HUB.gas,     '东去加油站');
connect(HUB.square, HUB.rooftop, '上楼到屋顶');

// — 城市废墟区（约 12 节点）
const CITY = {
  station: 'scene_subway_station',
  metro1:  'scene_metro_tunnel1',
  metro2:  'scene_metro_tunnel2',
  store:   'scene_pharmacy',
  library: 'scene_old_library',
  alley:   'scene_dark_alley',
  apartment: 'scene_collapsed_apt',
  highway: 'scene_highway_overpass',
  tower:   'scene_radio_tower',
};
scene(CITY.station,  '地铁站',       'settlement', { icon: '🚇', x: 3, y: 1, tags: ['main'] });
scene(CITY.metro1,   '地铁隧道 1',   'wilderness', { icon: '🕳', x: 4, y: 1, tags: ['dungeon', 'main'] });
scene(CITY.metro2,   '地铁隧道 2',   'wilderness', { icon: '🕳', x: 5, y: 1, tags: ['dungeon'] });
scene(CITY.store,    '废弃药店',     'wilderness', { icon: '💊', x: 2, y: 2, tags: ['shop_loot'] });
scene(CITY.library,  '坍塌图书馆',   'vignette',   { icon: '📚', x: 1, y: 2, tags: ['arcane'] });
scene(CITY.alley,    '阴暗小巷',     'combat',     { icon: '🌃', x: 2, y: 3, tags: ['combat'] });
scene(CITY.apartment,'废弃公寓楼',   'dungeon',    { icon: '🏚', x: 3, y: 2, tags: ['dungeon'] });
scene(CITY.highway,  '高架桥',       'wilderness', { icon: '🛣', x: 4, y: 0, tags: ['main'] });
scene(CITY.tower,    '广播塔',       'settlement', { icon: '📡', x: 5, y: 0, tags: ['main', 'arcane'] });

connect(HUB.gas,     CITY.station, '深入站内');
connect(CITY.station, CITY.metro1, '下到地铁隧道');
connect(CITY.metro1,  CITY.metro2, '继续深入');
connect(HUB.market,  CITY.store,   '后门通向药店');
connect(HUB.square,  CITY.alley,   '走进阴影');
connect(CITY.alley,  CITY.apartment, '攀上残楼');
connect(HUB.gas,     CITY.highway, '走上高架');
connect(CITY.highway, CITY.tower,  '走向广播塔');
connect(HUB.clinic,  CITY.library, '取道图书馆');

// — 废土荒野区（约 10 节点）
const WL = {
  road1:  'scene_road1',
  road2:  'scene_road2',
  oasis:  'scene_oasis',
  cave:   'scene_radstorm_cave',
  bridge: 'scene_collapsed_bridge',
  factory: 'scene_old_factory',
  mountain: 'scene_mountain_pass',
  bunker: 'scene_concrete_bunker',
  crash:  'scene_aircraft_crash',
  field:  'scene_irradiated_field',
};
scene(WL.road1,   '废土公路',     'wilderness', { icon: '🛤', x: 6, y: 1, tags: ['main'] });
scene(WL.road2,   '废土公路·北', 'wilderness', { icon: '🛤', x: 7, y: 1, tags: ['main'] });
scene(WL.oasis,   '辐射绿洲',     'settlement', { icon: '🌴', x: 7, y: 2, tags: ['safe', 'camp', 'rest_point'],
  description: '反常的小片绿地。一个戴着旧式呼吸罩的老妇人住在这里。' });
scene(WL.cave,    '避辐射洞',     'wilderness', { icon: '🕳', x: 8, y: 1, tags: ['camp'] });
scene(WL.bridge,  '塌桥渡口',     'wilderness', { icon: '🌉', x: 8, y: 2, tags: ['main'] });
scene(WL.factory, '旧化工厂',     'dungeon',    { icon: '🏭', x: 9, y: 1, tags: ['main', 'dungeon'] });
scene(WL.mountain,'群山隘口',     'wilderness', { icon: '⛰', x: 8, y: 0, tags: ['main'] });
scene(WL.bunker,  '混凝土堡',     'dungeon',    { icon: '🏛', x: 9, y: 0, tags: ['main', 'dungeon'] });
scene(WL.crash,   '坠机现场',     'vignette',   { icon: '✈', x: 10, y: 1, tags: ['hidden'] });
scene(WL.field,   '辐射田',       'wilderness', { icon: '☢', x: 9, y: 2, tags: ['radiation'] });

connect(CITY.tower, WL.road1, '出城西行');
connect(WL.road1, WL.road2, '继续北行');
connect(WL.road1, WL.cave, '钻入岩缝');
connect(WL.road2, WL.oasis, '走进绿洲');
connect(WL.road2, WL.bridge, '穿过塌桥');
connect(WL.bridge, WL.factory, '走进化工厂');
connect(WL.factory, WL.field, '走入辐射田', { gated: { hint: '没有防护衣进去太危险', requireVariables: { has_rad_suit: true } } });
connect(WL.road2, WL.mountain, '上山');
connect(WL.mountain, WL.bunker, '深入混凝土堡');
connect(WL.factory, WL.crash, '听到求救信号绕过去', { discovered: false });

// — 终章避难所控制中心（约 8 节点）
const ENDGAME = {
  facade:   'scene_control_facade',
  lobby:    'scene_control_lobby',
  security: 'scene_control_security',
  archive:  'scene_control_archive',
  reactor:  'scene_control_reactor',
  lab:      'scene_control_lab',
  upper:    'scene_control_upper',
  core:     'scene_control_core',
};
scene(ENDGAME.facade,   '控制中心外墙', 'wilderness', { icon: '🏛', x: 11, y: 0, tags: ['main', 'endgame'] });
scene(ENDGAME.lobby,    '控制中心大厅', 'dungeon',    { icon: '🏛', x: 12, y: 0, tags: ['main', 'endgame'] });
scene(ENDGAME.security, '保安室',       'combat',     { icon: '🔒', x: 12, y: -1, tags: ['endgame'] });
scene(ENDGAME.archive,  '档案库',       'vignette',   { icon: '📦', x: 12, y: 1, tags: ['endgame'] });
scene(ENDGAME.reactor,  '反应堆',       'combat',     { icon: '☢', x: 13, y: 0, tags: ['endgame', 'main'] });
scene(ENDGAME.lab,      '生物实验室',   'dungeon',    { icon: '🧪', x: 13, y: -1, tags: ['endgame', 'main'] });
scene(ENDGAME.upper,    '上层走廊',     'dungeon',    { icon: '🛗', x: 14, y: 0, tags: ['endgame', 'main'] });
scene(ENDGAME.core,     '核心控制台',   'combat',     { icon: '🎛', x: 15, y: 0, tags: ['endgame', 'main', 'boss_room'],
  description: '巨大的反应堆主控制台静静运转。变种领主莱昂——你曾经的弟弟——正站在控制台前，全身扭曲变异。一旦你按下开战，就没有回头路。' });

connect(WL.bunker, ENDGAME.facade, '深入控制中心区域',
  { gated: { hint: '需要避难所门禁卡', requireItems: ['item_vault_key'] } });
connect(ENDGAME.facade, ENDGAME.lobby, '推开大门');
connect(ENDGAME.lobby, ENDGAME.security, '走入保安室');
connect(ENDGAME.lobby, ENDGAME.archive, '查看档案');
connect(ENDGAME.lobby, ENDGAME.reactor, '走向反应堆');
connect(ENDGAME.reactor, ENDGAME.lab, '穿过实验室');
connect(ENDGAME.lab, ENDGAME.upper, '上到上层');
connect(ENDGAME.upper, ENDGAME.core, '推开核心控制室门');

// — Ending 场景
scene('scene_ending_save_brother', '黎明前的拥抱', 'ending', { icon: '🤝', x: 17, y: 0, tags: ['ending', 'main'],
  description: '你救下了弟弟——或他剩下的部分。两兄弟在反应堆冷却的余晖里相拥。世界仍然破碎，但有了希望。' });
scene('scene_ending_end_him',      '终结突变',     'ending', { icon: '☠', x: 17, y: 1, tags: ['ending', 'main'],
  description: '你扣下了扳机。最后一发子弹，给你深爱的人。你转身走出反应堆，没有回头。' });
scene('scene_ending_become',       '同归',         'ending', { icon: '☢', x: 17, y: -1, tags: ['ending', 'main'],
  description: '反应堆熔融，你与弟弟一同消逝。废土上多了一道无人知晓的伤痕。' });

connect(ENDGAME.core, 'scene_ending_save_brother', '试图救他', { oneWay: true,
  gated: { requireVariables: { has_cure: true } } });
connect(ENDGAME.core, 'scene_ending_end_him', '扣下扳机', { oneWay: true });
connect(ENDGAME.core, 'scene_ending_become', '与他同归', { oneWay: true,
  gated: { requireVariables: { saved_companion: true, has_brother_memory: true } } });

// ============================================================
// 6. NPC
// ============================================================
npc('npc_doctor_eva', '艾娃医生', { icon: '⚕', personality: 'tired_compassionate',
  spawnScene: HUB.clinic, tags: ['medic', 'hub'],
  giftPreferences: { 'tag:rare': 'love', 'item_pure_water': 'love' } });
npc('npc_bartender',  '老板·西门', { icon: '🍷', personality: 'cynical_listener',
  spawnScene: HUB.bar, tags: ['hub', 'cybernetic'] });
npc('npc_trader',     '商人·黎',   { icon: '🏬', personality: 'shrewd', spawnScene: HUB.market, tags: ['hub'] });
npc('npc_mira',       '米拉',     { icon: '🎯', personality: 'wary_loyal', recruitable: true,
  spawnScene: WL.oasis, tags: ['companion', 'sniper'],
  stats: { hp: 95, mp: 25, attack: 16, defense: 7, magicAttack: 5, magicDefense: 7, speed: 14, luck: 7 },
  abilities: [
    { id: 'mira_snipe', name: '精准爆头', type: 'active', cost: { mp: 6 }, effect: { damage: { formula: 'attack+2d6+5' } } },
    { id: 'mira_supress', name: '压制射击', type: 'active', cost: { mp: 4 },
      effect: { damage: { formula: 'attack+d6' }, applyStatus: { type: 'debuff', stat: 'attack', value: 4, duration: 2 } } },
  ],
  giftPreferences: { 'item_smg': 'love', 'tag:military': 'like' } });
npc('npc_marcus',     '马库斯', { icon: '🤖', personality: 'stoic_kind', recruitable: true,
  spawnScene: CITY.tower, tags: ['companion', 'augmented'],
  stats: { hp: 140, mp: 15, attack: 17, defense: 13, magicAttack: 3, magicDefense: 10, speed: 8, luck: 4 },
  abilities: [
    { id: 'mc_shield', name: '机能屏障', type: 'active', cost: { mp: 5 }, effect: { applyStatus: { type: 'buff', stat: 'defense', value: 8, duration: 3 }, target: 'self' } },
    { id: 'mc_overcharge', name: '过载',  type: 'active', cost: { mp: 8 }, cooldown: 3, effect: { damage: { formula: 'attack+2d8' } } },
  ] });
npc('npc_doc_pol',    '波尔教授', { icon: '🧪', personality: 'fanatic_scientist',
  spawnScene: ENDGAME.lab, tags: ['scientist'] });
npc('npc_old_woman',  '绿洲老妇人', { icon: '👵', spawnScene: WL.oasis, tags: ['rest', 'mysterious'],
  giftPreferences: { 'item_pure_water': 'love' } });
npc('npc_radio_voice','无线电的声音', { icon: '📻', spawnScene: 'scene_raider_camp_ruin', tags: ['quest_giver'] });
npc('npc_ghoul_hermit','尸鬼隐士', { icon: '☢', spawnScene: WL.cave, tags: ['ghoul'] });
npc('npc_raider_lord','掠夺者王',  { icon: '🗡', spawnScene: CITY.apartment, tags: ['antagonist'] });
npc('npc_brother',    '马太（弟弟）', { icon: '👤', spawnScene: ENDGAME.core, tags: ['main', 'family'] });
npc('npc_caravaneer', '商队车把式', { icon: '🚚', spawnScene: WL.road2, tags: ['hub'] });

npcRel('npc_doctor_eva', 'npc_bartender',   0.5, '老朋友');
npcRel('npc_marcus',     'npc_mira',        0.4, '战场同袍');
npcRel('npc_radio_voice','npc_brother',     0.9, '同一个人？');
npcRel('npc_doc_pol',    'npc_brother',    -0.7, '把他变成这样的人');
npcRel('npc_raider_lord','npc_doctor_eva', -0.5, '抢过她的物资');

// ============================================================
// 7. 事件
// ============================================================
event('ev_intro_vault', '门关上的瞬间', {
  inScene: ['scene_vault_door'], tags: ['main', 'intro'], priority: 100,
  description: '避难所大门最终合上。你回头看了一眼，但门后已无人挥手。无线电里再次传来弟弟的声音："...坐标 13.8 东...救命..."',
  choices: [{ text: '抬头看天，向南出发', outcomes: [{ text: '你深吸一口可呼吸过滤的空气。',
    effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }, { type: 'add_item', itemId: 'item_radio' }] }] }],
});
event('ev_intro_raider', '篝火残灰', {
  inScene: ['scene_raider_camp_ruin'], tags: ['main', 'intro'], priority: 100,
  description: '你的旧伙伴们都死了。最后一台收音机里传来你弟弟的声音——他还活着。',
  choices: [{ text: '收拾武器出发', outcomes: [{ text: '你最后看了一眼篝火。',
    effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }, { type: 'add_item', itemId: 'item_radio' }] }] }],
});
event('ev_intro_drifter', '山下的火光', {
  inScene: ['scene_wanderers_hill'], tags: ['main', 'intro'], priority: 100,
  description: '你看见废墟城市深处亮起一束橙色火光——和弟弟说的一模一样。',
  choices: [{ text: '下山去找', outcomes: [{ text: '你拄着步枪走下山坡。',
    effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }, { type: 'add_item', itemId: 'item_radio' }] }] }],
});

event('ev_eva_lead', '艾娃医生的线索', {
  inScene: [HUB.clinic], tags: ['main'], priority: 90,
  requireVariables: { quest_accepted: true },
  description: '艾娃听完你的故事后皱眉："你弟弟的频率？那是控制中心的——他们最近在做实验。"',
  choices: [
    { text: '我要找他', outcomes: [{ text: '"先帮我个忙，"她说，"地铁里有人受困。"',
      effects: [{ type: 'set_variable', name: 'seek_brother', value: true }] }] },
  ],
});

event('ev_metro_rescue', '地铁隧道的呼救', {
  inScene: [CITY.metro2], tags: ['main'], priority: 85,
  requireVariables: { seek_brother: true },
  description: '隧道深处有人压在残骸下。是个改造人——他能动眼睛但腿断了。',
  choices: [
    { text: '帮他出来', outcomes: [{ text: '你撬开钢梁。改造人喘息着报上自己的名字：马库斯。',
      effects: [
        { type: 'set_variable', name: 'saved_marcus', value: true },
        { type: 'recruit_companion', npcId: 'npc_marcus' },
        { type: 'set_worldFlag', name: 'metro_cleared', value: true },
      ] }] },
    { text: '太危险了，先走', outcomes: [{ text: '你转身。他没有责备的眼神——只有平静的失望。',
      effects: [{ type: 'set_variable', name: 'left_marcus', value: true }] }] },
  ],
});

event('ev_oasis_meet', '绿洲的米拉', {
  inScene: [WL.oasis], tags: ['main'], priority: 80,
  requireVariables: { quest_accepted: true },
  description: '米拉用狙击枪准星对准你的额头。"说出你的名字和来意。否则我开枪。"',
  choices: [
    { text: '我也在找控制中心', outcomes: [{ text: '她放下枪："那或许我们能合作。"',
      effects: [
        { type: 'set_variable', name: 'mira_agreed', value: true },
        { type: 'recruit_companion', npcId: 'npc_mira' },
      ] }] },
    { text: '我只是路过', outcomes: [{ text: '"那就快走。"她重新举起枪。', effects: [] }] },
  ],
});

event('ev_lab_truth', '生物实验室的真相', {
  inScene: [ENDGAME.lab], tags: ['main'], priority: 90,
  description: '波尔教授在浮空显示屏前。"你弟弟？他自愿的——基因混编可能让人类对辐射免疫。但代价是......"',
  choices: [
    { text: '有没有解药？', outcomes: [{ text: '他点头："冷冻舱里那瓶蓝色。"',
      effects: [{ type: 'set_variable', name: 'has_cure', value: true }, { type: 'set_worldFlag', name: 'cure_obtained', value: true }] }] },
    { text: '我会毁掉这里', outcomes: [{ text: '波尔后退一步："你不明白...这是人类未来。"', effects: [] }] },
  ],
});

event('ev_security_reactor', '反应堆守卫', {
  inScene: [ENDGAME.reactor], tags: ['main', 'boss'], priority: 100,
  description: '哨兵机识别你的身份——立即开火。',
  choices: [
    { text: '战斗', outcomes: [{ text: '能量爆裂。', effects: [{ type: 'start_combat', enemyIds: ['enemy_robot_sentry', 'enemy_robot_sentry'] }] }] },
  ],
});

event('ev_core_final', '与莱昂的最后对峙', {
  inScene: [ENDGAME.core], tags: ['main', 'boss', 'epilogue'], priority: 100,
  description: '弟弟（或他剩下的部分）转过身。一半的脸还能让你认出。"你...真的来了？" 然后他的喉咙发出咕噜声——开始失控。',
  choices: [
    { text: '试着用解药', outcomes: [{ text: '"快——给我！" 他几乎在哭。',
      effects: [{ type: 'set_variable', name: 'tried_cure', value: true }, { type: 'start_combat', enemyIds: ['enemy_mutant_lord'] }] }],
    },
    { text: '我无法救你——动手吧', outcomes: [{ text: '他闭眼，似乎松了口气：" "',
      effects: [{ type: 'start_combat', enemyIds: ['enemy_mutant_lord'] }] }],
    },
  ],
});

event('ev_ending', '终章', {
  inScene: ['scene_ending_save_brother', 'scene_ending_end_him', 'scene_ending_become'],
  tags: ['main', 'epilogue', 'ending'], priority: 100,
  description: '故事到达了它的尽头。',
  choices: [{ text: '让命运成为定数', outcomes: [{ text: '残留的人继续走下去。',
    effects: [{ type: 'set_variable', name: 'game_complete', value: true }] }] }],
});

// — 旅馆休息事件
event('ev_rest_bar', '霓虹酒馆 — 过夜', {
  inScene: [HUB.bar], tags: ['side', 'rest'], priority: 80, repeatable: true,
  description: '老板西门擦着杯子："住一晚？10 个瓶盖。"',
  choices: [
    { text: '住下（回满 HP/MP）', outcomes: [{
      text: '一夜无梦。',
      effects: [{ type: 'heal', target: 'all', value: 999 }, { type: 'advance_time', value: 8 }] }] },
    { text: '不了。', outcomes: [{ text: '他耸肩。', effects: [] }] },
  ],
});

event('ev_rest_oasis', '绿洲老妇人的茅屋', {
  inScene: [WL.oasis], tags: ['side', 'rest'], priority: 70, repeatable: true,
  description: '老妇人煮着粥。"想坐一会儿？"',
  choices: [
    { text: '坐下休息', outcomes: [{
      text: '炉火映在她皱纹里。',
      effects: [{ type: 'heal', target: 'all', value: 999 }, { type: 'advance_time', value: 6 }] }] },
    { text: '我得走', outcomes: [{ text: '她点点头。', effects: [] }] },
  ],
});

// — 小事件（约 25-30 个）
smallEvent(HUB.market, '黑市闲谈', '"听说控制中心在做奇怪实验。"', { tags: ['gossip'] });
smallEvent(HUB.clinic, '诊所阴影', '一个改造人正在更换液压关节。', { tags: ['vignette'] });
smallEvent(HUB.bar,    '酒馆传闻', '醉汉嘟囔着"变种领主"的名字。', { tags: ['hint'] });
smallEvent(HUB.gas,    '空油罐',   '加油站只剩几个生锈的油桶。',
  { choices: [{ text: '搜索', outcomes: [{ text: '你找到一些金属。',
    effects: [{ type: 'add_item', itemId: 'item_scrap_metal' }] }] }] });
smallEvent(HUB.rooftop, '屋顶风',  '风把残破的旗帜吹得猎猎作响。', { tags: ['vignette'] });
smallEvent(CITY.station, '广播残音', '"...3 号站台请注意..."', { tags: ['hint'] });
smallEvent(CITY.metro1, '隧道脚步', '远处传来轻微的拖拽声。', {
  choices: [{ text: '小心前进', outcomes: [{ text: '辐光蟑螂出现！',
    effects: [{ type: 'start_combat', enemyIds: ['enemy_radroach', 'enemy_radroach', 'enemy_radroach'] }] }] }],
});
smallEvent(CITY.store, '药店货架', '一堆翻倒的货架。',
  { choices: [{ text: '搜索', outcomes: [{ text: '找到一些药品。',
    effects: [{ type: 'add_item', itemId: 'item_stimpak' }] }] }] });
smallEvent(CITY.library, '焦黑书页', '一本被烧的书残留半页"基因混编技术..."', { tags: ['arcane', 'hint'],
  choices: [{ text: '记下', outcomes: [{ text: '你折好书页。',
    effects: [{ type: 'set_worldFlag', name: 'know_genemix', value: true }] }] }] });
smallEvent(CITY.alley, '阴影伏击', '阴影里走出几个掠夺者。',
  { choices: [{ text: '应战', outcomes: [{ text: '战斗',
    effects: [{ type: 'start_combat', enemyIds: ['enemy_raider', 'enemy_raider'] }] }] }] });
smallEvent(CITY.apartment, '掠夺者王', '废弃公寓顶层，掠夺者王坐在那里。', { tags: ['boss'],
  choices: [{ text: '挑战', outcomes: [{ text: '战斗',
    effects: [{ type: 'start_combat', enemyIds: ['enemy_raider_chief', 'enemy_raider'] }] }] }] });
smallEvent(CITY.highway, '塌方', '高架桥已经裂了。', { tags: ['vignette'] });
smallEvent(CITY.tower, '广播塔', '塔下散落着工具。',
  { choices: [{ text: '检查', outcomes: [{ text: '你拿到电路板。',
    effects: [{ type: 'add_item', itemId: 'item_circuit' }] }] }] });
smallEvent(WL.road1, '尘暴', '远处看到尘暴在移动。', { tags: ['weather'] });
smallEvent(WL.road2, '废车', '路边一辆翻倒的卡车。', {
  choices: [{ text: '搜', outcomes: [{ text: '你找到罐头和水。',
    effects: [{ type: 'add_item', itemId: 'item_can_food' }, { type: 'add_item', itemId: 'item_water' }] }] }],
});
smallEvent(WL.cave, '洞内残骸', '尸鬼隐士盘坐着。', { tags: ['npc'] });
smallEvent(WL.bridge, '塌桥渡口', '桥下流水浑浊。', { tags: ['vignette'] });
smallEvent(WL.factory, '化工废液', '空气里有刺鼻气味。',
  { choices: [
    { text: '快通过', outcomes: [{ text: '勉强避开。', effects: [] }] },
    { text: '搜索', outcomes: [{ text: '你受到辐射污染。',
      effects: [{ type: 'damage', target: 'all', value: 10 }] }] },
  ] });
smallEvent(WL.field, '辐射田·震源', '辐光从地下渗出。', { tags: ['radiation'] });
smallEvent(WL.bunker, '混凝土堡', '废弃的军事掩体。',
  { choices: [{ text: '搜', outcomes: [{ text: '找到一张地图。',
    effects: [{ type: 'add_item', itemId: 'item_old_map' }] }] }] });
smallEvent(WL.crash, '坠机残骸', '机舱里发现一张门禁卡。',
  { choices: [{ text: '收起', outcomes: [{ text: '关键证物。',
    effects: [{ type: 'add_item', itemId: 'item_vault_key' }] }] }] });
smallEvent(WL.mountain, '山口风口', '风穿过狭窄的山口。', { tags: ['vignette'] });
smallEvent(ENDGAME.security, '保安系统', '门口的保安机已经损坏。',
  { choices: [{ text: '继续前进', outcomes: [{ text: '保安机突然启动！',
    effects: [{ type: 'start_combat', enemyIds: ['enemy_robot_sentry'] }] }] }] });
smallEvent(ENDGAME.archive, '档案库', '尘封的资料堆。',
  { choices: [{ text: '查阅关于弟弟的记录', outcomes: [{ text: '你看到了他实验前的照片。',
    effects: [{ type: 'set_variable', name: 'has_brother_memory', value: true }] }] }] });

// — 重复战斗（野外随机）
function repeatableCombat(sceneId, name, enemyIds, priority = 25) {
  const id = `ev_combat_${sceneId}_${enemyIds[0]}`;
  event(id, name, {
    inScene: [sceneId], tags: ['combat', 'random'], priority,
    repeatable: true, probability: 0.15,
    description: `${name}冲了出来。`,
    choices: [{ text: '应战', outcomes: [{ text: '战斗。',
      effects: [{ type: 'start_combat', enemyIds }] }] }],
  });
}
repeatableCombat(CITY.alley, '掠夺者小队', ['enemy_raider', 'enemy_raider']);
repeatableCombat(CITY.metro1, '巨鼠群', ['enemy_mole_rat', 'enemy_mole_rat']);
repeatableCombat(WL.road1, '尸鬼游荡群', ['enemy_ghoul_wild', 'enemy_ghoul_wild']);
repeatableCombat(WL.field, '辐光尸鬼', ['enemy_ghoul_glowing']);
repeatableCombat(WL.factory, '超级变种人', ['enemy_super_mutant']);
repeatableCombat(WL.bunker, '死亡爪', ['enemy_deathclaw']);

// 起始场景
preset.startingSceneId = 'scene_wanderers_hill';

// ============================================================
// 写盘
// ============================================================
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(preset, null, 2), 'utf-8');

console.log(`\n=== 末日生存预设生成完成 ===`);
console.log(`  路径: ${OUT_PATH}`);
console.log(`  📍 场景: ${preset.scenes.length}`);
console.log(`  📜 事件: ${preset.events.length}`);
console.log(`  🧑 NPC: ${preset.npcs.length} (含 ${preset.npcs.filter(n => n.recruitable).length} 可招募)`);
console.log(`  🤝 关系: ${preset.npcRelations.length}`);
console.log(`  ⚔ 敌人: ${preset.enemies.length}`);
console.log(`  🎒 物品: ${preset.items.length}`);
console.log(`  🌅 结局: ${preset.scenes.filter(s => s.type === 'ending').length}`);
console.log(`  💾 文件大小: ${(fs.statSync(OUT_PATH).size / 1024).toFixed(1)} KB`);

if (process.argv.includes('--validate')) {
  await runMcpValidate();
}

async function runMcpValidate() {
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
    const send = (method, params) => new Promise((res, rej) => {
      const id = nextId++; pending.set(id, { resolve: res, reject: rej });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(`timeout ${method}`)); } }, 30000);
    });
    const call = async (tool, args = {}) => {
      const r = await send('tools/call', { name: tool, arguments: args });
      return r.result?.content?.[0]?.text || '';
    };
    (async () => {
      try {
        await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gen', version: '1' } });
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        await call('preset_load');
        console.log('\n--- preset_validate ---'); console.log(await call('preset_validate'));
        console.log('\n--- preset_scale_check ---'); console.log(await call('preset_scale_check'));
      } catch (e) { console.error('MCP 出错:', e.message); }
      finally { proc.stdin.end(); proc.kill(); resolve(); }
    })();
  });
}
