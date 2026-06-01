/**
 * 实时多人 WebSocket 对局服务器（核心，可被 jest 测试）
 *
 * 与 MCP 对局服务（请求-响应，AI 席）互补：真人实时多人的传输适配器——
 * 同一个权威核心 GameSession，换 WebSocket 传输，实现服务器→客户端推送
 * （任一席位行动后，所有席位即时收到新状态）。
 *
 * CLI 入口在 mcp-server/game-ws-server.mjs（薄包装，负责命令行与 Node 全局 shim）。
 *
 * 协议（JSON over WS）：
 *   服务器→客户端：{type:'welcome',seatId,isHost,state} / {type:'state',state,by?}
 *                  / {type:'authority',level,by} / {type:'host',isHost,seatId} / {type:'error',message}
 *   客户端→服务器：{type:'action',action} / {type:'sync'} / {type:'set_authority',level}
 * 席位模型（v1）：共享控制（hot-seat），任一席位都可行动；
 *   房主席位（首个连接者）独占"调 AI 参与度"权限（set_authority），离线则提升下一席位。
 *   席位→角色绑定留待后续。
 */

import { WebSocketServer } from 'ws';
import { GameSession } from '../core/GameSession.js';
import { DEFAULT_PRESET } from '../data/defaultPreset.js';

// headless 环境 shim（Node CLI 下需要；jsdom 测试环境已自带，||= 不覆盖）
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

/**
 * @param {object} opts
 * @param {number} [opts.port=8787]   0=随机端口（测试用）
 * @param {object} [opts.presetData]  预设对象（省略=默认预设）
 * @param {object} [opts.creation]    角色创建选择
 * @param {object} [opts.ai]          GM 接入（{endpoint,model,apiKey,apiStyle}）
 * @param {string} [opts.combatMode='interactive']
 * @returns {Promise<{wss, session, port, close}>}
 */
export async function startGameWsServer(opts = {}) {
  const presetData = opts.presetData || DEFAULT_PRESET;
  const session = new GameSession({ combatMode: opts.combatMode || 'interactive' });
  if (opts.ai?.endpoint && opts.ai?.model) {
    session.configureAI({
      endpoint: opts.ai.endpoint, model: opts.ai.model,
      apiKey: opts.ai.apiKey || '', maxTokens: 3200, temperature: 0.7,
      timeoutMs: opts.ai.timeoutMs || 60000,
      ...(opts.ai.apiStyle ? { apiStyle: opts.ai.apiStyle } : {}),
    });
  }
  session.loadPreset(presetData, opts.creation || null);
  await session.kickoff();

  const wss = new WebSocketServer({ port: opts.port ?? 8787 });
  let seatSeq = 0;
  const send = (ws, msg) => { try { ws.send(JSON.stringify(msg)); } catch { /* closed */ } };
  const broadcast = (msg) => { for (const c of wss.clients) if (c.readyState === c.OPEN) send(c, msg); };

  let applying = false; // 串行化动作，避免并发改同一份权威状态
  async function handleAction(seatId, action) {
    while (applying) await new Promise(r => setTimeout(r, 10));
    applying = true;
    try {
      const state = await session.applyAction(action);
      broadcast({ type: 'state', state, by: seatId });
    } catch (e) {
      broadcast({ type: 'error', message: `动作失败: ${e.message}` });
    } finally {
      applying = false;
    }
  }

  // 房主席位：首个连接者；只有房主能调 AI 参与度。房主断线则提升下一个在线席位。
  let hostSeatId = null;
  const clamp4 = (v) => Math.max(0, Math.min(4, Math.round(Number(v)) || 0));

  wss.on('connection', (ws) => {
    const seatId = `seat_${++seatSeq}`;
    ws._seatId = seatId;
    if (!hostSeatId) hostSeatId = seatId;
    send(ws, { type: 'welcome', seatId, isHost: seatId === hostSeatId, state: session.getState() });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: '非法 JSON' }); }
      if (msg.type === 'action') {
        handleAction(seatId, msg.action || {});
      } else if (msg.type === 'sync') {
        send(ws, { type: 'state', state: session.getState() });
      } else if (msg.type === 'set_authority') {
        // 席位权限校验：仅房主可调参与度
        if (seatId !== hostSeatId) {
          return send(ws, { type: 'error', message: '只有房主可以调整 AI 参与度' });
        }
        const lv = clamp4(msg.level);
        session.gameState.aiAuthority = lv;
        broadcast({ type: 'authority', level: lv, by: seatId });
        broadcast({ type: 'state', state: session.getState(), by: seatId });
      }
    });

    ws.on('close', () => {
      // 房主离开 → 提升下一个在线席位为房主并通知
      if (ws._seatId === hostSeatId) {
        hostSeatId = null;
        for (const c of wss.clients) {
          if (c.readyState === c.OPEN && c._seatId) { hostSeatId = c._seatId; send(c, { type: 'host', isHost: true, seatId: c._seatId }); break; }
        }
      }
    });
  });

  const port = await new Promise((resolve) => {
    const addr = wss.address();
    if (addr && typeof addr === 'object') return resolve(addr.port);
    wss.on('listening', () => resolve(wss.address().port));
  });

  function close() {
    return new Promise((resolve) => {
      for (const c of wss.clients) { try { c.terminate(); } catch { /* */ } }
      wss.close(() => { try { session.destroy(); } catch { /* */ } resolve(); });
    });
  }

  return { wss, session, port, close };
}
