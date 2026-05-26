#!/usr/bin/env node
/**
 * 战斗平衡数值模拟器（Monte Carlo）
 *
 * 用真实 CombatSystem + DiceSystem，对每个 boss 战做 N=1000 次纯模拟。
 * 不调 AI、不写日志、毫秒级出结果。比 AI vs AI playtest 快 10000 倍。
 *
 * 输出每场战斗：
 *   - 胜率（wins / runs）
 *   - 平均回合数（victory only）
 *   - 平均剩余 HP%（victory only，反映"打得多惨"）
 *   - HP% P10 / P50 / P90
 *   - 推荐 boss 难度档（easy/normal/hard/extreme）
 *
 * AI 策略（简单但能复刻 PlayerAI.decideCombat 的决策）：
 *   - 角色：有 MP 用最高 cost 的伤害技能；否则普攻；目标选 HP 最低的活敌
 *   - 敌人：普攻 HP 最低的活角色
 *
 * 用法：
 *   node scripts/combat-balance-check.mjs                                    # 默认预设
 *   node scripts/combat-balance-check.mjs --preset presets/foo.json
 *   node scripts/combat-balance-check.mjs --runs 5000 --max-rounds 50
 *   node scripts/combat-balance-check.mjs --event ev_marsh_boss               # 只跑某个事件
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CombatSystem } from '../src/systems/CombatSystem.js';
import { DiceSystem } from '../src/systems/DiceSystem.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------- CLI 参数 ----------
const argv = process.argv.slice(2);
function argVal(flag, def) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : def;
}
const PRESET_PATH = path.resolve(ROOT, argVal('--preset', 'presets/eternal-crown-stress-test.json'));
const RUNS = parseInt(argVal('--runs', '1000'), 10);
const MAX_ROUNDS = parseInt(argVal('--max-rounds', '40'), 10);
const FILTER_EVENT = argVal('--event', null);
const INCLUDE_COMPANIONS = argv.includes('--include-companions');
const PARTY_AUTO = argv.includes('--party-by-chapter');  // 按章节自动加 companion
const VERBOSE = argv.includes('--verbose');

// ---------- 工具 ----------
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

// 难度档（基于胜率）
function difficultyBand(winRate) {
  if (winRate >= 0.95) return '😴 太简单 (>95%)';
  if (winRate >= 0.80) return '✓ 容易 (80-95%)';
  if (winRate >= 0.60) return '✓ 适中 (60-80%)';
  if (winRate >= 0.35) return '⚠ 偏难 (35-60%)';
  if (winRate >= 0.10) return '❌ 过难 (10-35%)';
  return '☠ 不可通关 (<10%)';
}

// ---------- 单场战斗模拟 ----------
function simulateOne(partyTemplate, enemiesTemplate, dice, combat, maxRounds, entryHpPct = 1.0) {
  const party = deepClone(partyTemplate);
  const enemies = deepClone(enemiesTemplate);

  // 重置状态；entryHpPct 控制入场血量（1.0 = 满血，0.5 = 半血）
  for (const c of party) {
    if (c.stats) {
      c.stats.hpCurrent = Math.max(1, Math.floor(c.stats.hp * entryHpPct));
      c.stats.mpCurrent = c.stats.mp || 0;
    }
  }
  for (const e of enemies) {
    if (e.stats) { e.stats.hpCurrent = e.stats.hp; e.stats.mpCurrent = e.stats.mp || 0; }
  }

  const gameState = {
    activeCharacters: party,
    activeCombat: null,
    currentPhase: 'exploration',
  };

  combat.startCombat(gameState, enemies);

  let safety = maxRounds * (party.length + enemies.length) * 4;
  let endResult = null;
  let lastRound = 1;

  while (safety-- > 0 && gameState.activeCombat) {
    const c = gameState.activeCombat;
    lastRound = c.round;
    if (c.round > maxRounds) {
      // 超时算 stalemate（=defeat 对玩家不利）
      endResult = combat.endCombat(gameState, 'defeat');
      break;
    }
    const slot = c.turnOrder[c.currentActorIndex];
    if (!slot) {
      const r = combat.nextTurn(gameState);
      if (r.combatEnd) { endResult = r; break; }
      continue;
    }

    const combatant = combat.findCombatant(gameState, slot.id);
    if (!combatant || combatant.stats.hpCurrent <= 0) {
      const r = combat.nextTurn(gameState);
      if (r.combatEnd) { endResult = r; break; }
      continue;
    }

    if (slot.type === 'character') {
      // 玩家 AI：选活敌中 HP 最低；有 MP 用最强伤害技能，否则普攻
      const aliveEnemies = c.enemies.filter(e => e.stats.hpCurrent > 0);
      if (aliveEnemies.length === 0) {
        endResult = combat.endCombat(gameState, 'victory'); break;
      }
      const target = aliveEnemies.reduce((a, b) => a.stats.hpCurrent < b.stats.hpCurrent ? a : b);
      const dmgAbilities = (combatant.abilities || [])
        .filter(a => a.type === 'active' && a.effect && a.effect.damage)
        .filter(a => !a.cost?.mp || combatant.stats.mpCurrent >= a.cost.mp)
        .sort((a, b) => (b.cost?.mp || 0) - (a.cost?.mp || 0));
      const healAbilities = (combatant.abilities || [])
        .filter(a => a.type === 'active' && a.effect && a.effect.heal)
        .filter(a => !a.cost?.mp || combatant.stats.mpCurrent >= a.cost.mp);
      // 若自己 HP < 30% 且有自愈技能，先自愈
      const hpPct = combatant.stats.hpCurrent / combatant.stats.hp;
      if (hpPct < 0.3 && healAbilities.length > 0) {
        combat.useAbility(gameState, slot.id, healAbilities[0].id, slot.id);
      } else if (dmgAbilities.length > 0) {
        combat.useAbility(gameState, slot.id, dmgAbilities[0].id, target.id);
      } else {
        combat.performAttack(gameState, slot.id, target.id);
      }
    } else {
      // 敌人：普攻 HP 最低的活角色
      const aliveChars = party.filter(p => p.stats.hpCurrent > 0);
      if (aliveChars.length === 0) {
        endResult = combat.endCombat(gameState, 'defeat'); break;
      }
      const target = aliveChars.reduce((a, b) => a.stats.hpCurrent < b.stats.hpCurrent ? a : b);
      combat.performAttack(gameState, slot.id, target.id);
    }

    const r = combat.nextTurn(gameState);
    if (r.combatEnd) { endResult = r; break; }
  }

  // 计算结束时的剩余 HP 比例
  const hpSum = party.reduce((s, c) => s + Math.max(0, c.stats.hpCurrent), 0);
  const hpMax = party.reduce((s, c) => s + c.stats.hp, 0);
  const partyHpPct = hpMax > 0 ? hpSum / hpMax : 0;

  return {
    outcome: endResult?.result || 'timeout',
    rounds: lastRound,
    partyHpPct,
  };
}

// ---------- 多场聚合 ----------
function simulateMany(partyTemplate, enemiesTemplate, runs, maxRounds, entryHpPct = 1.0) {
  const dice = new DiceSystem();
  const combat = new CombatSystem();
  combat.diceSystem = dice;
  combat.eventSystem = null;

  let wins = 0;
  const winRounds = [];
  const winHpPct = [];
  let lossRounds = 0, lossCount = 0;

  for (let i = 0; i < runs; i++) {
    const r = simulateOne(partyTemplate, enemiesTemplate, dice, combat, maxRounds, entryHpPct);
    if (r.outcome === 'victory') {
      wins++;
      winRounds.push(r.rounds);
      winHpPct.push(r.partyHpPct);
    } else {
      lossCount++;
      lossRounds += r.rounds;
    }
  }

  return {
    runs,
    wins,
    losses: lossCount,
    winRate: wins / runs,
    avgWinRounds: +avg(winRounds).toFixed(1),
    avgLossRounds: lossCount ? +(lossRounds / lossCount).toFixed(1) : 0,
    avgWinHpPct: +avg(winHpPct).toFixed(3),
    p10WinHpPct: +percentile(winHpPct, 10).toFixed(3),
    p50WinHpPct: +percentile(winHpPct, 50).toFixed(3),
    p90WinHpPct: +percentile(winHpPct, 90).toFixed(3),
  };
}

/** 找最低安全入场 HP%：从 100% 往下试到胜率掉到目标以下 */
function findSafeEntryHp(partyTemplate, enemiesTemplate, runs, maxRounds, targetWinRate = 0.80) {
  // 二分搜索 0..1
  let lo = 0.10, hi = 1.0, mid;
  let bestPct = 1.0;
  for (let i = 0; i < 8; i++) {
    mid = (lo + hi) / 2;
    const r = simulateMany(partyTemplate, enemiesTemplate, Math.floor(runs / 4), maxRounds, mid);
    if (r.winRate >= targetWinRate) { bestPct = mid; hi = mid; } else { lo = mid; }
  }
  return +bestPct.toFixed(2);
}

