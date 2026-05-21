/**
 * EventSystem 测试：订阅 / 发布 / 优先级 / 队列 / 拦截器 / once
 */

import { EventSystem, GameEvent, DelayedEvent } from '../../src/core/EventSystem.js';

describe('EventSystem - 基础订阅发布', () => {
  let es;
  beforeEach(() => { es = new EventSystem(); });

  test('publish 调用订阅的 callback', () => {
    const cb = jest.fn();
    es.subscribe('test', cb);
    es.publish('test', { x: 1 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].data).toEqual({ x: 1 });
  });

  test('多个订阅者都被调用', () => {
    const cb1 = jest.fn(), cb2 = jest.fn(), cb3 = jest.fn();
    es.subscribe('e', cb1);
    es.subscribe('e', cb2);
    es.subscribe('e', cb3);
    es.publish('e');
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
    expect(cb3).toHaveBeenCalled();
  });

  test('未订阅事件类型 publish 不报错', () => {
    expect(() => es.publish('未订阅')).not.toThrow();
  });

  test('callback 非函数抛错', () => {
    expect(() => es.subscribe('e', null)).toThrow(/函数/);
  });
});

describe('EventSystem - 取消订阅', () => {
  test('unsubscribe 后 callback 不再触发', () => {
    const es = new EventSystem();
    const cb = jest.fn();
    const id = es.subscribe('e', cb);
    es.publish('e');
    expect(cb).toHaveBeenCalledTimes(1);
    es.unsubscribe('e', id);
    es.publish('e');
    expect(cb).toHaveBeenCalledTimes(1);  // 仍然只 1 次
  });

  test('unsubscribe 不存在的 handler 返回 false', () => {
    const es = new EventSystem();
    expect(es.unsubscribe('e', 'fake-id')).toBe(false);
    es.subscribe('e', () => {});
    expect(es.unsubscribe('e', 'fake-id')).toBe(false);
  });
});

describe('EventSystem - 优先级', () => {
  test('priority 高的先执行', () => {
    const es = new EventSystem();
    const order = [];
    es.subscribe('e', () => order.push('low'), 1);
    es.subscribe('e', () => order.push('high'), 10);
    es.subscribe('e', () => order.push('mid'), 5);
    es.publish('e');
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  test('callback 返回 false 中断后续', () => {
    const es = new EventSystem();
    const cb1 = jest.fn(() => false);
    const cb2 = jest.fn();
    es.subscribe('e', cb1, 10);
    es.subscribe('e', cb2, 1);
    es.publish('e');
    expect(cb1).toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
  });
});

describe('EventSystem - once 一次性', () => {
  test('once 触发后自动取消', () => {
    const es = new EventSystem();
    const cb = jest.fn();
    es.subscribe('e', cb, 0, true);
    es.publish('e');
    es.publish('e');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('EventSystem - 队列', () => {
  test('queueEvent 不立刻执行，processEvents 后才执行', () => {
    const es = new EventSystem();
    const cb = jest.fn();
    es.subscribe('q', cb);
    es.queueEvent('q', { a: 1 });
    expect(cb).not.toHaveBeenCalled();
    es.processEvents();
    expect(cb).toHaveBeenCalled();
  });

  test('队列容量超限丢弃最早的', () => {
    const es = new EventSystem();
    es.maxQueueSize = 3;
    es.subscribe('q', () => {});
    for (let i = 0; i < 5; i++) es.queueEvent('q');
    // 队列应被 trim 到 3 条（每次 push 后超限就 shift）
    expect(es.eventQueue.length).toBeLessThanOrEqual(3);
  });
});

describe('EventSystem - 延迟事件', () => {
  test('DelayedEvent isReady 按时间判断', () => {
    const evt = new DelayedEvent('e', null, null, 100);
    expect(evt.isReady(evt.timestamp + 50)).toBe(false);
    expect(evt.isReady(evt.timestamp + 150)).toBe(true);
  });

  test('processEvents 处理到期的延迟事件', () => {
    const es = new EventSystem();
    const cb = jest.fn();
    es.subscribe('delayed', cb);
    es.queueEvent('delayed', null, 100);
    // 未到时间
    es.processEvents();
    expect(cb).not.toHaveBeenCalled();
    // 模拟时间过去：把延迟事件的 executeTime 改为已过
    es.delayedEvents[0].executeTime = Date.now() - 1;
    es.processEvents();
    expect(cb).toHaveBeenCalled();
  });
});

describe('EventSystem - 拦截器', () => {
  test('addInterceptor 返回 false 时事件被拦截', () => {
    const es = new EventSystem();
    const cb = jest.fn();
    es.subscribe('e', cb);
    es.addInterceptor(() => false);  // 总是拦截
    es.publish('e');
    expect(cb).not.toHaveBeenCalled();
  });

  test('removeInterceptor 后恢复', () => {
    const es = new EventSystem();
    const cb = jest.fn();
    es.subscribe('e', cb);
    const interceptor = () => false;
    es.addInterceptor(interceptor);
    es.publish('e');
    expect(cb).not.toHaveBeenCalled();
    es.removeInterceptor(interceptor);
    es.publish('e');
    expect(cb).toHaveBeenCalled();
  });
});

describe('EventSystem - 错误隔离', () => {
  test('一个 callback 抛错不影响其他 callback', () => {
    const es = new EventSystem();
    const cb1 = jest.fn(() => { throw new Error('boom'); });
    const cb2 = jest.fn();
    es.subscribe('e', cb1);
    es.subscribe('e', cb2);
    // console.error 会输出，但不应抛
    const origErr = console.error;
    console.error = jest.fn();
    es.publish('e');
    console.error = origErr;
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });
});

describe('EventSystem - 清理', () => {
  test('removeAllListeners 清空所有处理器', () => {
    const es = new EventSystem();
    es.subscribe('a', () => {});
    es.subscribe('b', () => {});
    es.removeAllListeners();
    expect(es.handlers.size).toBe(0);
  });

  test('clearQueue 清空队列', () => {
    const es = new EventSystem();
    es.subscribe('e', () => {});
    es.queueEvent('e');
    es.queueEvent('e', null, 100);
    expect(es.eventQueue.length).toBe(1);
    expect(es.delayedEvents.length).toBe(1);
    es.clearQueue();
    expect(es.eventQueue.length).toBe(0);
    expect(es.delayedEvents.length).toBe(0);
  });

  test('getSystemInfo 返回统计', () => {
    const es = new EventSystem();
    es.subscribe('a', () => {});
    es.subscribe('a', () => {});
    es.subscribe('b', () => {});
    const info = es.getSystemInfo();
    expect(info.handlerTypes).toBe(2);
    expect(info.totalHandlers).toBe(3);
  });
});

describe('GameEvent', () => {
  test('markHandled / cancel / isXxx', () => {
    const e = new GameEvent('t');
    expect(e.isHandled()).toBe(false);
    expect(e.isCancelled()).toBe(false);
    e.markHandled();
    expect(e.isHandled()).toBe(true);
    e.cancel();
    expect(e.isCancelled()).toBe(true);
  });

  test('cancelled 事件不被分发', () => {
    const es = new EventSystem();
    const cb = jest.fn();
    es.subscribe('e', cb);
    const evt = new GameEvent('e');
    evt.cancel();
    es.dispatchEvent(evt);
    expect(cb).not.toHaveBeenCalled();
  });
});
