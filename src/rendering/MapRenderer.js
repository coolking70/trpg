/**
 * 地图渲染器
 * 在Canvas上绘制网格地图、迷雾、玩家标记和兴趣点
 */

export class MapRenderer {
  constructor() {
    /** @type {import('../models/MapData.js').MapData|null} */
    this.mapData = null;

    /** @type {Map<string, HTMLCanvasElement>} 预渲染地块缓存 */
    this.tileCache = new Map();

    /** @type {Map<string, HTMLImageElement>} 地块图片缓存 */
    this.imageCache = new Map();

    // 高亮格子（多个，用于显示可移动目标）
    this.highlightedTiles = []; // Array<{ x, y }>

    // 选中格子
    this.selectedTile = null;  // { x, y }
  }

  /**
   * 设置地图数据并构建缓存
   * @param {import('../models/MapData.js').MapData} mapData
   */
  setMapData(mapData) {
    this.mapData = mapData;
    this.buildTileCache();
    this.loadTileImages();
  }

  /** 预渲染每种地块类型为离屏Canvas */
  buildTileCache() {
    this.tileCache.clear();
    if (!this.mapData) return;

    const size = this.mapData.tileSize;

    for (const [key, tileDef] of Object.entries(this.mapData.tileTypes)) {
      const offscreen = document.createElement('canvas');
      offscreen.width = size;
      offscreen.height = size;
      const ctx = offscreen.getContext('2d');

      // 填充颜色
      ctx.fillStyle = tileDef.color || '#333';
      ctx.fillRect(0, 0, size, size);

      // 绘制网格边框
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

      // 地块标识小字
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(tileDef.name, size / 2, size - 2);

      this.tileCache.set(key, offscreen);
    }
  }

  /** 加载地块图片资源 */
  loadTileImages() {
    if (!this.mapData) return;

    for (const [key, tileDef] of Object.entries(this.mapData.tileTypes)) {
      if (tileDef.image) {
        const img = new Image();
        img.onload = () => {
          this.imageCache.set(key, img);
          // 用图片重建该地块的缓存
          this.rebuildTileCacheEntry(key, img);
        };
        img.src = tileDef.image;
      }
    }
  }

  /** 用图片重建单个地块缓存 */
  rebuildTileCacheEntry(key, img) {
    const size = this.mapData.tileSize;
    const offscreen = document.createElement('canvas');
    offscreen.width = size;
    offscreen.height = size;
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);

    // 网格边框
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

