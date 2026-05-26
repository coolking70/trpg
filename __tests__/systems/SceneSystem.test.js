/**
 * SceneSystem 单元测试
 */

import { SceneSystem } from '../../src/systems/SceneSystem.js';
import { GameState } from '../../src/models/GameState.js';

const TEST_PRESET = {
  startingSceneId: 'scene_a',
  scenes: [
    {
      id: 'scene_a', name: '起点', type: 'spawn', coords: { x: 0, y: 0 },
      connections: [{ to: 'scene_b', label: '前往 B' }],
      events: [],
      vignettes: ['重访 A：树叶飘过。'],
    },
    {
      id: 'scene_b', name: 'B 营地', type: 'wilderness', coords: { x: 1, y: 0 },
      connections: [
        { to: 'scene_a', label: '原路返回 A' },
        { to: 'scene_c', label: '前往 C', gated: { requireVariables: { quest_received: true } } },
      ],
    },
    {
      id: 'scene_c', name: 'C 终点', type: 'ending', coords: { x: 2, y: 0 },
      connections: [],
    },
  ],
};

describe('SceneSystem', () => {
  let scenes, state;

  beforeEach(() => {
    scenes = new SceneSystem();
    scenes.loadFromPreset(TEST_PRESET);
    state = new GameState();
    state.mapState.currentSceneId = 'scene_a';
    state.mapState.visitedSceneIds = ['scene_a'];
  });

  test('loadFromPreset 加载 3 个节点', () => {
    expect(scenes.hasScenes()).toBe(true);
    expect(scenes.getAllScenes()).toHaveLength(3);
    expect(scenes.startingSceneId).toBe('scene_a');
  });

  test('getCurrentScene + getAdjacent', () => {
    expect(scenes.getCurrentScene(state).id).toBe('scene_a');
    const adj = scenes.getAdjacent(state);
    expect(adj).toHaveLength(1);
    expect(adj[0].scene.id).toBe('scene_b');
    expect(adj[0].reachable).toBe(true);
  });

  test('canTravelTo 邻居返回 ok=true', () => {
    expect(scenes.canTravelTo(state, 'scene_b').ok).toBe(true);
  });

  test('canTravelTo 非邻居返回 ok=false', () => {
    expect(scenes.canTravelTo(state, 'scene_c').ok).toBe(false);
  });

  test('gated 条件：变量缺失时不可达 + 不泄露变量名', () => {
    scenes.performTravel(state, 'scene_b');
    const adj = scenes.getAdjacent(state);
    const cAdj = adj.find(a => a.scene.id === 'scene_c');
    expect(cAdj.reachable).toBe(false);
    // 关键：不暴露内部变量名 / 事件 ID 给 UI
    expect(cAdj.lockedReason).not.toContain('quest_received');
    expect(cAdj.lockedReason).not.toContain('=');
    expect(cAdj.lockedReason.length).toBeGreaterThan(0);
  });

  test('gated.hint 优先于自动生成的通用提示', () => {
    const customScenes = new SceneSystem();
    customScenes.loadFromPreset({
      scenes: [
        { id: 'a', name: 'A', coords: { x: 0, y: 0 },
          connections: [{ to: 'b', gated: { requireVariables: { x: true }, hint: '神龛的钥匙还未被找到' } }] },
        { id: 'b', name: 'B', coords: { x: 1, y: 0 }, connections: [] },
      ],
    });
    const s = new GameState();
    s.mapState.currentSceneId = 'a';
    const adj = customScenes.getAdjacent(s);
    expect(adj[0].reachable).toBe(false);
    expect(adj[0].lockedReason).toBe('神龛的钥匙还未被找到');
  });

  test('gated 条件满足后可达', () => {
    scenes.performTravel(state, 'scene_b');
    state.variables.quest_received = true;
    const adj = scenes.getAdjacent(state);
    const cAdj = adj.find(a => a.scene.id === 'scene_c');
    expect(cAdj.reachable).toBe(true);
  });

  test('performTravel 更新 currentSceneId 与 visitedSceneIds', () => {
    const result = scenes.performTravel(state, 'scene_b');
    expect(result).toBeTruthy();
    expect(result.isFirstVisit).toBe(true);
    expect(state.mapState.currentSceneId).toBe('scene_b');
    expect(state.mapState.visitedSceneIds).toContain('scene_b');
    // playerPosition 同步到场景坐标
    expect(state.mapState.playerPosition).toEqual({ x: 1, y: 0 });
  });

  test('重访场景：isFirstVisit=false，visitedSceneIds 不重复', () => {
    scenes.performTravel(state, 'scene_b');
    const second = scenes.performTravel(state, 'scene_a');
    expect(second.isFirstVisit).toBe(false);
    expect(state.mapState.visitedSceneIds.filter(id => id === 'scene_a')).toHaveLength(1);
  });

  test('pickVignette 在有 vignettes 时返回非 null', () => {
    const scene = scenes.getScene('scene_a');
    const v = scenes.pickVignette(scene);
    expect(v).toBeTruthy();
    expect(v).toContain('重访');
  });

  test('pickVignette 在无 vignettes 时返回 null', () => {
    const scene = scenes.getScene('scene_c');
    expect(scenes.pickVignette(scene)).toBeNull();
  });

  // Phase 21A — 场景变体
  describe('Phase 21A — 场景变体', () => {
    let varScenes;
    beforeEach(() => {
      varScenes = new SceneSystem();
      varScenes.loadFromPreset({
        scenes: [{
          id: 's', name: '广场', description: '阳光下的广场。',
          connections: [{ to: 's2', label: '默认' }],
          events: ['ev_normal'],
          vignettes: ['热闹的广场。'],
          variants: [
            {
              when: { requireWorldFlags: { war: true } },
              description: '战火燃尽的广场。',
              events: ['ev_war_widow'],
            },
            {
              when: { requireStoryTime: { minDay: 30 } },
              description: '一年后的广场。',
            },
          ],
        }, { id: 's2', name: 'B', connections: [] }],
      });
    });

    test('无匹配 → 返回 null，getActiveSceneView 返回 base', () => {
      const s = varScenes.getScene('s');
      const state = new GameState();
      expect(varScenes.getActiveVariant(s, state)).toBeNull();
      expect(varScenes.getActiveSceneView(s, state).description).toBe('阳光下的广场。');
    });

    test('worldFlag.war=true → 战时变体', () => {
      const s = varScenes.getScene('s');
      const state = new GameState();
      state.worldFlags = { war: true };
      const v = varScenes.getActiveVariant(s, state);
      expect(v).not.toBeNull();
      expect(v.description).toBe('战火燃尽的广场。');
      const view = varScenes.getActiveSceneView(s, state);
      expect(view.events).toEqual(['ev_war_widow']);  // 用 variant 的 events
    });

    test('storyTime.day=35 → 时变体', () => {
      const s = varScenes.getScene('s');
      const state = new GameState();
      state.storyTime = { day: 35, hour: 10 };
      const view = varScenes.getActiveSceneView(s, state);
      expect(view.description).toBe('一年后的广场。');
      // events 没在 variant 里 → 保留 base
      expect(view.events).toEqual(['ev_normal']);
    });

    test('优先级：第一个匹配的 variant 胜（war 同时也是 day35 时取 war）', () => {
      const s = varScenes.getScene('s');
      const state = new GameState();
      state.worldFlags = { war: true };
      state.storyTime = { day: 35, hour: 10 };
      const view = varScenes.getActiveSceneView(s, state);
      expect(view.description).toBe('战火燃尽的广场。');
    });
  });

  // Phase 21B — 隐藏连接
  describe('Phase 21B — 隐藏连接', () => {
    let s2;
    beforeEach(() => {
      s2 = new SceneSystem();
      s2.loadFromPreset({
        scenes: [
          { id: 'a', name: 'A', coords: { x: 0, y: 0 }, connections: [
            { to: 'b', label: '明路' },
            { to: 'c', label: '暗道', discovered: false },
          ]},
          { id: 'b', name: 'B', coords: { x: 1, y: 0 }, connections: [] },
          { id: 'c', name: 'C', coords: { x: 0, y: 1 }, connections: [] },
        ],
      });
    });

    test('未发现的连接在 getAdjacent 中不出现', () => {
      const st = new GameState();
      st.mapState.currentSceneId = 'a';
      const adj = s2.getAdjacent(st);
      expect(adj).toHaveLength(1);
      expect(adj[0].scene.id).toBe('b');
    });

    test('revealConnection 后才出现在 getAdjacent 中', () => {
      const st = new GameState();
      st.mapState.currentSceneId = 'a';
      expect(s2.revealConnection(st, 'a', 'c')).toBe(true);
      expect(s2.revealConnection(st, 'a', 'c')).toBe(false);   // 二次返回 false
      const adj = s2.getAdjacent(st);
      expect(adj).toHaveLength(2);
      expect(adj.some(a => a.scene.id === 'c')).toBe(true);
    });

    test('revealConnection 写入 discoveredConnections', () => {
      const st = new GameState();
      s2.revealConnection(st, 'a', 'c');
      expect(st.discoveredConnections).toContain('a→c');
    });
  });
});
