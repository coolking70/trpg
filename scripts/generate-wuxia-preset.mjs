#!/usr/bin/env node
/**
 * 武侠题材预设生成器
 *
 * 主题：「青锋录」— 江湖少年寻师踪、夺武林秘籍的故事
 * 演示：内功 buff 持续效果（status）、群攻（AOE）、宗师阶段战（phases）
 *
 * 用法: node scripts/generate-wuxia-preset.mjs [--validate]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'presets', 'qingfeng-wuxia.json');
const MCP_SERVER = path.join(ROOT, 'mcp-server', 'preset-server.mjs');

const preset = {
  version: '1.0.0',
  presetId: 'qingfeng_wuxia',
  name: '青锋录',
  author: 'D2 生成',
  createdAt: new Date().toISOString(),
  description: '江湖少年寻师踪、夺秘籍的武侠群像。三大门派之争，一场血雨腥风。',
  lore: {
    worldName: '中州武林',
    era: '永和三十年',
    background: '少林、武当、华山三大门派分治中原武林二十余载。三个月前，掌门师父被刺，唯一线索是一柄断剑——剑身刻着"青锋"二字。你怀揣师父遗物，踏上寻凶之路。',
    rules: '内功修为决定一切。每日修炼可提升经脉，但贸然挑战上乘高手只有死路一条。',
    gmStyle: '古典文言中夹白话，景物用极简笔触，情感重含蓄克制。',
  },
  characters: [], enemies: [], items: [], events: [], scenes: [],
  npcs: [], npcRelations: [], startingOptions: null, startingSceneRules: [],
  combatMode: 'party',
  aiHooks: { sceneArrival: 'optional', eventResolve: 'optional', npcDialogue: 'optional', vignette: 'never', worldRipple: 'optional' },
  startingSceneId: null, displayMode: 'scene-graph',
  rules: { diceType: 'd20', combatFormula: '(attack + dice) - defense', maxPartySize: 4, startingGold: 50 },
  aiConfig: { temperature: 0.7, maxResponseTokens: 1000, useStructuredOutput: true, language: 'zh-CN' },
};

// ============================================================
// Helpers（同末日版精简）
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
    connections: [], events: opts.events || [], vignettes: opts.vignettes || [], tags: opts.tags || [],
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
    outcomes: (c.outcomes || []).map(o => ({ probability: o.probability ?? 1.0, text: o.text, effects: o.effects || [] })),
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
function npcRel(from, to, strength, note = '') {
  preset.npcRelations.push({ from, to, strength, note });
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
// 1. 角色创建（武侠特色：门派 / 出身 / 资质）
// ============================================================
preset.startingOptions = {
  races: [
    { id: 'shaolin', name: '少林俗家弟子', icon: '🪷', tags: ['sect:shaolin'], statBonus: { defense: 3, magicDefense: 3 }, description: '禅武双修，专精金钟罩。' },
    { id: 'wudang', name: '武当门徒',     icon: '☯', tags: ['sect:wudang'],  statBonus: { magicAttack: 3, magicDefense: 2 }, description: '太极内劲，以柔克刚。' },
    { id: 'huashan', name: '华山剑客',    icon: '🗡', tags: ['sect:huashan'], statBonus: { attack: 3, speed: 2 }, description: '剑走偏锋，攻势凌厉。' },
    { id: 'lone',   name: '独行散修',     icon: '🍃', tags: ['sect:none'], statBonus: { luck: 3 }, description: '无门无派，自行其道。' },
  ],
  origins: [
    { id: 'noble',    name: '世家子弟', icon: '🏯', tags: ['origin:noble', 'literate', 'wealthy:start'], description: '出身豪门，识文断字。' },
    { id: 'orphan',   name: '孤儿', icon: '🥀', tags: ['origin:orphan', 'street_wise'], statBonus: { speed: 2 }, description: '从小流浪江湖。' },
    { id: 'farmer',   name: '寒门', icon: '🌾', tags: ['origin:farmer'], statBonus: { hp: 20 }, description: '体魄健壮，质朴直率。' },
  ],
  backgrounds: [
    { id: 'sword',  name: '剑术专精', icon: '⚔', tags: ['bg:sword'], statBonus: { attack: 3 } },
    { id: 'fist',   name: '内功深厚', icon: '✊', tags: ['bg:fist'],  statBonus: { magicAttack: 3, magicDefense: 2 } },
    { id: 'qing',   name: '轻功如风', icon: '🍃', tags: ['bg:qing'],  statBonus: { speed: 4 } },
    { id: 'doctor', name: '医术高超', icon: '⚕', tags: ['bg:doctor'], statBonus: { magicAttack: 2 } },
  ],
  faiths: [
    { id: 'rongyi', name: '光明磊落', icon: '☀', tags: ['faith:upright'], description: '行侠仗义，正气浩然。' },
    { id: 'fuchen', name: '隐忍图存', icon: '🌙', tags: ['faith:patient'], description: '韬光养晦，徐徐图之。' },
    { id: 'kuang',  name: '快意恩仇', icon: '🔥', tags: ['faith:wild'], description: '是非分明，恩怨必报。' },
  ],
};
preset.startingSceneRules = [
  { when: { tags: ['sect:shaolin'] }, sceneId: 'scene_shaolin_gate' },
  { when: { tags: ['sect:wudang'] }, sceneId: 'scene_wudang_peak' },
  { when: { tags: ['sect:huashan'] }, sceneId: 'scene_huashan_summit' },
  { default: 'scene_jianghu_inn' },
];

// ============================================================
// 2. 物品
// ============================================================
item('item_iron_sword',  '铁剑',     'weapon', { statModifiers: { attack: 5 }, buyPrice: 30 });
item('item_jade_sword',  '青锋剑',   'weapon', { statModifiers: { attack: 10, speed: 2 }, buyPrice: 300, tags: ['legendary'] });
item('item_taichi_blade','太极剑',   'weapon', { statModifiers: { attack: 8, magicAttack: 4 }, buyPrice: 250 });
item('item_long_staff',  '齐眉棒',   'weapon', { statModifiers: { attack: 6, defense: 2 }, buyPrice: 60 });

item('item_silk_robe',   '锦袍',     'armor',  { statModifiers: { defense: 3, magicDefense: 1 }, buyPrice: 50 });
item('item_iron_armor',  '银线甲',   'armor',  { statModifiers: { defense: 7 }, buyPrice: 200 });
item('item_jade_amulet', '玉佩',     'accessory', { statModifiers: { magicDefense: 4, luck: 1 } });

item('item_jin_pill',    '金创药',     'consumable', { consumeEffect: { type: 'heal', stat: 'hp', value: 40 }, buyPrice: 20 });
item('item_xilong_pill', '续龙丹',     'consumable', { consumeEffect: { type: 'heal', stat: 'hp', value: 80 }, buyPrice: 80 });
item('item_qi_pill',     '聚气丹',     'consumable', { consumeEffect: { type: 'heal', stat: 'mp', value: 30 }, buyPrice: 40 });
item('item_smoke_powder','迷烟散',     'consumable', { consumeEffect: { type: 'escape_combat', hpPenaltyPct: 0.05 }, buyPrice: 60, tags: ['utility'] });

item('item_wine',        '女儿红',     'consumable', { consumeEffect: { type: 'buff', stat: 'attack', value: 3, duration: 3 }, buyPrice: 10 });

item('item_skill_book_a','《九阳真经》残页', 'quest', { description: '少林失窃的秘籍残页。', tags: ['legendary'] });
item('item_skill_book_b','《太极心诀》',     'quest', { description: '武当祖师秘传。', tags: ['legendary'] });
item('item_skill_book_c','《独孤九剑》',     'quest', { description: '华山剑客失传剑诀。', tags: ['legendary'] });
item('item_broken_sword','断剑',           'quest', { description: '青锋断剑，师父遗物，剑身刻"青锋"。' });
item('item_token_inner', '内门令牌',         'quest', { description: '可进入门派内堂。' });

// ============================================================
// 3. 敌人
// ============================================================
enemy('enemy_bandit',         '山贼',         { stats: { hp: 40, attack: 11, defense: 4 }, exp: 10 });
enemy('enemy_bandit_chief',   '山贼头目',     { stats: { hp: 100, attack: 16, defense: 8 }, exp: 50, difficulty: 'hard' });
enemy('enemy_wolf',           '黑风山狼',     { stats: { hp: 32, attack: 9, defense: 3, speed: 13 }, exp: 8 });
enemy('enemy_swordsman',      '剑客',         { stats: { hp: 60, attack: 14, defense: 7 }, exp: 18,
  abilities: [{ id: 'sw_thrust', name: '刺击', type: 'active', effect: { damage: { formula: 'attack+d6+2' } } }] });
enemy('enemy_inner_disciple', '内门弟子',     { stats: { hp: 80, attack: 16, defense: 9, magicDefense: 8 }, exp: 30 });
enemy('enemy_shadow_killer',  '暗影杀手',     { stats: { hp: 70, attack: 18, defense: 6, speed: 16 }, exp: 35,
  abilities: [{ id: 'sk_backstab', name: '背刺', type: 'active', effect: { damage: { formula: 'attack+2d8+3' } } }] });
enemy('enemy_qigong_master',  '气功宗师',     { stats: { hp: 140, attack: 20, defense: 12, magicAttack: 18, magicDefense: 14 }, exp: 80, difficulty: 'hard',
  abilities: [{ id: 'qm_palm', name: '气功掌', type: 'active', cost: { mp: 5 },
    effect: { damage: { formula: 'magicAttack+2d6' }, aoe: true, target: 'all_enemies' } }] });
enemy('enemy_demon_blade',    '魔教刀客',     { stats: { hp: 90, attack: 18, defense: 8 }, exp: 40,
  abilities: [{ id: 'db_slash', name: '血祭斩', type: 'active',
    effect: { damage: { formula: 'attack+d10+4' }, applyStatus: { type: 'dot', stat: 'hp', value: 4, duration: 3 } } }] });

// 终极 boss：邪教教主（用 phases）
enemy('enemy_cult_lord',      '邪教教主·凌霜', { stats: { hp: 280, attack: 24, defense: 16, magicAttack: 24, magicDefense: 14, speed: 13 },
  exp: 350, difficulty: 'boss', tags: ['boss', 'final'],
  abilities: [
    { id: 'cl_qi_sword', name: '剑气', type: 'active', effect: { damage: { formula: 'attack+d10+5' } } },
  ],
  phases: [
    { id: 'inner_unsealed', hpThreshold: 0.66, statBoosts: { attack: 4, magicAttack: 4 },
      narrative: '⚡ 凌霜运起紫色内息——他在解封更深的内功！',
      abilities: [{ id: 'cl_qi_storm', name: '剑气狂风', type: 'active',
        effect: { damage: { formula: '2d8+10' }, aoe: true, target: 'all_enemies' } }] },
    { id: 'death_strike', hpThreshold: 0.33, statBoosts: { speed: 6, attack: 6 },
      narrative: '🔥 凌霜浑身血红，眼中已无人性——他要拼命了。',
      abilities: [{ id: 'cl_qi_blood', name: '血祭剑诀', type: 'active',
        effect: { damage: { formula: '3d8+12' }, aoe: true, target: 'all_enemies',
                  applyStatus: { type: 'dot', stat: 'hp', value: 5, duration: 3 } } }] },
  ],
});

// ============================================================
// 4. 主角
// ============================================================
character('char_protagonist', '主角', {
  title: '寻师者',
  description: '师父刚死，你是他唯一的弟子。',
  stats: { hp: 130, mp: 40, attack: 14, defense: 9, magicAttack: 8, magicDefense: 9, speed: 12, luck: 6 },
  abilities: [
    { id: 'pg_strike',  name: '基础剑法', type: 'active', cost: { mp: 3 }, effect: { damage: { formula: 'attack+d6+2' } } },
    { id: 'pg_inner',   name: '运功',     type: 'active', cost: { mp: 5 }, cooldown: 2,
      effect: { applyStatus: { type: 'buff', stat: 'attack', value: 5, duration: 3 }, target: 'self' } },
    { id: 'pg_heal',    name: '吐纳调息', type: 'active', cost: { mp: 8 }, cooldown: 3, effect: { heal: { formula: '30' } } },
  ],
  inventory: ['item_iron_sword', 'item_jin_pill', 'item_jin_pill', 'item_broken_sword'],
  equipment: { weapon: 'item_iron_sword', armor: 'item_silk_robe', accessory: null },
});

// ============================================================
// 5. 场景（约 40-45 个）
// ============================================================
// — 起始 spawn
scene('scene_shaolin_gate',  '少林山门',     'spawn', { icon: '🪷', x: -8, y: 0, tags: ['safe', 'main', 'sect'],
  description: '万年古寺。晨钟在山雾中回响。师父的遗体停在罗汉堂。' });
scene('scene_wudang_peak',   '武当真武峰',   'spawn', { icon: '☯', x: -8, y: 2, tags: ['safe', 'main', 'sect'],
  description: '雾峰之巅。师父曾在此教你"以柔克刚"。' });
scene('scene_huashan_summit','华山论剑顶',   'spawn', { icon: '🗡', x: -8, y: 4, tags: ['safe', 'main', 'sect'],
  description: '剑石峰顶。风很大，云在脚下。' });
scene('scene_jianghu_inn',   '江湖客栈',     'spawn', { icon: '🍶', x: -8, y: 6, tags: ['safe', 'main', 'inn'],
  description: '你独自坐在角落，桌上摆着师父的断剑。' });

attachEvent('scene_shaolin_gate',  'ev_intro_shaolin');
attachEvent('scene_wudang_peak',   'ev_intro_wudang');
attachEvent('scene_huashan_summit', 'ev_intro_huashan');
attachEvent('scene_jianghu_inn',   'ev_intro_lone');

// — 中心 hub：江湖镇
const TOWN = {
  square: 'scene_jiangcheng_square',
  tavern: 'scene_jiangcheng_tavern',
  smithy: 'scene_jiangcheng_smithy',
  herbal: 'scene_jiangcheng_herbal',
  guild:  'scene_jiangcheng_guild',
  inn:    'scene_jiangcheng_inn',
};
scene(TOWN.square,  '江城广场',     'settlement', { icon: '🏘', x: 0, y: 1, tags: ['safe', 'main', 'hub'],
  description: '江城是中州武林的咽喉。茶楼酒馆里说着各家派的故事。' });
scene(TOWN.tavern,  '春风茶楼',     'settlement', { icon: '🍵', x: 1, y: 0, tags: ['safe'],
  description: '说书人正在讲三月前的"青锋断剑案"。' });
scene(TOWN.smithy,  '铁匠铺',       'settlement', { icon: '🔨', x: 1, y: 2, tags: ['safe', 'shop'] });
scene(TOWN.herbal,  '万药堂',       'settlement', { icon: '🌿', x: -1, y: 0, tags: ['safe', 'shop', 'medic'] });
scene(TOWN.guild,   '镖局',         'settlement', { icon: '📜', x: -1, y: 2, tags: ['safe', 'hub'] });
scene(TOWN.inn,     '客栈',         'inn',        { icon: '🛏', x: 0, y: 2, tags: ['safe', 'inn', 'rest_point'] });

connect('scene_shaolin_gate',  TOWN.square, '下山进城');
connect('scene_wudang_peak',   TOWN.square, '下武当');
connect('scene_huashan_summit', TOWN.square, '出华山');
connect('scene_jianghu_inn',   TOWN.square, '走出客栈');
connect(TOWN.square, TOWN.tavern, '走进茶楼');
connect(TOWN.square, TOWN.smithy, '走向铁铺');
connect(TOWN.square, TOWN.herbal, '走入药堂');
connect(TOWN.square, TOWN.guild,  '走向镖局');
connect(TOWN.square, TOWN.inn,    '住进客栈');

// — 中原野外
const COUNTRY = {
  road_n:  'scene_road_north',
  road_e:  'scene_road_east',
  forest:  'scene_dark_forest',
  ravine:  'scene_swallow_ravine',
  village: 'scene_qingxi_village',
  tomb:    'scene_old_tomb',
  river:   'scene_river_crossing',
  hut:     'scene_woodcutter_hut',
};
scene(COUNTRY.road_n,  '官道北段',   'wilderness', { icon: '🛤', x: 2, y: 1, tags: ['main'] });
scene(COUNTRY.road_e,  '官道东段',   'wilderness', { icon: '🛤', x: 0, y: 3, tags: ['main'] });
scene(COUNTRY.forest,  '幽暗松林',   'wilderness', { icon: '🌲', x: 3, y: 1, tags: ['forest'] });
scene(COUNTRY.ravine,  '燕子峡',     'wilderness', { icon: '🪨', x: 4, y: 1, tags: ['forest', 'main'] });
scene(COUNTRY.village, '青溪村',     'settlement', { icon: '🏘', x: 1, y: 3, tags: ['safe'] });
scene(COUNTRY.tomb,    '古墓',       'dungeon',    { icon: '⚰', x: 5, y: 1, tags: ['arcane', 'main'] });
scene(COUNTRY.river,   '渡口',       'wilderness', { icon: '🌊', x: -1, y: 3, tags: [] });
scene(COUNTRY.hut,     '樵夫木屋',   'settlement', { icon: '🛖', x: 4, y: 0, tags: ['npc', 'safe', 'rest_point'] });

connect(TOWN.square, COUNTRY.road_n, '北出江城');
connect(TOWN.square, COUNTRY.road_e, '东出江城');
connect(COUNTRY.road_n, COUNTRY.forest, '进入松林');
connect(COUNTRY.forest, COUNTRY.ravine, '深入峡谷');
connect(COUNTRY.forest, COUNTRY.hut,    '寻木屋');
connect(COUNTRY.ravine, COUNTRY.tomb,   '走入古墓');
connect(COUNTRY.road_e, COUNTRY.village, '到达青溪村');
connect(COUNTRY.road_e, COUNTRY.river,   '走到渡口');

// — 邪教总坛（终章区）
const CULT = {
  outer: 'scene_cult_outer',
  hall:  'scene_cult_hall',
  vault: 'scene_cult_vault',
  inner: 'scene_cult_inner',
  altar: 'scene_cult_altar',
};
scene(CULT.outer, '魔教外院', 'dungeon', { icon: '🏯', x: 6, y: 1, tags: ['main', 'dungeon'] });
scene(CULT.hall,  '议事大厅', 'dungeon', { icon: '🏯', x: 7, y: 1, tags: ['main', 'dungeon'] });
scene(CULT.vault, '秘籍秘库', 'vignette',{ icon: '📚', x: 7, y: 0, tags: ['main'] });
scene(CULT.inner, '禁地深处', 'dungeon', { icon: '⛩', x: 8, y: 1, tags: ['main', 'dungeon'] });
scene(CULT.altar, '血祭祭坛', 'combat',  { icon: '🩸', x: 9, y: 1, tags: ['main', 'boss_room'],
  description: '黑色巨大祭坛。邪教教主凌霜披紫色斗篷站在中央——他正是杀师父的真凶。一旦上阵，绝无和解可能。' });

connect(COUNTRY.tomb, CULT.outer, '深入魔教总坛',
  { gated: { hint: '需要内门令牌', requireItems: ['item_token_inner'] } });
connect(CULT.outer, CULT.hall,  '推开重门');
connect(CULT.hall, CULT.vault, '溜进秘库');
connect(CULT.hall, CULT.inner, '深入禁地');
connect(CULT.inner, CULT.altar, '走向祭坛');

// — Ending 场景
scene('scene_ending_revenge', '青锋归位', 'ending', { icon: '🗡', x: 11, y: 0, tags: ['ending', 'main'],
  description: '你用师父的断剑（接好的）斩下凌霜的头颅。江湖的风从此为你让路。' });
scene('scene_ending_mercy',   '佛门一念', 'ending', { icon: '🪷', x: 11, y: 1, tags: ['ending', 'main'],
  description: '你放下了仇恨。把凌霜交给少林处置。剑挂回腰间，从此不再出鞘。' });
scene('scene_ending_demon',   '入魔',     'ending', { icon: '☠', x: 11, y: 2, tags: ['ending', 'main'],
  description: '你吸收了凌霜的内力。然而《血祭剑诀》开始反噬——你成了下一个邪教教主。' });

connect(CULT.altar, 'scene_ending_revenge', '为师父报仇', { oneWay: true });
connect(CULT.altar, 'scene_ending_mercy',   '放过凌霜',   { oneWay: true,
  gated: { requireVariables: { mercy_pts: 3 } } });
connect(CULT.altar, 'scene_ending_demon',   '吸他内力',   { oneWay: true,
  gated: { requireVariables: { learn_blood_art: true } } });

// ============================================================
// 6. NPC
// ============================================================
npc('npc_master_yuan',  '元长老', { icon: '👴', personality: 'wise_patient',
  spawnScene: TOWN.tavern, tags: ['mentor', 'quest_giver'] });
npc('npc_blacksmith',   '铁老',   { icon: '🔨', personality: 'gruff', spawnScene: TOWN.smithy, tags: ['shop'],
  giftPreferences: { 'tag:legendary': 'love' } });
npc('npc_herbalist',    '柳姑娘', { icon: '🌿', personality: 'gentle', spawnScene: TOWN.herbal, tags: ['shop', 'medic'] });
npc('npc_innkeeper',    '客栈老板', { icon: '🍶', spawnScene: TOWN.inn, tags: ['hub'] });
npc('npc_woodcutter',   '老樵夫', { icon: '🪓', spawnScene: COUNTRY.hut, tags: ['quest'] });

npc('npc_xiao',         '萧若雪', { icon: '🗡', personality: 'fierce_sad', recruitable: true,
  spawnScene: COUNTRY.village, tags: ['companion', 'huashan'],
  stats: { hp: 110, mp: 35, attack: 17, defense: 7, magicAttack: 6, magicDefense: 8, speed: 16, luck: 6 },
  abilities: [
    { id: 'xs_sword', name: '九阴白骨爪', type: 'active', cost: { mp: 6 }, effect: { damage: { formula: 'attack+d10+3' } } },
    { id: 'xs_dance', name: '剑舞',       type: 'active', cost: { mp: 10 }, cooldown: 3,
      effect: { damage: { formula: 'attack+2d6' }, aoe: true, target: 'all_enemies' } },
  ] });
npc('npc_zhuang',       '庄无为', { icon: '☯', personality: 'serene', recruitable: true,
  spawnScene: COUNTRY.tomb, tags: ['companion', 'wudang'],
  stats: { hp: 130, mp: 50, attack: 13, defense: 11, magicAttack: 18, magicDefense: 16, speed: 10, luck: 5 },
  abilities: [
    { id: 'zw_taichi', name: '太极推手',   type: 'active', cost: { mp: 6 },
      effect: { damage: { formula: 'magicAttack+d6' }, applyStatus: { type: 'debuff', stat: 'attack', value: 4, duration: 2 } } },
    { id: 'zw_heal',   name: '生气功', type: 'active', cost: { mp: 8 }, cooldown: 2, effect: { heal: { formula: '40' } } },
  ] });

npc('npc_cult_lord',    '凌霜', { icon: '☠', personality: 'cold_obsessed',
  spawnScene: CULT.altar, tags: ['antagonist', 'main'] });
npc('npc_master_dead',  '师父（亡）', { icon: '👻', spawnScene: 'scene_jianghu_inn', tags: ['memory'] });
npc('npc_old_seer',     '渡口老者', { icon: '🎣', spawnScene: COUNTRY.river, tags: ['mysterious'] });
npc('npc_bandit_lord',  '黑风寨主', { icon: '🗡', spawnScene: COUNTRY.ravine, tags: ['antagonist'] });

npcRel('npc_xiao',     'npc_master_yuan', 0.6, '元长老曾救过她');
npcRel('npc_zhuang',   'npc_master_yuan', 0.7, '师叔');
npcRel('npc_cult_lord','npc_master_dead', -0.9, '杀师仇人');
npcRel('npc_xiao',     'npc_cult_lord',  -0.8, '杀父仇人');

// ============================================================
// 7. 主线事件
// ============================================================
event('ev_intro_shaolin', '罗汉堂的早课', {
  inScene: ['scene_shaolin_gate'], tags: ['main', 'intro'], priority: 100,
  description: '师父的遗体停在堂中。掌门方丈拿出一柄断剑，剑身刻"青锋"二字。"此剑非中原之物——你下山去查。"',
  choices: [{ text: '弟子谨遵掌门嘱托', outcomes: [{ text: '你下山，带上师父的断剑。',
    effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }, { type: 'add_item', itemId: 'item_broken_sword' }] }] }],
});
event('ev_intro_wudang', '真武峰前一拜', {
  inScene: ['scene_wudang_peak'], tags: ['main', 'intro'], priority: 100,
  description: '师父的牌位前，你看见一柄你从未见过的断剑。',
  choices: [{ text: '下山查清此事', outcomes: [{ text: '云雾在脚下散开。',
    effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }, { type: 'add_item', itemId: 'item_broken_sword' }] }] }],
});
event('ev_intro_huashan', '剑石峰风', {
  inScene: ['scene_huashan_summit'], tags: ['main', 'intro'], priority: 100,
  description: '师父最后给你的，是一柄断剑。剑身刻"青锋"——这是邪教的暗号。',
  choices: [{ text: '出华山查仇', outcomes: [{ text: '剑回腰间。',
    effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }, { type: 'add_item', itemId: 'item_broken_sword' }] }] }],
});
event('ev_intro_lone', '客栈一念', {
  inScene: ['scene_jianghu_inn'], tags: ['main', 'intro'], priority: 100,
  description: '酒入愁肠化为剑。你看着断剑上的"青锋"二字。',
  choices: [{ text: '查个明白', outcomes: [{ text: '你掏出最后几钱银子，起身。',
    effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }, { type: 'add_item', itemId: 'item_broken_sword' }] }] }],
});

event('ev_yuan_lead', '元长老的线索', {
  inScene: [TOWN.tavern], tags: ['main'], priority: 90,
  requireVariables: { quest_accepted: true },
  description: '元长老看着你的断剑："此剑出自西北燕子峡——一个叫凌霜的人，正是邪教的下任教主。"',
  choices: [
    { text: '我必杀他', outcomes: [{ text: '元长老叹气："先去拿青溪村萧家的剑——她和你目标一致。"',
      effects: [{ type: 'set_variable', name: 'know_lingshuang', value: true } ] }] },
  ],
});

event('ev_xiao_recruit', '萧若雪的恨', {
  inScene: [COUNTRY.village], tags: ['main'], priority: 85,
  requireVariables: { know_lingshuang: true },
  description: '青溪村萧家——她父亲也是死于凌霜剑下。她的剑已半年未出鞘。',
  choices: [
    { text: '我们一起去燕子峡', outcomes: [{ text: '她合剑入鞘："好。"',
      effects: [{ type: 'set_variable', name: 'xiao_joined', value: true }, { type: 'recruit_companion', npcId: 'npc_xiao' }] }] },
    { text: '我自己去', outcomes: [{ text: '她不语。', effects: [] }] },
  ],
});

event('ev_tomb_secret', '古墓秘籍', {
  inScene: [COUNTRY.tomb], tags: ['main'], priority: 80,
  description: '古墓深处，《独孤九剑》的卷轴静静躺着——还有一个打坐的武当道人。',
  choices: [
    { text: '收下卷轴，对道人行礼', outcomes: [{ text: '道人睁眼："你来了。我陪你去燕子峡。"',
      effects: [
        { type: 'set_variable', name: 'has_skill_book', value: true },
        { type: 'add_item', itemId: 'item_skill_book_c' },
        { type: 'recruit_companion', npcId: 'npc_zhuang' },
        { type: 'set_variable', name: 'zhuang_joined', value: true },
      ] }] },
    { text: '吸取剑诀血力', outcomes: [{ text: '一股黑色气流灌入你的内息——你的剑路变了。',
      effects: [{ type: 'set_variable', name: 'learn_blood_art', value: true }] }] },
  ],
});

event('ev_bandit_intercept', '燕子峡山贼', {
  inScene: [COUNTRY.ravine], tags: ['main', 'boss'], priority: 90,
  description: '黑风寨主拦在峡口："想过去？留命来！"',
  choices: [
    { text: '动手', outcomes: [{ text: '剑光霎然。',
      effects: [{ type: 'start_combat', enemyIds: ['enemy_bandit_chief', 'enemy_bandit', 'enemy_bandit'] }] }] },
  ],
});

event('ev_outer_breakthrough', '魔教外院突破', {
  inScene: [CULT.outer], tags: ['main'], priority: 85,
  description: '外院守卫看见你的剑，立时拔刀。',
  choices: [
    { text: '硬闯', outcomes: [{ text: '一阵厮杀。',
      effects: [{ type: 'start_combat', enemyIds: ['enemy_inner_disciple', 'enemy_inner_disciple', 'enemy_swordsman'] }] }] },
  ],
});

event('ev_vault_take', '秘库取籍', {
  inScene: [CULT.vault], tags: ['main'], priority: 80,
  description: '秘库里——少林《九阳真经》与武当《太极心诀》失窃版本都在！',
  choices: [
    { text: '收回秘籍', outcomes: [{ text: '物归原主。',
      effects: [
        { type: 'add_item', itemId: 'item_skill_book_a' },
        { type: 'add_item', itemId: 'item_skill_book_b' },
        { type: 'set_variable', name: 'mercy_pts', value: 3 },
      ] }] },
  ],
});

event('ev_inner_qigong_master', '禁地宗师', {
  inScene: [CULT.inner], tags: ['main', 'boss'], priority: 90,
  description: '一位白衣老者拦住你："凌霜不在。但我在。"他运起气功。',
  choices: [
    { text: '硬碰', outcomes: [{ text: '气劲对撞。',
      effects: [{ type: 'start_combat', enemyIds: ['enemy_qigong_master'] }] }] },
  ],
});

event('ev_final_lingshuang', '与凌霜的对决', {
  inScene: [CULT.altar], tags: ['main', 'boss', 'epilogue'], priority: 100,
  description: '凌霜转身。他比你想象中年轻——只不过 30 出头。"你师父最后那一刻，叫了你的名字。"',
  choices: [
    { text: '出剑', outcomes: [{ text: '剑光接剑光。',
      effects: [{ type: 'start_combat', enemyIds: ['enemy_cult_lord'] }] }] },
  ],
});

event('ev_ending', '终章', {
  inScene: ['scene_ending_revenge', 'scene_ending_mercy', 'scene_ending_demon'],
  tags: ['main', 'epilogue', 'ending'], priority: 100,
  description: '剑收回鞘。',
  choices: [{ text: '让命运成为定数', outcomes: [{ text: '故事至此。',
    effects: [{ type: 'set_variable', name: 'game_complete', value: true }] }] }],
});

// 客栈休息
event('ev_rest_inn', '客栈打尖', {
  inScene: [TOWN.inn], tags: ['side', 'rest'], priority: 80, repeatable: true,
  description: '老板招呼你："住一晚？5 钱银子。"',
  choices: [
    { text: '住一晚（回满）', outcomes: [{ text: '一夜好眠。',
      effects: [{ type: 'heal', target: 'all', value: 999 }, { type: 'advance_time', value: 8 }] }] },
    { text: '不了', outcomes: [{ text: '老板转身。', effects: [] }] },
  ],
});

event('ev_rest_hut', '樵夫木屋', {
  inScene: [COUNTRY.hut], tags: ['side', 'rest'], priority: 70, repeatable: true,
  description: '老樵夫煮着粥："坐一会儿吧。"',
  choices: [
    { text: '坐下休息', outcomes: [{ text: '炉火映在他白发上。',
      effects: [{ type: 'heal', target: 'all', value: 999 }, { type: 'advance_time', value: 6 }] }] },
    { text: '辞行', outcomes: [{ text: '他点头。', effects: [] }] },
  ],
});

// — 小事件
smallEvent(TOWN.square, '说书声', '茶楼说书人正讲"青锋断剑案"。', { tags: ['gossip'] });
smallEvent(TOWN.tavern, '茶香', '一壶毛尖刚泡好。', { tags: ['vignette'] });
smallEvent(TOWN.smithy, '锻铁声', '铁老在打一柄剑。', { tags: ['vignette'] });
smallEvent(TOWN.herbal, '草药味', '柳姑娘在称药。', { tags: ['npc'] });
smallEvent(TOWN.guild,  '镖局公告', '"护送商人去渡口，赏银 50 两。"', {
  choices: [{ text: '接下', outcomes: [{ text: '镖局头目点头。',
    effects: [{ type: 'set_variable', name: 'have_caravan_job', value: true }] }] }] });
smallEvent(COUNTRY.road_n, '路边野花', '春花满径。', { tags: ['vignette'] });
smallEvent(COUNTRY.forest, '林中暗影', '一个黑影掠过。', {
  choices: [{ text: '追', outcomes: [{ text: '影子消失了，但你在地上拾到玉佩。',
    effects: [{ type: 'add_item', itemId: 'item_jade_amulet' }] }] }] });
smallEvent(COUNTRY.ravine, '峡谷风', '峡谷里风很大。', { tags: ['vignette'] });
smallEvent(COUNTRY.village, '村口井', '村妇在井边洗衣。', { tags: ['vignette'] });
smallEvent(COUNTRY.tomb,    '碑文', '一块石碑刻着"独孤求败"四字。', { tags: ['hint'] });
smallEvent(COUNTRY.river,   '渡口老者', '老者在钓鱼。"年轻人，过河？"', { tags: ['npc'] });
smallEvent(COUNTRY.hut,     '柴垛', '柴薪堆得整齐。', { tags: ['vignette'] });
smallEvent(CULT.outer,      '魔教石碑', '"非教内人，杀无赦"', { tags: ['hint'] });
smallEvent(CULT.hall,       '议事厅遗物', '一堆刺杀计划。', {
  choices: [{ text: '查看', outcomes: [{ text: '你看到师父名字也在其中。',
    effects: [{ type: 'set_variable', name: 'know_assassinate_plan', value: true }] }] }] });
smallEvent(CULT.inner,      '禁地阴风', '寒气逼人。', { tags: ['arcane'] });

// — 随机战斗
function repeatableCombat(sceneId, name, enemyIds, priority = 25) {
  const id = `ev_combat_${sceneId}_${enemyIds[0]}`;
  event(id, name, {
    inScene: [sceneId], tags: ['combat', 'random'], priority,
    repeatable: true, probability: 0.15,
    description: `${name}冲了过来。`,
    choices: [{ text: '应战', outcomes: [{ text: '战斗。',
      effects: [{ type: 'start_combat', enemyIds }] }] }],
  });
}
repeatableCombat(COUNTRY.forest, '山中狼群', ['enemy_wolf', 'enemy_wolf']);
repeatableCombat(COUNTRY.ravine, '小股山贼', ['enemy_bandit', 'enemy_bandit']);
repeatableCombat(COUNTRY.tomb,   '古墓守卫', ['enemy_swordsman']);
repeatableCombat(CULT.outer,     '外院弟子', ['enemy_inner_disciple']);
repeatableCombat(CULT.inner,     '魔教刀客', ['enemy_demon_blade']);
repeatableCombat(COUNTRY.road_e, '马匪',     ['enemy_bandit', 'enemy_bandit', 'enemy_bandit']);

// 内门令牌通过 ev_inner_qigong_master 完成后获得
event('ev_inner_token', '宗师遗物', {
  inScene: [CULT.inner], tags: ['main'], priority: 85,
  requireCompletedEvents: ['ev_inner_qigong_master'],
  description: '宗师倒地，从他怀中掉出一枚内门令牌。',
  choices: [{ text: '收下', outcomes: [{ text: '令牌入怀。',
    effects: [{ type: 'add_item', itemId: 'item_token_inner' }] }] }],
});

preset.startingSceneId = 'scene_jianghu_inn';

// ============================================================
// 写盘
// ============================================================
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(preset, null, 2), 'utf-8');

console.log(`\n=== 武侠预设《青锋录》生成完成 ===`);
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
            pending.delete(msg.id); resolve(msg);
          }
        } catch { }
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
