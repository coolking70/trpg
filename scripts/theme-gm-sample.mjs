/**
 * 主题包真 GM 抽样（Phase 42 T4 验证）—— 用真 AI GM 跑几步，肉眼校验题材叙事/作战进谏落地。
 * 用法：OPENAI_API_KEY=... OPENAI_BASE_URL=... OPENAI_MODEL=... node scripts/theme-gm-sample.mjs [modern|fantasy]
 * API key 仅经环境变量传入，绝不写入文件。
 */
// Node 环境无 requestAnimationFrame：用 setTimeout 兜底（GameEngine 的循环用得到）
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
import { GameSession } from '../src/core/GameSession.js';
import { modernWarPreset } from '../src/data/themes/modernWarPreset.js';
import { medievalFantasyPreset } from '../src/data/themes/medievalFantasyPreset.js';

const which = process.argv[2] === 'fantasy' ? 'fantasy' : 'modern';
const preset = which === 'fantasy' ? medievalFantasyPreset : modernWarPreset;
const API_KEY = process.env.OPENAI_API_KEY || '';
const API_ENDPOINT = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1';
const API_MODEL = process.env.OPENAI_MODEL || 'deepseek-v4-flash';

function lastNarr(gs, n = 4) {
  return (gs.narrativeHistory || gs.narrative || []).slice(-n).map(x => `  [${x.type}] ${String(x.content || x.text || '').replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
}

async function main() {
  console.log(`=== 主题包真 GM 抽样：${which} @ ${API_MODEL} ===\n`);
  const s = new GameSession({ combatMode: 'auto' });
  s.loadPreset(JSON.parse(JSON.stringify(preset)));
  s.configureAI({ endpoint: API_ENDPOINT, apiKey: API_KEY, model: API_MODEL, maxTokens: 2200, temperature: 0.7 });
  s.gameState.aiAuthority = 3; // 编剧档：可自由进谏出兵/内政
  await s.kickoff();
  console.log(`剧本：${s.preset.name}　题材口吻：${s.gameState.strategySchema.narration.settingTone}\n`);

  const says = which === 'fantasy'
    ? ['传令府库，立即垦荒兴农、充实粮秣，并加固守石要塞的城防。',
       '我意已决：举旗誓师，公开讨伐铁壁公国，进军铁壁堡！']
    : ['下令工业动员，扩大军工生产，并在边境要塞群加固设防。',
       '全军进入战备：对红方正式宣战，向红都方向发起进攻！'];

  for (const text of says) {
    console.log(`\n>>> 进谏：${text}`);
    await s.applyAction({ type: 'say', text });
    console.log(lastNarr(s.gameState));
    const st = s.gameState.strategicState;
    const marches = (st.marches || []).filter(m => m.attacker === st.playerFactionId);
    if (marches.length) console.log(`  〔我军在途〕${marches.map(m => `→${m.targetHoldingId}(${m.posture},${m.etaXun}旬,${m.army.troops}众)`).join('，')}`);
  }
  console.log('\n=== 抽样完成 ===');
}
main().catch(e => { console.error('抽样失败:', e); process.exit(1); });
