/**
 * 游戏预设数据包
 * 包含一场冒险所需的全部预设内容
 */

import { deepClone } from '../utils/deepClone.js';
import { generateId } from '../utils/idGenerator.js';

export class GamePreset {
  constructor(data = {}) {
    this.version = data.version || '1.0.0';
    this.presetId = data.presetId || generateId('preset');
    this.name = data.name || '未命名冒险';
    this.author = data.author || '';
    this.createdAt = data.createdAt || new Date().toISOString();
    this.description = data.description || '';

    // 世界观设定
    this.lore = {
      worldName: '',
      era: '',
      background: '',
      rules: '',
      gmStyle: '',
      ...(data.lore || {}),
    };

    // 所有卡牌
    this.characters = [...(data.characters || [])];
    this.enemies = [...(data.enemies || [])];
    this.events = [...(data.events || [])];
    this.items = [...(data.items || [])];

    // 地图
    this.map = data.map || null;

    // 游戏规则配置
    this.rules = {
      diceType: 'd20',
      combatFormula: '(attack + dice) - defense',
      maxPartySize: 4,
      startingGold: 100,
      deathPenalty: 'revive_at_village',
      ...(data.rules || {}),
    };

    // AI GM配置
    this.aiConfig = {
      systemPromptTemplate: 'compact',
      customSystemPrompt: '',
      temperature: 0.7,
      maxResponseTokens: 300,
      useStructuredOutput: true,
      language: 'zh-CN',
      ...(data.aiConfig || {}),
    };
  }

  /**
   * 获取所有卡牌的扁平列表
   * @returns {object[]}
   */
  getAllCards() {
    return [
      ...this.characters,
      ...this.enemies,
      ...this.events,
      ...this.items,
    ];
  }

  /**
   * 根据ID查找任意类型的卡牌
   * @param {string} id
   * @returns {object|null}
   */
  findCardById(id) {
    return this.getAllCards().find(c => c.id === id) || null;
  }

  /**
   * 校验预设完整性
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate() {
    const errors = [];

    if (!this.name) errors.push('预设名称不能为空');
    if (!this.map) errors.push('预设必须包含地图数据');
    if (this.characters.length === 0) errors.push('预设至少需要一个角色卡');

    // 校验事件卡引用的敌人ID是否存在
    const enemyIds = new Set(this.enemies.map(e => e.id));
    for (const event of this.events) {
      for (const choice of (event.choices || [])) {
        for (const outcome of (choice.outcomes || [])) {
          for (const effect of (outcome.effects || [])) {
            if (effect.type === 'start_combat' && effect.enemyIds) {
              for (const eid of effect.enemyIds) {
                if (!enemyIds.has(eid)) {
                  errors.push(`事件"${event.name}"引用了不存在的敌人ID: ${eid}`);
                }
              }
            }
          }
        }
      }
    }

    // 校验掉落表引用的道具ID是否存在
    const itemIds = new Set(this.items.map(i => i.id));
    for (const enemy of this.enemies) {
      for (const loot of (enemy.lootTable || [])) {
        if (!itemIds.has(loot.itemId)) {
          errors.push(`敌人"${enemy.name}"的掉落表引用了不存在的道具ID: ${loot.itemId}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  clone() {
    return new GamePreset(this.toJSON());
  }

  toJSON() {
    return deepClone({
      version: this.version,
      presetId: this.presetId,
      name: this.name,
      author: this.author,
      createdAt: this.createdAt,
      description: this.description,
      lore: this.lore,
      characters: this.characters,
      enemies: this.enemies,
      events: this.events,
      items: this.items,
      map: this.map,
      rules: this.rules,
      aiConfig: this.aiConfig,
    });
  }

  static fromJSON(json) {
    return new GamePreset(json);
  }
}
