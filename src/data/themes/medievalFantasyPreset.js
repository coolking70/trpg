/**
 * 示范剧本：中世纪西式奇幻（Phase 42 T4）—— 挂 medievalFantasySchema 换皮的战略剧本。
 * 极小可玩骨架：1 个可扮演角色 + 王城理政场景 + 两王国（玩家/敌国）含城堡与区域邻接图。
 */
import { medievalFantasySchema } from './medievalFantasy.js';

export const medievalFantasyPreset = {
  presetId: 'theme_medieval_fantasy',
  name: '银月王座·奇幻征伐',
  author: 'TRPG 主题包',
  lore: { worldName: '艾瑟兰大陆', background: '诸王国林立，骑士与法师并立，王权之争未息。你执掌一方王国。' },
  strategySchema: medievalFantasySchema,
  factions: [
    { id: 'silvermoon', name: '银月王国' },
    { id: 'ironhold', name: '铁壁公国' },
  ],
  characters: [
    { id: 'char_player', name: '摄政', stats: { hp: 100, hpCurrent: 100, mp: 0, mpCurrent: 0, attack: 10, defense: 6, speed: 8, luck: 2 } },
  ],
  enemies: [], items: [], events: [],
  scenes: [
    { id: 'scene_court', name: '王座厅', type: 'settlement', icon: '🏰', coords: { x: 0, y: 0 }, tags: ['spawn', 'governance'], description: '银月王城的王座厅，群臣列班，等候摄政决断。', connections: [], events: [], vignettes: [] },
  ],
  startingSceneId: 'scene_court',
  // 出身（Phase 43）：同一乱世，可为王、为将、为卒。王者号令天下；卒者随时局浮沉。
  startingOptions: {
    origins: [
      { id: 'monarch', name: '摄政王', icon: '👑', tags: ['rank:monarch'], strategicRole: 'ruler', statBonus: { luck: 2 }, description: '执掌银月王国，内政外交、征伐和战皆决于你。' },
      { id: 'knight_cmd', name: '骑士统领', icon: '🛡', tags: ['rank:knight'], strategicRole: 'officer', statBonus: { attack: 2, defense: 2 }, description: '率一队骑士听王命征战，亲冒矢石（暂不掌国策）。' },
      { id: 'footman', name: '步卒', icon: '🗡', tags: ['rank:footman'], strategicRole: 'soldier', statBonus: { hp: 15 }, description: '军阵中一名无名步卒。王侯将相的棋局与你无关，你只想在乱世中活着回家。' },
    ],
  },
  startingSceneRules: [{ default: true, sceneId: 'scene_court' }],
  strategicSetup: {
    playerFactionId: 'silvermoon',
    regions: {
      heartland: { name: '银月腹地', adjacency: ['marches'] },
      marches: { name: '边境马克', adjacency: ['heartland', 'ironvale'] },
      ironvale: { name: '铁谷', adjacency: ['marches'] },
    },
    factions: {
      silvermoon: {
        gold: 220, food: 360, troops: 8000, order: 62,
        holdings: [
          { id: 'silver_keep', name: '银月王城', type: 'capital', population: 32000, dev: 100, security: 62, region: 'heartland' },
          { id: 'wardstone', name: '守石要塞', type: 'fortress', population: 12000, dev: 80, security: 70, region: 'marches' },
        ],
        diplomacy: { ironhold: { stance: 'rival', relation: -30 } },
      },
      ironhold: {
        gold: 300, food: 600, troops: 22000, order: 66,
        holdings: [
          { id: 'iron_castle', name: '铁壁堡', type: 'capital', population: 60000, dev: 105, security: 64, region: 'ironvale' },
        ],
        diplomacy: { silvermoon: { stance: 'rival', relation: -30 } },
      },
    },
  },
};

export default medievalFantasyPreset;
