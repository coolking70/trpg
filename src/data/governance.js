/**
 * 内政外交数据层（Phase 33）—— 势力级国库 + 外交
 *
 * 把 `preset.strategicLayer` 的描述数据升级为可操作的战略层：每个势力一套核心资源
 * （金/粮/兵力/民心），季度政令产出兵粮、外交动作改变势力关系。与军团战（warfare.js）
 * 深耦合：内政攒兵屯粮 → 军团战用之；外交 stance 定敌友、触发战役。
 *
 * 设计原则（对齐 ecology.js / warfare.js）：纯数据 + 纯函数，无 import，runtime/MCP/模拟器共享；
 * 随机点接受可注入 rng（默认 Math.random），便于确定性测试与蒙特卡洛模拟。
 */

// ============================================================
// 资源 + 外交立场
// ============================================================
export const RESOURCE_KEYS = ['gold', 'food', 'troops', 'order']; // 金 / 粮 / 兵力 / 民心
export const ORDER_MAX = 100;       // 民心 0-100
export const ORDER_BASELINE = 60;   // 无干预时缓慢回归的基线

export const STANCES = ['ally', 'trade', 'neutral', 'rival', 'war', 'vassal'];

/** 关系值(-100..100) → 立场（仅用于初始化/软漂移；显式外交动作可强制覆盖，如宣战） */
export function stanceFromRelation(relation) {
  const r = Number(relation) || 0;
  if (r >= 70) return 'ally';
  if (r >= 30) return 'trade';
  if (r >= -20) return 'neutral';
  if (r >= -60) return 'rival';
  return 'war';
}

export function clampOrder(v) { return Math.max(0, Math.min(ORDER_MAX, Math.round(v))); }
export function clampRelation(v) { return Math.max(-100, Math.min(100, Math.round(v))); }

// ============================================================
// 季度产出：holdings 聚合产能 → 金/粮，扣兵粮消耗，民心漂移
//   factionState.agg = { population, productionEfficiency(0-200), security(0-100) }
// ============================================================
export function seasonProduction(state) {
  const agg = state.agg || {};
  const pop = Math.max(0, agg.population || 0);
  const eff = Math.max(0, Math.min(200, agg.productionEfficiency ?? 100));
  const order = clampOrder(state.order ?? ORDER_BASELINE);
  const stabilityMod = 0.5 + 0.5 * (order / ORDER_MAX); // 民心越高产出越足

  // 基础产出（以人口为本，产能与民心调节）
  const output = (pop / 500) * (eff / 100) * stabilityMod;
  const goldProduce = Math.round(output * 0.8);
  const foodProduce = Math.round(output * 1.0);
  const foodConsume = Math.round((state.troops || 0) / 100); // 每 100 兵每季耗 1 粮
  const foodNet = foodProduce - foodConsume;

  // 民心漂移：缺粮重挫；否则向基线缓慢回归
  let orderDelta;
  const foodAfter = (state.food || 0) + foodNet;
  if (foodAfter < 0) orderDelta = -12;
  else orderDelta = order < ORDER_BASELINE ? 3 : (order > ORDER_BASELINE ? -1 : 0);

  return { gold: goldProduce, food: foodNet, order: orderDelta, _foodProduce: foodProduce, _foodConsume: foodConsume };
}

// ============================================================
// 政令（季度内政）：cost 可负担才执行；effect 为对资源/聚合的修改
//   amounts 部分按势力规模缩放（pop/10000）
// ============================================================
export const POLICIES = {
  farming:   { name: '劝农', cost: { gold: 10 }, note: '兴修水利、奖励耕织，提升产能与存粮。' },
  tax:       { name: '征税', cost: {}, note: '加征赋税，充实国库，然伤民心。' },
  conscript: { name: '征兵', cost: { gold: 20, food: 10 }, note: '募集壮丁入伍，扩充兵力，民心稍损。' },
  fortify:   { name: '筑城', cost: { gold: 30 }, note: '加固城防，提升治安。' },
  relief:    { name: '赈灾', cost: { gold: 20, food: 20 }, note: '开仓放粮，安抚黎庶，民心大涨。' },
  develop:   { name: '屯田营建', cost: { gold: 25 }, note: '屯田垦荒、营建工坊，长效提升产能。' },
};
export const POLICY_KEYS = Object.keys(POLICIES);

