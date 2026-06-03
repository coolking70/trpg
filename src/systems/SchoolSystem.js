/**
 * 学校系统（Phase 48）—— 在校就学的运行时（可选模块）。
 *
 * 把 `preset.schoolSetup`（活状态种子）/ `preset.schoolSchema`（题材数据）初始化为
 * `gameState.schoolState`。无任何学校数据 → 不建 schoolState（向后兼容，普通剧本零影响）。
 *
 * 提供原语：注册入学、选专业、选课、上课（修毕授予属性/技能）、参加社团、
 *   考试/竞赛（名次→奖励，挂科→留级/退学）、违纪（记过/重大违纪）、
 *   学期推进（升级/留级/毕业/退学）、毕业招募（关系好的师友同窗入队）。
 *
 * 复用既有系统：属性/技能成长直接改角色卡 stats/skills；人际关系镜像 NPCSystem.affection；
 *   毕业招募走 NPCSystem.recruitCompanion；特殊剧情走事件系统（requireSchoolState 门控）。
 *
 * 时钟：学校自有 year/term 推进，不与战略季/旬耦合（除非剧本两者并用）。
 */

import { GameSystem } from '../core/GameEngine.js';
import {
  DEFAULT_SCHOOL_SCHEMA, resolveSchoolSchema, makeSchoolState,
  earnedCredits, creditProgress, computeGpa, advanceOutcome,
  courseGrants, canElect, examOutcome, ruleViolation, eligibleRecruits,
} from '../data/school.js';

