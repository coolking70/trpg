/**
 * 局部战斗编排共享模块（Phase 45 P45c）—— 纯逻辑，供 GameSession（headless/RPC）与
 * main.js（浏览器）复用：战线上下文探测、据题材构建小队、战后结算（战功/晋升/敌将重大事件/局部时间放缓）。
 */
import { schemaOf } from '../data/strategySchema.js';
import { rankForMerit } from '../data/skirmish.js';

/** 当前可参战的战线上下文（玩家势力的活跃围城/在途行军）。无则 null。 */
export function skirmishContext(gameState, ss) {
  const st = gameState.strategicState; if (!st) return null;
  const pid = st.playerFactionId;
  const holdingName = (id) => { for (const f of Object.values(st.factions || {})) { const h = (f.holdings || []).find(x => x.id === id); if (h) return h.name; } return id; };
  const tideFrom = (mine, foe) => Math.max(-1, Math.min(1, Math.log2(((mine || 1)) / ((foe || 1))) / 2));
  const siege = (st.sieges || []).find(s => !s._resolved && (s.attacker === pid || s.defender === pid));
  if (siege) {
    const asAtk = siege.attacker === pid;
    const my = asAtk ? siege.atk : siege.def, foe = asAtk ? siege.def : siege.atk;
    const enemyFid = asAtk ? siege.defender : siege.attacker;
    return { kind: 'siege', side: asAtk ? 'attacker' : 'defender', enemyFactionId: enemyFid, holdingId: siege.holdingId,
      tide: tideFrom(my.troops, foe.troops), desc: `${holdingName(siege.holdingId)} ${asAtk ? '城下（我军攻城）' : '城头（我军守城）'}` };
  }
  const march = (st.marches || []).find(m => !m._done && (m.defender === pid || m.attacker === pid));
  if (march) {
    const asAtk = march.attacker === pid;
    const enemyFid = asAtk ? march.defender : march.attacker;
    const myT = ss.getFactionState(gameState, pid)?.troops || 1;
    const foeT = ss.getFactionState(gameState, enemyFid)?.troops || 1;
    return { kind: 'field', side: asAtk ? 'attacker' : 'defender', enemyFactionId: enemyFid, holdingId: march.targetHoldingId,
      tide: tideFrom(myT, foeT), desc: asAtk ? '随军行进、前锋遭遇战' : '边境遭遇、阻击来犯前锋' };
  }
  return null;
}

/** 据战线上下文 + 题材，构建 startSkirmish 的 def（含敌将偶遇）。 */
export function buildSkirmishDef(gameState, ctx, factionName, rng = Math.random) {
  const enemyName = factionName(ctx.enemyFactionId);
  const tide = ctx.tide;
  const skn = schemaOf(gameState).narration?.skirmish || {};
  const allyW = skn.ally || '袍泽', enemyW = skn.enemy || '敌兵', ncoW = skn.nco || '什长';
  const commTitle = skn.commanderTitle || '骁将', commPool = skn.commanders || ['关靖', '夏侯尚', '牛金', '王双', '张虎'];
  const ek = (n, atk, def, hp, over = {}) => ({ name: n, atk, def, hp, hpMax: hp, ...over });
  const enemies = [ek(`${enemyName}${enemyW}`, 7, 4, 32), ek(`${enemyName}${enemyW}`, 7, 4, 30), ek(`${enemyName}${ncoW}`, 8, 5, 38)];
  let bossName = null;
  if (rng() < 0.12 + Math.max(0, tide) * 0.06) {
    bossName = `${enemyName}${commTitle}·${commPool[Math.floor(rng() * commPool.length)]}`;
    enemies.push(ek(bossName, 11, 7, 90, { isCommander: true }));
  }
  return {
    playerChar: gameState.activeCharacters[0],
    allies: [ek(allyW, 7, 4, 34), ek(allyW, 6, 4, 30)],
    enemies,
    reserves: { ally: Math.max(1, Math.round(3 + tide * 2)), enemy: Math.max(1, Math.round(3 - tide * 2)) },
    tide,
    labels: { allyReinforce: skn.allyReinforce || '我军援兵', enemyReinforce: skn.enemyReinforce || '敌军援兵' },
    parent: { kind: ctx.kind, side: ctx.side, factionId: gameState.strategicState.playerFactionId, enemyFactionId: ctx.enemyFactionId, holdingId: ctx.holdingId, commanderName: bossName },
    _desc: ctx.desc, _bossName: bossName,
  };
}

