/**
 * NPCSystem 单元测试（Phase 19B）
 */

import { NPCSystem } from '../../src/systems/NPCSystem.js';
import { GameState } from '../../src/models/GameState.js';

const TEST_PRESET = {
  npcs: [
    {
      id: 'npc_smith',
      name: '老布朗',
      icon: '🔨',
      recruitable: false,
      giftPreferences: { weapon: 'love', 'material:metal': 'love', 'food': 'neutral', 'tag:cursed': 'hate' },
      schedule: [
        { day: 'any', hour: [8, 18], scene: 'scene_shop' },
        { day: 'any', hour: [22, 6], scene: 'scene_home' },  // 跨午夜
      ],
    },
    {
      id: 'npc_aria',
      name: '艾莉雅',
      icon: '🧝',
      recruitable: true,
      spawnScene: 'scene_tavern',
      stats: { hp: 80, mp: 60, attack: 12, defense: 8, magicAttack: 14, magicDefense: 10, speed: 13, luck: 6 },
      abilities: [{ id: 'arrow', name: '射击', type: 'active', cost: { mp: 5 } }],
      giftPreferences: { 'tag:elven': 'love', 'consumable:food': 'like' },
    },
  ],
};

describe('NPCSystem', () => {
  let ns, state;

  beforeEach(() => {
    ns = new NPCSystem();
    ns.loadFromPreset(TEST_PRESET);
    state = new GameState();
    ns.initializeNPCState(state);
  });

  test('loadFromPreset 加载 2 个 NPC', () => {
    expect(ns.getAllNPCs()).toHaveLength(2);
    expect(ns.getNPC('npc_smith').name).toBe('老布朗');
  });

  test('initializeNPCState 给所有 NPC 默认 runtime', () => {
    expect(state.npcState.npc_smith.affection).toBe(0);
    expect(state.npcState.npc_smith.alive).toBe(true);
    expect(state.npcState.npc_smith.knownTo).toBe(false);
    expect(state.npcState.npc_aria.currentScene).toBe('scene_tavern');
  });

  test('getScheduledScene 白天匹配 shop', () => {
    expect(ns.getScheduledScene(TEST_PRESET.npcs[0], { day: 1, hour: 10 })).toBe('scene_shop');
  });

  test('getScheduledScene 晚上 23 点匹配跨午夜的 home', () => {
    expect(ns.getScheduledScene(TEST_PRESET.npcs[0], { day: 1, hour: 23 })).toBe('scene_home');
  });

  test('getScheduledScene 凌晨 4 点也匹配跨午夜的 home', () => {
    expect(ns.getScheduledScene(TEST_PRESET.npcs[0], { day: 1, hour: 4 })).toBe('scene_home');
  });

  test('refreshNPCLocations 按 storyTime 更新 currentScene', () => {
    state.storyTime = { day: 1, hour: 12 };
    ns.refreshNPCLocations(state);
    expect(state.npcState.npc_smith.currentScene).toBe('scene_shop');

    state.storyTime = { day: 1, hour: 23 };
    ns.refreshNPCLocations(state);
    expect(state.npcState.npc_smith.currentScene).toBe('scene_home');
  });

  test('meetNPC 仅首次返回 true', () => {
    expect(ns.meetNPC(state, 'npc_smith')).toBe(true);
    expect(state.npcState.npc_smith.knownTo).toBe(true);
    expect(ns.meetNPC(state, 'npc_smith')).toBe(false);
  });

  test('changeAffection 钳制 0-100', () => {
    expect(ns.changeAffection(state, 'npc_smith', 30)).toBe(30);
    expect(ns.changeAffection(state, 'npc_smith', 200)).toBe(100);
    expect(ns.changeAffection(state, 'npc_smith', -500)).toBe(0);
  });

  test('evaluateGiftReaction 按 id / itemType / tag 匹配', () => {
    const sword = { id: 'item_sword', itemType: 'weapon', tags: [] };
    expect(ns.evaluateGiftReaction('npc_smith', sword)).toBe('love');

    const metal = { id: 'item_ore', itemType: 'material:metal', tags: [] };
    expect(ns.evaluateGiftReaction('npc_smith', metal)).toBe('love');

    const cursed = { id: 'item_dark', itemType: 'consumable', tags: ['cursed'] };
    expect(ns.evaluateGiftReaction('npc_smith', cursed)).toBe('hate');

    const apple = { id: 'item_apple', itemType: 'food', tags: [] };
    expect(ns.evaluateGiftReaction('npc_smith', apple)).toBe('neutral');
  });

  test('giftReactionDelta 标准映射', () => {
    expect(ns.giftReactionDelta('love')).toBe(15);
    expect(ns.giftReactionDelta('hate')).toBe(-10);
    expect(ns.giftReactionDelta('neutral')).toBe(1);
  });

  test('recruitCompanion 仅对 recruitable=true 的 NPC 成功', () => {
    expect(ns.recruitCompanion(state, 'npc_smith')).toBe(false);
    expect(ns.recruitCompanion(state, 'npc_aria')).toBe(true);
    expect(state.companions).toContain('npc_aria');
    expect(ns.isCompanion(state, 'npc_aria')).toBe(true);
  });

  test('dismissCompanion 让伙伴离队', () => {
    ns.recruitCompanion(state, 'npc_aria');
    expect(ns.dismissCompanion(state, 'npc_aria')).toBe(true);
    expect(state.companions).not.toContain('npc_aria');
  });

  test('getNPCsInScene 只返回已 knownTo + alive 的（默认）', () => {
    state.storyTime = { day: 1, hour: 12 };
    ns.refreshNPCLocations(state);
    expect(ns.getNPCsInScene(state, 'scene_shop')).toHaveLength(0);
    ns.meetNPC(state, 'npc_smith');
    expect(ns.getNPCsInScene(state, 'scene_shop')).toHaveLength(1);
  });

  test('getNPCsInScene includeUnknown=true 也返回未见过的', () => {
    state.storyTime = { day: 1, hour: 12 };
    ns.refreshNPCLocations(state);
    expect(ns.getNPCsInScene(state, 'scene_shop', true)).toHaveLength(1);
  });

  // Phase 22B — NPC 关系传播
  describe('Phase 22B — NPC 关系图', () => {
    let nsRel, stateRel;

    beforeEach(() => {
      nsRel = new NPCSystem();
      nsRel.loadFromPreset({
        npcs: [
          { id: 'a', name: 'A', spawnScene: 's' },
          { id: 'b', name: 'B', spawnScene: 's' },
          { id: 'c', name: 'C', spawnScene: 's' },
        ],
        npcRelations: [
          { from: 'a', to: 'b', strength: 0.5 },     // 朋友（同向）
          { from: 'a', to: 'c', strength: -0.5 },    // 对头（反向）
          { from: 'b', to: 'a', strength: 0.8 },     // b 是 a 的至交
        ],
      });
      stateRel = new GameState();
      nsRel.initializeNPCState(stateRel);
    });

    test('changeAffection 按正向 strength 传播', () => {
      nsRel.changeAffection(stateRel, 'a', 20);
      expect(stateRel.npcState.a.affection).toBe(20);
      expect(stateRel.npcState.b.affection).toBe(10);   // 20 * 0.5
    });

    test('changeAffection 按反向 strength 反向传播', () => {
      nsRel.changeAffection(stateRel, 'a', 20);
      expect(stateRel.npcState.c.affection).toBe(0);   // 20 * -0.5 = -10，但 0 是下限
    });

    test('传播只一级（不连锁）', () => {
      // 改 a 会传播到 b (0.5)，b → a (0.8) 不应再次传给 a 形成环
      nsRel.changeAffection(stateRel, 'a', 10);
      // a 增加 10，b 增加 5；如果 b 的关系又触发，a 会再增加 5 * 0.8 = 4
      // 我们期望不再次传播
      expect(stateRel.npcState.a.affection).toBe(10);   // 仅初始 +10
      expect(stateRel.npcState.b.affection).toBe(5);    // 仅 +5
    });

    test('applyNPCDeath 把 affection 强冲击传给关联 NPC', () => {
      // 提前给 b/c 一些 affection 以便观察变化
      stateRel.npcState.b.affection = 50;
      stateRel.npcState.c.affection = 50;
      const effects = nsRel.applyNPCDeath(stateRel, 'a');
      expect(stateRel.npcState.a.alive).toBe(false);
      // a→b strength=0.5: round(0.5 * 25) = +13
      expect(stateRel.npcState.b.affection).toBe(63);
      // a→c strength=-0.5: round(-0.5 * 25) = -12（JS Math.round 半向上）
      expect(stateRel.npcState.c.affection).toBe(38);
      expect(effects).toHaveLength(2);
    });

    test('applyNPCDeath strength >= 0.7 改 mood', () => {
      // 给 b 配 a→b strength=0.7 强朋友关系
      const ns2 = new NPCSystem();
      ns2.loadFromPreset({
        npcs: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
        npcRelations: [{ from: 'a', to: 'b', strength: 0.8 }],
      });
      const s = new GameState();
      ns2.initializeNPCState(s);
      ns2.applyNPCDeath(s, 'a');
      expect(s.npcState.b.mood).toBe('grieving');
    });

    test('applyNPCDeath 反向强敌死亡 → pleased', () => {
      const ns3 = new NPCSystem();
      ns3.loadFromPreset({
        npcs: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
        npcRelations: [{ from: 'a', to: 'b', strength: -0.8 }],
      });
      const s = new GameState();
      ns3.initializeNPCState(s);
      ns3.applyNPCDeath(s, 'a');
      expect(s.npcState.b.mood).toBe('pleased');
    });
  });
});
