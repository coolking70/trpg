/**
 * 叙事化战争层数据（Phase 41）—— 纯数据 + 纯函数
 *
 * 在战术层（warfare.js / LegionWarfareSystem）之上提供"作战层"：
 * 地理（区域邻接图）→ 行军时间；情报（势力范围 + 主将能力）→ 探敌半径；
 * 行军姿态（突袭/公开）→ 明暗取舍；围城（强攻/围困）→ 消耗战与胜负。
 *
 * 设计：无 import、可注入 rng、确定性可测。状态对象由 StrategicSystem 持有，本文件只算。
 */

// ============================================================
// 时钟 + 地理
// ============================================================
export const XUN_PER_SEASON = 3;          // 一季 = 3 旬
export const MARCH_BASE_ETA = 2;          // 每跨 1 区域基准 2 旬

/** 区域邻接图最短跳数（BFS）。同区域=0，不可达=Infinity。 */
export function regionDistance(regions, from, to) {
  if (!regions || !from || !to) return Infinity;
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from], dist = 0;
  while (frontier.length) {
    dist++;
    const next = [];
    for (const r of frontier) {
      for (const adj of (regions[r]?.adjacency || [])) {
        if (adj === to) return dist;
        if (!seen.has(adj)) { seen.add(adj); next.push(adj); }
      }
    }
    frontier = next;
    if (dist > 64) break;
  }
  return Infinity;
}

// ============================================================
// 行军姿态（明暗取舍）
// ============================================================
export const MARCH_POSTURES = {
  raid: { name: '突袭', detect: 0.30, allyResponse: false, attackerMorale: 0, defenderPrep: 0.35, etaFactor: 0.85 },
  open: { name: '公开讨伐', detect: 0.90, allyResponse: true, attackerMorale: 12, defenderPrep: 1.0, etaFactor: 1.0 },
};
export const POSTURE_KEYS = Object.keys(MARCH_POSTURES);

/** 行军 ETA（旬）：距离越远越久；突袭略快。adjacent(距离1)也需时间，杜绝"一回合兵临城下"。 */
export function marchEta(distance, posture = 'open') {
  const p = MARCH_POSTURES[posture] || MARCH_POSTURES.open;
  const d = Number.isFinite(distance) ? distance : 3;
  return Math.max(1, Math.round((d + 1) * MARCH_BASE_ETA * p.etaFactor));
}

export function postureMoraleMod(posture) {
  return (MARCH_POSTURES[posture] || MARCH_POSTURES.open).attackerMorale;
}

// ============================================================
// 情报：势力范围 + 守城主将能力 → 探敌半径与探测概率
// ============================================================
/** 主将情报半径（可见多少跳内的敌军动向）。无主将=1。 */
export function intelRange(general) {
  if (!general) return 1; // 无守将：仅本地（1 跳）
  const w = general.warfare || general || {};
  const intellect = w.intellect ?? 50;
  const command = w.command ?? 50;
  return 1 + Math.floor((intellect + command) / 70); // 普通~1-2，名士~2-3
}

/**
 * 某旬侦得一支行军的概率：超出守将情报半径=0；半径内则按姿态探测度（突袭难、公开易），
 * 距离越近越易。一旦侦得由系统置 detected=true。
 */
export function marchDetectChance(distanceToDefender, defenderGeneral, posture) {
  const range = intelRange(defenderGeneral);
  if (!Number.isFinite(distanceToDefender) || distanceToDefender > range) return 0;
  const base = (MARCH_POSTURES[posture] || MARCH_POSTURES.open).detect;
  const proximity = 1 - Math.min(0.6, distanceToDefender * 0.2); // 越近越易
  return Math.max(0, Math.min(1, base * proximity));
}

// ============================================================
// 围城：每旬消耗（强攻 assault / 围困 blockade）
//   siege = { mode, atk:{troops,morale,supply}, def:{troops,supply,morale}, works:{gate,wall}, machinePower }
//   返回应用到 siege 的"变化量"摘要，并就地修改 siege（夹取非负 / 0-100 士气）
// ============================================================
export function siegeTick(siege) {
  const m = siege.mode === 'blockade' ? 'blockade' : 'assault';
  const atk = siege.atk, def = siege.def, works = siege.works || { gate: 0, wall: 0 };
  const mp = Math.max(0, siege.machinePower || 0); // 器械加成（投石/攻城锤）
  let d;
  if (m === 'assault') {
    // 强攻：城防伤大、攻方重耗、守方中耗、攻方耗粮、久攻士气挫
    const gateDmg = 14 + Math.round(mp * 0.4) + Math.round(atk.troops / 1500);
    d = {
      works: { gate: -gateDmg, wall: -Math.round(gateDmg * 0.3) },
      atk: { troops: -Math.round(atk.troops * 0.05 + 200), morale: -3, supply: -8 },
      def: { troops: -Math.round(def.troops * 0.035 + 120), morale: -2, supply: -4 },
    };
  } else {
    // 围困：城防伤极小、断守方粮（大）、双方缓慢减员、攻方久围士气/粮亦降
    d = {
      works: { gate: -2, wall: 0 },
      atk: { troops: -Math.round(atk.troops * 0.01 + 30), morale: -2, supply: -10 },
      def: { troops: -Math.round(def.troops * 0.015 + 40), morale: -3, supply: -Math.round(20 + def.troops / 400) },
    };
  }
  // 应用
  const clamp0 = (v) => Math.max(0, v);
  const clampM = (v) => Math.max(0, Math.min(100, v));
  works.gate = clamp0((works.gate || 0) + d.works.gate);
  works.wall = clamp0((works.wall || 0) + d.works.wall);
  atk.troops = clamp0(atk.troops + d.atk.troops); atk.morale = clampM(atk.morale + d.atk.morale); atk.supply = clamp0(atk.supply + d.atk.supply);
  def.troops = clamp0(def.troops + d.def.troops); def.morale = clampM(def.morale + d.def.morale); def.supply = clamp0(def.supply + d.def.supply);
  siege.works = works; siege.xun = (siege.xun || 0) + 1;
  return d;
}

/**
 * 围城结局判定（每旬 tick 后调用）。返回 null 或 { type, ... }：
 *   breach   攻方破门 → 强攻得手（可接战术巷战或直接陷城）
 *   surrender 守方粮尽 → 献城
 *   fallen    守军尽没 → 城陷
 *   retreat   攻方粮尽/士气崩/兵力过损 → 退兵（守方解围）
 */
export function siegeOutcome(siege) {
  const { atk, def, works } = siege;
  if (def.troops <= 0) return { type: 'fallen' };
  if (def.supply <= 0) return { type: 'surrender' };
  if ((works.gate || 0) <= 0) return { type: 'breach' };
  if (atk.supply <= 0 || atk.morale <= 15 || atk.troops <= Math.max(300, def.troops * 0.4)) return { type: 'retreat' };
  return null;
}

// ============================================================
// 校验
// ============================================================
export function validateRegions(regions) {
  const errs = [];
  if (!regions || typeof regions !== 'object') return ['regions 缺失'];
  const ids = new Set(Object.keys(regions));
  for (const [id, r] of Object.entries(regions)) {
    for (const a of (r.adjacency || [])) {
      if (!ids.has(a)) errs.push(`区域 ${id} 邻接未知区域 ${a}`);
    }
  }
  return errs;
}
