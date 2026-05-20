/**
 * 地图编辑器
 * Canvas 绘制 + 瓦片类型 CRUD + POI 管理
 */

import { field, numberField, selectField, section, uniqueId } from './_helpers.js';
import { generateMap, getThemes } from '../../systems/WorldGenerator.js';

const TILE_PIXEL_SIZE = 28;  // 编辑器中每个瓦片像素大小（独立于 mapData.tileSize）

let selectedTileKey = 'G';
let selectedTool = 'paint';  // 'paint' | 'poi'
let isPainting = false;

export function renderMapEditor(container, preset, refresh) {
  // 初始化空地图
  if (!preset.map) {
    preset.map = {
      id: 'map_' + Date.now(),
      name: '新地图',
      width: 20, height: 15, tileSize: 64,
      tileTypes: defaultTileTypes(),
      grid: Array(15).fill('G'.repeat(20)),
      pointsOfInterest: [],
      fogOfWar: true, revealRadius: 3,
      tags: [], notes: '',
    };
  }

  const map = preset.map;
  if (!map.tileTypes || Object.keys(map.tileTypes).length === 0) {
    map.tileTypes = defaultTileTypes();
  }

  // 校验调色板选中项有效
  if (!map.tileTypes[selectedTileKey]) {
    selectedTileKey = Object.keys(map.tileTypes)[0] || 'G';
  }

  const root = document.createElement('div');
  root.className = 'map-editor';

  // 顶部信息栏
  const infoBar = document.createElement('div');
  infoBar.className = 'map-editor__info';
  infoBar.innerHTML = `
    <span>📐 地图: ${map.width} × ${map.height}</span>
    <span>🎨 当前瓦片: <span class="map-editor__current-swatch" style="background:${map.tileTypes[selectedTileKey]?.color || '#888'}"></span> ${map.tileTypes[selectedTileKey]?.name || selectedTileKey}</span>
    <span>🔧 工具: ${selectedTool === 'paint' ? '绘制' : 'POI'}</span>
  `;
  root.appendChild(infoBar);

  // 主布局：左侧工具 + 右侧 canvas
  const layout = document.createElement('div');
  layout.className = 'map-editor__layout';

  // 左侧工具面板
  layout.appendChild(renderToolPanel(map, refresh));

  // 右侧 Canvas
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'map-editor__canvas-wrap';
  const canvas = renderCanvas(map, refresh);
  canvasWrap.appendChild(canvas);
  layout.appendChild(canvasWrap);

  root.appendChild(layout);
  container.appendChild(root);
}

