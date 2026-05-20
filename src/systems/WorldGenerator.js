/**
 * 随机世界生成器
 *
 * 算法：
 * 1. 细胞自动机生成 G/T/W/M 基础地形
 * 2. BFS 找最大连通可行走区域，确保起点/终点/村庄都可达
 * 3. A* 寻路在起点-村庄-终点之间铺设 R 道路
 * 4. 在道路附近随机放 POI
 *
 * 不依赖 GameSystem 基类，作为纯算法函数库提供
 */

/** 主题决定 tileType 比例与颜色 */
const THEMES = {
  forest: {
    name: '森林',
    tileTypes: {
      'G': { name: '草地', color: '#4a8c3f', walkable: true, moveCost: 1, image: '' },
      'T': { name: '树林', color: '#2d5a1e', walkable: true, moveCost: 2, image: '' },
      'W': { name: '水域', color: '#3366cc', walkable: false, moveCost: 99, image: '' },
      'M': { name: '山地', color: '#8b7355', walkable: false, moveCost: 99, image: '' },
      'R': { name: '道路', color: '#c4a35a', walkable: true, moveCost: 0.5, image: '' },
      'V': { name: '村庄', color: '#d4a574', walkable: true, moveCost: 1, image: '' },
      'D': { name: '地城入口', color: '#4a0000', walkable: true, moveCost: 1, image: '' },
      'S': { name: '起点', color: '#ffcc00', walkable: true, moveCost: 1, image: '' },
    },
    bias: { G: 0.55, T: 0.25, W: 0.08, M: 0.12 },  // 初始分布
  },
  desert: {
    name: '荒漠',
    tileTypes: {
      'G': { name: '沙地', color: '#c9a961', walkable: true, moveCost: 1, image: '' },
      'T': { name: '仙人掌丛', color: '#a89043', walkable: true, moveCost: 2, image: '' },
      'W': { name: '绿洲', color: '#2dd4bf', walkable: true, moveCost: 1, image: '' },
      'M': { name: '岩柱', color: '#7c5e3c', walkable: false, moveCost: 99, image: '' },
      'R': { name: '商道', color: '#e6c79c', walkable: true, moveCost: 0.5, image: '' },
      'V': { name: '绿洲城', color: '#fbbf24', walkable: true, moveCost: 1, image: '' },
      'D': { name: '陵墓入口', color: '#3a2810', walkable: true, moveCost: 1, image: '' },
      'S': { name: '商队起点', color: '#fde047', walkable: true, moveCost: 1, image: '' },
    },
    bias: { G: 0.70, T: 0.10, W: 0.05, M: 0.15 },
  },
  ruins: {
    name: '废墟',
    tileTypes: {
      'G': { name: '残墟', color: '#6b6b6b', walkable: true, moveCost: 1, image: '' },
      'T': { name: '断柱', color: '#525252', walkable: true, moveCost: 2, image: '' },
      'W': { name: '毒沼', color: '#365314', walkable: false, moveCost: 99, image: '' },
      'M': { name: '巨岩', color: '#404040', walkable: false, moveCost: 99, image: '' },
      'R': { name: '石板路', color: '#a8a29e', walkable: true, moveCost: 0.5, image: '' },
      'V': { name: '幸存者营地', color: '#ea580c', walkable: true, moveCost: 1, image: '' },
      'D': { name: '地下入口', color: '#1c1917', walkable: true, moveCost: 1, image: '' },
      'S': { name: '降落点', color: '#fbbf24', walkable: true, moveCost: 1, image: '' },
    },
    bias: { G: 0.50, T: 0.20, W: 0.10, M: 0.20 },
  },
};

/**
 * 生成一张随机地图
 * @param {object} options - { width, height, theme, villages, seed? }
 * @returns {object} map 对象（符合 GamePreset.map 格式）
 */
