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
    aiConfig: { temperature: 0.7, maxResponseTokens: 1000, useStructuredOutput: true, language: 'zh-CN' },
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

// ============================================================
// 场景图（Scene Graph）随机生成 — 桌游跑团式 6-8 节点小剧本
// 不再产出 20×15 格子地图，每个节点就是一段戏。
// ============================================================

const SCENE_THEME_TEMPLATES = {
  forest: {
    name: '森林',
    icon: '🌲',
    spawn: { name: '林边公会', desc: '冒险者公会的边境哨站，使命召唤你们启程。', icon: '🚩' },
    village: { name: '林间小村', desc: '雾气缭绕的木屋聚落，村民投来戒备的目光。', icon: '🏘' },
    wilderness: [
      { name: '幽林古道', desc: '林间古道两旁的树木枝干扭曲，落叶踩上去发出闷响。', icon: '🌿' },
      { name: '荒废神龛', desc: '苔藓覆盖的小神龛半倾倒在路旁，传来微弱的绿光。', icon: '✨' },
    ],
    combat: { name: '暗影丛林', desc: '光线骤暗的密林深处，灌木丛中传来低沉的咆哮。', icon: '🐺' },
    dungeon: { name: '古老遗迹', desc: '布满藤蔓的巨大石门矗立在山壁前。', icon: '🚪' },
    boss: { name: '诅咒祭坛', desc: '阴森的祭坛上，幽绿鬼火在祭台中央跳动。', icon: '💀' },
    ending: { name: '黎明草地', desc: '走出遗迹，迎来三年来的第一缕黎明。', icon: '🌅' },
  },
  desert: {
    name: '荒漠',
    icon: '🏜',
    spawn: { name: '商队起点', desc: '炽热的烈日下，最后一队商队整理着行装。', icon: '🐪' },
    village: { name: '绿洲城', desc: '罕见的水井边围着不少商贩，棕榈树投下凉荫。', icon: '🏘' },
    wilderness: [
      { name: '风蚀峡谷', desc: '风沙打磨出的褶皱岩柱在烈日下投出长影。', icon: '⛰' },
      { name: '废弃驿站', desc: '半埋在沙中的驿站，门帘已被风沙撕成布条。', icon: '🛖' },
    ],
    combat: { name: '骸骨之地', desc: '黄沙中堆着不知名生物的白骨，沙下传来窸窣声。', icon: '☠' },
    dungeon: { name: '法老陵墓', desc: '黄沙半埋着一座方形入口，符文在炽日下隐约发光。', icon: '🚪' },
    boss: { name: '陵墓核心', desc: '阴冷的密室中，一尊干瘪的木乃伊缓缓抬起头颅。', icon: '🏺' },
    ending: { name: '日出沙丘', desc: '诅咒散去，第一缕清晨的光让沙丘镀上金色。', icon: '🌅' },
  },
  ruins: {
    name: '废墟',
    icon: '🏚',
    spawn: { name: '降落点', desc: '一艘失事的飞船残骸冒着青烟，你们从废墟中爬出。', icon: '🚀' },
    village: { name: '幸存者营地', desc: '废墟中拼凑起来的临时居所，几位居民紧张地看着你们。', icon: '🛖' },
    wilderness: [
      { name: '断壁巷道', desc: '坍塌的高墙之间，电缆从天而降迸出火星。', icon: '⚙' },
      { name: '锈蚀广场', desc: '荒废广场中央，一尊残破的雕像凝视虚空。', icon: '🗿' },
    ],
    combat: { name: '机械废场', desc: '故障机器人在残骸间巡逻，红光锁定了你们。', icon: '🤖' },
    dungeon: { name: '地下入口', desc: '一座沉重的金属门紧闭着，门旁刻着古老的警告。', icon: '🚪' },
    boss: { name: '核心反应堆', desc: '主控间内，被腐蚀的 AI 用合成嗓音宣告你们的终结。', icon: '💠' },
    ending: { name: '地表重光', desc: '反应堆停转，地下的奇异光带不再脉动，地表传来风声。', icon: '🌄' },
  },
};

