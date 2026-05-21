/**
 * WorldGenerator 测试：随机地图生成 + 连通性 + 主题
 */

import { generateMap, generateRandomPreset, getThemes } from '../../src/systems/WorldGenerator.js';

describe('WorldGenerator - 主题', () => {
  test('getThemes 返回 3 个主题', () => {
    const themes = getThemes();
    expect(themes.length).toBe(3);
    expect(themes.map(t => t.key)).toEqual(['forest', 'desert', 'ruins']);
    themes.forEach(t => expect(t.name).toBeTruthy());
  });
});

describe('WorldGenerator - generateMap', () => {
  test('默认尺寸 20×15', () => {
    const map = generateMap({ theme: 'forest' });
    expect(map.width).toBe(20);
    expect(map.height).toBe(15);
    expect(map.grid).toHaveLength(15);
    expect(map.grid[0]).toHaveLength(20);
  });

  test('自定义尺寸', () => {
    const map = generateMap({ width: 25, height: 18, theme: 'desert' });
    expect(map.width).toBe(25);
    expect(map.height).toBe(18);
    expect(map.grid[0]).toHaveLength(25);
  });

  test('POI 包含 spawn / dungeon / villages', () => {
    const map = generateMap({ theme: 'forest', villages: 2 });
    const spawn = map.pointsOfInterest.find(p => p.type === 'spawn');
    const dungeon = map.pointsOfInterest.find(p => p.type === 'dungeon');
    const villages = map.pointsOfInterest.filter(p => p.type === 'village');
    expect(spawn).toBeTruthy();
    expect(dungeon).toBeTruthy();
    expect(villages.length).toBeLessThanOrEqual(2);
  });

  test('每个 POI 都有 id', () => {
    const map = generateMap({ theme: 'forest', villages: 2 });
    map.pointsOfInterest.forEach(p => {
      expect(p.id).toBeTruthy();
      expect(typeof p.id).toBe('string');
    });
  });

  test('spawn 和 dungeon 距离 ≥ 5', () => {
    for (let trial = 0; trial < 5; trial++) {
      const map = generateMap({ theme: 'forest' });
      const s = map.pointsOfInterest.find(p => p.type === 'spawn');
      const d = map.pointsOfInterest.find(p => p.type === 'dungeon');
      const dist = Math.abs(s.x - d.x) + Math.abs(s.y - d.y);
      expect(dist).toBeGreaterThanOrEqual(5);
    }
  });

  test('grid 中存在 R 道路（spawn → dungeon 已铺路）', () => {
    const map = generateMap({ theme: 'forest' });
    const hasRoad = map.grid.some(row => row.includes('R'));
    expect(hasRoad).toBe(true);
  });

  test('grid 中存在 S 起点和 D 入口', () => {
    const map = generateMap({ theme: 'forest' });
    const flat = map.grid.join('');
    expect(flat).toContain('S');
    expect(flat).toContain('D');
  });

  test('主题切换：tile 名称随主题变化', () => {
    const forest = generateMap({ theme: 'forest' });
    const desert = generateMap({ theme: 'desert' });
    expect(forest.tileTypes.S.name).toBe('起点');
    expect(desert.tileTypes.S.name).toBe('商队起点');
  });

  test('未知主题回退到 forest', () => {
    const map = generateMap({ theme: 'unknown' });
    expect(map.tileTypes.S.name).toBe('起点');
  });

  test('connected component 算法：所有 POI 在最大连通区', () => {
    const map = generateMap({ theme: 'forest' });
    const walkable = new Set(['G', 'T', 'R', 'V', 'S', 'D']);

    // BFS 从 spawn 出发能否到 dungeon 和所有 village
    const spawn = map.pointsOfInterest.find(p => p.type === 'spawn');
    const visited = new Set([`${spawn.x},${spawn.y}`]);
    const queue = [{ x: spawn.x, y: spawn.y }];

    while (queue.length) {
      const { x, y } = queue.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        const tile = map.grid[ny][nx];
        if (walkable.has(tile)) {
          visited.add(key);
          queue.push({ x: nx, y: ny });
        }
      }
    }

    // 所有 POI 都可达
    map.pointsOfInterest.forEach(p => {
      expect(visited.has(`${p.x},${p.y}`)).toBe(true);
    });
  });
});

describe('WorldGenerator - generateRandomPreset', () => {
  const baseLibrary = {
    characters: [
      { id: 'c1', type: 'character', name: 'A', stats: { hp: 100, hpCurrent: 100, mp: 50, mpCurrent: 50, attack: 10, defense: 5, magicAttack: 0, magicDefense: 0, speed: 10, luck: 5 } },
    ],
    enemies: [
      { id: 'e1', type: 'enemy', name: '小怪', difficulty: 'easy', stats: { hp: 50, hpCurrent: 50, mp: 0, mpCurrent: 0, attack: 5, defense: 2, magicAttack: 0, magicDefense: 0, speed: 5, luck: 0 } },
      { id: 'eboss', type: 'enemy', name: 'Boss', difficulty: 'boss', stats: { hp: 200, hpCurrent: 200, mp: 0, mpCurrent: 0, attack: 20, defense: 10, magicAttack: 0, magicDefense: 0, speed: 10, luck: 0 } },
    ],
    items: [
      { id: 'i1', type: 'item', name: '药水', itemType: 'consumable', consumeEffect: { type: 'heal', stat: 'hp', value: 30 }, buyPrice: 25 },
    ],
  };

  test('生成完整预设含 map / events / lore', () => {
    const p = generateRandomPreset({ width: 15, height: 10, theme: 'desert', baseLibrary });
    expect(p.name).toContain('随机');
    expect(p.map).toBeTruthy();
    expect(p.events.length).toBeGreaterThan(0);
    expect(p.lore.worldName).toBeTruthy();
  });

  test('复用 baseLibrary 的卡牌', () => {
    const p = generateRandomPreset({ baseLibrary });
    expect(p.characters).toBe(baseLibrary.characters);
    expect(p.enemies).toBe(baseLibrary.enemies);
    expect(p.items).toBe(baseLibrary.items);
  });

  test('自动生成事件含 ch_start / ch_boss', () => {
    const p = generateRandomPreset({ baseLibrary });
    const ids = p.events.map(e => e.id);
    expect(ids).toContain('ch_start');
    expect(ids).toContain('ch_boss');
  });

  test('boss 事件引用了 baseLibrary 中 difficulty=boss 的敌人', () => {
    const p = generateRandomPreset({ baseLibrary });
    const boss = p.events.find(e => e.id === 'ch_boss');
    const enemyId = boss.choices[0].outcomes[0].effects[0].enemyIds[0];
    expect(enemyId).toBe('eboss');
  });

  test('villages 数量与配置匹配', () => {
    const p = generateRandomPreset({ villages: 3, baseLibrary });
    const villages = p.map.pointsOfInterest.filter(p2 => p2.type === 'village');
    expect(villages.length).toBeLessThanOrEqual(3);
  });

  test('rules 默认含 d20 + startingGold', () => {
    const p = generateRandomPreset({ baseLibrary });
    expect(p.rules.diceType).toBe('d20');
    expect(p.rules.startingGold).toBeGreaterThan(0);
  });
});
