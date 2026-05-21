/**
 * StateManager 测试：单槽 + 多槽位存档 + 快照 + 监听
 */

import { StateManager } from '../../src/core/StateManager.js';

describe('StateManager', () => {
  let sm;
  beforeEach(() => {
    // localStorage mock for jsdom
    if (typeof localStorage === 'undefined') {
      const store = {};
      global.localStorage = {
        getItem: (k) => store[k] || null,
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { for (const k of Object.keys(store)) delete store[k]; },
        key: (i) => Object.keys(store)[i],
        get length() { return Object.keys(store).length; },
      };
    }
    localStorage.clear();
    sm = new StateManager();
  });

  describe('基础 setState / getState', () => {
    test('setState 写入 + dirty 标记', () => {
      const state = { x: 1 };
      sm.setState(state);
      expect(sm.getState()).toBe(state);
      expect(sm.isDirty()).toBe(true);
    });
  });

  describe('updateState 路径写入', () => {
    test('深路径写入', () => {
      sm.setState({ activeCharacters: [{ stats: { hpCurrent: 100 } }] });
      sm.updateState('activeCharacters.0.stats.hpCurrent', 50);
      expect(sm.state.activeCharacters[0].stats.hpCurrent).toBe(50);
    });

    test('无效路径不报错', () => {
      sm.setState({ x: 1 });
      expect(() => sm.updateState('a.b.c', 99)).not.toThrow();
    });

    test('无 state 时不报错', () => {
      expect(() => sm.updateState('a', 1)).not.toThrow();
    });
  });

  describe('快照', () => {
    test('saveSnapshot + rollback', () => {
      sm.setState({ x: 1 });
      sm.saveSnapshot();
      sm.setState({ x: 2 });
      expect(sm.rollback()).toBe(true);
      expect(sm.state.x).toBe(1);
    });

    test('无快照时 rollback 返回 false', () => {
      expect(sm.rollback()).toBe(false);
    });

    test('快照超限保留最新', () => {
      sm.maxSnapshots = 3;
      sm.setState({ x: 0 });
      for (let i = 1; i <= 5; i++) {
        sm.setState({ x: i });
        sm.saveSnapshot();
      }
      expect(sm.snapshots.length).toBe(3);
      // 最新快照
      expect(sm.snapshots[2].x).toBe(5);
    });

    test('clearSnapshots 清空', () => {
      sm.setState({ x: 1 });
      sm.saveSnapshot();
      sm.clearSnapshots();
      expect(sm.snapshots.length).toBe(0);
    });
  });

  describe('单槽 localStorage', () => {
    test('saveToLocal + loadFromLocal 完整往返', () => {
      sm.setState({ gold: 100, name: '艾拉' });
      expect(sm.saveToLocal('test_slot')).toBe(true);

      const sm2 = new StateManager();
      const loaded = sm2.loadFromLocal('test_slot');
      expect(loaded.gold).toBe(100);
      expect(loaded.name).toBe('艾拉');
    });

    test('loadFromLocal 不存在的 key 返回 null', () => {
      expect(sm.loadFromLocal('nonexistent')).toBeNull();
    });

    test('serialize / deserialize', () => {
      sm.setState({ a: 1, nested: { b: 2 } });
      const json = sm.serialize();
      const sm2 = new StateManager();
      sm2.deserialize(json);
      expect(sm2.state.nested.b).toBe(2);
    });

    test('deserialize 错误 JSON 返回 false', () => {
      const origErr = console.error;
      console.error = jest.fn();
      expect(sm.deserialize('not json')).toBe(false);
      console.error = origErr;
    });
  });

  describe('多槽位存档', () => {
    test('saveToSlot + loadFromSlot', () => {
      sm.setState({ pos: { x: 5, y: 3 } });
      expect(sm.saveToSlot('auto', '自动存档', '{"name":"test_preset"}')).toBe(true);

      const sm2 = new StateManager();
      const loaded = sm2.loadFromSlot('auto');
      expect(loaded).toBeTruthy();
      expect(loaded.state.pos.x).toBe(5);
      expect(loaded.preset).toBe('{"name":"test_preset"}');
    });

    test('loadFromSlot 不存在返回 null', () => {
      expect(sm.loadFromSlot('nonexistent')).toBeNull();
    });

    test('saveToSlot 无 state 时返回 false', () => {
      expect(sm.saveToSlot('auto', 'x', null)).toBe(false);
    });

    test('listSlots 返回元数据列表', () => {
      sm.setState({ gold: 100 });
      sm.saveToSlot('slot1', '存档1');
      sm.setState({ gold: 200 });
      sm.saveToSlot('slot2', '存档2');
      const slots = sm.listSlots();
      expect(slots.length).toBe(2);
      const slot1 = slots.find(s => s.id === 'slot1');
      expect(slot1.name).toBe('存档1');
      expect(slot1.savedAt).toBeTruthy();
    });

    test('覆盖同槽位', () => {
      sm.setState({ v: 1 });
      sm.saveToSlot('s', 'A');
      sm.setState({ v: 2 });
      sm.saveToSlot('s', 'B');
      const loaded = sm.loadFromSlot('s');
      expect(loaded.state.v).toBe(2);
      const slots = sm.listSlots();
      expect(slots.length).toBe(1);
      expect(slots[0].name).toBe('B');
    });
  });

  describe('监听器', () => {
    test('addListener 收到通知', () => {
      const listener = jest.fn();
      const unsub = sm.addListener(listener);
      sm.setState({ x: 1 });
      expect(listener).toHaveBeenCalledWith('set', null);
      unsub();
      sm.setState({ x: 2 });
      // unsub 后不再调用
      expect(listener).toHaveBeenCalledTimes(1);
    });

    test('监听器异常隔离', () => {
      const origErr = console.error;
      console.error = jest.fn();
      sm.addListener(() => { throw new Error('boom'); });
      const ok = jest.fn();
      sm.addListener(ok);
      sm.setState({ x: 1 });
      expect(ok).toHaveBeenCalled();
      console.error = origErr;
    });
  });
});
