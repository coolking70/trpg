/**
 * 学校数据层单测（Phase 48 SC1）
 */
import {
  DEFAULT_SCHOOL_SCHEMA, earnedCredits, creditProgress, computeGpa, advanceOutcome,
  courseGrants, canElect, examOutcome, ruleViolation, eligibleRecruits,
  resolveSchoolSchema, schoolSchemaOf, makeSchoolState,
} from '../../src/data/school.js';

const S = DEFAULT_SCHOOL_SCHEMA;

describe('学分 / 升级 / 毕业 / 退学', () => {
  test('earnedCredits / creditProgress', () => {
    const st = makeSchoolState({}, S); st.completed = ['c_letters', 'c_athletics']; // 3+3
    expect(earnedCredits(st, S)).toBe(6);
    const p = creditProgress(st, S);
    expect(p.earned).toBe(6); expect(p.toGraduate).toBe(96); expect(p.remaining).toBe(90);
  });
  test('advanceOutcome：学期内推进 / 学年升级 / 学分不足留级 / 毕业 / 退学', () => {
    const mk = (over) => Object.assign(makeSchoolState({}, S), over);
    // 学期内（term1→2）
    expect(advanceOutcome(mk({ year: 1, term: 1 }), S).type).toBe('advance_term');
    // 学年末学分不足 → 留级
    expect(advanceOutcome(mk({ year: 1, term: 2, completed: [] }), S).type).toBe('retain');
    // 学年末学分够 → 升级（需 1*24=24 学分；凑满）
    const enough = mk({ year: 1, term: 2 });
    enough.completed = ['c_letters', 'c_athletics', 'c_combat', 'c_field', 'c_etiquette']; // 3+3+3+4+2=15? not enough
    // 直接灌足
    enough.courseGrades = { a: 3, b: 3 };
    enough._force = true;
    // 用一个有 24 学分的状态
    const big = mk({ year: 1, term: 2 });
    big.completed = Array(8).fill('c_letters'); // 8*3=24（重复计 credits，测纯学分逻辑）
    expect(advanceOutcome(big, S).type).toBe('promote');
    // 退学：GPA 崩
    const bad = mk({ year: 1, term: 2 }); bad.courseGrades = { x: 0.2 };
    expect(advanceOutcome(bad, S).type).toBe('expel');
  });
  test('computeGpa 取课程绩点均值', () => {
    const st = makeSchoolState({}, S); st.courseGrades = { a: 3, b: 4 };
    expect(computeGpa(st)).toBe(3.5);
  });
});

describe('课程 / 选课 / 授予', () => {
  test('courseGrants 返回属性/技能授予', () => {
    expect(courseGrants(S, 'c_letters').stats.intellect).toBe(2);
    expect(courseGrants(S, 'c_athletics').stats.hp).toBe(8);
  });
  test('canElect：先修门槛 / 已修 / 上限', () => {
    const st = makeSchoolState({}, S);
    expect(canElect(st, S, 'c_letters').ok).toBe(true);
    expect(canElect(st, S, 'c_field').ok).toBe(false); // 先修 c_letters 未满足
    st.completed = ['c_letters'];
    expect(canElect(st, S, 'c_field').ok).toBe(true);
    expect(canElect(st, S, 'c_letters').ok).toBe(false); // 已修
  });
});

describe('考试 / 校规 / 招募', () => {
  test('examOutcome：高属性更高分更靠前；可得奖励；低分不通过带惩罚', () => {
    const rng = () => 0.5;
    const good = examOutcome(20, S.exams.final, { rng, baseline: 10, fieldSize: 20 });
    expect(good.score).toBeGreaterThan(60); expect(good.passed).toBe(true); expect(good.rank).toBeLessThanOrEqual(20);
    const bad = examOutcome(2, S.exams.final, { rng, baseline: 10, fieldSize: 20 });
    expect(bad.passed).toBe(false); expect(bad.penalty).toBe('retain'); // 期末不过 → 留级
  });
  test('ruleViolation：偷窃记大过且 severe', () => {
    const v = ruleViolation(S, 'no_theft');
    expect(v.demerits).toBe(3); expect(v.severe).toBe(true);
    expect(ruleViolation(S, 'no_fight').severe).toBeFalsy();
  });
  test('eligibleRecruits：仅关系≥阈值', () => {
    const st = makeSchoolState({}, S);
    st.relationships = { n1: { role: 'classmate', affinity: 70 }, n2: { role: 'roommate', affinity: 40 } };
    const rec = eligibleRecruits(st, S);
    expect(rec.map(r => r.npcId)).toEqual(['n1']);
  });
});

describe('schema 解析（题材换皮）', () => {
  test('无覆盖=默认；表字段整张替换、curriculum 深合并', () => {
    expect(resolveSchoolSchema({}).name).toBe('学院');
    const r = resolveSchoolSchema({ schoolSchema: {
      name: '云霄魔法学院',
      curriculum: { mode: 'major-fixed', creditsToGraduate: 120 },
      courses: { spell101: { name: '咒文学', credits: 4, type: 'lecture', attr: 'intellect', prereqs: [], grants: { stats: { intellect: 3 }, skills: ['fireball'] } } },
    } });
    expect(r.name).toBe('云霄魔法学院');
    expect(r.curriculum.mode).toBe('major-fixed');
    expect(r.curriculum.creditsToGraduate).toBe(120);
    expect(r.curriculum.termsPerYear).toBe(2);       // 未覆盖项继承默认
    expect(r.courses.spell101).toBeTruthy();
    expect(r.courses.c_letters).toBeUndefined();      // 课程表整张替换
  });
  test('schoolSchemaOf 缺省回退 + makeSchoolState 初值', () => {
    expect(schoolSchemaOf(null).name).toBe('学院');
    const st = makeSchoolState({ schoolName: '蓝翔', major: 'general' }, S);
    expect(st.schoolName).toBe('蓝翔'); expect(st.status).toBe('enrolled'); expect(st.year).toBe(1);
  });
});
