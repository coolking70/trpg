#!/usr/bin/env node
/**
 * TRPG 预设编辑 MCP 服务器
 *
 * 暴露一套结构化工具，让 Claude（或任何 MCP 客户端）可以**批量、精细化**地
 * 生成 / 修改 TRPG 预设。AI 可以快速搭建出整套世界、角色、敌人、事件、场景图。
 *
 * 启动方式：
 *   node mcp-server/preset-server.mjs [预设文件路径]
 *
 * 如不提供路径，默认在当前工作目录创建 `preset-draft.json`。
 *
 * Claude Desktop / Claude Code 配置示例：
 *   {
 *     "mcpServers": {
 *       "trpg-preset": {
 *         "command": "node",
 *         "args": ["/abs/path/to/trpg/mcp-server/preset-server.mjs",
 *                  "/abs/path/to/preset-draft.json"]
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

// 默认目标文件
const DEFAULT_FILE = path.resolve(process.cwd(), 'preset-draft.json');
const filePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE;

// ============================================================
// 内存中的预设
// ============================================================
let preset = createEmptyPreset();
let dirty = false;

function createEmptyPreset() {
  return {
    version: '1.0.0',
    presetId: 'preset_' + Date.now().toString(36),
    name: '新预设',
    author: '',
    createdAt: new Date().toISOString(),
    description: '',
    lore: { worldName: '', era: '', background: '', rules: '', gmStyle: '' },
    characters: [],
    enemies: [],
    items: [],
    events: [],
    scenes: [],
    npcs: [],                       // Phase 19B
    startingOptions: null,          // Phase 19A
    startingSceneRules: [],         // Phase 19A
    combatMode: 'party',            // Phase 19
    aiHooks: {                      // Phase 19
      sceneArrival: 'optional', eventResolve: 'optional', npcDialogue: 'optional',
      vignette: 'never', worldRipple: 'optional',
    },
    startingSceneId: null,
    displayMode: 'scene-graph',
    rules: { diceType: 'd20', combatFormula: '(attack + dice) - defense', maxPartySize: 4, startingGold: 100 },
    aiConfig: { temperature: 0.7, maxResponseTokens: 1000, useStructuredOutput: true, language: 'zh-CN' },
  };
}

function loadFromDisk() {
  if (fs.existsSync(filePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      preset = { ...createEmptyPreset(), ...raw };
      ensureArrays();
      return true;
    } catch (e) {
      console.error('[mcp] 加载预设失败:', e.message);
    }
  }
  return false;
}

function saveToDisk() {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(preset, null, 2), 'utf-8');
  dirty = false;
}

function ensureArrays() {
  preset.characters ||= [];
  preset.enemies ||= [];
  preset.items ||= [];
  preset.events ||= [];
  preset.scenes ||= [];
  preset.npcs ||= [];
  preset.startingSceneRules ||= [];
}

function ok(text) {
  if (dirty) saveToDisk();
  return { content: [{ type: 'text', text }] };
}
function err(text) {
  return { content: [{ type: 'text', text: `❌ ${text}` }], isError: true };
}
function findById(arr, id) { return arr.find(x => x.id === id); }
function findIdx(arr, id) { return arr.findIndex(x => x.id === id); }
function genId(prefix, existing) {
  const used = new Set(existing.map(x => x.id));
  let i = existing.length + 1;
  let id;
  do { id = `${prefix}_${String(i).padStart(3, '0')}`; i++; } while (used.has(id));
  return id;
}

function effectSetsVariable(effect, name, value) {
  return effect?.type === 'set_variable' && effect.name === name && effect.value === value;
}

function outcomeSetsVariable(outcome, name, value) {
  return (outcome.effects || []).some(effect => effectSetsVariable(effect, name, value));
}

function outcomeAddsItem(outcome, itemId) {
  return (outcome.effects || []).some(effect => effect?.type === 'add_item' && effect.itemId === itemId);
}

function collectSceneEvents(scene) {
  const ids = new Set(scene.events || []);
  for (const ev of preset.events) {
    const inScene = ev.trigger?.condition?.inScene;
    if (Array.isArray(inScene) && inScene.includes(scene.id)) ids.add(ev.id);
  }
  return [...ids].map(id => findById(preset.events, id)).filter(Boolean);
}

// ============================================================
// 校验
// ============================================================
function validatePreset() {
  const errs = [];
  if (!preset.name) errs.push('name 为空');
  if (preset.characters.length === 0) errs.push('至少需要一个角色');

  const sceneIds = new Set(preset.scenes.map(s => s.id));
  const eventIds = new Set(preset.events.map(e => e.id));
  const itemIds = new Set(preset.items.map(i => i.id));
  const enemyIds = new Set(preset.enemies.map(e => e.id));

  if (preset.scenes.length > 0) {
    if (preset.startingSceneId && !sceneIds.has(preset.startingSceneId)) {
      errs.push(`startingSceneId 不存在: ${preset.startingSceneId}`);
    }
    for (const s of preset.scenes) {
      for (const c of (s.connections || [])) {
        if (!sceneIds.has(c.to)) errs.push(`场景 ${s.id} 连接到不存在的 ${c.to}`);
      }
      for (const eid of (s.events || [])) {
        if (!eventIds.has(eid)) errs.push(`场景 ${s.id} 引用了不存在的事件 ${eid}`);
      }
    }
  }

  for (const ev of preset.events) {
    const inScene = ev.trigger?.condition?.inScene;
    if (Array.isArray(inScene)) {
      for (const sid of inScene) {
        if (!sceneIds.has(sid)) errs.push(`事件 ${ev.id} 的 inScene 指向不存在的场景 ${sid}`);
      }
    }
    for (const ch of (ev.choices || [])) {
      for (const oc of (ch.outcomes || [])) {
        for (const eff of (oc.effects || [])) {
          if (eff.type === 'start_combat') {
            for (const enid of (eff.enemyIds || [])) {
              if (!enemyIds.has(enid)) errs.push(`事件 ${ev.id} start_combat 引用不存在的敌人 ${enid}`);
            }
          }
          if (eff.type === 'add_item' && eff.itemId && !itemIds.has(eff.itemId)) {
            errs.push(`事件 ${ev.id} add_item 引用不存在的物品 ${eff.itemId}`);
          }
        }
      }
    }
  }

  for (const en of preset.enemies) {
    for (const loot of (en.lootTable || [])) {
      if (!itemIds.has(loot.itemId)) errs.push(`敌人 ${en.id} 掉落表引用不存在的物品 ${loot.itemId}`);
    }
  }

  if (preset.map?.grid) {
    const rowLengths = new Set(preset.map.grid.map(row => row.length));
    if (rowLengths.size > 1) {
      errs.push(`地图 grid 行宽不一致: ${[...rowLengths].join(', ')}`);
    } else if (preset.map.width !== undefined && !rowLengths.has(preset.map.width)) {
      errs.push(`地图 width=${preset.map.width} 与 grid 行宽 ${[...rowLengths][0]} 不一致`);
    }
    if (preset.map.height !== undefined && preset.map.grid.length !== preset.map.height) {
      errs.push(`地图 height=${preset.map.height} 与 grid 行数 ${preset.map.grid.length} 不一致`);
    }
  }

  for (const scene of preset.scenes) {
    const sceneEvents = collectSceneEvents(scene);
    for (const conn of (scene.connections || [])) {
      const gated = conn.gated || {};
      const requiredVariables = gated.requireVariables || {};
      for (const [name, value] of Object.entries(requiredVariables)) {
        for (const ev of sceneEvents) {
          for (const choice of (ev.choices || [])) {
            const outcomes = choice.outcomes || [];
            const matching = outcomes.filter(outcome => outcomeSetsVariable(outcome, name, value));
            if (matching.length > 0 && matching.length < outcomes.length) {
              errs.push(`场景 ${scene.id} → ${conn.to} 需要变量 ${name}=${JSON.stringify(value)}，但事件 ${ev.id} / 选择 ${choice.id} 只有部分 outcome 设置该变量`);
            }
          }
        }
      }

      for (const itemId of (gated.requireItems || [])) {
        for (const ev of sceneEvents) {
          for (const choice of (ev.choices || [])) {
            const outcomes = choice.outcomes || [];
            const matching = outcomes.filter(outcome => outcomeAddsItem(outcome, itemId));
            if (matching.length > 0 && matching.length < outcomes.length) {
              errs.push(`场景 ${scene.id} → ${conn.to} 需要物品 ${itemId}，但事件 ${ev.id} / 选择 ${choice.id} 只有部分 outcome 添加该物品`);
            }
          }
        }
      }
    }
  }

  return errs;
}

// ============================================================
// 设计模式分析辅助（给 preset_analyze 和 scene_create 用）
// ============================================================

/** 找一个不与现有场景冲突的坐标（螺旋向外搜索） */
function pickFreeCoord(preset, prefer) {
  const used = new Set(preset.scenes.map(s => `${s.coords?.x},${s.coords?.y}`));
  // 先尝试 prefer，不冲突就用
  if (prefer && !used.has(`${prefer.x},${prefer.y}`)) return prefer;
  // 否则从现有 bounding box 的最大 x 之后向外扩
  let baseX = 0, baseY = 0;
  if (preset.scenes.length > 0) {
    baseX = Math.max(...preset.scenes.map(s => s.coords?.x ?? 0)) + 2;
    baseY = Math.round(preset.scenes.reduce((acc, s) => acc + (s.coords?.y ?? 0), 0) / preset.scenes.length);
  }
  // 网格螺旋
  for (let r = 0; r < 50; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = baseX + dx, y = baseY + dy;
        if (y < 0) continue;
        if (!used.has(`${x},${y}`)) return { x, y };
      }
    }
  }
  return { x: baseX, y: baseY };
}

/** BFS 从起点找可达场景 */
function reachableScenes(preset) {
  const start = preset.startingSceneId || preset.scenes[0]?.id;
  if (!start) return new Set();
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    const scene = findById(preset.scenes, cur);
    for (const c of (scene?.connections || [])) {
      if (!visited.has(c.to)) { visited.add(c.to); queue.push(c.to); }
    }
  }
  return visited;
}

