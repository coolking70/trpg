/**
 * 导入导出系统
 * 处理游戏预设和存档的JSON文件导入导出
 * 提供AI内容生成提示词模板
 */

import { GameSystem } from '../core/GameEngine.js';
import { validateCard } from '../utils/jsonValidator.js';

export class ImportExportSystem extends GameSystem {
  constructor() {
    super('ImportExportSystem');
    this.eventSystem = null;
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.eventSystem = gameEngine.getSystem('EventSystem');
  }

  /**
   * 导出预设为JSON文件下载
   * @param {object} preset - GamePreset数据
   */
  exportPreset(preset) {
    const json = JSON.stringify(preset, null, 2);
    this._downloadJSON(json, `${preset.name || 'trpg-preset'}.json`);

    if (this.eventSystem) {
      this.eventSystem.publish('game:export', { type: 'preset', name: preset.name });
    }
  }

  /**
   * 导出游戏存档为JSON文件下载
   * @param {object} gameState - GameState数据
   */
  exportSaveGame(gameState) {
    const saveData = {
      type: 'trpg_save',
      version: '1.0.0',
      savedAt: new Date().toISOString(),
      state: gameState,
    };
    const json = JSON.stringify(saveData, null, 2);
    this._downloadJSON(json, `trpg-save-${Date.now()}.json`);
  }

  /**
   * 从文件导入预设
   * @returns {Promise<object>} 解析后的GamePreset数据
   */
  async importPreset() {
    const file = await this._pickFile('.json');
    const text = await this._readFile(file);

    try {
      const data = JSON.parse(text);
      const validation = this.validatePreset(data);
      if (!validation.valid) {
        throw new Error(`预设校验失败:\n${validation.errors.join('\n')}`);
      }

      if (this.eventSystem) {
        this.eventSystem.publish('game:import', { type: 'preset', name: data.name });
      }

      return data;
    } catch (e) {
      throw new Error(`导入失败: ${e.message}`);
    }
  }

  /**
   * 从文件导入存档
   * @returns {Promise<object>} GameState数据
   */
  async importSaveGame() {
    const file = await this._pickFile('.json');
    const text = await this._readFile(file);

    try {
      const data = JSON.parse(text);
      if (data.type !== 'trpg_save') {
        throw new Error('文件不是有效的TRPG存档');
      }
      return data.state;
    } catch (e) {
      throw new Error(`导入存档失败: ${e.message}`);
    }
  }

  /**
   * 校验预设数据
   * @param {object} data
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validatePreset(data) {
    const errors = [];

    if (!data.name) errors.push('缺少预设名称');
    if (!data.map) errors.push('缺少地图数据');
    if (!data.characters || data.characters.length === 0) {
      errors.push('至少需要一个角色卡');
    }

    // 校验地图格式
    if (data.map) {
      if (!data.map.grid || !Array.isArray(data.map.grid)) {
        errors.push('地图grid必须是字符串数组');
      }
      if (!data.map.tileTypes || typeof data.map.tileTypes !== 'object') {
        errors.push('地图必须包含tileTypes定义');
      }
    }

    // 校验卡牌基础字段
    const allCards = [
      ...(data.characters || []).map(c => ({ ...c, type: c.type || 'character' })),
      ...(data.enemies || []).map(c => ({ ...c, type: c.type || 'enemy' })),
      ...(data.events || []).map(c => ({ ...c, type: c.type || 'event' })),
      ...(data.items || []).map(c => ({ ...c, type: c.type || 'item' })),
    ];

    for (const card of allCards) {
      const v = validateCard(card);
      if (!v.valid) {
        errors.push(`卡牌 "${card.name || card.id}": ${v.errors.join(', ')}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** 触发文件选择 */
  _pickFile(accept) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = () => {
        if (input.files.length > 0) {
          resolve(input.files[0]);
        } else {
          reject(new Error('未选择文件'));
        }
      };
      input.click();
    });
  }

  /** 读取文件内容 */
  _readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file);
    });
  }

  /** 下载JSON文件 */
  _downloadJSON(json, filename) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  destroy() {
    this.eventSystem = null;
    super.destroy();
  }
}
