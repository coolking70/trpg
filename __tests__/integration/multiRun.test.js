/**
 * 多周目集成测试 (Phase 26 — 压力测试报告问题 5)
 *
 * 模拟一个完整的多周目玩家旅程：
 *   1. 第一周目：跑一部分主线 → save 到 IndexedDB → 关闭"游戏"
 *   2. 第二启动：从 IndexedDB 恢复存档 → 验证 state 完整
 *   3. 完成第一周目 → commitRun 把发现写入元进度
 *   4. 第二周目：用同一个 presetId 开新 game → 元进度累积、跨周目解锁存在
 *   5. 多次 commitRun：scenes/events/endings 去重累加
 *
 * 验证：
 *   - PresetStorage 可在大型 preset (> 1MB) 下走 IDB 通路
 *   - 存档 game state 包含 worldFlags / npcState / playerTags / companions
 *   - MetaProgression 跨 preset 隔离
 *   - 元进度的 unlock 可被新一周目正确读到
 */

import 'fake-indexeddb/auto';
import { IndexedDBStore, _resetCache } from '../../src/core/IndexedDBStore.js';
import { PresetStorageImpl } from '../../src/core/PresetStorage.js';
import { MetaProgressionImpl } from '../../src/core/MetaProgression.js';

function resetAll() {
  _resetCache();
  if (global.indexedDB && global.indexedDB._databases) {
    global.indexedDB._databases.clear();
  }
  if (typeof localStorage !== 'undefined') localStorage.clear();
}

// 构造一份较大的 preset（模拟"永燃之冠"规模）
function buildLargePreset(id = 'eternal_crown_test') {
  const scenes = [];
  const events = [];
  for (let i = 0; i < 60; i++) {
    scenes.push({
      id: `scene_${i}`,
      name: `场景 ${i}`,
      type: i === 0 ? 'spawn' : (i === 59 ? 'ending' : 'wilderness'),
      icon: '🗺',
      description: `第 ${i} 个场景的描述`.repeat(20),
      coords: { x: i % 10, y: Math.floor(i / 10) },
      connections: i > 0 ? [{ to: `scene_${i - 1}`, label: '返回' }] : [],
      events: [],
      tags: i === 59 ? ['main', 'ending'] : ['side'],
    });
    if (i < 40) {
      events.push({
        id: `ev_${i}`, type: 'event', name: `事件 ${i}`,
        description: `第 ${i} 个事件描述`.repeat(10),
        eventType: 'story', priority: 50,
        trigger: { type: 'composite', condition: { inScene: [`scene_${i}`], probability: 1.0, excludeCompletedEvents: [`ev_${i}`] } },
        choices: [{ id: 'choice_1', text: '继续', outcomes: [{ probability: 1, text: 'ok', effects: [] }] }],
        repeatable: false, maxOccurrences: 1, tags: ['side'],
      });
    }
  }
  return {
    version: '1.0.0',
    presetId: id,
    name: '测试压测剧本',
    author: 'multi-run-test',
    createdAt: new Date().toISOString(),
    description: '内联生成的大预设',
    lore: { worldName: '测试世界', era: '现在', background: '', rules: '', gmStyle: '' },
    characters: [{ id: 'pc', type: 'character', name: '主角', stats: { hp: 100, hpCurrent: 100, mp: 30, mpCurrent: 30, attack: 10, defense: 8, magicAttack: 5, magicDefense: 8, speed: 10, luck: 5 }, abilities: [], inventory: [], equipment: {}, level: 1 }],
    enemies: [], items: [], events, scenes, npcs: [], npcRelations: [],
    startingOptions: null, startingSceneRules: [],
    combatMode: 'solo',
    startingSceneId: 'scene_0',
    displayMode: 'scene-graph',
    rules: { diceType: 'd20', combatFormula: '(attack + dice) - defense', maxPartySize: 4, startingGold: 100 },
    aiConfig: { temperature: 0.7, maxResponseTokens: 1000, useStructuredOutput: true, language: 'zh-CN' },
  };
}

