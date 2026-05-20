/**
 * AI提示词构建器
 * 将游戏数据压缩为紧凑的提示词，最小化token消耗
 */

import { estimateTokens } from '../utils/tokenEstimator.js';

export class AIPromptBuilder {
  constructor() {
    /** @type {number} 系统提示词的token预算 */
    this.systemPromptBudget = 600;
  }

  /**
   * 构建系统提示词（角色指令 + 世界观 + 队伍 + 规则 + 响应格式）
   * @param {object} preset - GamePreset数据
   * @returns {string}
   */
  buildSystemPrompt(preset) {
    const parts = [];

    // 角色指令
    parts.push('你是TRPG游戏主持人(GM)。仅用JSON回复。用中文叙述。简洁生动，2-3句。严禁编造地图上不存在的内容，只能引用下方提供的地形和兴趣点信息。');

    // 世界观（压缩到2句）
    if (preset.lore) {
      const { worldName, era, background, gmStyle } = preset.lore;
      if (worldName) parts.push(`世界:${worldName} ${era||''}`);
      if (background) parts.push(`背景:${background.substring(0, 80)}`);
      if (gmStyle) parts.push(`风格:${gmStyle}`);
    }

    // 队伍信息（压缩格式）
    if (preset.characters && preset.characters.length > 0) {
      parts.push('队伍:');
      for (const c of preset.characters) {
        const s = c.stats || {};
        const abilities = (c.abilities || []).map(a => a.name).join(',');
        parts.push(`- ${c.name} L${c.level||1} HP:${s.hpCurrent||s.hp}/${s.hp} MP:${s.mpCurrent||s.mp}/${s.mp} ATK:${s.attack} DEF:${s.defense} SPD:${s.speed} [${abilities}]`);
      }
    }

    // 规则
    if (preset.rules) {
      parts.push(`骰子:${preset.rules.diceType} 战斗:(ATK+骰)-DEF`);
    }

    // 响应格式
    parts.push(`回复格式(严格JSON，不得有多余字段):
{"narrative":"叙事文本(中文2-3句)","actions":[],"diceRequests":[],"stateUpdate":null,"creativeOutcome":null}
规则：
- actions仅在有实际伤害/治疗/道具/战斗变化时填写，否则为[]
- diceRequests仅在玩家明确尝试需要判定成败的行动时才填写（如翻墙/潜行/说服NPC），纯探索叙事时必须为[]
- stateUpdate仅在阶段转换时填写，否则为null
- narrative必须是字符串，不能是对象
- creativeOutcome仅在战斗中玩家尝试非常规创意行动时填写：
  {"dc":15,"formula":"d20","onSuccess":{"narrative":"成功描述","actions":[{"type":"damage","target":"enemy_xxx","value":15}]},"onFail":{"narrative":"失败描述","actions":[]}}
  常规攻击/技能不要用 creativeOutcome（由系统机制处理）
- 如果本轮发生了应当被长期记住的事（玩家与重要 NPC 建立关系/获得任务/转折点），可在 actions 加 {"type":"add_memory","value":"一句话摘要"}。日常移动/闲聊不要加。`);

    return parts.join('\n');
  }