/**
 * 生成场景图预设（替代 generateRandomPreset 的新版）
 * @param {object} options - { theme, baseLibrary }
 * @returns {object} 完整的 GamePreset 数据（含 scenes[]）
 */
export function generateScenePreset(options = {}) {
  const themeKey = options.theme || 'forest';
  const tpl = SCENE_THEME_TEMPLATES[themeKey] || SCENE_THEME_TEMPLATES.forest;
  const baseLibrary = options.baseLibrary || {};

  const characters = baseLibrary.characters || [];
  const enemies = baseLibrary.enemies || [];
  const items = baseLibrary.items || [];

  // 选 enemy 引用（带回退）
  const easyEnemies = enemies.filter(e => ['easy', 'normal'].includes(e.difficulty));
  const bossEnemies = enemies.filter(e => e.difficulty === 'boss' || e.difficulty === 'hard');
  const combatEnemyId = (easyEnemies[0] || enemies[0])?.id;
  const bossEnemyId = (bossEnemies[0] || enemies[enemies.length - 1])?.id;

  // 选商店物品
  const consumables = items.filter(i => i.itemType === 'consumable');
  const shopInventory = consumables.slice(0, 3).map(it => ({
    itemId: it.id, price: it.buyPrice || 25, stock: 5,
  }));

  // 选一个"治疗类 accessory"作为关键奖励物（首选 accessory，否则随便）
  const keyItem = items.find(i => i.itemType === 'accessory') || items.find(i => i.itemType === 'consumable');
  const keyItemId = keyItem ? keyItem.id : null;

  // 1) 事件骨架（6-7 个事件，每个挂在一个场景上）
  const events = [
    {
      id: 'rnd_start', type: 'event', name: '启程',
      description: `${tpl.spawn.desc} 守门人将一封蜡封信交给你们 — 任务召唤。`,
      eventType: 'story', priority: 100,
      trigger: { type: 'composite', condition: { inScene: ['scene_spawn'], excludeCompletedEvents: ['rnd_start'], probability: 1.0 } },
      choices: [
        { id: 'accept', text: '接受任务，出发！', requirements: null,
          outcomes: [{ probability: 1.0, text: '你们整装待发。', effects: [{ type: 'set_variable', name: 'quest_started', value: true }] }] },
      ],
      repeatable: false, tags: ['main'],
    },
    {
      id: 'rnd_traveler', type: 'event', name: '神秘相遇',
      description: '一位披着兜帽的旅人坐在路旁，似乎在等候。',
      eventType: 'encounter', priority: 90,
      trigger: { type: 'composite', condition: { inScene: ['scene_wild_1'], requireVariables: { quest_started: true }, excludeCompletedEvents: ['rnd_traveler'], probability: 1.0 } },
      choices: [
        { id: 'accept_help', text: '接受旅人的帮助', requirements: null,
          outcomes: [{ probability: 1.0, text: '旅人递给你们一件神秘物品。',
            effects: keyItemId ? [
              { type: 'add_item', itemId: keyItemId },
              { type: 'set_variable', name: 'met_traveler', value: true },
            ] : [{ type: 'set_variable', name: 'met_traveler', value: true }] }] },
        { id: 'decline', text: '婉拒后继续上路', requirements: null,
          outcomes: [{ probability: 1.0, text: '旅人耸耸肩，目送你们离去。', effects: [] }] },
      ],
      repeatable: false, tags: ['main', 'npc'],
    },
    shopInventory.length > 0 ? {
      id: 'rnd_shop', type: 'event', name: `${tpl.village.name}的商人`,
      description: '一位商人在简陋的柜台后向你招手。',
      eventType: 'shop', priority: 85,
      trigger: { type: 'composite', condition: { inScene: ['scene_village'], probability: 1.0 } },
      shop: { inventory: shopInventory, sellMultiplier: 0.5 },
      choices: [],
      repeatable: true, tags: ['shop'],
    } : null,
    combatEnemyId ? {
      id: 'rnd_combat', type: 'event', name: '突袭',
      description: '阴影中跃出敌人，战斗一触即发！',
      eventType: 'encounter', priority: 70,
      trigger: { type: 'composite', condition: { inScene: ['scene_combat'], requireCompletedEvents: ['rnd_start'], excludeCompletedEvents: ['rnd_combat'], probability: 1.0 } },
      choices: [
        { id: 'fight', text: '迎战', requirements: null,
          outcomes: [{ probability: 1.0, text: '战斗开始！', effects: [{ type: 'start_combat', enemyIds: [combatEnemyId, combatEnemyId] }] }] },
        { id: 'flee', text: '尝试脱身', requirements: null,
          outcomes: [
            { probability: 0.6, text: '你们成功甩开敌人。', effects: [] },
            { probability: 0.4, text: '逃跑失败！', effects: [{ type: 'start_combat', enemyIds: [combatEnemyId] }] },
          ] },
      ],
      repeatable: false, tags: ['combat'],
    } : null,
    bossEnemyId ? {
      id: 'rnd_dungeon_gate', type: 'event', name: '入口',
      description: `${tpl.dungeon.desc} 前方危机四伏。`,
      eventType: 'story', priority: 95,
      trigger: { type: 'composite', condition: { inScene: ['scene_dungeon'], excludeCompletedEvents: ['rnd_dungeon_gate'], probability: 1.0 } },
      choices: [
        { id: 'enter', text: '推开门，深入', requirements: null,
          outcomes: [{ probability: 1.0, text: '门吱呀作响，缓缓打开。', effects: [{ type: 'set_variable', name: 'entered_dungeon', value: true }] }] },
      ],
      repeatable: false, tags: ['main'],
    } : null,
    bossEnemyId ? {
      id: 'rnd_boss', type: 'event', name: '终焉',
      description: `${tpl.boss.desc} 决战不可避免。`,
      eventType: 'boss', priority: 100,
      trigger: { type: 'composite', condition: { inScene: ['scene_boss'], requireVariables: { entered_dungeon: true }, excludeCompletedEvents: ['rnd_boss'], probability: 1.0 } },
      choices: [
        { id: 'final', text: '终结这一切！', requirements: null,
          outcomes: [{ probability: 1.0, text: '决战开始！', effects: [{ type: 'start_combat', enemyIds: [bossEnemyId] }] }] },
      ],
      repeatable: false, tags: ['boss', 'main'],
    } : null,
    {
      id: 'rnd_ending', type: 'event', name: '黎明',
      description: `${tpl.ending.desc} 任务终于完成。`,
      eventType: 'story', priority: 100,
      trigger: { type: 'composite', condition: { inScene: ['scene_ending'], requireCompletedEvents: bossEnemyId ? ['rnd_boss'] : ['rnd_start'], excludeCompletedEvents: ['rnd_ending'], probability: 1.0 } },
      choices: [],
      repeatable: false, tags: ['epilogue', 'main'],
    },
  ].filter(Boolean);

  // 2) 场景图（7-8 个节点）
  const scenes = [
    {
      id: 'scene_spawn', name: tpl.spawn.name, type: 'spawn', icon: tpl.spawn.icon,
      description: tpl.spawn.desc,
      coords: { x: 0, y: 2 },
      connections: [{ to: 'scene_wild_1', label: '踏上征程' }],
      events: ['rnd_start'],
      vignettes: ['你们再次回到起点，似乎一切刚刚开始。'],
      tags: ['safe', 'main'],
    },
    {
      id: 'scene_wild_1', name: tpl.wilderness[0].name, type: 'wilderness', icon: tpl.wilderness[0].icon,
      description: tpl.wilderness[0].desc,
      coords: { x: 1, y: 2 },
      connections: [
        { to: 'scene_spawn', label: '返回起点' },
        { to: 'scene_village', label: '继续前行' },
        { to: 'scene_combat', label: '偏离主道', gated: { requireCompletedEvents: ['rnd_start'] } },
      ],
      events: ['rnd_traveler'],
      vignettes: ['熟悉的路径，没有新的发现。'],
      tags: ['main'],
    },
    {
      id: 'scene_village', name: tpl.village.name, type: 'settlement', icon: '🏘',
      description: tpl.village.desc,
      coords: { x: 2, y: 1 },
      connections: [
        { to: 'scene_wild_1', label: '返回旷野' },
        { to: 'scene_wild_2', label: '沿主路深入' },
      ],
      events: ['rnd_shop'].filter(Boolean),
      vignettes: ['村民冲你们点头致意。'],
      tags: ['safe', 'shop', 'main'],
    },
    {
      id: 'scene_combat', name: tpl.combat.name, type: 'combat', icon: tpl.combat.icon,
      description: tpl.combat.desc,
      coords: { x: 2, y: 3 },
      connections: [
        { to: 'scene_wild_1', label: '撤回旷野' },
        { to: 'scene_wild_2', label: '继续向前突进' },
      ],
      events: combatEnemyId ? ['rnd_combat'] : [],
      vignettes: ['空旷的战场，只剩风声。'],
      tags: ['combat'],
    },
    {
      id: 'scene_wild_2', name: tpl.wilderness[1].name, type: 'wilderness', icon: tpl.wilderness[1].icon,
      description: tpl.wilderness[1].desc,
      coords: { x: 3, y: 2 },
      connections: [
        { to: 'scene_village', label: '回到村庄' },
        { to: 'scene_combat', label: '钻回密道' },
        { to: 'scene_dungeon', label: '推进至入口' },
      ],
      events: [],
      vignettes: ['你已经熟悉这片荒野。'],
      tags: ['main'],
    },
    {
      id: 'scene_dungeon', name: tpl.dungeon.name, type: 'dungeon', icon: tpl.dungeon.icon,
      description: tpl.dungeon.desc,
      coords: { x: 4, y: 2 },
      connections: [
        { to: 'scene_wild_2', label: '退回旷野' },
        { to: 'scene_boss', label: '深入内部', gated: { requireVariables: { entered_dungeon: true } } },
      ],
      events: bossEnemyId ? ['rnd_dungeon_gate'] : [],
      vignettes: ['入口的门已开启，黑暗在召唤。'],
      tags: ['main'],
    },
    {
      id: 'scene_boss', name: tpl.boss.name, type: 'dungeon', icon: tpl.boss.icon,
      description: tpl.boss.desc,
      coords: { x: 5, y: 2 },
      connections: [{ to: 'scene_ending', label: '走出 / 仰望黎明', gated: { requireCompletedEvents: bossEnemyId ? ['rnd_boss'] : ['rnd_start'] } }],
      events: bossEnemyId ? ['rnd_boss'] : [],
      vignettes: ['一片寂静，胜利的回响早已散去。'],
      tags: ['boss', 'main'],
    },
    {
      id: 'scene_ending', name: tpl.ending.name, type: 'ending', icon: tpl.ending.icon,
      description: tpl.ending.desc,
      coords: { x: 6, y: 2 },
      connections: [],
      events: ['rnd_ending'],
      vignettes: ['晨光铺满大地。'],
      tags: ['epilogue', 'main', 'safe'],
    },
  ];

  return {
    version: '1.0.0',
    presetId: 'preset_random_' + themeKey + '_' + Date.now(),
    name: `随机${tpl.name}冒险`,
    author: 'WorldGenerator',
    createdAt: new Date().toISOString(),
    description: `自动生成的${tpl.name}主题场景图冒险（7 节点小剧本）`,
    lore: {
      worldName: `随机${tpl.name}世界`,
      era: '未知纪元',
      background: `命运随机编织的${tpl.name}。从启点开始，途经村落与试炼，最终走向真相之门。`,
      rules: '采用 D20 骰子系统，战斗为回合制',
      gmStyle: '氛围多变，根据玩家选择形成独特故事',
    },
    characters,
    enemies,
    items,
    events,
    startingSceneId: 'scene_spawn',
    displayMode: 'scene-graph',
    scenes,
    rules: { diceType: 'd20', combatFormula: '(attack + dice) - defense', maxPartySize: 4, startingGold: 100 },
    aiConfig: { temperature: 0.7, maxResponseTokens: 1000, useStructuredOutput: true, language: 'zh-CN' },
  };
}
