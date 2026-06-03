/**
 * SchoolSystem 核心单测（Phase 48 SC2）
 */
import { SchoolSystem } from '../../src/systems/SchoolSystem.js';

// 轻量 stub gameEngine（仅 getSystem 用到 NPC/Event；这里返回 null 即可）
function mkSys() {
  const sys = new SchoolSystem();
  sys.rng = () => 0.5;
  sys.initialize({ getSystem: () => null });
  return sys;
}
function mkChar() {
  return { id: 'pc', name: '主角', stats: { intellect: 10, speed: 8, attack: 9, luck: 6, hp: 40, hpCurrent: 40 }, skills: [] };
}
function mkGS(extra = {}) {
  return { activeCharacters: [mkChar()], ...extra };
}

describe('初始化 / 选课 / 上课', () => {
  test('无 schoolSetup → 不建 schoolState（向后兼容）', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p' });
    expect(gs.schoolState).toBeNull();
    expect(gs.schoolSchema).toBeTruthy(); // schema 始终解析
  });

  test('有 schoolSetup → 建状态；选课遵守先修；上课授予属性并计学分', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: { schoolName: '青云学府' } });
    expect(gs.schoolState.schoolName).toBe('青云学府');

    expect(sys.electCourse(gs, 'c_field').ok).toBe(false); // 先修 c_letters 未满足
    expect(sys.electCourse(gs, 'c_letters').ok).toBe(true);

    const before = gs.activeCharacters[0].stats.intellect;
    const r = sys.attendClass(gs, 'c_letters');
    expect(r.ok).toBe(true);
    expect(gs.activeCharacters[0].stats.intellect).toBe(before + 2); // grants intellect+2
    expect(gs.schoolState.completed).toContain('c_letters');
    expect(r.credits).toBe(3);
    // 修毕 c_letters 后可选 c_field
    expect(sys.electCourse(gs, 'c_field').ok).toBe(true);
  });

  test('major-fixed 模式：选专业即固定必修课入选', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: { major: 'mage' }, schoolSchema: {
      curriculum: { mode: 'major-fixed' },
      majors: { mage: { name: '法师', requiredCourses: ['spell1'] } },
      courses: { spell1: { name: '咒文', credits: 4, type: 'lecture', attr: 'intellect', prereqs: [], grants: { stats: { intellect: 3 }, skills: ['fireball'] } } },
    } });
    expect(gs.schoolState.enrolled).toContain('spell1');
    const r = sys.attendClass(gs, 'spell1');
    expect(r.grants.skills).toContain('fireball');
    expect(gs.activeCharacters[0].skills).toContain('fireball');
  });
});

describe('社团 / 关系 / 考试 / 校规', () => {
  test('joinClub 授予 perk + 返回 eventHook', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: {} });
    const r = sys.joinClub(gs, 'club_athletics');
    expect(r.ok).toBe(true); expect(r.eventHook).toBe('club_athletics');
    expect(gs.activeCharacters[0].stats.hp).toBe(44); // perk hp+4
    expect(sys.joinClub(gs, 'club_athletics').ok).toBe(false); // 重复
  });

  test('adjustRelationship 累积、夹取', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: {} });
    sys.adjustRelationship(gs, 'npc_a', 40, 'roommate');
    const r = sys.adjustRelationship(gs, 'npc_a', 30);
    expect(r.affinity).toBe(70); expect(r.role).toBe('roommate');
  });

  test('takeExam：高属性更易过且得名次奖励；期末挂科 penalty=retain', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: {} });
    sys.electCourse(gs, 'c_letters');
    // 拔高智识 → 期末高分
    gs.activeCharacters[0].stats.intellect = 25;
    const good = sys.takeExam(gs, 'final');
    expect(good.passed).toBe(true);
    // 压低 → 挂科
    gs.activeCharacters[0].stats.intellect = 1;
    gs.schoolState.enrolled = ['c_letters'];
    const bad = sys.takeExam(gs, 'final');
    expect(bad.passed).toBe(false); expect(bad.penalty).toBe('retain');
  });

  test('violateRule：偷窃记大过 severe；累计 demerits', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: {} });
    const v = sys.violateRule(gs, 'no_theft');
    expect(v.severe).toBe(true); expect(v.totalDemerits).toBe(3);
    sys.violateRule(gs, 'no_fight');
    expect(gs.schoolState.demerits).toBe(5);
  });
});

