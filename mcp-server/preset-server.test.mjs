/**
 * MCP 预设服务器烟雾测试（直接用 Node 跑，不走 Jest，避免 ESM/Jest 麻烦）
 *
 * 用法：node mcp-server/preset-server.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TMP = path.join(os.tmpdir(), `trpg-mcp-test-${Date.now()}.json`);

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    pass++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    fail++;
  }
}

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

// 启动 server 子进程并用 JSON-RPC over stdio 与之通讯
import { spawn } from 'node:child_process';

class StdioClient {
  constructor(serverPath, presetPath) {
    this.proc = spawn('node', [serverPath, presetPath], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf-8');
      while (true) {
        const nl = this.buffer.indexOf('\n');
        if (nl < 0) break;
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            resolve(msg);
          }
        } catch { /* ignore */ }
      }
    });
  }

  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.proc.stdin.write(payload);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 5000);
    });
  }

  async initialize() {
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0' },
    });
    // notify ready
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }

  async call(toolName, args = {}) {
    const r = await this.send('tools/call', { name: toolName, arguments: args });
    if (r.error) throw new Error(`${toolName} error: ${JSON.stringify(r.error)}`);
    const result = r.result;
    if (result.isError) throw new Error(`${toolName} returned isError: ${result.content[0].text}`);
    return result.content[0].text;
  }

  close() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

