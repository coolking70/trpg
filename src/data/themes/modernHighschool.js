/**
 * 学校主题包：现代高中（Phase 48 SC6）
 *
 * free-credits：自选课程修满学分升级/毕业。课程偏文化课（长智识）+ 体育/社会实践；
 * 社团丰富；校规含禁打架/禁逃课/禁早恋(可选)；考试=期中期末，竞赛=学科竞赛/校运会/高考。
 * 关系达标的同学/老师可于毕业时相约同行（招募）。
 */
export const modernHighschoolSchema = {
  name: '市立第一高中',
  curriculum: {
    mode: 'free-credits', termsPerYear: 2, creditsPerTerm: 14, creditsPerYear: 26,
    creditsToGraduate: 78, yearsToGraduate: 3, passGpa: 1.0, expelGpa: 0.4, expelDemerits: 10, maxElectivesPerTerm: 6,
  },
  majors: {
    science: { name: '理科方向', desc: '主攻数理化，备战理工。', requiredCourses: [] },
    liberal: { name: '文科方向', desc: '主攻文史政，备战文社。', requiredCourses: [] },
  },
  courses: {
    h_math:    { name: '数学', credits: 4, type: 'lecture', attr: 'intellect', prereqs: [], grants: { stats: { intellect: 2 } } },
    h_lang:    { name: '语文', credits: 3, type: 'lecture', attr: 'intellect', prereqs: [], grants: { stats: { intellect: 1, luck: 1 } } },
    h_eng:     { name: '英语', credits: 3, type: 'lecture', attr: 'intellect', prereqs: [], grants: { stats: { intellect: 1 } } },
    h_phys:    { name: '物理', credits: 4, type: 'lecture', attr: 'intellect', prereqs: ['h_math'], grants: { stats: { intellect: 2 } } },
    h_pe:      { name: '体育', credits: 2, type: 'training', attr: 'speed', prereqs: [], grants: { stats: { speed: 2, hp: 8 } } },
    h_art:     { name: '艺术鉴赏', credits: 2, type: 'seminar', attr: 'luck', prereqs: [], grants: { stats: { luck: 1 } } },
    h_volunteer: { name: '社会实践', credits: 4, type: 'practical', attr: 'luck', prereqs: [], grants: { stats: { luck: 1 } }, eventHook: 'hs_volunteer' },
  },
  clubs: {
    club_basketball: { name: '篮球社', activity: '训练比赛', eventHook: 'club_basketball', perk: { stats: { speed: 1, hp: 6 } } },
    club_lit:        { name: '文学社', activity: '创作投稿', eventHook: 'club_lit', perk: { stats: { intellect: 1 } } },
    club_student:    { name: '学生会', activity: '组织校务', eventHook: 'club_student', perk: { stats: { luck: 1 } } },
  },
  rules: {
    no_fight:  { name: '禁止打架斗殴', desc: '校内打架，记过、请家长。', penalty: { demerits: 3, severe: false } },
    no_truant: { name: '禁止逃课', desc: '无故旷课，记过。', penalty: { demerits: 2 } },
    no_cheat:  { name: '禁止考试作弊', desc: '作弊者成绩作废、记大过。', penalty: { demerits: 4, severe: true } },
  },
  exams: {
    midterm: { name: '期中考试', kind: 'exam', courses: 'enrolled', passScore: 60, failPenalty: null,
      rewardByRank: [{ maxRank: 3, reward: { stats: { luck: 1 } } }] },
    final:   { name: '期末考试', kind: 'exam', courses: 'enrolled', passScore: 60, failPenalty: 'retain',
      rewardByRank: [{ maxRank: 1, reward: { stats: { intellect: 1 } } }] },
  },
  competitions: {
    olympiad: { name: '学科竞赛', kind: 'competition', attr: 'intellect', fieldSize: 50, rewardByRank: [
      { maxRank: 1, reward: { stats: { intellect: 2, luck: 1 } } }, { maxRank: 10, reward: { stats: { intellect: 1 } } },
    ] },
    sports:   { name: '校运会', kind: 'competition', attr: 'speed', rewardByRank: [
      { maxRank: 1, reward: { stats: { speed: 2, hp: 10 } } }, { maxRank: 3, reward: { stats: { speed: 1 } } },
    ] },
    gaokao:   { name: '高考', kind: 'competition', attr: 'intellect', fieldSize: 100, rewardByRank: [
      { maxRank: 5, reward: { stats: { intellect: 2, luck: 2 } } }, { maxRank: 30, reward: { stats: { luck: 1 } } },
    ] },
  },
  roles: ['teacher', 'coach', 'principal', 'classmate', 'deskmate'],
  recruitAffinity: 55,
  narration: {
    settingTone: '一所普通的市立高中，晨读、晚自习、月考与社团活动构成青春的日常。',
    terms: { school: '学校', term: '学期', exam: '考试', club: '社团', demerit: '记过' },
  },
};

export default modernHighschoolSchema;
