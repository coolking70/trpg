/**
 * 战略动作 × AI 权限阶梯 集成测试（Phase 35）
 * 验证：内政外交动作受参与度阶梯门控；AI 据玩家进谏经 _applyEngineActions 落实；
 *       say 自由文本路由到 AI GM；高权限下 strategy 快照给出进言提示。
 */

import { requiredAuthority, filterActionsByAuthority, AI_AUTHORITY } from '../../src/systems/AIAuthority.js';
import { AIGMEngine } from '../../src/systems/AIGMEngine.js';
import { StrategicSystem } from '../../src/systems/StrategicSystem.js';
import { GameSession } from '../../src/core/GameSession.js';

const strategyPreset = () => ({
  presetId: 't', name: '战略AI测试', author: 't', lore: { worldName: '汉末' },
  factions: [{ id: 'shu', name: '蜀' }, { id: 'wu', name: '吴' }, { id: 'wei', name: '魏' }],
  characters: [{ id: 'char_player', name: '主公', stats: { hp: 100, hpCurrent: 100, mp: 0, mpCurrent: 0, attack: 10, defense: 5, speed: 8, luck: 1 } }],
  enemies: [], items: [], events: [],
  scenes: [{ id: 'scene_court', name: '理政朝堂', type: 'settlement', icon: '🏛', coords: { x: 0, y: 0 }, tags: ['spawn', 'governance'], description: '正堂', connections: [], events: [], vignettes: [] }],
  startingSceneId: 'scene_court',
  strategicSetup: {
    playerFactionId: 'shu',
    factions: {
      shu: { gold: 200, food: 300, troops: 4000, order: 60, agg: { population: 20000, productionEfficiency: 100, security: 50 }, diplomacy: { wu: { stance: 'neutral', relation: 20 }, wei: { stance: 'war', relation: -70 } } },
      wu: { gold: 200, food: 400, troops: 10000, order: 65, agg: { population: 45000, productionEfficiency: 105, security: 55 } },
      wei: { gold: 400, food: 800, troops: 25000, order: 70, agg: { population: 90000, productionEfficiency: 110, security: 60 } },
    },
  },
});

describe('Phase 35 — 战略动作权限门控', () => {
  test('govern/diplomacy/mobilize 需 L3', () => {
    expect(requiredAuthority('govern')).toBe(AI_AUTHORITY.COAUTHOR);
    expect(requiredAuthority('diplomacy')).toBe(AI_AUTHORITY.COAUTHOR);
    expect(requiredAuthority('mobilize')).toBe(AI_AUTHORITY.COAUTHOR);
  });
  test('L2 拦截、L3 放行 govern', () => {
    const acts = [{ type: 'govern', policyId: 'conscript' }];
    expect(filterActionsByAuthority(acts, AI_AUTHORITY.ADJUDICATOR).allowed.length).toBe(0);
    expect(filterActionsByAuthority(acts, AI_AUTHORITY.COAUTHOR).allowed.length).toBe(1);
  });
});

describe('Phase 35 — _applyEngineActions 落实战略动作', () => {
  function setup() {
    const gs = { addNarrative() {} };
    const ss = new StrategicSystem(); ss.eventSystem = null;
    ss.initFromPreset(gs, strategyPreset());
    const ai = new AIGMEngine();
    ai.gameEngine = { getSystem: (n) => (n === 'StrategicSystem' ? ss : null) };
    return { gs, ss, ai };
  }
  test('govern 征兵增兵', () => {
    const { gs, ss, ai } = setup();
    const before = ss.getFactionState(gs, 'shu').troops;
    ai._applyEngineActions([{ type: 'govern', policyId: 'conscript' }], gs, AI_AUTHORITY.COAUTHOR);
    expect(ss.getFactionState(gs, 'shu').troops).toBeGreaterThan(before);
  });
  test('diplomacy 宣战置 worldFlags', () => {
    const { gs, ss, ai } = setup();
    ai._applyEngineActions([{ type: 'diplomacy', action: 'declare_war', targetId: 'wu' }], gs, AI_AUTHORITY.COAUTHOR);
    expect(ss.relationOf(gs, 'shu', 'wu').stance).toBe('war');
    expect(gs.worldFlags.war_with_wu).toBe(true);
  });
  test('mobilize 扣兵', () => {
    const { gs, ss, ai } = setup();
    ai._applyEngineActions([{ type: 'mobilize', value: 1500 }], gs, AI_AUTHORITY.COAUTHOR);
    expect(ss.getFactionState(gs, 'shu').troops).toBe(2500);
  });
});

describe('Phase 35 — say 路由 AI + 进言提示', () => {
  let sess, origRandom;
  beforeEach(async () => {
    origRandom = Math.random; Math.random = () => 0.4;
    sess = new GameSession({ combatMode: 'interactive' });
    sess.configureAI({ endpoint: '' }); // AI off → 本地兜底
    sess.loadPreset(strategyPreset());
    await sess.kickoff();
  });
  afterEach(() => { Math.random = origRandom; sess.destroy(); });

  test('say 记录玩家发言并触达 AI（兜底叙述）不崩', async () => {
    const before = sess.gameState.narrativeLog.length;
    await sess.applyAction({ type: 'say', text: '我意劝课农桑、遣使结好东吴。' });
    const log = sess.gameState.narrativeLog;
    expect(log.length).toBeGreaterThan(before);
    expect(log.some(n => n.speaker === 'player' && /劝课农桑/.test(n.text))).toBe(true);
  });

  test('高参与度(L3) strategy 快照给出进言提示', () => {
    sess.gameState.aiAuthority = 3;
    const snap = sess.getState().strategy;
    expect(snap.hint).toBeTruthy();
    expect(/进言|主张/.test(snap.hint)).toBe(true);
  });

  test('低参与度(L1) 无进言提示', () => {
    sess.gameState.aiAuthority = 1;
    expect(sess.getState().strategy.hint).toBeNull();
  });
});
