/**
 * 学校系统数据层（Phase 48）—— 纯函数 + 可换皮 schoolSchema。
 *
 * 与战略系统同为**可选模块**：剧本含 schoolSetup（或 modules.school）才激活；
 * 机制引擎通用，题材（魔法学院/武道馆/现代高中…）只是数据。
 *
 * 复用既有系统：属性/技能成长走 ProgressionSystem；人际关系走 NPCSystem；
 * 特殊剧情走事件系统（requireSchoolState 门控）；竞赛对抗可走个人战/军团战。
 */

// ============================================================
// 默认学校 Schema（= 通用学院；剧本可经 preset.schoolSchema 覆盖部分/全部字段）
// ============================================================

/** 课程类型：lecture 讲授(偏智识) / training 训练(偏体技) / practical 实践(触发事件) / seminar 研讨 */
export const DEFAULT_SCHOOL_SCHEMA = {
  name: '学院',
  // 课程模式：major-fixed = 选专业后课程固定；free-credits = 自选课程、修满学分升级/毕业
  curriculum: {
    mode: 'free-credits',
    termsPerYear: 2,
    creditsPerTerm: 12,          // 每学期建议修读学分
    creditsPerYear: 24,          // 升年级所需累计（每学年）
    creditsToGraduate: 96,       // 毕业总学分
    yearsToGraduate: 4,
    passGpa: 1.0,                // 低于此 → 留级风险
    expelGpa: 0.5,               // 远低于此（或多次留级/重大违纪）→ 退学
    maxElectivesPerTerm: 5,
  },
  // 专业（major-fixed 模式用 fixedCourses；free-credits 模式 major 仅作方向/必修标记）
  majors: {
    general: { name: '通识', desc: '不限方向，自由选课。', requiredCourses: [] },
  },
  // 课程：credits 学分；grants 修毕授予（属性/技能）；attr 考试主属性；prereqs 先修
  courses: {
    c_letters: { name: '文理基础', credits: 3, type: 'lecture', attr: 'intellect', prereqs: [], grants: { stats: { intellect: 2 } } },
    c_athletics: { name: '体格训练', credits: 3, type: 'training', attr: 'speed', prereqs: [], grants: { stats: { speed: 1, hp: 8 } } },
    c_combat: { name: '搏击入门', credits: 3, type: 'training', attr: 'attack', prereqs: [], grants: { stats: { attack: 2 } } },
    c_etiquette: { name: '礼仪修养', credits: 2, type: 'seminar', attr: 'luck', prereqs: [], grants: { stats: { luck: 1 } } },
    c_field: { name: '校外实践', credits: 4, type: 'practical', attr: 'luck', prereqs: ['c_letters'], grants: { stats: { luck: 1 } }, eventHook: 'school_practical' },
  },
  // 社团：参与触发事件 + 长期增益
  clubs: {
    club_athletics: { name: '运动社', activity: '操练切磋', eventHook: 'club_athletics', perk: { stats: { hp: 4 } } },
    club_arts: { name: '文艺社', activity: '采风创作', eventHook: 'club_arts', perk: { stats: { luck: 1 } } },
  },
  // 校规：违反 → 惩罚（demerit 记过分；severe 重大违纪累计可致退学）
  rules: {
    no_theft: { name: '禁止偷窃', desc: '校内偷窃者，记大过、追责。', penalty: { demerits: 3, severe: true } },
    no_fight: { name: '禁止斗殴', desc: '校内私斗，记过、禁足。', penalty: { demerits: 2 } },
    no_leave: { name: '禁止擅自离校', desc: '未经许可离校，记过。', penalty: { demerits: 1 } },
  },
  // 考试与竞赛：rewardByRank 名次奖励；failPenalty 不通过惩罚（'retain' 留级 / 'expel' 退学 / null 无）
  exams: {
    midterm: { name: '期中考', kind: 'exam', courses: 'enrolled', passScore: 60, failPenalty: null,
      rewardByRank: [{ maxRank: 1, reward: { stats: { luck: 1 } } }] },
    final: { name: '期末考', kind: 'exam', courses: 'enrolled', passScore: 60, failPenalty: 'retain',
      rewardByRank: [{ maxRank: 1, reward: { stats: { intellect: 1 } } }] },
  },
  competitions: {
    interschool: { name: '跨校联赛', kind: 'competition', attr: 'attack', rewardByRank: [
      { maxRank: 1, reward: { stats: { attack: 2, luck: 1 } } }, { maxRank: 3, reward: { stats: { attack: 1 } } },
    ] },
  },
  // 校内人际角色（绑定到 NPC）
  roles: ['teacher', 'coach', 'principal', 'classmate', 'roommate'],
  recruitAffinity: 60, // 毕业时关系≥此值可招募
  narration: {
    settingTone: '一所传授知识与技艺的学院，课业、社团、师友与校规交织其间。',
    terms: { school: '学院', term: '学期', exam: '考试', club: '社团', demerit: '记过' },
  },
};