function canAfford(state, cost) {
  for (const k of Object.keys(cost || {})) {
    if ((state[k] || 0) < cost[k]) return false;
  }
  return true;
}

/**
 * 执行一条政令（纯函数）：返回 { ok, reason, deltas{gold,food,troops,order}, aggDeltas{productionEfficiency,security}, narrative }
 * policies 可由题材覆盖。题材换皮两种方式：
 *   (a) 沿用 6 个政令 KEY（farming/tax/conscript/fortify/relief/develop），仅改 name/cost → 走内置原型效果；
 *   (b) 政令定义带 effect 字段 → 走题材自定义效果（可定义任意 KEY 的新政令）。
 *       effect: { gold?, food?, troops?, order?, productionEfficiency?, security?, scaled?:['food',...] }
 *       scaled 列出的资源项按人口规模缩放（缺省 gold/food/troops 缩放、order 不缩放）。
 */
export function applyPolicyPure(state, policyId, policies = POLICIES) {
  const p = policies[policyId];
  if (!p) return { ok: false, reason: `无此政令: ${policyId}` };
  if (!canAfford(state, p.cost)) return { ok: false, reason: '国库不足，无法施行', narrative: `${p.name}所需资源不足，未能施行。` };

  const pop = Math.max(0, state.agg?.population || 0);
  const scale = Math.max(0.5, Math.min(4, pop / 10000)); // 规模缩放
  const deltas = { gold: 0, food: 0, troops: 0, order: 0 };
  const aggDeltas = { productionEfficiency: 0, security: 0 };
  for (const k of Object.keys(p.cost || {})) deltas[k] = (deltas[k] || 0) - p.cost[k];

  if (p.effect) {
    const scaled = new Set(p.effect.scaled || ['food', 'gold', 'troops']);
    for (const k of ['gold', 'food', 'troops', 'order']) {
      if (p.effect[k] != null) deltas[k] += Math.round(p.effect[k] * (scaled.has(k) ? scale : 1));
    }
    for (const k of ['productionEfficiency', 'security']) {
      if (p.effect[k] != null) aggDeltas[k] += p.effect[k];
    }
  } else {
    switch (policyId) {
      case 'farming': deltas.food += Math.round(40 * scale); aggDeltas.productionEfficiency += 5; break;
      case 'tax': deltas.gold += Math.round(60 * scale); deltas.order -= 8; break;
      case 'conscript': deltas.troops += Math.round(800 * scale); deltas.order -= 6; break;
      case 'fortify': aggDeltas.security += 12; break;
      case 'relief': deltas.order += 15; break;
      case 'develop': aggDeltas.productionEfficiency += 10; break;
    }
  }
  return { ok: true, deltas, aggDeltas, narrative: `${p.name}施行。` };
}

// ============================================================
// 城池（HOLDINGS，Phase 37 逐城经营）—— 每城含类型/人口/营建度 dev/治安 security/太守
//   类型给产出/防御/募兵权重；势力级聚合 agg 由各城派生（见 StrategicSystem.recomputeAgg）
// ============================================================
export const HOLDING_TYPES = {
  capital:  { name: '都城', prod: 1.3, def: 1.2, recruit: 1.3 },
  city:     { name: '郡城', prod: 1.1, def: 1.0, recruit: 1.1 },
  fortress: { name: '关隘', prod: 0.6, def: 1.6, recruit: 0.9 },
  port:     { name: '港口', prod: 1.2, def: 0.9, recruit: 0.8 },
  granary:  { name: '粮仓', prod: 1.4, def: 0.8, recruit: 0.7 },
  pasture:  { name: '牧场', prod: 0.9, def: 0.8, recruit: 1.2 },
};
export const HOLDING_TYPE_KEYS = Object.keys(HOLDING_TYPES);

/** 主将武备 → 太守加成 { prod 产能乘子, security 治安加值, recruit 募兵乘子 } */
export function governorBonusFromWarfare(w) {
  if (!w) return { prod: 1, security: 0, recruit: 1 };
  return {
    prod: +(1 + (w.intellect || 0) / 300).toFixed(3),
    security: Math.round((w.command || 0) / 12),
    recruit: +(1 + (w.might || 0) / 300).toFixed(3),
  };
}