describe('学期推进 / 招募 / 快照', () => {
  test('advanceTerm：学期内→升年级→留级→退学路径', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: {} });
    // term1 → term2
    let r = sys.advanceTerm(gs);
    expect(r.outcome).toBe('advance_term'); expect(gs.schoolState.term).toBe(2);
    // 学年末、学分不足 → 留级
    r = sys.advanceTerm(gs);
    expect(r.outcome).toBe('retain'); expect(gs.schoolState.retainCount).toBe(1);
  });

  test('graduateRecruit：仅关系达标者尝试入队（NPC 缺失则空）', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: {} });
    sys.adjustRelationship(gs, 'npc_a', 70, 'classmate');
    sys.adjustRelationship(gs, 'npc_b', 30);
    const r = sys.graduateRecruit(gs);
    expect(r.eligible).toEqual(['npc_a']); // 仅 a 达标
    expect(r.recruited).toEqual([]); // 无 NPCSystem → 招募失败但不报错
  });

  test('临时组队：活动期间并入、解散后撤出（不影响玩家与永久同伴）', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: {} });
    gs.activeCharacters.push({ id: 'perm', name: '挚友', _isCompanion: true, stats: { hp: 30, hpCurrent: 30 } });
    const r = sys.formTempParty(gs, [
      { id: 'tm1', name: '同窗甲', stats: { hp: 25, attack: 6, defense: 3 } },
      { name: '同窗乙', stats: { hp: 20, attack: 5, defense: 2 } },
    ]);
    expect(r.added.length).toBe(2);
    expect(gs.activeCharacters.length).toBe(4); // 玩家+永久+2临时
    expect(gs.activeCharacters.find(c => c.id === 'tm1')._temporary).toBe(true);
    const d = sys.disbandTempParty(gs);
    expect(d.removed).toContain('tm1');
    expect(gs.activeCharacters.map(c => c.id).sort()).toEqual(['pc', 'perm']); // 临时全撤、永久保留
  });

  test('期末挂科 → 学期推进时执行留级（pendingPenalty）', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: {} });
    sys.electCourse(gs, 'c_letters');
    gs.activeCharacters[0].stats.intellect = 1; // 必挂
    gs.schoolState.term = 2; // 学年末
    const ex = sys.takeExam(gs, 'final');
    expect(ex.passed).toBe(false);
    expect(gs.schoolState.pendingPenalty).toBe('retain');
    const adv = sys.advanceTerm(gs);
    expect(adv.outcome).toBe('retain');
    expect(gs.schoolState.pendingPenalty).toBeNull(); // 已结算清除
  });

  test('记过累计达阈值 → 退学；violateRule 报告纪律状态', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: {} });
    const v1 = sys.violateRule(gs, 'no_fight'); // +2
    expect(v1.discipline).toBe('warned');
    sys.violateRule(gs, 'no_fight'); // 4
    const v3 = sys.violateRule(gs, 'no_theft'); // +3 → 7 (>=5 half of 9) → probation
    expect(v3.discipline).toBe('probation');
    sys.violateRule(gs, 'no_fight'); // 9 → expulsion_pending
    gs.schoolState.term = 2;
    const adv = sys.advanceTerm(gs);
    expect(adv.outcome).toBe('expel');
  });

  test('竞赛（跨校联赛）：高属性夺魁得奖励', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: {} });
    gs.activeCharacters[0].stats.attack = 30;
    const before = gs.activeCharacters[0].stats.attack;
    const r = sys.takeExam(gs, 'interschool');
    expect(r.kind).toBe('competition');
    expect(r.reward).toBeTruthy(); // 夺得名次奖励
    expect(gs.activeCharacters[0].stats.attack).toBeGreaterThan(before);
  });

  test('snapshot 概览', () => {
    const sys = mkSys(); const gs = mkGS();
    sys.initFromPreset(gs, { id: 'p', schoolSetup: { schoolName: '青云' } });
    sys.electCourse(gs, 'c_letters'); sys.attendClass(gs, 'c_letters');
    const s = sys.snapshot(gs);
    expect(s.schoolName).toBe('青云'); expect(s.completedCount).toBe(1);
    expect(s.credits.earned).toBe(3); expect(s.year).toBe(1);
  });
});