export class SchoolSystem extends GameSystem {
  constructor() {
    super('SchoolSystem');
    this.eventSystem = null;
    this.npcSystem = null;
    this.rng = Math.random;
  }
  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.eventSystem = gameEngine.getSystem('EventSystem');
    this.npcSystem = gameEngine.getSystem('NPCSystem');
  }

  // ============================================================
  // 初始化
  // ============================================================
  initFromPreset(gameState, preset) {
    if (!preset) return null;
    // 始终解析 Schema 并挂 gameState（缺省=通用学院），供 System/UI/叙述读取
    gameState.schoolSchema = resolveSchoolSchema(preset);
    const setup = preset.schoolSetup || null;
    if (!setup) { gameState.schoolState = null; return null; }

    const st = makeSchoolState(setup, gameState.schoolSchema);
    // 种子覆盖（剧本可指定起始年级/已修课程/初始关系等）
    if (Array.isArray(setup.completed)) st.completed = [...setup.completed];
    if (Array.isArray(setup.enrolled)) st.enrolled = [...setup.enrolled];
    if (setup.relationships && typeof setup.relationships === 'object') {
      st.relationships = JSON.parse(JSON.stringify(setup.relationships));
    }
    if (setup.major) st.major = setup.major;
    // major-fixed 模式：选专业即固定必修课为本学期 enrolled
    const schema = gameState.schoolSchema;
    if (schema.curriculum?.mode === 'major-fixed' && st.major) {
      const fixed = schema.majors?.[st.major]?.requiredCourses || [];
      st.enrolled = [...new Set([...(st.enrolled || []), ...fixed])];
    }
    gameState.schoolState = st;
    return st;
  }

  // 便捷取数
  schema(gameState) { return gameState.schoolSchema || DEFAULT_SCHOOL_SCHEMA; }
  state(gameState) { return gameState.schoolState || null; }
  player(gameState) { return (gameState.activeCharacters || [])[0] || null; }

  // ============================================================
  // 选专业 / 选课
  // ============================================================
  chooseMajor(gameState, majorId) {
    const st = this.state(gameState); const schema = this.schema(gameState);
    if (!st) return { ok: false, reason: '未入学' };
    if (!schema.majors?.[majorId]) return { ok: false, reason: '无此专业/方向' };
    st.major = majorId;
    if (schema.curriculum?.mode === 'major-fixed') {
      const fixed = schema.majors[majorId].requiredCourses || [];
      st.enrolled = [...new Set([...(st.enrolled || []), ...fixed])];
    }
    return { ok: true, major: majorId, name: schema.majors[majorId].name, enrolled: [...st.enrolled] };
  }

  electCourse(gameState, courseId) {
    const st = this.state(gameState); const schema = this.schema(gameState);
    if (!st) return { ok: false, reason: '未入学' };
    const chk = canElect(st, schema, courseId);
    if (!chk.ok) return chk;
    st.enrolled.push(courseId);
    return { ok: true, courseId, name: schema.courses[courseId]?.name, enrolled: [...st.enrolled] };
  }

  dropCourse(gameState, courseId) {
    const st = this.state(gameState);
    if (!st) return { ok: false, reason: '未入学' };
    const i = (st.enrolled || []).indexOf(courseId);
    if (i < 0) return { ok: false, reason: '本学期未选此课' };
    st.enrolled.splice(i, 1);
    return { ok: true, courseId };
  }

  // ============================================================
  // 上课：修读所选课程，达成则修毕、授予属性/技能、计绩点
  //   attend 一门课会推进该课进度；这里采用"一次上课=修毕一门"的简化（每学期数门课）。
  // ============================================================
  attendClass(gameState, courseId, opts = {}) {
    const st = this.state(gameState); const schema = this.schema(gameState);
    if (!st) return { ok: false, reason: '未入学' };
    if (!(st.enrolled || []).includes(courseId)) return { ok: false, reason: '本学期未选此课' };
    if ((st.completed || []).includes(courseId)) return { ok: false, reason: '已修毕' };

    const course = schema.courses[courseId] || {};
    const grants = courseGrants(schema, courseId);
    const char = this.player(gameState);
    const applied = this._applyGrants(char, grants);

    // 绩点：依主属性表现产出 0-4（受随机轻微波动）；practical 类略高方差
    const attr = char?.stats?.[course.attr] ?? 10;
    const grade = this._gradeFor(attr, opts.rng || this.rng);
    st.courseGrades[courseId] = grade;

    // 修毕
    st.enrolled = st.enrolled.filter(c => c !== courseId);
    st.completed.push(courseId);
    st.gpa = computeGpa(st);

    return {
      ok: true, courseId, name: course.name, type: course.type,
      grants: applied, grade, gpa: st.gpa,
      eventHook: course.eventHook || null, // practical/实践课可触发剧情
      credits: earnedCredits(st, schema),
    };
  }

  _gradeFor(attr, rng) {
    // 主属性 ~10 基线给约 2.5 绩点；越高越好，夹 0-4
    const base = 1.5 + (attr - 10) * 0.18 + (rng() - 0.5) * 1.2;
    return +Math.max(0, Math.min(4, base)).toFixed(1);
  }

  _applyGrants(char, grants) {
    if (!char) return { stats: {}, skills: [] };
    char.stats = char.stats || {};
    const appliedStats = {};
    for (const [k, v] of Object.entries(grants.stats || {})) {
      char.stats[k] = (char.stats[k] || 0) + v;
      appliedStats[k] = v;
      // hp/mp 上限增长同步当前值
      if (k === 'hp') char.stats.hpCurrent = (char.stats.hpCurrent || char.stats.hp);
      if (k === 'mp') char.stats.mpCurrent = (char.stats.mpCurrent || char.stats.mp);
    }
    const appliedSkills = [];
    if (grants.skills?.length) {
      char.skills = char.skills || [];
      for (const sk of grants.skills) {
        if (!char.skills.includes(sk)) { char.skills.push(sk); appliedSkills.push(sk); }
      }
    }
    return { stats: appliedStats, skills: appliedSkills };
  }

  // ============================================================
  // 社团
  // ============================================================
  joinClub(gameState, clubId) {
    const st = this.state(gameState); const schema = this.schema(gameState);
    if (!st) return { ok: false, reason: '未入学' };
    const club = schema.clubs?.[clubId];
    if (!club) return { ok: false, reason: '无此社团' };
    if (st.clubs.includes(clubId)) return { ok: false, reason: '已加入' };
    st.clubs.push(clubId);
    // 长期增益（perk）即时授予
    const applied = this._applyGrants(this.player(gameState), { stats: club.perk?.stats || {}, skills: club.perk?.skills || [] });
    return { ok: true, clubId, name: club.name, activity: club.activity, perk: applied, eventHook: club.eventHook || null };
  }

  // ============================================================
  // 人际关系（镜像 NPCSystem 好感；school 内自有 relationships 便于招募判定）
  // ============================================================
  adjustRelationship(gameState, npcId, delta, role = null) {
    const st = this.state(gameState);
    if (!st) return { ok: false, reason: '未入学' };
    const r = st.relationships[npcId] || { role: role || 'classmate', affinity: 0 };
    if (role) r.role = role;
    r.affinity = Math.max(-100, Math.min(100, (r.affinity || 0) + delta));
    st.relationships[npcId] = r;
    // 镜像到 NPCSystem（若该 NPC 已注册）
    try { this.npcSystem?.changeAffection?.(gameState, npcId, delta); } catch { /* */ }
    return { ok: true, npcId, role: r.role, affinity: r.affinity };
  }

  // ============================================================
  // 考试 / 竞赛
  // ============================================================
  takeExam(gameState, examId, opts = {}) {
    const st = this.state(gameState); const schema = this.schema(gameState);
    if (!st) return { ok: false, reason: '未入学' };
    const def = schema.exams?.[examId] || schema.competitions?.[examId];
    if (!def) return { ok: false, reason: '无此考试/竞赛' };
    const char = this.player(gameState);
    // 主属性：考试取各在修课程主属性均值（或定义指定 attr）；竞赛取 def.attr
    const attrVal = this._examAttr(char, st, schema, def);
    const out = examOutcome(attrVal, def, {
      rng: opts.rng || this.rng,
      fieldSize: opts.fieldSize || def.fieldSize || 20,
      baseline: opts.baseline ?? 10,
    });
    st.examResults.push({ exam: examId, name: def.name, kind: def.kind, score: out.score, rank: out.rank, passed: out.passed });

    // 名次奖励
    let rewardApplied = null;
    if (out.reward) rewardApplied = this._applyGrants(char, { stats: out.reward.stats || {}, skills: out.reward.skills || [] });

    return {
      ok: true, examId, name: def.name, kind: def.kind,
      score: out.score, rank: out.rank, fieldSize: out.fieldSize, passed: out.passed,
      reward: rewardApplied, penalty: out.penalty, // 'retain' | 'expel' | null
    };
  }

  _examAttr(char, st, schema, def) {
    if (def.attr) return char?.stats?.[def.attr] ?? 10;
    // 'enrolled' / 'completed' 的课程主属性均值
    const pool = def.courses === 'completed' ? st.completed : st.enrolled;
    const attrs = (pool || []).map(cid => schema.courses[cid]?.attr).filter(Boolean);
    if (!attrs.length) return char?.stats?.intellect ?? 10;
    const sum = attrs.reduce((s, a) => s + (char?.stats?.[a] ?? 10), 0);
    return sum / attrs.length;
  }

  // ============================================================
  // 校规违纪
  // ============================================================
  violateRule(gameState, ruleId) {
    const st = this.state(gameState); const schema = this.schema(gameState);
    if (!st) return { ok: false, reason: '未入学' };
    const v = ruleViolation(schema, ruleId);
    if (!v) return { ok: false, reason: '无此校规' };
    st.demerits = (st.demerits || 0) + v.demerits;
    st.violations.push({ ruleId: v.ruleId, name: v.name, severe: v.severe });
    return { ok: true, ...v, totalDemerits: st.demerits };
  }

  // ============================================================
  // 学期推进：判定升级/留级/毕业/退学，并落状态
  // ============================================================
  advanceTerm(gameState, opts = {}) {
    const st = this.state(gameState); const schema = this.schema(gameState);
    if (!st) return { ok: false, reason: '未入学' };
    const outcome = advanceOutcome(st, schema);
    const before = { year: st.year, term: st.term };

    if (outcome.type === 'advance_term') {
      st.term = outcome.toTerm;
    } else if (outcome.type === 'promote') {
      st.year = outcome.toYear; st.term = outcome.toTerm;
      // major-fixed：新学年载入下一批必修
      this._loadFixedForYear(st, schema);
    } else if (outcome.type === 'retain') {
      st.retainCount = (st.retainCount || 0) + 1;
      st.term = 1; // 重读本学年
    } else if (outcome.type === 'graduate') {
      st.status = 'graduated'; st.role = 'graduate';
    } else if (outcome.type === 'expel') {
      st.status = 'expelled'; st.role = 'former';
    }
    // 学年/学期更替时清空本学期未修完的选课（保留 completed）
    if (outcome.type !== 'advance_term' || opts.clearEnrolled) {
      // advance_term 默认保留在修课程；升级/留级清空重选
    }
    if (outcome.type === 'promote' || outcome.type === 'retain') st.enrolled = [];
    st.gpa = computeGpa(st);
    return { ok: true, outcome: outcome.type, reason: outcome.reason, before, after: { year: st.year, term: st.term }, status: st.status };
  }

  _loadFixedForYear(st, schema) {
    if (schema.curriculum?.mode !== 'major-fixed') return;
    const major = schema.majors?.[st.major];
    if (!major) return;
    const byYear = major.requiredByYear?.[st.year] || major.requiredCourses || [];
    st.enrolled = [...new Set(byYear.filter(c => !(st.completed || []).includes(c)))];
  }

  // ============================================================
  // 离校招募：关系达标的师友同窗可入队
  // ============================================================
  graduateRecruit(gameState, npcIds = null) {
    const st = this.state(gameState); const schema = this.schema(gameState);
    if (!st) return { ok: false, reason: '未入学' };
    const eligible = eligibleRecruits(st, schema);
    const pool = npcIds ? eligible.filter(e => npcIds.includes(e.npcId)) : eligible;
    const recruited = [];
    for (const e of pool) {
      let ok = false;
      try { ok = !!this.npcSystem?.recruitCompanion?.(gameState, e.npcId); } catch { /* */ }
      if (ok) { this._materializeCompanion(gameState, e.npcId); recruited.push(e.npcId); }
    }
    return { ok: true, recruited, eligible: eligible.map(e => e.npcId) };
  }

  /** 把已招募 NPC 实体化为可参战的队伍成员（与 GameSession recruit_companion 同口径） */
  _materializeCompanion(gameState, npcId) {
    const npc = this.npcSystem?.getNPC?.(npcId);
    if (!npc || !npc.stats) return false;
    if ((gameState.activeCharacters || []).some(c => c.id === npcId)) return false;
    const slot = JSON.parse(JSON.stringify(npc));
    slot._isCompanion = true; slot.type = 'character';
    slot.stats.hpCurrent = slot.stats.hp; slot.stats.mpCurrent = slot.stats.mp || 0;
    gameState.activeCharacters = gameState.activeCharacters || [];
    gameState.activeCharacters.push(slot);
    return true;
  }

  // ============================================================
  // 临时组队（课程/活动/任务的同伴）：参与期间并入队伍，结束后撤出（不永久入队）
  //   members: [{ id, name, stats:{...}, abilities? }]（或 NPC id 字符串：从 NPCSystem 取卡）
  // ============================================================
  formTempParty(gameState, members = []) {
    gameState.activeCharacters = gameState.activeCharacters || [];
    gameState._tempPartyIds = gameState._tempPartyIds || [];
    const added = [];
    for (const m of members) {
      let def = null;
      if (typeof m === 'string') { const npc = this.npcSystem?.getNPC?.(m); if (npc?.stats) def = JSON.parse(JSON.stringify(npc)); }
      else if (m && m.stats) def = JSON.parse(JSON.stringify(m));
      if (!def) continue;
      def.id = def.id || `temp_${Math.random().toString(36).slice(2, 8)}`;
      if ((gameState.activeCharacters).some(c => c.id === def.id)) continue;
      def._isCompanion = true; def._temporary = true; def.type = 'character';
      def.stats.hpCurrent = def.stats.hp; def.stats.mpCurrent = def.stats.mp || 0;
      gameState.activeCharacters.push(def);
      gameState._tempPartyIds.push(def.id);
      added.push(def.id);
    }
    return { ok: true, added };
  }

  /** 解散临时队伍（活动/任务结束）：撤出所有 _temporary 成员 */
  disbandTempParty(gameState) {
    const ids = new Set(gameState._tempPartyIds || []);
    const removed = [];
    gameState.activeCharacters = (gameState.activeCharacters || []).filter(c => {
      if (c._temporary || ids.has(c.id)) { removed.push(c.id); return false; }
      return true;
    });
    gameState._tempPartyIds = [];
    return { ok: true, removed };
  }

  // ============================================================
  // 快照（供 UI / AI 提示 / situation 呈现）
  // ============================================================
  snapshot(gameState) {
    const st = this.state(gameState); const schema = this.schema(gameState);
    if (!st) return null;
    const prog = creditProgress(st, schema);
    const cur = schema.curriculum || {};
    return {
      schoolName: st.schoolName,
      major: st.major, majorName: schema.majors?.[st.major]?.name || st.major,
      mode: cur.mode,
      year: st.year, term: st.term, termsPerYear: cur.termsPerYear,
      status: st.status,
      gpa: computeGpa(st),
      credits: prog,
      enrolled: (st.enrolled || []).map(c => ({ id: c, name: schema.courses[c]?.name || c })),
      completedCount: (st.completed || []).length,
      clubs: (st.clubs || []).map(c => ({ id: c, name: schema.clubs?.[c]?.name || c })),
      demerits: st.demerits || 0,
      violations: (st.violations || []).length,
      retainCount: st.retainCount || 0,
      recruitable: eligibleRecruits(st, schema),
      terms: schema.narration?.terms || {},
    };
  }
}
