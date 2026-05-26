/**
 * 渲染引擎
 * 管理Canvas视口、缩放平移、图层系统和鼠标交互
 */

import { GameSystem } from '../core/GameEngine.js';

export class RenderEngine extends GameSystem {
  constructor() {
    super('RenderEngine');

    /** @type {HTMLCanvasElement|null} */
    this.canvas = null;
    /** @type {CanvasRenderingContext2D|null} */
    this.ctx = null;

    // 视口
    this.viewport = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      zoom: 1,
      minZoom: 0.3,
      maxZoom: 3,
    };

    // 拖拽状态
    this.dragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.viewStartX = 0;
    this.viewStartY = 0;

    // 渲染回调列表（替代图层系统，更灵活）
    this.renderCallbacks = [];

    // 鼠标位置
    this.mouseX = 0;
    this.mouseY = 0;

    // 事件系统引用
    this.eventSystem = null;

    // 绑定方法
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onResize = this._onResize.bind(this);
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.eventSystem = gameEngine.getSystem('EventSystem');
  }

  /**
   * 初始化Canvas
   * @param {HTMLCanvasElement} canvas
   */
  setupCanvas(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resizeCanvas();
    this.bindEvents();

    // ResizeObserver 监听 canvas 父容器尺寸变化 — 兼容初始布局延迟落定的情况
    // （比如首次 loadPreset 时 parent 还没拿到最终宽高，导致 _centerMapOnPlayer 算偏）
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      this._resizeObserver = new ResizeObserver(() => this.resizeCanvas());
      this._resizeObserver.observe(canvas.parentElement);
    }
  }

  /** 调整Canvas尺寸以匹配容器，并通知订阅者重新居中 */
  resizeCanvas() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();

    // 0 尺寸时跳过，避免污染 viewport（如初始挂载 / display:none 时）
    if (rect.width === 0 || rect.height === 0) return;

    const widthChanged = this.viewport.width !== rect.width;
    const heightChanged = this.viewport.height !== rect.height;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';

    this.viewport.width = rect.width;
    this.viewport.height = rect.height;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 尺寸真的变了 → 通知监听者（main.js 会重新居中场景图）
    if ((widthChanged || heightChanged) && this.eventSystem) {
      this.eventSystem.publish('render:resize', {
        width: rect.width,
        height: rect.height,
      });
    }
  }

  /** 绑定DOM事件（鼠标 + 触控，Phase 14 移动端适配） */
  bindEvents() {
    if (!this.canvas) return;
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mouseup', this._onMouseUp);
    this.canvas.addEventListener('mouseleave', this._onMouseUp);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('click', this._onClick);
    window.addEventListener('resize', this._onResize);

    // 触控事件（手指拖拽 + 点击）— 转换为同等的鼠标事件
    this._onTouchStart = (e) => this._dispatchTouchAsMouse(e, 'mousedown');
    this._onTouchMove = (e) => {
      e.preventDefault();  // 防止页面滚动干扰
      this._dispatchTouchAsMouse(e, 'mousemove');
    };
    this._onTouchEnd = (e) => {
      this._dispatchTouchAsMouse(e, 'mouseup');
      // 触控结束时若未拖拽则视为 click
      if (e.changedTouches && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        this._dispatchTouchAsMouse({ ...e, touches: [t] }, 'click', t);
      }
    };
    this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: true });
    this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this._onTouchEnd, { passive: true });
    this.canvas.addEventListener('touchcancel', this._onTouchEnd, { passive: true });
  }

  /** 把 TouchEvent 转换为合成的 MouseEvent 触发已有处理器 */
  _dispatchTouchAsMouse(touchEvent, mouseType, fallbackTouch = null) {
    const touch = fallbackTouch || (touchEvent.touches && touchEvent.touches[0]);
    if (!touch) {
      if (mouseType === 'mouseup' || mouseType === 'mouseleave') {
        // 触控结束没有 touches，直接走 _onMouseUp 通用路径
        this._onMouseUp({ clientX: this.dragStartX, clientY: this.dragStartY });
      }
      return;
    }
    const fakeEvent = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      preventDefault: () => {},
    };
    if (mouseType === 'mousedown') this._onMouseDown(fakeEvent);
    else if (mouseType === 'mousemove') this._onMouseMove(fakeEvent);
    else if (mouseType === 'mouseup') this._onMouseUp(fakeEvent);
    else if (mouseType === 'click') this._onClick(fakeEvent);
  }

  /** 解绑DOM事件 */
  unbindEvents() {
    if (!this.canvas) return;
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('mouseleave', this._onMouseUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('click', this._onClick);
    if (this._onTouchStart) {
      this.canvas.removeEventListener('touchstart', this._onTouchStart);
      this.canvas.removeEventListener('touchmove', this._onTouchMove);
      this.canvas.removeEventListener('touchend', this._onTouchEnd);
      this.canvas.removeEventListener('touchcancel', this._onTouchEnd);
    }
    window.removeEventListener('resize', this._onResize);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  /** 鼠标按下 */
  _onMouseDown(e) {
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.viewStartX = this.viewport.x;
    this.viewStartY = this.viewport.y;
    this.canvas.style.cursor = 'grabbing';
  }

  /** 鼠标移动 */
  _onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;

    if (this.dragging) {
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      this.viewport.x = this.viewStartX - dx / this.viewport.zoom;
      this.viewport.y = this.viewStartY - dy / this.viewport.zoom;
    }
  }

  /** 鼠标松开 */
  _onMouseUp(e) {
    this.dragging = false;
    if (this.canvas) {
      this.canvas.style.cursor = 'default';
    }
  }

  /** 鼠标滚轮（缩放） */
  _onWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(
      this.viewport.minZoom,
      Math.min(this.viewport.maxZoom, this.viewport.zoom * zoomFactor)
    );

    // 以鼠标位置为中心缩放
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const worldX = this.viewport.x + mx / this.viewport.zoom;
    const worldY = this.viewport.y + my / this.viewport.zoom;

    this.viewport.zoom = newZoom;

    this.viewport.x = worldX - mx / newZoom;
    this.viewport.y = worldY - my / newZoom;
  }

  /** 点击事件 */
  _onClick(e) {
    // 如果刚拖拽了一段距离，不触发点击
    const dx = Math.abs(e.clientX - this.dragStartX);
    const dy = Math.abs(e.clientY - this.dragStartY);
    if (dx > 5 || dy > 5) return;

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // 转换为世界坐标
    const worldX = this.viewport.x + screenX / this.viewport.zoom;
    const worldY = this.viewport.y + screenY / this.viewport.zoom;

    if (this.eventSystem) {
      this.eventSystem.publish('render:click', { screenX, screenY, worldX, worldY });
    }
  }

  /** 窗口大小变化 */
  _onResize() {
    this.resizeCanvas();
  }

  /**
   * 注册渲染回调
   * @param {Function} callback - 接收(ctx, viewport)的渲染函数
   * @param {number} zOrder - 绘制顺序（越小越先画）
   */
  addRenderCallback(callback, zOrder = 0) {
    this.renderCallbacks.push({ callback, zOrder });
    this.renderCallbacks.sort((a, b) => a.zOrder - b.zOrder);
  }

  /**
   * 屏幕坐标转世界坐标
   */
  screenToWorld(screenX, screenY) {
    return {
      x: this.viewport.x + screenX / this.viewport.zoom,
      y: this.viewport.y + screenY / this.viewport.zoom,
    };
  }

  /**
   * 世界坐标转屏幕坐标
   */
  worldToScreen(worldX, worldY) {
    return {
      x: (worldX - this.viewport.x) * this.viewport.zoom,
      y: (worldY - this.viewport.y) * this.viewport.zoom,
    };
  }

  /**
   * 将视口居中到指定世界坐标
   * @param {number} worldX
   * @param {number} worldY
   */
  centerOn(worldX, worldY) {
    this.viewport.x = worldX - this.viewport.width / (2 * this.viewport.zoom);
    this.viewport.y = worldY - this.viewport.height / (2 * this.viewport.zoom);
  }

  /** 每帧渲染 */
  update(deltaTime, gameState) {
    if (!this.ctx) return;

    // 清空画布
    this.ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);

    // 执行所有渲染回调
    for (const { callback } of this.renderCallbacks) {
      this.ctx.save();
      callback(this.ctx, this.viewport, gameState);
      this.ctx.restore();
    }
  }

  destroy() {
    this.unbindEvents();
    this.canvas = null;
    this.ctx = null;
    this.renderCallbacks = [];
    this.eventSystem = null;
    super.destroy();
  }
}
