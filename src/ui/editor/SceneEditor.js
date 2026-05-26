/**
 * 场景图编辑器
 * 场景节点列表（左）+ 节点详情/连接/事件挂载（右）
 *
 * 与 grid 地图编辑器不同：这里没有画布，全部走表单 — 节点 + 边的图状结构
 * 用列表编辑更清晰。坐标只是给可视化定位用，作者可以自由填。
 */

import { field, numberField, selectField, section, listFormLayout, uniqueId } from './_helpers.js';

const SCENE_TYPES = [
  { value: 'spawn', label: '🚩 起点' },
  { value: 'settlement', label: '🏘 居所/村庄' },
  { value: 'wilderness', label: '🌲 旷野' },
  { value: 'combat', label: '⚔ 战斗场' },
  { value: 'dungeon', label: '🚪 地城/试炼' },
  { value: 'vignette', label: '✨ 小景' },
  { value: 'ending', label: '🌅 结局' },
];

let selectedSceneIdx = 0;

export function renderSceneEditor(container, preset, refresh) {
  // 确保 scenes 数组存在
  if (!Array.isArray(preset.scenes)) preset.scenes = [];

  // 自动启用场景图显示模式（如果有节点）
  if (preset.scenes.length > 0 && !preset.displayMode) {
    preset.displayMode = 'scene-graph';
  }

  // 校正选中索引
  if (selectedSceneIdx >= preset.scenes.length) selectedSceneIdx = Math.max(0, preset.scenes.length - 1);

  const root = document.createElement('div');
  root.className = 'scene-editor';

  // 顶部：displayMode / startingSceneId / 整体统计
  const topBar = document.createElement('div');
  topBar.className = 'scene-editor__top';

  topBar.appendChild(selectField('地图显示模式', {
    value: preset.displayMode || 'scene-graph',
    options: [
      { value: 'scene-graph', label: '场景图（推荐）' },
      { value: 'grid', label: '格子地图（旧）' },
      { value: 'hybrid', label: '混合（场景图叠在格子上）' },
    ],
    onChange: (v) => {
      preset.displayMode = v;
      refresh();
    },
  }));

  topBar.appendChild(selectField('起始场景', {
    value: preset.startingSceneId || '',
    options: [
      { value: '', label: '（自动用第一个）' },
      ...preset.scenes.map(s => ({ value: s.id, label: `${s.icon || '📍'} ${s.name} (${s.id})` })),
    ],
    onChange: (v) => { preset.startingSceneId = v || null; },
  }));

  const stats = document.createElement('div');
  stats.className = 'scene-editor__stats';
  const edgeCount = preset.scenes.reduce((acc, s) => acc + (s.connections || []).length, 0);
  const gatedCount = preset.scenes.reduce((acc, s) => acc + (s.connections || []).filter(c => c.gated).length, 0);
  stats.innerHTML = `节点: <b>${preset.scenes.length}</b> · 边: <b>${edgeCount}</b> · 门控: <b>${gatedCount}</b>`;
  topBar.appendChild(stats);

  root.appendChild(topBar);

  // 主体：列表 + 表单
  listFormLayout(root, {
    title: '场景节点',
    items: preset.scenes,
    selectedIndex: selectedSceneIdx,
    getLabel: (s) => `${s.icon || '📍'} ${s.name || s.id || '?'}`,
    onSelect: (i) => { selectedSceneIdx = i; refresh(); },
    onAdd: () => {
      const newScene = {
        id: uniqueId('scene', preset.scenes),
        name: '新场景',
        type: 'wilderness',
        icon: '🌿',
        description: '',
        coords: { x: (preset.scenes.length % 6) * 2, y: Math.floor(preset.scenes.length / 6) * 2 },
        connections: [],
        events: [],
        vignettes: [],
        tags: [],
      };
      preset.scenes.push(newScene);
      selectedSceneIdx = preset.scenes.length - 1;
      if (!preset.startingSceneId) preset.startingSceneId = newScene.id;
      refresh();
    },
    onDelete: (i) => {
      const removed = preset.scenes[i];
      preset.scenes.splice(i, 1);
      // 清理别处对它的引用
      for (const s of preset.scenes) {
        s.connections = (s.connections || []).filter(c => c.to !== removed.id);
      }
      if (preset.startingSceneId === removed.id) {
        preset.startingSceneId = preset.scenes[0]?.id || null;
      }
      if (selectedSceneIdx >= preset.scenes.length) selectedSceneIdx = preset.scenes.length - 1;
      refresh();
    },
    renderForm: (form, scene) => renderSceneForm(form, scene, preset, refresh),
  });

  container.appendChild(root);
}

