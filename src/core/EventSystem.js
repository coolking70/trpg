/**
 * 事件系统
 * 负责事件的发布订阅、队列管理和处理
 * 移植自sanguo项目并适配TRPG需求
 */

import { GameSystem } from './GameEngine.js';

/**
 * 游戏事件类
 */
export class GameEvent {
  constructor(type, data = null, source = null) {
    this.type = type;
    this.data = data;
    this.source = source;
    this.timestamp = Date.now();
    this.id = 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    this.handled = false;
    this.cancelled = false;
  }

  /** 标记为已处理 */
  markHandled() {
    this.handled = true;
    return this;
  }

  /** 取消事件 */
  cancel() {
    this.cancelled = true;
    return this;
  }

  isCancelled() { return this.cancelled; }
  isHandled() { return this.handled; }
}

/**
 * 延迟事件类
 */
export class DelayedEvent extends GameEvent {
  constructor(type, data, source, delay) {
    super(type, data, source);
    this.delay = delay;
    this.executeTime = this.timestamp + delay;
  }

  isReady(currentTime = Date.now()) {
    return currentTime >= this.executeTime;
  }
}

/**
 * 事件处理器类
 */
export class EventHandler {
  constructor(callback, priority = 0, once = false) {
    this.callback = callback;
    this.priority = priority;
    this.once = once;
    this.id = 'hdl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    this.enabled = true;
  }

  execute(event) {
    if (!this.enabled) return false;
    try {
      const result = this.callback(event);
      return result !== false;
    } catch (error) {
      console.error(`事件处理器执行错误: ${error.message}`, error);
      return true;
    }
  }

  enable() { this.enabled = true; return this; }
  disable() { this.enabled = false; return this; }
}

/**
 * 事件系统类
 * 提供发布/订阅、事件队列和拦截器功能
 */
export class EventSystem extends GameSystem {
  constructor() {
    super('EventSystem');
    this.handlers = new Map();
    this.eventQueue = [];
    this.delayedEvents = [];
    this.eventStats = new Map();
    this.maxQueueSize = 1000;
    this.enableStats = false;
    this.enableLogging = false;
    this.interceptors = [];
  }

  /**
   * 订阅事件
   * @param {string} eventType - 事件类型
   * @param {Function} callback - 回调函数
   * @param {number} priority - 优先级（越大越先执行）
   * @param {boolean} once - 是否只触发一次
   * @returns {string} 处理器ID
   */
  subscribe(eventType, callback, priority = 0, once = false) {
    if (typeof callback !== 'function') {
      throw new Error('回调函数必须是函数类型');
    }

    const handler = new EventHandler(callback, priority, once);

    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }

    const handlers = this.handlers.get(eventType);
    const insertIndex = handlers.findIndex(h => h.priority < priority);
    if (insertIndex === -1) {
      handlers.push(handler);
    } else {
      handlers.splice(insertIndex, 0, handler);
    }

    return handler.id;
  }

  /** 取消订阅 */
  unsubscribe(eventType, handlerId) {
    const handlers = this.handlers.get(eventType);
    if (!handlers) return false;

    const index = handlers.findIndex(h => h.id === handlerId);
    if (index === -1) return false;

    handlers.splice(index, 1);
    if (handlers.length === 0) {
      this.handlers.delete(eventType);
    }
    return true;
  }

  /**
   * 发布事件（立即处理）
   * @param {string} eventType - 事件类型
   * @param {*} data - 事件数据
   * @param {string} source - 事件来源
   */
  publish(eventType, data = null, source = null) {
    const event = new GameEvent(eventType, data, source);
    return this.dispatchEvent(event);
  }

  /**
   * 队列事件（延迟处理）
   * @param {string} eventType - 事件类型
   * @param {*} data - 事件数据
   * @param {number} delay - 延迟毫秒数
   * @param {string} source - 事件来源
   */
  queueEvent(eventType, data = null, delay = 0, source = null) {
    if (delay > 0) {
      const event = new DelayedEvent(eventType, data, source, delay);
      this.delayedEvents.push(event);
      return event.id;
    }

    const event = new GameEvent(eventType, data, source);
    this.eventQueue.push(event);

    if (this.eventQueue.length > this.maxQueueSize) {
      this.eventQueue.shift();
    }
    return event.id;
  }

  /** 处理事件队列（每帧调用） */
  processEvents() {
    const currentTime = Date.now();

    // 处理延迟事件
    for (let i = this.delayedEvents.length - 1; i >= 0; i--) {
      if (this.delayedEvents[i].isReady(currentTime)) {
        const event = this.delayedEvents.splice(i, 1)[0];
        this.dispatchEvent(event);
      }
    }

    // 处理普通队列
    while (this.eventQueue.length > 0) {
      this.dispatchEvent(this.eventQueue.shift());
    }
  }

  /** 分发事件 */
  dispatchEvent(event) {
    if (!(event instanceof GameEvent) || event.isCancelled()) return false;

    // 全局拦截器
    for (const interceptor of this.interceptors) {
      if (!interceptor(event)) return false;
    }

    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.length === 0) return false;

    let handledCount = 0;
    const toRemove = [];

    for (const handler of handlers) {
      if (event.isCancelled()) break;

      const shouldContinue = handler.execute(event);
      handledCount++;

      if (handler.once) toRemove.push(handler.id);
      if (shouldContinue === false) break;
    }

    toRemove.forEach(id => this.unsubscribe(event.type, id));

    if (handledCount > 0) event.markHandled();

    if (this.enableStats) {
      if (!this.eventStats.has(event.type)) {
        this.eventStats.set(event.type, { count: 0, totalHandlers: 0, lastTriggered: 0 });
      }
      const stats = this.eventStats.get(event.type);
      stats.count++;
      stats.totalHandlers += handledCount;
      stats.lastTriggered = Date.now();
    }

    return handledCount > 0;
  }

  /** 每帧更新时处理队列中的事件 */
  update(deltaTime, gameState) {
    this.processEvents();
  }

  /** 添加全局拦截器 */
  addInterceptor(interceptor) {
    if (typeof interceptor !== 'function') throw new Error('拦截器必须是函数');
    this.interceptors.push(interceptor);
    return this;
  }

  /** 移除全局拦截器 */
  removeInterceptor(interceptor) {
    const idx = this.interceptors.indexOf(interceptor);
    if (idx !== -1) this.interceptors.splice(idx, 1);
    return this;
  }

  /** 清空事件队列 */
  clearQueue() {
    this.eventQueue = [];
    this.delayedEvents = [];
    return this;
  }

  /** 清空所有处理器 */
  removeAllListeners() {
    this.handlers.clear();
    this.interceptors = [];
    return this;
  }

  /** 获取系统信息 */
  getSystemInfo() {
    return {
      handlerTypes: this.handlers.size,
      totalHandlers: Array.from(this.handlers.values()).reduce((t, h) => t + h.length, 0),
      queuedEvents: this.eventQueue.length,
      delayedEvents: this.delayedEvents.length,
    };
  }
}