// ============================================================
// 学分 / 升级 / 毕业 / 退学
// ============================================================

/** 累计已修学分（completed 课程的 credits 之和） */
export function earnedCredits(schoolState, schema) {
  const courses = schema.courses || {};
  return (schoolState.completed || []).reduce((s, cid) => s + (courses[cid]?.credits || 0), 0);
}

/** 学分进度概览 */
export function creditProgress(schoolState, schema) {
  const cur = schema.curriculum || {};
  const earned = earnedCredits(schoolState, schema);
  return {
    earned,
    toGraduate: cur.creditsToGraduate || 0,
    forNextYear: (schoolState.year || 1) * (cur.creditsPerYear || 0),
    remaining: Math.max(0, (cur.creditsToGraduate || 0) - earned),
  };
}

/** GPA：completed 课程平均绩点（每课 0-4，由 examResults/默认 2.0 推导，简化为按成绩） */
export function computeGpa(schoolState) {
  const grades = schoolState.courseGrades || {}; // courseId -> 0..4
  const vals = Object.values(grades);
  if (!vals.length) return schoolState.gpa ?? 2.0;
  return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
}

/**
 * 学期/学年推进结局判定（升级/毕业/留级/退学）。
 * @returns {{ type:'graduate'|'promote'|'advance_term'|'retain'|'expel', toYear?, toTerm?, reason }}
 */
export function advanceOutcome(schoolState, schema) {
  const cur = schema.curriculum || {};
  const earned = earnedCredits(schoolState, schema);
  const gpa = computeGpa(schoolState);
  const year = schoolState.year || 1, term = schoolState.term || 1;
  const termsPerYear = cur.termsPerYear || 2;

  // 退学：GPA 崩 或 重大违纪累计
  const severeViolations = (schoolState.violations || []).filter(v => v.severe).length;
  if (gpa < (cur.expelGpa ?? 0.5) || severeViolations >= 3 || (schoolState.retainCount || 0) >= 2) {
    return { type: 'expel', reason: gpa < (cur.expelGpa ?? 0.5) ? '学业不振，绩点过低' : '屡犯校规/多次留级' };
  }
  // 学期内推进
  if (term < termsPerYear) {
    return { type: 'advance_term', toYear: year, toTerm: term + 1, reason: '学期更替' };
  }
  // 学年末：看是否够学分升级
  const neededForNext = year * (cur.creditsPerYear || 0);
  if (earned < neededForNext || gpa < (cur.passGpa ?? 1.0)) {
    return { type: 'retain', reason: earned < neededForNext ? '学分不足' : '绩点未达标' };
  }
  // 毕业
  if (year >= (cur.yearsToGraduate || 4) && earned >= (cur.creditsToGraduate || 0)) {
    return { type: 'graduate', reason: '修业期满、学分达标' };
  }
  return { type: 'promote', toYear: year + 1, toTerm: 1, reason: '学年升级' };
}

// ============================================================
// 课程效果 / 考试 / 校规 / 招募（纯函数，返回"意图"，由 System 落到角色/状态）
// ============================================================

/** 课程修毕授予（属性/技能）。返回 { stats:{}, skills:[] } */
export function courseGrants(schema, courseId) {
  const c = (schema.courses || {})[courseId];
  if (!c || !c.grants) return { stats: {}, skills: [] };
  return { stats: { ...(c.grants.stats || {}) }, skills: [...(c.grants.skills || [])] };
}

/** 选课合法性：先修是否满足、是否超本学期上限、是否已修 */
export function canElect(schoolState, schema, courseId) {
  const c = (schema.courses || {})[courseId];
  if (!c) return { ok: false, reason: '无此课程' };
  if ((schoolState.completed || []).includes(courseId)) return { ok: false, reason: '已修毕' };
  if ((schoolState.enrolled || []).includes(courseId)) return { ok: false, reason: '本学期已选' };
  const max = schema.curriculum?.maxElectivesPerTerm ?? 99;
  if ((schoolState.enrolled || []).length >= max) return { ok: false, reason: '本学期选课已满' };
  for (const p of (c.prereqs || [])) {
    if (!(schoolState.completed || []).includes(p)) return { ok: false, reason: `先修未满足：${(schema.courses[p]?.name) || p}` };
  }
  return { ok: true };
}