  /**
   * 构建用户消息（描述当前操作和上下文）
   * @param {string} actionType - 操作类型
   * @param {object} actionData - 操作数据
   * @param {object} gameState - 游戏状态
   * @param {object} mapData - 地图数据（可选）
   * @returns {string}
   */
  buildActionMessage(actionType, actionData, gameState, mapData = null) {
    const parts = [];

    // 当前状态概要
    const pos = gameState.mapState.playerPosition;
    parts.push(`[回合${gameState.turnNumber} 阶段:${gameState.currentPhase} 位置:(${pos.x},${pos.y})]`);

    // 队伍当前HP概要
    const hpSummary = (gameState.activeCharacters || [])
      .map(c => `${c.name}:HP${c.stats.hpCurrent}/${c.stats.hp}`)
      .join(' ');
    if (hpSummary) parts.push(`队伍: ${hpSummary}`);

    // 结构化地图上下文（取代原始字母网格，防止AI自由发挥）
    if (mapData && actionType !== 'narrate_combat') {
      parts.push(this.buildStructuredMapContext(mapData, pos));
    }

    // 根据操作类型添加具体内容
    switch (actionType) {
      case 'narrate_event': {
        const evt = actionData.event;
        if (evt) {
          parts.push(`触发事件: ${evt.name}`);
          parts.push(`描述: ${evt.description}`);
          if (evt.aiPromptHint) parts.push(`叙事提示: ${evt.aiPromptHint}`);
          if (actionData.choiceText) parts.push(`玩家选择: ${actionData.choiceText}`);
          if (actionData.outcomeText) parts.push(`结果: ${actionData.outcomeText}`);
        }
        parts.push('请用生动的语言叙述这个事件场景。');
        break;
      }

      case 'narrate_combat': {
        const isOpening = !actionData.roundResults || actionData.roundResults.length === 0;
        if (isOpening) {
          // 修复 Bug #2: 战斗刚启动时不要描述任何具体动作，AI 容易脑补根本没发生的行动
          parts.push('战斗即将开始（尚未有人行动）。');
          if (actionData.enemies) {
            const enemySummary = actionData.enemies
              .map(e => `${e.name}:HP${e.stats.hpCurrent}/${e.stats.hp}`).join(' ');
            parts.push(`敌人: ${enemySummary}`);
          }
          parts.push('请用1-2句描述双方对峙的紧张气氛、环境光影、敌人的神态——但严禁描述任何角色的具体行动（不要写"举盾/拉弓/施法/挥剑"等动作）。');
        } else {
          parts.push('战斗回合总结:');
          for (const r of actionData.roundResults) {
            if (r.attackerName && r.targetName) {
              parts.push(`${r.attackerName}攻击${r.targetName}，造成${r.finalDamage||0}伤害${r.targetDefeated ? '，击败!' : ''}`);
            }
            if (r.abilityName) {
              parts.push(`${r.casterName}使用${r.abilityName}对${r.targetName}，伤害${r.damage||0}治疗${r.healing||0}`);
            }
            if (r.narrative) parts.push(r.narrative);
          }
          // 敌人状态
          if (actionData.enemies) {
            const enemySummary = actionData.enemies
              .map(e => `${e.name}:HP${e.stats.hpCurrent}/${e.stats.hp}`).join(' ');
            parts.push(`敌人: ${enemySummary}`);
          }
          parts.push('请用2-3句描述这个战斗回合的场面，严格基于上述实际发生的行动叙述，不要编造未发生的内容。');
        }
        break;
      }

      case 'npc_dialogue': {
        if (actionData.npcName) parts.push(`NPC: ${actionData.npcName}`);
        if (actionData.npcDescription) parts.push(`NPC描述: ${actionData.npcDescription}`);
        if (actionData.playerMessage) parts.push(`玩家说: ${actionData.playerMessage}`);
        parts.push('请以NPC的身份回复玩家。');
        break;
      }

      case 'player_action': {
        if (actionData.text) parts.push(`玩家行动: ${actionData.text}`);
        if (actionData.moved) parts.push('（玩家已在地图上移动到新位置）');
        // 明确告知：普通移动/对话/观察不需要骰子判定，只有明确挑战性行动才需要
        parts.push('请用2-3句叙述这个行动的场景效果。如果行动仅为移动、观察或交谈，diceRequests必须为空数组。');
        break;
      }

      case 'combat_creative': {
        // 战斗中玩家用文本输入尝试创意行动
        parts.push(`【战斗中】玩家尝试: ${actionData.text || ''}`);

        // 当前战斗状态
        const combat = gameState.activeCombat;
        if (combat) {
          const enemiesAlive = combat.enemies
            .filter(e => e.stats.hpCurrent > 0)
            .map(e => `${e.id}(${e.name},HP:${e.stats.hpCurrent}/${e.stats.hp})`);
          if (enemiesAlive.length > 0) parts.push(`存活敌人: ${enemiesAlive.join(', ')}`);

          const currentSlot = combat.turnOrder[combat.currentActorIndex];
          if (currentSlot) parts.push(`当前行动者: ${currentSlot.name}`);
        }

        parts.push(
          '判定这个行动：',
          '- 如果是常规攻击/施法（应该用按钮），回复 narrative 提醒玩家使用按钮，creativeOutcome 为 null',
          '- 如果是有趣的创意行动（环境利用/战术机动/言语威慑/特殊动作），填 creativeOutcome：',
          '  设定合理的 dc（10=简单, 15=普通, 20=困难, 25=极难），formula 通常为 "d20"',
          '  onSuccess 与 onFail 各填 narrative 和可选 actions（damage/heal/status_effect）',
          '- 伤害值范围 0-50 之间，targetId 必须是上面列出的敌人 id',
          '- narrative 字段填给玩家看的总述（2句以内）'
        );
        break;
      }

      case 'scene_description': {
        parts.push('请描述当前场景的氛围和环境。');
        break;
      }

      default:
        parts.push(`操作: ${actionType}`);
        if (actionData.text) parts.push(actionData.text);
    }

    return parts.join('\n');
  }