/**
 * 战后结算（共享）：战功/晋升（达将官→转 ruler）+ 敌将偶遇重大事件 + 局部时间放缓。
 * @param {object} ctx - { ss, oc, addNarrative, holdingName, factionName }
 */
export function settleSkirmish(gameState, { ss, oc, addNarrative, holdingName, factionName }) {
  const c = (gameState.soldierCareer ||= { rank: '士卒', rankTier: 0, merit: 0, kills: 0, battles: 0 });

  // 阵斩/生擒敌将 → 战略重大事件
  let bonusMerit = 0;
  if (oc.commanderKill && oc.parent?.enemyFactionId) {
    const captured = oc.commanderKill === 'captured';
    addNarrative(captured
      ? `⚑【重大军情】乱军之中，你竟生擒了 ${oc.parent.commanderName || '敌方骁将'}！`
      : `⚑【重大军情】你于万军之中阵斩 ${oc.parent.commanderName || '敌方骁将'}，敌阵大乱！`);
    const r = ss.applyMajorEvent(gameState, { kind: captured ? 'commander_captured' : 'commander_slain', factionId: oc.parent.enemyFactionId, commanderName: oc.parent.commanderName });
    addNarrative(`${factionName(oc.parent.enemyFactionId)}痛失大将，三军夺气、士气大挫${r?.troopHit ? `（折兵约 ${r.troopHit}）` : ''}。`);
    if (r?.liftedSiegeHoldingId) addNarrative(`🎉 围攻 ${holdingName(r.liftedSiegeHoldingId)} 的敌军竟因此动摇而退——这一战，因你而改写！`);
    bonusMerit = captured ? 120 : 80;
  }

  c.merit += (oc.merit || 0) + bonusMerit;
  c.kills += oc.kills || 0;
  c.battles += 1;
  if (oc.merit || bonusMerit) addNarrative(`（战功 +${(oc.merit || 0) + bonusMerit}，累计 ${c.merit}）`);

  // 晋升（达将官→转 ruler 战略参与）
  const newRank = rankForMerit(c.merit);
  if (newRank.tier > (c.rankTier || 0)) {
    c.rankTier = newRank.tier; c.rank = newRank.name;
    addNarrative(`🎖 论功行赏，你由行伍擢升为「${newRank.name}」！`);
    if (newRank.commander && gameState.strategicState && gameState.strategicState.playerRole !== 'ruler') {
      gameState.strategicState.playerRole = 'ruler';
      addNarrative('自此你执掌一军、可参赞方略——从此你的主张，将真正左右这场天下大势。');
    }
  }

  // 局部时间放缓（非冻结）：每数场厮杀，宏观战事方推进一旬
  const st = gameState.strategicState;
  if (st && st.regions) {
    st._skirmishTick = (st._skirmishTick || 0) + 1;
    if (st._skirmishTick % 3 === 0) {
      const evs = ss.advanceWarXun(gameState);
      for (const e of (evs || []).filter(x => x.type === 'siege_resolved')) {
        const sg = e.siege;
        addNarrative(e.attackerWins
          ? `🏯 战报：${holdingName(sg.holdingId)} 失守，落入 ${factionName(sg.attacker)} 之手。`
          : `🛡 战报：${factionName(sg.attacker)} 攻 ${holdingName(sg.holdingId)} 不克而退。`);
      }
    }
  }
}
