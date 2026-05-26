/**
 * 内置默认预设 - 暗黑森林冒险
 * 包含4个角色、8个敌人、6个事件、12个道具和一张20x15地图
 */

export const DEFAULT_PRESET = {
  version: '1.0.0',
  presetId: 'preset_dark_forest',
  name: '暗黑森林冒险',
  author: '系统内置',
  createdAt: '2026-01-01T00:00:00Z',
  description: '在被诅咒的暗黑森林中探索、战斗并揭开古老遗迹的秘密。',

  lore: {
    worldName: '艾尔大陆',
    era: '黑暗纪元第三年',
    background: '艾尔大陆东部的暗黑森林曾是精灵的家园，三年前一场灾变将其化为被亡灵占据的禁地。传说森林深处的古老遗迹中藏着净化诅咒的圣物。冒险者公会派出了一支小队前往调查。',
    rules: '采用D20骰子系统，战斗为回合制，攻击判定为(攻击力+D20)-防御力=伤害',
    gmStyle: '叙述风格：氛围浓厚、略带紧张感，偶尔穿插幽默对话，注重环境描写和角色互动',
  },

  characters: [
    {
      id: 'char_001', type: 'character',
      name: '艾拉', title: '圣骑士',
      description: '来自圣光教团的女骑士，誓言净化暗黑森林的诅咒。',
      image: '',
      stats: { hp: 120, hpCurrent: 120, mp: 40, mpCurrent: 40, attack: 16, defense: 14, magicAttack: 8, magicDefense: 10, speed: 10, luck: 6 },
      abilities: [
        { id: 'ability_001', name: '圣光斩', description: '以圣光灌注武器进行强力一击', type: 'active', cost: { mp: 12 }, effect: { target: 'single_enemy', damage: { formula: 'attack * 1.8', type: 'physical' } }, cooldown: 0 },
        { id: 'ability_002', name: '治愈之光', description: '治疗单个队友', type: 'active', cost: { mp: 15 }, effect: { target: 'single_ally', heal: { formula: 'magicAttack * 2 + 10', type: 'magic' } }, cooldown: 0 },
      ],
      equipment: { weapon: 'item_001', armor: 'item_005', accessory: null },
      inventory: ['item_009'],
      position: { x: 3, y: 7 }, level: 3, experience: 120,
      statusEffects: [], tags: ['paladin', 'human', 'leader'], notes: '',
    },
    {
      id: 'char_002', type: 'character',
      name: '雷恩', title: '游侠',
      description: '精通弓术和野外生存的半精灵游侠。',
      image: '',
      stats: { hp: 80, hpCurrent: 80, mp: 30, mpCurrent: 30, attack: 14, defense: 8, magicAttack: 6, magicDefense: 8, speed: 16, luck: 8 },
      abilities: [
        { id: 'ability_003', name: '精准射击', description: '瞄准弱点进行精确打击', type: 'active', cost: { mp: 8 }, effect: { target: 'single_enemy', damage: { formula: 'attack * 2', type: 'physical' } }, cooldown: 1 },
        { id: 'ability_004', name: '陷阱设置', description: '在脚下设置陷阱', type: 'active', cost: { mp: 10 }, effect: { target: 'single_enemy', damage: { formula: 'attack * 1.2', type: 'physical' } }, cooldown: 2 },
      ],
      equipment: { weapon: 'item_002', armor: null, accessory: null },
      inventory: [],
      position: { x: 3, y: 7 }, level: 3, experience: 100,
      statusEffects: [], tags: ['ranger', 'half-elf'], notes: '',
    },
    {
      id: 'char_003', type: 'character',
      name: '薇拉', title: '元素法师',
      description: '精通火焰和冰霜魔法的年轻法师。',
      image: '',
      stats: { hp: 60, hpCurrent: 60, mp: 80, mpCurrent: 80, attack: 6, defense: 5, magicAttack: 18, magicDefense: 14, speed: 11, luck: 7 },
      abilities: [
        { id: 'ability_005', name: '火球术', description: '投掷一颗火球造成范围伤害', type: 'active', cost: { mp: 15 }, effect: { target: 'all_enemies', damage: { formula: 'magicAttack * 1.5', type: 'magic' } }, cooldown: 1 },
        { id: 'ability_006', name: '冰霜新星', description: '释放冰霜冲击波', type: 'active', cost: { mp: 20 }, effect: { target: 'all_enemies', damage: { formula: 'magicAttack * 2', type: 'magic' } }, cooldown: 2 },
      ],
      equipment: { weapon: 'item_003', armor: null, accessory: 'item_007' },
      inventory: ['item_010'],
      position: { x: 3, y: 7 }, level: 3, experience: 110,
      statusEffects: [], tags: ['mage', 'human'], notes: '',
    },
    {
      id: 'char_004', type: 'character',
      name: '戈尔', title: '盗贼',
      description: '街头长大的矮人盗贼，擅长开锁和偷袭。',
      image: '',
      stats: { hp: 70, hpCurrent: 70, mp: 20, mpCurrent: 20, attack: 13, defense: 7, magicAttack: 3, magicDefense: 6, speed: 18, luck: 12 },
      abilities: [
        { id: 'ability_007', name: '背刺', description: '从背后给予致命一击', type: 'active', cost: { mp: 10 }, effect: { target: 'single_enemy', damage: { formula: 'attack * 2.5', type: 'physical' } }, cooldown: 2 },
        { id: 'ability_008', name: '烟雾弹', description: '投掷烟雾弹降低敌人命中', type: 'active', cost: { mp: 8 }, effect: { target: 'all_enemies', damage: { formula: '0', type: 'physical' } }, cooldown: 3 },
      ],
      equipment: { weapon: 'item_004', armor: null, accessory: null },
      inventory: ['item_011', 'item_012'],
      position: { x: 3, y: 7 }, level: 3, experience: 95,
      statusEffects: [], tags: ['rogue', 'dwarf'], notes: '',
    },
  ],

  enemies: [
    { id: 'enemy_001', type: 'enemy', name: '骷髅战士', description: '从墓地复苏的亡灵战士', image: '', stats: { hp: 40, hpCurrent: 40, mp: 0, mpCurrent: 0, attack: 10, defense: 6, magicAttack: 0, magicDefense: 3, speed: 6, luck: 1 }, abilities: [], lootTable: [{ itemId: 'item_008', dropRate: 0.3 }, { itemId: 'item_009', dropRate: 0.5 }], behaviorHint: 'aggressive', experienceReward: 15, difficulty: 'easy', position: { x: 0, y: 0 }, statusEffects: [], tags: ['undead'], notes: '' },
    { id: 'enemy_002', type: 'enemy', name: '暗影狼', description: '被黑暗侵蚀的森林狼', image: '', stats: { hp: 35, hpCurrent: 35, mp: 0, mpCurrent: 0, attack: 12, defense: 4, magicAttack: 0, magicDefense: 2, speed: 14, luck: 3 }, abilities: [], lootTable: [{ itemId: 'item_008', dropRate: 0.4 }], behaviorHint: 'aggressive', experienceReward: 12, difficulty: 'easy', position: { x: 0, y: 0 }, statusEffects: [], tags: ['beast', 'shadow'], notes: '' },
    { id: 'enemy_003', type: 'enemy', name: '腐化树人', description: '被诅咒扭曲的古老树人', image: '', stats: { hp: 80, hpCurrent: 80, mp: 20, mpCurrent: 20, attack: 14, defense: 12, magicAttack: 8, magicDefense: 10, speed: 4, luck: 2 }, abilities: [{ id: 'eability_001', name: '藤蔓缠绕', description: '用藤蔓束缚目标', type: 'active', cost: { mp: 10 }, effect: { target: 'single_enemy', damage: { formula: 'attack * 1.3', type: 'physical' } }, cooldown: 1 }], lootTable: [{ itemId: 'item_010', dropRate: 0.3 }], behaviorHint: 'defensive', experienceReward: 25, difficulty: 'normal', position: { x: 0, y: 0 }, statusEffects: [], tags: ['plant', 'corrupted'], notes: '' },
    { id: 'enemy_004', type: 'enemy', name: '幽灵法师', description: '徘徊在遗迹中的亡灵法师', image: '', stats: { hp: 50, hpCurrent: 50, mp: 40, mpCurrent: 40, attack: 6, defense: 4, magicAttack: 16, magicDefense: 12, speed: 10, luck: 4 }, abilities: [{ id: 'eability_002', name: '暗影箭', description: '发射暗影能量', type: 'active', cost: { mp: 10 }, effect: { target: 'single_enemy', damage: { formula: 'magicAttack * 1.5', type: 'magic' } }, cooldown: 0 }], lootTable: [{ itemId: 'item_010', dropRate: 0.5 }, { itemId: 'item_007', dropRate: 0.1 }], behaviorHint: 'aggressive', experienceReward: 30, difficulty: 'normal', position: { x: 0, y: 0 }, statusEffects: [], tags: ['undead', 'caster'], notes: '' },
    { id: 'enemy_005', type: 'enemy', name: '毒蜘蛛', description: '巨大的毒蜘蛛，潜伏在暗处', image: '', stats: { hp: 30, hpCurrent: 30, mp: 0, mpCurrent: 0, attack: 8, defense: 3, magicAttack: 0, magicDefense: 2, speed: 12, luck: 5 }, abilities: [], lootTable: [{ itemId: 'item_008', dropRate: 0.6 }], behaviorHint: 'aggressive', experienceReward: 10, difficulty: 'easy', position: { x: 0, y: 0 }, statusEffects: [], tags: ['beast', 'poison'], notes: '' },
    { id: 'enemy_006', type: 'enemy', name: '堕落骑士', description: '曾经的圣骑士，如今被黑暗腐蚀', image: '', stats: { hp: 100, hpCurrent: 100, mp: 30, mpCurrent: 30, attack: 18, defense: 16, magicAttack: 10, magicDefense: 12, speed: 8, luck: 4 }, abilities: [{ id: 'eability_003', name: '黑暗斩击', description: '以黑暗力量强化攻击', type: 'active', cost: { mp: 15 }, effect: { target: 'single_enemy', damage: { formula: 'attack * 2', type: 'physical' } }, cooldown: 1 }], lootTable: [{ itemId: 'item_006', dropRate: 0.3 }, { itemId: 'item_009', dropRate: 1.0 }], behaviorHint: 'aggressive', experienceReward: 50, difficulty: 'hard', position: { x: 0, y: 0 }, statusEffects: [], tags: ['undead', 'knight'], notes: '' },
    { id: 'enemy_007', type: 'enemy', name: '森林巫妖', description: '暗黑森林诅咒的始作俑者', image: '', stats: { hp: 150, hpCurrent: 150, mp: 80, mpCurrent: 80, attack: 12, defense: 10, magicAttack: 22, magicDefense: 18, speed: 12, luck: 8 }, abilities: [{ id: 'eability_004', name: '死亡凋零', description: '释放死亡能量侵蚀所有生命', type: 'active', cost: { mp: 25 }, effect: { target: 'all_enemies', damage: { formula: 'magicAttack * 1.8', type: 'magic' } }, cooldown: 2 }, { id: 'eability_005', name: '亡灵召唤', description: '召唤骷髅战士协助战斗', type: 'active', cost: { mp: 20 }, effect: { target: 'self', damage: { formula: '0', type: 'magic' } }, cooldown: 3 }], lootTable: [{ itemId: 'item_006', dropRate: 1.0 }, { itemId: 'item_007', dropRate: 0.5 }], behaviorHint: 'aggressive', experienceReward: 100, difficulty: 'boss', position: { x: 0, y: 0 }, statusEffects: [], tags: ['undead', 'boss', 'caster'], notes: '' },
    { id: 'enemy_008', type: 'enemy', name: '石像鬼', description: '守护遗迹入口的石像鬼', image: '', stats: { hp: 90, hpCurrent: 90, mp: 0, mpCurrent: 0, attack: 16, defense: 20, magicAttack: 0, magicDefense: 8, speed: 5, luck: 1 }, abilities: [], lootTable: [{ itemId: 'item_008', dropRate: 1.0 }], behaviorHint: 'defensive', experienceReward: 35, difficulty: 'hard', position: { x: 0, y: 0 }, statusEffects: [], tags: ['construct'], notes: '' },
  ],

  events: [
    // ============================================================
    // 第一章：受命出征（场景 scene_spawn 入场即触发）
    // ============================================================
    {
      id: 'ch1_start', type: 'event', name: '第一章 受命出征',
      description: '冒险者公会的银制徽章在艾拉掌心微微发烫。守门人将一封蜡封信交到你们手中——森林深处的诅咒源头亟待调查。回头看一眼身后的村落，你们的目光转向幽暗的林边小径。',
      image: '', eventType: 'story',
      trigger: {
        type: 'composite',
        condition: { inScene: ['scene_spawn'], excludeCompletedEvents: ['ch1_start'], probability: 1.0 },
      },
      priority: 100,
      choices: [
        { id: 'accept_quest', text: '接受公会任务，深入暗黑森林', requirements: null,
          outcomes: [{ probability: 1.0, text: '你们郑重承诺，正式踏入了被诅咒的森林。',
            effects: [{ type: 'set_variable', name: 'quest_received', value: true }] }] },
      ],
      repeatable: false, maxOccurrences: 1,
      aiPromptHint: '庄重严肃的出征氛围，强调任务的紧迫性',
      tags: ['main', 'chapter1'], notes: '',
    },

    // ============================================================
    // 第二章：林间相遇（场景 scene_traveler_camp 抵达必触发）
    // ============================================================
    {
      id: 'ch2_traveler', type: 'event', name: '第二章 神秘旅人',
      description: '一位披着深色斗篷的旅人坐在路边的篝火旁。他抬起头，眼中闪过一丝难以名状的悲悯——似乎认识你们。',
      image: '', eventType: 'encounter',
      trigger: {
        type: 'composite',
        condition: { inScene: ['scene_traveler_camp'], requireVariables: { quest_received: true }, excludeCompletedEvents: ['ch2_traveler'], probability: 1.0 },
      },
      priority: 90,
      choices: [
        { id: 'accept_help', text: '接受旅人的帮助', requirements: null,
          outcomes: [{ probability: 1.0, text: '旅人将一枚刻有古老符文的护身符交给艾拉："带上它，符文之门会为你而开。"',
            effects: [
              { type: 'add_item', itemId: 'item_013' },
              { type: 'set_variable', name: 'met_traveler', value: true },
              { type: 'add_memory', value: '神秘旅人赠予艾拉一枚刻有符文的护身符' },
            ] }] },
        { id: 'decline_help', text: '保持警惕，谢绝帮助', requirements: null,
          outcomes: [{ probability: 1.0, text: '旅人耸耸肩，凝望火焰："愿你们好运。"',
            effects: [{ type: 'set_variable', name: 'rejected_help', value: true }] }] },
      ],
      repeatable: false, maxOccurrences: 1,
      aiPromptHint: '神秘感强烈，旅人言辞模棱两可',
      tags: ['main', 'chapter2', 'npc'], notes: '',
    },

    // ============================================================
    // 第三章：林间村落（场景 scene_village 抵达必触发）
    // ============================================================
    {
      id: 'ch3_village', type: 'event', name: '第三章 林间村落',
      description: '林间村落静卧在一片晨雾中。村民们投来戒备的目光——三年来鲜有外来者活着抵达此处。一位年长的村民走上前来。',
      image: '', eventType: 'story',
      trigger: {
        type: 'composite',
        condition: { inScene: ['scene_village'], excludeCompletedEvents: ['ch3_village'], probability: 1.0 },
      },
      priority: 90,
      choices: [
        { id: 'ask_dark_knight', text: '打听堕落骑士的传闻', requirements: null,
          outcomes: [{ probability: 1.0, text: '"那位骑士..."村民压低声音，"曾是圣光教团的英雄。如今他在森林深处徘徊。"',
            effects: [
              { type: 'set_variable', name: 'knows_dark_knight', value: true },
              { type: 'add_memory', value: '从村民处得知堕落骑士曾是圣光英雄，如今守在森林深处' },
            ] }] },
        { id: 'visit_shop', text: '拜访村中商人', requirements: null,
          outcomes: [{ probability: 1.0, text: '村民指了指村口的小铺。"老布伦的货架什么都有——只要你买得起。"',
            effects: [{ type: 'trigger_event', eventId: 'ch4_shop' }] }] },
      ],
      repeatable: false, maxOccurrences: 1,
      aiPromptHint: '村落氛围既温暖又戒备',
      tags: ['main', 'chapter3'], notes: '',
    },

    // ============================================================
    // 第四章：商人（可重复访问，村庄 POI 上自动触发）
    // ============================================================
    {
      id: 'ch4_shop', type: 'event', name: '老布伦的杂货铺',
      description: '木制柜台后站着一位红脸的矮人。架子上整齐摆放着药剂、护甲和零碎工具。"想买点什么？"',
      image: '', eventType: 'shop',
      trigger: {
        type: 'composite',
        condition: { inScene: ['scene_village'], requireCompletedEvents: ['ch3_village'], probability: 1.0 },
      },
      priority: 85,  // 高于 ch3 重访叙事，重访村庄优先打开商店
      shop: {
        inventory: [
          { itemId: 'item_009', price: 25, stock: 5 },
          { itemId: 'item_010', price: 30, stock: 3 },
          { itemId: 'item_012', price: 40, stock: 2 },
          { itemId: 'item_005', price: 180, stock: 1 },
        ],
        sellMultiplier: 0.5,
      },
      choices: [],
      repeatable: true, maxOccurrences: 99,
      aiPromptHint: '矮人商人热情、说话幽默',
      tags: ['shop', 'merchant'], notes: '',
    },

    // ============================================================
    // 第五章：暗影狼伏击（场景 scene_shadow_grove 抵达即触发）
    // ============================================================
    {
      id: 'ch5_wolves', type: 'event', name: '暗影狼伏击',
      description: '灌木丛中传来低沉的咆哮。两只暗影狼从阴影中跃出，红色的瞳孔锁定了你们。',
      image: '', eventType: 'encounter',
      trigger: {
        type: 'composite',
        condition: { inScene: ['scene_shadow_grove'], requireCompletedEvents: ['ch1_start'], excludeCompletedEvents: ['ch5_wolves'], probability: 1.0 },
      },
      priority: 50,
      choices: [
        { id: 'fight', text: '迎战', requirements: null,
          outcomes: [{ probability: 1.0, text: '战斗开始！', effects: [{ type: 'start_combat', enemyIds: ['enemy_002', 'enemy_002'] }] }] },
        { id: 'flee', text: '尝试逃跑', requirements: null,
          outcomes: [
            { probability: 0.6, text: '你们成功甩掉了狼群。', effects: [] },
            { probability: 0.4, text: '逃跑失败！', effects: [{ type: 'start_combat', enemyIds: ['enemy_002', 'enemy_005'] }] },
          ] },
      ],
      repeatable: false, maxOccurrences: 1,
      aiPromptHint: '紧张刺激的遭遇战',
      tags: ['combat', 'chapter5'], notes: '',
    },

    // ============================================================
    // 第六章：堕落骑士（场景 scene_abandoned_outpost 抵达 + 已知传闻）
    // ============================================================
    {
      id: 'ch6_dark_knight', type: 'event', name: '第六章 堕落骑士',
      description: '一身漆黑铠甲的骑士站立在路中央，黑暗之剑钉入泥土。他的目光锁定了艾拉胸口的圣徽，缓缓拔出武器。',
      image: '', eventType: 'boss',
      trigger: {
        type: 'composite',
        condition: { inScene: ['scene_abandoned_outpost'], requireVariables: { knows_dark_knight: true }, excludeCompletedEvents: ['ch6_dark_knight'], probability: 1.0 },
      },
      priority: 80,
      choices: [
        { id: 'fight', text: '接受挑战', requirements: null,
          outcomes: [{ probability: 1.0, text: '黑暗之剑斜指地面，霜风骤起。',
            effects: [{ type: 'start_combat', enemyIds: ['enemy_006'] }] }] },
        { id: 'redeem', text: '唤醒他的记忆', requirements: null,
          outcomes: [
            { probability: 0.5, text: '骑士眼中闪过一丝光芒："快走...趁我还能控制自己..."他让开了道路。',
              effects: [
                { type: 'set_variable', name: 'redeemed_knight', value: true },
                { type: 'add_memory', value: '唤醒了堕落骑士的记忆，他让出了道路' },
              ] },
            { probability: 0.5, text: '骑士的眼神变得疯狂："圣光已死！"',
              effects: [{ type: 'start_combat', enemyIds: ['enemy_006'] }] },
          ] },
      ],
      repeatable: false, maxOccurrences: 1,
      aiPromptHint: '悲剧性的对决，强调骑士曾经的荣光',
      tags: ['boss', 'main', 'chapter6'], notes: '',
    },

    // ============================================================
    // 第七章：林中治愈者（场景 scene_healer_shrine 抵达 + HP 危急）
    // ============================================================
    {
      id: 'ch7_rescue', type: 'event', name: '林中的治愈者',
      description: '当你们摇摇欲坠时，一位身披苔绿斗篷的老者从林中现身。他的手掌散发着柔和的绿光。"我感受到了痛苦的呼唤。"',
      image: '', eventType: 'story',
      trigger: {
        type: 'composite',
        condition: { inScene: ['scene_healer_shrine'], partyHpBelow: 0.5, requireCompletedEvents: ['ch1_start'], excludeCompletedEvents: ['ch7_rescue'], probability: 1.0 },
      },
      priority: 95,
      choices: [
        { id: 'accept_healing', text: '接受治疗', requirements: null,
          outcomes: [{ probability: 1.0, text: '温暖的绿光环绕你们，伤口迅速愈合。',
            effects: [
              { type: 'heal', target: 'all', value: 999 },
              { type: 'add_memory', value: '林中治愈者在生死关头救了我们' },
            ] }] },
      ],
      repeatable: false, maxOccurrences: 1,
      aiPromptHint: '神秘的救援，带有宿命感',
      tags: ['rescue'], notes: '',
    },

    // ============================================================
    // 第八章：遗迹之门（场景 scene_ruin_gate）
    // ============================================================
    {
      id: 'ch8_dungeon_gate', type: 'event', name: '第八章 遗迹之门',
      description: '布满藤蔓的巨大石门矗立在面前。门上刻着古老的精灵符文——这是诅咒源头所在。两尊石像鬼守在门的两侧，石灰岩眼中泛起红光。',
      image: '', eventType: 'boss',
      trigger: {
        type: 'composite',
        condition: { inScene: ['scene_ruin_gate'], excludeCompletedEvents: ['ch8_dungeon_gate'], probability: 1.0 },
      },
      priority: 95,
      choices: [
        { id: 'use_amulet', text: '用护身符尝试解读符文', requirements: null,
          outcomes: [
            { probability: 0.85, text: '护身符散发出温暖的光，符文逐一亮起。石门在低沉轰鸣中缓缓打开。',
              effects: [
                { type: 'set_variable', name: 'opened_gate', value: true },
                { type: 'add_memory', value: '用神秘旅人的护身符开启了遗迹之门' },
              ] },
            { probability: 0.15, text: '护身符的光芒一闪而逝，石像鬼苏醒了！',
              effects: [{ type: 'start_combat', enemyIds: ['enemy_008', 'enemy_008'] }] },
          ] },
        { id: 'fight_gargoyles', text: '正面突破', requirements: null,
          outcomes: [{ probability: 1.0, text: '石像鬼苏醒！',
            effects: [
              { type: 'start_combat', enemyIds: ['enemy_008', 'enemy_008'] },
              { type: 'set_variable', name: 'opened_gate', value: true },
            ] }] },
      ],
      repeatable: false, maxOccurrences: 1,
      aiPromptHint: '史诗感的遗迹入口场景',
      tags: ['boss', 'main', 'chapter8'], notes: '',
    },

    // ============================================================
    // 第九章：最终对决（场景 scene_lich_altar，需 opened_gate=true）
    // ============================================================
    {
      id: 'ch9_lich', type: 'event', name: '第九章 森林巫妖',
      description: '阴森的祭坛上，一具枯瘦的躯体缓缓抬起头。森林巫妖发出令人毛骨悚然的笑声——三年前的诅咒元凶终于现身。',
      image: '', eventType: 'boss',
      trigger: {
        type: 'composite',
        condition: { inScene: ['scene_lich_altar'], requireVariables: { opened_gate: true }, excludeCompletedEvents: ['ch9_lich'], probability: 1.0 },
      },
      priority: 100,
      choices: [
        { id: 'final_battle', text: '终结这一切！', requirements: null,
          outcomes: [{ probability: 1.0, text: '决战开始！',
            effects: [{ type: 'start_combat', enemyIds: ['enemy_007'] }] }] },
      ],
      repeatable: false, maxOccurrences: 1,
      aiPromptHint: '史诗终局战，氛围悲壮',
      tags: ['boss', 'main', 'chapter9'], notes: '',
    },

    // ============================================================
    // 第十章：黎明（默认结局，场景 scene_dawn_meadow）
    // 需 ch9 完成，且**没有**唤醒堕落骑士 — 单纯地"打赢了 boss"
    // ============================================================
    {
      id: 'ch10_epilogue', type: 'event', name: '第十章 黎明',
      description: '巫妖的躯壳化为飞灰，三年的诅咒随之消散。林间的阴霾散去，第一缕晨光穿透树梢落在你们身上。任务完成了——但这只是另一段冒险的开始。',
      image: '', eventType: 'story',
      trigger: {
        type: 'composite',
        condition: {
          inScene: ['scene_dawn_meadow'],
          requireCompletedEvents: ['ch9_lich'],
          excludeCompletedEvents: ['ch10_epilogue', 'ch10_redeemed'],
          probability: 1.0,
        },
      },
      priority: 100,
      choices: [],
      repeatable: false, maxOccurrences: 1,
      aiPromptHint: '光明、希望、新的开始',
      tags: ['epilogue', 'main', 'chapter10'], notes: '',
    },

    // ============================================================
    // 第十章·变体：救赎之黎明（同一场景，但唤醒了堕落骑士时的另一种结局）
    // priority 110 高于 ch10_epilogue 100，且加 requireVariables.redeemed_knight=true
    // 让 _afterSceneEnter 的 trigger 条件过滤把这一支挑出来
    // ============================================================
    {
      id: 'ch10_redeemed', type: 'event', name: '第十章 救赎之黎明',
      description: '巫妖陨落，圣光重新临人间。但你们走出遗迹时，那位曾守护森林的堕落骑士在道路尽头静静等候——他的铠甲不再漆黑，眼中重燃了三年前那束熟悉的光。',
      image: '', eventType: 'story',
      trigger: {
        type: 'composite',
        condition: {
          inScene: ['scene_dawn_meadow'],
          requireCompletedEvents: ['ch9_lich'],
          requireVariables: { redeemed_knight: true },
          excludeCompletedEvents: ['ch10_epilogue', 'ch10_redeemed'],
          probability: 1.0,
        },
      },
      priority: 110,
      choices: [],
      repeatable: false, maxOccurrences: 1,
      aiPromptHint: '悲喜交织的救赎，强调骑士从黑暗中归来的庄严，与艾拉重逢同袍的感动',
      tags: ['epilogue', 'main', 'chapter10', 'good-ending'], notes: '',
    },
  ],

  // ============================================================
  // 场景图（Scene Graph） — 桌游跑团式节点地图
  // 11 个节点 + 路径连接，每次跳转一次 AI 抵达叙事。
  // 从 scene_spawn 出发，可走主路（村庄→堕落骑士→遗迹）或支路（暗影狼/治愈者）。
  // ============================================================
  startingSceneId: 'scene_spawn',
  displayMode: 'scene-graph',
  scenes: [
    {
      id: 'scene_spawn', name: '冒险者公会门口', type: 'spawn', icon: '🏛',
      description: '黄昏中的村庄外缘，林边小径在暮色中蜿蜒。',
      coords: { x: 3, y: 7 },
      connections: [
        { to: 'scene_forest_path', label: '踏上幽暗的林边小径' },
      ],
      events: ['ch1_start'],
      vignettes: [
        '你们再次回到公会门口。守门人朝你们点头致意，目光透着敬意。',
        '夕阳把公会的旗帜染成血红色——这地方现在感觉像是另一个世界了。',
      ],
      tags: ['safe', 'main'],
    },
    {
      id: 'scene_forest_path', name: '林边小径', type: 'wilderness', icon: '🌿',
      description: '幽暗的林间小径，两侧的树木枝干扭曲，空气中弥漫着腐叶与潮湿的气息。',
      coords: { x: 5, y: 7 },
      connections: [
        { to: 'scene_spawn', label: '原路返回村口' },
        { to: 'scene_traveler_camp', label: '深入小径，朝林间篝火走去' },
        { to: 'scene_shadow_grove', label: '偏离主道，钻进密林深处',
          gated: { requireCompletedEvents: ['ch1_start'], hint: '你们还没下定决心，正式踏入森林' } },
      ],
      events: [],
      vignettes: [
        '小径两旁的树影摇晃着，戈尔下意识握紧了匕首。',
        '远处传来一声渡鸦的尖鸣，雷恩示意大家放轻脚步。',
      ],
      tags: ['main'],
    },
    {
      id: 'scene_traveler_camp', name: '林间篝火', type: 'wilderness', icon: '🔥',
      description: '一簇不合时宜的篝火在道旁噼啪作响，仿佛在等待着谁。',
      coords: { x: 7, y: 5 },
      connections: [
        { to: 'scene_forest_path', label: '回到林边小径' },
        { to: 'scene_village', label: '沿古道北上，前往林间村落' },
      ],
      events: ['ch2_traveler'],
      vignettes: [
        '篝火已经熄灭，只剩一圈焦黑的石头。旅人早已不知去向。',
        '风掠过空荡的营地，唯有焦土气息提醒着这里曾有人停留。',
      ],
      tags: ['main', 'npc'],
    },
    {
      id: 'scene_village', name: '林间村落', type: 'settlement', icon: '🏘',
      description: '雾气缭绕的木屋聚落，村民投来戒备的目光——三年来鲜有外来者活着抵达此处。',
      coords: { x: 7, y: 1 },
      connections: [
        { to: 'scene_traveler_camp', label: '沿古道南返' },
        { to: 'scene_dark_corridor', label: '沿主路东行，深入森林',
          gated: { requireCompletedEvents: ['ch3_village'], hint: '你们应该先和村民打个招呼' } },
      ],
      events: ['ch4_shop', 'ch3_village'],
      vignettes: [
        '你们再次踏入村落，孩童们好奇地张望。老布伦在杂货铺门口冲你们点头致意。',
        '村中的炊烟比之前稀薄了几分，几位老人正在井边低声议论你们的事迹。',
      ],
      tags: ['safe', 'main', 'shop'],
    },
    {
      id: 'scene_dark_corridor', name: '森林古道', type: 'wilderness', icon: '🌲',
      description: '深入森林的主要古道，铺路石板已被苔藓与裂缝侵蚀。',
      coords: { x: 11, y: 5 },
      connections: [
        { to: 'scene_village', label: '原路返回村落' },
        { to: 'scene_abandoned_outpost', label: '继续沿道深入',
          gated: { requireVariables: { knows_dark_knight: true }, hint: '前方阴气逼人，你们还不知道那里隐藏着什么' } },
        { to: 'scene_shadow_grove', label: '钻进路边的密林' },
        { to: 'scene_healer_shrine', label: '注意到林中隐秘的祭坛小径' },
      ],
      events: [],
      vignettes: [
        '古道两旁的枯树像无数张沉默的脸，注视着你们的身影。',
        '远处传来沉闷的钟声，方向难以辨认。',
      ],
      tags: ['main'],
    },
    {
      id: 'scene_shadow_grove', name: '暗影丛林', type: 'combat', icon: '🐺',
      description: '光线骤暗的密林深处，灌木丛中传来低沉的咆哮。',
      coords: { x: 9, y: 8 },
      connections: [
        { to: 'scene_forest_path', label: '退回林边小径' },
        { to: 'scene_dark_corridor', label: '钻出密林回到古道' },
      ],
      events: ['ch5_wolves'],
      vignettes: [
        '丛林深处静悄悄的，只剩你们方才战斗的痕迹。',
        '几丛被狼爪挠过的灌木还在风中摇曳。',
      ],
      tags: ['combat'],
    },
    {
      id: 'scene_healer_shrine', name: '苔藓祭坛', type: 'vignette', icon: '🌿',
      description: '隐藏在密林深处的小祭坛，绿光在石缝间若隐若现。',
      coords: { x: 13, y: 8 },
      connections: [
        { to: 'scene_dark_corridor', label: '回到古道' },
      ],
      events: ['ch7_rescue'],
      vignettes: [
        '祭坛上的青苔在阳光中安详地呼吸，治愈者早已不知所踪。',
        '你们在祭坛前驻足片刻，仿佛能感受到一丝来自远方的祝福。',
      ],
      tags: ['rescue', 'safe'],
    },
    {
      id: 'scene_abandoned_outpost', name: '废弃哨所', type: 'combat', icon: '⚔',
      description: '一座倾颓的圣光教团哨所，黑暗气息在残垣间游动。',
      coords: { x: 14, y: 5 },
      connections: [
        { to: 'scene_dark_corridor', label: '原路返回古道' },
        { to: 'scene_ruin_outskirts', label: '继续向东深入森林' },
      ],
      events: ['ch6_dark_knight'],
      vignettes: [
        '哨所静默无人，唯有风掠过破损的旗帜。',
        '骑士留下的剑痕还嵌在断墙上，向所有人诉说曾经的对决。',
      ],
      tags: ['boss', 'main'],
    },
    {
      id: 'scene_ruin_outskirts', name: '遗迹外围', type: 'wilderness', icon: '🏚',
      description: '森林尽头的山脚，远处隐约可见藤蔓缠绕的巨大石门。',
      coords: { x: 16, y: 8 },
      connections: [
        { to: 'scene_abandoned_outpost', label: '返回哨所' },
        { to: 'scene_ruin_gate', label: '走近那扇巨大的石门' },
      ],
      events: [],
      vignettes: [
        '石门的轮廓在雾中若隐若现，仿佛在等待着什么。',
        '空气中弥漫着古老魔力的余烬，让人头皮发麻。',
      ],
      tags: ['main'],
    },
    {
      id: 'scene_ruin_gate', name: '遗迹之门', type: 'dungeon', icon: '🚪',
      description: '布满藤蔓的巨大石门矗立在山壁前，门上刻着古老的精灵符文。',
      coords: { x: 17, y: 10 },
      connections: [
        { to: 'scene_ruin_outskirts', label: '撤回外围' },
        { to: 'scene_lich_altar', label: '踏入门后的黑暗',
          gated: { requireVariables: { opened_gate: true }, hint: '石门紧闭，似乎需要某种钥匙' } },
      ],
      events: ['ch8_dungeon_gate'],
      vignettes: [
        '石门已经向你们开启，幽暗的通道在前方等待。',
        '门口的石像鬼已陷入沉寂，圣光的余晖照亮了符文。',
      ],
      tags: ['boss', 'main'],
    },
    {
      id: 'scene_lich_altar', name: '巫妖祭坛', type: 'dungeon', icon: '💀',
      description: '阴森的地下祭坛，幽绿鬼火在祭台中央跳动。',
      coords: { x: 17, y: 12 },
      connections: [
        { to: 'scene_dawn_meadow', label: '战斗结束后走出遗迹',
          gated: { requireCompletedEvents: ['ch9_lich'], hint: '诅咒的源头还在脉动，必须先终结它' } },
      ],
      events: ['ch9_lich'],
      vignettes: [
        '祭坛上的碎骨已化为灰烬，幽绿火焰彻底熄灭。',
        '空荡的祭坛回荡着风声，曾经的恐怖只剩一片寂静。',
      ],
      tags: ['boss', 'main'],
    },
    {
      id: 'scene_dawn_meadow', name: '黎明草地', type: 'ending', icon: '🌅',
      description: '走出遗迹，森林正迎来三年来的第一缕黎明。',
      coords: { x: 17, y: 14 },
      connections: [],
      // 两个结局事件挂在同一场景，按 trigger 条件 + priority 分流：
      // - ch10_redeemed: 优先 (priority 110)，需 redeemed_knight=true
      // - ch10_epilogue: 默认 (priority 100)
      events: ['ch10_redeemed', 'ch10_epilogue'],
      vignettes: [
        '阳光铺满草地，鸟鸣声从远处传来。',
      ],
      tags: ['epilogue', 'main', 'safe'],
    },
  ],

  items: [
    { id: 'item_001', type: 'item', name: '圣光之剑', description: '散发淡淡圣光的长剑', image: '', itemType: 'weapon', statModifiers: { attack: 8, magicAttack: 3 }, consumeEffect: null, equipSlot: 'weapon', buyPrice: 200, sellPrice: 100, stackable: false, maxStack: 1, tags: ['weapon', 'holy'], notes: '' },
    { id: 'item_002', type: 'item', name: '精灵长弓', description: '精灵工匠打造的轻便长弓', image: '', itemType: 'weapon', statModifiers: { attack: 6, speed: 2 }, consumeEffect: null, equipSlot: 'weapon', buyPrice: 150, sellPrice: 75, stackable: false, maxStack: 1, tags: ['weapon', 'bow'], notes: '' },
    { id: 'item_003', type: 'item', name: '元素法杖', description: '镶嵌着红蓝宝石的法杖', image: '', itemType: 'weapon', statModifiers: { magicAttack: 10, mp: 10 }, consumeEffect: null, equipSlot: 'weapon', buyPrice: 250, sellPrice: 125, stackable: false, maxStack: 1, tags: ['weapon', 'staff'], notes: '' },
    { id: 'item_004', type: 'item', name: '暗影匕首', description: '刀刃上涂有毒液的匕首', image: '', itemType: 'weapon', statModifiers: { attack: 5, speed: 3, luck: 2 }, consumeEffect: null, equipSlot: 'weapon', buyPrice: 120, sellPrice: 60, stackable: false, maxStack: 1, tags: ['weapon', 'dagger'], notes: '' },
    { id: 'item_005', type: 'item', name: '白银锁甲', description: '轻便的白银锁子甲', image: '', itemType: 'armor', statModifiers: { defense: 8, magicDefense: 4 }, consumeEffect: null, equipSlot: 'armor', buyPrice: 180, sellPrice: 90, stackable: false, maxStack: 1, tags: ['armor', 'silver'], notes: '' },
    { id: 'item_006', type: 'item', name: '暗黑精华', description: '散发黑暗气息的神秘结晶', image: '', itemType: 'quest', statModifiers: {}, consumeEffect: null, equipSlot: null, buyPrice: 0, sellPrice: 50, stackable: true, maxStack: 10, tags: ['quest', 'material'], notes: '' },
    { id: 'item_007', type: 'item', name: '魔力水晶', description: '蕴含纯净魔力的水晶', image: '', itemType: 'accessory', statModifiers: { magicAttack: 4, magicDefense: 3, mp: 15 }, consumeEffect: null, equipSlot: 'accessory', buyPrice: 300, sellPrice: 150, stackable: false, maxStack: 1, tags: ['accessory', 'crystal'], notes: '' },
    { id: 'item_008', type: 'item', name: '金币袋', description: '一小袋金币', image: '', itemType: 'material', statModifiers: {}, consumeEffect: null, equipSlot: null, buyPrice: 0, sellPrice: 10, stackable: true, maxStack: 99, tags: ['currency'], notes: '' },
    { id: 'item_009', type: 'item', name: '治疗药水', description: '恢复30点生命值', image: '', itemType: 'consumable', statModifiers: {}, consumeEffect: { type: 'heal', stat: 'hp', value: 30 }, equipSlot: null, buyPrice: 25, sellPrice: 12, stackable: true, maxStack: 10, tags: ['consumable', 'potion'], notes: '' },
    { id: 'item_010', type: 'item', name: '魔力药水', description: '恢复20点魔力', image: '', itemType: 'consumable', statModifiers: {}, consumeEffect: { type: 'heal', stat: 'mp', value: 20 }, equipSlot: null, buyPrice: 30, sellPrice: 15, stackable: true, maxStack: 10, tags: ['consumable', 'potion'], notes: '' },
    { id: 'item_011', type: 'item', name: '开锁工具', description: '盗贼专用的精密开锁工具', image: '', itemType: 'quest', statModifiers: {}, consumeEffect: null, equipSlot: null, buyPrice: 50, sellPrice: 25, stackable: false, maxStack: 1, tags: ['tool', 'rogue'], notes: '' },
    { id: 'item_012', type: 'item', name: '烟雾弹', description: '可以制造烟幕掩护撤退', image: '', itemType: 'consumable', statModifiers: {}, consumeEffect: { type: 'buff', stat: 'speed', value: 5, duration: 2 }, equipSlot: null, buyPrice: 40, sellPrice: 20, stackable: true, maxStack: 5, tags: ['consumable', 'rogue'], notes: '' },
    // ch2 神秘旅人赠予的关键剧情物品；ch8 遗迹之门 use_amulet 选项叙事所指
    // 与玩家初始装备的 item_007 魔力水晶解耦，避免叙事/物品错位
    { id: 'item_013', type: 'item', name: '符文护身符', description: '刻有古老精灵符文的护身符，符文之门会为它开启', image: '', itemType: 'accessory', statModifiers: { magicDefense: 4, hp: 10 }, consumeEffect: null, equipSlot: 'accessory', buyPrice: 0, sellPrice: 80, stackable: false, maxStack: 1, tags: ['accessory', 'quest', 'rune'], notes: '剧情物品 — 来自 ch2_traveler' },
  ],

  map: {
    id: 'map_001', name: '暗黑森林', description: '被诅咒笼罩的古老森林',
    width: 20, height: 15, tileSize: 64,
    tileTypes: {
      'G': { name: '草地', color: '#4a8c3f', walkable: true, moveCost: 1, image: '' },
      'T': { name: '树林', color: '#2d5a1e', walkable: true, moveCost: 2, image: '' },
      'W': { name: '水域', color: '#3366cc', walkable: false, moveCost: 99, image: '' },
      'M': { name: '山地', color: '#8b7355', walkable: false, moveCost: 99, image: '' },
      'R': { name: '道路', color: '#c4a35a', walkable: true, moveCost: 0.5, image: '' },
      'V': { name: '村庄', color: '#d4a574', walkable: true, moveCost: 1, image: '' },
      'D': { name: '地城入口', color: '#4a0000', walkable: true, moveCost: 1, image: '' },
      'S': { name: '起点', color: '#ffcc00', walkable: true, moveCost: 1, image: '' },
    },
    grid: [
      'TTTTGGGGGGGGRRGGTTTT',
      'TTTGGGGVGGGRRGGGTTTT',
      'TTGGGGGGGGRRGGGGTTTT',
      'GGGGGGGGRRGGGGGGGGGG',
      'GGGWWGGRRGGGGGGGGGGG',
      'GGGWWGRRGGGGGGMMMGGG',
      'GGGGGGRRGGGGMMMMMGGG',
      'GGGSRRGGGGGMMMMMGGGG',
      'GGGRRGGGGGGGMMMGGGGG',
      'GGRRGGGGGGGGGMGGGGGG',
      'GRRGGGGGGGGGGGGGGDGG',
      'RRGGGGGGGGGGGGGGGGTG',
      'RGGGGTTGGGGGGGGGGTTT',
      'GGGGTTTGGGGGGGGGTTTM',
      'GGGTTTTTGGGGGGTTTTMM',
    ],
    pointsOfInterest: [
      { id: 'poi_spawn', x: 3, y: 7, name: '出发点', type: 'spawn', linkedEventId: null },
      { id: 'poi_village', x: 7, y: 1, name: '林间村落', type: 'village', linkedEventId: null },
      { id: 'poi_dungeon', x: 17, y: 10, name: '遗迹入口', type: 'dungeon', linkedEventId: null },
    ],
    fogOfWar: true, revealRadius: 3,
    tags: ['forest', 'outdoor'], notes: '',
  },

  rules: {
    diceType: 'd20',
    combatFormula: '(attack + dice) - defense',
    maxPartySize: 4,
    startingGold: 100,
    deathPenalty: 'revive_at_village',
  },

  aiConfig: {
    systemPromptTemplate: 'compact',
    customSystemPrompt: '',
    temperature: 0.7,
    maxResponseTokens: 1000,
    useStructuredOutput: true,
    language: 'zh-CN',
  },
};
