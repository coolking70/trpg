#!/usr/bin/env node
/**
 * TRPG 对局（运行期）MCP 服务器
 *
 * 与 preset-server.mjs（创作期：改预设 JSON）相对——这是**运行期**服务：
 * 把权威对局核心 GameSession 暴露为 MCP 工具，让任意 MCP 客户端（AI 占位玩家 /
 * 自动化测试 / 未来的多人席位适配器）通过"动作-状态"边界来推进一局游戏。
 *
 * 工具：
 *   session_start  载入预设并开局，返回初始状态
 *   session_state  返回当前状态快照
 *   session_act    执行一个动作（choose/travel/use_item/say），返回新状态
 *
 * 设计意图见 src/core/GameSession.js 顶部注释：核心与传输解耦，
 *   现在用 MCP（适合 AI 席 / 测试），以后真人实时多人换 WebSocket 适配器即可。
 *
 * 启动：
 *   node mcp-server/game-session-server.mjs
 * 可选环境变量（配置本地/远端 AI GM；不配置则走 localFallback，游戏仍可推进）：
 *   OPENAI_BASE_URL (默认 http://127.0.0.1:1234/v1)
 *   OPENAI_MODEL    (默认 qwen/qwen3.6-35b-a3b)
 *   OPENAI_API_KEY
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- headless 环境补丁（浏览器全局）----------
globalThis.requestAnimationFrame ||= (cb) => setTimeout(() => cb(Date.now()), 16);
globalThis.cancelAnimationFrame ||= (id) => clearTimeout(id);
globalThis.localStorage ||= (() => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
})();

const { GameSession } = await import('../src/core/GameSession.js');
const { DEFAULT_PRESET } = await import('../src/data/defaultPreset.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------- 全局会话（单局；多席位/多局可后续扩展为 Map）----------
let session = null;

function ok(text) { return { content: [{ type: 'text', text }] }; }
function err(text) { return { content: [{ type: 'text', text }], isError: true }; }

/** 把 getState() 快照渲染成给 MCP 客户端读的紧凑文本 + 结构化 JSON */
function renderState(state) {
  if (!state || !state.ready) return '（对局未开始，请先调用 session_start）';
  const lines = [];
  lines.push(`■ 局面: ${state.situation}` + (state.scene ? ` @ ${state.scene.name}(${state.scene.id})` : ''));
  lines.push(`■ 队伍: ${state.party.map(p => `${p.name} ${p.hp}/${p.hpMax}(${p.hpPct}%)${p.alive ? '' : '✗'}`).join(' / ')}`);
  if (state.mainQuestComplete) lines.push('★ 主线已完成');
  if (state.partyWiped) lines.push('✗ 全队倒下');
  lines.push(`■ 进度: 场景 ${state.progress.scenesVisited}/${state.progress.scenesTotal} · 事件 ${state.progress.eventsCompleted}/${state.progress.eventsTotal} · Day ${state.storyTime.day} ${state.storyTime.hour}:00`);

  const gm = state.narrative.filter(n => n.speaker === 'gm').slice(-2);
  if (gm.length) lines.push('\n— 最近叙述 —\n' + gm.map(n => n.text).join('\n'));
  if (state.event) lines.push(`\n— 事件: ${state.event.name} —`);

  lines.push('\n— 可选动作 —');
  if (state.situation === 'combat') {
    lines.push('（战斗进行中，由核心自动结算；下次状态会是战斗结果）');
  } else if (state.options.length === 0) {
    lines.push('（无）');
  } else {
    for (const o of state.options) {
      if (o.type === 'choose') lines.push(`  [${o.n}] 选择: ${o.text}  → session_act {type:"choose", n:${o.n}}`);
      else if (o.type === 'travel') lines.push(`  [${o.n}] 前往: ${o.text} → ${o.sceneName}${o.visited ? '(去过)' : ''}  → session_act {type:"travel", n:${o.n}}`);
    }
  }
  if (state.usableItems.length) {
    lines.push('— 可用消耗品 —');
    for (const it of state.usableItems) lines.push(`  ${it.name} (${it.itemId}, 持有:${it.ownerId})  → session_act {type:"use_item", itemId:"${it.itemId}"}`);
  }

  return lines.join('\n') + '\n\n```json\n' + JSON.stringify(state, null, 0) + '\n```';
}

/** 解析 session_act 入参为 GameSession action（支持用序号 n 选项）*/
function resolveAction(args) {
  const state = session.getState();
  // 用序号 n 选项时，从当前 options 解析
  if (args.n !== undefined && (!args.type || args.type === 'choose' || args.type === 'travel')) {
    const opt = (state.options || []).find(o => o.n === args.n);
    if (!opt) throw new Error(`序号 ${args.n} 不在当前可选动作内`);
    if (opt.type === 'choose') return { type: 'choose', choiceId: opt.choiceId };
    if (opt.type === 'travel') return { type: 'travel', sceneId: opt.sceneId };
  }
  if (args.type === 'choose') return { type: 'choose', choiceId: args.choiceId };
  if (args.type === 'travel') return { type: 'travel', sceneId: args.sceneId };
  if (args.type === 'use_item') return { type: 'use_item', itemId: args.itemId, ownerId: args.ownerId, targetId: args.targetId };
  if (args.type === 'say') return { type: 'say', text: args.text };
  throw new Error('无法解析动作：请提供 {type 与对应字段} 或 {n}');
}

