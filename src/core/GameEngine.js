/**
 * 游戏引擎核心
 * 负责游戏循环管理、时间管理和系统注册
 * 移植自sanguo项目并适配TRPG需求
 */

/**
 * 游戏系统基类
 * 所有游戏系统（卡牌、战斗、地图等）都继承此类
 */
export class GameSystem {
  constructor(name) {
    this.name = name;
    this.enabled = true;
    this.priority = 0;
    this.gameEngine = null;
  }

  /**
   * 系统初始化，引擎启动时调用
   * @param {GameEngine} gameEngine - 游戏引擎实例
   */
  initialize(gameEngine) {
    this.gameEngine = gameEngine;
  }

  /**
   * 系统更新，每帧调用
   * @param {number} deltaTime - 距上一帧的毫秒数
   * @param {object} gameState - 当前游戏状态
   */
  update(deltaTime, gameState) {
    // 子类实现
  }

  /**
   * 系统销毁
   */
  destroy() {
    this.gameEngine = null;
  }

  /**
   * 获取其他系统的引用
   * @param {string} systemName - 系统名称
   * @returns {GameSystem|undefined}
   */
  getSystem(systemName) {
    if (this.gameEngine) {
      return this.gameEngine.getSystem(systemName);
    }
    return undefined;
  }

  /** 启用系统 */
  enable() {
    this.enabled = true;
    return this;
  }

  /** 禁用系统 */
  disable() {
    this.enabled = false;
    return this;
  }
}

/**
 * 游戏引擎类
 * 管理游戏循环、系统注册与更新
 */
export class GameEngine {
  constructor() {
    this.isRunning = false;
    this.isPaused = false;
    this.lastTime = 0;
    this.currentTime = 0;
    this.deltaTime = 0;
    this.targetFPS = 60;
    this.frameInterval = 1000 / this.targetFPS;

    // 系统管理
    this.systems = new Map();
    this.systemUpdateOrder = [];

    // 游戏循环
    this.animationFrameId = null;
    this.gameLoopBound = this.gameLoop.bind(this);

    // 性能监控
    this.frameCount = 0;
    this.fpsUpdateTime = 0;
    this.currentFPS = 0;

    // 回调
    this.onUpdate = null;
    this.onRender = null;
  }

  /** 启动游戏引擎 */
  start() {
    if (this.isRunning) {
      console.warn('游戏引擎已经在运行中');
      return this;
    }

    console.log('启动游戏引擎...');
    this.isRunning = true;
    this.isPaused = false;
    this.lastTime = performance.now();

    // 初始化所有系统
    this.systems.forEach(system => {
      if (system.enabled) {
        system.initialize(this);
      }
    });

    // 开始游戏循环
    this.animationFrameId = requestAnimationFrame(this.gameLoopBound);
    return this;
  }

  /** 暂停游戏引擎 */
  pause() {
    if (!this.isRunning || this.isPaused) return this;
    this.isPaused = true;
    return this;
  }

  /** 恢复游戏引擎 */
  resume() {
    if (!this.isRunning || !this.isPaused) return this;
    this.isPaused = false;
    this.lastTime = performance.now();
    return this;
  }

  /** 停止游戏引擎 */
  stop() {
    if (!this.isRunning) return this;

    console.log('停止游戏引擎');
    this.isRunning = false;
    this.isPaused = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.systems.forEach(system => system.destroy());
    return this;
  }

  /** 游戏主循环 */
  gameLoop(timestamp) {
    if (!this.isRunning) return;

    this.currentTime = timestamp;
    this.deltaTime = Math.min(this.currentTime - this.lastTime, 100);

    this.updateFPS();

    if (!this.isPaused) {
      this.update(this.deltaTime);
    }

    this.render();
    this.lastTime = this.currentTime;
    this.animationFrameId = requestAnimationFrame(this.gameLoopBound);
  }

  /** 更新游戏逻辑 */
  update(deltaTime) {
    for (const systemName of this.systemUpdateOrder) {
      const system = this.systems.get(systemName);
      if (system && system.enabled) {
        system.update(deltaTime, this.getGameState());
      }
    }

    if (this.onUpdate) {
      this.onUpdate(deltaTime);
    }
  }

  /** 渲染 */
  render() {
    if (this.onRender) {
      this.onRender();
    }
  }

  /** 更新FPS计数 */
  updateFPS() {
    this.frameCount++;
    if (this.currentTime - this.fpsUpdateTime >= 1000) {
      this.currentFPS = this.frameCount;
      this.frameCount = 0;
      this.fpsUpdateTime = this.currentTime;
    }
  }

  /**
   * 注册游戏系统
   * @param {GameSystem} system - 系统实例
   * @param {number} priority - 优先级（数字越大越先更新）
   */
  registerSystem(system, priority = 0) {
    if (!(system instanceof GameSystem)) {
      throw new Error('系统必须继承自GameSystem类');
    }

    if (this.systems.has(system.name)) {
      console.warn(`系统 ${system.name} 已存在，将被替换`);
    }

    this.systems.set(system.name, system);
    system.priority = priority;

    // 按优先级排序插入
    const insertIndex = this.systemUpdateOrder.findIndex(name => {
      const existing = this.systems.get(name);
      return existing && existing.priority < priority;
    });

    if (insertIndex === -1) {
      this.systemUpdateOrder.push(system.name);
    } else {
      this.systemUpdateOrder.splice(insertIndex, 0, system.name);
    }

    if (this.isRunning) {
      system.initialize(this);
    }

    return this;
  }

  /** 注销游戏系统 */
  unregisterSystem(systemName) {
    const system = this.systems.get(systemName);
    if (!system) return this;

    system.destroy();
    this.systems.delete(systemName);
    const index = this.systemUpdateOrder.indexOf(systemName);
    if (index !== -1) {
      this.systemUpdateOrder.splice(index, 1);
    }

    return this;
  }

  /** 获取系统 */
  getSystem(systemName) {
    return this.systems.get(systemName);
  }

  /** 获取游戏状态（需要外部赋值或重写） */
  getGameState() {
    return null;
  }

  /** 获取引擎状态信息 */
  getEngineInfo() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      currentFPS: this.currentFPS,
      targetFPS: this.targetFPS,
      systemCount: this.systems.size,
      deltaTime: this.deltaTime,
    };
  }

  /** 设置目标FPS */
  setTargetFPS(fps) {
    this.targetFPS = Math.max(1, Math.min(120, fps));
    this.frameInterval = 1000 / this.targetFPS;
    return this;
  }

  /** 设置更新回调 */
  setUpdateCallback(callback) {
    this.onUpdate = callback;
    return this;
  }

  /** 设置渲染回调 */
  setRenderCallback(callback) {
    this.onRender = callback;
    return this;
  }
}
