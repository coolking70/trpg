/**
 * 学校模块需求分析（Phase 48 SC7）—— 据 digest 自动判定剧本是否该启用「学校系统」可选模块。
 *
 * 学校模块 = 入学就读（选专业/课程·修学分升级毕业）+ 学习训练长属性习技能 +
 *   社团/实践触发剧情 + 师友同窗人际与毕业招募 + 校规惩罚 + 考试/竞赛/跨校联赛奖惩。
 * 适合：校园成长、学院修行、武道宗门、求学历练等"在校就读"故事；
 * 不适合：纯野外冒险、王朝征伐、单线悬疑/生存等与"上学"无关的题材。
 *
 * 纯函数、无依赖；供 MCP preset-server 与测试共用。
 */

// 触发学校模块的关键词（题材/基调/世界观/地点）
const SCHOOL_KEYWORDS = [
  '学校', '学院', '校园', '高中', '初中', '中学', '大学', '学园', '书院', '学堂', '私塾',
  '魔法学院', '武道馆', '武馆', '宗门', '门派', '道场', '学徒', '学员', '学生', '同学', '同窗',
  '老师', '导师', '教练', '校长', '室友', '社团', '课程', '选课', '学分', '考试', '期末', '期中',
  '毕业', '入学', '升学', '留级', '退学', '校规', '竞赛', '联赛', '修行', '研习', '就读', '校队',
];
// 反向信号：明显非校园题材
const NON_SCHOOL_KEYWORDS = [
  '王朝', '征伐', '争霸', '逐鹿', '废土', '末日求生', '密室', '荒野求生',
];

function textOf(digest) {
  const w = digest.world || {};
  return [
    digest.title, digest.logline, digest.tone, w.name, w.setting, w.gmStyle,
    ...(digest.themes || []),
    ...(digest.locations || []).map(l => `${l.name || ''} ${l.desc || l.description || ''}`),
    ...(digest.plotBeats || []).map(b => `${b.sectionTitle || ''} ${b.title || ''} ${b.summary || ''}`),
  ].filter(Boolean).join(' ');
}

/**
 * @param {object} digest  小说概要（novel_digest 产物）
 * @returns {{ school:boolean, score:number, signals:object, reasons:string[] }}
 */
export function recommendSchoolModule(digest = {}) {
  const text = textOf(digest);
  const reasons = [];
  let score = 0;

  // 1) 校园关键词命中（每个不同词 +1，封顶 4）
  const hitWords = [...new Set(SCHOOL_KEYWORDS.filter(k => text.includes(k)))];
  if (hitWords.length) { score += Math.min(4, hitWords.length); reasons.push(`含校园/就学主题词：${hitWords.slice(0, 6).join('、')}`); }

  // 2) 地点含学校设施 → 强信号
  const locs = (digest.locations || []).map(l => `${l.name || ''}`).join(' ');
  if (/学校|学院|校园|学园|书院|道场|武馆|宗门|课堂|教室|宿舍|社团/.test(locs)) { score += 1; reasons.push('故事地点含校园设施'); }

  // 3) 校园成长类节拍占比（上课/考试/社团/比赛）
  const beats = digest.plotBeats || [];
  const schoolBeats = beats.filter(b => /上课|考试|课程|社团|入学|毕业|比赛|竞赛|训练|修行|学/.test(`${b.title || ''} ${b.summary || ''}`)).length;
  if (beats.length && schoolBeats / beats.length >= 0.25) { score += 1; reasons.push(`校园成长类节拍占比高(${schoolBeats}/${beats.length})`); }

  // 4) 反向信号（明显非校园题材）削分
  const nonHits = NON_SCHOOL_KEYWORDS.filter(k => text.includes(k));
  if (nonHits.length) { score -= Math.min(3, nonHits.length); reasons.push(`含非校园题材词：${nonHits.slice(0, 3).join('、')}（削分）`); }
  if (!hitWords.length) reasons.push('无校园/就学主题词 → 倾向不启用学校系统');

  const school = score >= 3;
  return {
    school, score,
    signals: { schoolKeywordHits: hitWords.length, schoolBeatRatio: beats.length ? +(schoolBeats / beats.length).toFixed(2) : 0, nonSchoolKeywordHits: nonHits.length },
    reasons,
  };
}