/** 找坐标冲突 */
function findCoordCollisions(preset) {
  const map = new Map();
  for (const s of preset.scenes) {
    const k = `${s.coords?.x},${s.coords?.y}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s.id);
  }
  return [...map.entries()].filter(([, ids]) => ids.length > 1)
    .map(([coord, ids]) => ({ coord, scenes: ids }));
}

/** 找单向连接（A→B 存在但 B→A 不存在）*/
function findOneWayConnections(preset) {
  const out = [];
  for (const s of preset.scenes) {
    for (const c of (s.connections || [])) {
      const dest = findById(preset.scenes, c.to);
      const hasReturn = (dest?.connections || []).some(rc => rc.to === s.id);
      if (!hasReturn) out.push({ from: s.id, to: c.to, label: c.label });
    }
  }
  return out;
}

/** 找"设了但没人引用"和"被引用但没人设"的变量 */
function findVariableMismatch(preset) {
  const setBy = new Map();   // var → events that set it
  const reqBy = new Map();   // var → places that require it
  for (const ev of preset.events) {
    for (const ch of (ev.choices || [])) for (const oc of (ch.outcomes || [])) for (const eff of (oc.effects || [])) {
      if (eff.type === 'set_variable' && eff.name) {
        if (!setBy.has(eff.name)) setBy.set(eff.name, []);
        setBy.get(eff.name).push(ev.id);
      }
    }
    for (const v of Object.keys(ev.trigger?.condition?.requireVariables || {})) {
      if (!reqBy.has(v)) reqBy.set(v, []);
      reqBy.get(v).push(`event:${ev.id}`);
    }
  }
  for (const s of preset.scenes) {
    for (const c of (s.connections || [])) {
      for (const v of Object.keys(c.gated?.requireVariables || {})) {
        if (!reqBy.has(v)) reqBy.set(v, []);
        reqBy.get(v).push(`conn:${s.id}→${c.to}`);
      }
    }
  }
  const setButUnused = [...setBy.keys()].filter(v => !reqBy.has(v));
  const reqButUnset = [...reqBy.keys()].filter(v => !setBy.has(v));
  return { setButUnused, reqButUnset };
}

/** 主线推进模拟（贪心：每轮跑所有当前可跑的 main 事件，每事件选第一个 outcome） */
function simulateMainQuest(preset) {
  const vars = {};
  const completed = new Set();
  const log = [];

  // 候选：所有带 'main' 标签的事件；没有 'main' 标签就用全部
  let candidates = preset.events.filter(e => (e.tags || []).includes('main'));
  if (candidates.length === 0) candidates = [...preset.events];

  const canRun = (ev) => {
    if (completed.has(ev.id)) return false;
    const cond = ev.trigger?.condition || {};
    for (const [k, v] of Object.entries(cond.requireVariables || {})) {
      if (vars[k] !== v) return false;
    }
    for (const reqE of (cond.requireCompletedEvents || [])) {
      if (!completed.has(reqE)) return false;
    }
    if ((cond.excludeCompletedEvents || []).some(e => completed.has(e))) return false;
    return true;
  };

  // 反复跑直到没人能再跑
  for (let round = 0; round < 100; round++) {
    const runnable = candidates.filter(canRun);
    if (runnable.length === 0) break;
    // 每轮挑 priority 最高的先跑（与游戏运行时一致）
    runnable.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const ev = runnable[0];
    const ch = ev.choices?.[0];
    if (ch?.outcomes?.[0]?.effects) {
      for (const eff of ch.outcomes[0].effects) {
        if (eff.type === 'set_variable') vars[eff.name] = eff.value;
      }
    }
    completed.add(ev.id);
    log.push({ event: ev.id, status: 'completed' });
  }

  // 剩下没跑通的报告卡点
  const stuck = candidates.filter(e => !completed.has(e.id));
  for (const ev of stuck) {
    const cond = ev.trigger?.condition || {};
    const missing = [
      ...Object.entries(cond.requireVariables || {})
        .filter(([k, v]) => vars[k] !== v)
        .map(([k, v]) => `var ${k}=${JSON.stringify(v)}`),
      ...(cond.requireCompletedEvents || [])
        .filter(e => !completed.has(e))
        .map(e => `event ${e}`),
      ...(cond.excludeCompletedEvents || [])
        .filter(e => completed.has(e))
        .map(e => `exclude:${e} 已完成`),
    ];
    log.push({ event: ev.id, status: 'blocked', missing });
  }

  return { log, finalVars: vars, completed: [...completed] };
}

// ============================================================
// 工具实现（纯函数，方便 batch_apply 复用）
// ============================================================
const tools = {};

// ---------- 预设元 ----------
tools.preset_load = {
  title: '加载预设',
  description: '从磁盘加载当前文件路径的预设到内存。如果文件不存在则创建空预设。',
  schema: {},
  handler: async () => {
    const loaded = loadFromDisk();
    return ok(loaded
      ? `已从 ${filePath} 加载预设：${preset.name}（${preset.scenes.length} 节点 / ${preset.events.length} 事件 / ${preset.characters.length} 角色）`
      : `${filePath} 不存在，已初始化空预设`);
  },
};

tools.preset_save = {
  title: '保存预设',
  description: '把内存中的预设写入磁盘。',
  schema: {},
  handler: async () => { saveToDisk(); return ok(`已保存到 ${filePath}`); },
};

tools.preset_info = {
  title: '查看预设概况',
  description: '返回预设的总览信息：名称、各项计数、displayMode、startingScene 等。',
  schema: {},
  handler: async () => ok(JSON.stringify({
    filePath, name: preset.name, presetId: preset.presetId,
    description: preset.description, displayMode: preset.displayMode,
    startingSceneId: preset.startingSceneId,
    counts: {
      scenes: preset.scenes.length, events: preset.events.length,
      characters: preset.characters.length, enemies: preset.enemies.length,
      items: preset.items.length,
    },
    lore: preset.lore,
  }, null, 2)),
};

tools.preset_set_meta = {
  title: '设置预设元信息',
  description: '更新顶层字段：name / description / author / displayMode / startingSceneId / lore.*。只写传入的字段。',
  schema: {
    name: z.string().optional(),
    description: z.string().optional(),
    author: z.string().optional(),
    displayMode: z.enum(['scene-graph', 'grid', 'hybrid']).optional(),
    startingSceneId: z.string().optional(),
    lore: z.object({
      worldName: z.string().optional(),
      era: z.string().optional(),
      background: z.string().optional(),
      rules: z.string().optional(),
      gmStyle: z.string().optional(),
    }).optional(),
  },
  handler: async (args) => {
    if (args.name !== undefined) preset.name = args.name;
    if (args.description !== undefined) preset.description = args.description;
    if (args.author !== undefined) preset.author = args.author;
    if (args.displayMode) preset.displayMode = args.displayMode;
    if (args.startingSceneId) preset.startingSceneId = args.startingSceneId;
    if (args.lore) Object.assign(preset.lore, args.lore);
    dirty = true;
    return ok('已更新预设元信息');
  },
};

tools.preset_validate = {
  title: '校验预设（引用完整性）',
  description: '只检查引用是否完整（场景连接 / 事件 inScene / 战斗 enemyIds / 物品引用 / 掉落表）。**更全面的体检请用 preset_analyze**。',
  schema: {},
  handler: async () => {
    const errs = validatePreset();
    if (errs.length === 0) return ok('✓ 校验通过，没有发现引用错误');
    return ok(`发现 ${errs.length} 个问题：\n${errs.map(e => '  - ' + e).join('\n')}`);
  },
};

tools.preset_analyze = {
  title: '全面体检预设（强烈建议生成完整剧本后调用）',
  description: '运行 8 项深度检查并输出报告：\n  1. 引用完整性\n  2. 坐标冲突（节点重叠）\n  3. 节点可达性（从 startingScene BFS）\n  4. 单向连接（A→B 没有 B→A）\n  5. 变量定义/引用对照（设了不用 / 用了没设）\n  6. 主线推进模拟（每章按第一个 outcome 走，看能否打通）\n  7. 角色装备完整性（武器/防具/技能数）\n  8. gated.hint 是否泄露内部 key\n返回每项的状态 + 严重度（❌ 必修 / ⚠ 建议 / ✓ 通过）。',
  schema: {},
  handler: async () => {
    const lines = ['╔══════ 预设全面体检报告 ══════╗', ''];
    let critical = 0, warn = 0;

    // 1. 引用完整性
    const refErrs = validatePreset();
    lines.push(`【1】引用完整性: ${refErrs.length === 0 ? '✓ 通过' : `❌ ${refErrs.length} 个错误`}`);
    if (refErrs.length > 0) { critical += refErrs.length; refErrs.forEach(e => lines.push(`    - ${e}`)); }
    lines.push('');

    // 2. 坐标冲突
    const collisions = findCoordCollisions(preset);
    lines.push(`【2】坐标冲突: ${collisions.length === 0 ? '✓ 通过' : `❌ ${collisions.length} 组重叠`}`);
    if (collisions.length > 0) { critical += collisions.length; collisions.forEach(c => lines.push(`    - 坐标 (${c.coord}): ${c.scenes.join(', ')}`)); }
    lines.push('');

    // 3. 可达性
    const reach = reachableScenes(preset);
    const unreachable = preset.scenes.filter(s => !reach.has(s.id)).map(s => s.id);
    lines.push(`【3】节点可达性: ${unreachable.length === 0 ? `✓ 全部可达 (${reach.size}/${preset.scenes.length})` : `❌ ${unreachable.length} 节点不可达`}`);
    if (unreachable.length > 0) { critical += unreachable.length; lines.push(`    - 不可达: ${unreachable.join(', ')}`); }
    lines.push('');

    // 4. 单向连接
    const oneWay = findOneWayConnections(preset);
    lines.push(`【4】单向连接: ${oneWay.length === 0 ? '✓ 全部双向' : `⚠ ${oneWay.length} 条单向边（剧情合理可保留）`}`);
    if (oneWay.length > 0) { warn += oneWay.length; oneWay.forEach(w => lines.push(`    - ${w.from} → ${w.to}（"${w.label || '无 label'}"）`)); }
    lines.push('');

    // 5. 变量对照
    const { setButUnused, reqButUnset } = findVariableMismatch(preset);
    const varProb = setButUnused.length + reqButUnset.length;
    lines.push(`【5】变量定义/引用: ${varProb === 0 ? '✓ 对齐' : `⚠ 设了不用 ${setButUnused.length} 个 / 用了没设 ${reqButUnset.length} 个`}`);
    if (reqButUnset.length > 0) { critical += reqButUnset.length; lines.push(`    ❌ 被引用但从未设置（玩家永远过不去这道门）: ${reqButUnset.join(', ')}`); }
    if (setButUnused.length > 0) { warn += setButUnused.length; lines.push(`    ⚠ 设了但没人用: ${setButUnused.join(', ')}`); }
    lines.push('');

    // 6. 主线推进模拟（贪心循环）
    const sim = simulateMainQuest(preset);
    const blockedList = sim.log.filter(l => l.status === 'blocked');
    const completedCount = sim.log.filter(l => l.status === 'completed').length;
    lines.push(`【6】主线推进模拟（每事件取第一个 outcome 贪心走）: ${blockedList.length === 0 ? `✓ 走通 ${completedCount} 个事件` : `⚠ ${completedCount} 已通 / ${blockedList.length} 卡住`}`);
    if (blockedList.length > 0) {
      warn += blockedList.length;  // 部分卡住可能是有意为之（多路径/概率分支），降级为警告
      for (const b of blockedList) {
        lines.push(`    - ${b.event} 卡住: ${(b.missing || []).join('; ')}`);
      }
      lines.push(`    （提示：第一个 outcome 概率<1 时下游事件可能"主路径"走不通，但其它 outcome 可能能通；这是常见的多分支设计）`);
    }
    lines.push('');

    // 7. 角色装备
    const charIssues = [];
    for (const c of preset.characters) {
      const probs = [];
      if (!c.equipment?.weapon) probs.push('无武器');
      if ((c.abilities || []).length === 0) probs.push('无技能');
      if (!c.stats?.hp) probs.push('无 HP');
      if (probs.length > 0) charIssues.push({ id: c.id, name: c.name, probs });
    }
    lines.push(`【7】角色装备完整性: ${charIssues.length === 0 ? '✓ 通过' : `⚠ ${charIssues.length} 角色有问题`}`);
    if (charIssues.length > 0) { warn += charIssues.length; charIssues.forEach(c => lines.push(`    - ${c.id} (${c.name}): ${c.probs.join(', ')}`)); }
    lines.push('');

    // 8. gated.hint 安全
    const setVarNames = new Set();
    for (const ev of preset.events) for (const ch of (ev.choices || [])) for (const oc of (ch.outcomes || [])) for (const eff of (oc.effects || [])) {
      if (eff.type === 'set_variable' && eff.name) setVarNames.add(eff.name);
    }
    const leaks = [];
    for (const s of preset.scenes) for (const c of (s.connections || [])) {
      if (c.gated?.hint) {
        for (const k of setVarNames) if (c.gated.hint.includes(k)) leaks.push(`${s.id}→${c.to}: "${c.gated.hint}" 含 ${k}`);
      }
    }
    lines.push(`【8】gated.hint 安全（不能含内部变量名）: ${leaks.length === 0 ? '✓ 通过' : `❌ ${leaks.length} 处泄露`}`);
    if (leaks.length > 0) { critical += leaks.length; leaks.forEach(l => lines.push(`    - ${l}`)); }
    lines.push('');

    // 总结
    lines.push('═════════════════════════════');
    if (critical === 0 && warn === 0) lines.push('✅ 全部通过！可以保存了。');
    else lines.push(`总计: ❌ ${critical} 必修 / ⚠ ${warn} 建议`);

    return ok(lines.join('\n'));
  },
};

tools.scene_relayout = {
  title: '自动重排所有场景坐标（解决坐标冲突）',
  description: '检测所有坐标冲突，把后出现的冲突节点挪到附近空位。返回挪动报告。',
  schema: {
    dryRun: z.boolean().default(false).describe('true=只报告不修改'),
  },
  handler: async (args) => {
    const collisions = findCoordCollisions(preset);
    if (collisions.length === 0) return ok('✓ 无坐标冲突，无需重排');

    const moves = [];
    for (const { coord, scenes } of collisions) {
      // 保留第一个，挪后续
      for (let i = 1; i < scenes.length; i++) {
        const id = scenes[i];
        const scene = findById(preset.scenes, id);
        if (!scene) continue;
        const oldCoord = { ...scene.coords };
        const newCoord = pickFreeCoord(preset, scene.coords);
        if (!args.dryRun) scene.coords = newCoord;
        moves.push(`${id}: (${oldCoord.x},${oldCoord.y}) → (${newCoord.x},${newCoord.y})`);
      }
    }
    if (!args.dryRun) dirty = true;
    return ok(`${args.dryRun ? '[预演]' : ''}已挪 ${moves.length} 个节点避开冲突：\n${moves.map(m => '  ' + m).join('\n')}`);
  },
};

tools.preset_export = {
  title: '导出完整预设 JSON',
  description: '返回完整的预设对象（JSON 字符串）。可拷贝到游戏的导入入口。',
  schema: {},
  handler: async () => ok(JSON.stringify(preset, null, 2)),
};

tools.preset_reset = {
  title: '重置预设',
  description: '清空当前内存预设。必须 confirm=true。',
  schema: { confirm: z.boolean().describe('必须为 true 才执行') },
  handler: async (args) => {
    if (!args.confirm) return err('需要 confirm=true 才能执行');
    preset = createEmptyPreset();
    dirty = true;
    return ok('已重置为空预设');
  },
};

// ---------- 场景图 ----------
tools.scene_list = {
  title: '列出所有场景',
  description: '返回场景图所有节点的概览。',
  schema: {},
  handler: async () => ok(JSON.stringify(preset.scenes.map(s => ({
    id: s.id, name: s.name, type: s.type, icon: s.icon, coords: s.coords,
    connectionCount: (s.connections || []).length,
    eventCount: (s.events || []).length,
    hasVignettes: (s.vignettes || []).length > 0,
    tags: s.tags || [],
  })), null, 2)),
};

tools.scene_get = {
  title: '查看单个场景',
  description: '返回某个场景的完整数据。',
  schema: { id: z.string() },
  handler: async (args) => {
    const s = findById(preset.scenes, args.id);
    if (!s) return err(`场景不存在: ${args.id}`);
    return ok(JSON.stringify(s, null, 2));
  },
};

tools.scene_create = {
  title: '新建场景节点',
  description: '创建新的场景节点。id 可省略（自动生成 scene_NNN）。**coords 省略或冲突时会自动挑选一个不重叠的位置** — 强烈建议让工具自动选，除非你需要精确的图形布局。startingSceneId 为空时会自动指向新节点。',
  schema: {
    id: z.string().optional(),
    name: z.string(),
    type: z.enum(['spawn', 'settlement', 'wilderness', 'combat', 'dungeon', 'vignette', 'ending']).default('wilderness'),
    icon: z.string().optional(),
    description: z.string().optional(),
    coords: z.object({ x: z.number(), y: z.number() }).optional().describe('可选；冲突或省略会自动挑空位'),
    tags: z.array(z.string()).optional(),
    vignettes: z.array(z.string()).optional(),
  },
  handler: async (args) => {
    const id = args.id || genId('scene', preset.scenes);
    if (findById(preset.scenes, id)) return err(`场景 ${id} 已存在`);
    // 自动挑空坐标 — 即使作者传了 coords，如果冲突也会自动避让
    const requestedCoords = args.coords;
    const finalCoords = pickFreeCoord(preset, requestedCoords);
    const coordWasMoved = requestedCoords &&
      (requestedCoords.x !== finalCoords.x || requestedCoords.y !== finalCoords.y);
    const scene = {
      id, name: args.name, type: args.type,
      icon: args.icon || '',
      description: args.description || '',
      coords: finalCoords,
      connections: [], events: [],
      vignettes: args.vignettes || [],
      tags: args.tags || [],
    };
    preset.scenes.push(scene);
    if (!preset.startingSceneId) preset.startingSceneId = id;
    dirty = true;
    const msg = coordWasMoved
      ? `已创建场景 ${id} (${args.name})；坐标自动调整为 (${finalCoords.x},${finalCoords.y})（原 (${requestedCoords.x},${requestedCoords.y}) 与已有场景冲突）`
      : `已创建场景 ${id} (${args.name})，坐标 (${finalCoords.x},${finalCoords.y})`;
    return ok(msg);
  },
};

tools.scene_update = {
  title: '更新场景字段',
  description: '局部更新场景（不动 connections 和 events）。connections 用 scene_add_connection / scene_remove_connection；events 用 scene_attach_event / scene_detach_event。',
  schema: {
    id: z.string(),
    name: z.string().optional(),
    type: z.enum(['spawn', 'settlement', 'wilderness', 'combat', 'dungeon', 'vignette', 'ending']).optional(),
    icon: z.string().optional(),
    description: z.string().optional(),
    coords: z.object({ x: z.number(), y: z.number() }).optional(),
    tags: z.array(z.string()).optional(),
    vignettes: z.array(z.string()).optional(),
  },
  handler: async (args) => {
    const s = findById(preset.scenes, args.id);
    if (!s) return err(`场景不存在: ${args.id}`);
    if (args.name !== undefined) s.name = args.name;
    if (args.type) s.type = args.type;
    if (args.icon !== undefined) s.icon = args.icon;
    if (args.description !== undefined) s.description = args.description;
    if (args.coords) s.coords = args.coords;
    if (args.tags) s.tags = args.tags;
    if (args.vignettes) s.vignettes = args.vignettes;
    dirty = true;
    return ok(`已更新场景 ${args.id}`);
  },
};

tools.scene_delete = {
  title: '删除场景节点',
  description: '删除场景，自动清理所有指向它的连接以及它在 startingSceneId 的引用。',
  schema: { id: z.string() },
  handler: async (args) => {
    const idx = findIdx(preset.scenes, args.id);
    if (idx < 0) return err(`场景不存在: ${args.id}`);
    preset.scenes.splice(idx, 1);
    for (const s of preset.scenes) {
      s.connections = (s.connections || []).filter(c => c.to !== args.id);
    }
    if (preset.startingSceneId === args.id) preset.startingSceneId = preset.scenes[0]?.id || null;
    dirty = true;
    return ok(`已删除场景 ${args.id} 及相关引用`);
  },
};

tools.scene_add_connection = {
  title: '新增/更新出边',
  description: '在 fromId 场景上新增一条到 toId 的出边。**默认双向** — 同时会创建返程 to→from 边（如果不存在）。需要单向（如剧情逼仄推进，到了就回不去）就传 oneWay=true。同一对 from→to 已存在则更新 label/gated。',
  schema: {
    fromId: z.string(),
    toId: z.string(),
    label: z.string().optional().describe('按钮文案，如"沿古道东行"'),
    gated: z.object({
      hint: z.string().optional().describe('诗意提示，玩家可见。不写则用通用文案兜底（绝不会暴露内部 key）'),
      requireVariables: z.record(z.any()).optional(),
      requireCompletedEvents: z.array(z.string()).optional(),
      requireItems: z.array(z.string()).optional(),
    }).optional(),
    oneWay: z.boolean().default(false).describe('true=单向（不创建返程）；默认 false 表示双向'),
    returnLabel: z.string().optional().describe('返程按钮文案；省略则用通用"原路返回"'),
  },
  handler: async (args) => {
    const from = findById(preset.scenes, args.fromId);
    if (!from) return err(`from 场景不存在: ${args.fromId}`);
    const to = findById(preset.scenes, args.toId);
    if (!to) return err(`to 场景不存在: ${args.toId}`);

    from.connections ||= [];
    let conn = from.connections.find(c => c.to === args.toId);
    const isNew = !conn;
    if (isNew) { conn = { to: args.toId }; from.connections.push(conn); }
    if (args.label !== undefined) conn.label = args.label;
    if (args.gated) conn.gated = args.gated;

    let returnMsg = '';
    if (!args.oneWay) {
      to.connections ||= [];
      const existingReturn = to.connections.find(c => c.to === args.fromId);
      if (!existingReturn) {
        to.connections.push({
          to: args.fromId,
          label: args.returnLabel || `原路返回 → ${from.name}`,
        });
        returnMsg = `（同时创建了返程 ${args.toId}→${args.fromId}）`;
      }
    } else {
      returnMsg = '（单向，oneWay=true）';
    }

    dirty = true;
    return ok(`已${isNew ? '新增' : '更新'}出边 ${args.fromId} → ${args.toId} ${returnMsg}`);
  },
};

tools.scene_remove_connection = {
  title: '删除出边',
  description: '删除 fromId → toId 的出边。',
  schema: { fromId: z.string(), toId: z.string() },
  handler: async (args) => {
    const from = findById(preset.scenes, args.fromId);
    if (!from) return err(`from 场景不存在: ${args.fromId}`);
    const before = from.connections?.length || 0;
    from.connections = (from.connections || []).filter(c => c.to !== args.toId);
    if (from.connections.length === before) return err('该出边不存在');
    dirty = true;
    return ok(`已删除出边 ${args.fromId} → ${args.toId}`);
  },
};

tools.scene_variant_add = {
  title: '给场景增加一个变体（Phase 21A）',
  description: '场景在不同 worldFlag/tag/storyTime/事件状态下显示不同 description/events/connections/vignettes。按 variants 数组顺序匹配第一个满足 when 的变体。',
  schema: {
    sceneId: z.string(),
    when: z.object({
      requireVariables: z.record(z.any()).optional(),
      requireWorldFlags: z.record(z.any()).optional(),
      requireCompletedEvents: z.array(z.string()).optional(),
      requireTags: z.array(z.string()).optional(),
      requireStoryTime: z.object({
        minDay: z.number().optional(), maxDay: z.number().optional(),
        hourRange: z.tuple([z.number(), z.number()]).optional(),
      }).optional(),
    }).describe('触发条件；任一不满足则跳过这个变体'),
    description: z.string().optional().describe('覆盖 base 的 description'),
    events: z.array(z.string()).optional().describe('覆盖 base 的 events[]'),
    vignettes: z.array(z.string()).optional().describe('覆盖 base 的 vignettes[]'),
    id: z.string().optional().describe('给变体一个可读 id（便于编辑）'),
  },
  handler: async (args) => {
    const s = findById(preset.scenes, args.sceneId);
    if (!s) return err(`场景不存在: ${args.sceneId}`);
    s.variants ||= [];
    const { sceneId, ...variantData } = args;
    s.variants.push(variantData);
    dirty = true;
    return ok(`已为 ${args.sceneId} 添加变体（共 ${s.variants.length} 个）`);
  },
};

tools.connection_set_hidden = {
  title: '把出边标记为隐藏（默认不可见，需 reveal_connection effect 解锁）',
  description: '设置 connection.discovered=false。常用于"主线推进到某节点后才发现的支线路径"。',
  schema: {
    fromId: z.string(),
    toId: z.string(),
    hidden: z.boolean().default(true).describe('false=恢复默认可见'),
  },
  handler: async (args) => {
    const from = findById(preset.scenes, args.fromId);
    if (!from) return err(`from 场景不存在: ${args.fromId}`);
    const conn = (from.connections || []).find(c => c.to === args.toId);
    if (!conn) return err(`连接 ${args.fromId} → ${args.toId} 不存在`);
    conn.discovered = args.hidden ? false : true;
    dirty = true;
    return ok(`已设置 ${args.fromId}→${args.toId} 为${args.hidden ? '隐藏' : '默认可见'}`);
  },
};

tools.scene_attach_event = {
  title: '把事件挂到场景上',
  description: '场景抵达时按 priority 顺序扫描场景的 events[]。注意：事件自身的 trigger.condition.inScene 也要包含该场景才能匹配。',
  schema: { sceneId: z.string(), eventId: z.string() },
  handler: async (args) => {
    const s = findById(preset.scenes, args.sceneId);
    if (!s) return err(`场景不存在: ${args.sceneId}`);
    if (!findById(preset.events, args.eventId)) return err(`事件不存在: ${args.eventId}`);
    s.events ||= [];
    if (!s.events.includes(args.eventId)) s.events.push(args.eventId);
    dirty = true;
    return ok(`已把事件 ${args.eventId} 挂到场景 ${args.sceneId}`);
  },
};

tools.scene_detach_event = {
  title: '从场景卸下事件',
  description: '从场景的 events[] 中移除一个事件（不会删除事件本身）。',
  schema: { sceneId: z.string(), eventId: z.string() },
  handler: async (args) => {
    const s = findById(preset.scenes, args.sceneId);
    if (!s) return err(`场景不存在: ${args.sceneId}`);
    s.events = (s.events || []).filter(id => id !== args.eventId);
    dirty = true;
    return ok(`已从场景 ${args.sceneId} 卸下事件 ${args.eventId}`);
  },
};

// ---------- 事件 ----------
tools.event_list = {
  title: '列出所有事件',
  description: '返回事件列表概览。',
  schema: { tagFilter: z.string().optional().describe('只返回 tags 包含该字符串的事件') },
  handler: async (args) => ok(JSON.stringify(
    preset.events
      .filter(e => !args.tagFilter || (e.tags || []).includes(args.tagFilter))
      .map(e => ({
        id: e.id, name: e.name, eventType: e.eventType,
        priority: e.priority || 0,
        choices: (e.choices || []).length,
        inScene: e.trigger?.condition?.inScene || [],
        tags: e.tags || [],
      })),
    null, 2,
  )),
};

tools.event_get = {
  title: '查看单个事件',
  description: '返回事件完整数据。',
  schema: { id: z.string() },
  handler: async (args) => {
    const e = findById(preset.events, args.id);
    if (!e) return err(`事件不存在: ${args.id}`);
    return ok(JSON.stringify(e, null, 2));
  },
};

const effectSchema = z.object({
  type: z.enum(['add_item', 'remove_item', 'heal', 'damage', 'start_combat',
                'set_variable', 'trigger_event', 'add_memory', 'narrative']),
  itemId: z.string().optional(),
  target: z.string().optional(),
  value: z.any().optional(),
  name: z.string().optional(),
  enemyIds: z.array(z.string()).optional(),
  eventId: z.string().optional(),
  text: z.string().optional(),
});

tools.event_create = {
  title: '创建事件',
  description: '一次性创建完整事件卡（含 choices / outcomes / effects），方便 AI 批量生成剧情。',
  schema: {
    id: z.string().optional(),
    name: z.string(),
    description: z.string(),
    eventType: z.enum(['story', 'encounter', 'shop', 'boss', 'rescue']).default('story'),
    priority: z.number().default(50),
    inScene: z.array(z.string()).optional().describe('挂载到这些场景'),
    requireVariables: z.record(z.any()).optional(),
    requireCompletedEvents: z.array(z.string()).optional(),
    excludeCompletedEvents: z.array(z.string()).optional(),
    probability: z.number().min(0).max(1).default(1.0),
    choices: z.array(z.object({
      id: z.string().optional(),
      text: z.string(),
      outcomes: z.array(z.object({
        probability: z.number().min(0).max(1).default(1.0),
        text: z.string(),
        effects: z.array(effectSchema).default([]),
      })).default([]),
    })).default([]),
    repeatable: z.boolean().default(false),
    aiPromptHint: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  handler: async (args) => {
    const id = args.id || genId('ch', preset.events);
    if (findById(preset.events, id)) return err(`事件 ${id} 已存在`);
    const choices = (args.choices || []).map((c, i) => ({
      id: c.id || `choice_${i + 1}`,
      text: c.text,
      requirements: null,
      outcomes: (c.outcomes || []).map(o => ({
        probability: o.probability ?? 1.0,
        text: o.text,
        effects: o.effects || [],
      })),
    }));
    const event = {
      id, type: 'event',
      name: args.name, description: args.description,
      eventType: args.eventType, priority: args.priority,
      trigger: {
        type: 'composite',
        condition: {
          ...(args.inScene && args.inScene.length > 0 ? { inScene: args.inScene } : {}),
          ...(args.requireVariables ? { requireVariables: args.requireVariables } : {}),
          ...(args.requireCompletedEvents ? { requireCompletedEvents: args.requireCompletedEvents } : {}),
          ...(args.excludeCompletedEvents ? { excludeCompletedEvents: args.excludeCompletedEvents } : { excludeCompletedEvents: [id] }),
          probability: args.probability,
        },
      },
      choices,
      repeatable: args.repeatable,
      maxOccurrences: args.repeatable ? 99 : 1,
      aiPromptHint: args.aiPromptHint || '',
      tags: args.tags || [],
      notes: '',
    };
    preset.events.push(event);
    dirty = true;
    return ok(`已创建事件 ${id} (${args.name})`);
  },
};

tools.event_update = {
  title: '更新事件字段',
  description: '局部更新事件的可编辑字段。要重写整个 choices 树建议先 event_delete + event_create。',
  schema: {
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    eventType: z.enum(['story', 'encounter', 'shop', 'boss', 'rescue']).optional(),
    priority: z.number().optional(),
    inScene: z.array(z.string()).optional(),
    requireVariables: z.record(z.any()).optional(),
    requireCompletedEvents: z.array(z.string()).optional(),
    excludeCompletedEvents: z.array(z.string()).optional(),
    probability: z.number().min(0).max(1).optional(),
    repeatable: z.boolean().optional(),
    aiPromptHint: z.string().optional(),
    tags: z.array(z.string()).optional(),
  },
  handler: async (args) => {
    const e = findById(preset.events, args.id);
    if (!e) return err(`事件不存在: ${args.id}`);
    if (args.name !== undefined) e.name = args.name;
    if (args.description !== undefined) e.description = args.description;
    if (args.eventType) e.eventType = args.eventType;
    if (args.priority !== undefined) e.priority = args.priority;
    if (args.repeatable !== undefined) {
      e.repeatable = args.repeatable;
      e.maxOccurrences = args.repeatable ? 99 : 1;
    }
    if (args.aiPromptHint !== undefined) e.aiPromptHint = args.aiPromptHint;
    if (args.tags) e.tags = args.tags;
    e.trigger ||= { type: 'composite', condition: {} };
    e.trigger.condition ||= {};
    if (args.inScene !== undefined) e.trigger.condition.inScene = args.inScene;
    if (args.requireVariables !== undefined) e.trigger.condition.requireVariables = args.requireVariables;
    if (args.requireCompletedEvents !== undefined) e.trigger.condition.requireCompletedEvents = args.requireCompletedEvents;
    if (args.excludeCompletedEvents !== undefined) e.trigger.condition.excludeCompletedEvents = args.excludeCompletedEvents;
    if (args.probability !== undefined) e.trigger.condition.probability = args.probability;
    dirty = true;
    return ok(`已更新事件 ${args.id}`);
  },
};

tools.event_delete = {
  title: '删除事件',
  description: '删除事件并清理场景对它的引用。',
  schema: { id: z.string() },
  handler: async (args) => {
    const idx = findIdx(preset.events, args.id);
    if (idx < 0) return err(`事件不存在: ${args.id}`);
    preset.events.splice(idx, 1);
    for (const s of preset.scenes) {
      s.events = (s.events || []).filter(id => id !== args.id);
    }
    dirty = true;
    return ok(`已删除事件 ${args.id}`);
  },
};

// ---------- 角色 ----------
tools.character_list = {
  title: '列出所有角色',
  description: '返回角色概览。',
  schema: {},
  handler: async () => ok(JSON.stringify(preset.characters.map(c => ({
    id: c.id, name: c.name, title: c.title, level: c.level,
    hp: c.stats?.hp, attack: c.stats?.attack, abilities: (c.abilities || []).length,
  })), null, 2)),
};

tools.character_get = {
  title: '查看单个角色',
  description: '返回角色完整数据。',
  schema: { id: z.string() },
  handler: async (args) => {
    const c = findById(preset.characters, args.id);
    if (!c) return err(`角色不存在: ${args.id}`);
    return ok(JSON.stringify(c, null, 2));
  },
};

tools.character_create = {
  title: '创建角色',
  description: `一次性创建完整角色卡（属性、技能、初始装备）。

**重要 — abilities[].effect 必须显式写出**：active 技能没有 effect 就会造成 0 伤害，战斗根本打不动。常见写法：
  - 伤害技能: effect: { damage: { formula: "attack+2d6+5" } }      # attack/magicAttack 等 stats 名可直接用作变量
  - 治疗技能: effect: { heal:   { formula: "30" } }                  # 数字或表达式都可
  - 吸血技能: effect: { damage: { formula: "magicAttack+d8" }, heal: { formula: "15" } }
  - 范围/持续: effect: { damage: { formula: "..." }, aoe: true, dot: 3 }  # 见 CombatSystem 文档

passive 技能可以省略 effect（仅作 prompt 提示，不会自动应用）。
公式支持: NdM（如 2d6）、单个属性名（attack/magicAttack/defense 等）、±整数（如 +5 -2）；可链式 attack+2d6+3。`,
  schema: {
    id: z.string().optional(),
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    stats: z.object({
      hp: z.number().default(100), mp: z.number().default(30),
      attack: z.number().default(10), defense: z.number().default(8),
      magicAttack: z.number().default(5), magicDefense: z.number().default(8),
      speed: z.number().default(10), luck: z.number().default(5),
    }),
    abilities: z.array(z.object({
      id: z.string(), name: z.string(), description: z.string().optional(),
      type: z.enum(['active', 'passive']).default('active'),
      cost: z.object({ mp: z.number().default(0) }).optional(),
      effect: z.any().optional().describe('active 技能必填！示例: { damage: { formula: "attack+2d6+5" } } 或 { heal: { formula: "30" } }。passive 可省略。'),
      cooldown: z.number().default(0),
    })).optional(),
    inventory: z.array(z.string()).optional(),
    equipment: z.object({
      weapon: z.string().nullable().optional(),
      armor: z.string().nullable().optional(),
      accessory: z.string().nullable().optional(),
    }).optional(),
    level: z.number().default(1),
    tags: z.array(z.string()).optional(),
  },
  handler: async (args) => {
    const id = args.id || genId('char', preset.characters);
    if (findById(preset.characters, id)) return err(`角色 ${id} 已存在`);
    const stats = args.stats;

    // 健康检查：active ability 缺 effect 时给警告（不阻塞，但提醒作者）
    const warnings = [];
    for (const ab of (args.abilities || [])) {
      if (ab.type === 'active' && !ab.effect) {
        warnings.push(`active 技能 "${ab.id}" 没有 effect — 战斗时会造成 0 伤害。建议加 effect: { damage: { formula: "attack+d6" } }`);
      }
    }

    preset.characters.push({
      id, type: 'character',
      name: args.name, title: args.title || '',
      description: args.description || '',
      stats: { ...stats, hpCurrent: stats.hp, mpCurrent: stats.mp },
      abilities: args.abilities || [],
      inventory: args.inventory || [],
      equipment: args.equipment || { weapon: null, armor: null, accessory: null },
      position: { x: 0, y: 0 },
      level: args.level,
      experience: 0,
      statusEffects: [],
      tags: args.tags || [],
      notes: '',
    });
    dirty = true;
    const warnMsg = warnings.length > 0 ? `\n⚠ 警告:\n  ${warnings.join('\n  ')}` : '';
    return ok(`已创建角色 ${id} (${args.name})${warnMsg}`);
  },
};

tools.character_delete = {
  title: '删除角色',
  description: '删除角色（注意：可能破坏其他引用）。',
  schema: { id: z.string() },
  handler: async (args) => {
    const idx = findIdx(preset.characters, args.id);
    if (idx < 0) return err(`角色不存在: ${args.id}`);
    preset.characters.splice(idx, 1);
    dirty = true;
    return ok(`已删除角色 ${args.id}`);
  },
};

// ---------- 敌人 ----------
tools.enemy_list = {
  title: '列出所有敌人',
  description: '返回敌人概览。',
  schema: {},
  handler: async () => ok(JSON.stringify(preset.enemies.map(e => ({
    id: e.id, name: e.name, difficulty: e.difficulty,
    hp: e.stats?.hp, attack: e.stats?.attack,
    exp: e.experienceReward, loot: (e.lootTable || []).length,
  })), null, 2)),
};

tools.enemy_get = {
  title: '查看单个敌人',
  description: '返回敌人完整数据。',
  schema: { id: z.string() },
  handler: async (args) => {
    const e = findById(preset.enemies, args.id);
    if (!e) return err(`敌人不存在: ${args.id}`);
    return ok(JSON.stringify(e, null, 2));
  },
};

tools.enemy_create = {
  title: '创建敌人',
  description: '一次性创建完整敌人。',
  schema: {
    id: z.string().optional(),
    name: z.string(),
    description: z.string().optional(),
    stats: z.object({
      hp: z.number(), mp: z.number().default(0),
      attack: z.number(), defense: z.number(),
      magicAttack: z.number().default(0), magicDefense: z.number().default(0),
      speed: z.number().default(10), luck: z.number().default(1),
    }),
    abilities: z.array(z.any()).optional(),
    lootTable: z.array(z.object({
      itemId: z.string(), dropRate: z.number().min(0).max(1),
    })).optional(),
    behaviorHint: z.enum(['aggressive', 'defensive', 'cunning']).default('aggressive'),
    experienceReward: z.number().default(10),
    difficulty: z.enum(['easy', 'normal', 'hard', 'boss']).default('normal'),
    tags: z.array(z.string()).optional(),
  },
  handler: async (args) => {
    const id = args.id || genId('enemy', preset.enemies);
    if (findById(preset.enemies, id)) return err(`敌人 ${id} 已存在`);
    const stats = args.stats;
    preset.enemies.push({
      id, type: 'enemy',
      name: args.name, description: args.description || '',
      stats: { ...stats, hpCurrent: stats.hp, mpCurrent: stats.mp },
      abilities: args.abilities || [],
      lootTable: args.lootTable || [],
      behaviorHint: args.behaviorHint,
      experienceReward: args.experienceReward,
      difficulty: args.difficulty,
      position: { x: 0, y: 0 },
      statusEffects: [],
      tags: args.tags || [],
      notes: '',
    });
    dirty = true;
    return ok(`已创建敌人 ${id} (${args.name})`);
  },
};

tools.enemy_delete = {
  title: '删除敌人',
  description: '删除敌人。',
  schema: { id: z.string() },
  handler: async (args) => {
    const idx = findIdx(preset.enemies, args.id);
    if (idx < 0) return err(`敌人不存在: ${args.id}`);
    preset.enemies.splice(idx, 1);
    dirty = true;
    return ok(`已删除敌人 ${args.id}`);
  },
};

// ---------- 物品 ----------
tools.item_list = {
  title: '列出所有物品',
  description: '返回物品概览。',
  schema: {},
  handler: async () => ok(JSON.stringify(preset.items.map(i => ({
    id: i.id, name: i.name, itemType: i.itemType,
    equipSlot: i.equipSlot, buyPrice: i.buyPrice,
  })), null, 2)),
};

tools.item_get = {
  title: '查看单个物品',
  description: '返回物品完整数据。',
  schema: { id: z.string() },
  handler: async (args) => {
    const i = findById(preset.items, args.id);
    if (!i) return err(`物品不存在: ${args.id}`);
    return ok(JSON.stringify(i, null, 2));
  },
};

tools.item_create = {
  title: '创建物品',
  description: '创建武器/防具/饰品/消耗品/材料/任务物品。statModifiers 用于装备类，consumeEffect 用于消耗品。',
  schema: {
    id: z.string().optional(),
    name: z.string(),
    description: z.string().optional(),
    itemType: z.enum(['weapon', 'armor', 'accessory', 'consumable', 'material', 'quest']),
    equipSlot: z.enum(['weapon', 'armor', 'accessory']).nullable().optional(),
    statModifiers: z.record(z.number()).optional(),
    consumeEffect: z.object({
      type: z.enum(['heal', 'buff']),
      stat: z.string().optional(),
      value: z.number(),
      duration: z.number().optional(),
    }).nullable().optional(),
    buyPrice: z.number().default(0),
    sellPrice: z.number().default(0),
    stackable: z.boolean().default(false),
    maxStack: z.number().default(1),
    tags: z.array(z.string()).optional(),
  },
  handler: async (args) => {
    const id = args.id || genId('item', preset.items);
    if (findById(preset.items, id)) return err(`物品 ${id} 已存在`);
    preset.items.push({
      id, type: 'item',
      name: args.name, description: args.description || '',
      image: '', itemType: args.itemType,
      statModifiers: args.statModifiers || {},
      consumeEffect: args.consumeEffect || null,
      equipSlot: args.equipSlot || null,
      buyPrice: args.buyPrice, sellPrice: args.sellPrice,
      stackable: args.stackable, maxStack: args.maxStack,
      tags: args.tags || [], notes: '',
    });
    dirty = true;
    return ok(`已创建物品 ${id} (${args.name})`);
  },
};

tools.item_delete = {
  title: '删除物品',
  description: '删除物品。',
  schema: { id: z.string() },
  handler: async (args) => {
    const idx = findIdx(preset.items, args.id);
    if (idx < 0) return err(`物品不存在: ${args.id}`);
    preset.items.splice(idx, 1);
    dirty = true;
    return ok(`已删除物品 ${args.id}`);
  },
};

// ---------- Phase 19A: 角色创建选项 ----------
tools.startingoption_set = {
  title: '设置角色创建选项（race/origin/background/faith 任一轴）',
  description: '一次性设置某一轴的全部选项。例如 axis="races", options=[{id,name,icon,tags,statBonus,description}, ...]。重复调用会覆盖该轴。',
  schema: {
    axis: z.enum(['races', 'origins', 'backgrounds', 'faiths']),
    options: z.array(z.object({
      id: z.string(),
      name: z.string(),
      icon: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional().describe('如 ["race:elf", "longevity"]'),
      statBonus: z.record(z.number()).optional().describe('如 {hp: -10, magicAttack: 3}'),
    })),
  },
  handler: async (args) => {
    preset.startingOptions ||= {};
    preset.startingOptions[args.axis] = args.options;
    dirty = true;
    return ok(`已设置 ${args.axis}：${args.options.length} 个选项`);
  },
};

tools.startingscenerule_add = {
  title: '新增起始场景路由规则',
  description: '按玩家选定的 tags 决定起始场景。规则按数组顺序匹配第一条命中的；用 default:true 设兜底。',
  schema: {
    when: z.object({
      tags: z.array(z.string()).optional().describe('全部命中'),
      anyTags: z.array(z.string()).optional().describe('任一命中'),
    }).optional(),
    sceneId: z.string().optional().describe('命中后的起始场景；与 default 二选一'),
    default: z.boolean().optional().describe('true=兜底规则；与 sceneId 二选一'),
    defaultSceneId: z.string().optional().describe('default=true 时指定的兜底场景'),
  },
  handler: async (args) => {
    preset.startingSceneRules ||= [];
    if (args.default && args.defaultSceneId) {
      preset.startingSceneRules.push({ default: args.defaultSceneId });
    } else if (args.sceneId) {
      preset.startingSceneRules.push({ when: args.when || {}, sceneId: args.sceneId });
    } else {
      return err('必须指定 sceneId 或 default+defaultSceneId');
    }
    dirty = true;
    return ok(`已新增起始场景规则（共 ${preset.startingSceneRules.length} 条）`);
  },
};

// ---------- Phase 19B: NPC 系统 ----------
tools.npc_list = {
  title: '列出所有 NPC',
  description: '返回所有 NPC 概览。',
  schema: {},
  handler: async () => ok(JSON.stringify(preset.npcs.map(n => ({
    id: n.id, name: n.name, title: n.title,
    recruitable: !!n.recruitable,
    scheduleSlots: (n.schedule || []).length,
    giftPreferences: Object.keys(n.giftPreferences || {}).length,
  })), null, 2)),
};

tools.npc_get = {
  title: '查看单个 NPC',
  description: '返回 NPC 完整数据（含 schedule / giftPreferences / dialogueTree）。',
  schema: { id: z.string() },
  handler: async (args) => {
    const n = findById(preset.npcs, args.id);
    if (!n) return err(`NPC 不存在: ${args.id}`);
    return ok(JSON.stringify(n, null, 2));
  },
};

tools.npc_create = {
  title: '创建 NPC',
  description: '一次性创建完整 NPC。recruitable=true 的 NPC 需要 stats/abilities 字段（与 character 类似）。',
  schema: {
    id: z.string().optional(),
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    personality: z.string().optional().describe('AI prompt 用，如 "gruff_but_kind" / "scheming"'),
    recruitable: z.boolean().default(false),
    spawnScene: z.string().optional().describe('无 schedule 时的固定场景'),
    initialInventory: z.array(z.string()).optional(),
    giftPreferences: z.record(z.enum(['love', 'like', 'neutral', 'dislike', 'hate']))
      .optional()
      .describe('key 可以是 item id / item.itemType / "tag:xxx" / 任意 tag'),
    schedule: z.array(z.object({
      day: z.union([z.number(), z.array(z.number()), z.literal('any')]).optional(),
      hour: z.tuple([z.number(), z.number()]).describe('[lo, hi] 范围，lo>hi 时跨午夜'),
      scene: z.string(),
    })).optional(),
    stats: z.any().optional().describe('recruitable=true 才需要'),
    abilities: z.array(z.any()).optional().describe('recruitable=true 才需要'),
    dialogueTree: z.any().optional().describe('Phase 20 才用，结构 { root: { speaker, text, branches: [...] }, ... }'),
    tags: z.array(z.string()).optional(),
  },
  handler: async (args) => {
    const id = args.id || genId('npc', preset.npcs);
    if (findById(preset.npcs, id)) return err(`NPC ${id} 已存在`);
    preset.npcs.push({
      id, type: 'npc',
      name: args.name, title: args.title || '',
      description: args.description || '',
      icon: args.icon || '🧑',
      personality: args.personality || '',
      recruitable: args.recruitable,
      spawnScene: args.spawnScene,
      initialInventory: args.initialInventory || [],
      giftPreferences: args.giftPreferences || {},
      schedule: args.schedule || [],
      stats: args.stats,
      abilities: args.abilities || [],
      dialogueTree: args.dialogueTree || null,
      tags: args.tags || [],
    });
    dirty = true;
    return ok(`已创建 NPC ${id} (${args.name})`);
  },
};

tools.npc_update = {
  title: '更新 NPC 字段',
  description: '局部更新 NPC 的可编辑字段。',
  schema: {
    id: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    personality: z.string().optional(),
    recruitable: z.boolean().optional(),
    spawnScene: z.string().optional(),
    initialInventory: z.array(z.string()).optional(),
    giftPreferences: z.record(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  },
  handler: async (args) => {
    const n = findById(preset.npcs, args.id);
    if (!n) return err(`NPC 不存在: ${args.id}`);
    for (const k of ['name', 'title', 'description', 'icon', 'personality', 'recruitable', 'spawnScene', 'initialInventory', 'giftPreferences', 'tags']) {
      if (args[k] !== undefined) n[k] = args[k];
    }
    dirty = true;
    return ok(`已更新 NPC ${args.id}`);
  },
};

tools.npc_schedule_add = {
  title: '给 NPC 加一条时间表',
  description: '追加一条 schedule slot。',
  schema: {
    npcId: z.string(),
    day: z.union([z.number(), z.array(z.number()), z.literal('any')]).optional(),
    hourLo: z.number(),
    hourHi: z.number(),
    scene: z.string(),
  },
  handler: async (args) => {
    const n = findById(preset.npcs, args.npcId);
    if (!n) return err(`NPC 不存在: ${args.npcId}`);
    if (!findById(preset.scenes, args.scene)) return err(`场景不存在: ${args.scene}`);
    n.schedule ||= [];
    n.schedule.push({
      day: args.day === undefined ? 'any' : args.day,
      hour: [args.hourLo, args.hourHi],
      scene: args.scene,
    });
    dirty = true;
    return ok(`已加入 schedule（共 ${n.schedule.length} 条）`);
  },
};

tools.npc_relation_add = {
  title: '新增 NPC 关系（Phase 22B）',
  description: 'from 的 affection 变化会按 strength 传播到 to。\n  strength > 0 = ally（同向，同甘）\n  strength < 0 = rival（反向，幸灾乐祸）\n  绝对值 0.5 = 标准朋友 / 0.7+ = 至交或宿敌（NPC 死亡时还会改 mood）\n  关系是单向的；要双向就调两次。',
  schema: {
    from: z.string(),
    to: z.string(),
    strength: z.number().min(-1).max(1).describe('-1.0 ~ 1.0；推荐 ±0.3-0.7'),
    note: z.string().optional().describe('给作者自己的备注'),
  },
  handler: async (args) => {
    if (!findById(preset.npcs, args.from)) return err(`from NPC 不存在: ${args.from}`);
    if (!findById(preset.npcs, args.to))   return err(`to NPC 不存在: ${args.to}`);
    preset.npcRelations ||= [];
    preset.npcRelations.push({ from: args.from, to: args.to, strength: args.strength, note: args.note || '' });
    dirty = true;
    return ok(`已增加关系 ${args.from} → ${args.to} (strength=${args.strength})`);
  },
};

tools.npc_delete = {
  title: '删除 NPC',
  description: '删除 NPC（注意：可能破坏 dialogueTree 中对该 NPC 的引用）。',
  schema: { id: z.string() },
  handler: async (args) => {
    const idx = findIdx(preset.npcs, args.id);
    if (idx < 0) return err(`NPC 不存在: ${args.id}`);
    preset.npcs.splice(idx, 1);
    dirty = true;
    return ok(`已删除 NPC ${args.id}`);
  },
};

// ---------- Phase 20B: 对话树 ----------
tools.dialogue_node_set = {
  title: '为 NPC 添加 / 更新对话节点',
  description: '在 NPC 的 dialogueTree 中创建或覆盖一个节点。第一个节点的 id 必须是 root（对话入口）。',
  schema: {
    npcId: z.string(),
    nodeId: z.string().describe('节点 id；第一个/入口必须叫 "root"'),
    speaker: z.enum(['self', 'player']).default('self').describe('self=NPC 说，player=玩家说'),
    text: z.string().describe('节点文本'),
  },
  handler: async (args) => {
    const npc = findById(preset.npcs, args.npcId);
    if (!npc) return err(`NPC 不存在: ${args.npcId}`);
    npc.dialogueTree ||= {};
    npc.dialogueTree[args.nodeId] = npc.dialogueTree[args.nodeId] || { branches: [] };
    npc.dialogueTree[args.nodeId].speaker = args.speaker;
    npc.dialogueTree[args.nodeId].text = args.text;
    dirty = true;
    return ok(`已设置 ${args.npcId}.dialogueTree.${args.nodeId}`);
  },
};

tools.dialogue_branch_add = {
  title: '给对话节点添加一个分支选项',
  description: '为指定节点新增一个玩家可选的分支。next 指向下一个节点 id；不写 next 或 exit=true 表示选完结束对话。',
  schema: {
    npcId: z.string(),
    nodeId: z.string(),
    text: z.string().describe('玩家可见的选项文本'),
    next: z.string().optional().describe('下一节点 id；省略表示选完结束'),
    exit: z.boolean().optional().describe('true=选完直接退出对话'),
    affectionDelta: z.number().optional().describe('选完改 affection'),
    hidden: z.boolean().optional().describe('true=不满足条件时直接隐藏（vs 仅 disabled）'),
    requireTags: z.array(z.string()).optional(),
    requireAnyTags: z.array(z.string()).optional(),
    requireNoTags: z.array(z.string()).optional(),
    requireAffection: z.number().optional(),
    requireVariables: z.record(z.any()).optional(),
    requireWorldFlags: z.record(z.any()).optional(),
    effects: z.array(z.any()).optional().describe('选完执行的 effects（与事件 outcome.effects 同结构）'),
  },
  handler: async (args) => {
    const npc = findById(preset.npcs, args.npcId);
    if (!npc) return err(`NPC 不存在: ${args.npcId}`);
    npc.dialogueTree ||= {};
    const node = npc.dialogueTree[args.nodeId];
    if (!node) return err(`节点 ${args.nodeId} 不存在；请先用 dialogue_node_set 创建`);
    node.branches ||= [];
    const { npcId, nodeId, ...branchData } = args;
    node.branches.push(branchData);
    dirty = true;
    return ok(`已为 ${args.npcId}.${args.nodeId} 添加分支（共 ${node.branches.length} 个）`);
  },
};

tools.dialogue_get = {
  title: '查看 NPC 的完整对话树',
  description: '返回 NPC 的 dialogueTree 字段。',
  schema: { npcId: z.string() },
  handler: async (args) => {
    const npc = findById(preset.npcs, args.npcId);
    if (!npc) return err(`NPC 不存在: ${args.npcId}`);
    return ok(JSON.stringify(npc.dialogueTree || {}, null, 2));
  },
};

// ---------- Phase 25: 大型剧本模板与规模检查 ----------

tools.preset_apply_template = {
  title: '一键应用大型剧本骨架模板',
  description: '快速给空预设塞入"标准 CRPG 框架"：种族/出身/背景/信仰 4 轴选项 + 起始 hub 场景 + 主线骨架。完成后用 event_create / scene_create 填血肉。\n推荐流程：preset_reset → preset_apply_template → AI 自由扩充 → preset_analyze。',
  schema: {
    template: z.enum(['crpg_standard', 'survival_solo', 'mystery_visual_novel']).default('crpg_standard'),
    confirm: z.boolean().default(false).describe('必须 true 才会覆盖现有数据；现有预设非空时会拒绝（除非 confirm=true）'),
  },
  handler: async (args) => {
    if (preset.scenes.length > 0 && !args.confirm) {
      return err(`预设已有 ${preset.scenes.length} 个场景。请先 preset_reset 或传 confirm=true 强制覆盖`);
    }
    if (args.template === 'crpg_standard') applyCrpgTemplate(preset);
    else if (args.template === 'survival_solo') applySurvivalTemplate(preset);
    else if (args.template === 'mystery_visual_novel') applyMysteryTemplate(preset);
    dirty = true;
    return ok(`已应用模板 [${args.template}]：${preset.scenes.length} 节点 / ${preset.events.length} 事件 / ${preset.startingOptions ? Object.keys(preset.startingOptions).length : 0} 角色创建轴`);
  },
};

tools.scene_chain_create = {
  title: '一次创建一条线性场景链（节省 batch 调用次数）',
  description: '一次创建 N 个场景 + 自动双向连接它们。常用于"主线推进通道"骨架。',
  schema: {
    chain: z.array(z.object({
      id: z.string().optional(),
      name: z.string(),
      type: z.enum(['spawn', 'settlement', 'wilderness', 'combat', 'dungeon', 'vignette', 'ending']).default('wilderness'),
      icon: z.string().optional(),
      description: z.string().optional(),
      connectionLabel: z.string().optional().describe('从上一个到这个的"前进"按钮文案'),
      returnLabel: z.string().optional().describe('返程按钮文案'),
      oneWay: z.boolean().default(false).describe('true=只能从上一个走过来，不能回头'),
    })).min(2),
    autoStart: z.boolean().default(true).describe('true=第一个节点自动设为 startingSceneId（若未设）'),
  },
  handler: async (args) => {
    const created = [];
    for (let i = 0; i < args.chain.length; i++) {
      const item = args.chain[i];
      const id = item.id || genId('scene', preset.scenes);
      if (findById(preset.scenes, id)) continue;
      const scene = {
        id, name: item.name, type: item.type,
        icon: item.icon || '',
        description: item.description || '',
        coords: pickFreeCoord(preset, { x: i, y: 0 }),
        connections: [], events: [], vignettes: [], tags: [],
      };
      preset.scenes.push(scene);
      created.push(id);
      // 连接到前一个
      if (i > 0) {
        const prev = preset.scenes.find(s => s.id === created[i - 1]);
        if (prev) {
          prev.connections.push({ to: id, label: item.connectionLabel || `前往 ${item.name}` });
          if (!item.oneWay) {
            scene.connections.push({ to: prev.id, label: item.returnLabel || `原路返回 → ${prev.name}` });
          }
        }
      }
    }
    if (args.autoStart && created.length > 0 && !preset.startingSceneId) {
      preset.startingSceneId = created[0];
    }
    dirty = true;
    return ok(`已创建场景链：${created.join(' → ')}`);
  },
};

tools.preset_scale_check = {
  title: '检查大型剧本规模适配性（300+ 节点项目专用）',
  description: '对照"超大型剧本"的健康指标给出报告：节点数 / 事件密度 / 主线长度 / NPC 复用率 / 平均连接度等。',
  schema: {},
  handler: async () => {
    const sCount = preset.scenes.length;
    const eCount = preset.events.length;
    const nCount = preset.npcs.length;

    // 平均连接度
    const edges = preset.scenes.reduce((a, s) => a + (s.connections?.length || 0), 0);
    const avgConn = sCount > 0 ? (edges / sCount).toFixed(2) : 0;

    // 主线节点（带 main tag）
    const mainScenes = preset.scenes.filter(s => (s.tags || []).includes('main'));
    const mainEvents = preset.events.filter(e => (e.tags || []).includes('main'));

    // 事件密度 (events / scenes)
    const eventDensity = sCount > 0 ? (eCount / sCount).toFixed(2) : 0;

    // NPC schedule 覆盖
    const npcsWithSchedule = preset.npcs.filter(n => (n.schedule || []).length > 0).length;

    const lines = ['╔══ 规模适配性检查 ══╗', ''];
    lines.push(`📊 实体数: ${sCount} 场景 / ${eCount} 事件 / ${nCount} NPC / ${preset.items.length} 物品`);
    lines.push('');

    // 评级
    const evaluate = (val, ranges, labels) => {
      for (let i = 0; i < ranges.length; i++) if (val <= ranges[i]) return labels[i];
      return labels[labels.length - 1];
    };

    lines.push(`🗺 场景规模: ${sCount}`);
    if (sCount < 10) lines.push('   ⚠ 偏小 — 适合短篇 (<30 min)；想做"超大型"建议至少 50+');
    else if (sCount < 50) lines.push('   ✓ 中型 — 适合 1-2 小时单局');
    else if (sCount < 200) lines.push('   ✓ 大型 — 单局 2-3 小时 + 多周目');
    else lines.push('   ✓ 超大型 — 多周目 5+ 小时，必须靠 IndexedDB 存储 + AI 上下文检索');
    lines.push('');

    lines.push(`📜 事件密度: ${eventDensity} 事件/场景`);
    if (eventDensity < 0.3) lines.push('   ⚠ 过低 — 大多数场景"空白"无戏，体感单调；建议提到 0.5-1.5');
    else if (eventDensity < 2.5) lines.push('   ✓ 健康');
    else lines.push('   ⚠ 过高 — 单场景挂太多事件可能让 priority 冲突难管理');
    lines.push('');

    lines.push(`🔗 平均连接度: ${avgConn} 边/场景`);
    if (avgConn < 1.5) lines.push('   ⚠ 偏线性 — 接近"通道式"，缺乏网状选择');
    else if (avgConn < 3.5) lines.push('   ✓ 良好的网状结构');
    else lines.push('   ⚠ 偏密集 — 玩家可能迷路；建议加 hub 节点收束');
    lines.push('');

    lines.push(`🎯 主线节点: ${mainScenes.length} (占 ${sCount > 0 ? (mainScenes.length / sCount * 100).toFixed(0) : 0}%)`);
    lines.push(`   主线事件: ${mainEvents.length}`);
    if (sCount > 50 && mainScenes.length / sCount > 0.5) {
      lines.push('   ⚠ 主线节点占比过高 — 大型剧本应该有更多"支线/可选"内容');
    }
    lines.push('');

    lines.push(`🧑 NPC: ${nCount}`);
    if (nCount > 0) lines.push(`   带时间表: ${npcsWithSchedule} / ${nCount}（schedule 让 NPC 在不同时刻出现在不同场景，提高重玩性）`);
    if (sCount > 100 && nCount < 20) lines.push('   ⚠ NPC 偏少 — 大型剧本建议 30+ NPC 才有"世界感"');
    lines.push('');

    // 多结局检查
    const endingEvents = preset.events.filter(e =>
      (e.tags || []).some(t => t === 'epilogue' || t === 'ending')
    );
    lines.push(`🌅 结局数: ${endingEvents.length}`);
    if (endingEvents.length < 2) lines.push('   ⚠ 仅 1 种结局 — 大型剧本通常有 3-10 种结局支撑多周目收集');
    lines.push('');

    // 角色创建
    if (preset.startingOptions) {
      const optCount = Object.entries(preset.startingOptions).reduce((a, [, v]) => a + (v?.length || 0), 0);
      lines.push(`🎭 角色创建选项: 共 ${optCount} 个跨 4 轴`);
    } else {
      lines.push(`🎭 角色创建: 未启用（适合"固定主角"短篇；大型剧本强烈建议启用让玩家选择身份）`);
    }

    lines.push('');
    lines.push('═══════════════════════');
    return ok(lines.join('\n'));
  },
};

// ============================================================
// Phase 26 战斗平衡 Monte Carlo 模拟（同步，毫秒级）
// ============================================================
tools.combat_simulate = {
  title: '战斗平衡数值模拟（无 AI 调用，纯数学）',
  description: `给指定 boss 战或所有 start_combat 事件做 Monte Carlo 模拟，输出胜率/平均回合/剩余 HP%。
比 AI playtest 快 10000 倍——平衡数值时用这个工具，不用真去跑游戏。

策略复刻 PlayerAI.decideCombat：
  - 角色：有 MP 用最高 cost 伤害技能；目标选 HP 最低活敌
  - 敌人：普攻 HP 最低的活角色

输出标志位：
  - 😴 太简单 (winRate ≥ 95%)
  - ✓ 适中 (60-95%)
  - ⚠ 偏难 (35-60%)
  - ❌ 过难 (10-35%)
  - ☠ 不可通关 (<10%)`,
  schema: {
    eventId: z.string().optional().describe('只模拟某个事件；省略 = 全部 start_combat 事件'),
    runs: z.number().min(100).max(10000).default(1000),
    maxRounds: z.number().min(5).max(100).default(40),
    includeCompanions: z.boolean().default(false).describe('true=队伍含全部 recruitable companion（端章 boss 用）'),
    entryHpPct: z.number().min(0.1).max(1.0).default(1.0).describe('入场时队伍 HP%；1.0=满血，0.5=半血'),
  },
  handler: async (args) => {
    // 内联实现（避免 import 复杂依赖）
    const { DiceSystem } = await import('../src/systems/DiceSystem.js');
    const { CombatSystem } = await import('../src/systems/CombatSystem.js');

    const dice = new DiceSystem();
    const combat = new CombatSystem();
    combat.diceSystem = dice;
    combat.eventSystem = null;

    // 找战斗
    const allCombats = [];
    for (const ev of preset.events) {
      for (const ch of (ev.choices || [])) {
        for (const oc of (ch.outcomes || [])) {
          for (const eff of (oc.effects || [])) {
            if (eff.type === 'start_combat' && (eff.enemyIds || []).length > 0) {
              allCombats.push({ eventId: ev.id, eventName: ev.name, enemyIds: eff.enemyIds, isBoss: (ev.tags || []).includes('boss') });
            }
          }
        }
      }
    }
    const combats = args.eventId ? allCombats.filter(c => c.eventId === args.eventId) : allCombats;
    if (combats.length === 0) return err('没找到匹配的 start_combat 事件');

    // 构造队伍
    const baseParty = JSON.parse(JSON.stringify(preset.characters || []));
    if (baseParty.length === 0) return err('preset 没有 characters');
    const recruits = [];
    if (args.includeCompanions) {
      for (const npc of (preset.npcs || [])) {
        if (npc.recruitable && npc.stats) {
          const c = JSON.parse(JSON.stringify(npc));
          c.type = 'character';
          c._isCompanion = true;
          recruits.push(c);
        }
      }
    }
    const party = [...baseParty, ...recruits];

    function resetState(p, e) {
      for (const c of p) { if (c.stats) { c.stats.hpCurrent = Math.max(1, Math.floor(c.stats.hp * args.entryHpPct)); c.stats.mpCurrent = c.stats.mp || 0; } }
      for (const en of e) { if (en.stats) { en.stats.hpCurrent = en.stats.hp; en.stats.mpCurrent = en.stats.mp || 0; } }
    }

    function simulateOne(enemyTpl) {
      const p = JSON.parse(JSON.stringify(party));
      const e = JSON.parse(JSON.stringify(enemyTpl));
      resetState(p, e);
      const gs = { activeCharacters: p, activeCombat: null, currentPhase: 'exploration' };
      combat.startCombat(gs, e);
      let safety = args.maxRounds * (p.length + e.length) * 4;
      let endResult = null;
      let lastRound = 1;
      while (safety-- > 0 && gs.activeCombat) {
        const c = gs.activeCombat;
        lastRound = c.round;
        if (c.round > args.maxRounds) { endResult = combat.endCombat(gs, 'defeat'); break; }
        const slot = c.turnOrder[c.currentActorIndex];
        if (!slot) { const r = combat.nextTurn(gs); if (r.combatEnd) { endResult = r; break; } continue; }
        const combatant = combat.findCombatant(gs, slot.id);
        if (!combatant || combatant.stats.hpCurrent <= 0) {
          const r = combat.nextTurn(gs); if (r.combatEnd) { endResult = r; break; } continue;
        }
        if (slot.type === 'character') {
          const alive = c.enemies.filter(en => en.stats.hpCurrent > 0);
          if (alive.length === 0) { endResult = combat.endCombat(gs, 'victory'); break; }
          const tgt = alive.reduce((a, b) => a.stats.hpCurrent < b.stats.hpCurrent ? a : b);
          const dmgAbs = (combatant.abilities || [])
            .filter(a => a.type === 'active' && a.effect && a.effect.damage)
            .filter(a => !a.cost?.mp || combatant.stats.mpCurrent >= a.cost.mp)
            .sort((a, b) => (b.cost?.mp || 0) - (a.cost?.mp || 0));
          const healAbs = (combatant.abilities || [])
            .filter(a => a.type === 'active' && a.effect && a.effect.heal)
            .filter(a => !a.cost?.mp || combatant.stats.mpCurrent >= a.cost.mp);
          const hpPct = combatant.stats.hpCurrent / combatant.stats.hp;
          if (hpPct < 0.3 && healAbs.length > 0) combat.useAbility(gs, slot.id, healAbs[0].id, slot.id);
          else if (dmgAbs.length > 0) combat.useAbility(gs, slot.id, dmgAbs[0].id, tgt.id);
          else combat.performAttack(gs, slot.id, tgt.id);
        } else {
          const aliveP = p.filter(x => x.stats.hpCurrent > 0);
          if (aliveP.length === 0) { endResult = combat.endCombat(gs, 'defeat'); break; }
          const tgt = aliveP.reduce((a, b) => a.stats.hpCurrent < b.stats.hpCurrent ? a : b);
          combat.performAttack(gs, slot.id, tgt.id);
        }
        const r = combat.nextTurn(gs);
        if (r.combatEnd) { endResult = r; break; }
      }
      const hpSum = p.reduce((s, c) => s + Math.max(0, c.stats.hpCurrent), 0);
      const hpMax = p.reduce((s, c) => s + c.stats.hp, 0);
      return { outcome: endResult?.result || 'timeout', rounds: lastRound, hpPct: hpMax > 0 ? hpSum / hpMax : 0 };
    }

    const lines = [`战斗平衡报告（队伍 ${party.length} 人 / 入场 HP ${(args.entryHpPct * 100).toFixed(0)}% / ${args.runs} 次模拟/战）`, ''];
    for (const c of combats) {
      const enemyMap = new Map(preset.enemies.map(e => [e.id, e]));
      const enemiesTpl = c.enemyIds.map((id, i) => {
        const t = enemyMap.get(id);
        if (!t) return null;
        const clone = JSON.parse(JSON.stringify(t));
        clone._originalId = id;
        clone.id = `${id}#${i}`;
        return clone;
      }).filter(Boolean);
      if (enemiesTpl.length === 0) continue;
      let wins = 0, winRounds = 0, winHp = 0;
      for (let i = 0; i < args.runs; i++) {
        const r = simulateOne(enemiesTpl);
        if (r.outcome === 'victory') { wins++; winRounds += r.rounds; winHp += r.hpPct; }
      }
      const winRate = wins / args.runs;
      const band = winRate >= 0.95 ? '😴 太简单' : winRate >= 0.60 ? '✓ 适中' : winRate >= 0.35 ? '⚠ 偏难' : winRate >= 0.10 ? '❌ 过难' : '☠ 不可通关';
      lines.push(`${c.isBoss ? '[BOSS]' : '[战斗]'} ${c.eventName} (${c.eventId})`);
      lines.push(`  敌人: ${enemiesTpl.map(e => `${e.name}(hp${e.stats.hp} atk${e.stats.attack})`).join(' + ')}`);
      lines.push(`  胜率: ${(winRate * 100).toFixed(1)}%  ${band}`);
      if (wins > 0) lines.push(`  胜场: 平均 ${(winRounds / wins).toFixed(1)} 回合，剩余 HP ${(winHp / wins * 100).toFixed(0)}%`);
      lines.push('');
    }
    return ok(lines.join('\n'));
  },
};

