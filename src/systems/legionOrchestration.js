/**
 * 军团战编排共享模块（Phase 39 收敛）—— 纯逻辑，供 GameSession（headless/RPC）与
 * main.js（浏览器）复用，消除"出征装配 + 战后结算"的重复实现。
 *
 * 只处理与战略层（StrategicSystem）的耦合（drawFromStrategy 兵粮、外交援军、领土易主），
 * 不碰具体的回合循环/UI——那部分两端形态不同，各自保留。
 */

import { schemaOf, battleUnitKey } from '../data/strategySchema.js';

/**
 * 出征装配：处理 drawFromStrategy（从国库扣兵粮 + 缩放我方栈 + 外交援军）+ 主将武备补全。
 * @param {object} battleDef
 * @param {object} ctx - { gameState, strategicSystem, cardManager }
 * @returns {{ def: object, strategyCtx: object|null }} def 可直接交 LegionWarfareSystem.startBattle
 */
export function assembleLegionBattle(battleDef, { gameState, strategicSystem, cardManager }) {
  const def = { ...battleDef, units: (battleDef.units || []).map(u => ({ ...u })) };
  let strategyCtx = null;
  const st = gameState.strategicState;
  const ss = strategicSystem;

  if (battleDef.drawFromStrategy && st && ss) {
    const fid = battleDef.playerFactionId || st.playerFactionId;
    const playerUnits = def.units.filter(u => u.side !== 'enemy');
    const requested = playerUnits.reduce((s, u) => s + (Number(u.troops) || 0), 0)
      || (ss.getFactionState(gameState, fid)?.troops || 0);
    const mobilized = ss.mobilize(gameState, fid, requested);
    const scale = requested > 0 ? mobilized / requested : 1;
    for (const u of playerUnits) u.troops = Math.max(1, Math.round((Number(u.troops) || 0) * scale));

    const f = ss.getFactionState(gameState, fid);
    def.supply = def.supply || {};
    if (def.supply.player == null && f) {
      const carried = Math.floor((f.food || 0) * 0.5);
      def.supply.player = carried;
      f.food = Math.max(0, (f.food || 0) - carried);
    }
    if (battleDef.allyFactionId) {
      const ally = ss.getFactionState(gameState, battleDef.allyFactionId);
      const rel = ss.relationOf(gameState, fid, battleDef.allyFactionId);
      if (ally && rel.stance === 'ally') {
        const aid = ss.mobilize(gameState, battleDef.allyFactionId, Math.round((ally.troops || 0) * 0.4));
        if (aid > 0) def.units.push({ id: `ally_${battleDef.allyFactionId}`, side: 'player', unitType: battleUnitKey(schemaOf(gameState), 'attacker'), troops: aid, name: `${ally.name}援军` });
      }
    }
    strategyCtx = { fid, mobilized, enemyFid: battleDef.enemyFactionId || null };
  }

  // 主将武备补全：内联 generals 优先，缺则从卡牌取
  const generals = { ...(def.generals || {}) };
  for (const u of def.units) {
    if (u.generalId && !generals[u.generalId]) {
      const card = cardManager ? cardManager.getCard(u.generalId) : null;
      if (card) generals[u.generalId] = { name: card.name, warfare: card.warfare || null };
    }
  }
  def.generals = generals;
  return { def, strategyCtx };
}

/**
 * 战后结算：drawFromStrategy 残部归队/民心/资源/关系 + 领土易主（recordBattleOutcome）。
 * @param {object} ctx - { gameState, strategicSystem, strategyCtx, battleDef, won, summary }
 * @returns {{ narratives: string[] }} 供调用方写入叙事
 */
export function settleLegionBattle({ gameState, strategicSystem, strategyCtx, battleDef, won, summary = {} }) {
  const narratives = [];
  const ss = strategicSystem;
  if (!gameState.strategicState || !ss) return { narratives };

  if (strategyCtx) {
    ss.returnTroops(gameState, strategyCtx.fid, Math.max(0, summary.playerTroops || 0)); // 残部归队
    const me = ss.getFactionState(gameState, strategyCtx.fid);
    if (me) {
      if (won) { me.gold += 50; me.order = Math.min(100, me.order + 6); }
      else { me.order = Math.max(0, me.order - 10); }
    }
    if (strategyCtx.enemyFid && gameState.strategicState.factions[strategyCtx.enemyFid]) {
      const cur = ss.relationOf(gameState, strategyCtx.fid, strategyCtx.enemyFid);
      ss._setRelationSym(gameState.strategicState.factions, strategyCtx.fid, strategyCtx.enemyFid, cur.relation + (won ? -10 : 6));
    }
  }

  if (battleDef) {
    const oc = ss.recordBattleOutcome(gameState, battleDef, won);
    gameState.worldFlags ||= {};
    for (const fl of (oc.flags || [])) gameState.worldFlags[fl] = true;
    if (oc.narrative) narratives.push(`🏯 ${oc.narrative}`);
  }
  return { narratives };
}
