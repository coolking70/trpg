/**
 * 构建《云霄学徒·奥术之路》完整魔法学校剧本 → presets/magic-school.json
 * 基于 magicAcademySchema 换皮，curriculum 调为 2 年可毕业；含多场景/可招募 NPC/敌人/
 * requireSchoolState 与 eventHook 门控的校园剧情（入学/社团/秘境实习/禁咒诱惑/决斗/毕业）。
 */
import fs from 'fs';
import { magicAcademySchema } from '../src/data/themes/magicAcademy.js';

// —— 学校 Schema：沿用魔法学院题材，压缩为 2 年可毕业的可玩弧线 ——
const schoolSchema = {
  ...JSON.parse(JSON.stringify(magicAcademySchema)),
  curriculum: {
    mode: 'major-fixed', termsPerYear: 2, creditsPerTerm: 12, creditsPerYear: 11,
    creditsToGraduate: 22, yearsToGraduate: 2, passGpa: 1.0, expelGpa: 0.5, expelDemerits: 9, maxElectivesPerTerm: 5,
  },
  majors: {
    evocation: { name: '塑能学派', desc: '操控元素、攻伐之道。',
      requiredByYear: { 1: ['m_fund', 'm_fire1'], 2: ['m_fire2', 'm_ward'] }, requiredCourses: ['m_fund', 'm_fire1'] },
    conjuration: { name: '咒法学派', desc: '召唤奇术、奥妙无穷。',
      requiredByYear: { 1: ['m_fund', 'm_summon1'], 2: ['m_summon2', 'm_ward'] }, requiredCourses: ['m_fund', 'm_summon1'] },
  },
  recruitAffinity: 30, // 压缩学制：关系阈值相应下调，使一学年内培养的师友可于毕业招募
};

const character = {
  id: 'char_player', name: '新晋学徒',
  stats: { hp: 42, hpCurrent: 42, mp: 22, mpCurrent: 22, attack: 6, defense: 4, magicAttack: 8, magicDefense: 6, speed: 6, luck: 4, intellect: 12 },
  skills: [],
};

const npcs = [
  { id: 'npc_mentor', name: '导师·薇拉', recruitable: true, description: '塑能学派的年轻导师，治学严谨却暗中护短。',
    stats: { hp: 78, hpCurrent: 78, mp: 60, mpCurrent: 60, attack: 8, defense: 8, magicAttack: 17, magicDefense: 13, speed: 8, luck: 5 },
    abilities: [{ id: 'firestorm', name: '烈焰风暴', type: 'active', mpCost: 12 }] },
  { id: 'npc_rival', name: '同窗·凯尔', recruitable: true, description: '咒法学派的天才少年，争强好胜，对禁忌知识有危险的好奇。',
    stats: { hp: 48, hpCurrent: 48, mp: 32, mpCurrent: 32, attack: 6, defense: 5, magicAttack: 12, magicDefense: 7, speed: 8, luck: 4 },
    abilities: [{ id: 'summon_stone', name: '召唤石像', type: 'active', mpCost: 8 }] },
  { id: 'npc_roommate', name: '室友·莉莉', recruitable: true, description: '炼金研究会的开朗少女，总有用不完的药剂与点子。',
    stats: { hp: 44, hpCurrent: 44, mp: 30, mpCurrent: 30, attack: 5, defense: 5, magicAttack: 9, magicDefense: 9, speed: 7, luck: 6 },
    abilities: [{ id: 'heal_potion', name: '治疗药剂', type: 'active', mpCost: 6 }] },
  { id: 'npc_coach', name: '决斗社教练·罗恩', recruitable: true, description: '退役的决斗冠军，嗓门大、心肠热，教你实战的狠劲。',
    stats: { hp: 70, hpCurrent: 70, mp: 28, mpCurrent: 28, attack: 12, defense: 9, magicAttack: 10, magicDefense: 8, speed: 9, luck: 4 },
    abilities: [{ id: 'arc_slash', name: '奥术斩', type: 'active', mpCost: 6 }] },
  { id: 'npc_dean', name: '校长·奥古斯', recruitable: false, description: '云霄学院的白须校长，深不可测，掌管禁书区的钥匙。',
    stats: { hp: 120, hpCurrent: 120, mp: 99, mpCurrent: 99, attack: 10, defense: 12, magicAttack: 22, magicDefense: 18, speed: 9, luck: 8 } },
];

