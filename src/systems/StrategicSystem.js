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
} from '../data/governance.js';

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
        diplomacy: {},
      };
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
  applyPolicy(gameState, factionId, policyId) {
    const f = this.getFactionState(gameState, factionId);
    if (!f) return { ok: false, reason: '势力不存在' };
    const r = applyPolicyPure(f, policyId);
    if (!r.ok) return r;
    this._applyDeltas(f, r.deltas, r.aggDeltas);
    this._publish('strategy:policy', { factionId, policyId, ...r });
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

    // 1) upkeep（产出/消耗/民心漂移）
    for (const f of Object.values(s.factions)) {
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
