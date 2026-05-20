/**
 * 地图系统
 * 管理网格地图逻辑、移动校验、战争迷雾和寻路
 */

import { GameSystem } from '../core/GameEngine.js';
import { MapData } from '../models/MapData.js';

export class MapSystem extends GameSystem {
  constructor() {
    super('MapSystem');

    /** @type {MapData|null} */
    this.mapData = null;

    /** @type {object|null} 事件系统引用 */
    this.eventSystem = null;
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.eventSystem = gameEngine.getSystem('EventSystem');
  }

  /**
   * 加载地图数据
   * @param {object} mapJson - 地图JSON数据
   */
  loadMap(mapJson) {
    this.mapData = mapJson instanceof MapData ? mapJson : new MapData(mapJson);
  }

  /**
   * 获取当前地图数据
   * @returns {MapData|null}
   */
  getMapData() {
    return this.mapData;
  }

  /**
   * 检查是否可以从当前位置移动到目标位置
   * @param {number} fromX
   * @param {number} fromY
   * @param {number} toX
   * @param {number} toY
   * @returns {{ canMove: boolean, reason: string }}
   */
  canMoveTo(fromX, fromY, toX, toY) {
    if (!this.mapData) {
      return { canMove: false, reason: '地图未加载' };
    }

    if (!this.mapData.isInBounds(toX, toY)) {
      return { canMove: false, reason: '超出地图范围' };
    }

    if (!this.mapData.isWalkable(toX, toY)) {
      const tile = this.mapData.getTile(toX, toY);
      const tileName = tile ? tile.name : '未知';
      return { canMove: false, reason: `${tileName}不可通行` };
    }

    // 只允许上下左右相邻移动（曼哈顿距离为1）
    const dist = Math.abs(toX - fromX) + Math.abs(toY - fromY);
    if (dist !== 1) {
      return { canMove: false, reason: '只能移动到相邻格子' };
    }

    return { canMove: true, reason: '' };
  }

  /**
   * 执行移动
   * @param {object} gameState - 游戏状态
   * @param {number} toX - 目标x
   * @param {number} toY - 目标y
   * @returns {{ success: boolean, reason: string, poi: object|null }}
   */
  movePlayer(gameState, toX, toY) {
    const pos = gameState.mapState.playerPosition;
    const check = this.canMoveTo(pos.x, pos.y, toX, toY);

    if (!check.canMove) {
      return { success: false, reason: check.reason, poi: null };
    }

    // 更新位置
    pos.x = toX;
    pos.y = toY;

    // 标记已访问
    const key = `${toX},${toY}`;
    if (!gameState.mapState.visitedTiles.includes(key)) {
      gameState.mapState.visitedTiles.push(key);
    }

    // 揭示周围区域
    if (this.mapData.fogOfWar) {
      gameState.revealArea(toX, toY, this.mapData.revealRadius);
    }

    // 检查兴趣点
    const poi = this.mapData.getPointOfInterest(toX, toY);

    // 发布移动事件
    if (this.eventSystem) {
      this.eventSystem.publish('map:move', {
        from: { x: pos.x, y: pos.y },
        to: { x: toX, y: toY },
        tileKey: this.mapData.getTileKey(toX, toY),
        poi,
      });
    }

    return { success: true, reason: '', poi };
  }

  /**
   * 获取指定位置周围可达的邻居格子
   * @param {number} x
   * @param {number} y
   * @returns {Array<{x: number, y: number}>}
   */
  getWalkableNeighbors(x, y) {
    const neighbors = [];
    const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // 上下左右

    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.mapData && this.mapData.isInBounds(nx, ny) && this.mapData.isWalkable(nx, ny)) {
        neighbors.push({ x: nx, y: ny });
      }
    }

    return neighbors;
  }

  /**
   * 简单的BFS寻路（用于AI敌人移动）
   * @param {number} startX
   * @param {number} startY
   * @param {number} endX
   * @param {number} endY
   * @param {number} maxSteps - 最大步数限制
   * @returns {Array<{x: number, y: number}>|null} 路径（不含起点）
   */
  findPath(startX, startY, endX, endY, maxSteps = 50) {
    if (!this.mapData) return null;

    const queue = [{ x: startX, y: startY, path: [] }];
    const visited = new Set([`${startX},${startY}`]);

    while (queue.length > 0) {
      const { x, y, path } = queue.shift();

      if (x === endX && y === endY) return path;
      if (path.length >= maxSteps) continue;

      for (const neighbor of this.getWalkableNeighbors(x, y)) {
        const key = `${neighbor.x},${neighbor.y}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({
            x: neighbor.x,
            y: neighbor.y,
            path: [...path, neighbor],
          });
        }
      }
    }

    return null; // 无路径
  }

  destroy() {
    this.mapData = null;
    this.eventSystem = null;
    super.destroy();
  }
}
