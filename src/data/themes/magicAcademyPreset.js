/**
 * 示范剧本：魔法学院（Phase 48 SC6）—— 挂 magicAcademySchema 换皮的学校剧本。
 * 极小可玩骨架：1 个可扮演学徒 + 学院/校外两场景 + 可招募的导师与同窗 + 社团/实践剧情钩子。
 * 演示：可选模块（schoolSetup）+ major-fixed 学派必修 + requireSchoolState 门控的校园剧情。
 */
import { magicAcademySchema } from './magicAcademy.js';

export const magicAcademyPreset = {
  presetId: 'theme_magic_academy',
  name: '云霄学徒·奥术之路',
  author: 'TRPG 主题包',
  lore: { worldName: '云霄学院', background: '你考入了漂浮于云端的云霄魔法学院，将在此研习奥秘、结交同道，直至学成出师。' },
  modules: { strategy: false, school: true },
  schoolSchema: magicAcademySchema,
  characters: [
    { id: 'char_player', name: '新晋学徒', stats: { hp: 40, hpCurrent: 40, mp: 20, mpCurrent: 20, attack: 6, defense: 4, magicAttack: 8, magicDefense: 6, speed: 6, luck: 4, intellect: 12 }, skills: [] },
  ],
  npcs: [
    { id: 'npc_mentor', name: '导师·薇拉', recruitable: true, description: '塑能学派的年轻导师，治学严谨却护短。',
      stats: { hp: 70, hpCurrent: 70, mp: 60, mpCurrent: 60, attack: 8, defense: 8, magicAttack: 16, magicDefense: 12, speed: 8, luck: 5 },
      abilities: [{ id: 'firestorm', name: '烈焰风暴', type: 'active', mpCost: 12 }] },
    { id: 'npc_rival', name: '同窗·凯尔', recruitable: true, description: '咒法学派的天才，与你亦敌亦友。',
      stats: { hp: 45, hpCurrent: 45, mp: 30, mpCurrent: 30, attack: 6, defense: 5, magicAttack: 11, magicDefense: 7, speed: 7, luck: 4 },
      abilities: [{ id: 'summon_stone', name: '召唤石像', type: 'active', mpCost: 8 }] },
    { id: 'npc_roommate', name: '室友·莉莉', recruitable: true, description: '炼金研究会的开朗少女，总有用不完的药剂。',
      stats: { hp: 42, hpCurrent: 42, mp: 28, mpCurrent: 28, attack: 5, defense: 5, magicAttack: 9, magicDefense: 8, speed: 7, luck: 6 },
      abilities: [{ id: 'heal_potion', name: '治疗药剂', type: 'active', mpCost: 6 }] },
  ],
  enemies: [], items: [],
  events: [
    // 入学结交室友（在校触发一次）
    { id: 'ev_meet_roommate', type: 'event', name: '新生报到', description: '宿舍里，开朗的莉莉伸手向你打招呼：「以后多关照啦！」', eventType: 'story',
      trigger: { type: 'composite', condition: { inScene: ['scene_academy'], requireSchoolState: true } }, tags: [], maxTriggers: 1,
      choices: [
        { id: 'c_friendly', text: '热情回应', outcomes: [{ probability: 1, text: '你与莉莉相谈甚欢。', effects: [{ type: 'school_relationship', npcId: 'npc_roommate', delta: 30, role: 'roommate' }] }] },
        { id: 'c_cool', text: '礼貌点头', outcomes: [{ probability: 1, text: '你淡淡地回了礼。', effects: [{ type: 'school_relationship', npcId: 'npc_roommate', delta: 10, role: 'roommate' }] }] },
      ] },
    // 野外秘境实习（修毕 m_field 时由 eventHook 触发临时组队历练）
    { id: 'ev_fieldwork', type: 'event', name: '秘境实习', description: '导师薇拉带你与几名同窗深入秘境，临时结成小队。', eventType: 'story',
      trigger: { type: 'composite', condition: { requireSchoolState: { eventHook: 'academy_fieldwork' } } }, tags: [], maxTriggers: 1,
      choices: [
        { id: 'c_team', text: '与同窗并肩', outcomes: [{ probability: 1, text: '你与凯尔临时组队，互为照应。', effects: [
          { type: 'school_relationship', npcId: 'npc_mentor', delta: 25, role: 'mentor' },
          { type: 'school_temp_party', members: ['npc_rival'] },
        ] }] },
      ] },
  ],
  scenes: [
    { id: 'scene_academy', name: '云霄学院', type: 'settlement', icon: '🏫', coords: { x: 0, y: 0 }, tags: ['spawn', 'school'], description: '悬浮云端的古老学院，塔楼林立，符文流转。', connections: [{ to: 'scene_town', label: '乘云梯下凡' }], events: [], vignettes: [] },
    { id: 'scene_town', name: '云脚镇', type: 'town', icon: '🏘️', coords: { x: 1, y: 0 }, tags: [], description: '学院脚下的小镇，补给与情报的集散地。', connections: [{ to: 'scene_academy', label: '返回学院' }], events: [], vignettes: [] },
  ],
  startingSceneId: 'scene_academy',
  startingOptions: {
    origins: [
      { id: 'evoker', name: '塑能学徒', icon: '🔥', tags: ['major:evocation'], schoolMajor: 'evocation', statBonus: { magicAttack: 2 }, description: '志在元素攻伐，入塑能学派。' },
      { id: 'conjurer', name: '咒法学徒', icon: '✨', tags: ['major:conjuration'], schoolMajor: 'conjuration', statBonus: { intellect: 2 }, description: '醉心召唤奇术，入咒法学派。' },
    ],
  },
  startingSceneRules: [{ default: true, sceneId: 'scene_academy' }],
  schoolSetup: { schoolName: '云霄魔法学院', major: 'evocation' },
};

export default magicAcademyPreset;
