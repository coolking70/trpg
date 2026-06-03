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
