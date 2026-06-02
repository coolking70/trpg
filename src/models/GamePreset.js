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

    // Phase 19B — NPC 系统（持久世界角色，与战斗 enemy 解耦）
    // NPC 有 affection、schedule、giftPreferences、dialogueTree 等字段
    this.npcs = [...(data.npcs || [])];

    // Phase 22B — NPC 关系图：from 的 affection 变化会按 strength 传播到 to
    //   [{ from: 'npc_a', to: 'npc_b', strength: 0.5 }]     ally（同向）
    //   [{ from: 'npc_a', to: 'npc_b', strength: -0.3 }]    rival（反向）
    this.npcRelations = [...(data.npcRelations || [])];

    // Phase 19A — 角色创建选项
    // 4 个轴：种族 / 出身 / 背景 / 信仰；每个有 id/name/icon/statBonus/tags/description
    // 若 startingOptions 为空，新游戏直接用现有 characters[0] 不弹角色创建
    this.startingOptions = data.startingOptions || null;
    // 例：[{ when: { tags: ['origin:noble'] }, sceneId: 'scene_manor' }, { default: 'scene_village' }]
    this.startingSceneRules = [...(data.startingSceneRules || [])];

    // Phase 19 — 战斗 / 玩法模式
    //   'party' (default, current) ：4 人小队，玩家直接控制每个角色
    //   'solo'  ：单主角 + AI 控制的可选伙伴
    this.combatMode = data.combatMode || 'party';

    // Phase 19 — AI 调用控制（与运行时 aiTier 配合）
    // 每个 hook: 'optional'（按 tier 决定）/ 'never'（永远不调）/ 'always'（强制）
    this.aiHooks = {
      sceneArrival: 'optional',
      eventResolve: 'optional',
      npcDialogue: 'optional',
      vignette: 'never',
      worldRipple: 'optional',
      ...(data.aiHooks || {}),
    };

    // 地图（旧版格子地图，仍支持以保持向后兼容）
    this.map = data.map || null;

    // 势力 + 战略层（Phase 27 描述数据 / Phase 33 内政外交活状态种子）
    this.factions = [...(data.factions || [])];
    this.strategicLayer = data.strategicLayer || null;
    this.strategicSetup = data.strategicSetup || null;
    this.strategySchema = data.strategySchema || null;  // 战略主题 Schema 覆盖（Phase 42 T3）

    // 场景图（新版主路径）— 节点 + 连接，每个节点是一个有意义的场景
    // scenes 为空数组时回退到旧的格子地图触发机制
    this.scenes = [...(data.scenes || [])];

    // 起始场景 ID — 仅在 scenes[] 非空时使用
    this.startingSceneId = data.startingSceneId || (this.scenes[0]?.id || null);

    // 显示模式
    //   'grid'        ：纯格子地图（旧）
    //   'scene-graph' ：节点图（推荐 — 桌游跑团式）
    //   'hybrid'      ：节点图叠在格子地图上
    this.displayMode = data.displayMode || (this.scenes.length > 0 ? 'scene-graph' : 'grid');

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
      maxResponseTokens: 1000,
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
    if (!this.map && this.scenes.length === 0) errors.push('预设必须包含地图数据或场景图（map 或 scenes 至少一项）');
    if (this.characters.length === 0) errors.push('预设至少需要一个角色卡');

    // 场景图校验（如果使用 scenes）
    if (this.scenes.length > 0) {
      const sceneIds = new Set(this.scenes.map(s => s.id));
      if (this.startingSceneId && !sceneIds.has(this.startingSceneId)) {
        errors.push(`startingSceneId 引用了不存在的场景: ${this.startingSceneId}`);
      }
      for (const scene of this.scenes) {
        for (const conn of (scene.connections || [])) {
          if (!sceneIds.has(conn.to)) {
            errors.push(`场景"${scene.id}"连接到不存在的场景: ${conn.to}`);
          }
        }
        for (const eid of (scene.events || [])) {
          if (!this.events.some(e => e.id === eid)) {
            errors.push(`场景"${scene.id}"引用了不存在的事件: ${eid}`);
          }
        }
      }
    }

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
      // Phase 19
      npcs: this.npcs,
      npcRelations: this.npcRelations,  // Phase 22B
      startingOptions: this.startingOptions,
      startingSceneRules: this.startingSceneRules,
      combatMode: this.combatMode,
      aiHooks: this.aiHooks,
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
      factions: this.factions,
      strategicLayer: this.strategicLayer,
      strategicSetup: this.strategicSetup,
      strategySchema: this.strategySchema,
      scenes: this.scenes,
      startingSceneId: this.startingSceneId,
      displayMode: this.displayMode,
      rules: this.rules,
      aiConfig: this.aiConfig,
    });
  }

  static fromJSON(json) {
    return new GamePreset(json);
  }
}