// ============================================================
// Phase 25 模板实现
// ============================================================

function applyCrpgTemplate(p) {
  // 角色创建 — 4 轴标准
  p.startingOptions = {
    races: [
      { id: 'human', name: '人类', icon: '👤', tags: ['race:human'], statBonus: {}, description: '适应力强，无明显短板' },
      { id: 'elf',   name: '精灵', icon: '🧝', tags: ['race:elf', 'longevity'], statBonus: { magicAttack: 3, hp: -10 }, description: '魔法亲和，生命脆弱' },
      { id: 'dwarf', name: '矮人', icon: '🧔', tags: ['race:dwarf', 'hardy'], statBonus: { defense: 2, speed: -1 }, description: '坚韧抗打，行动迟缓' },
    ],
    origins: [
      { id: 'noble',  name: '贵族', icon: '👑', tags: ['origin:noble', 'literate', 'wealthy:start'], description: '出身豪门，识文断字' },
      { id: 'orphan', name: '孤儿', icon: '🥀', tags: ['origin:orphan', 'street_wise'], description: '街头长大，机警敏捷' },
      { id: 'farmer', name: '农夫', icon: '🌾', tags: ['origin:farmer'], statBonus: { hp: 10 }, description: '体格健壮，朴实无华' },
    ],
    backgrounds: [
      { id: 'soldier', name: '士兵', icon: '⚔', tags: ['bg:soldier', 'weapon_trained'], statBonus: { attack: 2 }, description: '武艺娴熟' },
      { id: 'scholar', name: '学者', icon: '📚', tags: ['bg:scholar', 'literate'], statBonus: { magicAttack: 2 }, description: '博览群书' },
      { id: 'thief',   name: '盗贼', icon: '🗡', tags: ['bg:thief', 'lock_pick'], statBonus: { speed: 2, luck: 1 }, description: '身手敏捷' },
    ],
    faiths: [
      { id: 'sun',  name: '太阳神', icon: '☀', tags: ['faith:sun', 'holy'], description: '正义与光明' },
      { id: 'moon', name: '月神',  icon: '🌙', tags: ['faith:moon', 'arcane'], description: '神秘与变化' },
      { id: 'none', name: '无信仰', icon: '🚫', tags: ['faith:none', 'skeptic'], description: '只相信自己' },
    ],
  };

  // 起始场景路由
  p.startingSceneRules = [
    { when: { tags: ['origin:noble']  }, sceneId: 'scene_manor' },
    { when: { tags: ['origin:orphan'] }, sceneId: 'scene_slum' },
    { default: 'scene_village_square' },
  ];

  // 默认 combatMode 给单人
  p.combatMode = 'solo';

  // 三个起始场景 + 1 个 hub + 1 个营地
  p.scenes.push(
    { id: 'scene_manor',          name: '贵族庄园',  type: 'spawn', icon: '🏛',
      description: '清晨阳光透过雕花窗，仆人已为你备好早餐。', coords: { x: 0, y: 0 },
      connections: [{ to: 'scene_village_square', label: '走向村庄' }], events: ['ev_intro_noble'], vignettes: [], tags: ['safe', 'main'] },
    { id: 'scene_slum',           name: '贫民窟',     type: 'spawn', icon: '🥀',
      description: '潮湿的小巷，远处传来狗吠。', coords: { x: 0, y: 2 },
      connections: [{ to: 'scene_village_square', label: '溜出贫民窟' }], events: ['ev_intro_orphan'], vignettes: [], tags: ['safe', 'main'] },
    { id: 'scene_village_square', name: '村庄广场',   type: 'settlement', icon: '🏘',
      description: '熙攘的村庄中心，旅人与商贩交织。', coords: { x: 2, y: 1 },
      connections: [
        { to: 'scene_inn',         label: '进入旅馆' },
        { to: 'scene_road_north',  label: '北上探索' },
      ],
      events: ['ev_hub_intro'], vignettes: ['广场依然热闹。'], tags: ['safe', 'main', 'hub'] },
    { id: 'scene_inn',            name: '夜风旅馆',   type: 'inn', icon: '🛏',
      description: '温暖的篝火旁，旅人们交换着传闻。', coords: { x: 1, y: 1 },
      connections: [], events: [], vignettes: ['炉火依然温暖。'], tags: ['safe', 'inn'] },
    { id: 'scene_road_north',     name: '北方道路',   type: 'wilderness', icon: '🛤',
      description: '蜿蜒向北的小路，路旁的树木愈发茂密。', coords: { x: 3, y: 1 },
      connections: [{ to: 'scene_village_square', label: '回村' }], events: [], vignettes: ['寂静的道路。'], tags: ['main'] },
  );

  // 三个开场事件
  p.events.push(
    { id: 'ev_intro_noble', type: 'event', name: '继承的责任',
      description: '父亲传来书信：家族需要你出去历练。',
      eventType: 'story', priority: 100,
      trigger: { type: 'composite', condition: { inScene: ['scene_manor'], excludeCompletedEvents: ['ev_intro_noble'], probability: 1.0 } },
      choices: [{ id: 'go', text: '接受使命', requirements: null, outcomes: [{ probability: 1.0, text: '你整装出发。',
        effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }] }] }],
      repeatable: false, maxOccurrences: 1, tags: ['main'] },
    { id: 'ev_intro_orphan', type: 'event', name: '逃出生天',
      description: '帮派头目盯上了你。是时候离开了。',
      eventType: 'story', priority: 100,
      trigger: { type: 'composite', condition: { inScene: ['scene_slum'], excludeCompletedEvents: ['ev_intro_orphan'], probability: 1.0 } },
      choices: [{ id: 'flee', text: '溜进夜色', requirements: null, outcomes: [{ probability: 1.0, text: '你消失在街角。',
        effects: [{ type: 'set_variable', name: 'quest_accepted', value: true }] }] }],
      repeatable: false, maxOccurrences: 1, tags: ['main'] },
    { id: 'ev_hub_intro', type: 'event', name: '村庄广场',
      description: '广场中央，公告板上贴满了任务和警示。',
      eventType: 'story', priority: 80,
      trigger: { type: 'composite', condition: { inScene: ['scene_village_square'], requireVariables: { quest_accepted: true }, excludeCompletedEvents: ['ev_hub_intro'], probability: 1.0 } },
      choices: [{ id: 'look', text: '看看公告板', requirements: null, outcomes: [{ probability: 1.0, text: '你记下了几个值得一查的线索。', effects: [] }] }],
      repeatable: false, maxOccurrences: 1, tags: ['main'] },
  );
}

