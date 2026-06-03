/**
 * 手动玩测驱动（逐步）—— 跨调用持久化 gameState 到 /tmp，真 GM 接入 API。
 *   启动： node scripts/manual-play.mjs start <presetPath> [originId]
 *   行动： node scripts/manual-play.mjs act '<actionJSON>'
 * API key 仅经环境变量传入。
 */
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
import fs from 'fs';
import { GameSession } from '../src/core/GameSession.js';
import { GameState } from '../src/models/GameState.js';

const SAVE = '/tmp/sanguo-play.json';
const META = '/tmp/sanguo-play.meta.json';
const API_KEY = process.env.OPENAI_API_KEY || '';
const API_ENDPOINT = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1';
const API_MODEL = process.env.OPENAI_MODEL || 'deepseek-v4-flash';

function configure(s) {
  s.configureAI({ endpoint: API_ENDPOINT, apiKey: API_KEY, model: API_MODEL, maxTokens: 2400, temperature: 0.75 });
}

function printState(s, sinceLen) {
  const gs = s.gameState;
  const st = s.getState();
  const narr = (gs.narrativeLog || []).slice(sinceLen);
  console.log('\n———————————————————————— 叙述 ————————————————————————');
  for (const n of narr) console.log(`[${n.speaker}] ${String(n.text).replace(/\s+/g, ' ')}`);
  console.log('———————————————————————————————————————————————————————');
  console.log(`〔局面〕situation=${st.situation}　场景=${st.scene?.name || '-'}`);
  if (st.strategy) console.log(`〔国势〕${st.strategy.playerRole} · 第${st.strategy.season}季 · 资源 金${st.strategy.resources.gold}/粮${st.strategy.resources.food}/兵${st.strategy.resources.troops}/民心${st.strategy.resources.order}`);
  if (gs.soldierCareer) { const c = gs.soldierCareer; console.log(`〔行伍〕${c.rank} 战功${c.merit} 斩获${c.kills} 历战${c.battles}`); }
  if (st.skirmish) { const k = st.skirmish; console.log(`〔局部战斗〕第${k.round}回合 tide=${k.tide.toFixed(2)} 斩获${k.kills}｜我:${k.allies.map(u => u.name + '(' + u.hp + ')').join(',')}｜敌:${k.enemies.map(u => (u.isCommander ? '⚑' : '') + u.name + '(' + u.hp + ')').join(',')}`); }
  if (st.options?.length) { console.log('〔可选〕'); for (const o of st.options) console.log(`   ${JSON.stringify(o)}`); }
}

async function main() {
  const [mode, a1, a2] = process.argv.slice(2);
  const s = new GameSession({ combatMode: 'interactive' });
  configure(s);

  if (mode === 'start') {
    const preset = JSON.parse(fs.readFileSync(a1, 'utf8'));
    s.loadPreset(preset, a2 ? { origins: a2 } : null);
    s.gameState.aiAuthority = 3;
    await s.kickoff();
    fs.writeFileSync(SAVE, JSON.stringify(s.gameState.toJSON()));
    fs.writeFileSync(META, JSON.stringify({ narrLen: 0, presetPath: a1 }));
    printState(s, 0);
    return;
  }
  // act：恢复状态后施加一个动作
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  const preset = JSON.parse(fs.readFileSync(meta.presetPath, 'utf8'));
  s.loadPreset(preset);
  s.gameState = GameState.fromJSON(JSON.parse(fs.readFileSync(SAVE, 'utf8')));
  const before = (s.gameState.narrativeLog || []).length;
  const action = JSON.parse(a1);
  await s.applyAction(action);
  fs.writeFileSync(SAVE, JSON.stringify(s.gameState.toJSON()));
  printState(s, before);
}
main().catch(e => { console.error('玩测出错:', e); process.exit(1); });
