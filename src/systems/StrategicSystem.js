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
import { battleTerritoryOutcome } from '../data/campaign.js';
import { XUN_PER_SEASON, MARCH_BASE_ETA, regionDistance, marchEta, marchDetectChance, siegeTick, siegeOutcome, postureMoraleMod } from '../data/war.js';

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

    // 作战层（Phase 41）：区域图 + 旬时钟 + 行军/围城状态（无 regions 则作战层不激活，走旧路径）
    const regions = setup?.regions || layer?.regions || null;
    gameState.strategicState = { season: 1, warXun: 0, playerFactionId, factions, regions, marches: [], sieges: [] };
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

  /**
   * 战役级连战（Phase 38）：一场军团战的领土后果。
   * battleDef 可带 attackerFactionId/defenderFactionId/objectiveHoldingId/campaignKey。
   * 返回 { flags[], narrative? }，由调用方落 worldFlags + 叙述。
   */
  recordBattleOutcome(gameState, battleDef, won) {
    const r = battleTerritoryOutcome(battleDef, won);
    let narrative = '';
    const atk = battleDef.attackerFactionId, def = battleDef.defenderFactionId;
    if (r.captureHoldingId && atk && def) {
      const t = this.transferHolding(gameState, def, atk, r.captureHoldingId);
      if (t.ok) narrative = `${this.getFactionState(gameState, atk)?.name || atk} 攻取 ${t.name}！`;
    } else if (r.loseHoldingId && atk && def) {
      const t = this.transferHolding(gameState, def, atk, r.loseHoldingId);
      if (t.ok) narrative = `${t.name} 失守，落入 ${this.getFactionState(gameState, atk)?.name || atk} 之手。`;
    }
    return { flags: r.flags, narrative };
  }

  /**
   * 构建一场敌国来犯的守城战（drawFromStrategy）：敌方为攻、玩家某城为守。
   * 返回可交 _startLegionBattle 的 battleDef；无合适目标返回 null。
   */
  buildInvasionBattle(gameState, attackerId, defenderId) {
    const atk = this.getFactionState(gameState, attackerId);
    const def = this.getFactionState(gameState, defenderId);
    if (!atk || !def) return null;
    const target = (def.holdings || []).slice().sort((a, b) => (a.security + (a.dev || 0)) - (b.security + (b.dev || 0)))[0]; // 挑最弱的城
    const atkTroops = Math.max(2000, Math.round((atk.troops || 0) * 0.5));
    return {
      battleType: 'defense', objectiveName: `${atk.name}来犯·${target?.name || '边城'}`,
      campaignKey: `invasion_${attackerId}`,
      drawFromStrategy: true, enemyFactionId: attackerId,
      attackerFactionId: attackerId, defenderFactionId: defenderId,
      objectiveHoldingId: target?.id || null,
      supply: { player: 9999, enemy: Math.max(40, Math.round((atk.food || 0) * 0.4)) },
      units: [
        { id: 'def_main', side: 'player', unitType: 'spearman', troops: Math.max(1, def.troops || 1) },
        { id: 'def_arch', side: 'player', unitType: 'archer', troops: Math.round((def.troops || 0) * 0.4) || 1 },
        { id: 'inv_main', side: 'enemy', unitType: 'infantry', troops: atkTroops },
        { id: 'inv_cav', side: 'enemy', unitType: 'cavalry', troops: Math.round(atkTroops * 0.4) || 1 },
      ],
    };
  }

  // ============================================================
  // 作战层（Phase 41）：行军 / 情报 / 旬推进 / 围城 tick
  // ============================================================
  _holdingOwner(gameState, holdingId) {
    const s = gameState.strategicState;
    for (const f of Object.values(s.factions)) if ((f.holdings || []).some(h => h.id === holdingId)) return f.factionId;
    return null;
  }
  _holdingRegion(gameState, holdingId) {
    const s = gameState.strategicState;
    for (const f of Object.values(s.factions)) { const h = (f.holdings || []).find(x => x.id === holdingId); if (h) return h.region || null; }
    return null;
  }
  /** 攻方任一城池到目标城的最短区域距离 */
  _distanceToHolding(gameState, attackerId, targetHoldingId) {
    const s = gameState.strategicState;
    if (!s.regions) return 3;
    const target = this._holdingRegion(gameState, targetHoldingId);
    const atk = this.getFactionState(gameState, attackerId);
    let best = Infinity;
    for (const h of (atk?.holdings || [])) { const d = regionDistance(s.regions, h.region, target); if (d < best) best = d; }
    return Number.isFinite(best) ? best : 3;
  }
  /** 守城主将（目标城太守的武备，用于情报半径） */
  _holdingGeneral(gameState, holdingId) {
    const s = gameState.strategicState;
    for (const f of Object.values(s.factions)) { const h = (f.holdings || []).find(x => x.id === holdingId); if (h && h.governorWarfare) return { warfare: h.governorWarfare }; }
    return null;
  }

  /** 发起行军（Phase 41）：扣兵粮组军 + 计 ETA。返回 march 或 null。 */
  launchMarch(gameState, attackerId, targetHoldingId, { posture = 'open', troops = null, generalIds = [] } = {}) {
    const s = gameState.strategicState;
    if (!s) return null;
    const atk = this.getFactionState(gameState, attackerId);
    const defenderId = this._holdingOwner(gameState, targetHoldingId);
    if (!atk || !defenderId) return null;
    const want = troops != null ? troops : Math.round((atk.troops || 0) * 0.6);
    const mobilized = this.mobilize(gameState, attackerId, want);
    if (mobilized <= 0) return null;
    const supply = Math.floor((atk.food || 0) * 0.4);
    atk.food = Math.max(0, (atk.food || 0) - supply);
    const dist = this._distanceToHolding(gameState, attackerId, targetHoldingId);
    const march = {
      id: `march_${attackerId}_${targetHoldingId}_${s.warXun}`,
      attacker: attackerId, defender: defenderId, targetHoldingId, posture,
      army: { troops: mobilized, supply, generalIds }, etaXun: marchEta(dist, posture),
      detected: false, detectedAtXun: null,
    };
    s.marches.push(march);
    this._publish('war:marchLaunched', { march });
    return march;
  }

  /** 推进一旬（Phase 41）：行军 tick + 情报揭示 + 抵达接敌 + 围城 tick。返回 events[]。 */
  advanceWarXun(gameState) {
    const s = gameState.strategicState;
    if (!s) return [];
    s.warXun = (s.warXun || 0) + 1;
    const events = [];
    const pid = s.playerFactionId;

    // 行军推进
    const arrived = [];
    for (const m of s.marches) {
      m.etaXun -= 1;
      // 情报：仅守方视角（这里关注对玩家的可见性；守方为玩家时才提示）
      if (!m.detected) {
        const remainHops = Math.max(0, Math.ceil(m.etaXun / MARCH_BASE_ETA));
        const defGen = this._holdingGeneral(gameState, m.targetHoldingId);
        const chance = marchDetectChance(remainHops, defGen, m.posture);
        if (chance > 0 && this.rng() < chance) {
          m.detected = true; m.detectedAtXun = s.warXun;
          if (m.defender === pid) events.push({ type: 'march_detected', march: m });
        }
      }
      if (m.etaXun <= 0) arrived.push(m);
    }
    for (const m of arrived) {
      s.marches = s.marches.filter(x => x !== m);
      if (m.reliefFor) {
        // 救援行军抵达 → 里应外合解围
        const r = this.applyRelief(gameState, m);
        events.push({ type: 'relief_arrived', relief: m, result: r });
      } else if (m.defender === pid) {
        events.push({ type: 'army_arrived', march: m, playerEngagement: true }); // 玩家守方 → 待玩家抉择
      } else {
        // AI 守方：自动闭城固守（建围城，后续旬推进结算）
        const r = this.resolveEngagement(gameState, m, 'hold');
        events.push({ type: 'siege_begin', siege: r.siege });
      }
    }

    // 围城推进
    for (const sg of [...s.sieges]) {
      siegeTick(sg);
      const oc = siegeOutcome(sg);
      events.push({ type: 'siege_tick', siege: sg, outcome: oc });
      if (oc) { sg._resolved = oc.type; events.push({ type: 'siege_' + oc.type, siege: sg }); }
    }
    return events;
  }

  /**
   * 接敌抉择（Phase 41 W3）：行军抵达后，守方选 sally(出城迎击) / hold(闭城固守)。
   *   sally → 返回 { kind:'battle', battleDef }（野战，交 GameSession 起战术战）
   *   hold  → 建 siege 并返回 { kind:'siege', siege }
   */
  resolveEngagement(gameState, march, choice) {
    const attacker = march.attacker, defender = march.defender, holdingId = march.targetHoldingId;
    const def = this.getFactionState(gameState, defender);
    if (choice === 'sally') {
      const garrison = def?.troops || 1;
      const atkT = march.army.troops;
      const battleDef = {
        battleType: 'field', drawFromStrategy: true, playerFactionId: defender, enemyFactionId: attacker,
        objectiveName: `${this._factionName(gameState, attacker)}犯境·野战`, campaignKey: `sally_${holdingId}`,
        supply: { player: 9999, enemy: march.army.supply },
        units: [
          { id: 'def_main', side: 'player', unitType: 'spearman', troops: garrison, generalId: march.defenderGeneralId },
          { id: 'atk_main', side: 'enemy', unitType: 'infantry', troops: atkT },
          { id: 'atk_cav', side: 'enemy', unitType: 'cavalry', troops: Math.max(1, Math.round(atkT * 0.3)) },
        ],
      };
      return { kind: 'battle', battleDef };
    }
    // hold → 围城
    const garrison = this.mobilize(gameState, defender, Math.round((def?.troops || 0) * 0.85));
    const siege = {
      id: `siege_${attacker}_${holdingId}_${gameState.strategicState.warXun}`,
      attacker, defender, holdingId, mode: march.posture === 'raid' ? 'assault' : 'blockade', xun: 0,
      atk: { troops: march.army.troops, morale: 70 + postureMoraleMod(march.posture), supply: march.army.supply },
      def: { troops: garrison, supply: Math.floor((def?.food || 0) * 0.6), morale: 70 },
      works: { gate: 220, wall: 320 }, machinePower: 30,
    };
    if (def) def.food = Math.max(0, (def.food || 0) - siege.def.supply);
    gameState.strategicState.sieges.push(siege);
    this._publish('war:siegeBegin', { siege });
    return { kind: 'siege', siege };
  }

  _factionName(gameState, id) { return gameState.strategicState?.factions?.[id]?.name || id; }

  // ============================================================
  // 围城状态机（Phase 41 W4）
  // ============================================================
  /** 玩家参与的围城（守方或攻方），无则 null */
  playerSiege(gameState) {
    const s = gameState.strategicState;
    const pid = s?.playerFactionId;
    return (s?.sieges || []).find(sg => !sg._resolved && (sg.attacker === pid || sg.defender === pid)) || null;
  }

  /**
   * 围城下令并推进一旬（Phase 41 W4）。order：
   *   hold 坚守 / sortie 强攻反击(守) / relief 求援(守,召盟友) / assault 强攻(攻) / blockade 围困(攻)
   * 返回 { narrative, outcome }（outcome 由 advanceWarXun 的 siegeTick 之外，这里立即再判一次）。
   */
  siegeOrder(gameState, siege, order, opts = {}) {
    let narrative = '';
    if (order === 'assault' || order === 'blockade') { siege.mode = order; narrative = order === 'assault' ? '攻方擂鼓强攻。' : '攻方深沟高垒，围而不攻，断我粮道。'; }
    else if (order === 'sortie') {
      // 守方出城反击：以小股精锐袭扰，挫敌兵力士气，自身亦有损
      const hit = Math.round(siege.atk.troops * 0.06 + 300);
      siege.atk.troops = Math.max(0, siege.atk.troops - hit);
      siege.atk.morale = Math.max(0, siege.atk.morale - 6);
      siege.def.troops = Math.max(0, siege.def.troops - Math.round(siege.def.troops * 0.03 + 100));
      narrative = `守军开城突袭，斩敌约 ${hit}，挫其锐气。`;
    } else if (order === 'relief') {
      const allyId = opts.allyId;
      if (allyId) { this._launchRelief(gameState, siege, allyId); narrative = `急召 ${this._factionName(gameState, allyId)} 发兵来援。`; }
      else narrative = '环顾四邻，无盟可援。';
    } else { narrative = '坚壁清野，凭城死守。'; }
    // 推进一旬（围城 tick + 全局行军/其它围城）
    const events = this.advanceWarXun(gameState);
    const oc = siege._resolved ? { type: siege._resolved } : siegeOutcome(siege);
    if (oc && !siege._resolved) siege._resolved = oc.type;
    return { narrative, outcome: oc, events };
  }

  /** 求援：从盟友城发一支救援行军，抵达后触发解围（abstract relief） */
  _launchRelief(gameState, siege, allyId) {
    const ally = this.getFactionState(gameState, allyId);
    if (!ally) return null;
    const troops = this.mobilize(gameState, allyId, Math.round((ally.troops || 0) * 0.5));
    if (troops <= 0) return null;
    const dist = this._distanceToHolding(gameState, allyId, siege.holdingId);
    const march = {
      id: `relief_${allyId}_${siege.holdingId}_${gameState.strategicState.warXun}`,
      attacker: allyId, defender: siege.attacker, targetHoldingId: siege.holdingId, posture: 'open',
      army: { troops, supply: Math.floor((ally.food || 0) * 0.3), generalIds: [] },
      etaXun: marchEta(dist, 'open'), detected: false, detectedAtXun: null, reliefFor: siege.id,
    };
    gameState.strategicState.marches.push(march);
    return march;
  }

  /** 救援行军抵达：里应外合，重创围城方（可能逼退） */
  applyRelief(gameState, reliefMarch) {
    const s = gameState.strategicState;
    const siege = (s.sieges || []).find(sg => sg.id === reliefMarch.reliefFor && !sg._resolved);
    if (!siege) { this.returnTroops(gameState, reliefMarch.attacker, reliefMarch.army.troops); return null; }
    const hit = Math.round(reliefMarch.army.troops * 0.8);
    siege.atk.troops = Math.max(0, siege.atk.troops - hit);
    siege.atk.morale = Math.max(0, siege.atk.morale - 20);
    // 援军入城助守
    siege.def.troops += Math.round(reliefMarch.army.troops * 0.5);
    const oc = siegeOutcome(siege);
    if (oc) siege._resolved = oc.type;
    return { hit, outcome: oc };
  }

  /** 围城结局结算：城破/献城/城陷→攻方取城；退兵→守方解围。清理 siege。 */
  resolveSiege(gameState, siege, outcomeType) {
    const s = gameState.strategicState;
    const attackerWins = outcomeType === 'breach' || outcomeType === 'surrender' || outcomeType === 'fallen';
    if (attackerWins) {
      this.transferHolding(gameState, siege.defender, siege.attacker, siege.holdingId);
      this.returnTroops(gameState, siege.attacker, Math.round(siege.atk.troops * 0.8));
      const def = this.getFactionState(gameState, siege.defender);
      if (def) def.order = Math.max(0, def.order - 12);
    } else { // retreat / lift：攻方退兵，守方残兵归队
      this.returnTroops(gameState, siege.attacker, Math.round(siege.atk.troops * 0.7));
      this.returnTroops(gameState, siege.defender, Math.round(siege.def.troops));
      const def = this.getFactionState(gameState, siege.defender);
      if (def) def.order = Math.min(100, def.order + 6);
    }
    s.sieges = s.sieges.filter(x => x !== siege);
    this._publish('war:siegeEnd', { siege, outcomeType, attackerWins });
    return { attackerWins };
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
        if (s.regions) {
          // 作战层：发起行军（取目标势力最弱的城；强敌公开讨伐、弱敌秘密突袭）
          const tgt = this.getFactionState(gameState, d.targetId);
          const weakest = (tgt?.holdings || []).slice().sort((a, b) => (a.security + (a.dev || 0)) - (b.security + (b.dev || 0)))[0];
          if (weakest) {
            const posture = (f.troops || 0) > (tgt?.troops || 0) * 1.5 ? 'open' : 'raid';
            this.launchMarch(gameState, f.factionId, weakest.id, { posture });
          }
        } else {
          events.push({ type: 'attack_intent', by: f.factionId, against: d.targetId });
        }
      }
    }

    // 作战层：一季 = XUN_PER_SEASON 旬，逐旬推进行军/围城；遇玩家接敌抉择则提前停（剩余旬留待抉择后再推）
    if (s.regions) {
      for (let i = 0; i < XUN_PER_SEASON; i++) {
        const xunEvents = this.advanceWarXun(gameState);
        for (const ev of xunEvents) events.push(ev);
        if (xunEvents.some(e => e.playerEngagement)) break;
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
