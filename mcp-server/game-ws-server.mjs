#!/usr/bin/env node
/**
 * TRPG 实时多人 WebSocket 对局服务器 —— CLI 包装。
 * 核心逻辑在 src/server/gameWsServer.js（可被 jest 测试）。本文件只负责命令行参数与启动。
 *
 * 架构：核心 GameSession 与传输解耦——
 *   MCP 适配器（game-session-server.mjs）请求-响应，AI 席；本文件 WS 实时推送，真人多人。
 *
 * 启动：node mcp-server/game-ws-server.mjs [--port 8787] [--preset presets/foo.json]
 *   GM 接入：OPENAI_BASE_URL / OPENAI_MODEL / OPENAI_API_STYLE / OPENAI_API_KEY（省略走 localFallback）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGameWsServer } from '../src/server/gameWsServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const argVal = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const port = parseInt(argVal('--port', '8787'), 10);
const presetArg = argVal('--preset', null);

let presetData;
if (presetArg) {
  const resolved = fs.existsSync(presetArg) ? presetArg
    : path.join(ROOT, 'presets', presetArg.endsWith('.json') ? presetArg : `${presetArg}.json`);
  if (!fs.existsSync(resolved)) { console.error(`[ws] 找不到预设: ${presetArg}`); process.exit(1); }
  presetData = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}

const ai = (process.env.OPENAI_BASE_URL && process.env.OPENAI_MODEL) ? {
  endpoint: process.env.OPENAI_BASE_URL, model: process.env.OPENAI_MODEL,
  apiKey: process.env.OPENAI_API_KEY || '',
  apiStyle: process.env.OPENAI_API_STYLE,
  timeoutMs: parseInt(process.env.OPENAI_TIMEOUT_MS || '60000', 10),
} : undefined;

const { port: p } = await startGameWsServer({ port, presetData, ai });
console.error(`[ws] TRPG 实时多人对局服务器监听 ws://localhost:${p}`);
console.error(`[ws] 预设: ${presetArg || '默认'} | GM: ${ai ? ai.model : '(localFallback)'}`);
console.error('[ws] 协议: 客户端发 {type:"action",action} / {type:"sync"}；服务器推 {type:"welcome"|"state"|"error"}');