function renderToolPanel(map, refresh) {
  const panel = document.createElement('div');
  panel.className = 'map-editor__tools';

  // === 随机生成 ===
  const genSec = section('🎲 随机生成');
  const genRow = document.createElement('div');
  genRow.className = 'map-editor__gen-row';

  const themeSelect = document.createElement('select');
  themeSelect.className = 'input';
  for (const t of getThemes()) {
    const opt = document.createElement('option');
    opt.value = t.key;
    opt.textContent = t.name;
    themeSelect.appendChild(opt);
  }
  genRow.appendChild(themeSelect);

  const genBtn = document.createElement('button');
  genBtn.className = 'btn btn--primary';
  genBtn.textContent = '🎲 重新生成';
  genBtn.addEventListener('click', () => {
    if (!confirm('随机生成会覆盖当前地图，确定？')) return;
    const newMap = generateMap({
      width: map.width, height: map.height,
      theme: themeSelect.value, villages: 2,
    });
    // 用新地图替换 map 的字段（保持引用）
    Object.assign(map, newMap);
    refresh();
  });
  genRow.appendChild(genBtn);
  genSec.appendChild(genRow);

  const hint = document.createElement('div');
  hint.className = 'editor-field__hint';
  hint.textContent = '细胞自动机生成地形，自动布置道路连通起点 → 村庄 → 终点';
  genSec.appendChild(hint);

  panel.appendChild(genSec);

  // 工具切换
  const toolSec = section('工具');
  const toolBar = document.createElement('div');
  toolBar.className = 'map-editor__tool-bar';
  for (const [id, label] of [['paint', '🎨 绘制'], ['poi', '📍 POI']]) {
    const b = document.createElement('button');
    b.className = `btn${selectedTool === id ? ' btn--primary' : ''}`;
    b.textContent = label;
    b.addEventListener('click', () => { selectedTool = id; refresh(); });
    toolBar.appendChild(b);
  }
  toolSec.appendChild(toolBar);
  panel.appendChild(toolSec);

  // 调色板
  const paletteSec = section('调色板（点击选中）');
  const palette = document.createElement('div');
  palette.className = 'map-editor__palette';
  for (const [key, def] of Object.entries(map.tileTypes)) {
    const sw = document.createElement('button');
    sw.className = `map-editor__swatch${key === selectedTileKey ? ' selected' : ''}`;
    sw.style.background = def.color || '#888';
    sw.title = `${key} - ${def.name}${def.walkable ? '' : ' (不可通行)'}`;
    sw.innerHTML = `<span>${key}</span>`;
    sw.addEventListener('click', () => { selectedTileKey = key; refresh(); });
    palette.appendChild(sw);
  }
  paletteSec.appendChild(palette);
  panel.appendChild(paletteSec);

  // 瓦片类型 CRUD
  const typesSec = section(`瓦片类型 (${Object.keys(map.tileTypes).length})`);
  for (const [key, def] of Object.entries(map.tileTypes)) {
    const row = document.createElement('div');
    row.className = 'map-editor__type-row';
    row.innerHTML = `
      <span class="map-editor__type-swatch" style="background:${def.color}"></span>
      <input type="text" class="input map-editor__type-key" maxlength="2" value="${key}" title="键值（1-2字符）">
      <input type="text" class="input map-editor__type-name" value="${def.name || ''}" title="名称">
      <input type="color" class="map-editor__type-color" value="${def.color || '#888888'}" title="颜色">
      <label title="可通行"><input type="checkbox" ${def.walkable ? 'checked' : ''} class="map-editor__type-walkable">通</label>
      <button class="btn btn--danger map-editor__type-del">×</button>
    `;

    const keyIn = row.querySelector('.map-editor__type-key');
    const nameIn = row.querySelector('.map-editor__type-name');
    const colorIn = row.querySelector('.map-editor__type-color');
    const walkIn = row.querySelector('.map-editor__type-walkable');
    const delBtn = row.querySelector('.map-editor__type-del');

    keyIn.addEventListener('change', () => {
      const newKey = keyIn.value.trim();
      if (!newKey || newKey === key) return;
      if (map.tileTypes[newKey]) { alert('键值已存在'); keyIn.value = key; return; }
      // 重命名 grid 中所有该 key
      map.grid = map.grid.map(row => row.split('').map(c => c === key ? newKey : c).join(''));
      map.tileTypes[newKey] = map.tileTypes[key];
      delete map.tileTypes[key];
      if (selectedTileKey === key) selectedTileKey = newKey;
      refresh();
    });
    nameIn.addEventListener('input', () => { def.name = nameIn.value; });
    colorIn.addEventListener('change', () => { def.color = colorIn.value; refresh(); });
    walkIn.addEventListener('change', () => { def.walkable = walkIn.checked; });
    delBtn.addEventListener('click', () => {
      if (Object.keys(map.tileTypes).length <= 1) { alert('至少需要一个瓦片类型'); return; }
      if (!confirm(`删除瓦片类型 ${key}？地图上的该类型瓦片会被替换为 ${Object.keys(map.tileTypes)[0]}。`)) return;
      // 替换 grid 中所有该 key 为第一个剩余 key
      const fallback = Object.keys(map.tileTypes).find(k => k !== key);
      map.grid = map.grid.map(row => row.split('').map(c => c === key ? fallback : c).join(''));
      delete map.tileTypes[key];
      if (selectedTileKey === key) selectedTileKey = fallback;
      refresh();
    });

    typesSec.appendChild(row);
  }

  const addTypeBtn = document.createElement('button');
  addTypeBtn.className = 'btn';
  addTypeBtn.textContent = '+ 新增类型';
  addTypeBtn.addEventListener('click', () => {
    // 找一个未用的字符
    let newKey = 'X';
    for (let i = 65; i < 91; i++) {
      const c = String.fromCharCode(i);
      if (!map.tileTypes[c]) { newKey = c; break; }
    }
    map.tileTypes[newKey] = { name: '新瓦片', color: '#888888', walkable: true, moveCost: 1, image: '' };
    selectedTileKey = newKey;
    refresh();
  });
  typesSec.appendChild(addTypeBtn);
  panel.appendChild(typesSec);

  // 地图属性
  const propSec = section('地图属性');
  propSec.appendChild(field('地图名称', { value: map.name, onChange: v => map.name = v }));
  propSec.appendChild(numberField('宽度', {
    value: map.width, min: 5, max: 60,
    onChange: v => {
      const newW = Math.max(5, Math.min(60, parseInt(v) || map.width));
      if (newW === map.width) return;
      map.grid = resizeGrid(map.grid, newW, map.height, selectedTileKey);
      map.width = newW;
      refresh();
    },
  }));
  propSec.appendChild(numberField('高度', {
    value: map.height, min: 5, max: 60,
    onChange: v => {
      const newH = Math.max(5, Math.min(60, parseInt(v) || map.height));
      if (newH === map.height) return;
      map.grid = resizeGrid(map.grid, map.width, newH, selectedTileKey);
      map.height = newH;
      refresh();
    },
  }));
  propSec.appendChild(numberField('显示半径（迷雾）', {
    value: map.revealRadius || 3, min: 1, max: 10,
    onChange: v => map.revealRadius = parseInt(v),
  }));
  panel.appendChild(propSec);

  // POI 列表
  map.pointsOfInterest = map.pointsOfInterest || [];
  const poiSec = section(`POI (${map.pointsOfInterest.length})`);
  for (let i = 0; i < map.pointsOfInterest.length; i++) {
    const poi = map.pointsOfInterest[i];
    const row = document.createElement('div');
    row.className = 'map-editor__poi-row';
    row.innerHTML = `
      <input type="text" class="input" placeholder="ID" value="${poi.id || ''}">
      <input type="text" class="input" placeholder="名称" value="${poi.name || ''}">
      <input type="number" class="input" placeholder="x" value="${poi.x}" min="0" max="${map.width - 1}" style="width:50px">
      <input type="number" class="input" placeholder="y" value="${poi.y}" min="0" max="${map.height - 1}" style="width:50px">
      <button class="btn btn--danger">×</button>
    `;
    const [idIn, nameIn, xIn, yIn, delBtn] = Array.from(row.children);
    idIn.addEventListener('input', () => { poi.id = idIn.value; });
    nameIn.addEventListener('input', () => { poi.name = nameIn.value; });
    xIn.addEventListener('change', () => { poi.x = parseInt(xIn.value); refresh(); });
    yIn.addEventListener('change', () => { poi.y = parseInt(yIn.value); refresh(); });
    delBtn.addEventListener('click', () => { map.pointsOfInterest.splice(i, 1); refresh(); });
    poiSec.appendChild(row);

    // type + linkedEvent
    const extra = document.createElement('div');
    extra.className = 'map-editor__poi-extra';
    extra.innerHTML = `
      <input type="text" class="input" placeholder="type (spawn/village/dungeon...)" value="${poi.type || ''}">
      <input type="text" class="input" placeholder="linkedEventId (留空=无)" value="${poi.linkedEventId || ''}">
    `;
    const [typeIn, linkedIn] = Array.from(extra.children);
    typeIn.addEventListener('input', () => { poi.type = typeIn.value; });
    linkedIn.addEventListener('input', () => { poi.linkedEventId = linkedIn.value || null; });
    poiSec.appendChild(extra);
  }
  const addPoiBtn = document.createElement('button');
  addPoiBtn.className = 'btn';
  addPoiBtn.textContent = '+ 新增 POI';
  addPoiBtn.addEventListener('click', () => {
    map.pointsOfInterest.push({
      id: uniqueId('poi', map.pointsOfInterest),
      x: Math.floor(map.width / 2), y: Math.floor(map.height / 2),
      name: '新 POI', type: '', linkedEventId: null,
    });
    refresh();
  });
  poiSec.appendChild(addPoiBtn);
  panel.appendChild(poiSec);

  return panel;
}

