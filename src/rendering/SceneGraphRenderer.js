/**
 * 场景图渲染器
 *
 * 节点 + 边的图状地图渲染。每个 Scene 节点用大号圆形图标 + 名称标签
 * 表示，相邻节点用发光路径线相连。点击邻居节点即可前往。
 *
 * 与旧的 MapRenderer 互斥使用 — preset.displayMode === 'scene-graph' 时启用。
 */

const NODE_RADIUS = 28;
const NODE_HIT_RADIUS = 40;
const COORD_SCALE = 64;  // 把 scene.coords (格子坐标) 放大成像素坐标

const NODE_STYLES = {
  current: {
    fill: '#a855f7', stroke: '#facc15', strokeWidth: 4, glow: 'rgba(250, 204, 21, 0.8)', textColor: '#fff',
  },
  reachable: {
    fill: '#3b82f6', stroke: '#67e8f9', strokeWidth: 2.5, glow: 'rgba(103, 232, 249, 0.5)', textColor: '#fff',
  },
  visited: {
    fill: '#475569', stroke: '#94a3b8', strokeWidth: 2, glow: null, textColor: '#cbd5e1',
  },
  locked: {
    fill: '#1e293b', stroke: '#475569', strokeWidth: 1.5, glow: null, textColor: '#64748b',
  },
  unknown: {
    fill: '#0f172a', stroke: '#1e293b', strokeWidth: 1.5, glow: null, textColor: '#334155',
  },
};

export class SceneGraphRenderer {
  constructor() {
    /** @type {object[]} 全部场景节点（来自 SceneSystem） */
    this.scenes = [];
    /** @type {Map<string, object>} sceneId → screen position cache */
    this._nodePos = new Map();
    /** @type {object|null} hover node */
    this._hoveredId = null;
    /** @type {{minX, minY, maxX, maxY} | null} 节点坐标包围盒（用于自动居中） */
    this.bounds = null;
    /** 是否启用 fog of war（未访问的非邻接节点显示为问号） */
    this.fogEnabled = true;
  }

  /**
   * 加载场景数据（从 SceneSystem）
   */
  setScenes(scenes) {
    this.scenes = scenes || [];
    this._computeBounds();
  }

  _computeBounds() {
    if (this.scenes.length === 0) { this.bounds = null; return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of this.scenes) {
      if (!s.coords) continue;
      if (s.coords.x < minX) minX = s.coords.x;
      if (s.coords.y < minY) minY = s.coords.y;
      if (s.coords.x > maxX) maxX = s.coords.x;
      if (s.coords.y > maxY) maxY = s.coords.y;
    }
    this.bounds = { minX, minY, maxX, maxY };
  }

  /**
   * 主渲染函数（作为 RenderEngine 的 callback）
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} viewport
   * @param {object} gameState
   * @param {object} sceneSystem - 注入的 SceneSystem 引用（用于查 reachable）
   */
  render(ctx, viewport, gameState, sceneSystem) {
    if (!this.scenes.length || !gameState) return;

    const currentSceneId = gameState.mapState?.currentSceneId;
    const visited = new Set(gameState.mapState?.visitedSceneIds || []);

    // 计算邻居（可达）id 集
    const adjacent = sceneSystem && currentSceneId
      ? sceneSystem.getAdjacent(gameState)
      : [];
    const reachableMap = new Map();  // sceneId → { reachable, lockedReason }
    for (const a of adjacent) {
      reachableMap.set(a.scene.id, { reachable: a.reachable, lockedReason: a.lockedReason });
    }

    // Phase 23C — 视口裁剪：所有节点都算屏幕坐标（保留 _nodePos 完整性），
    // 但渲染时跳过完全在屏外的（300+ 节点项目里这能省 60-90% 绘制工作）
    this._nodePos.clear();
    this._visibleSet = new Set();
    const margin = NODE_RADIUS * 2 + 100;
    let visibleCount = 0;
    for (const s of this.scenes) {
      if (!s.coords) continue;
      const wx = s.coords.x * COORD_SCALE + COORD_SCALE / 2;
      const wy = s.coords.y * COORD_SCALE + COORD_SCALE / 2;
      const sx = (wx - viewport.x) * viewport.zoom;
      const sy = (wy - viewport.y) * viewport.zoom;
      this._nodePos.set(s.id, { x: sx, y: sy });
      const onScreen = sx >= -margin && sx <= viewport.width + margin
                    && sy >= -margin && sy <= viewport.height + margin;
      if (onScreen) {
        this._visibleSet.add(s.id);
        visibleCount++;
      }
    }
    this._lastVisibleCount = visibleCount;

    // 1) 先绘制连接线（让节点叠在上面）
    this._renderEdges(ctx, currentSceneId, visited, reachableMap, viewport, gameState);

    // 2) 绘制节点 — Phase 23C 跳过屏外
    for (const s of this.scenes) {
      const pos = this._nodePos.get(s.id);
      if (!pos) continue;
      // 节点完全在屏外 → 跳过（current/邻居仍画以提示玩家方向）
      const state = this._classifyNode(s.id, currentSceneId, visited, reachableMap);
      if (!this._visibleSet.has(s.id) && state !== 'current' && state !== 'reachable') continue;
      this._drawNode(ctx, pos, s, state, viewport.zoom, visited);
    }
  }

