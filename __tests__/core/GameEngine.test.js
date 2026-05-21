/**
 * GameEngine 测试：系统注册顺序 + 生命周期
 */

import { GameEngine, GameSystem } from '../../src/core/GameEngine.js';

class FakeSystem extends GameSystem {
  constructor(name) { super(name); this.updateCount = 0; }
  update() { this.updateCount++; }
}

describe('GameEngine', () => {
  let engine;
  beforeEach(() => { engine = new GameEngine(); });

  describe('系统注册', () => {
    test('registerSystem 按 priority 排序', () => {
      const low = new FakeSystem('Low');
      const mid = new FakeSystem('Mid');
      const high = new FakeSystem('High');
      engine.registerSystem(low, 1);
      engine.registerSystem(high, 10);
      engine.registerSystem(mid, 5);
      // 更新顺序应是 high → mid → low
      expect(engine.systemUpdateOrder).toEqual(['High', 'Mid', 'Low']);
    });

    test('非 GameSystem 实例抛错', () => {
      expect(() => engine.registerSystem({ name: 'X' })).toThrow(/GameSystem/);
    });

    test('重复 name 会替换并 warn', () => {
      const origWarn = console.warn;
      console.warn = jest.fn();
      engine.registerSystem(new FakeSystem('A'), 1);
      engine.registerSystem(new FakeSystem('A'), 2);
      expect(console.warn).toHaveBeenCalled();
      console.warn = origWarn;
      expect(engine.systems.size).toBe(1);
    });

    test('getSystem 按 name 查找', () => {
      const sys = new FakeSystem('Test');
      engine.registerSystem(sys, 5);
      expect(engine.getSystem('Test')).toBe(sys);
      expect(engine.getSystem('NotExist')).toBeUndefined();
    });

    test('unregisterSystem 删除系统', () => {
      engine.registerSystem(new FakeSystem('X'), 1);
      engine.unregisterSystem('X');
      expect(engine.getSystem('X')).toBeUndefined();
      expect(engine.systemUpdateOrder).not.toContain('X');
    });

    test('unregister 不存在的系统无错', () => {
      expect(() => engine.unregisterSystem('fake')).not.toThrow();
    });
  });

  describe('系统间通信', () => {
    test('GameSystem.getSystem 通过 engine 引用查找', () => {
      const a = new FakeSystem('A');
      const b = new FakeSystem('B');
      engine.registerSystem(a, 1);
      engine.registerSystem(b, 1);
      a.initialize(engine);
      expect(a.getSystem('B')).toBe(b);
    });

    test('未初始化的系统 getSystem 返回 undefined', () => {
      const sys = new GameSystem('NoInit');
      expect(sys.getSystem('whatever')).toBeUndefined();
    });
  });

  describe('启用/禁用', () => {
    test('enable / disable 切换 enabled', () => {
      const sys = new FakeSystem('X');
      expect(sys.enabled).toBe(true);
      sys.disable();
      expect(sys.enabled).toBe(false);
      sys.enable();
      expect(sys.enabled).toBe(true);
    });
  });

  describe('引擎状态', () => {
    test('start / stop 切换 isRunning', () => {
      engine.start();
      expect(engine.isRunning).toBe(true);
      engine.stop();
      expect(engine.isRunning).toBe(false);
    });

    test('pause / resume', () => {
      engine.start();
      engine.pause();
      expect(engine.isPaused).toBe(true);
      engine.resume();
      expect(engine.isPaused).toBe(false);
      engine.stop();
    });

    test('重复 start 不出错', () => {
      const origWarn = console.warn;
      console.warn = jest.fn();
      engine.start();
      engine.start();
      console.warn = origWarn;
      engine.stop();
    });

    test('getEngineInfo 返回快照', () => {
      engine.registerSystem(new FakeSystem('X'), 1);
      const info = engine.getEngineInfo();
      expect(info.systemCount).toBe(1);
      expect(info.isRunning).toBe(false);
      expect(info.targetFPS).toBeDefined();
    });

    test('setTargetFPS 在 1-120 范围', () => {
      engine.setTargetFPS(30);
      expect(engine.targetFPS).toBe(30);
      engine.setTargetFPS(200);
      expect(engine.targetFPS).toBe(120);
      engine.setTargetFPS(0);
      expect(engine.targetFPS).toBe(1);
    });

    test('setUpdateCallback / setRenderCallback', () => {
      const upd = jest.fn(), ren = jest.fn();
      engine.setUpdateCallback(upd);
      engine.setRenderCallback(ren);
      expect(engine.onUpdate).toBe(upd);
      expect(engine.onRender).toBe(ren);
    });
  });

  describe('updateFPS', () => {
    test('每秒重置 frameCount', () => {
      engine.currentTime = 1000;
      engine.fpsUpdateTime = 0;
      engine.frameCount = 60;
      engine.updateFPS();
      expect(engine.currentFPS).toBe(61);
      expect(engine.frameCount).toBe(0);
    });
  });
});
