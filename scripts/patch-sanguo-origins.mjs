/**
 * 给三国主线剧本补「出身轴」(Phase 45)——使其可由主公/将领/小卒不同身份切入，
 * 与主题包同标准（startingOptions.origins.strategicRole）。
 *
 * 三国预设由 MCP preset_build_from_blueprint 确定性构建（见 generate-sanguo-preset.mjs）；
 * 该构建不产出 startingOptions，故此处对产物 public/generated/sanguo-legion-preset.json 做幂等补丁。
 * 用法：node scripts/patch-sanguo-origins.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/generated/sanguo-legion-preset.json');

const ORIGINS = [
  // 主公·刘备（ruler）：执掌蜀汉，号令征伐内政——默认主角，不改身份。
  { id: 'lord', name: '主公·刘备', icon: '👑', tags: ['rank:lord', 'literate'], strategicRole: 'ruler', statBonus: { luck: 2 },
    description: '汉室宗亲，桃园举义，志在匡复汉室——蜀汉之主，方略征伐皆决于你。' },
  // 一方裨将（officer）：统一军、亲冒矢石；暂不掌国策，立功可擢升。
  { id: 'officer', name: '蜀军裨将', icon: '🪖', tags: ['rank:officer'], strategicRole: 'officer',
    charName: '裨将', charTitle: '蜀军裨将', charDescription: '蜀汉行伍出身的一员裨将，统领一队人马，听命征战。',
    statBonus: { attack: 3, defense: 2 },
    description: '蜀军一员裨将，统一队人马、亲历阵战。国策非你所能左右，但你能在沙场上博取功名。' },
  // 行伍小卒（soldier）：涿县乡勇之一，于桃园举义的旗下从军；天下大势在幕后自转。
  { id: 'footman', name: '行伍小卒', icon: '🗡', tags: ['rank:soldier'], strategicRole: 'soldier',
    charName: '无名小卒', charTitle: '蜀军小卒', charDescription: '涿县乡里一名应募从军的无名小卒，只想在乱世里活着、挣口饱饭。',
    statBonus: { hp: 20 },
    description: '你只是涿县应募从军的乡勇之一。王侯将相的棋局与你无关，你在刀枪缝里求活，偶尔也能立些战功。' },
];

function main() {
  if (!fs.existsSync(FILE)) { console.error('未找到三国预设产物，请先跑 generate-sanguo-preset + MCP 构建：', FILE); process.exit(1); }
  const preset = JSON.parse(fs.readFileSync(FILE, 'utf8'));

  preset.startingOptions ||= {};
  preset.startingOptions.origins = ORIGINS;

  // 三种出身皆于开局场景（桃园举义/涿县募兵）切入：主公领义军，将卒投身行伍。
  const spawn = preset.startingSceneId || (preset.scenes || []).find(s => (s.tags || []).includes('spawn'))?.id || 'scene_taoyuan';
  preset.startingSceneRules = [{ default: spawn }];

  fs.writeFileSync(FILE, JSON.stringify(preset, null, 2));
  console.log(`✓ 已为三国剧本补出身轴：${ORIGINS.map(o => o.name).join(' / ')}（皆于 ${spawn} 开局）`);
}
main();
