/**
 * @jest-environment node
 *
 * WebSocket 实时多人对局服务器测试
 * 验证核心价值：服务器→客户端推送——任一席位行动后，所有连接的席位即时收到新状态。
 * 用 node 环境：jsdom 会把 ws 解析为浏览器 stub 且缺 fetch。
 */

import WebSocket from 'ws';
import { startGameWsServer } from '../../src/server/gameWsServer.js';

// 连接即缓冲所有消息（避免 welcome 在挂监听前就到达的竞态）
function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws._buf = [];
    ws._waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      ws._buf.push(msg);
      ws._waiters = ws._waiters.filter(w => {
        if (w.pred(msg)) { w.resolve(msg); return false; }
        return true;
      });
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
function nextMessage(ws, predicate = () => true) {
  // 先扫已缓冲（并消费）
  const i = ws._buf.findIndex(predicate);
  if (i >= 0) { const [m] = ws._buf.splice(i, 1); return Promise.resolve(m); }
  return new Promise((resolve) => ws._waiters.push({ pred: predicate, resolve }));
}

describe('WebSocket 实时多人对局服务器', () => {
  let srv;
  beforeAll(async () => {
    const origRandom = Math.random;
    Math.random = () => 0.3; // 确定性
    srv = await startGameWsServer({ port: 0 }); // 0 = 随机端口；无 GM → localFallback
    Math.random = origRandom;
  }, 30000);

  afterAll(async () => { if (srv) await srv.close(); });

  test('连接即收到 welcome + 当前状态快照', async () => {
    const a = await connect(srv.port);
    const welcome = await nextMessage(a, m => m.type === 'welcome');
    expect(welcome.seatId).toMatch(/^seat_/);
    expect(welcome.state?.ready).toBe(true);
    a.close();
  }, 30000);

  test('任一席位行动 → 所有席位收到 state 广播（实时推送）', async () => {
    const a = await connect(srv.port);
    const wa = await nextMessage(a, m => m.type === 'welcome');
    const b = await connect(srv.port);
    await nextMessage(b, m => m.type === 'welcome');

    // 两个客户端都监听 state 广播
    const aGot = nextMessage(a, m => m.type === 'state');
    const bGot = nextMessage(b, m => m.type === 'state');

    // A 提交一个动作：默认预设开局是事件 ch1，选 accept_quest
    const opt = (wa.state.options || [])[0]; // 取首个可选项（choose）
    a.send(JSON.stringify({ type: 'action', action: { type: 'choose', choiceId: opt?.choiceId } }));

    const [ma, mb] = await Promise.all([aGot, bGot]);
    // 关键：B（未行动方）也收到了广播 → 服务器主动推送成立
    expect(ma.type).toBe('state');
    expect(mb.type).toBe('state');
    expect(mb.by).toMatch(/^seat_/);
    expect(mb.state.ready).toBe(true);

    a.close(); b.close();
  }, 30000);

  // 房主相关用例需要干净的服务器（hostSeatId 是服务器级状态），各自独立起一个
  test('首个连接者是房主，后续席位非房主', async () => {
    const s = await startGameWsServer({ port: 0 });
    try {
      const a = await connect(s.port);
      expect((await nextMessage(a, m => m.type === 'welcome')).isHost).toBe(true);
      const b = await connect(s.port);
      expect((await nextMessage(b, m => m.type === 'welcome')).isHost).toBe(false);
      a.close(); b.close();
    } finally { await s.close(); }
  }, 30000);

  test('房主 set_authority → gameState.aiAuthority 改变并广播给所有席位', async () => {
    const s = await startGameWsServer({ port: 0 });
    try {
      const a = await connect(s.port); // 房主
      await nextMessage(a, m => m.type === 'welcome');
      const b = await connect(s.port);
      await nextMessage(b, m => m.type === 'welcome');
      const aAuth = nextMessage(a, m => m.type === 'authority');
      const bAuth = nextMessage(b, m => m.type === 'authority');
      a.send(JSON.stringify({ type: 'set_authority', level: 4 }));
      const [ma, mb] = await Promise.all([aAuth, bAuth]);
      expect(ma.level).toBe(4);
      expect(mb.level).toBe(4); // 非房主也收到广播
      expect(s.session.gameState.aiAuthority).toBe(4);
      a.close(); b.close();
    } finally { await s.close(); }
  }, 30000);

  test('非房主 set_authority → 被拒，参与度不变', async () => {
    const s = await startGameWsServer({ port: 0 });
    try {
      const a = await connect(s.port); // 房主
      await nextMessage(a, m => m.type === 'welcome');
      const b = await connect(s.port); // 非房主
      await nextMessage(b, m => m.type === 'welcome');
      s.session.gameState.aiAuthority = 2;
      const bErr = nextMessage(b, m => m.type === 'error');
      b.send(JSON.stringify({ type: 'set_authority', level: 4 }));
      expect((await bErr).message).toContain('房主');
      expect(s.session.gameState.aiAuthority).toBe(2); // 未改
      a.close(); b.close();
    } finally { await s.close(); }
  }, 30000);

  test('sync 主动拉取当前状态', async () => {
    const a = await connect(srv.port);
    await nextMessage(a, m => m.type === 'welcome');
    a.send(JSON.stringify({ type: 'sync' }));
    const st = await nextMessage(a, m => m.type === 'state');
    expect(st.state.ready).toBe(true);
    a.close();
  }, 30000);
});
