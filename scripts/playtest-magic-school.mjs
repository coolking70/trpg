/**
 * 《云霄学徒·奥术之路》完整真 GM 玩测（Phase 48）——入学 → 修业 → 社团/关系 → 秘境实习/决斗(战斗)
 *   → 禁咒抉择 → 竞赛 → 考试 → 升年级 → 失控造物Boss → 毕业 → 招募。
 * 用法：OPENAI_API_KEY=... OPENAI_BASE_URL=... OPENAI_MODEL=... node scripts/playtest-magic-school.mjs
 * API key 仅经环境变量传入，绝不写入文件。
 */
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
import fs from 'fs';
import { GameSession } from '../src/core/GameSession.js';

const API_KEY = process.env.OPENAI_API_KEY || '';
const API_ENDPOINT = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1';
const API_MODEL = process.env.OPENAI_MODEL || 'deepseek-v4-flash';

// 事件选择偏好（守规劝阻路线）
const CHOICE_PREF = {
  ev_orientation: 'c_vow', ev_dorm_night: 'c_join', ev_club_fair: 'c_browse',
  ev_forbidden: 'c_dissuade', ev_fieldwork: 'c_fight', ev_club_duel: 'c_duel',
  ev_construct: 'c_stop', ev_graduation: 'c_recruit',
};

function lastNarr(gs, n = 3) {
  return (gs.narrativeLog || []).slice(-n).map(x => `    [${x.speaker}] ${String(x.text || '').replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
}
function schoolLine(sn) {
  if (!sn) return '';
  return `    〔学籍〕${sn.year}年级·学期${sn.term}　学分 ${sn.credits.earned}/${sn.credits.toGraduate}　GPA ${sn.gpa.toFixed(2)}　社团[${sn.clubs.map(c => c.name).join(',') || '—'}]　记过 ${sn.demerits}　状态 ${sn.status}`;
}

async function main() {
  console.log(`=== 《云霄学徒·奥术之路》完整玩测 @ ${API_MODEL} ===\n`);
  const preset = JSON.parse(fs.readFileSync('presets/magic-school.json', 'utf8'));
  const s = new GameSession({ combatMode: 'auto' });
  s.loadPreset(preset, { origins: 'evoker' });
  s.configureAI({ endpoint: API_ENDPOINT, apiKey: API_KEY, model: API_MODEL, maxTokens: 1500, temperature: 0.75 });
  await s.kickoff();

  // 行动队列（school 动作容错：attend 未选则先 elect；elect 已选/已修则跳过）
  const queue = [
    ['say', '深吸一口气，我握紧法杖，准备开启在云霄学院的修行。'],
    ['attend', 'm_fund'], ['elect', 'm_fire1'], ['exam', 'midterm'], ['attend', 'm_fire1'],
    ['travel', 'scene_dorm'], ['travel', 'scene_academy'],
    ['club', 'club_alchemy'], ['club', 'club_duel'],
    ['travel', 'scene_library'], ['travel', 'scene_academy'],
    ['elect', 'm_fire2'], ['attend', 'm_fire2'],
    ['attend', 'm_summon1'], ['exam', 'cup'],
    ['advance_term'], ['advance_term'],          // Y1 末 → 升 Y2
    ['attend', 'm_ward'],
    ['advance_term'],                            // Y2T1 → T2
    ['attend', 'm_field'],                       // → 秘境实习 eventHook（临时组队+战斗）
    ['travel', 'scene_rift'],                    // → 失控造物 Boss（年级2 + 禁咒线后）
    ['advance_term'],                            // 在秘境裂隙毕业（人不在学院广场）
    ['travel', 'scene_academy'],                 // 返校 → 毕业典礼事件触发
    ['recruit'],
  ];

  let qi = 0, step = 0;
  while (step++ < 80) {
    const st = s.getState();
    // 1) 优先解决事件
    if (st.situation === 'event' && st.event) {
      const pref = CHOICE_PREF[st.event.id];
      const opt = (st.options.find(o => o.choiceId === pref)) || st.options[0];
      console.log(`\n▶ 事件「${st.event.name}」`);
      console.log(`    ${String(st.event.description || '').slice(0, 160)}`);
      console.log(`    → 选择：${opt?.text || opt?.choiceId}`);
      await s.applyAction({ type: 'choose', choiceId: opt.choiceId });
      console.log(lastNarr(s.gameState, 2));
      const sn = s.getState().school; if (sn) console.log(schoolLine(sn));
      continue;
    }
    // 2) 交互战斗兜底（auto 模式一般已自动结算）
    if (st.situation === 'combat' && st.combat?.awaitingInput) {
      const tid = st.combat.enemies[0]?.id;
      await s.applyAction({ type: 'combat', actionType: 'attack', targetId: tid });
      continue;
    }
    // 3) 取下一条行动
    if (qi >= queue.length) break;
    const [op, arg] = queue[qi++];
    if (op === 'say') { console.log(`\n💬 「${arg}」`); await s.applyAction({ type: 'say', text: arg }); console.log(lastNarr(s.gameState, 1)); continue; }
    if (op === 'travel') { console.log(`\n🚶 前往 ${arg}`); await s.applyAction({ type: 'travel', sceneId: arg }); continue; }
    // school 动作
    const gs = s.gameState; const sc = s.sys('SchoolSystem'); const sch = sc.schema(gs);
    let action = { type: 'school', op };
    if (op === 'attend') {
      if (!(gs.schoolState.enrolled || []).includes(arg) && !(gs.schoolState.completed || []).includes(arg)) {
        await s.applyAction({ type: 'school', op: 'elect', courseId: arg }); // 容错：先选课
      }
      if ((gs.schoolState.completed || []).includes(arg)) { continue; } // 已修毕，跳过
      action.courseId = arg;
    } else if (op === 'elect') {
      if ((gs.schoolState.enrolled || []).includes(arg) || (gs.schoolState.completed || []).includes(arg)) { continue; }
      action.courseId = arg;
    } else if (op === 'club') {
      if ((gs.schoolState.clubs || []).includes(arg)) { continue; }
      action.clubId = arg;
    } else if (op === 'exam') { action.examId = arg; }
    const label = op === 'exam' ? `考核 ${sch.exams?.[arg]?.name || sch.competitions?.[arg]?.name || arg}` : op === 'advance_term' ? '推进学期' : op === 'recruit' ? '毕业招募' : `${op} ${arg}`;
    console.log(`\n📚 ${label}`);
    await s.applyAction(action);
    console.log(lastNarr(s.gameState, op === 'advance_term' || op === 'exam' ? 1 : 2));
    const sn = s.getState().school; if (sn) console.log(schoolLine(sn));
    if (sn && (sn.status === 'expelled')) { console.log('\n‼ 被退学，玩测中止'); break; }
  }

  // 结局汇总
  const fin = s.getState();
  const sn = fin.school;
  console.log('\n========== 玩测结局 ==========');
  if (sn) console.log(schoolLine(sn));
  console.log(`队伍成员：${fin.party.map(p => p.name).join('、')}`);
  console.log(`主角技能：${(s.gameState.activeCharacters[0].skills || []).join('、') || '—'}`);
  const pc = s.gameState.activeCharacters[0].stats;
  console.log(`主角属性：HP${pc.hp} MP${pc.mp} 魔攻${pc.magicAttack} 智${pc.intellect} 运${pc.luck}`);
  console.log(`变量：forbidden_path=${s.gameState.variables?.forbidden_path}  graduated=${s.gameState.variables?.graduated}`);
  process.exit(0);
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
