/**
 * 三国主线剧本「出身轴」集成测试（Phase 45）
 * 验证：补丁后的三国预设可由 主公/裨将/小卒 不同身份切入，决定 playerRole 与主角身份。
 */
import fs from 'fs';
import path from 'path';
import { GameSession } from '../../src/core/GameSession.js';

const PRESET = path.resolve(process.cwd(), 'public/generated/sanguo-legion-preset.json');
const preset = JSON.parse(fs.readFileSync(PRESET, 'utf8'));

async function load(originId) {
  const s = new GameSession({ combatMode: 'interactive' });
  s.loadPreset(JSON.parse(JSON.stringify(preset)), { origins: originId });
  s.configureAI({ endpoint: '' });
  await s.kickoff();
  return s;
}

describe('Phase 45 — 三国出身轴', () => {
  test('预设已含三档出身（ruler/officer/soldier）', () => {
    const origins = preset.startingOptions?.origins || [];
    const roles = origins.map(o => o.strategicRole).sort();
    expect(roles).toEqual(['officer', 'ruler', 'soldier']);
  });

  test('主公·刘备 → ruler，号令蜀汉', async () => {
    const s = await load('lord');
    expect(s.gameState.strategicState.playerRole).toBe('ruler');
    expect(s.gameState.strategicState.playerFactionId).toBe('shu');
    expect(s.sys('StrategicSystem').playerCommands(s.gameState)).toBe(true);
    expect(s.gameState.activeCharacters[0].name).toBe('刘备'); // 主公身份不改
    s.destroy();
  });

  test('行伍小卒 → soldier，无号令权、身份/属性/开局场景皆改写', async () => {
    const s = await load('footman');
    expect(s.gameState.strategicState.playerRole).toBe('soldier');
    expect(s.sys('StrategicSystem').playerCommands(s.gameState)).toBe(false);
    const pc = s.gameState.activeCharacters[0];
    expect(pc.name).toBe('无名小卒');
    expect(pc.stats.hp).toBe(46);            // 出身定制的小卒属性（非继承刘备高数值）
    expect(pc.stats.hpCurrent).toBe(46);
    // 开局在军营，而非被塞进桃园主线事件
    expect(s.gameState.mapState.currentSceneId).toBe('scene_junying');
    const st = s.getState();
    expect(st.situation).not.toBe('event');   // 主线事件不强加于小卒
    expect(st.options.some(o => o.type === 'govern')).toBe(false);
    expect(st.strategy.playerRole).toBe('soldier');
    s.destroy();
  });

  test('蜀军裨将 → officer，定制属性 + 军营开局', async () => {
    const s = await load('officer');
    expect(s.gameState.strategicState.playerRole).toBe('officer');
    expect(s.sys('StrategicSystem').playerCommands(s.gameState)).toBe(false);
    expect(s.gameState.activeCharacters[0].name).toBe('裨将');
    expect(s.gameState.activeCharacters[0].stats.hp).toBe(70);
    expect(s.gameState.mapState.currentSceneId).toBe('scene_junying');
    s.destroy();
  });

  test('主线事件已限定 ruler 触发（requirePlayerRole）', () => {
    const mains = (preset.events || []).filter(e => (e.tags || []).includes('main'));
    expect(mains.length).toBeGreaterThan(0);
    expect(mains.every(e => (e.trigger?.condition?.requirePlayerRole || []).includes('ruler'))).toBe(true);
  });
});