const enemies = [
  { id: 'enemy_wisp', name: '秘境光怪', tags: ['wisp', 'spirit', 'magic'], difficulty: 'easy', stats: { hp: 26, hpCurrent: 26, mp: 0, mpCurrent: 0, attack: 8, defense: 3, magicAttack: 6, magicDefense: 4, speed: 7, luck: 2 } },
  { id: 'enemy_duelist', name: '决斗社学长', tags: ['human', 'magic'], difficulty: 'normal', stats: { hp: 40, hpCurrent: 40, mp: 12, mpCurrent: 12, attack: 9, defense: 5, magicAttack: 9, magicDefense: 6, speed: 8, luck: 3 } },
  { id: 'enemy_construct', name: '失控的禁咒造物', tags: ['construct', 'elemental', 'magic', 'boss'], difficulty: 'boss', stats: { hp: 90, hpCurrent: 90, mp: 30, mpCurrent: 30, attack: 14, defense: 8, magicAttack: 16, magicDefense: 10, speed: 6, luck: 2 } },
];

const items = [
  { id: 'item_mana_potion', name: '法力药剂', itemType: 'consumable', description: '回复 12 点法力。', consumeEffect: { type: 'restore_mp', amount: 12 }, value: 20 },
];

// —— 事件：校园剧情（requireSchoolState / eventHook / inScene 门控）——
const sc = (condition) => ({ type: 'composite', condition });
const events = [
  // 入学典礼（在校园、年级1，触发一次）
  { id: 'ev_orientation', type: 'event', name: '入学典礼', eventType: 'story', maxTriggers: 1,
    description: '云霄学院的中庭广场，新生列队。校长奥古斯白须飘飘，宣布新学年开启：「愿你们在奥术之路上，既求力量，亦守心性。」',
    trigger: sc({ inScene: ['scene_academy'], requireSchoolState: { minYear: 1 } }), tags: ['main'],
    choices: [
      { id: 'c_vow', text: '默念誓言，专注向学', outcomes: [{ probability: 1, text: '你在心底立誓精研奥术。导师薇拉远远看了你一眼，记下了你的名字。', effects: [{ type: 'school_relationship', npcId: 'npc_mentor', delta: 15, role: 'mentor' }] }] },
      { id: 'c_eye', text: '观察身边的同窗', outcomes: [{ probability: 1, text: '你注意到一个眼神锐利的少年——凯尔，他也正打量着你。', effects: [{ type: 'school_relationship', npcId: 'npc_rival', delta: 10, role: 'classmate' }] }] },
    ] },
  // 宿舍夜谈（宿舍，触发一次）
  { id: 'ev_dorm_night', type: 'event', name: '宿舍夜谈', eventType: 'story', maxTriggers: 1,
    description: '夜里，室友莉莉抱着一摞炼金笔记敲开你的门：「睡不着？我调了助眠药剂，要不要一起试试效果？」',
    trigger: sc({ inScene: ['scene_dorm'], requireSchoolState: true }), tags: [],
    choices: [
      { id: 'c_join', text: '欣然加入', outcomes: [{ probability: 1, text: '你俩聊到深夜，莉莉成了你最早的好友。', effects: [{ type: 'school_relationship', npcId: 'npc_roommate', delta: 35, role: 'roommate' }] }] },
      { id: 'c_polite', text: '婉言谢绝，早些休息', outcomes: [{ probability: 1, text: '你礼貌地道了晚安。莉莉耸耸肩走了。', effects: [{ type: 'school_relationship', npcId: 'npc_roommate', delta: 10, role: 'roommate' }] }] },
    ] },
  // 社团招新（校园，入学典礼后）
  { id: 'ev_club_fair', type: 'event', name: '社团招新', eventType: 'story', maxTriggers: 1,
    description: '广场两侧摆开社团摊位。炼金研究会的莉莉朝你招手，决斗社教练罗恩的大嗓门震得展板嗡嗡作响：「想学真本事的，过来！」',
    trigger: sc({ inScene: ['scene_academy'], requireSchoolState: true, requireCompletedEvents: ['ev_orientation'] }), tags: [],
    choices: [
      { id: 'c_browse', text: '四处看看', outcomes: [{ probability: 1, text: '你记下了感兴趣的社团，打算稍后报名（在就学动作里加入社团）。', effects: [] }] },
    ] },
  // 秘境实习（课程 m_field 的 eventHook：academy_fieldwork）—— 临时组队 + 战斗
  { id: 'ev_fieldwork', type: 'event', name: '秘境实习', eventType: 'story', maxTriggers: 1,
    description: '导师薇拉带队踏入秘境裂隙。光怪自虚空里凝形扑来——「这是实战，别松懈！」凯尔与你临时结成小队。',
    trigger: sc({ requireSchoolState: { eventHook: 'academy_fieldwork' } }), tags: ['main'],
    choices: [
      { id: 'c_fight', text: '与凯尔并肩迎敌', outcomes: [{ probability: 1, text: '你们背靠背结阵，准备应战。', effects: [
        { type: 'school_relationship', npcId: 'npc_mentor', delta: 20, role: 'mentor' },
        { type: 'school_temp_party', members: ['npc_rival'] },
        { type: 'start_combat', enemyIds: ['enemy_wisp', 'enemy_wisp'] },
      ] }] },
    ] },
  // 决斗社切磋（社团 club_duel 的 eventHook）—— 战斗
  { id: 'ev_club_duel', type: 'event', name: '决斗社切磋', eventType: 'story', maxTriggers: 1,
    description: '决斗台上，教练罗恩拍了拍你的肩：「光读书没用。来，跟学长走两招，输了不丢人，怂了才丢人！」',
    trigger: sc({ requireSchoolState: { eventHook: 'club_duel' } }), tags: [],
    choices: [
      { id: 'c_duel', text: '应战', outcomes: [{ probability: 1, text: '你深吸一口气，凝起法力。', effects: [{ type: 'school_relationship', npcId: 'npc_coach', delta: 25, role: 'coach' }, { type: 'start_combat', enemyIds: ['enemy_duelist'] }] }] },
    ] },
  // 禁咒诱惑（图书馆，修毕 m_fund 后）—— 分支：守规 / 劝阻 / 违纪同研
  { id: 'ev_forbidden', type: 'event', name: '禁书区的低语', eventType: 'story', maxTriggers: 1,
    description: '图书馆深处，你撞见凯尔偷偷誊抄一卷封印的禁咒残页。他眼神发亮：「这力量……你也想要吧？一起研究，谁都不会知道。」',
    trigger: sc({ inScene: ['scene_library'], requireSchoolState: { completed: 'm_fund' } }), tags: ['main'],
    choices: [
      { id: 'c_report', text: '上报校长（守校规）', outcomes: [{ probability: 1, text: '你转身报告了校长。凯尔被记过，狠狠瞪了你一眼，但禁咒被封存了。', effects: [{ type: 'school_relationship', npcId: 'npc_rival', delta: -25 }, { type: 'school_relationship', npcId: 'npc_dean', delta: 20, role: 'dean' }, { type: 'set_variable', name: 'forbidden_path', value: 'report' }] }] },
      { id: 'c_dissuade', text: '劝阻凯尔收手', outcomes: [{ probability: 1, text: '你按住他的手，苦劝良久。凯尔最终把残页塞回原处，看你的眼神多了几分信任。', effects: [{ type: 'school_relationship', npcId: 'npc_rival', delta: 32 }, { type: 'set_variable', name: 'forbidden_path', value: 'dissuade' }] }] },
      { id: 'c_study', text: '一起偷偷研究（违校规）', outcomes: [{ probability: 1, text: '禁忌的知识在指尖流淌，你学会了一式危险的咒法——但这违反了校规，迟早要付出代价。', effects: [{ type: 'school_relationship', npcId: 'npc_rival', delta: 30 }, { type: 'school_violation', ruleId: 'no_forbidden' }, { type: 'set_variable', name: 'forbidden_path', value: 'study' }] }] },
    ] },
  // 禁咒造物失控（秘境，2 年级、禁咒线之后）—— Boss 战
  { id: 'ev_construct', type: 'event', name: '失控的造物', eventType: 'story', maxTriggers: 1,
    description: '秘境深处轰鸣震动——那卷禁咒残页召出的造物挣脱了束缚，正向学院方向逼近。无论先前如何抉择，此刻必须阻止它。',
    trigger: sc({ inScene: ['scene_rift'], requireSchoolState: { minYear: 2 }, requireCompletedEvents: ['ev_forbidden'] }), tags: ['main'],
    choices: [
      { id: 'c_stop', text: '挺身封印造物', outcomes: [{ probability: 1, text: '你与赶来的导师薇拉一同迎向那团失控的奥术风暴。', effects: [{ type: 'school_temp_party', members: ['npc_mentor'] }, { type: 'start_combat', enemyIds: ['enemy_construct'] }] }] },
    ] },
  // 毕业之约（毕业后，校园）
  { id: 'ev_graduation', type: 'event', name: '毕业之约', eventType: 'story', maxTriggers: 1,
    description: '毕业典礼的钟声在云端回荡。四年同窗、师友就要各奔前程。你环顾身边——谁，愿意与你同行下一段旅程？',
    trigger: sc({ inScene: ['scene_academy'], requireSchoolState: { status: 'graduated' } }), tags: ['main', 'ending'],
    choices: [
      { id: 'c_recruit', text: '邀请交好的师友同行（在就学动作里招募）', outcomes: [{ probability: 1, text: '你向交心的伙伴们发出邀请。奥术之路，未完待续。', effects: [{ type: 'school_disband_party' }, { type: 'set_variable', name: 'graduated', value: true }] }] },
    ] },
];

