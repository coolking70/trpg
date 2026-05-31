#!/usr/bin/env node
/**
 * LLM-as-MCP-client 测试：让本地模型（OpenAI 兼容）通过 MCP 工具生成剧本
 *
 * 链路：
 *   本地 qwen ──tool_calls──▶ 本 harness ──JSON-RPC/stdio──▶ preset-server.mjs
 *        ▲                                                          │
 *        └────────────── tool result 回灌 ◀────────────────────────┘
 *
 * 用法：
 *   node scripts/mcp-llm-agent.mjs
 *   MIMO_ENDPOINT=http://127.0.0.1:1234/v1 MODEL=qwen/qwen3.6-35b-a3b node scripts/mcp-llm-agent.mjs
 *   node scripts/mcp-llm-agent.mjs --task "做一份沼泽探险小剧本" --max-iter 20
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'mcp-server', 'preset-server.mjs');

const argv = process.argv.slice(2);
const argVal = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

const ENDPOINT = process.env.MIMO_ENDPOINT || 'http://127.0.0.1:1234/v1';
const MODEL = process.env.MODEL || 'qwen/qwen3.6-35b-a3b';
const API_KEY = process.env.MIMO_KEY || '';
const MAX_ITER = parseInt(argVal('--max-iter', '24'), 10);
const TASK = argVal('--task',
  '做一份"沼泽探险"小剧本，目标实体：1 个主角、1 个沼泽敌人(difficulty=normal)、' +
  '2 个场景并连成一条路、1 个事件。' +
  '建好敌人后调用一次 enemy_assign_ecology(biome=swamp,creatureType=beast) 烘焙生态掉落。' +
  '最后调用 preset_validate。');

// 只暴露建小剧本需要的工具子集（避免 63 个 schema 撑爆上下文）
const TOOL_WHITELIST = new Set([
  'preset_set_meta', 'preset_info', 'preset_validate',
  'character_create', 'enemy_create', 'item_create',
  'scene_create', 'scene_add_connection', 'scene_attach_event',
  'event_create', 'ecology_vocab', 'enemy_assign_ecology',
]);

const TMP = path.join(os.tmpdir(), `trpg-mcp-agent-${Date.now()}.json`);

// ============================================================
// MCP stdio 客户端
// ============================================================
class StdioClient {
  constructor(serverPath, presetPath) {
    this.proc = spawn('node', [serverPath, presetPath], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.nextId = 1; this.pending = new Map(); this.buffer = '';
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf-8');
      let nl;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve } = this.pending.get(msg.id);
            this.pending.delete(msg.id); resolve(msg);
          }
        } catch { /* ignore */ }
      }
    });
  }
  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 15000);
    });
  }
  async initialize() {
    await this.send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'llm-agent', version: '1' } });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }
  async listTools() {
    const r = await this.send('tools/list', {});
    return r.result?.tools || [];
  }
  async call(name, args) {
    const r = await this.send('tools/call', { name, arguments: args || {} });
    if (r.error) return { isError: true, text: JSON.stringify(r.error) };
    return { isError: !!r.result?.isError, text: r.result?.content?.[0]?.text || '' };
  }
  close() { try { this.proc.stdin.end(); this.proc.kill(); } catch { /* */ } }
}

