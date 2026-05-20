/**
 * 卡牌JSON Schema定义
 * 用于校验导入的数据格式
 */

export const CHARACTER_SCHEMA = {
  required: ['id', 'type', 'name', 'stats'],
  fields: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['character'] },
    name: { type: 'string' },
    stats: { type: 'object' },
  },
};

export const ENEMY_SCHEMA = {
  required: ['id', 'type', 'name', 'stats'],
  fields: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['enemy'] },
    name: { type: 'string' },
    stats: { type: 'object' },
    difficulty: { type: 'string', enum: ['easy', 'normal', 'hard', 'boss'] },
    behaviorHint: { type: 'string', enum: ['aggressive', 'defensive', 'random', 'support'] },
  },
};

export const EVENT_SCHEMA = {
  required: ['id', 'type', 'name', 'eventType'],
  fields: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['event'] },
    name: { type: 'string' },
    eventType: { type: 'string', enum: ['encounter', 'story', 'trap', 'treasure', 'rest', 'shop', 'boss'] },
    choices: { type: 'array' },
  },
};

export const ITEM_SCHEMA = {
  required: ['id', 'type', 'name', 'itemType'],
  fields: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['item'] },
    name: { type: 'string' },
    itemType: { type: 'string', enum: ['weapon', 'armor', 'accessory', 'consumable', 'quest', 'material'] },
  },
};

export const MAP_SCHEMA = {
  required: ['width', 'height', 'grid', 'tileTypes'],
  fields: {
    width: { type: 'number', min: 5, max: 100 },
    height: { type: 'number', min: 5, max: 100 },
    grid: { type: 'array' },
    tileTypes: { type: 'object' },
    tileSize: { type: 'number', min: 16, max: 256 },
  },
};

export const PRESET_SCHEMA = {
  required: ['name', 'characters', 'map'],
  fields: {
    name: { type: 'string' },
    version: { type: 'string' },
    characters: { type: 'array' },
    enemies: { type: 'array' },
    events: { type: 'array' },
    items: { type: 'array' },
    map: { type: 'object' },
  },
};