function renderCanvas(map, refresh) {
  const canvas = document.createElement('canvas');
  canvas.className = 'map-editor__canvas';
  canvas.width = map.width * TILE_PIXEL_SIZE;
  canvas.height = map.height * TILE_PIXEL_SIZE;

  const ctx = canvas.getContext('2d');
  drawMap(ctx, map);

  // 把 cell 坐标从鼠标位置转换
  const cellFromEvent = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / TILE_PIXEL_SIZE);
    const y = Math.floor((e.clientY - rect.top) / TILE_PIXEL_SIZE);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    return { x, y };
  };

  // 绘制 / POI 添加
  const handleClick = (e) => {
    const cell = cellFromEvent(e);
    if (!cell) return;

    if (selectedTool === 'paint') {
      paintCell(map, cell.x, cell.y, selectedTileKey);
      drawMap(ctx, map);
    } else if (selectedTool === 'poi') {
      // 在该位置新建 POI
      map.pointsOfInterest.push({
        id: uniqueId('poi', map.pointsOfInterest),
        x: cell.x, y: cell.y, name: '新 POI', type: '', linkedEventId: null,
      });
      refresh();
    }
  };

  canvas.addEventListener('mousedown', (e) => {
    if (selectedTool === 'paint') {
      isPainting = true;
      handleClick(e);
    } else {
      handleClick(e);
    }
  });
  canvas.addEventListener('mousemove', (e) => {
    if (selectedTool === 'paint' && isPainting) {
      const cell = cellFromEvent(e);
      if (cell) {
        paintCell(map, cell.x, cell.y, selectedTileKey);
        drawMap(ctx, map);
      }
    }
  });
  const stopPaint = () => { isPainting = false; };
  canvas.addEventListener('mouseup', stopPaint);
  canvas.addEventListener('mouseleave', stopPaint);

  return canvas;
}

