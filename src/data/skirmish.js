/**
 * 局部战斗（Skirmish，Phase 44）—— 纯函数层。
 *
 * 小兵实战参战：少数人组成的小队连续战斗，是战略层一场大战（围城/野战）里被"放大镜"
 * 聚焦的一小片战线。复用默认战斗的伤害口径；额外引入：
 *   - 小队士气（morale）：随战损下挫，决定溃逃/投降等非全灭结局；
 *   - 战线 tide（-1..+1）：父战斗的攻守强弱，决定援兵补充的快慢/多寡（有利→我方更易来援、敌士气更低）；
 *   - 多样结局：胜（敌溃/降/俘）、败（我溃/被俘）、上级令撤退/鸣金收兵。
 *
 * 局部时间放缓：一场 skirmish 在战略时钟上几乎不占时间（见 SkirmishSystem，不推进季/旬）。
 */

export const SKIRMISH_MORALE_MAX = 100;
export const SKIRMISH_MORALE_BREAK = 35;   // 低于此：可能溃逃/投降
export const SKIRMISH_SURRENDER_FLOOR = 16; // 极低：倾向投降/被俘而非溃逃
export const MORALE_LOSS_K = 1.6;          // 战损比 → 士气挫的放大系数（损失约 40% 即逼近崩溃）

/**
 * 一方的有效士气：随"已投入兵力中的伤亡比例"下挫（损失越大越崩），叠加临时加成（鼓舞/援军到场）。
 *   committed=已登场人数（初始+援军），deaths=阵亡数。故持续得到援军补充的一方更耐久。
 */
export function effectiveMorale(s, side) {
  const deaths = s.deaths?.[side] || 0;
  const committed = Math.max(1, s.committed?.[side] || 1);
  const base = SKIRMISH_MORALE_MAX * (1 - (deaths / committed) * MORALE_LOSS_K);
  return Math.max(0, Math.min(100, base + (s.moraleBonus?.[side] || 0)));
}

/** 伤害：mirror CombatSystem —— (d20+atk) - def + d6，最小 1，不超过目标剩余 HP。rng()∈[0,1) */
export function skirmishDamage(attacker, defender, rng = Math.random) {
  const d20 = 1 + Math.floor(rng() * 20);
  const d6 = 1 + Math.floor(rng() * 6);
  const atk = attacker.atk ?? attacker.attack ?? 5;
  const def = defender.def ?? defender.defense ?? 0;
  const raw = Math.max(0, d20 + atk - def);
  return Math.max(1, raw + d6);
}

/** 命中后给攻方一点士气、守方一点士气挫（小幅） */
export function moraleAfterHit() { return { attacker: +2, defender: -4 }; }

/**
 * 援兵补充判定：战损出现后，某方是否有援兵进场。
 *   有利战线(tide>0)利于我方(ally)来援、抑制敌方(enemy)；不利则相反。
 * @returns {boolean}
 */
export function reinforcementChance(side, tide, reserves, rng = Math.random) {
  if ((reserves || 0) <= 0) return false;
  const t = Math.max(-1, Math.min(1, tide || 0));
  // 基准 0.45；我方随 tide 上升、敌方随 tide 下降
  const base = 0.45 + (side === 'ally' ? t : -t) * 0.35;
  return rng() < Math.max(0.08, Math.min(0.9, base));
}

/**
 * 结局判定（每轮结束调用）。优先级：双方仍有战力→相持(null)；某方战力耗尽且无援→分胜负；
 *   士气崩→溃逃/投降；上级鸣金（由 SkirmishSystem 据 tide 触发，作为 forcedRecall 传入）。
 * @param {object} s skirmish 状态
 * @param {object} [opts] { forcedRecall:bool }
 * @returns {null | { type, winner }} type: victory|defeat|rout_enemy|rout_ally|surrender_enemy|surrender_ally|recall|captured
 */