function applySurvivalTemplate(p) {
  p.startingOptions = {
    races: [{ id: 'survivor', name: '幸存者', icon: '🧗', tags: ['survivor'] }],
    backgrounds: [
      { id: 'medic',    name: '医生',   icon: '⚕', tags: ['bg:medic'],   statBonus: { magicAttack: 3 } },
      { id: 'mechanic', name: '机械师', icon: '🔧', tags: ['bg:mechanic'], statBonus: { defense: 2 } },
      { id: 'hunter',   name: '猎手',   icon: '🏹', tags: ['bg:hunter'],  statBonus: { attack: 3 } },
    ],
  };
  p.startingSceneRules = [{ default: 'scene_shelter' }];
  p.combatMode = 'solo';
  p.scenes.push(
    { id: 'scene_shelter',  name: '避难所', type: 'spawn', icon: '🏚',
      description: '残破的混凝土避难所，残存的电力让一盏灯泡微亮。', coords: { x: 0, y: 0 },
      connections: [{ to: 'scene_ruins', label: '走出避难所' }], events: ['ev_wakeup'], vignettes: [], tags: ['safe', 'main'] },
    { id: 'scene_ruins', name: '城市废墟', type: 'wilderness', icon: '🏚',
      description: '破败的高楼，远处偶有金属碰撞声。', coords: { x: 1, y: 0 },
      connections: [{ to: 'scene_shelter', label: '回避难所' }], events: [], vignettes: ['废墟依然寂静。'], tags: ['main'] },
  );
  p.events.push(
    { id: 'ev_wakeup', type: 'event', name: '苏醒',
      description: '你从冷柜里爬出来。世界已经不是你记忆中的样子了。',
      eventType: 'story', priority: 100,
      trigger: { type: 'composite', condition: { inScene: ['scene_shelter'], excludeCompletedEvents: ['ev_wakeup'], probability: 1.0 } },
      choices: [{ id: 'go', text: '走出避难所', requirements: null, outcomes: [{ probability: 1.0, text: '你深吸一口气，推开金属门。',
        effects: [{ type: 'set_variable', name: 'awakened', value: true }] }] }],
      repeatable: false, maxOccurrences: 1, tags: ['main'] },
  );
}