/**
 * 考试/竞赛结局：依考生在相关属性上的表现 + rng → 分数/名次/通过/奖励/惩罚。
 * @param {number} attrValue 考生主属性值
 * @param {object} examDef 考试/竞赛定义
 * @param {object} opts { rng, fieldSize=排名总人数, baseline=平均属性 }
 */
export function examOutcome(attrValue, examDef = {}, opts = {}) {
  const rng = opts.rng || Math.random;
  const fieldSize = opts.fieldSize || 20;
  const baseline = opts.baseline || 10;
  // 分数：属性相对基线 + 随机波动，夹 0-100
  const raw = 50 + (attrValue - baseline) * 4 + (rng() - 0.5) * 40;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  // 名次：分数越高名次越靠前（1=最好）
  const rank = Math.max(1, Math.min(fieldSize, Math.round(fieldSize * (1 - score / 100)) + 1));
  const passed = score >= (examDef.passScore ?? 60);
  let reward = null;
  for (const tier of (examDef.rewardByRank || [])) {
    if (rank <= tier.maxRank) { reward = tier.reward; break; }
  }
  const penalty = !passed ? (examDef.failPenalty || null) : null;
  return { score, rank, fieldSize, passed, reward, penalty };
}

/** 校规违纪惩罚 */
export function ruleViolation(schema, ruleId) {
  const r = (schema.rules || {})[ruleId];
  if (!r) return null;
  return { ruleId, name: r.name, demerits: r.penalty?.demerits || 1, severe: !!r.penalty?.severe, desc: r.desc || '' };
}

/** 毕业/离校时可招募的关系（affinity≥阈值的同窗/师友） */
export function eligibleRecruits(schoolState, schema) {
  const th = schema.recruitAffinity ?? 60;
  return Object.entries(schoolState.relationships || {})
    .filter(([, r]) => (r.affinity || 0) >= th)
    .map(([npcId, r]) => ({ npcId, role: r.role, affinity: r.affinity }));
}

// ============================================================
// Schema 解析（题材可换皮：preset.schoolSchema 覆盖默认）
// ============================================================

const SCHOOL_TABLE_FIELDS = ['majors', 'courses', 'clubs', 'rules', 'exams', 'competitions'];
const SCHOOL_SCALAR_FIELDS = ['name', 'recruitAffinity', 'roles'];

/** 深合并 preset.schoolSchema 于默认：curriculum/narration 逐项合并；表字段整张替换；标量覆盖。 */
export function resolveSchoolSchema(preset) {
  const over = (preset && preset.schoolSchema) || {};
  const out = { ...DEFAULT_SCHOOL_SCHEMA };
  out.curriculum = { ...DEFAULT_SCHOOL_SCHEMA.curriculum, ...(over.curriculum || {}) };
  out.narration = { ...DEFAULT_SCHOOL_SCHEMA.narration, ...(over.narration || {}),
    terms: { ...(DEFAULT_SCHOOL_SCHEMA.narration.terms || {}), ...((over.narration || {}).terms || {}) } };
  for (const f of SCHOOL_TABLE_FIELDS) if (over[f] != null) out[f] = over[f];
  for (const f of SCHOOL_SCALAR_FIELDS) if (over[f] != null) out[f] = over[f];
  return out;
}

/** 从 gameState 取学校 Schema（缺省回退默认；System 在 init 时挂 gameState.schoolSchema） */
export function schoolSchemaOf(gameState) {
  return (gameState && gameState.schoolSchema) || DEFAULT_SCHOOL_SCHEMA;
}

/** 新建一份学校活状态（enroll 时用）。setup 提供 schoolId/name/major/起始年级 */
export function makeSchoolState(setup = {}, schema = DEFAULT_SCHOOL_SCHEMA) {
  return {
    schoolId: setup.schoolId || 'school',
    schoolName: setup.schoolName || schema.name || '学院',
    major: setup.major || Object.keys(schema.majors || { general: 1 })[0],
    role: 'student',
    year: setup.year || 1,
    term: setup.term || 1,
    enrolled: [],            // 本学期所选课程
    completed: [],           // 已修毕课程
    courseGrades: {},        // courseId -> 绩点 0..4
    clubs: [],
    demerits: 0,
    violations: [],          // [{ruleId,name,severe}]
    retainCount: 0,
    examResults: [],         // [{exam,rank,score,passed}]
    relationships: {},       // npcId -> {role, affinity}
    status: 'enrolled',      // enrolled | graduated | dropout | expelled
    gpa: 2.0,
  };
}