export function generateMap(options = {}) {
  const width = options.width || 20;
  const height = options.height || 15;
  const themeKey = options.theme || 'forest';
  const villageCount = Math.max(1, Math.min(3, options.villages ?? 2));

  const theme = THEMES[themeKey] || THEMES.forest;

  // === 1. 细胞自动机生成基础地形 ===
  let grid = generateBaseTerrain(width, height, theme.bias);

  // === 2. 找最大连通可行走区域 ===
  const walkable = new Set(['G', 'T', 'R']);
  const components = findConnectedComponents(grid, width, height, walkable);
  const largest = components.reduce((a, b) => a.length > b.length ? a : b, []);

  // 把不在最大连通区的 G/T 改为 M（保证可达性）
  const reachable = new Set(largest.map(p => `${p.x},${p.y}`));
  grid = grid.map((row, y) => row.split('').map((c, x) => {
    if (walkable.has(c) && !reachable.has(`${x},${y}`)) return 'M';
    return c;
  }).join(''));

  // === 3. 选择起点、终点、村庄位置（保证 sufficient distance） ===
  const reachableArr = Array.from(reachable).map(s => {
    const [x, y] = s.split(',').map(Number);
    return { x, y };
  });
  if (reachableArr.length < 5) {
    // 退化：随便选
    return { width, height, tileSize: 64, tileTypes: theme.tileTypes,
             grid, pointsOfInterest: [], fogOfWar: true, revealRadius: 3,
             tags: [themeKey], notes: 'fallback' };
  }

  // 起点：随机选一个；终点：选离起点曼哈顿距离最大的
  const spawnPos = reachableArr[Math.floor(Math.random() * reachableArr.length)];
  let dungeonPos = spawnPos;
  let maxDist = 0;
  for (const p of reachableArr) {
    const d = Math.abs(p.x - spawnPos.x) + Math.abs(p.y - spawnPos.y);
    if (d > maxDist) { maxDist = d; dungeonPos = p; }
  }

  // 村庄：选离起点+终点都至少 5 格的位置
  const villagePositions = [];
  for (let attempts = 0; attempts < 100 && villagePositions.length < villageCount; attempts++) {
    const cand = reachableArr[Math.floor(Math.random() * reachableArr.length)];
    const distToSpawn = Math.abs(cand.x - spawnPos.x) + Math.abs(cand.y - spawnPos.y);
    const distToDungeon = Math.abs(cand.x - dungeonPos.x) + Math.abs(cand.y - dungeonPos.y);
    const distToVillages = villagePositions.map(v => Math.abs(cand.x - v.x) + Math.abs(cand.y - v.y));
    if (distToSpawn >= 5 && distToDungeon >= 5 && distToVillages.every(d => d >= 4)) {
      villagePositions.push(cand);
    }
  }

  // === 4. 在 spawn → 各 village → dungeon 之间铺道路 ===
  const allWaypoints = [spawnPos, ...villagePositions, dungeonPos];
  for (let i = 0; i < allWaypoints.length - 1; i++) {
    const path = findPath(grid, width, height, allWaypoints[i], allWaypoints[i + 1], walkable);
    for (const p of path) {
      const row = grid[p.y];
      const c = row[p.x];
      if (c === 'G' || c === 'T') {
        grid[p.y] = row.substring(0, p.x) + 'R' + row.substring(p.x + 1);
      }
    }
  }

  // === 5. 写入 spawn / dungeon / village 字符 ===
  setTile(grid, spawnPos.x, spawnPos.y, 'S');
  setTile(grid, dungeonPos.x, dungeonPos.y, 'D');
  for (const v of villagePositions) {
    setTile(grid, v.x, v.y, 'V');
  }

  // === 6. POI 列表 ===
  const pointsOfInterest = [
    { id: 'poi_spawn', x: spawnPos.x, y: spawnPos.y, name: theme.tileTypes['S'].name, type: 'spawn', linkedEventId: null },
    { id: 'poi_dungeon', x: dungeonPos.x, y: dungeonPos.y, name: theme.tileTypes['D'].name, type: 'dungeon', linkedEventId: null },
    ...villagePositions.map((v, i) => ({
      id: `poi_village_${i + 1}`, x: v.x, y: v.y,
      name: `${theme.tileTypes['V'].name} ${i + 1}`, type: 'village', linkedEventId: null,
    })),
  ];

  return {
    id: 'map_' + Date.now(),
    name: `随机${theme.name}地图`,
    description: `自动生成的${theme.name}地图（${width}×${height}）`,
    width, height, tileSize: 64,
    tileTypes: theme.tileTypes,
    grid,
    pointsOfInterest,
    fogOfWar: true,
    revealRadius: 3,
    tags: ['random', themeKey],
    notes: `Generated ${new Date().toISOString()}`,
  };
}

/**
 * 生成基础地形（按 bias 随机 + 细胞自动机平滑）
 */