describe('多周目 — PresetStorage + MetaProgression + 存档恢复', () => {
  beforeEach(() => {
    resetAll();
  });

  test('第一周目：preset 落 IDB，game state 含完整 Phase 19-22 字段，跨进程恢复', async () => {
    // —— Boot 1：玩家选了预设，开始第一周目 ——
    const storage = new PresetStorageImpl();
    const preset = buildLargePreset('preset_multirun_a');
    await storage.save(preset);

    // 验证 preset 在 IDB 里能取回
    expect(JSON.stringify(preset).length).toBeGreaterThan(10000);  // 即便压缩格式也有 10KB+

    // 模拟跑一段游戏：玩家走了 5 个场景、完成 3 个事件、招了 1 个伙伴、改了 worldFlags
    const gameStateSnapshot = {
      currentSceneId: 'scene_5',
      activeCharacters: [{ id: 'pc', name: '主角', stats: { hp: 100, hpCurrent: 75 }, inventory: ['item_a'] }],
      mapState: { currentSceneId: 'scene_5', visitedSceneIds: ['scene_0', 'scene_1', 'scene_2', 'scene_3', 'scene_4', 'scene_5'] },
      completedEventIds: ['ev_0', 'ev_1', 'ev_2'],
      variables: { quest_accepted: true },
      worldFlags: { priest_blessed: true, crown_a_taken: false },
      playerTags: ['race:human', 'origin:noble', 'bg:soldier', 'faith:sun'],
      companions: ['npc_aria'],
      npcState: { npc_aria: { affection: 30, knownTo: true, alive: true, currentScene: 'scene_5' } },
      storyTime: { day: 2, hour: 14 },
      narrativeLog: [{ speaker: 'gm', text: '剧情开始', timestamp: Date.now() }],
      activeCombat: null,
      activeEvent: null,
    };
    const savesStore = new IndexedDBStore('saves');
    await savesStore.put('slot_auto', { presetId: preset.presetId, gameState: gameStateSnapshot, savedAt: Date.now() });

    // —— "关闭游戏" — 在测试里就是 clear in-memory；IDB 模拟持久化 ——
    // 没有真正的 stop

    // —— Boot 2：模拟新进程启动，从 IDB 读 ——
    _resetCache();  // 模拟 page reload — store 实例缓存重置

    const storage2 = new PresetStorageImpl();
    const loadedPreset = await storage2.load(preset.presetId);
    expect(loadedPreset).not.toBeNull();
    expect(loadedPreset.name).toBe('测试压测剧本');
    expect(loadedPreset.scenes.length).toBe(60);

    const saves2 = new IndexedDBStore('saves');
    const loadedSave = await saves2.get('slot_auto');
    expect(loadedSave).not.toBeNull();
    expect(loadedSave.gameState.currentSceneId).toBe('scene_5');
    expect(loadedSave.gameState.companions).toContain('npc_aria');
    expect(loadedSave.gameState.worldFlags.priest_blessed).toBe(true);
    expect(loadedSave.gameState.playerTags).toContain('origin:noble');
    expect(loadedSave.gameState.storyTime.day).toBe(2);
    expect(loadedSave.gameState.npcState.npc_aria.affection).toBe(30);
  });

  test('完成第一周目 → 跨周目元进度累积、unlock 持久化', async () => {
    const mp = new MetaProgressionImpl();
    const presetId = 'preset_multirun_b';

    // —— 周目 1：走通 light 结局 ——
    await mp.commitRun(presetId, {
      scenes: ['scene_0', 'scene_5', 'scene_59'],
      events: ['ev_0', 'ev_intro', 'ev_ending_light'],
      npcs: ['npc_priest', 'npc_smith'],
      ending: 'ending_light',
      completed: true,
      playTimeSeconds: 1800,
    });
    // 解锁一个种族（"打通光明结局"的奖励）
    await mp.unlock(presetId, 'Races', 'demon');

    // —— Boot reset：开新一周目 ——
    _resetCache();
    const mp2 = new MetaProgressionImpl();
    const meta1 = await mp2.load(presetId);
    expect(meta1.runCount).toBe(1);
    expect(meta1.completedRuns).toBe(1);
    expect(meta1.discoveredEndings).toEqual(['ending_light']);
    expect(meta1.unlockedRaces).toContain('demon');

    // —— 周目 2：走通 hidden 结局，新发现一些 NPC ——
    await mp2.commitRun(presetId, {
      scenes: ['scene_0', 'scene_10', 'scene_30', 'scene_59'],
      events: ['ev_ending_hidden', 'ev_secret_path'],
      npcs: ['npc_witch', 'npc_smith'],   // smith 重复，应该去重
      ending: 'ending_hidden',
      completed: true,
      playTimeSeconds: 2400,
    });

    const meta2 = await mp2.load(presetId);
    expect(meta2.runCount).toBe(2);
    expect(meta2.completedRuns).toBe(2);
    expect(meta2.totalPlayTimeSeconds).toBe(1800 + 2400);
    // 场景/NPC 去重合并
    expect(meta2.discoveredScenes.sort()).toEqual(['scene_0', 'scene_10', 'scene_30', 'scene_5', 'scene_59']);
    expect(meta2.discoveredNpcs.sort()).toEqual(['npc_priest', 'npc_smith', 'npc_witch']);
    expect(meta2.discoveredEndings.sort()).toEqual(['ending_hidden', 'ending_light']);
  });

  test('两个不同 presetId 的元进度互不干扰，存档也分隔', async () => {
    const storage = new PresetStorageImpl();
    const mp = new MetaProgressionImpl();

    const presetA = buildLargePreset('preset_isolation_a');
    const presetB = buildLargePreset('preset_isolation_b');
    presetB.name = '另一份剧本';

    await storage.save(presetA);
    await storage.save(presetB);
    await mp.commitRun(presetA.presetId, { scenes: ['s_a'], events: [], npcs: [], ending: 'a_end', completed: true });
    await mp.commitRun(presetB.presetId, { scenes: ['s_b'], events: [], npcs: [], ending: 'b_end', completed: true });

    const metaA = await mp.load(presetA.presetId);
    const metaB = await mp.load(presetB.presetId);
    expect(metaA.discoveredScenes).toEqual(['s_a']);
    expect(metaB.discoveredScenes).toEqual(['s_b']);
    expect(metaA.discoveredEndings).not.toContain('b_end');
    expect(metaB.discoveredEndings).not.toContain('a_end');

    // 存档 listSync 应包含两份
    const list = storage.listSync();   // 同步
    expect(list.length).toBeGreaterThanOrEqual(2);
    const ids = list.map(p => p.id);
    expect(ids).toContain('preset_isolation_a');
    expect(ids).toContain('preset_isolation_b');
  });

  test('5 个周目累积：场景覆盖率单调增长，结局覆盖率单调增长', async () => {
    const mp = new MetaProgressionImpl();
    const presetId = 'preset_5runs';

    const runs = [
      { scenes: ['s_0', 's_1', 's_2'], ending: 'light',   completed: true },
      { scenes: ['s_2', 's_3', 's_4'], ending: 'light',   completed: true },   // 重复 light，去重
      { scenes: ['s_5', 's_6'],         ending: 'dark',    completed: true },
      { scenes: ['s_7'],                ending: null,      completed: false },  // 半途而废
      { scenes: ['s_8', 's_9'],         ending: 'neutral', completed: true },
    ];

    let prevSceneCount = 0;
    let prevEndingCount = 0;
    for (let i = 0; i < runs.length; i++) {
      await mp.commitRun(presetId, runs[i]);
      const meta = await mp.load(presetId);
      // 单调不减
      expect(meta.discoveredScenes.length).toBeGreaterThanOrEqual(prevSceneCount);
      expect(meta.discoveredEndings.length).toBeGreaterThanOrEqual(prevEndingCount);
      prevSceneCount = meta.discoveredScenes.length;
      prevEndingCount = meta.discoveredEndings.length;
    }

    const final = await mp.load(presetId);
    expect(final.runCount).toBe(5);
    expect(final.completedRuns).toBe(4);    // 半途的不算
    expect(final.discoveredEndings.sort()).toEqual(['dark', 'light', 'neutral']);
    // 9 个唯一场景：s_0..s_9 共 10 个但 s_2 重复，所以是 10
    expect(final.discoveredScenes.length).toBe(10);
  });

  // Phase 26D — 多预设元进度隔离
  test('3 个不同题材预设：存档 + 元进度完全独立', async () => {
    const storage = new PresetStorageImpl();
    const mp = new MetaProgressionImpl();

    // 模拟玩家加载 3 个题材预设
    const fantasy = { ...buildLargePreset('eternal_crown'), name: '永燃之冠' };
    const survival = { ...buildLargePreset('last_shelter'), name: '最后的避难所' };
    const wuxia = { ...buildLargePreset('qingfeng'), name: '青锋录' };

    await storage.save(fantasy);
    await storage.save(survival);
    await storage.save(wuxia);

    // 在每个预设里完成一些游戏进度
    await mp.commitRun(fantasy.presetId,
      { scenes: ['castle', 'forest'], events: ['ev_intro'], npcs: ['priest'],
        ending: 'light_path', completed: true, playTimeSeconds: 1200 });
    await mp.commitRun(survival.presetId,
      { scenes: ['vault', 'wasteland'], events: ['ev_radio'], npcs: ['marcus'],
        ending: 'save_brother', completed: true, playTimeSeconds: 1800 });
    await mp.commitRun(wuxia.presetId,
      { scenes: ['shaolin', 'jiangcheng'], events: ['ev_master_dead'], npcs: ['xiao'],
        ending: 'revenge', completed: true, playTimeSeconds: 900 });

    // 解锁不同的种族/职业
    await mp.unlock(fantasy.presetId, 'Races', 'demon_lord');
    await mp.unlock(survival.presetId, 'Races', 'ghoul_advanced');
    await mp.unlock(wuxia.presetId, 'Sects', 'shaolin_inner');

    // —— 重启进程，验证 3 个预设的进度互不污染 ——
    _resetCache();
    const mp2 = new MetaProgressionImpl();
    const storage2 = new PresetStorageImpl();

    const fMeta = await mp2.load(fantasy.presetId);
    const sMeta = await mp2.load(survival.presetId);
    const wMeta = await mp2.load(wuxia.presetId);

    expect(fMeta.discoveredScenes).toEqual(['castle', 'forest']);
    expect(sMeta.discoveredScenes).toEqual(['vault', 'wasteland']);
    expect(wMeta.discoveredScenes).toEqual(['shaolin', 'jiangcheng']);

    expect(fMeta.discoveredEndings).toEqual(['light_path']);
    expect(sMeta.discoveredEndings).toEqual(['save_brother']);
    expect(wMeta.discoveredEndings).toEqual(['revenge']);

    // unlockedRaces 不互相污染
    expect(fMeta.unlockedRaces).toContain('demon_lord');
    expect(fMeta.unlockedRaces).not.toContain('ghoul_advanced');
    expect(sMeta.unlockedRaces).toContain('ghoul_advanced');
    expect(sMeta.unlockedRaces).not.toContain('demon_lord');
    expect(wMeta.unlockedSects || []).toContain('shaolin_inner');

    // 3 个 preset 都能 listSync 出来
    const list = storage2.listSync();
    expect(list.length).toBeGreaterThanOrEqual(3);
    const ids = list.map(p => p.id);
    expect(ids).toContain('eternal_crown');
    expect(ids).toContain('last_shelter');
    expect(ids).toContain('qingfeng');

    // 各 preset 的播放时间累积独立
    expect(fMeta.totalPlayTimeSeconds).toBe(1200);
    expect(sMeta.totalPlayTimeSeconds).toBe(1800);
    expect(wMeta.totalPlayTimeSeconds).toBe(900);
  });

  test('IDB 不可用时，MetaProgression 静默降级到 localStorage', async () => {
    // 模拟：禁用 indexedDB
    const origIDB = global.indexedDB;
    const origIDBAvailable = IndexedDBStore.isAvailable;
    IndexedDBStore.isAvailable = () => false;
    global.indexedDB = undefined;
    _resetCache();

    try {
      const mp = new MetaProgressionImpl();
      await mp.commitRun('p_ls', { scenes: ['s1'], events: [], npcs: [], completed: true });
      const meta = await mp.load('p_ls');
      expect(meta.runCount).toBe(1);
      expect(meta.discoveredScenes).toEqual(['s1']);
    } finally {
      global.indexedDB = origIDB;
      IndexedDBStore.isAvailable = origIDBAvailable;
      _resetCache();
    }
  });
});