/** 一座城的有效营建度（dev × 类型产出权重 × 太守产能加成）。holdingTypes 可由题材覆盖。 */
export function holdingEffectiveDev(h, holdingTypes = HOLDING_TYPES) {
  const t = holdingTypes[h.type] || holdingTypes.city || HOLDING_TYPES.city;
  const gb = h.governorBonus || { prod: 1 };
  return (h.dev ?? 100) * t.prod * (gb.prod || 1);
}

/** 一座城的有效治安（security + 太守治安加值，夹 0–100） */
export function holdingEffectiveSecurity(h) {
  const gb = h.governorBonus || { security: 0 };
  return clampOrder((h.security ?? 50) + (gb.security || 0));
}

// ============================================================
// 外交动作：对 src→target 的 stance/relation 影响（纯函数）
//   返回 { ok, reason, srcDeltas{gold,food}, relationDelta, setStance(双向)?, narrative }
// ============================================================
export const DIPLOMACY_ACTIONS = {
  alliance:     { name: '结盟', cost: { gold: 50 }, note: '缔结盟约，共御外敌（需关系≥40）。' },
  declare_war:  { name: '宣战', cost: {}, note: '昭告天下，兴兵讨伐。' },
  sue_peace:    { name: '求和', cost: { gold: 60, food: 40 }, note: '献金帛求和，止戈休兵。' },
  tribute:      { name: '朝贡', cost: { gold: 40 }, note: '遣使纳贡，修好邦交。' },
  marriage:     { name: '联姻', cost: { gold: 40 }, note: '结秦晋之好，稳固同盟（需关系≥30）。' },
  sow_discord:  { name: '离间', cost: { gold: 30 }, note: '遣细作散布谣言，挑拨两方关系。' },
};
export const DIPLOMACY_KEYS = Object.keys(DIPLOMACY_ACTIONS);

/**
 * @param {object} srcState
 * @param {string} action
 * @param {object} rel - 当前 src→target 关系 { stance, relation }
 * @param {function} [rng]
 */
export function applyDiplomacyPure(srcState, action, rel = { stance: 'neutral', relation: 0 }, rng = Math.random, actions = DIPLOMACY_ACTIONS) {
  const a = actions[action];
  if (!a) return { ok: false, reason: `无此外交动作: ${action}` };
  if (!canAfford(srcState, a.cost)) return { ok: false, reason: '资源不足，无法施行', narrative: `${a.name}所需财货不足。` };
  const srcDeltas = {};
  for (const k of Object.keys(a.cost || {})) srcDeltas[k] = -(a.cost[k]);
  const relation = rel.relation || 0;

  switch (action) {
    case 'alliance':
      if (relation < 40) return { ok: false, reason: '关系未至，难以结盟', narrative: '对方婉拒了结盟之议。' };
      return { ok: true, srcDeltas, relationDelta: 12, setStance: 'ally', narrative: '两家缔结盟约，自此守望相助。' };
    case 'declare_war':
      return { ok: true, srcDeltas, relationDelta: -50, setStance: 'war', narrative: '战书既下，刀兵相向。' };
    case 'sue_peace':
      if (rel.stance !== 'war') return { ok: false, reason: '并未交战', narrative: '双方本无战事，无需求和。' };
      return { ok: true, srcDeltas, relationDelta: 25, setStance: 'neutral', narrative: '献金帛以求和，干戈暂息。' };
    case 'tribute':
      return { ok: true, srcDeltas, relationDelta: 15, narrative: '遣使纳贡，邦交转暖。' };
    case 'marriage':
      if (relation < 30) return { ok: false, reason: '关系未至，难议婚姻', narrative: '联姻之议未获应允。' };
      return { ok: true, srcDeltas, relationDelta: 20, setStance: 'ally', narrative: '结秦晋之好，盟谊愈固。' };
    case 'sow_discord':
      // 离间作用在「目标的对外关系」上，由系统据 rng 决定削弱幅度；此处返回意图
      return { ok: true, srcDeltas, sow: true, discordDelta: -(15 + Math.round(rng() * 15)), narrative: '细作散布流言，离间之计已施。' };
  }
  return { ok: false, reason: '未知动作' };
}

