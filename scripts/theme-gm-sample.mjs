/**
 * 主题包真 GM 抽样（Phase 42 T4 / Phase 43 验证）—— 真 AI GM 跑几步，肉眼校验题材叙事 +
 * 作战进谏落地（ruler）/ 底层视角世界自转（soldier）。
 * 用法：OPENAI_API_KEY=... OPENAI_BASE_URL=... OPENAI_MODEL=... \
 *        node scripts/theme-gm-sample.mjs <modern|fantasy> <ruler|soldier>
 * API key 仅经环境变量传入，绝不写入文件。
 */
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
import { GameSession } from '../src/core/GameSession.js';
import { modernWarPreset } from '../src/data/themes/modernWarPreset.js';
import { medievalFantasyPreset } from '../src/data/themes/medievalFantasyPreset.js';

const which = process.argv[2] === 'fantasy' ? 'fantasy' : 'modern';
const role = process.argv[3] === 'soldier' ? 'soldier' : 'ruler';
const preset = which === 'fantasy' ? medievalFantasyPreset : modernWarPreset;
const originId = role === 'soldier' ? (which === 'fantasy' ? 'footman' : 'private') : (which === 'fantasy' ? 'monarch' : 'supreme');
const API_KEY = process.env.OPENAI_API_KEY || '';
const API_ENDPOINT = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1';
const API_MODEL = process.env.OPENAI_MODEL || 'deepseek-v4-flash';

function lastNarr(gs, n = 4) {
  return (gs.narrativeLog || []).slice(-n).map(x => `  [${x.speaker}] ${String(x.text || '').replace(/\s+/g, ' ').slice(0, 240)}`).join('\n');
}
function holdingsOf(st, fid) { return (st.factions[fid]?.holdings || []).map(h => h.name).join('/') || '（无城）'; }

async function main() {
  console.log(`=== 主题包真 GM 抽样：${which} / ${role} @ ${API_MODEL} ===\n`);
  const s = new GameSession({ combatMode: 'auto' });
  s.loadPreset(JSON.parse(JSON.stringify(preset)), { origins: originId });
  s.configureAI({ endpoint: API_ENDPOINT, apiKey: API_KEY, model: API_MODEL, maxTokens: 2200, temperature: 0.7 });
  s.gameState.aiAuthority = 3;
  await s.kickoff();
  const st0 = s.gameState.strategicState;
  console.log(`剧本：${s.preset.name}　身份：${st0.playerRole}　口吻：${s.gameState.strategySchema.narration.settingTone}\n`);

  if (role === 'ruler') {
    const says = which === 'fantasy'
      ? ['传令府库，垦荒兴农、加固守石要塞城防。', '举旗誓师，公开讨伐铁壁公国，进军铁壁堡！']
      : ['下令工业动员、在边境要塞群加固设防。', '全军进入战备：对红方正式宣战，向红都方向发起进攻！'];
    for (const text of says) {
      console.log(`\n>>> 进谏：${text}`);
      await s.applyAction({ type: 'say', text });
      console.log(lastNarr(s.gameState));
      const st = s.gameState.strategicState;
      const m = (st.marches || []).filter(x => x.attacker === st.playerFactionId);
      if (m.length) console.log(`  〔我军在途〕${m.map(x => `→${x.targetHoldingId}(${x.posture},${x.etaXun}旬,${x.army.troops}众)`).join('，')}`);
    }
  } else {
    // 底层视角：玩家只是个小兵，roleplay 表态 + 静观时局流转，看世界（势力/战争）幕后自转
    const playerFid = st0.playerFactionId;
    console.log(`〔开局〕${preset.factions.find(f => f.id === playerFid)?.name} 持城：${holdingsOf(st0, playerFid)}`);
    await s.applyAction({ type: 'say', text: '我只是军中一名小卒，擦拭着兵器，听着老兵们议论前线的战事。' });
    console.log('>>> 表态（小卒见闻）：'); console.log(lastNarr(s.gameState, 3));
    for (let i = 0; i < 8; i++) {
      await s.applyAction({ type: 'advance_season' }); // 静观时局：势力自治 + 战争幕后结算
      const st = s.gameState.strategicState;
      const rank = st.factions[playerFid]?.holdings?.length || 0;
      process.stdout.write(`  季${st.season}: 我方持城${rank}（${holdingsOf(st, playerFid)}）\n`);
    }
    console.log('\n〔时局流转后的最近叙述〕'); console.log(lastNarr(s.gameState, 5));
    console.log(`\n〔最终格局〕${Object.values(st0.factions).map(f => `${f.name}:${holdingsOf(s.gameState.strategicState, f.factionId)}`).join('　')}`);
  }
  console.log('\n=== 抽样完成 ===');
}
main().catch(e => { console.error('抽样失败:', e); process.exit(1); });
