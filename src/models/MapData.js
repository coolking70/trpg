/**
 * 地图数据模型
 * 定义正方形网格地图、地块类型、兴趣点和迷雾系统
 */

import { generateId } from '../utils/idGenerator.js';
import { deepClone } from '../utils/deepClone.js';

export class MapData {
  constructor(data = {}) {
    this.id = data.id || generateId('map');
    this.name = data.name || '未命名地图';
    this.description = data.description || '';

    // 网格尺寸
    this.width = data.width || 20;
    this.height = data.height || 15;
    this.tileSize = data.tileSize || 64;

    // 地块类型定义
    this.tileTypes = data.tileTypes || {
      'G': { name: '草地', color: '#4a8c3f', walkable: true, moveCost: 1, image: '' },
      'T': { name: '树林', color: '#2d5a1e', walkable: true, moveCost: 2, image: '' },
      'W': { name: '水域', color: '#3366cc', walkable: false, moveCost: 99, image: '' },
      'M': { name: '山地', color: '#8b7355', walkable: false, moveCost: 99, image: '' },
      'R': { name: '道路', color: '#c4a35a', walkable: true, moveCost: 0.5, image: '' },
      'V': { name: '村庄', color: '#d4a574', walkable: true, moveCost: 1, image: '' },
      'D': { name: '地城入口', color: '#4a0000', walkable: true, moveCost: 1, image: '' },
      'S': { name: '起点', color: '#ffcc00', walkable: true, moveCost: 1, image: '' },
    };

    // 网格数据（字符串数组，每个字符对应一个tileType的key）
    this.grid = data.grid || this.createDefaultGrid();

    // 兴趣点
    this.pointsOfInterest = (data.pointsOfInterest || []).map(p => ({ ...p }));

    // 迷雾系统
    this.fogOfWar = data.fogOfWar !== undefined ? data.fogOfWar : true;
    this.revealRadius = data.revealRadius || 3;

    this.tags = [...(data.tags || [])];
    this.notes = data.notes || '';
  }

  /** 创建默认空白地图（全草地） */
  createDefaultGrid() {
    const row = 'G'.repeat(this.width);
    return Array(this.height).fill(row);
  }

  /**
   * 获取指定位置的地块类型
   * @param {number} x - 列
   * @param {number} y - 行
   * @returns {object|null} 地块类型定义
   */
  getTile(x, y) {
    if (!this.isInBounds(x, y)) return null;
    const key = this.grid[y][x];
    return this.tileTypes[key] || null;
  }

  /**
   * 获取指定位置的地块类型key
   * @param {number} x
   * @param {number} y
   * @returns {string|null}
   */
  getTileKey(x, y) {
    if (!this.isInBounds(x, y)) return null;
    return this.grid[y][x];
  }

  /**
   * 检查位置是否在地图范围内
   */
  isInBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * 检查指定位置是否可行走
   */
  isWalkable(x, y) {
    const tile = this.getTile(x, y);
    return tile ? tile.walkable : false;
  }

  /**
   * 获取指定位置的移动消耗
   */
  getMoveCost(x, y) {
    const tile = this.getTile(x, y);
    return tile ? (tile.moveCost || 1) : 99;
  }

  /**
   * 获取指定位置的兴趣点
   * @param {number} x
   * @param {number} y
   * @returns {object|null}
   */
  getPointOfInterest(x, y) {
    return this.pointsOfInterest.find(p => p.x === x && p.y === y) || null;
  }

  /**
   * 获取以指定位置为中心、指定半径内的地块数据（用于AI提示词裁剪）
   * @param {number} cx - 中心x
   * @param {number} cy - 中心y
   * @param {number} radius - 半径
   * @returns {string} 紧凑的地图片段字符串
   */
  getAreaExcerpt(cx, cy, radius = 2) {
    const lines = [];
    for (let y = cy - radius; y <= cy + radius; y++) {
      let line = '';
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (this.isInBounds(x, y)) {
          line += this.grid[y][x];
        } else {
          line += '?';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /**
   * 查找起点（类型为S的格子或第一个spawn兴趣点）
   * @returns {{x: number, y: number}|null}
   */
  findSpawnPoint() {
    // 先查兴趣点
    const spawn = this.pointsOfInterest.find(p => p.type === 'spawn');
    if (spawn) return { x: spawn.x, y: spawn.y };

    // 再扫描网格找S
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.grid[y][x] === 'S') return { x, y };
      }
    }

    // 默认左上角
    return { x: 0, y: 0 };
  }

  clone() {
    return new MapData(this.toJSON());
  }

  toJSON() {
    return deepClone({
      id: this.id,
      name: this.name,
      description: this.description,
      width: this.width,
      height: this.height,
      tileSize: this.tileSize,
      tileTypes: this.tileTypes,
      grid: this.grid,
      pointsOfInterest: this.pointsOfInterest,
      fogOfWar: this.fogOfWar,
      revealRadius: this.revealRadius,
      tags: this.tags,
      notes: this.notes,
    });
  }

  static fromJSON(json) {
    return new MapData(json);
  }
}
