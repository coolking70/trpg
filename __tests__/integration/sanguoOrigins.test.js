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

  test('行伍小卒 → soldier，无号令权、主角身份改写', async () => {
    const s = await load('footman');
    expect(s.gameState.strategicState.playerRole).toBe('soldier');
    expect(s.sys('StrategicSystem').playerCommands(s.gameState)).toBe(false);
    expect(s.gameState.activeCharacters[0].name).toBe('无名小卒');
    // 底层视角：getState 不给指挥选项
    const st = s.getState();
    expect(st.options.some(o => o.type === 'govern')).toBe(false);
    expect(st.strategy.playerRole).toBe('soldier');
    s.destroy();
  });

  test('蜀军裨将 → officer，亦无国策号令权', async () => {
    const s = await load('officer');
    expect(s.gameState.strategicState.playerRole).toBe('officer');
    expect(s.sys('StrategicSystem').playerCommands(s.gameState)).toBe(false);
    expect(s.gameState.activeCharacters[0].name).toBe('裨将');
    s.destroy();
  });
});