// ---------- 入口：找剧本里所有 start_combat 事件 ----------
function findCombatEvents(preset) {
  const out = [];
  for (const ev of (preset.events || [])) {
    for (const ch of (ev.choices || [])) {
      for (const oc of (ch.outcomes || [])) {
        for (const eff of (oc.effects || [])) {
          if (eff.type === 'start_combat' && eff.enemyIds && eff.enemyIds.length > 0) {
            out.push({
              eventId: ev.id, eventName: ev.name,
              choiceId: ch.id, choiceText: ch.text,
              enemyIds: eff.enemyIds,
              tags: ev.tags || [],
              isBoss: (ev.tags || []).includes('boss'),
            });
          }
        }
      }
    }
  }
  return out;
}

function resolveEnemies(enemyIds, preset) {
  const enemyMap = new Map(preset.enemies.map(e => [e.id, e]));
  const out = [];
  enemyIds.forEach((id, idx) => {
    const tmpl = enemyMap.get(id);
    if (!tmpl) return;
    const clone = deepClone(tmpl);
    clone._originalId = id;
    clone.id = `${id}#${idx}`;
    out.push(clone);
  });
  return out;
}

// ---------- 主流程 ----------
function main() {
  if (!fs.existsSync(PRESET_PATH)) {
    console.error(`预设不存在: ${PRESET_PATH}`);
    process.exit(1);
  }
  const preset = JSON.parse(fs.readFileSync(PRESET_PATH, 'utf-8'));

  console.log(`\n=== 战斗平衡 Monte Carlo 模拟 ===`);
  console.log(`预设: ${preset.name} (${preset.events?.length || 0} 事件)`);
  console.log(`runs/战斗: ${RUNS}   max_rounds: ${MAX_ROUNDS}`);
  if (FILTER_EVENT) console.log(`过滤: 仅 event = ${FILTER_EVENT}`);
  console.log();

  // 默认队伍 = preset.characters 全员
  const baseParty = deepClone(preset.characters || []);
  if (baseParty.length === 0) {
    console.error('预设没有 characters，无法模拟');
    process.exit(1);
  }

  // 把 recruitable NPC 转成可加入队伍的格式
  const npcAsChar = (npc) => {
    if (!npc.stats) return null;
    const c = deepClone(npc);
    c.type = 'character';
    c._isCompanion = true;
    return c;
  };
  const recruitableMap = new Map();
  for (const npc of (preset.npcs || [])) {
    if (npc.recruitable && npc.stats) recruitableMap.set(npc.id, npcAsChar(npc));
  }

  // 全员 = baseParty + 所有 recruitable companion
  const fullParty = INCLUDE_COMPANIONS || PARTY_AUTO
    ? [...baseParty, ...Array.from(recruitableMap.values())]
    : baseParty;

  const printParty = (p, label = '队伍') => {
    console.log(`${label} (${p.length} 人):`);
    for (const c of p) {
      const ab = (c.abilities || []).filter(a => a.type === 'active' && (a.effect?.damage || a.effect?.heal)).map(a => a.id).join(',');
      console.log(`  ${c.name.padEnd(10)} HP${c.stats.hp} MP${c.stats.mp} ATK${c.stats.attack} DEF${c.stats.defense} SPD${c.stats.speed}  abilities: ${ab || '(无)'}`);
    }
    console.log();
  };

  // 按章节自动选队伍：根据 boss 事件的位置推断玩家应当招到哪些 companion
  // 简单规则：每往后一个 boss，多招一个 companion
  const partyForBoss = (eventId, allBosses) => {
    if (INCLUDE_COMPANIONS) return fullParty;  // --include-companions 强制全队
    if (!PARTY_AUTO) return fullParty;
    const idx = allBosses.findIndex(b => b.eventId === eventId);
    if (idx < 0) return baseParty;
    const recruits = Array.from(recruitableMap.values());
    // boss 0 (goblin) = base; boss 1 (marsh) = +vex; boss 2 (dragon) = +vex+lyra+aldric; boss 3 (spire) = 全员
    const numCompanions = [0, 1, 3, 4][Math.min(idx, 3)];
    return [...baseParty, ...recruits.slice(0, numCompanions)];
  };
  printParty(fullParty, '完整队伍（含可招募 companion）');

  let combats = findCombatEvents(preset);
  if (FILTER_EVENT) combats = combats.filter(c => c.eventId === FILTER_EVENT);
  if (combats.length === 0) {
    console.error('没找到 start_combat 事件');
    process.exit(1);
  }

  // 按 boss 优先排
  combats.sort((a, b) => (b.isBoss ? 1 : 0) - (a.isBoss ? 1 : 0));

  const bossList = combats.filter(c => c.isBoss);
  const reports = [];
  for (const c of combats) {
    const enemies = resolveEnemies(c.enemyIds, preset);
    if (enemies.length === 0) continue;
    // 按章节选队伍（若启用 --party-by-chapter；否则默认 baseParty 或 fullParty）
    const partyToUse = c.isBoss ? partyForBoss(c.eventId, bossList) : (PARTY_AUTO ? baseParty : fullParty);
    const t0 = Date.now();
    const fullHp = simulateMany(partyToUse, enemies, RUNS, MAX_ROUNDS, 1.0);
    let safeEntryHp = null;
    let halfHp = null;
    if (c.isBoss) {
      halfHp = simulateMany(partyToUse, enemies, Math.floor(RUNS / 2), MAX_ROUNDS, 0.5);
      if (fullHp.winRate >= 0.80) {
        safeEntryHp = findSafeEntryHp(partyToUse, enemies, RUNS, MAX_ROUNDS, 0.80);
      }
    }
    const elapsed = Date.now() - t0;
    reports.push({ ...c, enemies, partySize: partyToUse.length, result: fullHp, halfHp, safeEntryHp, elapsedMs: elapsed });
  }

  // 输出
  console.log(`战斗清单（${reports.length} 场，${reports.filter(r => r.isBoss).length} 个 boss）\n`);
  for (const rep of reports) {
    const badge = rep.isBoss ? '[BOSS]' : '[战斗]';
    console.log(`${badge} ${rep.eventName} (${rep.eventId})  [队伍 ${rep.partySize} 人]`);
    console.log(`  敌人: ${rep.enemies.map(e => `${e.name}(hp${e.stats.hp} atk${e.stats.attack})`).join(' + ')}`);
    const r = rep.result;
    console.log(`  胜率(满血入场): ${(r.winRate * 100).toFixed(1)}%  →  ${difficultyBand(r.winRate)}`);
    if (r.wins > 0) console.log(`  胜场: 平均 ${r.avgWinRounds} 回合，剩余 HP P10/P50/P90 = ${(r.p10WinHpPct * 100).toFixed(0)}% / ${(r.p50WinHpPct * 100).toFixed(0)}% / ${(r.p90WinHpPct * 100).toFixed(0)}%`);
    if (r.losses > 0) console.log(`  败场: 平均 ${r.avgLossRounds} 回合崩盘`);
    if (rep.isBoss && rep.halfHp) {
      console.log(`  半血入场胜率: ${(rep.halfHp.winRate * 100).toFixed(1)}%   ${rep.halfHp.winRate < 0.5 ? '⚠ 半血赴战风险高' : '✓ 半血也能打'}`);
    }
    if (rep.safeEntryHp !== null) {
      console.log(`  最低安全入场 HP: ${(rep.safeEntryHp * 100).toFixed(0)}%（80% 胜率阈值）`);
    }
    if (VERBOSE) console.log(`  模拟耗时: ${rep.elapsedMs}ms`);
    console.log();
  }

  // Summary
  const bossReports = reports.filter(r => r.isBoss);
  const easyBosses = bossReports.filter(r => r.result.winRate >= 0.95).length;
  const normalBosses = bossReports.filter(r => r.result.winRate >= 0.60 && r.result.winRate < 0.95).length;
  const hardBosses = bossReports.filter(r => r.result.winRate < 0.60).length;
  console.log(`=== 总结 ===`);
  console.log(`Boss 战难度分布: 太简单 ${easyBosses} / 适中 ${normalBosses} / 偏难 ${hardBosses}`);

  const totalElapsed = reports.reduce((s, r) => s + r.elapsedMs, 0);
  console.log(`总耗时: ${totalElapsed}ms (${(totalElapsed / reports.length).toFixed(0)}ms/战 × ${reports.length})`);
}

main();
