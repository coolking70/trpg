/**
 * 围城平衡模拟器（Phase 42 T1）—— 纯逻辑，无 CLI、无 import.meta。
 *
 * 复用真实 war.js 的 siegeTick / siegeOutcome，对各类"攻城军 × 守军 × 攻守策略"
 * 组合做确定性推演，统计四条结局路径（breach 强攻破城 / surrender 围困献城 /
 * retreat 坚守退敌 / fallen 城陷）的占比与平均旬数，用于校准平衡。
 *
 * runtime / MCP / CLI / 测试共享。
 */

import { siegeTick, siegeOutcome, MARCH_POSTURES, postureMoraleMod } from '../data/war.js';

/**
 * 按 StrategicSystem.resolveEngagement('hold') 的口径构建一个初始围城态。
 * @param {object} p
 *   posture     'raid' | 'open'（决定 defenderPrep / 攻方士气 / 初始 mode）
 *   atkTroops   攻方兵力
 *   atkFood     攻方携带粮（supply = floor(atkFood*0.4)）
 *   defTroops   守城基础兵（garrison = round(defTroops*(0.5+0.35*prep))）
 *   defFood     守方城中粮（supply = floor(defFood*0.6)）
 *   machinePower 攻城器械（默认 30）
 */
export function buildSiege(p) {
  const posture = p.posture || 'open';
  const prep = MARCH_POSTURES[posture]?.defenderPrep ?? 1;
  const garrison = Math.round((p.defTroops || 0) * (0.5 + 0.35 * prep));
  return {
    id: 'sim',
    mode: posture === 'raid' ? 'assault' : 'blockade',
    xun: 0,
    atk: {
      troops: p.atkTroops || 0,
      morale: 70 + postureMoraleMod(posture),
      supply: Math.floor((p.atkFood || 0) * 0.4),
    },
    def: {
      troops: garrison,
      supply: Math.floor((p.defFood || 0) * 0.6),
      morale: 70,
    },
    works: { gate: Math.round(220 * (0.6 + 0.4 * prep)), wall: Math.round(320 * (0.6 + 0.4 * prep)) },
    machinePower: p.machinePower ?? 30,
  };
}

/**
 * 攻守策略：每旬返回攻方 mode（'assault'|'blockade'）。默认固定策略。
 *   atkPolicy(siege, xun) -> 'assault' | 'blockade'
 *   defPolicy(siege, xun) -> { sortie?: bool } 守方是否出城反击（消耗攻方兵/士气）
 */
export function simulateSiege(siege, opts = {}) {
  const atkPolicy = opts.atkPolicy || (() => siege.mode);
  const defPolicy = opts.defPolicy || (() => ({}));
  const maxXun = opts.maxXun || 60;
  let outcome = null;
  let xun = 0;
  for (; xun < maxXun; xun++) {
    siege.mode = atkPolicy(siege, xun) === 'blockade' ? 'blockade' : 'assault';
    const dp = defPolicy(siege, xun) || {};
    if (dp.sortie) {
      // 守方出城反击（同 StrategicSystem.siegeOrder 'sortie'）
      const hit = Math.round(siege.atk.troops * 0.06 + 300);
      siege.atk.troops = Math.max(0, siege.atk.troops - hit);
      siege.atk.morale = Math.max(0, siege.atk.morale - 6);
      siege.def.troops = Math.max(0, siege.def.troops - Math.round(siege.def.troops * 0.03 + 100));
    }
    siegeTick(siege);
    outcome = siegeOutcome(siege);
    if (outcome) break;
  }
  return { type: outcome ? outcome.type : 'timeout', xun: xun + 1, siege };
}

/**
 * 批量跑一组场景，返回 { byType:{type:{count,avgXun}}, total, rows:[...] }。
 * scenarios: [{ name, params, opts }]
 */
export function runWarBalance(scenarios) {
  const rows = [];
  const byType = {};
  for (const sc of scenarios) {
    const s = buildSiege(sc.params);
    const r = simulateSiege(s, sc.opts || {});
    rows.push({ name: sc.name, type: r.type, xun: r.xun, atkLeft: r.siege.atk.troops, defLeft: r.siege.def.troops });
    if (!byType[r.type]) byType[r.type] = { count: 0, xunSum: 0 };
    byType[r.type].count++;
    byType[r.type].xunSum += r.xun;
  }
  for (const t of Object.keys(byType)) {
    byType[t].avgXun = +(byType[t].xunSum / byType[t].count).toFixed(1);
    delete byType[t].xunSum;
  }
  return { byType, total: scenarios.length, rows };
}

/**
 * 标准平衡场景集：覆盖 强/中/弱攻城军 × 攻/守粮 × 突袭/公开 × 强攻/围困 策略。
 * 用于回归测试"四条路径都可达"。
 */
export function standardScenarios() {
  const sc = [];
  const push = (name, params, opts) => sc.push({ name, params, opts });
  // —— 强攻策略（attacker always assault）——
  push('强军强攻坚城(公开)', { posture: 'open', atkTroops: 20000, atkFood: 1200, defTroops: 8000, defFood: 600 },
    { atkPolicy: () => 'assault' });
  push('弱军强攻坚城(公开)', { posture: 'open', atkTroops: 6000, atkFood: 600, defTroops: 8000, defFood: 600 },
    { atkPolicy: () => 'assault' });
  push('强军突袭破城(raid)', { posture: 'raid', atkTroops: 16000, atkFood: 900, defTroops: 7000, defFood: 500 },
    { atkPolicy: () => 'assault' });
  // —— 围困策略（attacker always blockade）——
  push('围困乏粮孤城', { posture: 'open', atkTroops: 18000, atkFood: 2000, defTroops: 7000, defFood: 200 },
    { atkPolicy: () => 'blockade' });
  push('围困足粮坚城(攻方粮少)', { posture: 'open', atkTroops: 14000, atkFood: 500, defTroops: 7000, defFood: 1200 },
    { atkPolicy: () => 'blockade' });
  push('守军出城扰敌待退', { posture: 'open', atkTroops: 14000, atkFood: 700, defTroops: 8000, defFood: 1400 },
    { atkPolicy: () => 'blockade', defPolicy: (s, x) => ({ sortie: x % 2 === 1 }) });
  return sc;
}