function renderSceneForm(form, scene, preset, refresh) {
  // === 基本信息 ===
  const basicSec = section('基本信息');

  basicSec.appendChild(field('ID', {
    value: scene.id || '',
    hint: '场景唯一 ID，建议格式 scene_xxx。改 ID 会自动同步所有引用',
    onChange: (v) => {
      const oldId = scene.id;
      const newId = v.trim();
      if (!newId || newId === oldId) return;
      // 同步所有 connections.to 和 events.trigger.condition.inScene
      for (const s of preset.scenes) {
        for (const c of (s.connections || [])) {
          if (c.to === oldId) c.to = newId;
        }
      }
      for (const ev of (preset.events || [])) {
        const inScene = ev.trigger?.condition?.inScene;
        if (Array.isArray(inScene)) {
          ev.trigger.condition.inScene = inScene.map(id => id === oldId ? newId : id);
        }
      }
      if (preset.startingSceneId === oldId) preset.startingSceneId = newId;
      scene.id = newId;
    },
  }));

  basicSec.appendChild(field('名称', {
    value: scene.name || '',
    hint: '玩家可见的场景名（locked-unvisited 时会被替换为 ???）',
    onChange: (v) => { scene.name = v; refresh(); },
  }));

  basicSec.appendChild(selectField('类型', {
    value: scene.type || 'wilderness',
    options: SCENE_TYPES,
    onChange: (v) => { scene.type = v; refresh(); },
  }));

  basicSec.appendChild(field('图标 (emoji)', {
    value: scene.icon || '',
    placeholder: '🏘 / 🌲 / ⚔ 等单字符 emoji',
    onChange: (v) => { scene.icon = v; refresh(); },
  }));

  basicSec.appendChild(field('描述', {
    value: scene.description || '',
    multiline: true, rows: 3,
    placeholder: 'AI 抵达时的写作素材，建议 30-80 字',
    hint: '首次抵达时 AI 会基于这段做出气氛叙事',
    onChange: (v) => { scene.description = v; },
  }));

  const coordsRow = document.createElement('div');
  coordsRow.className = 'editor-row-2';
  if (!scene.coords) scene.coords = { x: 0, y: 0 };
  coordsRow.appendChild(numberField('坐标 X', {
    value: scene.coords.x ?? 0,
    onChange: (v) => { scene.coords.x = parseInt(v) || 0; },
  }));
  coordsRow.appendChild(numberField('坐标 Y', {
    value: scene.coords.y ?? 0,
    onChange: (v) => { scene.coords.y = parseInt(v) || 0; },
  }));
  basicSec.appendChild(coordsRow);

  basicSec.appendChild(field('标签（逗号分隔）', {
    value: (scene.tags || []).join(', '),
    placeholder: 'main, safe, shop, boss ...',
    onChange: (v) => { scene.tags = v.split(',').map(s => s.trim()).filter(Boolean); },
  }));

  form.appendChild(basicSec);

  // === 连接（出边）===
  const connSec = section('出边连接');
  const addConnBtn = document.createElement('button');
  addConnBtn.className = 'btn';
  addConnBtn.textContent = '+ 添加出边';
  addConnBtn.addEventListener('click', () => {
    scene.connections = scene.connections || [];
    const other = preset.scenes.find(s => s.id !== scene.id);
    scene.connections.push({
      to: other ? other.id : '',
      label: '前往',
    });
    refresh();
  });
  connSec.appendChild(addConnBtn);

  scene.connections = scene.connections || [];
  scene.connections.forEach((conn, idx) => {
    const block = document.createElement('div');
    block.className = 'scene-editor__conn';

    block.appendChild(selectField('指向场景', {
      value: conn.to || '',
      options: [
        { value: '', label: '（未设置）' },
        ...preset.scenes.filter(s => s.id !== scene.id).map(s => ({ value: s.id, label: `${s.icon || '📍'} ${s.name}` })),
      ],
      onChange: (v) => { conn.to = v; refresh(); },
    }));

    block.appendChild(field('按钮文案', {
      value: conn.label || '',
      placeholder: '沿古道南下 / 钻进密林 ...',
      hint: '玩家在终端卡和场景图上看到的连接描述',
      onChange: (v) => { conn.label = v; },
    }));

    // 门控
    const gatedSec = document.createElement('div');
    gatedSec.className = 'scene-editor__gated';
    const gatedToggle = document.createElement('label');
    gatedToggle.className = 'scene-editor__gated-toggle';
    const gatedCheck = document.createElement('input');
    gatedCheck.type = 'checkbox';
    gatedCheck.checked = !!conn.gated;
    gatedCheck.addEventListener('change', () => {
      if (gatedCheck.checked) {
        conn.gated = conn.gated || { hint: '' };
      } else {
        delete conn.gated;
      }
      refresh();
    });
    gatedToggle.appendChild(gatedCheck);
    gatedToggle.appendChild(document.createTextNode(' 启用门控'));
    gatedSec.appendChild(gatedToggle);

    if (conn.gated) {
      gatedSec.appendChild(field('诗意提示（hint）', {
        value: conn.gated.hint || '',
        placeholder: '前方阴气逼人，你们还不知道那里隐藏着什么',
        hint: '玩家看到的锁定原因；不写会用通用文案兜底（不会泄露内部 key）',
        onChange: (v) => { conn.gated.hint = v; },
      }));
      gatedSec.appendChild(field('要求变量（JSON, 如 {"quest_received": true}）', {
        value: JSON.stringify(conn.gated.requireVariables || {}),
        placeholder: '{"knows_dark_knight": true}',
        onChange: (v) => {
          try { conn.gated.requireVariables = JSON.parse(v); } catch { /* 容错 */ }
        },
      }));
      gatedSec.appendChild(field('要求已完成事件（逗号分隔 ID）', {
        value: (conn.gated.requireCompletedEvents || []).join(', '),
        placeholder: 'ch3_village, ch5_wolves',
        onChange: (v) => { conn.gated.requireCompletedEvents = v.split(',').map(s => s.trim()).filter(Boolean); },
      }));
      gatedSec.appendChild(field('要求物品 ID（逗号分隔）', {
        value: (conn.gated.requireItems || []).join(', '),
        placeholder: 'item_013, item_008',
        onChange: (v) => { conn.gated.requireItems = v.split(',').map(s => s.trim()).filter(Boolean); },
      }));
    }
    block.appendChild(gatedSec);

    const delConnBtn = document.createElement('button');
    delConnBtn.className = 'btn btn--ghost';
    delConnBtn.textContent = '删除此出边';
    delConnBtn.addEventListener('click', () => {
      scene.connections.splice(idx, 1);
      refresh();
    });
    block.appendChild(delConnBtn);

    connSec.appendChild(block);
  });
  form.appendChild(connSec);

  // === 挂载事件 ===
  const evSec = section('挂载事件（抵达时按 priority 触发）');
  scene.events = scene.events || [];
  const eventChoices = (preset.events || []).map(e => ({ id: e.id, name: e.name, priority: e.priority || 0 }));

  const evList = document.createElement('div');
  evList.className = 'scene-editor__event-list';
  scene.events.forEach((eid, idx) => {
    const row = document.createElement('div');
    row.className = 'scene-editor__event-row';
    const meta = eventChoices.find(e => e.id === eid);
    row.innerHTML = `<span>${meta ? `${meta.name} (priority ${meta.priority})` : `<i>${eid} - 不存在的事件</i>`}</span>`;
    const del = document.createElement('button');
    del.className = 'btn btn--ghost btn--small';
    del.textContent = '移除';
    del.addEventListener('click', () => {
      scene.events.splice(idx, 1);
      refresh();
    });
    row.appendChild(del);
    evList.appendChild(row);
  });
  evSec.appendChild(evList);

  const evSelect = document.createElement('select');
  evSelect.className = 'editor-field__input input';
  evSelect.innerHTML = '<option value="">+ 选择事件添加</option>'
    + eventChoices.filter(e => !scene.events.includes(e.id))
        .map(e => `<option value="${e.id}">${e.name} (${e.id})</option>`).join('');
  evSelect.addEventListener('change', () => {
    if (evSelect.value) {
      scene.events.push(evSelect.value);
      refresh();
    }
  });
  evSec.appendChild(evSelect);
  form.appendChild(evSec);

  // === Vignettes ===
  const vigSec = section('重访短叙事（vignettes，无 AI 调用）');
  scene.vignettes = scene.vignettes || [];
  const vigList = document.createElement('div');
  vigList.className = 'scene-editor__vignette-list';
  scene.vignettes.forEach((v, idx) => {
    const row = document.createElement('div');
    row.className = 'scene-editor__vignette-row';
    const input = document.createElement('textarea');
    input.className = 'editor-field__input input';
    input.rows = 2;
    input.value = v;
    input.addEventListener('change', () => { scene.vignettes[idx] = input.value; });
    row.appendChild(input);
    const del = document.createElement('button');
    del.className = 'btn btn--ghost btn--small';
    del.textContent = '×';
    del.addEventListener('click', () => {
      scene.vignettes.splice(idx, 1);
      refresh();
    });
    row.appendChild(del);
    vigList.appendChild(row);
  });
  vigSec.appendChild(vigList);

  const addVigBtn = document.createElement('button');
  addVigBtn.className = 'btn';
  addVigBtn.textContent = '+ 添加 vignette';
  addVigBtn.addEventListener('click', () => {
    scene.vignettes.push('');
    refresh();
  });
  vigSec.appendChild(addVigBtn);

  form.appendChild(vigSec);
}