function generateBaseTerrain(width, height, bias) {
  // 随机填充
  const grid = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      row += pickByBias(bias);
    }
    grid.push(row);
  }

  // 细胞自动机平滑（3 次迭代）
  for (let iter = 0; iter < 3; iter++) {
    const next = [];
    for (let y = 0; y < height; y++) {
      let row = '';
      for (let x = 0; x < width; x++) {
        row += smoothCell(grid, x, y, width, height);
      }
      next.push(row);
    }
    for (let y = 0; y < height; y++) grid[y] = next[y];
  }

  return grid;
}

function pickByBias(bias) {
  const r = Math.random();
  let cum = 0;
  for (const [key, p] of Object.entries(bias)) {
    cum += p;
    if (r <= cum) return key;
  }
  return Object.keys(bias)[0];
}

function smoothCell(grid, x, y, width, height) {
  // 统计 3x3 邻域内各字符出现频次
  const counts = {};
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const c = grid[ny][nx];
      counts[c] = (counts[c] || 0) + 1;
    }
  }
  // 返回出现频次最高的字符
  let best = grid[y][x], bestCount = 0;
  for (const [c, n] of Object.entries(counts)) {
    if (n > bestCount) { best = c; bestCount = n; }
  }
  return best;
}

function findConnectedComponents(grid, width, height, walkable) {
  const seen = new Set();
  const components = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (seen.has(`${x},${y}`) || !walkable.has(grid[y][x])) continue;
      const comp = [];
      const queue = [{ x, y }];
      while (queue.length) {
        const p = queue.shift();
        const key = `${p.x},${p.y}`;
        if (seen.has(key)) continue;
        if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) continue;
        if (!walkable.has(grid[p.y][p.x])) continue;
        seen.add(key);
        comp.push(p);
        queue.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y },
                  { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
      }
      components.push(comp);
    }
  }
  return components;
}

function findPath(grid, width, height, start, end, walkable) {
  // 简单 BFS（曼哈顿距离启发，但用 BFS 保证最短路）
  const seen = new Set([`${start.x},${start.y}`]);
  const queue = [{ x: start.x, y: start.y, path: [] }];
  while (queue.length) {
    const node = queue.shift();
    if (node.x === end.x && node.y === end.y) return node.path;
    if (node.path.length > 100) continue;  // 安全上限
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = node.x + dx, ny = node.y + dy;
      const key = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (seen.has(key)) continue;
      if (!walkable.has(grid[ny][nx])) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny, path: [...node.path, { x: nx, y: ny }] });
    }
  }
  return [];
}

function setTile(grid, x, y, char) {
  if (y < 0 || y >= grid.length) return;
  const row = grid[y];
  if (x < 0 || x >= row.length) return;
  grid[y] = row.substring(0, x) + char + row.substring(x + 1);
}

/**
 * 完整生成一个随机预设（含地图 + 自动生成的事件骨架）
 * 角色/敌人/物品复用传入的 baseLibrary（避免重新生成）
 * @param {object} options - { width, height, theme, villages, baseLibrary }
 * @returns {object} 完整的 GamePreset 数据
 */
export function generateRandomPreset(options = {}) {
  const map = generateMap(options);
  const baseLibrary = options.baseLibrary || {};
  const themeKey = options.theme || 'forest';
  const theme = THEMES[themeKey] || THEMES.forest;

  // 复用基础卡牌库（如果没传则用默认起手）
  const characters = baseLibrary.characters || [];
  const enemies = baseLibrary.enemies || [];
  const items = baseLibrary.items || [];

  // 自动生成事件骨架
  const events = generateRandomEvents(map, enemies, items, themeKey);

  return {
    version: '1.0.0',
    presetId: 'preset_random_' + Date.now(),
    name: `随机${theme.name}冒险`,
    author: 'WorldGenerator',
    createdAt: new Date().toISOString(),
    description: `自动生成的${theme.name}主题冒险`,
    lore: {
      worldName: `随机${theme.name}世界`,
      era: '未知纪元',
      background: `这是一片由命运随机编织的${theme.name}。起点处，使命召唤；远方的入口，等待勇者。`,
      rules: '采用 D20 骰子系统',
      gmStyle: '氛围多变，根据玩家选择形成独特故事',
    },
    characters,
    enemies,
    items,
    events,
    map,
    rules: { diceType: 'd20', combatFormula: '(attack + dice) - defense', maxPartySize: 4, startingGold: 100 },
    aiConfig: { temperature: 0.7, maxResponseTokens: 300, useStructuredOutput: true, language: 'zh-CN' },
  };
}

