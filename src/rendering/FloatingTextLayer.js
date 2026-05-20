/**
 * 浮动文字层
 * 在地图坐标系上生成短暂的浮动文字（伤害飘字、治疗、状态提示等）
 * 由 RenderEngine 作为渲染回调调用
 */

export class FloatingTextLayer {
  constructor() {
    /** @type {Array<{worldX,worldY,text,color,spawnTime,lifeMs,fontSize}>} */
    this.items = [];
  }

  /**
   * 生成一条浮动文字
   * @param {object} opts
   * @param {number} opts.worldX - 起始世界 X 坐标
   * @param {number} opts.worldY - 起始世界 Y 坐标
   * @param {string} opts.text - 显示文本
   * @param {string} [opts.color='#ef4444'] - 颜色
   * @param {number} [opts.lifeMs=1500] - 生命周期
   * @param {number} [opts.fontSize=20] - 基础字号
   */
  spawn(opts) {
    this.items.push({
      worldX: opts.worldX,
      worldY: opts.worldY,
      text: String(opts.text),
      color: opts.color || '#ef4444',
      spawnTime: performance.now(),
      lifeMs: opts.lifeMs || 1500,
      fontSize: opts.fontSize || 20,
    });
  }

  /** 清空所有浮动文字 */
  clear() {
    this.items = [];
  }

  /**
   * 作为 RenderEngine.addRenderCallback 的回调
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} viewport
   */
  render(ctx, viewport) {
    const now = performance.now();
    // 修剪过期
    this.items = this.items.filter(item => now - item.spawnTime < item.lifeMs);
    if (this.items.length === 0) return;

    for (const item of this.items) {
      const age = now - item.spawnTime;
      const t = age / item.lifeMs; // 0 -> 1
      const opacity = 1 - t;
      const yOffset = -t * 50; // 向上飘 50 像素

      const screenX = (item.worldX - viewport.x) * viewport.zoom;
      const screenY = (item.worldY - viewport.y) * viewport.zoom + yOffset;

      ctx.save();
      ctx.globalAlpha = Math.max(0, opacity);
      ctx.font = `bold ${item.fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.strokeText(item.text, screenX, screenY);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, screenX, screenY);
      ctx.restore();
    }
  }
}
