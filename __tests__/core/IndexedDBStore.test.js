/**
 * IndexedDBStore + PresetStorage + MetaProgression 测试（Phase 23A）
 */

import 'fake-indexeddb/auto';
import { IndexedDBStore, _resetCache } from '../../src/core/IndexedDBStore.js';
import { PresetStorageImpl } from '../../src/core/PresetStorage.js';
import { MetaProgressionImpl } from '../../src/core/MetaProgression.js';

// 每个测试用完整新数据库（fake-indexeddb 重置）
function resetIDB() {
  _resetCache();
  // fake-indexeddb 提供 reset
  if (global.indexedDB && global.indexedDB._databases) {
    global.indexedDB._databases.clear();
  }
}

describe('IndexedDBStore', () => {
  beforeEach(() => {
    resetIDB();
    localStorage.clear();
  });

  test('isAvailable 在 jsdom + fake-indexeddb 下返回 true', () => {
    expect(IndexedDBStore.isAvailable()).toBe(true);
  });

  test('put / get / has / delete 基本流程', async () => {
    const s = new IndexedDBStore('presets');
    await s.put('k1', { hello: 'world' });
    expect(await s.get('k1')).toEqual({ hello: 'world' });
    expect(await s.has('k1')).toBe(true);
    expect(await s.has('k2')).toBe(false);
    await s.delete('k1');
    expect(await s.get('k1')).toBeNull();
  });

  test('keys / entries 返回完整列表', async () => {
    const s = new IndexedDBStore('presets');
    await s.put('a', { v: 1 });
    await s.put('b', { v: 2 });
    const keys = await s.keys();
    expect(keys.sort()).toEqual(['a', 'b']);
    const entries = await s.entries();
    expect(entries).toHaveLength(2);
    const m = new Map(entries);
    expect(m.get('a').v).toBe(1);
    expect(m.get('b').v).toBe(2);
  });

  test('clear 清空 store', async () => {
    const s = new IndexedDBStore('presets');
    await s.put('x', { v: 1 });
    await s.clear();
    expect(await s.keys()).toEqual([]);
  });

  test('未知 storeName 构造时抛错', () => {
    expect(() => new IndexedDBStore('unknown_store')).toThrow();
  });

  test('estimateSize 给出字节数估算', async () => {
    const s = new IndexedDBStore('presets');
    await s.put('big', { data: 'x'.repeat(10000) });
    const size = await s.estimateSize();
    expect(size).toBeGreaterThan(9000);
  });
});

describe('PresetStorage', () => {
  beforeEach(() => {
    resetIDB();
    localStorage.clear();
  });

  test('save + load 完整往返', async () => {
    const ps = new PresetStorageImpl();
    const preset = { presetId: 'p1', name: '测试', scenes: [{ id: 's1' }, { id: 's2' }], events: [] };
    await ps.save(preset);
    const loaded = await ps.load('p1');
    expect(loaded).toEqual(preset);
  });

  test('listSync 返回索引（同步）', async () => {
    const ps = new PresetStorageImpl();
    await ps.save({ presetId: 'p1', name: 'A', scenes: [], events: [] });
    await ps.save({ presetId: 'p2', name: 'B', scenes: [], events: [] });
    const list = ps.listSync();
    expect(list).toHaveLength(2);
    expect(list.find(p => p.id === 'p1').name).toBe('A');
  });

  test('saveCurrent / loadCurrent 用 __current__ 键', async () => {
    const ps = new PresetStorageImpl();
    const preset = { presetId: 'cur', name: 'X', scenes: [], events: [] };
    await ps.saveCurrent(preset);
    const loaded = await ps.loadCurrent();
    expect(loaded.presetId).toBe('cur');
  });

  test('delete 同时清掉索引 + IDB + LS', async () => {
    const ps = new PresetStorageImpl();
    await ps.save({ presetId: 'pdel', name: 'D', scenes: [], events: [] });
    expect(ps.listSync().find(p => p.id === 'pdel')).toBeTruthy();
    await ps.delete('pdel');
    expect(ps.listSync().find(p => p.id === 'pdel')).toBeFalsy();
    expect(await ps.load('pdel')).toBeNull();
  });

  test('大预设（>1MB）走 IndexedDB', async () => {
    const ps = new PresetStorageImpl();
    const huge = {
      presetId: 'huge',
      name: 'Huge',
      scenes: Array(500).fill(null).map((_, i) => ({
        id: `s_${i}`,
        name: `Scene ${i}`,
        description: 'x'.repeat(3000),
      })),
      events: [],
    };
    const result = await ps.save(huge);
    expect(result.storage).toBe('idb');
    expect(result.size).toBeGreaterThan(1024 * 1024);
    // load 应该能取回完整数据
    const loaded = await ps.load('huge');
    expect(loaded.scenes).toHaveLength(500);
  });
});

