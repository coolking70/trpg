/**
 * AI内容生成提示词模板
 * 用户可以将这些模板复制到任意聊天AI中，生成符合格式的游戏预设JSON数据
 */

/**
 * 生成完整游戏预设的提示词
 * @param {object} options
 * @returns {string}
 */
export function generateFullPresetPrompt(options = {}) {
  const theme = options.theme || '暗黑奇幻冒险';
  const charCount = options.charCount || 4;
  const enemyCount = options.enemyCount || 8;
  const eventCount = options.eventCount || 12;
  const itemCount = options.itemCount || 15;
  const mapWidth = options.mapWidth || 20;
  const mapHeight = options.mapHeight || 15;

  return `你是一个TRPG游戏内容生成器。请根据以下要求生成一个完整的游戏预设JSON数据。

主题: ${theme}
角色数量: ${charCount}
敌人数量: ${enemyCount}
事件数量: ${eventCount}
道具数量: ${itemCount}
地图尺寸: ${mapWidth}x${mapHeight}

请输出一个严格符合以下结构的JSON对象（不要包含任何其他文字，仅输出JSON）:

{
  "version": "1.0.0",
  "presetId": "preset_唯一ID",
  "name": "冒险名称",
  "author": "你的名字",
  "description": "简短描述",
  "lore": {
    "worldName": "世界名称",
    "era": "时代",
    "background": "200字以内的世界观背景",
    "rules": "游戏规则说明",
    "gmStyle": "GM叙事风格描述"
  },
  "characters": [
    {
      "id": "char_001",
      "type": "character",
      "name": "角色名",
      "title": "职业",
      "description": "角色描述",
      "image": "",
      "stats": {
        "hp": 100, "hpCurrent": 100,
        "mp": 50, "mpCurrent": 50,
        "attack": 15, "defense": 10,
        "magicAttack": 8, "magicDefense": 6,
        "speed": 12, "luck": 5
      },
      "abilities": [
        {
          "id": "ability_001",
          "name": "技能名",
          "description": "技能描述",
          "type": "active",
          "cost": { "mp": 10 },
          "effect": {
            "target": "single_enemy",
            "damage": { "formula": "attack * 1.5", "type": "physical" }
          },
          "cooldown": 0
        }
      ],
      "equipment": { "weapon": null, "armor": null, "accessory": null },
      "inventory": [],
      "position": { "x": 0, "y": 0 },
      "level": 1,
      "experience": 0,
      "statusEffects": [],
      "tags": ["warrior"],
      "notes": ""
    }
  ],
  "enemies": [
    {
      "id": "enemy_001",
      "type": "enemy",
      "name": "敌人名",
      "description": "敌人描述",
      "image": "",
      "stats": { "hp": 50, "hpCurrent": 50, "mp": 0, "mpCurrent": 0, "attack": 8, "defense": 5, "magicAttack": 0, "magicDefense": 3, "speed": 6, "luck": 2 },
      "abilities": [],
      "lootTable": [
        { "itemId": "item_001", "dropRate": 0.5 }
      ],
      "behaviorHint": "aggressive",
      "experienceReward": 20,
      "difficulty": "normal",
      "position": { "x": 0, "y": 0 },
      "statusEffects": [],
      "tags": [],
      "notes": ""
    }
  ],
  "events": [
    {
      "id": "event_001",
      "type": "event",
      "name": "事件名",
      "description": "事件场景描述（100字左右）",
      "image": "",
      "eventType": "encounter",
      "trigger": {
        "type": "map_tile",
        "condition": { "tileTypes": ["R", "V"], "probability": 0.5 }
      },
      "choices": [
        {
          "id": "choice_001",
          "text": "选项文本",
          "requirements": null,
          "outcomes": [
            {
              "probability": 1.0,
              "text": "结果描述",
              "effects": [
                { "type": "add_item", "itemId": "item_001" }
              ]
            }
          ]
        }
      ],
      "repeatable": false,
      "maxOccurrences": 1,
      "aiPromptHint": "叙事风格提示",
      "tags": [],
      "notes": ""
    }
  ],
  "items": [
    {
      "id": "item_001",
      "type": "item",
      "name": "道具名",
      "description": "道具描述",
      "image": "",
      "itemType": "weapon",
      "statModifiers": { "attack": 5 },
      "consumeEffect": null,
      "equipSlot": "weapon",
      "buyPrice": 50,
      "sellPrice": 25,
      "stackable": false,
      "maxStack": 1,
      "tags": [],
      "notes": ""
    }
  ],
  "map": {
    "id": "map_001",
    "name": "地图名",
    "description": "地图描述",
    "width": ${mapWidth},
    "height": ${mapHeight},
    "tileSize": 64,
    "tileTypes": {
      "G": { "name": "草地", "color": "#4a8c3f", "walkable": true, "moveCost": 1, "image": "" },
      "T": { "name": "树林", "color": "#2d5a1e", "walkable": true, "moveCost": 2, "image": "" },
      "W": { "name": "水域", "color": "#3366cc", "walkable": false, "moveCost": 99, "image": "" },
      "M": { "name": "山地", "color": "#8b7355", "walkable": false, "moveCost": 99, "image": "" },
      "R": { "name": "道路", "color": "#c4a35a", "walkable": true, "moveCost": 0.5, "image": "" },
      "V": { "name": "村庄", "color": "#d4a574", "walkable": true, "moveCost": 1, "image": "" },
      "D": { "name": "地城入口", "color": "#4a0000", "walkable": true, "moveCost": 1, "image": "" },
      "S": { "name": "起点", "color": "#ffcc00", "walkable": true, "moveCost": 1, "image": "" }
    },
    "grid": [
      "每行${mapWidth}个字符，共${mapHeight}行，使用上述地块类型的key组成"
    ],
    "pointsOfInterest": [
      { "x": 0, "y": 0, "name": "起点", "type": "spawn", "linkedEventId": null }
    ],
    "fogOfWar": true,
    "revealRadius": 3,
    "tags": [],
    "notes": ""
  },
  "rules": {
    "diceType": "d20",
    "combatFormula": "(attack + dice) - defense",
    "maxPartySize": 4,
    "startingGold": 100,
    "deathPenalty": "revive_at_village"
  },
  "aiConfig": {
    "systemPromptTemplate": "compact",
    "customSystemPrompt": "",
    "temperature": 0.7,
    "maxResponseTokens": 300,
    "useStructuredOutput": true,
    "language": "zh-CN"
  }
}

要求:
1. 所有ID必须唯一，格式为 类型前缀_序号（如char_001, enemy_001）
2. 角色属性要平衡，适合${charCount}人队伍
3. 事件应有2-4个有意义的选项
4. 地图grid每行恰好${mapWidth}个字符，共${mapHeight}行
5. 敌人掉落表的itemId必须对应items中存在的ID
6. 至少包含2个boss级敌人
7. 事件应组成连贯的故事线
8. 所有文本使用中文`;
}

