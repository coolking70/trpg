/**
 * 给三国主线剧本补「出身轴」(Phase 45/46)——使其可由主公/将领/小卒不同身份切入，
 * 与主题包同标准。全部基于引擎的通用能力（非剧本特例）：
 *   - startingOptions.origins[*].strategicRole  → 决定 playerRole（Phase 43）
 *   - origins[*].stats / charName / startSceneId → 出身定制属性/身份/开局场景（Phase 46，通用）
 *   - 事件 trigger.condition.requirePlayerRole    → 主角本位主线事件仅对 ruler 触发（Phase 46，通用）
 *
 * 三国预设由 MCP preset_build_from_blueprint 确定性构建（见 generate-sanguo-preset.mjs）；
 * 该构建不产出 startingOptions，故此处对产物 public/generated/sanguo-legion-preset.json 做幂等补丁。
 * 用法：node scripts/patch-sanguo-origins.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/generated/sanguo-legion-preset.json');
const JUNYING = 'scene_junying'; // 底层出身的开局场景（军营/投军处）

const ORIGINS = [
  // 主公·刘备（ruler）：执掌蜀汉，号令征伐内政——默认主角，保留其属性卡，于桃园开局。
  { id: 'lord', name: '主公·刘备', icon: '👑', tags: ['rank:lord', 'literate'], strategicRole: 'ruler',
    statBonus: { luck: 2 }, startSceneId: 'scene_taoyuan',
    description: '汉室宗亲，桃园举义，志在匡复汉室——蜀汉之主，方略征伐皆决于你。' },
  // 一方裨将（officer）：统一军、亲冒矢石；暂不掌国策，立功可擢升。自有一套行伍属性。
  { id: 'officer', name: '蜀军裨将', icon: '🪖', tags: ['rank:officer'], strategicRole: 'officer',
    charName: '裨将', charTitle: '蜀军裨将', charDescription: '蜀汉行伍出身的一员裨将，统领一队人马，听命征战。',
    stats: { hp: 70, hpCurrent: 70, mp: 0, mpCurrent: 0, attack: 11, defense: 7, speed: 7, luck: 2 },
    startSceneId: JUNYING,
    description: '蜀军一员裨将，统一队人马、亲历阵战。国策非你所能左右，但你能在沙场上博取功名。' },
  // 行伍小卒（soldier）：投军的无名乡勇；天下大势在幕后自转，自有一套小卒属性。
  { id: 'footman', name: '行伍小卒', icon: '🗡', tags: ['rank:soldier'], strategicRole: 'soldier',
    charName: '无名小卒', charTitle: '蜀军小卒', charDescription: '应募从军的无名小卒，只想在乱世里活着、挣口饱饭。',
    stats: { hp: 46, hpCurrent: 46, mp: 0, mpCurrent: 0, attack: 8, defense: 5, speed: 6, luck: 1 },
    startSceneId: JUNYING,
    description: '你只是应募从军的乡勇之一。王侯将相的棋局与你无关，你在刀枪缝里求活，偶尔也能立些战功。' },
];

function main() {
  if (!fs.existsSync(FILE)) { console.error('未找到三国预设产物，请先跑 generate-sanguo-preset + MCP 构建：', FILE); process.exit(1); }
  const preset = JSON.parse(fs.readFileSync(FILE, 'utf8'));

  // 1) 出身轴
  preset.startingOptions ||= {};
  preset.startingOptions.origins = ORIGINS;

  // 2) 军营开局场景（底层出身）——幂等添加；连回桃园（义军大营），便于探索。
  preset.scenes ||= [];
  if (!preset.scenes.some(s => s.id === JUNYING)) {
    preset.scenes.push({
      id: JUNYING, name: '行伍军营', type: 'settlement', icon: '⛺', coords: { x: 0, y: 2 },
      tags: ['spawn'],
      description: '蜀军大营一隅。新卒在此操练、候命，老兵围着篝火低声议论前线的胜负与各路诸侯的动向。',
      connections: [{ to: 'scene_taoyuan', label: '前往 义军大营（桃园）' }],
      events: [], vignettes: [],
    });
  }
  preset.startingSceneRules = [{ default: 'scene_taoyuan' }];

  // 3) 主角本位的主线事件仅对 ruler 触发——底层视角不被强行卷入主公的剧情。
  let gated = 0;
  for (const ev of (preset.events || [])) {
    if (!(ev.tags || []).includes('main')) continue;
    ev.trigger ||= { type: 'composite', condition: {} };
    ev.trigger.condition ||= {};
    ev.trigger.condition.requirePlayerRole = ['ruler'];
    gated++;
  }

  fs.writeFileSync(FILE, JSON.stringify(preset, null, 2));
  console.log(`✓ 三国出身轴：${ORIGINS.map(o => o.name).join(' / ')}`);
  console.log(`  · 底层出身于「行伍军营」开局；主公于桃园开局`);
  console.log(`  · ${gated} 个主线事件已限定 ruler 触发（底层视角靠 静观时局/请缨参战 体验战争）`);
}
main();