  /**
   * 构建结构化地图上下文（自然语言，非字母网格）
   * 包含：当前地块、四方向可通行情况、附近兴趣点
   * @param {object} mapData - MapData实例
   * @param {{x: number, y: number}} pos - 玩家坐标
   * @returns {string}
   */
  buildStructuredMapContext(mapData, pos) {
    const parts = [];

    // 当前脚下地块
    const currentTile = mapData.getTile(pos.x, pos.y);
    parts.push(`当前位置: ${currentTile ? currentTile.name : '未知'}`);

    // 四个方向的地块
    const dirs = [
      { label: '北', dx: 0, dy: -1 },
      { label: '南', dx: 0, dy: 1 },
      { label: '西', dx: -1, dy: 0 },
      { label: '东', dx: 1, dy: 0 },
    ];
    const dirDescs = [];
    for (const d of dirs) {
      const nx = pos.x + d.dx;
      const ny = pos.y + d.dy;
      if (!mapData.isInBounds(nx, ny)) {
        dirDescs.push(`${d.label}:地图边界`);
      } else {
        const tile = mapData.getTile(nx, ny);
        const name = tile ? tile.name : '未知';
        const walkable = tile ? tile.walkable : false;
        dirDescs.push(`${d.label}:${name}${walkable ? '' : '(不可通行)'}`);
      }
    }
    parts.push(`四周: ${dirDescs.join(' ')}`);

    // 附近兴趣点（半径3以内）
    if (mapData.pointsOfInterest && mapData.pointsOfInterest.length > 0) {
      const nearbyPOIs = mapData.pointsOfInterest.filter(p => {
        const dist = Math.abs(p.x - pos.x) + Math.abs(p.y - pos.y);
        return dist <= 3 && dist > 0;
      });
      if (nearbyPOIs.length > 0) {
        const poiDescs = nearbyPOIs.map(p => {
          const dx = p.x - pos.x;
          const dy = p.y - pos.y;
          let dirLabel = '';
          if (dy < 0) dirLabel += '北';
          if (dy > 0) dirLabel += '南';
          if (dx < 0) dirLabel += '西';
          if (dx > 0) dirLabel += '东';
          const dist = Math.abs(dx) + Math.abs(dy);
          return `${p.name}(${dirLabel}方${dist}格)`;
        });
        parts.push(`附近地标: ${poiDescs.join('、')}`);
      }
    }

    // 当前脚下的兴趣点
    const currentPOI = mapData.getPointOfInterest(pos.x, pos.y);
    if (currentPOI) {
      parts.push(`脚下地标: ${currentPOI.name}`);
    }

    return parts.join('\n');
  }

  /**
   * 估算构建的提示词token数
   * @param {string} systemPrompt
   * @param {Array} contextMessages
   * @param {string} currentMessage
   * @returns {number}
   */
  estimateTotal(systemPrompt, contextMessages, currentMessage) {
    let total = estimateTokens(systemPrompt);
    for (const msg of contextMessages) {
      total += 4 + estimateTokens(msg.content || '');
    }
    total += 4 + estimateTokens(currentMessage);
    return total;
  }
}