function applyMysteryTemplate(p) {
  p.startingOptions = {
    races: [{ id: 'detective', name: '侦探', icon: '🕵', tags: ['detective'] }],
    backgrounds: [
      { id: 'observant', name: '善于观察', tags: ['bg:observant'], statBonus: { luck: 3 } },
      { id: 'persuasive', name: '善于说服', tags: ['bg:persuasive'], statBonus: { magicAttack: 2 } },
    ],
  };
  p.startingSceneRules = [{ default: 'scene_office' }];
  p.combatMode = 'solo';
  p.scenes.push(
    { id: 'scene_office', name: '事务所', type: 'spawn', icon: '🏢',
      description: '雨夜里的小事务所，桌上放着一封刚送到的信。', coords: { x: 0, y: 0 },
      connections: [{ to: 'scene_crime_scene', label: '前往现场' }], events: ['ev_letter'], vignettes: [], tags: ['safe', 'main'] },
    { id: 'scene_crime_scene', name: '案发现场', type: 'vignette', icon: '🔍',
      description: '警戒线后的小巷，雨水冲刷着证据。', coords: { x: 1, y: 0 },
      connections: [{ to: 'scene_office', label: '回事务所' }], events: [], vignettes: ['现场仍未清理。'], tags: ['main'] },
  );
  p.events.push(
    { id: 'ev_letter', type: 'event', name: '匿名信',
      description: '一封没有署名的信件 — 委托你调查一桩"无人记得的失踪"。',
      eventType: 'story', priority: 100,
      trigger: { type: 'composite', condition: { inScene: ['scene_office'], excludeCompletedEvents: ['ev_letter'], probability: 1.0 } },
      choices: [
        { id: 'accept', text: '接下委托', requirements: null, outcomes: [{ probability: 1.0, text: '你戴上礼帽，走入雨中。', effects: [{ type: 'set_variable', name: 'case_accepted', value: true }] }] },
        { id: 'decline', text: '不感兴趣', requirements: null, outcomes: [{ probability: 1.0, text: '你把信扔进了壁炉。', effects: [{ type: 'set_variable', name: 'case_declined', value: true }] }] },
      ],
      repeatable: false, maxOccurrences: 1, tags: ['main'] },
  );
}