  /**
   * 边渲染：
   *   - 当前 → 邻居（亮）
   *   - 已访问 → 已访问（次亮）
   *   - 其他（雾中）：暗
   */
  _renderEdges(ctx, currentSceneId, visited, reachableMap, viewport, gameState) {
    ctx.save();
    const discoveredKeys = new Set(gameState?.discoveredConnections || []);
    for (const s of this.scenes) {
      const fromPos = this._nodePos.get(s.id);
      if (!fromPos) continue;
      for (const conn of (s.connections || [])) {
        // Phase 21B — discovered=false 的连接除非已发现，否则完全不画
        if (conn.discovered === false && !discoveredKeys.has(`${s.id}→${conn.to}`)) continue;
        const toPos = this._nodePos.get(conn.to);
        if (!toPos) continue;
        // Phase 23C — 两端都屏外的边直接跳过
        if (!this._visibleSet.has(s.id) && !this._visibleSet.has(conn.to)) continue;

        // 决定边的样式
        let style = 'unknown';
        if (s.id === currentSceneId) {
          style = reachableMap.get(conn.to)?.reachable ? 'reachable' : 'locked';
        } else if (visited.has(s.id) && visited.has(conn.to)) {
          style = 'visited';
        } else if (this.fogEnabled && !visited.has(s.id) && !visited.has(conn.to)) {
          continue;  // 完全未知的边不画
        } else {
          style = 'visited';
        }

        this._drawEdge(ctx, fromPos, toPos, style, viewport.zoom);
      }
    }
    ctx.restore();
  }