function resolvePresetPath(p) {
  if (!p) return null;
  if (fs.existsSync(p)) return p;
  // 当作 presets/ 下的名字
  const inPresets = path.join(ROOT, 'presets', p.endsWith('.json') ? p : `${p}.json`);
  if (fs.existsSync(inPresets)) return inPresets;
  return null;
}

// ============================================================
// 工具定义
// ============================================================
const tools = {
  session_start: {
    title: '开始对局',
    description: '载入预设并开局。presetPath 可为文件路径或 presets/ 下的名字；省略则用内置默认预设。可传 creation（race/origin/background/faith 选择）与 ai（GM 接入配置）。返回初始状态。',
    schema: {
      presetPath: z.string().optional().describe('预设 JSON 路径，或 presets/ 下的文件名；省略=默认预设'),
      creation: z.object({
        races: z.string().optional(), origins: z.string().optional(),
        backgrounds: z.string().optional(), faiths: z.string().optional(),
      }).optional().describe('角色创建选择（仅当预设含 startingOptions 时生效）'),
      ai: z.object({
        endpoint: z.string().optional(), apiKey: z.string().optional(), model: z.string().optional(),
      }).optional().describe('AI GM 接入；省略则用环境变量，再省略则走 localFallback'),
    },
    handler: async (args) => {
      let presetData = DEFAULT_PRESET;
      let label = '默认预设';
      if (args.presetPath) {
        const resolved = resolvePresetPath(args.presetPath);
        if (!resolved) return err(`找不到预设: ${args.presetPath}`);
        presetData = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
        label = path.basename(resolved);
      }
      if (session) { try { session.destroy(); } catch { /* */ } }
      session = new GameSession();
      // AI 配置：显式 > 环境变量 > 不配置
      const endpoint = args.ai?.endpoint || process.env.OPENAI_BASE_URL;
      const model = args.ai?.model || process.env.OPENAI_MODEL;
      if (endpoint && model) {
        session.configureAI({
          endpoint, model,
          apiKey: args.ai?.apiKey || process.env.OPENAI_API_KEY || '',
          maxTokens: 3200, temperature: 0.7,
          timeoutMs: parseInt(process.env.OPENAI_TIMEOUT_MS || '60000', 10),
        });
      }
      try {
        session.loadPreset(presetData, args.creation || null);
        await session.kickoff();
      } catch (e) {
        return err(`开局失败: ${e.message}`);
      }
      return ok(`✓ 已开局：${presetData.name}（${label}）\n` + renderState(session.getState()));
    },
  },

  session_state: {
    title: '查看当前状态',
    description: '返回当前对局的状态快照（局面/队伍/最近叙述/可选动作/进度）。',
    schema: {},
    handler: async () => {
      if (!session) return err('对局未开始，请先 session_start');
      return ok(renderState(session.getState()));
    },
  },

  session_act: {
    title: '执行动作',
    description: '推进一个玩家动作并返回新状态。可用 {n} 按当前选项序号出招（最省事），或显式 {type, ...}：choose(choiceId) / travel(sceneId) / use_item(itemId[,ownerId,targetId]) / say(text)。触发战斗时核心自动结算。',
    schema: {
      n: z.number().int().optional().describe('按当前 options 序号选择（choose/travel 通用）'),
      type: z.enum(['choose', 'travel', 'use_item', 'say']).optional(),
      choiceId: z.string().optional(),
      sceneId: z.string().optional(),
      itemId: z.string().optional(),
      ownerId: z.string().optional(),
      targetId: z.string().optional(),
      text: z.string().optional(),
    },
    handler: async (args) => {
      if (!session) return err('对局未开始，请先 session_start');
      let action;
      try { action = resolveAction(args); }
      catch (e) { return err(e.message); }
      const state = await session.applyAction(action);
      return ok(renderState(state));
    },
  },
};

// ============================================================
// 注册
// ============================================================
const server = new McpServer({ name: 'trpg-game-session', version: '1.0.0' });
for (const [name, def] of Object.entries(tools)) {
  server.registerTool(name, { title: def.title, description: def.description, inputSchema: def.schema }, def.handler);
}

console.error('[mcp] TRPG 对局服务器启动');
console.error(`[mcp] 暴露工具: ${Object.keys(tools).join(', ')}`);
console.error(`[mcp] AI GM: ${process.env.OPENAI_BASE_URL ? `${process.env.OPENAI_BASE_URL} / ${process.env.OPENAI_MODEL || '(未指定模型)'}` : '(未配置, 走 localFallback)'}`);

const transport = new StdioServerTransport();
await server.connect(transport);
