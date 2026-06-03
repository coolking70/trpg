/**
 * 学校主题包：武道馆 / 宗门（Phase 48 SC6）
 *
 * major-fixed：拜入「门派」即定功法路线。课程=修炼，授予体技属性 + 武学技能；
 * 社团=切磋会；校规严（禁私斗、禁盗艺、禁擅离）；考核=季度比试，竞赛=门派擂台/跨派论武。
 * 考核不过者罚、屡败者逐出；与师父/同门交厚者可于出师时同行。
 */
export const martialDojoSchema = {
  name: '苍岳武道馆',
  curriculum: {
    mode: 'major-fixed', termsPerYear: 2, creditsPerTerm: 10, creditsPerYear: 20,
    creditsToGraduate: 80, yearsToGraduate: 4, passGpa: 1.2, expelGpa: 0.6, expelDemerits: 8, maxElectivesPerTerm: 4,
  },
  majors: {
    fist: { name: '外家·拳脚', desc: '刚猛拳脚，硬桥硬马。',
      requiredByYear: { 1: ['w_basic', 'w_fist1'], 2: ['w_fist2'], 3: ['w_inner'], 4: ['w_trial'] },
      requiredCourses: ['w_basic', 'w_fist1'] },
    sword: { name: '内家·剑道', desc: '以气御剑，后发先至。',
      requiredByYear: { 1: ['w_basic', 'w_sword1'], 2: ['w_sword2'], 3: ['w_inner'], 4: ['w_trial'] },
      requiredCourses: ['w_basic', 'w_sword1'] },
  },
  courses: {
    w_basic:  { name: '扎马步桩', credits: 3, type: 'training', attr: 'defense', prereqs: [], grants: { stats: { defense: 2, hp: 10 } } },
    w_fist1:  { name: '基础拳法', credits: 4, type: 'training', attr: 'attack', prereqs: ['w_basic'], grants: { stats: { attack: 3 }, skills: ['崩拳'] } },
    w_fist2:  { name: '进阶拳法', credits: 4, type: 'training', attr: 'attack', prereqs: ['w_fist1'], grants: { stats: { attack: 4 }, skills: ['虎扑'] } },
    w_sword1: { name: '基础剑式', credits: 4, type: 'training', attr: 'speed', prereqs: ['w_basic'], grants: { stats: { speed: 2, attack: 2 }, skills: ['刺剑'] } },
    w_sword2: { name: '进阶剑式', credits: 4, type: 'training', attr: 'speed', prereqs: ['w_sword1'], grants: { stats: { speed: 3, attack: 2 }, skills: ['绕指柔'] } },
    w_inner:  { name: '内功心法', credits: 3, type: 'seminar', attr: 'intellect', prereqs: ['w_basic'], grants: { stats: { hp: 15, mp: 6 }, skills: ['运气疗伤'] } },
    w_trial:  { name: '历练行走', credits: 5, type: 'practical', attr: 'luck', prereqs: ['w_inner'], grants: { stats: { luck: 1, hp: 10 } }, eventHook: 'dojo_journey' },
  },
  clubs: {
    club_spar:  { name: '切磋会', activity: '以武会友', eventHook: 'club_spar', perk: { stats: { attack: 1 } } },
    club_herb:  { name: '采药堂', activity: '识药疗伤', eventHook: 'club_herb', perk: { stats: { hp: 8 } } },
  },
  rules: {
    no_steal_art: { name: '禁盗师门武学', desc: '窃艺者，废功逐出。', penalty: { demerits: 5, severe: true } },
    no_private_fight: { name: '禁私斗伤人', desc: '馆内私斗见血，重罚。', penalty: { demerits: 3, severe: false } },
    no_leave: { name: '禁擅离武馆', desc: '未禀师长私自下山，罚。', penalty: { demerits: 1 } },
  },
  exams: {
    midterm: { name: '月度比试', kind: 'exam', attr: 'attack', passScore: 60, failPenalty: null,
      rewardByRank: [{ maxRank: 1, reward: { stats: { attack: 1 } } }] },
    final:   { name: '季度大考', kind: 'exam', attr: 'attack', passScore: 60, failPenalty: 'retain',
      rewardByRank: [{ maxRank: 1, reward: { stats: { attack: 1, hp: 10 } } }] },
  },
  competitions: {
    arena:  { name: '门派擂台', kind: 'competition', attr: 'attack', rewardByRank: [
      { maxRank: 1, reward: { stats: { attack: 2, hp: 15 }, skills: ['通臂劲'] } }, { maxRank: 3, reward: { stats: { attack: 1 } } },
    ] },
    council: { name: '跨派论武大会', kind: 'competition', attr: 'attack', fieldSize: 40, rewardByRank: [
      { maxRank: 1, reward: { stats: { attack: 3, speed: 1 } } }, { maxRank: 5, reward: { stats: { attack: 1 } } },
    ] },
  },
  roles: ['master', 'coach', 'headmaster', 'senior', 'junior'],
  recruitAffinity: 65,
  narration: {
    settingTone: '一座坐落苍岳之巅的武道馆，晨钟暮鼓，弟子们苦练功夫、以武证道。',
    terms: { school: '武馆', term: '季', exam: '比试', club: '会', demerit: '罚' },
  },
};

export default martialDojoSchema;