/**
 * 生成角色卡的提示词
 */
export function generateCharacterPrompt(options = {}) {
  const count = options.count || 4;
  const theme = options.theme || '奇幻';
  return `请生成${count}个${theme}主题的TRPG角色卡，输出为JSON数组。每个角色遵循以下格式:
{
  "id": "char_XXX", "type": "character", "name": "角色名", "title": "职业",
  "description": "角色背景描述", "image": "",
  "stats": { "hp": 数值, "hpCurrent": 同hp, "mp": 数值, "mpCurrent": 同mp, "attack": 数值, "defense": 数值, "magicAttack": 数值, "magicDefense": 数值, "speed": 数值, "luck": 数值 },
  "abilities": [{ "id": "ability_XXX", "name": "技能名", "description": "描述", "type": "active", "cost": {"mp": 数值}, "effect": {"target": "single_enemy", "damage": {"formula": "公式", "type": "physical或magic"}}, "cooldown": 0 }],
  "equipment": {"weapon": null, "armor": null, "accessory": null},
  "inventory": [], "position": {"x":0,"y":0}, "level": 1, "experience": 0, "statusEffects": [], "tags": [], "notes": ""
}
确保各角色职业互补（战士/法师/弓手/牧师等），属性平衡。仅输出JSON数组，不要其他文字。`;
}

/**
 * 生成敌人卡的提示词
 */
export function generateEnemyPrompt(options = {}) {
  const count = options.count || 8;
  const theme = options.theme || '暗黑奇幻';
  return `请生成${count}个${theme}主题的TRPG敌人卡，输出为JSON数组。包含至少2个boss级敌人。
每个敌人格式:
{
  "id": "enemy_XXX", "type": "enemy", "name": "敌人名", "description": "描述", "image": "",
  "stats": { "hp": 数值, "hpCurrent": 同hp, "mp": 0, "mpCurrent": 0, "attack": 数值, "defense": 数值, "magicAttack": 数值, "magicDefense": 数值, "speed": 数值, "luck": 数值 },
  "abilities": [], "lootTable": [{"itemId": "item_XXX", "dropRate": 0.0到1.0}],
  "behaviorHint": "aggressive|defensive|random|support",
  "experienceReward": 数值, "difficulty": "easy|normal|hard|boss",
  "position": {"x":0,"y":0}, "statusEffects": [], "tags": [], "notes": ""
}
仅输出JSON数组。`;
}

