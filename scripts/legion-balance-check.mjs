#!/usr/bin/env node
/**
 * 军团战平衡数值模拟器 CLI（Phase 31 L5）—— 薄包装
 *
 * 核心逻辑在 src/systems/legionSimulator.js（runtime/MCP/测试共享）；本文件只做命令行。
 *
 * 用法：
 *   node scripts/legion-balance-check.mjs --preset /tmp/sanguo.json
 *   node scripts/legion-balance-check.mjs --preset /tmp/sanguo.json --event ev_ch_guandu_legion_1 --runs 2000
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { simulateLegionBattle, collectLegionBattles } from '../src/systems/legionSimulator.js';

export { simulateLegionBattle, collectLegionBattles, simulateOnce, makeSeededRng, balanceFlag } from '../src/systems/legionSimulator.js';

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const argVal = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : def; };
  const presetPath = argVal('--preset', null);
  const onlyEvent = argVal('--event', null);
  const runs = Number(argVal('--runs', 1000));
  const seed = Number(argVal('--seed', 12345));
  if (!presetPath) { console.error('需要 --preset <path>'); process.exit(1); }

  const preset = JSON.parse(fs.readFileSync(path.resolve(presetPath), 'utf-8'));
  let battles = collectLegionBattles(preset);
  if (onlyEvent) battles = battles.filter(b => b.eventId === onlyEvent);
  if (battles.length === 0) { console.log('（该预设无 start_legion_battle 军团战）'); process.exit(0); }

  console.log(`\n军团战平衡模拟 — ${preset.name || presetPath}（每场 ${runs} 次）\n`);
  const btName = { field: '野战', siege: '攻城', defense: '守城', naval: '水战' };
  for (const b of battles) {
    const r = simulateLegionBattle(b.battle, { runs, seed });
    console.log(`【${b.eventName}】(${btName[b.battleType] || b.battleType})`);
    console.log(`  我方胜率 ${(r.winRate * 100).toFixed(1)}%  ${r.flag}`);
    console.log(`  平均回合 ${r.avgRounds}  我军损耗 ${(r.avgPlayerLoss * 100).toFixed(0)}%  敌军损耗 ${(r.avgEnemyLoss * 100).toFixed(0)}%${r.timeouts ? `  (超时 ${r.timeouts})` : ''}\n`);
  }
}