const conn = (to, label) => ({ to, label });
const scenes = [
  // 开场剧情 ev_orientation 挂在起始场景 events，kickoff 即触发（其余事件经 composite inScene/eventHook 触发）
  { id: 'scene_academy', name: '学院广场', type: 'settlement', icon: '🏫', coords: { x: 0, y: 0 }, tags: ['spawn', 'school'], description: '悬浮云端的云霄学院中庭，符文回廊环绕，新生与高年级学徒往来如织。', connections: [conn('scene_classroom', '去塑能教室'), conn('scene_library', '去图书馆'), conn('scene_dorm', '回宿舍'), conn('scene_arena', '去试炼场'), conn('scene_rift', '前往秘境裂隙'), conn('scene_town', '乘云梯下凡')], events: ['ev_orientation'], vignettes: [] },
  { id: 'scene_classroom', name: '塑能教室', type: 'settlement', icon: '📖', coords: { x: -1, y: 1 }, tags: ['school'], description: '高窗洒下晨光，讲台上漂浮着演示用的元素法球。', connections: [conn('scene_academy', '回广场')], events: [], vignettes: [] },
  { id: 'scene_library', name: '云顶图书馆', type: 'building', icon: '📚', coords: { x: 1, y: 1 }, tags: ['school'], description: '层叠书架直插云霄，深处是上了封印的禁书区。', connections: [conn('scene_academy', '回广场')], events: [], vignettes: [] },
  { id: 'scene_dorm', name: '学徒宿舍', type: 'building', icon: '🛏', coords: { x: -1, y: -1 }, tags: ['school'], description: '温暖的塔楼宿舍，窗外是翻涌的云海。', connections: [conn('scene_academy', '回广场')], events: [], vignettes: [] },
  { id: 'scene_arena', name: '试炼场', type: 'combat', icon: '⚔️', coords: { x: 1, y: -1 }, tags: ['school'], description: '环形决斗台与考核法阵，墙上刻满历届优胜者之名。', connections: [conn('scene_academy', '回广场')], events: [], vignettes: [] },
  { id: 'scene_rift', name: '秘境裂隙', type: 'wilderness', icon: '🌀', coords: { x: 2, y: 0 }, tags: ['school'], description: '学院边缘的空间裂隙，元素狂暴、光怪丛生，是实战历练之地。', connections: [conn('scene_academy', '返回学院')], events: [], vignettes: [] },
  { id: 'scene_town', name: '云脚镇', type: 'town', icon: '🏘️', coords: { x: 0, y: 2 }, tags: [], description: '学院脚下的小镇，补给与市井气息交汇之处。', connections: [conn('scene_academy', '返回学院')], events: [], vignettes: [] },
];

