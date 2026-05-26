/**
 * ContextRetriever 测试（Phase 23D）
 */

import { ContextRetriever } from '../../src/systems/ContextRetriever.js';
import { SceneSystem } from '../../src/systems/SceneSystem.js';
import { NPCSystem } from '../../src/systems/NPCSystem.js';
import { GameState } from '../../src/models/GameState.js';

function makeApp() {
  const scenes = [
    { id: 'a', name: '酒馆', description: '热闹的酒馆', type: 'settlement', tags: ['safe'], connections: [{ to: 'b' }, { to: 'c' }] },
    { id: 'b', name: '森林边缘', description: '幽暗的林边', type: 'wilderness', tags: ['forest'], connections: [{ to: 'a' }, { to: 'd' }] },
    { id: 'c', name: '集市', description: '熙攘的集市', type: 'settlement', tags: ['safe', 'shop'], connections: [{ to: 'a' }] },
    { id: 'd', name: '森林深处', description: '密林', type: 'wilderness', tags: ['forest', 'dangerous'], connections: [{ to: 'b' }, { to: 'e' }] },
    { id: 'e', name: '古迹', description: '远古遗迹', type: 'dungeon', tags: ['lost'], connections: [{ to: 'd' }] },
    { id: 'f', name: '海岸', description: '陌生的海边', type: 'wilderness', tags: ['water'], connections: [] },  // 孤岛
  ];
  const npcs = [
    { id: 'n1', name: '老板', personality: 'jovial', spawnScene: 'a' },
    { id: 'n2', name: '盗贼', personality: 'shady', spawnScene: 'c' },
    { id: 'n3', name: '幽灵', personality: 'cryptic', spawnScene: 'e' },
  ];
  const ss = new SceneSystem();
  ss.loadFromPreset({ scenes });
  const ns = new NPCSystem();
  ns.loadFromPreset({ npcs });
  const cr = new ContextRetriever();
  cr._sceneSystem = ss;
  cr._npcSystem = ns;
  const state = new GameState();
  state.mapState.currentSceneId = 'a';
  state.mapState.visitedSceneIds = ['a'];
  ns.initializeNPCState(state);
  return { cr, ss, ns, state };
}

describe('ContextRetriever', () => {
  test('getRelevantScenes — 当前场景永远在前', () => {
    const { cr, state } = makeApp();
    const list = cr.getRelevantScenes(state, 3);
    expect(list[0].id).toBe('a');
  });

  test('getRelevantScenes — 1 跳邻居优先于 2 跳', () => {
    const { cr, state } = makeApp();
    const list = cr.getRelevantScenes(state, 4);
    const ids = list.map(s => s.id);
    // a (current) → b, c (1跳) → d (2跳)
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('d'));
    expect(ids.indexOf('c')).toBeLessThan(ids.indexOf('d'));
  });

  test('getRelevantScenes — 共享 tag 提升排名', () => {
    const { cr, state } = makeApp();
    state.playerTags = ['shop'];   // c 有 shop tag
    const list = cr.getRelevantScenes(state, 3);
    // c 应该排在 b 前（同样 1 跳但 c 有共享 tag）
    const ids = list.map(s => s.id);
    expect(ids.indexOf('c')).toBeLessThan(ids.indexOf('b'));
  });

  test('getRelevantScenes — 孤立场景（无连接）排末位', () => {
    const { cr, state } = makeApp();
    const list = cr.getRelevantScenes(state, 6);
    // f 不连通，永远排最后
    expect(list[list.length - 1].id).toBe('f');
  });

  test('getRelevantScenes — limit 控制', () => {
    const { cr, state } = makeApp();
    expect(cr.getRelevantScenes(state, 3)).toHaveLength(3);
    expect(cr.getRelevantScenes(state, 100).length).toBeLessThanOrEqual(6);
  });

  test('getRelevantNPCs — 同行 / 在场最高优先', () => {
    const { cr, ns, state } = makeApp();
    ns.recruitCompanion(state, 'n1');   // n1 同行
    // n2 在 c 不在当前场景
    // n3 在 e 也不在
    const list = cr.getRelevantNPCs(state, 3);
    expect(list[0].id).toBe('n1');
  });

  test('getRelevantNPCs — 高好感的 NPC 排在低好感的前', () => {
    const { cr, ns, state } = makeApp();
    // n2 / n3 都不在当前场景；只有好感差异
    ns.changeAffection(state, 'n2', 80);
    ns.meetNPC(state, 'n2');
    ns.meetNPC(state, 'n3');
    const list = cr.getRelevantNPCs(state, 3);
    const ids = list.map(o => o.id);
    expect(ids.indexOf('n2')).toBeLessThan(ids.indexOf('n3'));
  });

  test('buildContextDigest — 含场景/时间/NPC 关键段', () => {
    const { cr, ns, state } = makeApp();
    state.storyTime = { day: 5, hour: 14 };
    state.playerTags = ['race:elf', 'bg:scholar'];
    state.worldFlags = { war: true };
    ns.recruitCompanion(state, 'n1');
    const text = cr.buildContextDigest(state);
    expect(text).toContain('酒馆');
    expect(text).toContain('第 5 天');
    expect(text).toContain('race:elf');
    expect(text).toContain('war');
    expect(text).toContain('老板');
  });

  test('buildContextDigest — 没场景图也能返回（仅时间/tags）', () => {
    const { cr, state } = makeApp();
    state.mapState.currentSceneId = null;
    const text = cr.buildContextDigest(state);
    expect(typeof text).toBe('string');
  });
});
