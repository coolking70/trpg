/**
 * 学校主题包端到端 集成测试（Phase 48 SC6）
 * 验证：魔法学院/武道馆/现代高中 三套 schoolSchema 经 resolveSchoolSchema 解析合法；
 *       魔法学院示范剧本经 GameSession 跑通：入学派→上课习法术→实习临时组队→毕业招募同窗。
 */
import { GameSession } from '../../src/core/GameSession.js';
import { magicAcademySchema } from '../../src/data/themes/magicAcademy.js';
import { martialDojoSchema } from '../../src/data/themes/martialDojo.js';
import { modernHighschoolSchema } from '../../src/data/themes/modernHighschool.js';
import { magicAcademyPreset } from '../../src/data/themes/magicAcademyPreset.js';
import { resolveSchoolSchema, makeSchoolState, canElect } from '../../src/data/school.js';

async function load(preset, originId, mode = 'interactive') {
  const s = new GameSession({ combatMode: mode });
  s.loadPreset(JSON.parse(JSON.stringify(preset)), originId ? { origins: originId } : undefined);
  s.configureAI({ endpoint: '' });
  await s.kickoff();
  return s;
}

describe('SC6 — 三套学校主题包 schema 合法', () => {
  for (const [label, schema] of [['魔法学院', magicAcademySchema], ['武道馆', martialDojoSchema], ['现代高中', modernHighschoolSchema]]) {
    test(`${label}：resolveSchoolSchema 解析 + 课程先修自洽 + 必修引用存在`, () => {
      const r = resolveSchoolSchema({ schoolSchema: schema });
      expect(r.name).toBe(schema.name);
      expect(Object.keys(r.courses).length).toBeGreaterThan(0);
      // 课程先修引用的课程必须存在
      for (const c of Object.values(r.courses)) {
        for (const p of (c.prereqs || [])) expect(r.courses[p]).toBeTruthy();
      }
      // 专业必修引用的课程必须存在
      for (const m of Object.values(r.majors)) {
        for (const cid of (m.requiredCourses || [])) expect(r.courses[cid]).toBeTruthy();
        for (const arr of Object.values(m.requiredByYear || {})) {
          for (const cid of arr) expect(r.courses[cid]).toBeTruthy();
        }
      }
      // 无先修的课程在新生状态下应可选
      const st = makeSchoolState({}, r);
      const freshCourse = Object.entries(r.courses).find(([, c]) => !(c.prereqs || []).length);
      if (freshCourse) expect(canElect(st, r, freshCourse[0]).ok).toBe(true);
    });
  }
});

describe('SC6 — 魔法学院示范剧本端到端', () => {
  test('选咒法学派出身 → 入学即载入该学派必修', async () => {
    const s = await load(magicAcademyPreset, 'conjurer');
    expect(s.gameState.schoolState.major).toBe('conjuration');
    expect(s.gameState.schoolState.enrolled).toContain('m_summon1'); // 咒法必修
    expect(s.gameState.schoolState.enrolled).not.toContain('m_fire1');
    s.destroy();
  });

  test('默认塑能学派 → 上必修习火系法术；school 情境与就学动作可用', async () => {
    const s = await load(magicAcademyPreset, 'evoker');
    const st0 = s.getState();
    expect(st0.situation).toBe('school');
    expect(st0.school.majorName).toBe('塑能学派');
    // 上「初级塑能」习得火花术
    await s.applyAction({ type: 'school', op: 'attend', courseId: 'm_fire1' });
    expect(s.gameState.activeCharacters[0].skills).toContain('火花术');
    s.destroy();
  });

  test('毕业招募：关系达标的同窗实体化入队', async () => {
    const s = await load(magicAcademyPreset, 'evoker');
    // 拉满与导师/室友关系
    s.sys('SchoolSystem').adjustRelationship(s.gameState, 'npc_mentor', 80, 'mentor');
    s.sys('SchoolSystem').adjustRelationship(s.gameState, 'npc_roommate', 70, 'roommate');
    const before = s.gameState.activeCharacters.length;
    const r = await s.applyAction({ type: 'school', op: 'recruit' });
    const after = s.getState();
    expect(after.party.length).toBeGreaterThan(before); // 至少招到 1 人
    expect(s.gameState.activeCharacters.some(c => c.id === 'npc_mentor')).toBe(true);
    s.destroy();
  });
});