const preset = {
  presetId: 'magic_school_ascension',
  name: '云霄学徒·奥术之路',
  author: 'TRPG 学校系统示范',
  version: '1.0.0',
  lore: { worldName: '云霄学院', era: '奥术纪元', background: '你考入了漂浮于云端的云霄魔法学院，将在此研习奥秘、结交同道、面对禁忌的诱惑，直至学成出师。', gmStyle: '温暖而富奇幻感的学院叙事，刻画课业、社团、师友与抉择。' },
  modules: { strategy: false, school: true },
  schoolSchema,
  schoolSetup: { schoolName: '云霄魔法学院', major: 'evocation' },
  characters: [character],
  npcs, enemies, items, events, scenes,
  startingSceneId: 'scene_academy',
  startingSceneRules: [{ default: true, sceneId: 'scene_academy' }],
  startingOptions: {
    origins: [
      { id: 'evoker', name: '塑能学徒', icon: '🔥', tags: ['major:evocation'], schoolMajor: 'evocation', statBonus: { magicAttack: 2 }, description: '志在元素攻伐，入塑能学派。' },
      { id: 'conjurer', name: '咒法学徒', icon: '✨', tags: ['major:conjuration'], schoolMajor: 'conjuration', statBonus: { intellect: 2 }, description: '醉心召唤奇术，入咒法学派。' },
    ],
  },
  rules: { allowCustomCharacter: false },
};

fs.writeFileSync('presets/magic-school.json', JSON.stringify(preset, null, 2));
console.log('✓ wrote presets/magic-school.json');
console.log(`  scenes ${scenes.length} / npcs ${npcs.length} / enemies ${enemies.length} / events ${events.length}`);
console.log(`  毕业要求：${schoolSchema.curriculum.yearsToGraduate}年 / ${schoolSchema.curriculum.creditsToGraduate}学分`);