export function skirmishOutcome(s, opts = {}) {
  // 注：本函数在"援兵补充波次"之后调用——即 living 已反映本轮是否有援军及时补入。
  //   reserves 只决定援兵补充的快慢/多寡（见 reinforcementChance），不直接作为终局条件：
  //   一方在场无人、且援军未能及时赶到，即视为这片战线被打垮。
  const allyAlive = (s.allies || []).some(u => u.hp > 0);
  const enemyAlive = (s.enemies || []).some(u => u.hp > 0);

  // 玩家个人被打倒、我方当面已无人 → 力战被擒
  const player = (s.allies || []).find(u => u.isPlayer);
  if (player && player.hp <= 0 && !allyAlive) return { type: 'captured', winner: 'enemy' };
  if (!allyAlive) return { type: 'defeat', winner: 'enemy' };
  if (!enemyAlive) return { type: 'victory', winner: 'ally' };

  // 上级命令撤退/鸣金（由系统据战线大势触发）
  if (opts.forcedRecall) return { type: 'recall', winner: null };

  // 士气崩 → 溃逃或投降（按战损比，损失约四成即可能崩，先于全灭发生）
  const em = effectiveMorale(s, 'enemy');
  const am = effectiveMorale(s, 'ally');
  if (em < SKIRMISH_MORALE_BREAK) {
    return em < SKIRMISH_SURRENDER_FLOOR
      ? { type: 'surrender_enemy', winner: 'ally' }
      : { type: 'rout_enemy', winner: 'ally' };
  }
  if (am < SKIRMISH_MORALE_BREAK) {
    return am < SKIRMISH_SURRENDER_FLOOR
      ? { type: 'surrender_ally', winner: 'enemy' }
      : { type: 'rout_ally', winner: 'enemy' };
  }
  return null;
}

/** 上级鸣金概率：战线越不利、相持越久越可能被召回休整（避免无谓消耗）。 */
export function recallChance(tide, round, rng = Math.random) {
  const t = Math.max(-1, Math.min(1, tide || 0));
  // 不利(t<0)时基准更高；随回合数缓增
  const base = (t < 0 ? 0.06 : 0.02) + Math.max(0, round - 4) * 0.02;
  return rng() < Math.min(0.4, base);
}

/** 结局对玩家战功的换算（kills 已在过程累计；此处给结局奖励/惩罚系数） */
export function outcomeMeritBonus(type) {
  switch (type) {
    case 'victory': case 'surrender_enemy': return 30;
    case 'rout_enemy': return 20;
    case 'recall': return 6;
    case 'defeat': case 'rout_ally': case 'surrender_ally': return 2;
    case 'captured': return 0;
    default: return 0;
  }
}

/**
 * 行伍晋升阶梯（按累计战功）。达 commander 级 → 转为战略参与（指挥官身份）。
 * minMerit 为升至该级所需累计战功。
 */
export const SOLDIER_RANKS = [
  { tier: 0, name: '士卒', minMerit: 0 },
  { tier: 1, name: '什长', minMerit: 70 },
  { tier: 2, name: '队率', minMerit: 180 },
  { tier: 3, name: '屯长', minMerit: 360 },
  { tier: 4, name: '军候', minMerit: 620, commander: true }, // 升至军候即获号令一军之权 → 战略模式
];

/** 据累计战功返回当前军衔（取满足 minMerit 的最高一档） */
export function rankForMerit(merit) {
  let r = SOLDIER_RANKS[0];
  for (const x of SOLDIER_RANKS) { if ((merit || 0) >= x.minMerit) r = x; }
  return r;
}

export const OUTCOME_LABEL = {
  victory: '全歼当面之敌',
  rout_enemy: '当面之敌溃散奔逃',
  surrender_enemy: '当面之敌力竭乞降',
  defeat: '我部当面失利',
  rout_ally: '我部阵脚崩溃、四散奔逃',
  surrender_ally: '残部力竭、被迫放下兵器',
  recall: '上级鸣金，奉命撤回休整',
  captured: '你力战被擒',
};