    this.tileCache.set(key, offscreen);
  }

  /**
   * 渲染地图（作为RenderEngine的回调）
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} viewport
   * @param {object} gameState
   */
  render(ctx, viewport, gameState) {
    if (!this.mapData || !gameState) return;

    const tileSize = this.mapData.tileSize;
    const zoom = viewport.zoom;
    const scaledSize = tileSize * zoom;

    // 计算可见范围（视锥剔除）
    const startCol = Math.max(0, Math.floor(viewport.x / tileSize));
    const startRow = Math.max(0, Math.floor(viewport.y / tileSize));
    const endCol = Math.min(this.mapData.width, Math.ceil((viewport.x + viewport.width / zoom) / tileSize) + 1);
    const endRow = Math.min(this.mapData.height, Math.ceil((viewport.y + viewport.height / zoom) / tileSize) + 1);

    const revealed = new Set(gameState.mapState.revealedTiles);

    // 绘制地块
    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        const screenX = (col * tileSize - viewport.x) * zoom;
        const screenY = (row * tileSize - viewport.y) * zoom;

        if (revealed.has(`${col},${row}`)) {
          // 已揭示区域：绘制地块
          const tileKey = this.mapData.grid[row]?.[col];
          const cached = this.tileCache.get(tileKey);
          if (cached) {
            ctx.drawImage(cached, screenX, screenY, scaledSize, scaledSize);
          }

          // 已访问但非当前区域半透明覆盖
          const pos = gameState.mapState.playerPosition;
          const dist = Math.abs(col - pos.x) + Math.abs(row - pos.y);
          if (dist > this.mapData.revealRadius + 1) {
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(screenX, screenY, scaledSize, scaledSize);
          }
        } else if (this.mapData.fogOfWar) {
          // 未揭示区域：迷雾
          ctx.fillStyle = '#0f0f1a';
          ctx.fillRect(screenX, screenY, scaledSize, scaledSize);
          ctx.strokeStyle = 'rgba(255,255,255,0.03)';
          ctx.strokeRect(screenX + 0.5, screenY + 0.5, scaledSize - 1, scaledSize - 1);
        }
      }
    }

    // 绘制兴趣点标记
    this.renderPOIs(ctx, viewport, gameState, revealed);

    // 绘制高亮格子
    this.renderHighlight(ctx, viewport);

    // 绘制玩家标记
    this.renderPlayerToken(ctx, viewport, gameState);

    // 绘制战斗中的敌人标记
    if (gameState.activeCombat) {
      this.renderEnemyTokens(ctx, viewport, gameState);
    }
  }

  /** 渲染兴趣点 */
  renderPOIs(ctx, viewport, gameState, revealed) {
    if (!this.mapData) return;
    const tileSize = this.mapData.tileSize;
    const zoom = viewport.zoom;

    for (const poi of this.mapData.pointsOfInterest) {
      if (!revealed.has(`${poi.x},${poi.y}`)) continue;

      const screenX = (poi.x * tileSize - viewport.x) * zoom;
      const screenY = (poi.y * tileSize - viewport.y) * zoom;
      const size = tileSize * zoom;

      // POI指示器（小菱形）
      ctx.save();
      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 2;
      const cx = screenX + size / 2;
      const cy = screenY + size * 0.2;
      const r = size * 0.12;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /** 渲染高亮格子（多个可移动目标） */
  renderHighlight(ctx, viewport) {
    if (!this.highlightedTiles || this.highlightedTiles.length === 0 || !this.mapData) return;

    const tileSize = this.mapData.tileSize;
    const zoom = viewport.zoom;

    for (const tile of this.highlightedTiles) {
      const screenX = (tile.x * tileSize - viewport.x) * zoom;
      const screenY = (tile.y * tileSize - viewport.y) * zoom;
      const size = tileSize * zoom;

      // 青色高亮（区别于紫色玩家标记）
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(screenX + 1, screenY + 1, size - 2, size - 2);

      ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
      ctx.fillRect(screenX, screenY, size, size);
    }
  }

  /** 渲染玩家标记 */
  renderPlayerToken(ctx, viewport, gameState) {
    if (!this.mapData) return;
    const tileSize = this.mapData.tileSize;
    const zoom = viewport.zoom;
    const pos = gameState.mapState.playerPosition;

    const cx = (pos.x * tileSize + tileSize / 2 - viewport.x) * zoom;
    const cy = (pos.y * tileSize + tileSize / 2 - viewport.y) * zoom;
    const radius = tileSize * zoom * 0.3;

    // 外圈发光
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(139, 92, 246, 0.3)';
    ctx.fill();

    // 主圆
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#8b5cf6';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // P字
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.floor(radius)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', cx, cy);
  }

  /** 渲染敌人标记（含 HP 条） */
  renderEnemyTokens(ctx, viewport, gameState) {
    if (!this.mapData || !gameState.activeCombat) return;
    const tileSize = this.mapData.tileSize;
    const zoom = viewport.zoom;

    for (const enemy of gameState.activeCombat.enemies) {
      if (enemy.stats.hpCurrent <= 0) continue;
      const pos = enemy.position || gameState.mapState.playerPosition;

      const cx = (pos.x * tileSize + tileSize / 2 - viewport.x) * zoom;
      const cy = (pos.y * tileSize + tileSize / 2 - viewport.y) * zoom;
      const radius = tileSize * zoom * 0.25;

      // 主圆
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // E 字
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.floor(radius * 0.8)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('E', cx, cy);

      // HP 条（圆下方）
      const barWidth = radius * 2.4;
      const barHeight = Math.max(3, radius * 0.18);
      const barX = cx - barWidth / 2;
      const barY = cy + radius + 4;
      const hpPct = enemy.stats.hp > 0
        ? Math.max(0, enemy.stats.hpCurrent / enemy.stats.hp)
        : 0;

      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      ctx.fillStyle = hpPct > 0.5 ? '#22c55e' : (hpPct > 0.25 ? '#f59e0b' : '#ef4444');
      ctx.fillRect(barX, barY, barWidth * hpPct, barHeight);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barWidth, barHeight);
    }
  }

  /**
   * 世界坐标转网格坐标
   * @param {number} worldX
   * @param {number} worldY
   * @returns {{x: number, y: number}|null}
   */
  worldToGrid(worldX, worldY) {
    if (!this.mapData) return null;
    const x = Math.floor(worldX / this.mapData.tileSize);
    const y = Math.floor(worldY / this.mapData.tileSize);
    if (this.mapData.isInBounds(x, y)) {
      return { x, y };
    }
    return null;
  }

  /**
   * 设置高亮格子（多个可移动目标）
   * @param {Array<{x: number, y: number}>} tiles - 高亮格子坐标数组
   */
  setHighlights(tiles) {
    this.highlightedTiles = tiles || [];
  }

  /** 清除所有高亮 */
  clearHighlights() {
    this.highlightedTiles = [];
  }

  /**
   * 检查指定格子是否在高亮列表中
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isHighlighted(x, y) {
    return this.highlightedTiles.some(t => t.x === x && t.y === y);
  }
}