// ============================================================
// 本地模型调用
// ============================================================
async function chat(messages, tools, toolChoice = 'auto') {
  const resp = await fetch(`${ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
    // max_tokens 给足，避免 reasoning 把预算用光导致 tool_call 被截断
    body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: toolChoice, temperature: 0.2, max_tokens: 1500 }),
  });
  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const choice = data.choices?.[0] || {};
  return { msg: choice.message || {}, finish: choice.finish_reason, usage: data.usage };
}

// MCP 工具 → OpenAI function spec
function toOpenAITools(mcpTools) {
  return mcpTools
    .filter(t => TOOL_WHITELIST.has(t.name))
    .map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: (t.description || '').slice(0, 400),
        parameters: t.inputSchema || { type: 'object', properties: {} },
      },
    }));
}

// ============================================================
// 主循环
// ============================================================
async function main() {
  console.log('=== LLM-as-MCP-client 剧本生成测试 ===');
  console.log(`模型: ${MODEL} @ ${ENDPOINT}`);
  console.log(`输出: ${TMP}\n`);

  if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
  const client = new StdioClient(SERVER, TMP);
  await client.initialize();

  const allTools = await client.listTools();
  const tools = toOpenAITools(allTools);
  console.log(`MCP 暴露 ${allTools.length} 工具，本次给模型 ${tools.length} 个：${tools.map(t => t.function.name).join(', ')}\n`);

  const toolCallStats = { total: 0, ok: 0, error: 0, byTool: {} };
  let done = false;

  // —— 无状态逐步驱动：每轮全新最小上下文，不累积 tool-role 协议历史 ——
  //   （qwen 等本地思考模型在多轮 tool 历史下会退化成"伪造 tool_output 文本"）
  const completedLog = [];   // 已完成步骤的简短描述
  let lastResult = null;     // 上一步工具结果（回灌给模型自纠）
  const sysPrompt = '你是 TRPG 剧本生成助手，通过工具一步步搭建剧本。' +
    '每次只调用【一个】工具完成下一个还没做的步骤。不要一次规划全部，不要在文字里伪造工具结果。' +
    '当所有实体都建好、且最后一次 preset_validate 通过时，不要再调工具，直接回复纯文本 DONE。';

  for (let iter = 1; iter <= MAX_ITER && !done; iter++) {
    // 当前真实进度（从 MCP 查）
    const info = JSON.parse((await client.call('preset_info')).text);
    const c = info.counts;
    const stateLine = `当前进度：场景${c.scenes} 事件${c.events} 角色${c.characters} 敌人${c.enemies} 物品${c.items}`;
    const doneLine = completedLog.length ? `已完成：${completedLog.slice(-12).join('；')}` : '尚未开始';
    // 把已存在实体的真实 id 喂给模型，避免它猜错 id（如把 enemy_001 猜成 enemy_1）
    const idsLine = [
      info.enemyIds?.length ? `敌人id: ${info.enemyIds.join(',')}` : '',
      info.sceneIds?.length ? `场景id: ${info.sceneIds.join(',')}` : '',
      info.characterIds?.length ? `角色id: ${info.characterIds.join(',')}` : '',
      info.itemIds?.length ? `物品id: ${info.itemIds.join(',')}` : '',
    ].filter(Boolean).join('；');
    // 上一步结果（尤其错误）回灌，让模型能自我纠正
    const lastLine = lastResult ? `上一步 ${lastResult.name} → ${lastResult.text.slice(0, 160)}` : '';

    const messages = [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: `${TASK}\n\n${stateLine}\n${idsLine ? '已有实体 id：' + idsLine + '\n' : ''}${doneLine}\n${lastLine ? lastLine + '\n' : ''}\n请调用下一个工具（只一个）。引用已有实体时必须用上面列出的真实 id。全部完成且 validate 通过后回复 DONE。` },
    ];

    const t0 = Date.now();
    let res;
    try { res = await chat(messages, tools, 'auto'); }
    catch (e) { console.error(`[iter ${iter}] LLM 调用失败: ${e.message}`); break; }
    const msg = res.msg;
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const calls = msg.tool_calls || [];

    if (calls.length === 0) {
      const txt = (msg.content || '').trim();
      console.log(`[iter ${iter}] (${dt}s, finish=${res.finish}) 无工具调用，回复: ${txt.slice(0, 100)}`);
      if (/done/i.test(txt)) { done = true; break; }
      // 无调用也无 DONE：重试用 required 强制
      try { res = await chat(messages, tools, 'required'); } catch { /* */ }
      const calls2 = res.msg?.tool_calls || [];
      if (calls2.length === 0) { console.log('   (required 仍无调用，跳过本轮)'); continue; }
      msg.tool_calls = calls2;
    }

    // 只执行第一个工具调用（无状态逐步）
    const tc = (msg.tool_calls || [])[0];
    const name = tc.function?.name;
    let args = {};
    try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* */ }
    toolCallStats.total++;
    toolCallStats.byTool[name] = (toolCallStats.byTool[name] || 0) + 1;

    let result;
    if (!TOOL_WHITELIST.has(name)) result = { isError: true, text: `工具 ${name} 不可用` };
    else result = await client.call(name, args);
    if (result.isError) toolCallStats.error++; else toolCallStats.ok++;

    const flag = result.isError ? '✗' : '✓';
    console.log(`[iter ${iter}] (${dt}s) ${flag} ${name}(${JSON.stringify(args).slice(0, 70)}) → ${result.text.slice(0, 70)}`);
    completedLog.push(`${name}${result.isError ? '(失败)' : ''}`);
    lastResult = { name, text: result.text, isError: result.isError };

    // validate 通过即可结束
    if (name === 'preset_validate' && !result.isError && /通过/.test(result.text)) {
      console.log('   preset_validate 通过 → 收工');
      done = true;
    }
  }

  // 结果验证
  console.log('\n=== 生成结果 ===');
  const info = JSON.parse(await client.call('preset_info').then(r => r.text));
  console.log(`剧本名: ${info.name}`);
  console.log(`计数: ${info.counts.scenes} 场景 / ${info.counts.events} 事件 / ${info.counts.characters} 角色 / ${info.counts.enemies} 敌人 / ${info.counts.items} 物品`);
  const validate = await client.call('preset_validate');
  console.log(`校验: ${validate.text}`);

  console.log('\n=== 工具调用统计 ===');
  console.log(`总计 ${toolCallStats.total} 次（成功 ${toolCallStats.ok} / 失败 ${toolCallStats.error}）`);
  console.log(`分布: ${JSON.stringify(toolCallStats.byTool)}`);
  console.log(`\n剧本已写入: ${TMP}`);

  client.close();
  // 判定
  const success = info.counts.scenes >= 2 && info.counts.enemies >= 1 && toolCallStats.ok >= 5;
  console.log(`\n=== 判定: ${success ? '✅ 本地模型成功通过 MCP 生成了剧本' : '⚠ 生成不完整，见上方统计'} ===`);
  process.exit(success ? 0 : 1);
}

main().catch(e => { console.error('harness 崩溃:', e); process.exit(2); });
