/**
 * 战略模块需求分析（Phase 47）—— 据 digest 自动判定剧本是否该启用「战略系统」可选模块。
 *
 * 战略模块 = 势力级内政外交 + 军团战 + 叙事化战争（行军/围城）+ 底层视角/小兵参战。
 * 适合：群雄逐鹿、王朝兴亡、争霸征伐、阵营对抗等"大势"故事；
 * 不适合：个人冒险、悬疑、单线情感、解谜、小规模生存等。
 *
 * 纯函数、无依赖；供 MCP preset-server 与测试共用。
 */

// 触发战略模块的"大势"关键词（主题/基调/世界观/地点）
const WAR_KEYWORDS = [
  '战争', '征战', '征伐', '争霸', '逐鹿', '兴亡', '王朝', '王国', '帝国', '天下', '割据', '军阀',
  '势力', '阵营', '诸侯', '统一', '攻城', '会战', '战役', '权谋', '谋略', '霸业', '群雄', '国战',
  '联军', '同盟', '战线', '前线', '军团', '兵马', '社稷', '江山', '九州', '列国', '邦国', '战国',
];
const PERSONAL_KEYWORDS = [ // 反向信号：偏个人/小规模
  '悬疑', '推理', '解谜', '恋爱', '日常', '校园', '治愈', '密室', '侦探', '生存', '废土求生', '一个人',
];

function textOf(digest) {
  const w = digest.world || {};
  return [
    digest.title, digest.logline, digest.tone, w.name, w.setting, w.gmStyle,
    ...(digest.themes || []),
    ...(digest.locations || []).map(l => l.name),
    ...(digest.plotBeats || []).map(b => `${b.sectionTitle || ''} ${b.title || ''} ${b.summary || ''}`),
  ].filter(Boolean).join(' ');
}

/**
 * @param {object} digest  小说概要（novel_digest 产物）
 * @returns {{ strategy:boolean, score:number, signals:object, reasons:string[] }}
 */
export function recommendStrategyModule(digest = {}) {
  const factions = (digest.world?.factions || digest.factions || []);
  const text = textOf(digest);
  const reasons = [];
  let score = 0;

  // 1) 势力数：≥2 个对立势力是最强信号
  const factionCount = factions.length;
  if (factionCount >= 3) { score += 3; reasons.push(`多方势力(${factionCount})逐鹿`); }
  else if (factionCount >= 2) { score += 2; reasons.push(`两方势力(${factionCount})对峙`); }

  // 2) 大势关键词命中
  const hitWords = [...new Set(WAR_KEYWORDS.filter(k => text.includes(k)))];
  if (hitWords.length) { score += Math.min(3, hitWords.length); reasons.push(`含战争/王朝主题词：${hitWords.slice(0, 5).join('、')}`); }

  // 3) 战役/会战类节拍占比
  const beats = digest.plotBeats || [];
  const battleBeats = beats.filter(b => b.type === 'battle' || /战|攻城|会战|围/.test(b.title || b.summary || '')).length;
  if (beats.length && battleBeats / beats.length >= 0.3) { score += 1; reasons.push(`战役类节拍占比高(${battleBeats}/${beats.length})`); }

  // 4) 反向信号（个人/小规模题材）削分
  const personalHits = PERSONAL_KEYWORDS.filter(k => text.includes(k));
  if (personalHits.length) { score -= Math.min(3, personalHits.length); reasons.push(`偏个人/小规模题材词：${personalHits.slice(0, 3).join('、')}（削分）`); }
  if (factionCount <= 1 && hitWords.length === 0) reasons.push('无多势力、无大势主题 → 倾向纯个人冒险');

  const strategy = score >= 3;
  return {
    strategy, score,
    signals: { factionCount, warKeywordHits: hitWords.length, battleBeatRatio: beats.length ? +(battleBeats / beats.length).toFixed(2) : 0, personalKeywordHits: personalHits.length },
    reasons,
  };
}
