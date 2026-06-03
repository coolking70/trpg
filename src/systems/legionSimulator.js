/**
 * 军团战平衡模拟器核心（Phase 31 L5）—— 纯逻辑，无 CLI、无 import.meta
 *
 * 用真实 LegionWarfareSystem，对一场军团战做 Monte Carlo 模拟（双方都走 decideLegion
 * 启发式，注入种子 rng）。runtime / MCP / CLI / 测试共享。
 */

import { LegionWarfareSystem } from './LegionWarfareSystem.js';
import { aliveTroops } from '../data/warfare.js';

/** 种子 rng（LCG，确定性） */
export function makeSeededRng(seed = 12345) {
  let x = seed >>> 0;
  return () => { x = (1103515245 * x + 12345) >>> 0; return x / 4294967296; };
}

function cloneBattle(b) {
  return JSON.parse(JSON.stringify(b));
}

/** 用 LegionWarfareSystem 跑完一整场（双方启发式自动结算），返回结果摘要 */
export function simulateOnce(battleDef, rng, strategySchema = null) {
  const sys = new LegionWarfareSystem();
  sys.rng = rng;
  sys.eventSystem = null;
  const gs = strategySchema ? { strategySchema } : {};
  sys.startBattle(gs, cloneBattle(battleDef));
  const totalPlayer0 = aliveTroops(gs.activeLegionBattle.units, 'player');
  const totalEnemy0 = aliveTroops(gs.activeLegionBattle.units, 'enemy');

  let result = null, iter = 0;
  while (gs.activeLegionBattle && iter++ < 800) {
    const actor = sys.getCurrentActor(gs);
    if (!actor || actor.troops <= 0) {
      const r = sys.nextTurn(gs);
      if (r.battleEnd) { result = r; break; }
      continue;
    }
    const order = sys.decideLegion(gs, actor);
    sys.executeOrder(gs, actor.id, order);
    const r = sys.nextTurn(gs);
    if (r.battleEnd) { result = r; break; }
  }
  if (!result) return { winnerSide: 'enemy', round: iter, playerLossRatio: 1, enemyLossRatio: 0, timedOut: true };
  const s = result.summary || {};
  return {
    winnerSide: result.winnerSide,
    round: s.round ?? iter,
    playerLossRatio: totalPlayer0 ? (s.playerLosses || 0) / totalPlayer0 : 0,
    enemyLossRatio: totalEnemy0 ? (s.enemyLosses || 0) / totalEnemy0 : 0,
    timedOut: false,
  };
}

/** 对一场军团战做 N 次模拟，汇总统计。strategySchema 可指定题材（缺省=三国默认）。 */
export function simulateLegionBattle(battleDef, { runs = 1000, seed = 12345, strategySchema = null } = {}) {
  const rng = makeSeededRng(seed);
  let wins = 0, roundSum = 0, pLoss = 0, eLoss = 0, timeouts = 0;
  for (let i = 0; i < runs; i++) {
    const r = simulateOnce(battleDef, rng, strategySchema);
    if (r.winnerSide === 'player') wins++;
    roundSum += r.round;
    pLoss += r.playerLossRatio;
    eLoss += r.enemyLossRatio;
    if (r.timedOut) timeouts++;
  }
  const winRate = wins / runs;
  return {
    runs, winRate,
    avgRounds: +(roundSum / runs).toFixed(1),
    avgPlayerLoss: +(pLoss / runs).toFixed(3),
    avgEnemyLoss: +(eLoss / runs).toFixed(3),
    timeouts,
    flag: balanceFlag(winRate),
  };
}

export function balanceFlag(winRate) {
  if (winRate >= 0.92) return '😴 白给';
  if (winRate >= 0.55) return '✓ 适中';
  if (winRate >= 0.35) return '⚠ 偏难';
  if (winRate >= 0.12) return '❌ 过难';
  return '☠ 不可胜';
}

/** 从预设事件里抽出所有 start_legion_battle 战斗 */
export function collectLegionBattles(preset) {
  const out = [];
  for (const ev of (preset.events || [])) {
    for (const ch of (ev.choices || [])) {
      for (const oc of (ch.outcomes || [])) {
        for (const eff of (oc.effects || [])) {
          if (eff.type === 'start_legion_battle' && eff.battle) {
            out.push({ eventId: ev.id, eventName: ev.name, battleType: eff.battle.battleType, battle: eff.battle });
          }
        }
      }
    }
  }
  return out;
}