// ============================================================
// 敌国 AI：每季为一个非玩家势力选一条战略动作（轻量启发式）
//   world = { factions: { [id]: factionState }, playerId }
//   返回 { type:'policy'|'diplomacy'|'attack', ... }
// ============================================================
export function decideEnemyStrategy(state, world, rng = Math.random) {
  const prod = seasonProduction(state);
  // 1) 缺粮 → 劝农
  if ((state.food || 0) + prod.food < (state.troops || 0) / 50) return { type: 'policy', policyId: 'farming' };
  // 2) 民心低 → 赈灾
  if ((state.order ?? 60) < 35 && (state.gold || 0) >= 20) return { type: 'policy', policyId: 'relief' };
  // 3) 缺金 → 征税
  if ((state.gold || 0) < 40) return { type: 'policy', policyId: 'tax' };

  const others = Object.values(world.factions || {}).filter(f => f.factionId !== state.factionId);
  const relOf = (id) => state.diplomacy?.[id] || { stance: 'neutral', relation: 0 };

  // 4) 对处于交战且明显更弱的敌人 → 出兵进攻
  const warTargets = others.filter(f => relOf(f.factionId).stance === 'war');
  const weakEnemy = warTargets.find(f => (state.troops || 0) > (f.troops || 0) * 1.3 && (state.troops || 0) > 2000);
  if (weakEnemy) return { type: 'attack', targetId: weakEnemy.factionId };

  // 5) 强敌压境（未交战但实力碾压自己）→ 寻盟自保
  const threat = others.find(f => (f.troops || 0) > (state.troops || 0) * 1.6 && relOf(f.factionId).stance !== 'ally');
  if (threat && (state.gold || 0) >= 50) {
    const friend = others.find(f => f.factionId !== threat.factionId && relOf(f.factionId).relation >= 20);
    if (friend) return { type: 'diplomacy', action: 'alliance', targetId: friend.factionId };
  }

  // 6) 实力碾压某邻国且关系恶劣 → 宣战
  const prey = others.find(f => relOf(f.factionId).stance === 'rival' && (state.troops || 0) > (f.troops || 0) * 1.8);
  if (prey && rng() < 0.5) return { type: 'diplomacy', action: 'declare_war', targetId: prey.factionId };

  // 7) 默认：攒家底（兵少则征兵，否则屯田）
  if ((state.troops || 0) < 5000 && (state.gold || 0) >= 20 && (state.food || 0) >= 10) return { type: 'policy', policyId: 'conscript' };
  return { type: 'policy', policyId: 'develop' };
}

// ============================================================
// 校验：strategicSetup（蓝图/预设种子）
// ============================================================
export function validateStrategicSetup(setup = {}, knownFactionIds = null) {
  const errs = [];
  const ids = knownFactionIds ? new Set(knownFactionIds) : null;
  if (!setup.playerFactionId) errs.push('缺 playerFactionId');
  if (ids && setup.playerFactionId && !ids.has(setup.playerFactionId)) errs.push(`playerFactionId 未知: ${setup.playerFactionId}`);
  for (const [fid, f] of Object.entries(setup.factions || {})) {
    if (ids && !ids.has(fid)) errs.push(`未知势力: ${fid}`);
    for (const rk of RESOURCE_KEYS) {
      if (f[rk] != null && (typeof f[rk] !== 'number' || f[rk] < 0)) errs.push(`${fid}.${rk} 须为非负数`);
    }
    for (const [tid, rel] of Object.entries(f.diplomacy || {})) {
      if (ids && !ids.has(tid)) errs.push(`${fid} 外交指向未知势力: ${tid}`);
      if (rel.stance && !STANCES.includes(rel.stance)) errs.push(`${fid}→${tid} 未知立场: ${rel.stance}`);
    }
  }
  return errs;
}

/** 势力综合实力（用于 AI 判断 / 模拟器排名）：兵力为主，金粮民心为辅 */
export function factionPower(state) {
  return (state.troops || 0) + (state.gold || 0) * 2 + (state.food || 0) + (state.order || 0) * 10;
}