/**
 * 生成事件卡的提示词
 */
export function generateEventPrompt(options = {}) {
  const count = options.count || 10;
  const theme = options.theme || '冒险';
  return `请生成${count}个${theme}主题的TRPG事件卡，输出为JSON数组。包含多种事件类型。
每个事件格式:
{
  "id": "event_XXX", "type": "event", "name": "事件名",
  "description": "100字左右的场景描述", "image": "",
  "eventType": "encounter|story|trap|treasure|rest|shop|boss",
  "trigger": {"type": "map_tile", "condition": {"tileTypes": ["R","V"], "probability": 0.3}},
  "choices": [{"id": "choice_XXX", "text": "选项", "requirements": null, "outcomes": [{"probability": 1.0, "text": "结果", "effects": []}]}],
  "repeatable": false, "maxOccurrences": 1, "aiPromptHint": "叙事提示", "tags": [], "notes": ""
}
effects可用类型: add_item, start_combat, narrative, heal, damage, set_variable
仅输出JSON数组。`;
}

/**
 * 生成道具卡的提示词
 */
export function generateItemPrompt(options = {}) {
  const count = options.count || 15;
  return `请生成${count}个TRPG道具卡，输出为JSON数组。包含武器、防具、消耗品和任务物品。
格式:
{
  "id": "item_XXX", "type": "item", "name": "道具名", "description": "描述", "image": "",
  "itemType": "weapon|armor|accessory|consumable|quest|material",
  "statModifiers": {"attack": 5},
  "consumeEffect": null 或 {"type":"heal","stat":"hp","value":30},
  "equipSlot": "weapon|armor|accessory" 或 null,
  "buyPrice": 数值, "sellPrice": 数值,
  "stackable": false, "maxStack": 1, "tags": [], "notes": ""
}
仅输出JSON数组。`;
}

/**
 * 生成地图的提示词
 */
export function generateMapPrompt(options = {}) {
  const width = options.width || 20;
  const height = options.height || 15;
  const theme = options.theme || '森林';
  return `请生成一张${width}x${height}的${theme}主题TRPG网格地图，输出为JSON对象。
地块类型: G=草地, T=树林, W=水域, M=山地, R=道路, V=村庄, D=地城入口, S=起点
格式:
{
  "id": "map_001", "name": "地图名", "description": "描述",
  "width": ${width}, "height": ${height}, "tileSize": 64,
  "tileTypes": {
    "G": {"name":"草地","color":"#4a8c3f","walkable":true,"moveCost":1,"image":""},
    "T": {"name":"树林","color":"#2d5a1e","walkable":true,"moveCost":2,"image":""},
    "W": {"name":"水域","color":"#3366cc","walkable":false,"moveCost":99,"image":""},
    "M": {"name":"山地","color":"#8b7355","walkable":false,"moveCost":99,"image":""},
    "R": {"name":"道路","color":"#c4a35a","walkable":true,"moveCost":0.5,"image":""},
    "V": {"name":"村庄","color":"#d4a574","walkable":true,"moveCost":1,"image":""},
    "D": {"name":"地城入口","color":"#4a0000","walkable":true,"moveCost":1,"image":""},
    "S": {"name":"起点","color":"#ffcc00","walkable":true,"moveCost":1,"image":""}
  },
  "grid": ["每行${width}字符，共${height}行"],
  "pointsOfInterest": [{"x":数值,"y":数值,"name":"名称","type":"spawn|village|dungeon|shop","linkedEventId":null}],
  "fogOfWar": true, "revealRadius": 3, "tags": [], "notes": ""
}
要求: grid必须恰好${width}x${height}，有合理的地形分布，道路连通主要区域，包含1个起点(S)。仅输出JSON。`;
}

/** 所有模板汇总 */
export const PROMPT_TEMPLATES = {
  fullPreset: generateFullPresetPrompt,
  characters: generateCharacterPrompt,
  enemies: generateEnemyPrompt,
  events: generateEventPrompt,
  items: generateItemPrompt,
  map: generateMapPrompt,
};
