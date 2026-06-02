/**
 * 战略系统（Phase 33）—— 内政外交的运行时
 *
 * 把 `preset.strategicLayer`（描述数据）/ `preset.strategicSetup`（活状态种子）初始化为
 * `gameState.strategicState`，并提供内政（政令）、外交、季度推进（含敌国 AI）的操作。
 * 与军团战（LegionWarfareSystem）深耦合：内政攒兵屯粮、外交定敌友。
 *
 * 仿 CombatSystem/LegionWarfareSystem：系统提供原语，操作 `gameState.strategicState`；
 * 随机点走 this.rng（默认 Math.random，可注入）。
 */

import { GameSystem } from '../core/GameEngine.js';
import {
  RESOURCE_KEYS, ORDER_BASELINE, clampOrder, clampRelation, stanceFromRelation,
  seasonProduction, applyPolicyPure, applyDiplomacyPure, decideEnemyStrategy, factionPower,
  HOLDING_TYPES, governorBonusFromWarfare, holdingEffectiveDev, holdingEffectiveSecurity,
} from '../data/governance.js';

const clamp200 = (v) => Math.max(0, Math.min(200, Math.round(v)));

const RELATION_FROM_STANCE = { ally: 70, vassal: 50, trade: 40, neutral: 0, rival: -40, war: -70 };