/** 自动生成事件骨架：开场 + 村庄商店 + 入口 boss */
function generateRandomEvents(map, enemies, items, themeKey) {
  const events = [];

  // 找 POI
  const spawnPoi = map.pointsOfInterest.find(p => p.type === 'spawn');
  const dungeonPoi = map.pointsOfInterest.find(p => p.type === 'dungeon');
  const villagePois = map.pointsOfInterest.filter(p => p.type === 'village');

  // 开场事件
  if (spawnPoi) {
    events.push({
      id: 'ch_start', type: 'event', name: '冒险启程', description: '你们站在出发点。前方等待着未知。',
      eventType: 'story', priority: 100,
      trigger: { type: 'composite', condition: { pointsOfInterest: ['poi_spawn'], excludeCompletedEvents: ['ch_start'], probability: 1.0 } },
      choices: [
        { id: 'go', text: '出发！', outcomes: [{ probability: 1.0, text: '冒险开始了。', effects: [{ type: 'set_variable', name: 'quest_started', value: true }] }] },
      ],
      repeatable: false, tags: ['main', 'auto'],
    });
  }

  // 每个村庄一个商店事件
  const consumables = items.filter(i => i.itemType === 'consumable');
  villagePois.forEach((poi, idx) => {
    if (consumables.length === 0) return;
    events.push({
      id: `ch_shop_${idx + 1}`, type: 'event', name: `${poi.name}商店`, description: '一位商人向你招手。',
      eventType: 'shop', priority: 85,
      trigger: { type: 'composite', condition: { pointsOfInterest: [poi.id], probability: 1.0 } },
      shop: {
        inventory: consumables.slice(0, 3).map(it => ({ itemId: it.id, price: it.buyPrice || 25, stock: 5 })),
        sellMultiplier: 0.5,
      },
      choices: [],
      repeatable: true, tags: ['shop', 'auto'],
    });
  });

  // Boss 入口
  if (dungeonPoi && enemies.length > 0) {
    const boss = enemies.find(e => e.difficulty === 'boss') || enemies[enemies.length - 1];
    events.push({
      id: 'ch_boss', type: 'event', name: '最终之门', description: `${dungeonPoi.name}前，一股强大的气息让人心惊。`,
      eventType: 'boss', priority: 100,
      trigger: { type: 'composite', condition: { pointsOfInterest: ['poi_dungeon'], excludeCompletedEvents: ['ch_boss'], probability: 1.0 } },
      choices: [
        { id: 'fight', text: '进入战斗', outcomes: [{ probability: 1.0, text: '决战开始！', effects: [{ type: 'start_combat', enemyIds: [boss.id] }] }] },
      ],
      repeatable: false, tags: ['boss', 'main', 'auto'],
    });
  }

  // 随机遭遇（按地块）
  const easyEnemies = enemies.filter(e => e.difficulty === 'easy' || e.difficulty === 'normal');
  if (easyEnemies.length > 0) {
    events.push({
      id: 'ch_random_encounter', type: 'event', name: '突袭', description: '你们被野兽伏击！',
      eventType: 'encounter', priority: 30,
      trigger: { type: 'composite', condition: { tileTypes: ['T', 'G'], requireCompletedEvents: ['ch_start'], probability: 0.18 } },
      choices: [
        { id: 'fight', text: '迎战', outcomes: [{ probability: 1.0, text: '战斗开始！', effects: [{ type: 'start_combat', enemyIds: [easyEnemies[0].id] }] }] },
        { id: 'flee', text: '逃跑', outcomes: [
          { probability: 0.6, text: '成功逃脱。', effects: [] },
          { probability: 0.4, text: '逃跑失败！', effects: [{ type: 'start_combat', enemyIds: [easyEnemies[0].id] }] },
        ] },
      ],
      repeatable: true, maxOccurrences: 5, tags: ['random', 'auto'],
    });
  }

  return events;
}

/** 暴露 THEMES 供 UI 显示主题列表 */
export function getThemes() {
  return Object.entries(THEMES).map(([key, t]) => ({ key, name: t.name }));
}