async function main() {
  if (fs.existsSync(TMP)) fs.unlinkSync(TMP);

  const serverPath = path.join(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), 'preset-server.mjs');
  const client = new StdioClient(serverPath, TMP);
  await client.initialize();

  await test('preset_info 返回初始空预设', async () => {
    const r = await client.call('preset_info');
    const info = JSON.parse(r);
    assert(info.counts.scenes === 0);
    assert(info.counts.events === 0);
  });

  await test('preset_set_meta 设置 name + lore', async () => {
    await client.call('preset_set_meta', { name: '测试剧本', lore: { worldName: '测试世界' } });
    const info = JSON.parse(await client.call('preset_info'));
    assert(info.name === '测试剧本');
    assert(info.lore.worldName === '测试世界');
  });

  let firstSceneId;
  await test('scene_create 创建场景，自动设为 startingScene', async () => {
    const r = await client.call('scene_create', { name: '出发点', type: 'spawn', icon: '🚩' });
    // 应该返回 "已创建场景 scene_xxx (出发点)"
    const m = r.match(/scene_\w+/);
    assert(m, '应返回新场景 ID');
    firstSceneId = m[0];
    const info = JSON.parse(await client.call('preset_info'));
    assert(info.startingSceneId === firstSceneId, 'startingSceneId 应自动指向首个场景');
  });

  let secondSceneId;
  await test('scene_create 第二个场景 + add_connection', async () => {
    const r = await client.call('scene_create', { name: '森林', type: 'wilderness', icon: '🌲' });
    secondSceneId = r.match(/scene_\w+/)[0];
    await client.call('scene_add_connection', {
      fromId: firstSceneId, toId: secondSceneId, label: '进入森林',
    });
    const r2 = await client.call('scene_get', { id: firstSceneId });
    const scene = JSON.parse(r2);
    assert(scene.connections.length === 1);
    assert(scene.connections[0].to === secondSceneId);
    assert(scene.connections[0].label === '进入森林');
  });

  await test('scene_add_connection 带 gated.hint', async () => {
    await client.call('scene_add_connection', {
      fromId: secondSceneId, toId: firstSceneId,
      label: '原路返回',
      gated: { hint: '森林似乎不让你们轻易离开', requireVariables: { mood: 'brave' } },
    });
    const scene = JSON.parse(await client.call('scene_get', { id: secondSceneId }));
    const conn = scene.connections[0];
    assert(conn.gated.hint === '森林似乎不让你们轻易离开');
    assert(conn.gated.requireVariables.mood === 'brave');
  });

  await test('character_create + enemy_create + item_create', async () => {
    await client.call('character_create', {
      name: '主角', stats: { hp: 100, attack: 12, defense: 8 },
    });
    await client.call('enemy_create', {
      name: '哥布林', stats: { hp: 30, attack: 8, defense: 4 }, difficulty: 'easy',
    });
    await client.call('item_create', {
      name: '治疗药水', itemType: 'consumable',
      consumeEffect: { type: 'heal', stat: 'hp', value: 30 },
    });
    const info = JSON.parse(await client.call('preset_info'));
    assert(info.counts.characters === 1);
    assert(info.counts.enemies === 1);
    assert(info.counts.items === 1);
  });

  let evId;
  await test('event_create 创建事件并 attach 到场景', async () => {
    const r = await client.call('event_create', {
      name: '森林开局',
      description: '你站在森林边缘',
      inScene: [secondSceneId],
      choices: [{
        text: '前进',
        outcomes: [{ text: '深入森林', effects: [{ type: 'set_variable', name: 'in_forest', value: true }] }],
      }],
    });
    evId = r.match(/ch_\w+/)[0];
    await client.call('scene_attach_event', { sceneId: secondSceneId, eventId: evId });
    const scene = JSON.parse(await client.call('scene_get', { id: secondSceneId }));
    assert(scene.events.includes(evId));
  });

  await test('preset_validate 报告无错', async () => {
    const r = await client.call('preset_validate');
    assert(r.includes('校验通过'), `期望校验通过，实际：${r}`);
  });

  await test('scene_delete 自动清理引用', async () => {
    await client.call('scene_delete', { id: secondSceneId });
    const first = JSON.parse(await client.call('scene_get', { id: firstSceneId }));
    assert(first.connections.length === 0, 'firstScene 指向已删除场景的边应被清掉');
  });

  await test('preset_validate 检测断引用', async () => {
    // 事件还引用着已删除的 secondSceneId
    const r = await client.call('preset_validate');
    assert(r.includes('问题'), `应报告问题，实际：${r}`);
    assert(r.includes(secondSceneId), '错误应指出被引用的不存在场景');
  });

  await test('preset_batch_apply 一次创建一组场景+事件', async () => {
    // 先重置确保干净
    await client.call('preset_reset', { confirm: true });
    await client.call('character_create', { name: 'P', stats: { hp: 100, attack: 10, defense: 5 } });

    const r = await client.call('preset_batch_apply', {
      ops: [
        { tool: 'scene_create', args: { id: 'scene_a', name: 'A', type: 'spawn' } },
        { tool: 'scene_create', args: { id: 'scene_b', name: 'B', type: 'wilderness' } },
        { tool: 'scene_create', args: { id: 'scene_c', name: 'C', type: 'ending' } },
        { tool: 'scene_add_connection', args: { fromId: 'scene_a', toId: 'scene_b', label: '→B' } },
        { tool: 'scene_add_connection', args: { fromId: 'scene_b', toId: 'scene_c', label: '→C' } },
        { tool: 'event_create', args: { id: 'ev_start', name: '开场', description: 'd', inScene: ['scene_a'] } },
        { tool: 'scene_attach_event', args: { sceneId: 'scene_a', eventId: 'ev_start' } },
      ],
    });
    assert(r.includes('批量成功'), `期望成功，实际：${r}`);
    const info = JSON.parse(await client.call('preset_info'));
    assert(info.counts.scenes === 3);
    assert(info.counts.events === 1);
  });

  await test('preset_validate 检测门锁变量的部分 outcome 软锁', async () => {
    await client.call('preset_batch_apply', {
      ops: [
        {
          tool: 'scene_add_connection',
          args: { fromId: 'scene_a', toId: 'scene_b', gated: { requireVariables: { has_key: true } } },
        },
        {
          tool: 'event_create',
          args: {
            id: 'ev_partial_key',
            name: '钥匙抉择',
            description: '只有成功分支拿到钥匙',
            inScene: ['scene_a'],
            choices: [{
              id: 'choice_key',
              text: '尝试取钥匙',
              outcomes: [
                { probability: 0.5, text: '拿到钥匙', effects: [{ type: 'set_variable', name: 'has_key', value: true }] },
                { probability: 0.5, text: '错过钥匙', effects: [] },
              ],
            }],
          },
        },
        { tool: 'scene_attach_event', args: { sceneId: 'scene_a', eventId: 'ev_partial_key' } },
      ],
    });
    const r = await client.call('preset_validate');
    assert(r.includes('只有部分 outcome 设置该变量'), `应报告门锁软锁，实际：${r}`);
  });

  await test('scene_create 自动避开坐标冲突', async () => {
    await client.call('preset_reset', { confirm: true });
    await client.call('character_create', { name: 'P', stats: { hp: 100, attack: 10, defense: 5 } });
    await client.call('scene_create', { id: 's_a', name: 'A', coords: { x: 5, y: 5 } });
    // 故意传同一坐标 — 应被自动挪走
    const r = await client.call('scene_create', { id: 's_b', name: 'B', coords: { x: 5, y: 5 } });
    assert(r.includes('坐标自动调整'), `期望坐标自动调整，实际：${r}`);
    const b = JSON.parse(await client.call('scene_get', { id: 's_b' }));
    assert(!(b.coords.x === 5 && b.coords.y === 5), 'B 不应再在 (5,5)');
  });

  await test('scene_add_connection 默认双向', async () => {
    await client.call('scene_add_connection', { fromId: 's_a', toId: 's_b', label: '前往 B' });
    const a = JSON.parse(await client.call('scene_get', { id: 's_a' }));
    const b = JSON.parse(await client.call('scene_get', { id: 's_b' }));
    assert(a.connections.some(c => c.to === 's_b'), 'A 应有 → B');
    assert(b.connections.some(c => c.to === 's_a'), 'B 应有 → A（自动创建的返程）');
  });

  await test('scene_add_connection oneWay=true 不创建返程', async () => {
    await client.call('preset_reset', { confirm: true });
    await client.call('character_create', { name: 'P', stats: { hp: 100, attack: 10, defense: 5 } });
    await client.call('scene_create', { id: 's_x', name: 'X' });
    await client.call('scene_create', { id: 's_y', name: 'Y' });
    await client.call('scene_add_connection', { fromId: 's_x', toId: 's_y', label: '一去不回', oneWay: true });
    const y = JSON.parse(await client.call('scene_get', { id: 's_y' }));
    assert(!y.connections.some(c => c.to === 's_x'), 'oneWay 时不应创建返程');
  });

  await test('preset_analyze 报告多个维度', async () => {
    const r = await client.call('preset_analyze');
    assert(r.includes('引用完整性'), '应含【1】');
    assert(r.includes('坐标冲突'), '应含【2】');
    assert(r.includes('节点可达性'), '应含【3】');
    assert(r.includes('单向连接'), '应含【4】');
    assert(r.includes('变量定义/引用'), '应含【5】');
    assert(r.includes('主线推进模拟'), '应含【6】');
    assert(r.includes('角色装备完整性'), '应含【7】');
    assert(r.includes('gated.hint 安全'), '应含【8】');
  });

  await test('scene_relayout 自动解决坐标冲突', async () => {
    await client.call('preset_reset', { confirm: true });
    await client.call('character_create', { name: 'P', stats: { hp: 100, attack: 10, defense: 5 } });
    // 通过 scene_update 强制冲突（绕开 scene_create 自动避让）
    await client.call('scene_create', { id: 's_alpha', name: 'α', coords: { x: 3, y: 3 } });
    await client.call('scene_create', { id: 's_beta', name: 'β', coords: { x: 8, y: 8 } });
    await client.call('scene_update', { id: 's_beta', coords: { x: 3, y: 3 } });   // 强制冲突
    // 确认有冲突
    let r = await client.call('preset_analyze');
    assert(r.includes('坐标冲突: ❌'), '应检测到冲突');
    // 重排
    await client.call('scene_relayout', {});
    r = await client.call('preset_analyze');
    assert(r.includes('坐标冲突: ✓'), '重排后应无冲突');
  });

  await test('preset_batch_apply 失败自动回滚', async () => {
    const before = JSON.parse(await client.call('preset_info'));
    try {
      await client.call('preset_batch_apply', {
        ops: [
          { tool: 'scene_create', args: { id: 'scene_d', name: 'D' } },
          { tool: 'scene_add_connection', args: { fromId: 'scene_d', toId: 'NONEXISTENT', label: 'x' } },
        ],
      });
      assert(false, '应该抛出错误');
    } catch (e) {
      assert(e.message.includes('回滚') || e.message.includes('rollback') || e.message.includes('NONEXISTENT'),
        `期望含回滚提示，实际：${e.message}`);
    }
    const after = JSON.parse(await client.call('preset_info'));
    assert(after.counts.scenes === before.counts.scenes, '回滚后场景数应不变');
  });

  // Phase 19 — NPC / 角色创建工具
  await test('npc_create + npc_get + npc_schedule_add', async () => {
    await client.call('preset_reset', { confirm: true });
    await client.call('character_create', { name: 'P', stats: { hp: 100, attack: 10, defense: 5 } });
    await client.call('scene_create', { id: 'shop', name: '商店' });
    await client.call('scene_create', { id: 'home', name: '小屋' });
    await client.call('npc_create', {
      id: 'npc_baker',
      name: '老贝克',
      personality: 'cheerful',
      giftPreferences: { 'food': 'love', 'tag:fresh': 'love' },
    });
    await client.call('npc_schedule_add', {
      npcId: 'npc_baker', day: 'any', hourLo: 6, hourHi: 14, scene: 'shop',
    });
    await client.call('npc_schedule_add', {
      npcId: 'npc_baker', day: 'any', hourLo: 20, hourHi: 5, scene: 'home',  // 跨午夜
    });
    const npc = JSON.parse(await client.call('npc_get', { id: 'npc_baker' }));
    assert(npc.name === '老贝克');
    assert(npc.schedule.length === 2);
    assert(npc.schedule[0].scene === 'shop');
  });

  await test('npc_list 返回概览', async () => {
    const r = await client.call('npc_list');
    const list = JSON.parse(r);
    assert(list.length === 1);
    assert(list[0].id === 'npc_baker');
  });

  await test('startingoption_set 设置 races + startingscenerule_add 路由', async () => {
    await client.call('startingoption_set', {
      axis: 'races',
      options: [
        { id: 'human', name: '人类', icon: '👤', tags: ['race:human'] },
        { id: 'elf', name: '精灵', icon: '🧝', tags: ['race:elf'], statBonus: { magicAttack: 3 } },
      ],
    });
    await client.call('startingoption_set', {
      axis: 'origins',
      options: [{ id: 'noble', name: '贵族', tags: ['origin:noble'] }],
    });
    await client.call('startingscenerule_add', {
      when: { tags: ['origin:noble'] }, sceneId: 'shop',
    });
    await client.call('startingscenerule_add', {
      default: true, defaultSceneId: 'home',
    });
    const info = JSON.parse(await client.call('preset_info'));
    // info 不直接含 startingOptions，但 export 可以拿到
    const exported = JSON.parse(await client.call('preset_export'));
    assert(exported.startingOptions.races.length === 2);
    assert(exported.startingOptions.origins.length === 1);
    assert(exported.startingSceneRules.length === 2);
    assert(exported.startingSceneRules[0].sceneId === 'shop');
    assert(exported.startingSceneRules[1].default === 'home');
  });

  await test('npc_create 引用合法、preset_validate 通过', async () => {
    const r = await client.call('preset_validate');
    assert(r.includes('校验通过'), `期望通过，实际：${r}`);
  });

  await test('dialogue_node_set + dialogue_branch_add 构建对话树', async () => {
    await client.call('npc_create', {
      id: 'npc_oracle', name: '神谕者',
      personality: 'cryptic',
    });
    await client.call('dialogue_node_set', {
      npcId: 'npc_oracle', nodeId: 'root',
      speaker: 'self', text: '命运在等待你...',
    });
    await client.call('dialogue_node_set', {
      npcId: 'npc_oracle', nodeId: 'destiny',
      speaker: 'self', text: '你必须做出选择。',
    });
    await client.call('dialogue_branch_add', {
      npcId: 'npc_oracle', nodeId: 'root',
      text: '我准备好了', next: 'destiny', affectionDelta: 5,
    });
    await client.call('dialogue_branch_add', {
      npcId: 'npc_oracle', nodeId: 'root',
      text: '我还要思考', exit: true,
    });
    const tree = JSON.parse(await client.call('dialogue_get', { npcId: 'npc_oracle' }));
    assert(tree.root.text === '命运在等待你...');
    assert(tree.root.branches.length === 2);
    assert(tree.root.branches[0].next === 'destiny');
    assert(tree.root.branches[1].exit === true);
    assert(tree.destiny.text === '你必须做出选择。');
  });

  await test('scene_variant_add + connection_set_hidden (Phase 21)', async () => {
    // 创建两个场景
    await client.call('scene_create', { id: 'plaza', name: '广场' });
    await client.call('scene_create', { id: 'alley', name: '小巷' });
    // 给 plaza 加战时变体
    await client.call('scene_variant_add', {
      sceneId: 'plaza',
      when: { requireWorldFlags: { war_declared: true } },
      description: '战火燃尽的广场。',
    });
    const exported = JSON.parse(await client.call('preset_export'));
    const plaza = exported.scenes.find(s => s.id === 'plaza');
    assert(plaza.variants.length === 1);
    assert(plaza.variants[0].description === '战火燃尽的广场。');

    // 加隐藏连接
    await client.call('scene_add_connection', { fromId: 'plaza', toId: 'alley', label: '钻进暗道' });
    await client.call('connection_set_hidden', { fromId: 'plaza', toId: 'alley', hidden: true });
    const e2 = JSON.parse(await client.call('preset_export'));
    const p2 = e2.scenes.find(s => s.id === 'plaza');
    const conn = p2.connections.find(c => c.to === 'alley');
    assert(conn.discovered === false);

    // 取消隐藏
    await client.call('connection_set_hidden', { fromId: 'plaza', toId: 'alley', hidden: false });
    const e3 = JSON.parse(await client.call('preset_export'));
    const conn3 = e3.scenes.find(s => s.id === 'plaza').connections.find(c => c.to === 'alley');
    assert(conn3.discovered === true);
  });

  await test('dialogue_branch_add 在不存在的节点上报错', async () => {
    try {
      await client.call('dialogue_branch_add', {
        npcId: 'npc_oracle', nodeId: 'NONEXISTENT',
        text: 'x', exit: true,
      });
      assert(false, '应抛错');
    } catch (e) {
      assert(e.message.includes('节点 NONEXISTENT 不存在'), `期望节点不存在错误，实际：${e.message}`);
    }
  });

  await test('npc_delete', async () => {
    await client.call('npc_delete', { id: 'npc_baker' });
    const list = JSON.parse(await client.call('npc_list'));
    assert(list.find(n => n.id === 'npc_baker') === undefined);
  });

  // Phase 25 — 模板 + 规模检查
  await test('preset_apply_template crpg_standard 一键塞 5 节点 + 角色创建', async () => {
    await client.call('preset_reset', { confirm: true });
    await client.call('preset_apply_template', { template: 'crpg_standard' });
    const info = JSON.parse(await client.call('preset_info'));
    assert(info.counts.scenes >= 5, `期望 ≥5 场景，实际 ${info.counts.scenes}`);
    assert(info.counts.events >= 3, `期望 ≥3 事件，实际 ${info.counts.events}`);
    const exported = JSON.parse(await client.call('preset_export'));
    assert(exported.startingOptions, '应有 startingOptions');
    assert(exported.startingOptions.races.length === 3);
    assert(exported.startingSceneRules.length >= 2);
    assert(exported.combatMode === 'solo');
  });

  await test('preset_apply_template 非空时拒绝 + confirm 强制', async () => {
    try {
      await client.call('preset_apply_template', { template: 'crpg_standard' });
      assert(false, '应拒绝');
    } catch (e) {
      assert(e.message.includes('已有') || e.message.includes('confirm'), '应提示已有数据');
    }
    // 强制
    const r = await client.call('preset_apply_template', { template: 'survival_solo', confirm: true });
    assert(r.includes('survival_solo'));
  });

  await test('scene_chain_create 一次创建 3 节点链 + 自动双向', async () => {
    await client.call('preset_reset', { confirm: true });
    await client.call('character_create', { name: 'P', stats: { hp: 100, attack: 10, defense: 5 } });
    await client.call('scene_chain_create', {
      chain: [
        { id: 'c1', name: '入口' },
        { id: 'c2', name: '中间' },
        { id: 'c3', name: '出口', oneWay: true },
      ],
    });
    const exp = JSON.parse(await client.call('preset_export'));
    assert(exp.scenes.length === 3);
    assert(exp.startingSceneId === 'c1');
    const c1 = exp.scenes.find(s => s.id === 'c1');
    const c2 = exp.scenes.find(s => s.id === 'c2');
    const c3 = exp.scenes.find(s => s.id === 'c3');
    assert(c1.connections.some(c => c.to === 'c2'));
    assert(c2.connections.some(c => c.to === 'c1'));  // 双向
    assert(c2.connections.some(c => c.to === 'c3'));
    assert(!c3.connections.some(c => c.to === 'c2'));  // oneWay
  });

  await test('npc_relation_add 写入 npcRelations 数组 (Phase 22B)', async () => {
    await client.call('preset_reset', { confirm: true });
    await client.call('character_create', { name: 'P', stats: { hp: 100, attack: 10, defense: 5 } });
    await client.call('npc_create', { id: 'npc_x', name: 'X' });
    await client.call('npc_create', { id: 'npc_y', name: 'Y' });
    await client.call('npc_relation_add', { from: 'npc_x', to: 'npc_y', strength: 0.5, note: '挚友' });
    await client.call('npc_relation_add', { from: 'npc_y', to: 'npc_x', strength: -0.3, note: '一厢情愿' });
    const exp = JSON.parse(await client.call('preset_export'));
    assert(exp.npcRelations.length === 2);
    assert(exp.npcRelations[0].strength === 0.5);
    assert(exp.npcRelations[1].strength === -0.3);
  });

  await test('npc_relation_add 引用不存在的 NPC 报错', async () => {
    try {
      await client.call('npc_relation_add', { from: 'NOPE', to: 'npc_y', strength: 0.3 });
      assert(false, '应抛错');
    } catch (e) {
      assert(e.message.includes('不存在'), `期望"不存在"错误，实际：${e.message}`);
    }
  });

  await test('preset_scale_check 报告含关键指标', async () => {
    const r = await client.call('preset_scale_check');
    assert(r.includes('场景规模'));
    assert(r.includes('事件密度'));
    assert(r.includes('平均连接度'));
    assert(r.includes('主线节点'));
    assert(r.includes('NPC'));
    assert(r.includes('结局数'));
  });

  // Phase 26 — 战斗平衡模拟器
  await test('combat_simulate 找不到战斗时报错', async () => {
    try {
      await client.call('combat_simulate', { eventId: 'NOT_EXIST', runs: 100 });
      assert(false, '应抛错');
    } catch (e) {
      assert(e.message.includes('没找到') || e.message.includes('NOT_EXIST'), `期望"没找到"错误，实际：${e.message}`);
    }
  });

  await test('combat_simulate 跑一场简单战斗', async () => {
    // 先建一个简单的战斗事件
    await client.call('character_create', { id: 'c_hero', name: '英雄',
      stats: { hp: 100, mp: 20, attack: 15, defense: 10, magicAttack: 5, magicDefense: 8, speed: 12, luck: 5 },
      abilities: [{ id: 'slash', name: '挥砍', type: 'active', cost: { mp: 4 }, effect: { damage: { formula: 'attack+d6' } } }],
    });
    await client.call('enemy_create', { id: 'e_grunt', name: '杂兵', stats: { hp: 30, attack: 8, defense: 4 }, difficulty: 'easy' });
    await client.call('scene_create', { id: 's_arena', name: '试炼场', type: 'combat' });
    await client.call('event_create', {
      id: 'ev_test_combat', name: '试炼之战', description: '试炼之战开始', inScene: ['s_arena'], tags: ['boss'],
      choices: [{ id: 'fight', text: '战斗', outcomes: [{ effects: [{ type: 'start_combat', enemyIds: ['e_grunt'] }], text: '战' }] }],
    });
    const r = await client.call('combat_simulate', { eventId: 'ev_test_combat', runs: 200 });
    assert(r.includes('胜率'), `期望含胜率字段：${r}`);
    assert(r.includes('试炼之战'), `期望含事件名：${r}`);
    // 单个 attack 15 vs def 4 + 30hp 杂兵，应该胜率接近 100%
    const m = r.match(/胜率:\s*(\d+\.\d+)%/);
    assert(m && parseFloat(m[1]) > 80, `胜率应该 >80%，实际：${m && m[1]}`);
  });

  client.close();
  if (fs.existsSync(TMP)) fs.unlinkSync(TMP);

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('test runner crashed:', e);
  process.exit(2);
});