export class StrategicSystem extends GameSystem {
  constructor() {
    super('StrategicSystem');
    this.eventSystem = null;
    this.rng = Math.random;
  }
  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.eventSystem = gameEngine.getSystem('EventSystem');
  }

  // ============================================================
  // 初始化：优先 preset.strategicSetup（活状态种子），否则从 strategicLayer 描述数据推导
  //   无任何战略数据 → 不建 strategicState（向后兼容，不影响普通剧本）
  // ============================================================
  initFromPreset(gameState, preset) {
    if (!preset) return null;
    const setup = preset.strategicSetup || null;
    const layer = preset.strategicLayer || null;
    if (!setup && !layer) { gameState.strategicState = null; return null; }

    const factionMeta = new Map((preset.factions || []).map(f => [f.id, f]));
    const factions = {};

    const ids = setup
      ? Object.keys(setup.factions || {})
      : Object.keys(layer.factions || {});

    for (const id of ids) {
      const meta = factionMeta.get(id) || {};
      const seed = setup?.factions?.[id] || {};
      const desc = layer?.factions?.[id] || {};
      const holdings = this._initHoldings(seed, desc);
      const agg = seed.agg || this._aggFromHoldings(desc.holdings, desc.economy);
      factions[id] = {
        factionId: id,
        name: seed.name || meta.name || desc.name || id,
        isPlayer: false,
        gold: num(seed.gold, Math.round(agg.population / 200)),
        food: num(seed.food, Math.round(agg.population / 100)),
        troops: num(seed.troops, Math.round(agg.population * 0.05)),
        order: clampOrder(num(seed.order, ORDER_BASELINE)),
        agg,
        holdings,
        diplomacy: {},
      };
      // 有城池 → 由城池派生 agg（逐城经营，Phase 37）；无城池 → 保留聚合 agg（向后兼容）
      if (holdings.length) this.recomputeAgg(factions[id]);
    }

    // 外交关系：种子优先，否则从描述层 stance 推导；统一对称化
    for (const id of ids) {
      const seedDip = setup?.factions?.[id]?.diplomacy || null;
      const descDip = layer?.factions?.[id]?.diplomacy || null;
      if (seedDip) {
        for (const [tid, rel] of Object.entries(seedDip)) {
          if (!factions[tid]) continue;
          this._setRelationSym(factions, id, tid, rel.relation ?? RELATION_FROM_STANCE[rel.stance] ?? 0, rel.stance);
        }
      } else if (Array.isArray(descDip)) {
        for (const d of descDip) {
          const tid = d.targetFactionId;
          if (!tid || !factions[tid]) continue;
          const relation = RELATION_FROM_STANCE[d.stance] ?? 0;
          this._setRelationSym(factions, id, tid, relation, d.stance);
        }
      }
    }

    const playerFactionId = setup?.playerFactionId || layer?.playerFactionId || ids[0];
    if (factions[playerFactionId]) factions[playerFactionId].isPlayer = true;

    gameState.strategicState = { season: 1, playerFactionId, factions };
    return gameState.strategicState;
  }

  /** 从种子/描述数据构建活城池实体（Phase 37） */
  _initHoldings(seed = {}, desc = {}) {
    const raw = (Array.isArray(seed.holdings) && seed.holdings.length) ? seed.holdings : (desc.holdings || []);
    return (raw || []).map((h, i) => ({
      id: h.id || `hold_${i + 1}`,
      name: h.name || `城${i + 1}`,
      type: HOLDING_TYPES[h.type] ? h.type : 'city',
      population: Math.max(0, Math.round(h.population || 10000)),
      dev: clamp200(h.dev ?? h.productionEfficiency ?? 100),
      security: clampOrder(h.security ?? 50),
      governorId: h.governorId || null,
      governorName: h.governorName || null,
      governorBonus: h.governorWarfare ? governorBonusFromWarfare(h.governorWarfare) : null,
    }));
  }

  /** 由城池派生势力级聚合 agg（人口加权产能 + 平均治安）；无城池则保持 agg 不变 */
  recomputeAgg(f) {
    const hs = f.holdings || [];
    if (!hs.length) return;
    const pop = hs.reduce((s, h) => s + (h.population || 0), 0);
    const devSum = hs.reduce((s, h) => s + (h.population || 0) * holdingEffectiveDev(h), 0);
    f.agg = f.agg || {};
    f.agg.population = pop;
    f.agg.productionEfficiency = pop > 0 ? clamp200(devSum / pop) : 100;
    f.agg.security = Math.round(hs.reduce((s, h) => s + holdingEffectiveSecurity(h), 0) / hs.length);
    f.agg.holdingCount = hs.length;
  }

  /** 委任太守（Phase 37）：char = { id, name, warfare } 由调用方从卡牌解析 */
  appointGovernor(gameState, factionId, holdingId, char) {
    const f = this.getFactionState(gameState, factionId);
    const h = f?.holdings?.find(x => x.id === holdingId);
    if (!h || !char) return { ok: false, reason: '城池或人选不存在' };
    h.governorId = char.id; h.governorName = char.name;
    h.governorBonus = governorBonusFromWarfare(char.warfare);
    this.recomputeAgg(f);
    this._publish('strategy:governor', { factionId, holdingId, governor: char.name });
    return { ok: true, narrative: `委 ${char.name} 镇守 ${h.name}。` };
  }

  /** 城池易主（攻城得手/失地）：在两势力间转移一座城 */
  transferHolding(gameState, fromId, toId, holdingId) {
    const from = this.getFactionState(gameState, fromId);
    const to = this.getFactionState(gameState, toId);
    if (!from || !to) return { ok: false };
    const idx = (from.holdings || []).findIndex(h => h.id === holdingId);
    if (idx < 0) return { ok: false };
    const [h] = from.holdings.splice(idx, 1);
    h.governorId = null; h.governorName = null; h.governorBonus = null; // 易主后太守去职
    (to.holdings ||= []).push(h);
    this.recomputeAgg(from); this.recomputeAgg(to);
    this._publish('strategy:holdingTransfer', { fromId, toId, holdingId, name: h.name });
    return { ok: true, name: h.name };
  }

  _aggFromHoldings(holdings = [], economy = null) {
    const list = Array.isArray(holdings) ? holdings : [];
    const population = economy?.totalPopulation || list.reduce((s, h) => s + (h.population || 0), 0) || 10000;
    const eff = list.length ? Math.round(list.reduce((s, h) => s + (h.productionEfficiency ?? 100), 0) / list.length) : 100;
    const sec = list.length ? Math.round(list.reduce((s, h) => s + (h.security ?? 50), 0) / list.length) : 50;
    return { population, productionEfficiency: eff, security: sec, holdingCount: list.length };
  }

  /** 对称设置两势力关系（关系对称；war/ally/neutral 立场互镜） */
  _setRelationSym(factions, a, b, relation, stance = null) {
    const rel = clampRelation(relation);
    const st = stance || stanceFromRelation(rel);
    factions[a].diplomacy[b] = { stance: st, relation: rel };
    factions[b].diplomacy[a] = { stance: st, relation: rel };
  }

  // ============================================================
  // 查询
  // ============================================================
  getState(gameState) { return gameState.strategicState || null; }
  getFactionState(gameState, id) { return gameState.strategicState?.factions?.[id] || null; }
  getPlayerState(gameState) {
    const s = gameState.strategicState;
    return s ? s.factions[s.playerFactionId] || null : null;
  }
  relationOf(gameState, srcId, targetId) {
    return this.getFactionState(gameState, srcId)?.diplomacy?.[targetId] || { stance: 'neutral', relation: 0 };
  }

  // ============================================================
  // 内政：政令
  // ============================================================
  applyPolicy(gameState, factionId, policyId, opts = {}) {
    const f = this.getFactionState(gameState, factionId);
    if (!f) return { ok: false, reason: '势力不存在' };
    const r = applyPolicyPure(f, policyId);
    if (!r.ok) return r;
    if (f.holdings && f.holdings.length) {
      // 逐城经营（Phase 37）：资源照常入库；产能/治安改动落到目标城（无目标=全境），再派生 agg
      this._applyDeltas(f, r.deltas, {});
      const ad = r.aggDeltas || {};
      if (ad.productionEfficiency || ad.security) {
        const targets = opts.targetHoldingId ? f.holdings.filter(h => h.id === opts.targetHoldingId) : f.holdings;
        for (const h of (targets.length ? targets : f.holdings)) {
          if (ad.productionEfficiency) h.dev = clamp200((h.dev ?? 100) + ad.productionEfficiency);
          if (ad.security) h.security = clampOrder((h.security ?? 50) + ad.security);
        }
      }
      this.recomputeAgg(f);
    } else {
      this._applyDeltas(f, r.deltas, r.aggDeltas);
    }
    this._publish('strategy:policy', { factionId, policyId, targetHoldingId: opts.targetHoldingId || null, ...r });
    return r;
  }

  _applyDeltas(f, deltas = {}, aggDeltas = {}) {
    for (const k of RESOURCE_KEYS) {
      if (deltas[k]) f[k] = (f[k] || 0) + deltas[k];
    }
    f.gold = Math.max(0, f.gold); f.food = Math.max(0, f.food); f.troops = Math.max(0, f.troops);
    f.order = clampOrder(f.order);
    if (aggDeltas.productionEfficiency) f.agg.productionEfficiency = Math.max(0, Math.min(200, f.agg.productionEfficiency + aggDeltas.productionEfficiency));
    if (aggDeltas.security) f.agg.security = clampOrder(f.agg.security + aggDeltas.security);
  }

  // ============================================================
  // 外交
  // ============================================================
  applyDiplomacy(gameState, srcId, action, targetId, otherId = null) {
    const src = this.getFactionState(gameState, srcId);
    const tgt = this.getFactionState(gameState, targetId);
    if (!src || !tgt) return { ok: false, reason: '势力不存在' };
    const rel = this.relationOf(gameState, srcId, targetId);
    const r = applyDiplomacyPure(src, action, rel, this.rng);
    if (!r.ok) return r;

    // 扣成本
    for (const k of Object.keys(r.srcDeltas || {})) src[k] = Math.max(0, (src[k] || 0) + r.srcDeltas[k]);

    if (r.sow) {
      // 离间：降低 target 与 otherId 的关系（otherId 缺省取 target 关系最好的一方）
      const other = otherId && this.getFactionState(gameState, otherId)
        ? otherId
        : this._bestFriendOf(gameState, targetId, srcId);
      if (other) {
        const cur = this.relationOf(gameState, targetId, other).relation;
        this._setRelationSym(gameState.strategicState.factions, targetId, other, cur + r.discordDelta);
        r.discordTargets = [targetId, other];
      }
    } else {
      const newRel = clampRelation(rel.relation + (r.relationDelta || 0));
      this._setRelationSym(gameState.strategicState.factions, srcId, targetId, newRel, r.setStance || null);
    }
    this._publish('strategy:diplomacy', { srcId, action, targetId, ...r });
    return r;
  }

  _bestFriendOf(gameState, id, exclude) {
    const f = this.getFactionState(gameState, id);
    if (!f) return null;
    let best = null, bestRel = -101;
    for (const [tid, rel] of Object.entries(f.diplomacy || {})) {
      if (tid === exclude) continue;
      if ((rel.relation ?? 0) > bestRel) { bestRel = rel.relation; best = tid; }
    }
    return best;
  }

  // ============================================================
  // 动员：从兵力池抽出一支出征军（返回实际兵数）
  // ============================================================
  mobilize(gameState, factionId, amount) {
    const f = this.getFactionState(gameState, factionId);
    if (!f) return 0;
    const n = Math.max(0, Math.min(f.troops || 0, Math.round(amount || 0)));
    f.troops -= n;
    return n;
  }

  /** 战后回收/补充兵力（残部归队） */
  returnTroops(gameState, factionId, amount) {
    const f = this.getFactionState(gameState, factionId);
    if (f) f.troops = (f.troops || 0) + Math.max(0, Math.round(amount || 0));
  }

  // ============================================================
  // 季度推进：全势力 upkeep + 敌国 AI + 事件产出
  // ============================================================
  advanceSeason(gameState) {
    const s = gameState.strategicState;
    if (!s) return { events: [] };
    const events = [];

    // 1) upkeep（产出/消耗/民心漂移）；有城池则先由城池派生最新 agg
    for (const f of Object.values(s.factions)) {
      if (f.holdings && f.holdings.length) this.recomputeAgg(f);
      const prod = seasonProduction(f);
      this._applyDeltas(f, { gold: prod.gold, food: prod.food, order: prod.order });
      if (prod.food < 0 && f.food <= 0) events.push({ type: 'famine', faction: f.factionId });
    }

    // 2) 敌国 AI（非玩家势力各行一策）
    for (const f of Object.values(s.factions)) {
      if (f.isPlayer) continue;
      const d = decideEnemyStrategy(f, { factions: s.factions, playerId: s.playerFactionId }, this.rng);
      if (!d) continue;
      if (d.type === 'policy') {
        this.applyPolicy(gameState, f.factionId, d.policyId);
      } else if (d.type === 'diplomacy') {
        const before = this.relationOf(gameState, f.factionId, d.targetId).stance;
        const r = this.applyDiplomacy(gameState, f.factionId, d.action, d.targetId);
        if (r.ok && d.action === 'declare_war' && before !== 'war') {
          events.push({ type: 'war_declared', by: f.factionId, against: d.targetId });
        }
      } else if (d.type === 'attack') {
        events.push({ type: 'attack_intent', by: f.factionId, against: d.targetId });
      }
    }

    s.season += 1;
    this._publish('strategy:season', { season: s.season, events });
    return { events, season: s.season };
  }

  /** 势力排名（按综合实力） */
  ranking(gameState) {
    const s = gameState.strategicState;
    if (!s) return [];
    return Object.values(s.factions)
      .map(f => ({ factionId: f.factionId, name: f.name, power: factionPower(f), troops: f.troops }))
      .sort((a, b) => b.power - a.power);
  }

  _publish(topic, payload) { if (this.eventSystem) this.eventSystem.publish(topic, payload); }

  destroy() { this.eventSystem = null; super.destroy(); }
}

function num(v, def) { return (typeof v === 'number' && !Number.isNaN(v)) ? v : def; }