// ---------- 批量原子操作 ----------
tools.preset_batch_apply = {
  title: '批量应用操作',
  description: '一次性执行多个操作，全部成功才提交。每个 op 形如 { tool: "scene_create", args: {...} }。建议 AI 用此一次性吐出整个剧本骨架（场景 + 事件 + 角色 + 敌人 + 物品）。',
  schema: {
    ops: z.array(z.object({
      tool: z.string().describe('要调用的工具名（如 "scene_create" / "event_create"）'),
      args: z.record(z.any()).describe('对应的参数对象'),
    })),
    autoSave: z.boolean().default(true),
  },
  handler: async (args) => {
    const backup = JSON.parse(JSON.stringify(preset));
    const results = [];
    try {
      for (const op of args.ops) {
        const t = tools[op.tool];
        if (!t) throw new Error(`未知工具: ${op.tool}`);
        if (op.tool === 'preset_batch_apply') throw new Error('不能在 batch 内嵌套 batch');
        const r = await t.handler(op.args || {});
        if (r.isError) throw new Error(`${op.tool} 失败：${r.content[0].text}`);
        const msg = r.content[0].text;
        results.push(`✓ ${op.tool}: ${msg.length > 100 ? msg.slice(0, 100) + '...' : msg}`);
      }
      if (args.autoSave) saveToDisk();
      return ok(`批量成功，共 ${results.length} 个操作：\n${results.join('\n')}`);
    } catch (e) {
      preset = backup;
      dirty = false;
      return err(`批量失败已回滚：${e.message}`);
    }
  },
};

// ============================================================
// 注册到 MCP server
// ============================================================
const server = new McpServer({ name: 'trpg-preset-editor', version: '1.0.0' });

for (const [name, def] of Object.entries(tools)) {
  server.registerTool(name, {
    title: def.title,
    description: def.description,
    inputSchema: def.schema,
  }, def.handler);
}

// ---------- 启动 ----------
loadFromDisk();
console.error(`[mcp] TRPG 预设编辑器启动`);
console.error(`[mcp] 当前预设文件: ${filePath}`);
console.error(`[mcp] 加载状态: ${preset.name} (${preset.scenes.length} 节点 / ${preset.events.length} 事件)`);
console.error(`[mcp] 暴露工具数: ${Object.keys(tools).length}`);

const transport = new StdioServerTransport();
await server.connect(transport);
