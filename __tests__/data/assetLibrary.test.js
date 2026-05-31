import { assignPresetImages, selectAsset } from '../../src/data/assetLibrary.js';
import { DEFAULT_PRESET } from '../../src/data/defaultPreset.js';
import { generateScenePreset } from '../../src/systems/WorldGenerator.js';
import { readFileSync, readdirSync } from 'fs';

describe('assetLibrary', () => {
  test('按角色职业/种族标签匹配头像', () => {
    expect(selectAsset({ name: '人类圣骑士', tags: ['human', 'paladin'] }, 'characters')?.src)
      .toContain('human-female-paladin');
    expect(selectAsset({ name: '矮人盗贼', tags: ['dwarf', 'rogue'] }, 'characters')?.src)
      .toContain('dwarf-male-rogue');
    expect(selectAsset({ name: '半身人吟游诗人', tags: ['halfling', 'bard'] }, 'characters')?.src)
      .toContain('halfling-female-bard');
    expect(selectAsset({ name: '铁匠老汤姆', tags: ['npc', 'blacksmith'] }, 'characters')?.src)
      .toContain('npc-blacksmith');
  });

  test('按敌人、道具、事件语义匹配素材', () => {
    expect(selectAsset({ name: '暗影狼', tags: ['beast', 'shadow'] }, 'enemies')?.src)
      .toContain('shadow-wolf');
    expect(selectAsset({ name: '治疗药水', itemType: 'consumable', tags: ['potion'] }, 'items')?.src)
      .toContain('healing-potion');
    expect(selectAsset({ name: '第十章 黎明', eventType: 'story', tags: ['epilogue'] }, 'scenes')?.src)
      .toContain('dawn-altar-epilogue');
    expect(selectAsset({ name: '哥布林伏击', tags: ['goblin'] }, 'enemies')?.src)
      .toContain('goblin-raider');
    expect(selectAsset({ name: '绿洲城', type: 'settlement', tags: ['desert', 'oasis'] }, 'scenes')?.src)
      .toContain('oasis-market-city');
    expect(selectAsset({ name: '反应堆核心', eventType: 'boss', tags: ['ruins', 'reactor'] }, 'scenes')?.src)
      .toContain('reactor-core-chamber');
    expect(selectAsset({ name: '影鸦', tags: ['hacker', 'cyberpunk'] }, 'characters')?.src)
      .toContain('cyber-hacker-hood');
    expect(selectAsset({ name: '少林山门', eventType: 'story', tags: ['wuxia', 'shaolin'] }, 'scenes')?.src)
      .toContain('wuxia-shaolin-gate');
    expect(selectAsset({ name: '辐光尸鬼', tags: ['ghoul', 'radiation'] }, 'enemies')?.src)
      .toContain('postapoc-glowing-ghoul');
    expect(selectAsset({ name: '黑曜尖塔', eventType: 'story', tags: ['obsidian', 'spire'] }, 'scenes')?.src)
      .toContain('fantasy-obsidian-spire');
    expect(selectAsset({ name: '毒雾沼泽九头蛇', biome: 'swamp', difficulty: 'boss', tags: ['hydra'] }, 'enemies')?.src)
      .toContain('enemy-swamp-hydra-boss');
    expect(selectAsset({ name: '沙漠沙虫', biome: 'desert', difficulty: 'boss', tags: ['sandworm'] }, 'enemies')?.src)
      .toContain('enemy-sandworm-boss');
    expect(selectAsset({ name: '奥术地下眼魔', biome: 'tunnel', difficulty: 'boss', tags: ['horror'] }, 'enemies')?.src)
      .toContain('enemy-eye-horror-boss');
    expect(selectAsset({ name: '沼泽九头蛇鳞片', itemType: 'material', biome: 'swamp', tags: ['hydra', 'scale'] }, 'items')?.src)
      .toContain('loot-hydra-scale');
    expect(selectAsset({ name: '沙虫牙', itemType: 'material', biome: 'desert', tags: ['sandworm', 'tooth'] }, 'items')?.src)
      .toContain('loot-sandworm-tooth');
    expect(selectAsset({ name: '构装体动力核心', itemType: 'material', biome: 'ruins', tags: ['construct', 'core'] }, 'items')?.src)
      .toContain('loot-construct-power-core');
  });

  test('场景可按地点、状态、时段和天气选择状态变体', () => {
    expect(selectAsset({
      id: 'burned_inn',
      name: '被烧毁的夜间酒馆',
      placeType: 'tavern',
      state: 'ruined',
      time: 'night',
      tags: ['tavern', 'ruined', 'night'],
    }, 'scenes')?.src).toContain('state-tavern-ruined-night-clear');

    expect(selectAsset({
      id: 'rain_market',
      name: '雨夜市场',
      placeType: 'market',
      state: 'normal',
      time: 'night',
      weather: 'rain',
    }, 'scenes')?.src).toContain('state-market-normal-night-rain');

    expect(selectAsset({
      id: 'old_checkpoint',
      name: '废弃的雾中城门',
      placeType: 'checkpoint',
      state: 'abandoned',
      time: 'dusk',
      weather: 'fog',
    }, 'scenes')?.src).toContain('state-gate-abandoned-dusk-fog');

    expect(selectAsset({
      id: 'blocked_forest_path',
      name: '被风暴吹倒树木堵塞的森林道路',
      placeType: 'road',
      state: 'blocked',
      weather: 'storm',
      tags: ['forest'],
    }, 'scenes')?.src).toContain('state-forest-road-blocked-day-storm');

    expect(selectAsset({
      id: 'monster_mine',
      name: '怪物巢穴矿洞',
      placeType: 'cave',
      state: 'lair',
      time: 'night',
    }, 'scenes')?.src).toContain('state-cave-lair-night-clear');

    expect(selectAsset({
      id: 'flood_bridge',
      name: '风暴洪水中的桥梁',
      placeType: 'bridge',
      state: 'flooded',
      weather: 'storm',
    }, 'scenes')?.src).toContain('state-bridge-flooded-night-storm');

    expect(selectAsset({
      id: 'poison_swamp',
      name: '毒雾沼泽',
      placeType: 'swamp',
      state: 'poisoned',
      weather: 'fog',
    }, 'scenes')?.src).toContain('biome-swamp-poisoned-day-fog');

    expect(selectAsset({
      id: 'desert_sandstorm',
      name: '沙暴中的商路',
      placeType: 'desert',
      state: 'blocked',
      weather: 'sandstorm',
    }, 'scenes')?.src).toContain('biome-desert-blocked-day-sandstorm');

    expect(selectAsset({
      id: 'arcane_tunnel',
      name: '奥术符文地下通道',
      placeType: 'tunnel',
      state: 'arcane',
      weather: 'fog',
    }, 'scenes')?.src).toContain('biome-tunnel-arcane-night-fog');
  });

  test('默认剧本会自动补齐核心图片', () => {
    const aila = DEFAULT_PRESET.characters.find(c => c.id === 'char_001');
    const wolf = DEFAULT_PRESET.enemies.find(e => e.id === 'enemy_002');
    const potion = DEFAULT_PRESET.items.find(i => i.id === 'item_009');
    const start = DEFAULT_PRESET.events.find(e => e.id === 'ch1_start');

    expect(aila.image).toContain('/assets/library/characters/');
    expect(wolf.image).toContain('/assets/library/enemies/shadow-wolf');
    expect(potion.image).toContain('/assets/library/items/healing-potion');
    expect(start.image).toContain('/assets/library/scenes/guild-forest-edge');
  });

  test('生成场景剧本时自动适配事件和场景图', () => {
    const preset = generateScenePreset({
      theme: 'forest',
      baseLibrary: {
        characters: [{ id: 'c', type: 'character', name: '圣骑士', tags: ['paladin'] }],
        enemies: [{ id: 'e', type: 'enemy', name: '暗影狼', tags: ['wolf'], difficulty: 'easy' }],
        items: [{ id: 'i', type: 'item', name: '治疗药水', itemType: 'consumable', tags: ['potion'] }],
      },
    });
    expect(preset.characters[0].image).toContain('/assets/library/characters/');
    expect(preset.events.find(e => e.id === 'rnd_start').image).toContain('/assets/library/scenes/');
    expect(preset.scenes.find(s => s.id === 'scene_village').image).toContain('/assets/library/scenes/');
  });

  test('不同主题的生成场景优先使用对应主题素材', () => {
    const baseLibrary = {
      characters: [{ id: 'c', type: 'character', name: '兽人野蛮人', tags: ['orc', 'barbarian'] }],
      enemies: [{ id: 'e', type: 'enemy', name: '哥布林', tags: ['goblin'], difficulty: 'easy' }],
      items: [],
    };
    const desert = generateScenePreset({ theme: 'desert', baseLibrary });
    const ruins = generateScenePreset({ theme: 'ruins', baseLibrary });

    expect(desert.characters[0].image).toContain('orc-male-barbarian');
    expect(desert.scenes.find(s => s.id === 'scene_spawn').image).toContain('desert-caravan-camp');
    expect(desert.scenes.find(s => s.id === 'scene_village').image).toContain('oasis-market-city');
    expect(desert.scenes.find(s => s.id === 'scene_dungeon').image).toContain('pharaoh-tomb-gate');

    expect(ruins.scenes.find(s => s.id === 'scene_spawn').image).toContain('crashed-airship-ruins');
    expect(ruins.scenes.find(s => s.id === 'scene_village').image).toContain('survivor-camp-ruins');
    expect(ruins.scenes.find(s => s.id === 'scene_boss').image).toContain('reactor-core-chamber');
  });

  test('已有图片默认不被覆盖，overwrite=true 时才替换', () => {
    const preset = { characters: [{ id: 'c', name: '圣骑士', image: '/custom.png', tags: ['paladin'] }] };
    expect(assignPresetImages(preset).characters[0].image).toBe('/custom.png');
    expect(assignPresetImages(preset, { overwrite: true }).characters[0].image).toContain('/assets/library/');
  });

  test('同类型通用 NPC 会按实体 id 稳定分配不同变体', () => {
    const guardA = selectAsset({ id: 'gate_guard_a', name: '城门守卫甲', tags: ['guard'] }, 'characters');
    const guardB = selectAsset({ id: 'gate_guard_b', name: '城门守卫乙', tags: ['guard'] }, 'characters');
    const guardAAgain = selectAsset({ id: 'gate_guard_a', name: '城门守卫甲', tags: ['guard'] }, 'characters');
    const faceless = selectAsset({ id: 'background_patrol', name: '不露脸的巡逻士兵', tags: ['guard', 'faceless'] }, 'characters');

    expect(guardA?.src).toContain('/assets/library/characters/npc-guard-');
    expect(guardB?.src).toContain('/assets/library/characters/npc-guard-');
    expect(guardA?.src).toBe(guardAAgain?.src);
    expect(guardA?.src).not.toBe(guardB?.src);
    expect(faceless?.src).toMatch(/faceless/);
  });

  test('项目内置的大中小剧本都能自动获得图片资源', () => {
    for (const file of readdirSync('presets').filter(name => name.endsWith('.json'))) {
      const preset = JSON.parse(readFileSync(`presets/${file}`, 'utf8'));
      const assigned = assignPresetImages(preset);
      const misses = [];
      for (const category of ['characters', 'enemies', 'items', 'events', 'scenes']) {
        for (const card of assigned[category] || []) {
          if (!card.image?.includes('/assets/library/')) {
            misses.push(`${category}:${card.id || card.name}`);
          }
        }
      }
      expect(misses).toEqual([]);
    }
  });
});
