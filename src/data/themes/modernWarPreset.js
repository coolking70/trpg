/**
 * 示范剧本：现代战争（Phase 42 T4）—— 挂 modernWarSchema 换皮的战略剧本。
 * 极小可玩骨架：1 个可扮演角色 + 战情指挥中心场景 + 两国（玩家/敌国）含城市与区域邻接图。
 */
import { modernWarSchema } from './modernWar.js';

export const modernWarPreset = {
  presetId: 'theme_modern_war',
  name: '钢铁防线·现代战争',
  author: 'TRPG 主题包',
  lore: { worldName: '近未来 2040', background: '地区局势骤紧，列国陈兵边境。你是一国的最高指挥官。' },
  strategySchema: modernWarSchema,
  factions: [
    { id: 'blue', name: '蓝方共和国' },
    { id: 'red', name: '红方联邦' },
  ],
  characters: [
    { id: 'char_player', name: '总指挥', stats: { hp: 100, hpCurrent: 100, mp: 0, mpCurrent: 0, attack: 10, defense: 6, speed: 8, luck: 2 } },
  ],
  enemies: [], items: [], events: [],
  scenes: [
    { id: 'scene_court', name: '战情指挥中心', type: 'settlement', icon: '🛰', coords: { x: 0, y: 0 }, tags: ['spawn', 'governance'], description: '蓝方最高战情指挥中心，参谋环立大屏，等候总指挥决断。', connections: [], events: [], vignettes: [] },
  ],
  startingSceneId: 'scene_court',
  // 出身（Phase 43）：同一战局，可由不同身份切入。总指挥号令全局；下层身份则战局自转、你随波而行。
  startingOptions: {
    origins: [
      { id: 'supreme', name: '最高统帅', icon: '🎖', tags: ['rank:supreme'], strategicRole: 'ruler', statBonus: { luck: 2 }, description: '执掌蓝方全局，号令三军、内政外交皆决于你。' },
      { id: 'field_cmd', name: '前线指挥官', icon: '🪖', tags: ['rank:officer'], strategicRole: 'officer', statBonus: { attack: 2, defense: 1 }, description: '统领一支部队，听命于上，亲历战阵（暂不掌国策）。' },
      { id: 'private', name: '列兵', icon: '🔫', tags: ['rank:soldier'], strategicRole: 'soldier', statBonus: { hp: 15 }, description: '战争机器中的一颗螺丝钉。国运沉浮非你能左右，你只求在炮火中活下去。' },
    ],
  },
  startingSceneRules: [{ default: true, sceneId: 'scene_court' }],
  strategicSetup: {
    playerFactionId: 'blue',
    regions: {
      homeland: { name: '蓝方本土', adjacency: ['border'] },
      border: { name: '争议边境', adjacency: ['homeland', 'redland'] },
      redland: { name: '红方腹地', adjacency: ['border'] },
    },
    factions: {
      blue: {
        gold: 240, food: 320, troops: 9000, order: 60,
        holdings: [
          { id: 'blue_capital', name: '蓝京', type: 'capital', population: 45000, dev: 100, security: 60, region: 'homeland' },
          { id: 'fort_line', name: '边境要塞群', type: 'fortress', population: 14000, dev: 85, security: 72, region: 'border' },
        ],
        diplomacy: { red: { stance: 'rival', relation: -35 } },
      },
      red: {
        gold: 360, food: 700, troops: 26000, order: 64,
        holdings: [
          { id: 'red_capital', name: '红都', type: 'capital', population: 80000, dev: 110, security: 62, region: 'redland' },
        ],
        diplomacy: { blue: { stance: 'rival', relation: -35 } },
      },
    },
  },
};

export default modernWarPreset;
