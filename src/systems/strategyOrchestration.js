/**
 * 战略编排共享模块（Phase 40 收敛阶段2）—— 纯逻辑，供 GameSession（headless/RPC）与
 * main.js（浏览器）复用，消除战略事件效果与季度事件分派的重复实现。
 *
 * 只做状态变更与"事件→worldFlags/叙述意图"的归并；具体的"如何叙述/如何进入入侵战斗"
 * 两端形态不同，由调用方按返回值各自处理。
 */

import { clampRelation } from '../data/governance.js';

/**
 * 战略类事件效果（set_diplomacy / adjust_resource / mobilize）。
 * @returns {boolean} 是否已处理该 effect（false=非战略效果，交调用方继续）
 */
export function applyStrategyEffect(eff, { gameState, strategicSystem }) {
  const ss = strategicSystem;
  const st = gameState.strategicState;
  switch (eff.type) {
    case 'set_diplomacy': {
      if (ss && st && eff.factionId && eff.targetId && st.factions[eff.factionId] && st.factions[eff.targetId]) {
        const cur = ss.relationOf(gameState, eff.factionId, eff.targetId);
        const relation = eff.relation != null ? clampRelation(eff.relation) : clampRelation((cur.relation || 0) + (eff.relationDelta || 0));
        ss._setRelationSym(st.factions, eff.factionId, eff.targetId, relation, eff.stance || null);
      }
      return true;
    }
    case 'adjust_resource': {
      const fid = eff.factionId || st?.playerFactionId;
      const f = ss ? ss.getFactionState(gameState, fid) : null;
      if (f) ss._applyDeltas(f, { gold: eff.gold || 0, food: eff.food || 0, troops: eff.troops || 0, order: eff.order || 0 });
      return true;
    }
    case 'mobilize': {
      const fid = eff.factionId || st?.playerFactionId;
      if (ss && fid) ss.mobilize(gameState, fid, eff.value || eff.amount || 0);
      return true;
    }
    default:
      return false;
  }
}

/**
 * 把 advanceSeason 产出的 events 归并为 worldFlags + 叙述行 + 首个对玩家的入侵意图。
 * @returns {{ narratives: string[], invasion: {by:string}|null }}
 */
export function applySeasonEvents(gameState, events = []) {
  const st = gameState.strategicState;
  const pid = st?.playerFactionId;
  const nameOf = (id) => st?.factions?.[id]?.name || id;
  gameState.worldFlags ||= {};
  const narratives = [];
  let invasion = null;
  for (const ev of events) {
    if (ev.against === pid && ev.type === 'war_declared') {
      gameState.worldFlags[`war_with_${ev.by}`] = true;
      narratives.push(`⚠ ${nameOf(ev.by)} 向我方宣战！`);
    } else if (ev.against === pid && ev.type === 'attack_intent') {
      gameState.worldFlags[`invasion_from_${ev.by}`] = true;
      narratives.push(`⚠ ${nameOf(ev.by)} 大军压境，意图来犯！`);
      if (!invasion) invasion = { by: ev.by };
    } else if (ev.type === 'famine') {
      narratives.push(`（${nameOf(ev.faction)} 粮荒，民心动荡）`);
    }
  }
  return { narratives, invasion };
}
