/**
 * 战略平衡模拟器核心（Phase 33 S5）—— 纯逻辑，无 CLI、无 import.meta
 *
 * 用真实 StrategicSystem，对一份战略设定（preset.strategicSetup / strategicLayer）跑 N 季：
 * 玩家用一套均衡内政策略 + 敌国活跃 AI，报玩家势力的资源/实力轨迹、对玩家宣战次数、
 * 势力消长与平衡标志。供 MCP/CLI/测试共享。
 */

import { StrategicSystem } from './StrategicSystem.js';
import { factionPower } from '../data/governance.js';

export function makeSeededRng(seed = 12345) {
  let x = seed >>> 0;
  return () => { x = (1103515245 * x + 12345) >>> 0; return x / 4294967296; };
}

/** 玩家每季的均衡策略：缺粮劝农、民心低赈灾、缺金征税、否则征兵/屯田 */
function defaultPlayerPolicy(me) {
  if ((me.food || 0) < (me.troops || 0) / 40) return 'farming';
  if ((me.order ?? 60) < 40 && (me.gold || 0) >= 20) return 'relief';
  if ((me.gold || 0) < 40) return 'tax';
  if ((me.troops || 0) < 8000 && (me.gold || 0) >= 20 && (me.food || 0) >= 10) return 'conscript';
  return 'develop';
}

/**
 * @param {object} presetLike - { factions?, strategicSetup?, strategicLayer? }
 * @param {object} opts - { seasons=20, seed=12345, playerActs=true }
 */
export function simulateSeasons(presetLike, { seasons = 20, seed = 12345, playerActs = true } = {}) {
  const sys = new StrategicSystem();
  sys.eventSystem = null;
  sys.rng = makeSeededRng(seed);
  const gs = {};
  sys.initFromPreset(gs, presetLike);
  if (!gs.strategicState) return { ok: false, reason: '无战略设定（strategicSetup/strategicLayer）' };

  const pid = gs.strategicState.playerFactionId;
  const trajectory = [];
  let warsOnPlayer = 0, faminesOnPlayer = 0;

  for (let i = 0; i < seasons; i++) {
    const me = sys.getPlayerState(gs);
    if (playerActs && me) sys.applyPolicy(gs, pid, defaultPlayerPolicy(me));
    const { events } = sys.advanceSeason(gs);
    for (const e of events) {
      if (e.against === pid && e.type === 'war_declared') warsOnPlayer++;
      if (e.against === pid && e.type === 'attack_intent') warsOnPlayer++;
      if (e.faction === pid && e.type === 'famine') faminesOnPlayer++;
    }
    const m = sys.getPlayerState(gs);
    trajectory.push({ season: gs.strategicState.season - 1, gold: m.gold, food: m.food, troops: m.troops, order: m.order, power: factionPower(m) });
  }

  const me = sys.getPlayerState(gs);
  const ranking = sys.ranking(gs);
  const playerRank = ranking.findIndex(r => r.factionId === pid) + 1;
  const healthy = me.troops > 0 && me.order >= 20 && me.food >= 0;
  return {
    ok: true, seasons, playerFactionId: pid,
    final: { gold: me.gold, food: me.food, troops: me.troops, order: me.order, power: factionPower(me) },
    playerRank, totalFactions: ranking.length,
    warsOnPlayer, faminesOnPlayer,
    ranking, trajectory,
    flag: !healthy ? '☠ 势力崩溃' : (playerRank === 1 ? '👑 一家独大' : (playerRank <= Math.ceil(ranking.length / 2) ? '✓ 稳健发展' : '⚠ 势弱待援')),
  };
}