  _drawEdge(ctx, from, to, style, zoom) {
    ctx.save();
    const styles = {
      reachable: { color: 'rgba(103, 232, 249, 0.7)', width: 3, dash: null, glow: 'rgba(103, 232, 249, 0.4)' },
      locked:    { color: 'rgba(100, 116, 139, 0.4)', width: 1.5, dash: [4, 6], glow: null },
      visited:   { color: 'rgba(148, 163, 184, 0.5)', width: 2, dash: null, glow: null },
      unknown:   { color: 'rgba(51, 65, 85, 0.3)', width: 1, dash: [2, 6], glow: null },
    };
    const s = styles[style] || styles.unknown;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * zoom;
    if (s.dash) ctx.setLineDash(s.dash.map(v => v * zoom));
    if (s.glow) {
      ctx.shadowColor = s.glow;
      ctx.shadowBlur = 14 * zoom;
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  _classifyNode(sceneId, currentSceneId, visited, reachableMap) {
    if (sceneId === currentSceneId) return 'current';
    const adj = reachableMap.get(sceneId);
    if (adj) return adj.reachable ? 'reachable' : 'locked';
    if (visited.has(sceneId)) return 'visited';
    return this.fogEnabled ? 'unknown' : 'visited';
  }

  _drawNode(ctx, pos, scene, state, zoom, visitedSet) {
    const style = NODE_STYLES[state] || NODE_STYLES.unknown;
    const r = NODE_RADIUS * zoom;
    ctx.save();
    if (style.glow) {
      ctx.shadowColor = style.glow;
      ctx.shadowBlur = 22 * zoom;
    }
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.strokeWidth * zoom;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // hover 高亮环
    if (scene.id === this._hoveredId && state === 'reachable') {
      ctx.save();
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)';
      ctx.lineWidth = 2 * zoom;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r + 5 * zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 锁定且没去过：不暴露名字与图标 — 用 🔒
    const hideIdentity = state === 'locked' && !visitedSet.has(scene.id);

    // 图标
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = `${22 * zoom}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (state === 'unknown') {
      ctx.fillStyle = 'rgba(100, 116, 139, 0.6)';
      ctx.fillText('?', pos.x, pos.y);
    } else if (hideIdentity) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
      ctx.fillText('🔒', pos.x, pos.y);
    } else {
      ctx.fillText(scene.icon || this._defaultIconForType(scene.type), pos.x, pos.y);
    }
    ctx.restore();

    // 名称标签
    if (state !== 'unknown') {
      ctx.save();
      ctx.fillStyle = hideIdentity ? 'rgba(100, 116, 139, 0.7)' : style.textColor;
      ctx.font = `bold ${13 * zoom}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4 * zoom;
      const label = hideIdentity ? '???' : scene.name;
      ctx.fillText(label, pos.x, pos.y + r + 6 * zoom);
      ctx.restore();
    }
  }

  _defaultIconForType(type) {
    return {
      spawn: '🚩', settlement: '🏘', wilderness: '🌲', combat: '⚔',
      dungeon: '🚪', vignette: '✨', ending: '🌅',
    }[type] || '📍';
  }

  /**
   * 屏幕坐标 → 命中的场景节点（用于点击）
   * @returns {string|null} sceneId
   */
  hitTest(screenX, screenY) {
    let best = null;
    let bestDist = NODE_HIT_RADIUS;
    for (const [id, pos] of this._nodePos.entries()) {
      const dx = pos.x - screenX, dy = pos.y - screenY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) { bestDist = dist; best = id; }
    }
    return best;
  }

  setHovered(sceneId) {
    this._hoveredId = sceneId;
  }

  /** 计算自动居中需要的世界坐标 — 让节点图大致居中显示 */
  getBoundsCenter() {
    if (!this.bounds) return { x: 0, y: 0 };
    const cx = (this.bounds.minX + this.bounds.maxX) / 2 * COORD_SCALE + COORD_SCALE / 2;
    const cy = (this.bounds.minY + this.bounds.maxY) / 2 * COORD_SCALE + COORD_SCALE / 2;
    return { x: cx, y: cy };
  }

  /**
   * 根据视口尺寸计算让所有节点都进入视野的最大 zoom
   * 留 padding（节点半径 + 名字标签高度 + 边距）
   * @returns {number} 建议的 zoom 值（小于等于 1）
   */
  getFitZoom(viewportWidth, viewportHeight) {
    if (!this.bounds) return 1;
    // 节点占用的世界范围，加上 padding（节点本身 + 标签 + 边距）
    const padding = NODE_RADIUS + 40;  // ~70px 余量给名字标签
    const worldWidth = (this.bounds.maxX - this.bounds.minX + 1) * COORD_SCALE + padding * 2;
    const worldHeight = (this.bounds.maxY - this.bounds.minY + 1) * COORD_SCALE + padding * 2;
    if (worldWidth <= 0 || worldHeight <= 0) return 1;
    const zoomX = viewportWidth / worldWidth;
    const zoomY = viewportHeight / worldHeight;
    // 取较小值确保完整可见，但不超过 1 避免节点被放得太大
    return Math.min(zoomX, zoomY, 1);
  }
}
