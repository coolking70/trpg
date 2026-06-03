/**
 * 学校系统真 GM 抽样（Phase 48 SC8 验证）—— 真 AI GM 跑一段就学流程，肉眼校验校园叙事。
 * 用法：OPENAI_API_KEY=... OPENAI_BASE_URL=... OPENAI_MODEL=... node scripts/school-gm-sample.mjs
 * API key 仅经环境变量传入，绝不写入文件。
 */
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
import { GameSession } from '../src/core/GameSession.js';
import { magicAcademyPreset } from '../src/data/themes/magicAcademyPreset.js';

const API_KEY = process.env.OPENAI_API_KEY || '';
const API_ENDPOINT = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1';
const API_MODEL = process.env.OPENAI_MODEL || 'deepseek-v4-flash';

function lastNarr(gs, n = 4) {
  return (gs.narrativeLog || []).slice(-n).map(x => `  [${x.speaker}] ${String(x.text || '').replace(/\s+/g, ' ').slice(0, 260)}`).join('\n');
}

async function main() {
  console.log(`=== 学校系统真 GM 抽样：魔法学院 @ ${API_MODEL} ===\n`);
  const s = new GameSession({ combatMode: 'auto' });
  s.loadPreset(JSON.parse(JSON.stringify(magicAcademyPreset)), { origins: 'evoker' });
  s.configureAI({ endpoint: API_ENDPOINT, apiKey: API_KEY, model: API_MODEL, maxTokens: 1800, temperature: 0.7 });
  await s.kickoff();
  const snap0 = s.getState().school;
  console.log(`学院：${snap0.schoolName}　学派：${snap0.majorName}　年级：${snap0.year}　必修：${snap0.enrolled.map(e => e.name).join('、')}\n`);

  const steps = [
    { label: '自由发言', act: { type: 'say', text: '我走进塑能教室，找了个靠窗的位置，翻开《初级塑能》的讲义。' } },
    { label: '上课·初级塑能', act: { type: 'school', op: 'attend', courseId: 'm_fire1' } },
    { label: '加入炼金研究会', act: { type: 'school', op: 'club', clubId: 'club_alchemy' } },
    { label: '参加晋级试炼', act: { type: 'school', op: 'exam', examId: 'final' } },
    { label: '上实习课(触发秘境剧情钩子)', act: { type: 'school', op: 'elect', courseId: 'm_ward' } },
  ];
  for (const st of steps) {
    console.log(`\n>>> ${st.label}`);
    await s.applyAction(st.act);
    console.log(lastNarr(s.gameState));
  }
  const fin = s.getState().school;
  console.log(`\n〔结果〕学分 ${fin.credits.earned}/${fin.credits.toGraduate}　GPA ${fin.gpa.toFixed(2)}　社团 ${fin.clubs.map(c => c.name).join('、') || '—'}　记过 ${fin.demerits}`);
  console.log(`角色技能：${(s.gameState.activeCharacters[0].skills || []).join('、') || '—'}`);
  process.exit(0);
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
