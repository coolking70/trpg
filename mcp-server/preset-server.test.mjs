/**
 * MCP 预设服务器烟雾测试（直接用 Node 跑，不走 Jest，避免 ESM/Jest 麻烦）
 *
 * 用法：node mcp-server/preset-server.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const TMP = path.join(os.tmpdir(), `trpg-mcp-test-${Date.now()}.json`);
const NOVEL_TMP = path.join(os.tmpdir(), `trpg-mcp-novel-${Date.now()}.txt`);

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

function startMockChatCompletionsServer() {
  let calls = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    calls++;
    let body = '';
    req.on('data', chunk => { body += chunk.toString('utf-8'); });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      const userContent = parsed.messages?.find(m => m.role === 'user')?.content || '';
      if (String(userContent).includes('实体归一化')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                canonicalFactions: [
                  { id: 'academy', name: '学院', description: '研究星门的组织', tags: ['faction:academy'] },
                  { id: 'empire', name: '帝国', description: '试图控制星门的军事势力', tags: ['faction:empire'] },
                  { id: 'church', name: '教会', description: '宣称星门属于神迹的宗教势力', tags: ['faction:church'] },
                ],
                aliases: [
                  { fromId: 'academy_alt', toId: 'academy', reason: '同一学院势力的别名' },
                ],
              }),
            },
          }],
        }));
        return;
      }
      if (String(userContent).includes('起点专属支线包')) {
        const payload = JSON.parse(userContent);
        const routes = (payload.factions || []).map(f => ({
          factionId: f.id,
          npc: { name: `${f.name}引路人`, title: '路线导师', description: `${f.name}的专属支线导师。`, personality: 'route_guide' },
          scenes: [{
            title: `${f.name}的分歧前夜`,
            type: 'settlement',
            summary: `${f.name}必须在进入星门主线前处理内部矛盾。`,
            event: {
              title: `${f.name}的专属抉择`,
              type: 'story',
              choices: [
                { id: 'support_faction', text: '支持本势力方案', outcome: '本势力声望提升。', setVariable: `route_${f.id}_support` },
                { id: 'seek_compromise', text: '寻找折中方案', outcome: '保留后续谈判空间。', setVariable: `route_${f.id}_compromise` },
              ],
            },
          }],
          ending: {
            title: `${f.name}的尾声`,
            summary: `${f.name}路线在星门结局后的专属收束。`,
            choices: [{ id: 'accept', text: '接受路线代价', outcome: '路线完成。', setVariable: `ending_${f.id}` }],
          },
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ routes }) } }] }));
        return;
      }
      if (String(userContent).includes('战略设定层')) {
        const payload = JSON.parse(userContent);
        const factions = (payload.existingFactions || []).map(f => ({
          factionId: f.id,
          strategicSummary: `${f.name}围绕星门资源形成了有限治理能力。`,
          holdings: [
            {
              id: `${f.id}_capital`,
              name: `${f.name}主城`,
              type: 'capital',
              population: 42000,
              resources: ['粮食', '铁矿'],
              specialties: ['边境贸易'],
              productionEfficiency: 82,
              security: 68,
              narrativeRole: '用于开局汇报和后续外交压力事件。',
              confidence: 'inferred',
              evidence: '由势力规模与星门争夺剧情反推。',
            },
            {
              id: `${f.id}_mine`,
              name: `${f.name}北矿`,
              type: 'mine',
              population: 3200,
              resources: ['铁矿'],
              specialties: ['军械原料'],
              productionEfficiency: 74,
              security: 45,
              narrativeRole: '矿区动荡会影响军备和谈判筹码。',
              confidence: 'inferred',
              evidence: '战争势力需要稳定军械来源。',
            },
          ],
          resources: [
            { id: 'grain', name: '粮食', category: 'food', abundance: 'stable', strategicUse: '维持军队与城市稳定', confidence: 'inferred' },
            { id: 'iron', name: '铁矿', category: 'ore', abundance: 'limited', strategicUse: '军备制造', confidence: 'inferred' },
          ],
          economy: {
            totalPopulation: 45200,
            laborPool: 19000,
            foodBalance: '略有余粮但运输脆弱',
            treasuryPressure: '战争税引发不满',
            mobilizationCapacity: '可短期动员两支地方队',
            productionFormula: 'effective_output = population * productionEfficiency * stability_modifier',
          },
          internalPolitics: `${f.name}内部围绕星门态度分裂。`,
          diplomacy: (payload.existingFactions || [])
            .filter(other => other.id !== f.id)
            .slice(0, 2)
            .map(other => ({
              targetFactionId: other.id,
              stance: 'rival',
              publicReason: '争夺星门解释权',
              hiddenTension: '暗中接触对方边境贵族',
              confidence: 'inferred',
            })),
          intelligenceProfile: {
            publicKnowledge: '民众只知道税赋和征发增加。',
            restrictedKnowledge: '高层掌握星门失控风险。',
            misinformation: '商队流传夸大的敌军数字。',
            uncertainty: '矿区真实产量仍需现场核查。',
          },
          playableRoles: [
            {
              roleId: 'border_commander',
              title: '边境指挥官',
              authorityScope: '可向直属幕僚下令侦察、安抚或筹备防务。',
              visibleIntel: '能看到军政汇报，但无法直接掌握宫廷密谋。',
              commandLimits: '命令需要时间执行，地方官可能隐瞒结果。',
              reportCadence: '每个关键事件后收到汇报。',
            },
          ],
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          designPrinciples: ['战略设定只通过 TRPG 汇报与命令呈现'],
          accessRules: { commoner: '传闻级情报', officer: '局部军政汇报', ruler: '高层汇总但仍有误差' },
          formulas: {
            production: 'effective_output = population * productionEfficiency * stability_modifier',
            stability: 'stability_modifier = security/100',
            intelligence: 'visible_intel = role_scope - secrecy',
          },
          factions,
        }) } }] }));
        return;
      }
      if (String(userContent).includes('审稿并校正 TRPG strategicLayer')) {
        const payload = JSON.parse(userContent);
        const correctedFactions = Object.values(payload.strategicLayer?.factions || {}).map(f => ({
          ...f,
          strategicSummary: `${f.strategicSummary || f.name}（已审稿：保留为小说逻辑推断，不视为原文明示。）`,
          holdings: (f.holdings || []).map(h => ({
            ...h,
            confidence: h.confidence === 'explicit' ? 'inferred' : h.confidence,
            evidence: `${h.evidence || '缺少依据'}；审稿后标注为可校正推断。`,
          })),
          intelligenceProfile: {
            ...(f.intelligenceProfile || {}),
            uncertainty: '审稿确认：人口、产能和地名均需在后续剧情中允许校正。',
          },
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          summary: '发现部分设定过于确定，已改为可校正推断。',
          issues: [
            {
              id: 'over_precise_population',
              severity: 'warning',
              factionId: correctedFactions[0]?.factionId || 'academy',
              path: `factions.${correctedFactions[0]?.factionId || 'academy'}.economy.totalPopulation`,
              problem: '人口数值缺乏原文直接证据。',
              recommendation: '保留为估算，并在 evidence/uncertainty 中说明。',
              confidence: 'high',
            },
          ],
          correctedFactions,
          reviewerNotes: 'mock review completed',
        }) } }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              world: { name: '星门试作', background: '星门争夺让学院、帝国与教会形成三方张力。', gmStyle: '政治奇幻冒险' },
              factions: [
                { id: 'academy', name: '学院', description: '研究星门的组织', tags: ['faction:academy'] },
                { id: 'empire', name: '帝国', description: '试图控制星门的军事势力', tags: ['faction:empire'] },
                { id: 'church', name: '教会', description: '宣称星门属于神迹的宗教势力', tags: ['faction:church'] },
              ],
              characters: [
                { id: 'lin_zhou', name: '林舟', title: '星门见习守卫', factionId: 'academy', description: '卷入星门争夺的青年', recruitable: true },
                { id: 'ailin', name: '艾琳', title: '学院谈判者', factionId: 'academy', description: '反对交出星门的代表', recruitable: true },
                { id: 'imperial_envoy', name: '帝国使者', title: '帝国谈判官', factionId: 'empire', description: '要求接管星门', recruitable: false },
              ],
              sections: [
                {
                  title: '第一章 星门',
                  summary: 'API 摘要：星门争夺让学院、帝国与教会形成三方张力。',
                  locations: ['星门', '学院'],
                  conflicts: ['星门控制权'],
                  beats: [
                    {
                      title: '钟声响起',
                      sceneType: 'settlement',
                      eventType: 'story',
                      summary: 'API 摘要：学院钟声宣告星门危机开始。',
                      focusFactionId: 'academy',
                      choices: [
                        { id: 'protect_gate', text: '保护星门', outcome: '学院获得喘息。', setVariable: 'gate_protected' },
                        { id: 'hear_empire', text: '听取帝国条件', outcome: '帝国使者愿意说明真正目的。', setVariable: 'empire_heard' },
                      ],
                      tags: ['main'],
                    },
                  ],
                },
              ],
            }),
          },
        }],
      }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        get calls() { return calls; },
        close: () => new Promise(done => server.close(done)),
      });
    });
  });
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

  await test('novel_source_inspect 读取长文本并识别章节', async () => {
    fs.writeFileSync(NOVEL_TMP, [
      '第一章 星门',
      '林舟说道，学院的钟声已经响起。帝国使者穿过街道，教会祭司沉默旁观。',
      '第二章 交涉',
      '艾琳回答，公会不会接受帝国的条件。林舟决定寻找第三条道路。',
      '第三章 夜战',
      '地下势力逼近学院，艾琳喊道，必须保护星门。',
    ].join('\n'), 'utf-8');
    const r = await client.call('novel_source_inspect', { sourcePath: NOVEL_TMP, maxSections: 20 });
    const info = JSON.parse(r);
    assert(info.sections >= 3, `应识别至少 3 个章节，实际：${r}`);
    assert(info.excludedNonStorySections === 0, '测试素材不应过滤正文');
    assert(info.note.includes('不再本地猜测人物或势力'), '应说明 inspect 不做本地人物/势力分析');
  });

  await test('novel_build_mega_preset 拒绝本地启发式生成', async () => {
    try {
      await client.call('novel_build_mega_preset', {
        sourcePath: NOVEL_TMP,
        title: '星门试作',
        maxSections: 3,
        inspectSections: 20,
        confirm: true,
        useApi: false,
      });
      assert(false, '应拒绝本地启发式生成');
    } catch (e) {
      assert(e.message.includes('本地启发式自动分析已废除'), `应提示本地启发式已废除，实际：${e.message}`);
    }
  });

  await test('novel_build_mega_preset 可通过 OpenAI-compatible API 增强摘要', async () => {
    const mock = await startMockChatCompletionsServer();
    try {
      const r = await client.call('novel_build_mega_preset', {
        sourcePath: NOVEL_TMP,
        title: '星门 API 试作',
        maxSections: 3,
        inspectSections: 20,
        confirm: true,
        useApi: true,
        apiKey: 'test-key',
        baseUrl: mock.baseUrl,
        model: 'mock-model',
        maxApiSections: 1,
      });
      const result = JSON.parse(r);
      assert(result.apiEnhanced === true, `应标记 API 增强，实际：${r}`);
      assert(mock.calls === 4, `应按每批 1 个片段调用 mock API 三次，并额外调用一次实体归一化，实际 ${mock.calls}`);
      const exported = JSON.parse(await client.call('preset_export'));
      assert(exported.sourceMaterial.apiEnhanced === true, 'sourceMaterial 应记录 apiEnhanced');
      assert(exported.sourceMaterial.analysisMode === 'api_only', 'sourceMaterial 应记录 api_only');
      assert(exported.sourceMaterial.canonicalizedEntities === true, 'sourceMaterial 应记录 API 实体归一化');
      assert(exported.scenes.some(s => String(s.description).includes('API 摘要')), '场景描述应采用 API 摘要');
      assert(exported.startingOptions.origins.length >= 3, '应使用 API 势力生成多个起点');
      assert(exported.startingSceneId === 'scene_start_academy', `应设置 API 势力首个开局场景，实际：${exported.startingSceneId}`);
      assert(!exported.scenes.some(s => s.type === 'ending'), '短样本不应仅因末段窗口被强行标为 ending');

      exported.factions.push({ id: 'academy_alt', name: '学院别称', description: '研究星门的组织', reputationVar: 'rep_academy_alt', tags: ['faction:academy_alt'] });
      fs.writeFileSync(TMP, JSON.stringify(exported, null, 2), 'utf-8');
      await client.call('preset_load', {});
      const canon = JSON.parse(await client.call('preset_canonicalize_entities_api', {
        apiKey: 'test-key',
        baseUrl: mock.baseUrl,
        model: 'mock-model',
        factionLimit: 3,
      }));
      assert(canon.canonicalFactionCount === 3, `应归一化为 3 个势力，实际：${JSON.stringify(canon)}`);
      const canonExport = JSON.parse(await client.call('preset_export'));
      assert(canonExport.sourceMaterial.canonicalizedEntities === true, '单独工具应记录 canonicalizedEntities');
      assert(!canonExport.factions.some(f => f.id === 'academy_alt'), 'API alias 指向的重复势力应被合并');
      const expanded = JSON.parse(await client.call('preset_expand_routes_api', {
        apiKey: 'test-key',
        baseUrl: mock.baseUrl,
        model: 'mock-model',
        factionIds: ['academy'],
        routeLength: 1,
        includeEndings: true,
      }));
      assert(expanded.createdCounts.scenes === 2, `应新增 1 个支线场景 + 1 个结局场景，实际：${JSON.stringify(expanded)}`);
      const expandedExport = JSON.parse(await client.call('preset_export'));
      assert(expandedExport.sourceMaterial.routeExpansion.apiEnhanced === true, '应记录 API 路线扩写');
      assert(expandedExport.scenes.some(s => s.id === 'scene_route_academy_01'), '应创建势力专属路线场景');
      const strategic = JSON.parse(await client.call('preset_generate_strategic_layer_api', {
        apiKey: 'test-key',
        baseUrl: mock.baseUrl,
        model: 'mock-model',
        mode: 'novel_adaptation',
        factionIds: ['academy'],
        maxSourceSections: 0,
        createBriefingEvents: true,
      }));
      assert(strategic.factionCount === 1, `应为指定势力生成战略层，实际：${JSON.stringify(strategic)}`);
      const strategicExport = JSON.parse(await client.call('preset_export'));
      assert(strategicExport.strategicLayer.apiEnhanced === true, '应写入 strategicLayer');
      assert(strategicExport.strategicLayer.mode === 'novel_adaptation', '应记录小说改编模式');
      assert(strategicExport.strategicLayer.factions.academy.holdings.length >= 2, '应生成城市/矿区等据点资源');
      assert(strategicExport.events.some(e => e.id === 'ev_strategy_briefing_academy'), '应创建势力战略汇报事件');
      assert(strategicExport.scenes.find(s => s.id === 'scene_start_academy').events.includes('ev_strategy_briefing_academy'), '起点应挂载战略汇报事件');
      const reviewDryRun = JSON.parse(await client.call('preset_review_strategic_layer_api', {
        apiKey: 'test-key',
        baseUrl: mock.baseUrl,
        model: 'mock-model',
        factionIds: ['academy'],
        maxSourceSections: 0,
        applyCorrections: false,
      }));
      assert(reviewDryRun.issues.length === 1, `dryRun 应返回审稿问题，实际：${JSON.stringify(reviewDryRun)}`);
      assert(reviewDryRun.note.includes('未修改'), 'dryRun 应说明未修改');
      const reviewApply = JSON.parse(await client.call('preset_review_strategic_layer_api', {
        apiKey: 'test-key',
        baseUrl: mock.baseUrl,
        model: 'mock-model',
        factionIds: ['academy'],
        maxSourceSections: 0,
        applyCorrections: true,
      }));
      assert(reviewApply.issueCounts.warning === 1, `写回后应记录 warning 计数，实际：${JSON.stringify(reviewApply)}`);
      const reviewedExport = JSON.parse(await client.call('preset_export'));
      assert(reviewedExport.strategicLayer.lastReview.issues.length === 1, '应记录 lastReview issues');
      assert(reviewedExport.strategicLayer.factions.academy.intelligenceProfile.uncertainty.includes('审稿确认'), '应写回校正后的 uncertainty');
      assert(reviewedExport.sourceMaterial.strategicLayerReview.apiEnhanced === true, '应记录 sourceMaterial.strategicLayerReview');
    } finally {
      await mock.close();
    }
  });

  client.close();
  if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
  if (fs.existsSync(NOVEL_TMP)) fs.unlinkSync(NOVEL_TMP);

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('test runner crashed:', e);
  process.exit(2);
});