function paintCell(map, x, y, key) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
  const row = map.grid[y];
  if (!row) return;
  map.grid[y] = row.substring(0, x) + key + row.substring(x + 1);
}

function drawMap(ctx, map) {
  const size = TILE_PIXEL_SIZE;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const key = map.grid[y][x];
      const def = map.tileTypes[key];
      ctx.fillStyle = def ? def.color : '#666';
      ctx.fillRect(x * size, y * size, size, size);
      // 网格线
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.strokeRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1);
      // 瓦片字母
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key, x * size + size / 2, y * size + size / 2);
    }
  }
  // 绘制 POI
  for (const poi of (map.pointsOfInterest || [])) {
    const cx = poi.x * size + size / 2;
    const cy = poi.y * size + size / 2;
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText('★', cx, cy);
  }
}

function resizeGrid(grid, newW, newH, fillKey) {
  const result = [];
  for (let y = 0; y < newH; y++) {
    const oldRow = grid[y] || '';
    let newRow = '';
    for (let x = 0; x < newW; x++) {
      newRow += oldRow[x] || fillKey;
    }
    result.push(newRow);
  }
  return result;
}

function defaultTileTypes() {
  return {
    'G': { name: '草地', color: '#4a8c3f', walkable: true, moveCost: 1, image: '' },
    'T': { name: '树林', color: '#2d5a1e', walkable: true, moveCost: 2, image: '' },
    'W': { name: '水域', color: '#3366cc', walkable: false, moveCost: 99, image: '' },
    'M': { name: '山地', color: '#8b7355', walkable: false, moveCost: 99, image: '' },
    'R': { name: '道路', color: '#c4a35a', walkable: true, moveCost: 0.5, image: '' },
    'V': { name: '村庄', color: '#d4a574', walkable: true, moveCost: 1, image: '' },
    'D': { name: '地城入口', color: '#4a0000', walkable: true, moveCost: 1, image: '' },
    'S': { name: '起点', color: '#ffcc00', walkable: true, moveCost: 1, image: '' },
  };
}
