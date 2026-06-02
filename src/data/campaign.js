/**
 * 战役级连战数据层（Phase 38）—— 纯数据 + 纯函数
 *
 * 把孤立的单场军团战串成"会战争霸弧"：战役有领土后果（夺城/失地），敌国会主动来犯，
 * 战局态可被极简呈现 + 用作剧情触发。逻辑在 StrategicSystem（territory/invasion）+ 事件层；
 * 本文件只放纯函数与战局摘要。
 */

import { factionPower } from './governance.js';

/** 一场军团战的领土后果（纯函数）：返回 { captureHoldingId?, loseHoldingId?, flags[] } */
export function battleTerritoryOutcome(battleDef = {}, won) {
  const key = battleDef.campaignKey || battleDef.objectiveName || 'battle';
  const flags = [`${won ? 'won' : 'lost'}_${slug(key)}`];
  const out = { flags };
  // attack：胜则夺取目标城（敌→我）；defense：败则失目标城（我→敌）
  if (battleDef.objectiveHoldingId) {
    const role = battleDef.battleType === 'defense' ? 'defender' : 'attacker';
    if (role === 'attacker' && won) out.captureHoldingId = battleDef.objectiveHoldingId;
    if (role === 'defender' && !won) out.loseHoldingId = battleDef.objectiveHoldingId;
  }
  return out;
}

/** 战局摘要（极简一行）：玩家势力据城数 + 与各势力战和 + 实力排名位次 */
export function campaignStatus(strategicState, playerId = null) {
  if (!strategicState) return '';
  const pid = playerId || strategicState.playerFactionId;
  const me = strategicState.factions?.[pid];
  if (!me) return '';
  const cities = (me.holdings || []).length;
  const atWar = Object.values(me.diplomacy || {}).filter(r => r.stance === 'war').length;
  const ranking = Object.values(strategicState.factions)
    .map(f => ({ id: f.factionId, power: factionPower(f) }))
    .sort((a, b) => b.power - a.power);
  const rank = ranking.findIndex(r => r.id === pid) + 1;
  return `战局：据 ${cities} 城 · 交战 ${atWar} 方 · 势第 ${rank}/${ranking.length}`;
}

function slug(s) {
  return String(s).replace(/[^\w一-龥]+/g, '_').slice(0, 24);
}
export { slug as campaignSlug };