describe('MetaProgression', () => {
  beforeEach(() => {
    resetIDB();
    localStorage.clear();
  });

  test('load 不存在的 preset 返回空骨架', async () => {
    const mp = new MetaProgressionImpl();
    const meta = await mp.load('p_new');
    expect(meta.runCount).toBe(0);
    expect(meta.discoveredScenes).toEqual([]);
  });

  test('commitRun 增量更新各字段', async () => {
    const mp = new MetaProgressionImpl();
    await mp.commitRun('p1', {
      scenes: ['s1', 's2'], events: ['e1'], npcs: ['n1'],
      ending: 'ending_good', completed: true, playTimeSeconds: 100,
    });
    const meta = await mp.load('p1');
    expect(meta.runCount).toBe(1);
    expect(meta.completedRuns).toBe(1);
    expect(meta.totalPlayTimeSeconds).toBe(100);
    expect(meta.discoveredScenes).toEqual(['s1', 's2']);
    expect(meta.discoveredEndings).toEqual(['ending_good']);
  });

  test('commitRun 多次合并去重', async () => {
    const mp = new MetaProgressionImpl();
    await mp.commitRun('p1', { scenes: ['s1', 's2'], events: [], npcs: [] });
    await mp.commitRun('p1', { scenes: ['s2', 's3'], events: [], npcs: [] });
    const meta = await mp.load('p1');
    expect(meta.runCount).toBe(2);
    expect(meta.discoveredScenes.sort()).toEqual(['s1', 's2', 's3']);
  });

  test('未通关也会累计 runCount 但不增 completedRuns', async () => {
    const mp = new MetaProgressionImpl();
    await mp.commitRun('p1', { scenes: ['s1'], completed: false });
    const meta = await mp.load('p1');
    expect(meta.runCount).toBe(1);
    expect(meta.completedRuns).toBe(0);
  });

  test('unlock 添加 unlockedRaces', async () => {
    const mp = new MetaProgressionImpl();
    await mp.unlock('p1', 'Races', 'demon');
    const meta = await mp.load('p1');
    expect(meta.unlockedRaces).toContain('demon');
  });

  test('不同 preset 元进度互相独立', async () => {
    const mp = new MetaProgressionImpl();
    await mp.commitRun('p1', { scenes: ['s_p1'], events: [], npcs: [] });
    await mp.commitRun('p2', { scenes: ['s_p2'], events: [], npcs: [] });
    const m1 = await mp.load('p1');
    const m2 = await mp.load('p2');
    expect(m1.discoveredScenes).toEqual(['s_p1']);
    expect(m2.discoveredScenes).toEqual(['s_p2']);
  });

  test('clear 清空指定 preset 的元进度', async () => {
    const mp = new MetaProgressionImpl();
    await mp.commitRun('p1', { scenes: ['s1'] });
    await mp.clear('p1');
    const meta = await mp.load('p1');
    expect(meta.runCount).toBe(0);
  });
});
