/**
 * 学校主题包：魔法学院（Phase 48 SC6）
 *
 * 以 schoolSchema 换皮通用学校引擎——只改数据。major-fixed：入学择「学派」即定必修，
 * 逐年加深；课程修毕授予属性 + 法术技能；社团=研究会；校规含「禁止禁咒/决斗」；
 * 考试=学期评定，竞赛=学院杯魔法对抗。关系达标的同窗/导师可于毕业时招募。
 */
export const magicAcademySchema = {
  name: '云霄魔法学院',
  curriculum: {
    mode: 'major-fixed', termsPerYear: 2, creditsPerTerm: 12, creditsPerYear: 22,
    creditsToGraduate: 88, yearsToGraduate: 4, passGpa: 1.2, expelGpa: 0.6, expelDemerits: 9, maxElectivesPerTerm: 5,
  },
  majors: {
    evocation: { name: '塑能学派', desc: '操控元素，攻伐之道。',
      requiredByYear: { 1: ['m_fund', 'm_fire1'], 2: ['m_fire2'], 3: ['m_ward'], 4: ['m_field'] },
      requiredCourses: ['m_fund', 'm_fire1'] },
    conjuration: { name: '咒法学派', desc: '召唤与传送，奇术万千。',
      requiredByYear: { 1: ['m_fund', 'm_summon1'], 2: ['m_summon2'], 3: ['m_ward'], 4: ['m_field'] },
      requiredCourses: ['m_fund', 'm_summon1'] },
  },
  courses: {
    m_fund:    { name: '魔法基础理论', credits: 3, type: 'lecture', attr: 'intellect', prereqs: [], grants: { stats: { intellect: 2, mp: 6 } } },
    m_fire1:   { name: '初级塑能', credits: 4, type: 'training', attr: 'magicAttack', prereqs: ['m_fund'], grants: { stats: { magicAttack: 3 }, skills: ['火花术'] } },
    m_fire2:   { name: '高级塑能', credits: 4, type: 'training', attr: 'magicAttack', prereqs: ['m_fire1'], grants: { stats: { magicAttack: 4 }, skills: ['烈焰术'] } },
    m_summon1: { name: '初级咒法', credits: 4, type: 'training', attr: 'intellect', prereqs: ['m_fund'], grants: { stats: { intellect: 3 }, skills: ['召唤·小妖'] } },
    m_summon2: { name: '高级咒法', credits: 4, type: 'training', attr: 'intellect', prereqs: ['m_summon1'], grants: { stats: { intellect: 4 }, skills: ['召唤·石像'] } },
    m_ward:    { name: '防护与解咒', credits: 3, type: 'seminar', attr: 'magicDefense', prereqs: ['m_fund'], grants: { stats: { magicDefense: 3 }, skills: ['法盾术'] } },
    m_field:   { name: '野外秘境实习', credits: 5, type: 'practical', attr: 'luck', prereqs: ['m_ward'], grants: { stats: { luck: 1, mp: 8 } }, eventHook: 'academy_fieldwork' },
  },
  clubs: {
    club_alchemy: { name: '炼金研究会', activity: '调配药剂', eventHook: 'club_alchemy', perk: { stats: { intellect: 1, mp: 4 } } },
    club_duel:    { name: '决斗社', activity: '切磋法术', eventHook: 'club_duel', perk: { stats: { magicAttack: 1 } } },
  },
  rules: {
    no_forbidden: { name: '禁习禁咒', desc: '私习禁咒者，逐出师门。', penalty: { demerits: 5, severe: true } },
    no_duel:      { name: '禁止私斗', desc: '院内私自斗法，记过。', penalty: { demerits: 2 } },
    no_leave:     { name: '禁止擅离学院', desc: '未经许可离院，记过。', penalty: { demerits: 1 } },
  },
  exams: {
    midterm: { name: '学期评定', kind: 'exam', courses: 'enrolled', passScore: 60, failPenalty: null,
      rewardByRank: [{ maxRank: 1, reward: { stats: { mp: 6 } } }] },
    final:   { name: '晋级试炼', kind: 'exam', courses: 'enrolled', passScore: 60, failPenalty: 'retain',
      rewardByRank: [{ maxRank: 1, reward: { stats: { intellect: 1, magicAttack: 1 } } }] },
  },
  competitions: {
    cup: { name: '学院杯·魔法对抗', kind: 'competition', attr: 'magicAttack', rewardByRank: [
      { maxRank: 1, reward: { stats: { magicAttack: 2, mp: 8 }, skills: ['奥术涌动'] } },
      { maxRank: 3, reward: { stats: { magicAttack: 1 } } },
    ] },
    league: { name: '跨院魔法联赛', kind: 'competition', attr: 'magicAttack', fieldSize: 40, rewardByRank: [
      { maxRank: 1, reward: { stats: { magicAttack: 3, luck: 1 } } }, { maxRank: 5, reward: { stats: { magicAttack: 1 } } },
    ] },
  },
  roles: ['archmage', 'mentor', 'dean', 'classmate', 'roommate'],
  recruitAffinity: 60,
  narration: {
    settingTone: '一座漂浮于云端的古老魔法学院，塔楼藏书无数，学徒们钻研奥秘、彼此竞逐。',
    terms: { school: '学院', term: '学期', exam: '试炼', club: '研究会', demerit: '记过' },
  },
};

export default magicAcademySchema;
