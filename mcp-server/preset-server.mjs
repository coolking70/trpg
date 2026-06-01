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
const DEFAULT_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'qwen/qwen3.6-35b-a3b';

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
    strategicLayer: null,           // Phase 27: faction holdings / resources / governance, played through TRPG briefings
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
  if (preset.strategicLayer === undefined) preset.strategicLayer = null;
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

function slugifyId(value, fallback = 'id') {
  const ascii = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase();
  if (ascii) return ascii.slice(0, 40);
  let hash = 0;
  for (const ch of String(value || fallback)) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return `${fallback}_${Math.abs(hash).toString(36)}`;
}

function truncateText(text, max = 180) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function summarizePlayableText(text, fallback = '局势正在展开。') {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  s = s
    .replace(/^AI改编节拍：[^。]*。?/, '')
    .replace(/^API势力支线(?:事件)?：?/, '')
    .replace(/^这个节点由 API 从素材抽取并改编。GM 应围绕地点、人物、冲突展开，不复述原文，而让玩家决定[^。]*。方向：/, '')
    .replace(/^API改编摘要：/, '')
    .replace(/GM描述/g, '眼前呈现')
    .replace(/玩家（([^）]+)）/g, '$1')
    .replace(/玩家扮演的?/g, '')
    .replace(/玩家作为/g, '')
    .replace(/玩家以/g, '')
    .replace(/玩家操控的/g, '')
    .replace(/玩家可/g, '可以')
    .replace(/玩家将/g, '将')
    .replace(/玩家需(?:要)?/g, '需要')
    .replace(/这是一个/g, '这里是')
    .replace(/固定的剧情节点/g, '关键时刻')
    .replace(/纯决策与情报分析场景/g, '紧张的军议时刻')
    .trim();
  if (!s) s = fallback;
  return truncateText(s, 240);
}

function readNovelSource(sourcePath) {
  const abs = path.resolve(sourcePath);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
  const stat = fs.statSync(abs);
  const text = fs.readFileSync(abs, 'utf-8').replace(/\r\n/g, '\n');
  return { abs, stat, text };
}

function cleanNovelText(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/WenKu8|轻小说文库|www\.wenku8/i.test(line))
    .join('\n');
}

function splitNovelSections(text, maxSections = 80) {
  const cleaned = cleanNovelText(text);
  const headingRe = /^(第[一二三四五六七八九十百千万零〇\d]+[章节卷回部集][^\n]{0,40}|[卷章][一二三四五六七八九十百千万零〇\d]+[^\n]{0,40})$/gm;
  const matches = [...cleaned.matchAll(headingRe)];
  if (matches.length === 0) {
    const chunkSize = 12000;
    const sections = [];
    for (let i = 0; i < cleaned.length && sections.length < maxSections; i += chunkSize) {
      sections.push({ title: `片段 ${sections.length + 1}`, text: cleaned.slice(i, i + chunkSize), index: sections.length });
    }
    return sections;
  }

  const sections = [];
  for (let i = 0; i < matches.length && sections.length < maxSections; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : cleaned.length;
    const title = matches[i][1].trim();
    const body = cleaned.slice(start + matches[i][0].length, end).trim();
    if (/第[一二三四五六七八九十百千万零〇\d]+[卷部集]/.test(title) && body.length < 80 && sections.length > 0) {
      sections[sections.length - 1].text += `\n${title}\n${body}`;
      continue;
    }
    sections.push({ title, text: body, index: sections.length });
  }
  return sections;
}

function isNonStorySection(section) {
  return /后记|插图|特典|电子版|小册子|附录|目录|版权|彩页|设定资料|人物介绍/.test(section.title || '');
}

function filterStorySections(sections, includeNonStory = false) {
  if (includeNonStory) return sections;
  return sections.filter(section => !isNonStorySection(section));
}

function normalizeOpenAIBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/v1';
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function isLocalOpenAIBaseUrl(baseUrl) {
  try {
    const host = new URL(normalizeOpenAIBaseUrl(baseUrl)).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

async function callOpenAICompatible({ baseUrl, apiKey, model, messages, temperature = 0.2, maxTokens = 1200 }) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  const normalizedBaseUrl = normalizeOpenAIBaseUrl(baseUrl);
  if (!key && !isLocalOpenAIBaseUrl(normalizedBaseUrl)) {
    throw new Error('缺少 API key：请传 apiKey，或设置 OPENAI_API_KEY；本地 127.0.0.1/localhost 端点可留空');
  }
  const url = `${normalizedBaseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 180000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestBody = {
    model: model || DEFAULT_OPENAI_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (isLocalOpenAIBaseUrl(normalizedBaseUrl)) {
    requestBody.reasoning_effort = 'none';
  } else {
    requestBody.response_format = { type: 'json_object' };
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`API 调用超时（${Math.floor(timeoutMs / 1000)}秒）`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API 调用失败 ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

function parseAIJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = String(content || '').match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('API 没有返回可解析的 JSON 对象');
  }
}

function normalizeAIId(value, fallback) {
  const raw = String(value || fallback || 'id').trim();
  const ascii = raw
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase();
  if (ascii) return ascii.slice(0, 40);
  return slugifyId(raw, fallback || 'id');
}

function normalizeAIPlan(plan, selectedSections, { factionLimit = 8, npcLimit = 60 }) {
  const factions = (plan.factions || []).slice(0, factionLimit).map((f, i) => {
    const id = normalizeAIId(f.id || f.name, `faction_${i + 1}`);
    return {
      id,
      name: f.name || `势力 ${i + 1}`,
      description: f.description || f.summary || '由 AI 从素材中抽取的势力。',
      tags: Array.isArray(f.tags) && f.tags.length ? f.tags : [`faction:${id}`],
    };
  });
  if (factions.length === 0) {
    throw new Error('API 结果缺少 factions[]，无法生成多势力剧本');
  }

  const characters = (plan.characters || []).slice(0, npcLimit).map((ch, i) => {
    const id = normalizeAIId(ch.id || ch.name, `npc_${i + 1}`);
    return {
      id,
      name: ch.name || `角色 ${i + 1}`,
      title: ch.title || ch.role || '素材角色',
      description: ch.description || ch.summary || '',
      factionId: normalizeAIId(ch.factionId || ch.faction || factions[i % factions.length]?.id, factions[i % factions.length]?.id || 'neutral'),
      recruitable: !!ch.recruitable,
      tags: Array.isArray(ch.tags) ? ch.tags : [],
    };
  });

  if (!Array.isArray(plan.sections) || plan.sections.length !== selectedSections.length) {
    throw new Error(`API sections 数量不匹配：输入 ${selectedSections.length} 个，返回 ${Array.isArray(plan.sections) ? plan.sections.length : 0} 个`);
  }

  const sections = (plan.sections || []).map((section, i) => {
    const source = selectedSections[i] || {};
    if (!Array.isArray(section.beats) || section.beats.length === 0) {
      throw new Error(`API 结果第 ${i + 1} 个 section 缺少 beats[]，已拒绝本地补写占位节拍`);
    }
    const beats = (section.beats || []).map((beat, j) => ({
      title: beat.title || `${section.title || source.title || `章节 ${i + 1}`} · ${j + 1}`,
      sceneType: beat.sceneType || beat.type || 'wilderness',
      eventType: beat.eventType || 'story',
      summary: beat.summary || section.summary || 'AI 未提供摘要。',
      choices: (beat.choices || []).slice(0, 3).map((choice, k) => ({
        id: choice.id || `choice_${k + 1}`,
        text: choice.text || String(choice),
        outcome: choice.outcome || '',
        setVariable: choice.setVariable,
      })),
      focusFactionId: normalizeAIId(beat.focusFactionId || beat.factionId || beat.faction || factions[(i + j) % factions.length]?.id, factions[(i + j) % factions.length]?.id || 'world'),
      tags: Array.isArray(beat.tags) ? beat.tags : [],
    }));
    return {
      title: section.title || source.title || `章节 ${i + 1}`,
      summary: section.summary || '',
      locations: section.locations || [],
      conflicts: section.conflicts || [],
      beats,
    };
  });
  if (sections.length === 0) {
    throw new Error('API 结果缺少 sections[]，无法生成章节场景');
  }

  return {
    world: plan.world || {},
    factions,
    characters,
    sections,
    raw: plan,
  };
}

async function analyzeNovelChunkWithApi({ sections, apiKey, baseUrl, model, factionLimit = 8, npcLimit = 60, beatsPerSection = 3, offset = 0 }) {
  const selected = sections;
  const sectionPayload = selected.map((section, i) => ({
    index: offset + i + 1,
    title: section.title,
    excerpt: section.text.slice(0, Number(process.env.NOVEL_API_EXCERPT_CHARS || 2500)),
  }));
  const messages = [
    {
      role: 'system',
      content: [
        '你是TRPG剧本结构师，正在把小说/设定集改编成可玩的场景图剧本。',
        '必须只输出一个 JSON 对象，不要 Markdown，不要复述原文长段。',
        'JSON 必须严格合法：对象键和字符串都使用英文双引号，字符串内部引号必须转义。',
        '不要使用本地猜测；所有势力、角色、地点、冲突都必须来自素材或对素材的合理抽象。',
        '必须为输入的每一个 sections 项都输出一个对应 sections 项，数量和顺序必须完全一致。',
        '每个章节输出 beats，每个 beat 是一个可玩场景/事件节点。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: '从素材中抽取 TRPG 剧本结构',
        outputSchema: {
          world: { name: 'string', background: 'string', gmStyle: 'string' },
          factions: [{ id: 'ascii_or_pinyin_id', name: 'string', description: 'string', tags: ['string'] }],
          characters: [{ id: 'ascii_or_pinyin_id', name: 'string', title: 'string', factionId: 'faction id', description: 'string', recruitable: false }],
          sections: [{
            title: 'string',
            summary: '原创改编摘要，不复述原文',
            locations: ['string'],
            conflicts: ['string'],
            beats: [{
              title: 'string',
              sceneType: 'spawn|settlement|wilderness|combat|dungeon|vignette|ending',
              eventType: 'story|encounter|shop|boss|rescue',
              summary: '可玩场景说明，原创改写',
              focusFactionId: 'faction id',
              choices: [{ id: 'ascii_id', text: '玩家选择文本', outcome: '结果摘要', setVariable: 'optional_variable_name' }],
              tags: ['main|side|branch|ending']
            }],
          }],
        },
        constraints: {
          beatsPerSection,
          minFactions: 3,
          minCharacters: 8,
          choiceCountPerBeat: 2,
          language: 'zh-CN',
        },
        sections: sectionPayload,
      }),
    },
  ];
  const content = await callOpenAICompatible({
    apiKey, baseUrl, model,
    messages,
    temperature: 0.25,
    maxTokens: 7000,
  });
  let plan;
  try {
    plan = parseAIJson(content);
  } catch (firstError) {
    const repaired = await callOpenAICompatible({
      apiKey, baseUrl, model,
      messages: [
        ...messages,
        { role: 'assistant', content: content.slice(0, 24000) },
        {
          role: 'user',
          content: [
            '上一条回复不是严格合法 JSON，解析错误如下：',
            firstError.message,
            '请只做格式修复，保留已有结构与信息，不新增人物、势力、剧情。',
            '只输出一个可被 JSON.parse 解析的 JSON 对象，不要 Markdown。',
          ].join('\n'),
        },
      ],
      temperature: 0.05,
      maxTokens: 7000,
    });
    plan = parseAIJson(repaired);
  }
  return normalizeAIPlan(plan, selected, { factionLimit, npcLimit });
}

function mergeAIAnalyses(parts, { factionLimit = 8, npcLimit = 60 } = {}) {
  if (!parts.length) throw new Error('API 没有返回任何可合并的分析结果');
  const factions = new Map();
  const characters = new Map();
  const sections = [];
  const worlds = [];

  for (const part of parts) {
    if (part.world && Object.keys(part.world).length) worlds.push(part.world);
    for (const faction of part.factions || []) {
      const key = faction.id || normalizeAIId(faction.name, `faction_${factions.size + 1}`);
      if (!factions.has(key)) factions.set(key, faction);
    }
    for (const character of part.characters || []) {
      const key = character.id || normalizeAIId(character.name, `npc_${characters.size + 1}`);
      if (!characters.has(key)) characters.set(key, character);
    }
    sections.push(...(part.sections || []));
  }

  const primaryWorld = worlds[0] || {};
  return {
    world: {
      name: primaryWorld.name || '长篇导入世界',
      background: primaryWorld.background || worlds.map(w => w.background).filter(Boolean).join('\n') || '由 API 从全文分批抽取生成。',
      gmStyle: primaryWorld.gmStyle || worlds.map(w => w.gmStyle).filter(Boolean)[0] || '尊重原素材气质，鼓励玩家通过行动改变局势。',
    },
    factions: [...factions.values()].slice(0, factionLimit),
    characters: [...characters.values()].slice(0, npcLimit),
    sections,
    raw: { batchCount: parts.length },
  };
}

async function canonicalizeAnalysisWithApi({ analysis, apiKey, baseUrl, model, factionLimit = 8 }) {
  const content = await callOpenAICompatible({
    apiKey, baseUrl, model,
    messages: [
      {
        role: 'system',
        content: [
          '你是小说改编项目的实体归一化编辑。',
          '必须只输出一个严格合法 JSON 对象，不要 Markdown。',
          '任务是合并跨批次抽取造成的同一势力不同拼写、简称、翻译和派生 id。',
          '只能根据提供的实体名称、描述、标签和引用上下文判断；不要新增素材外势力。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '实体归一化：合并同一势力的不同 id/name',
          outputSchema: {
            canonicalFactions: [{ id: 'ascii_id', name: 'string', description: 'string', tags: ['string'] }],
            aliases: [{ fromId: 'old faction id', toId: 'canonical faction id', reason: 'string' }],
          },
          constraints: {
            maxCanonicalFactions: factionLimit,
            language: 'zh-CN',
            keepPlayableFactions: true,
            mergeOnlyWhenSameEntity: true,
            canonicalIdShouldBeOneExistingId: true,
          },
          factions: analysis.factions,
          characterFactionRefs: (analysis.characters || []).map(ch => ({
            id: ch.id, name: ch.name, title: ch.title, factionId: ch.factionId,
          })),
        }),
      },
    ],
    temperature: 0.05,
    maxTokens: 4000,
  });
  const plan = parseAIJson(content);
  const canonicalFactions = (plan.canonicalFactions || []).slice(0, factionLimit).map((f, i) => {
    const id = normalizeAIId(f.id || f.name, `faction_${i + 1}`);
    return {
      id,
      name: f.name || `势力 ${i + 1}`,
      description: f.description || '由 API 从跨批次结果中归一化得到的势力。',
      tags: Array.isArray(f.tags) && f.tags.length ? f.tags : [`faction:${id}`],
    };
  });
  if (canonicalFactions.length === 0) throw new Error('API 实体归一化结果缺少 canonicalFactions[]');

  const canonicalIds = new Set(canonicalFactions.map(f => f.id));
  const aliasMap = new Map();
  for (const f of canonicalFactions) aliasMap.set(f.id, f.id);
  for (const alias of plan.aliases || []) {
    const from = normalizeAIId(alias.fromId, '');
    const to = normalizeAIId(alias.toId, '');
    if (from && to && canonicalIds.has(to)) aliasMap.set(from, to);
  }
  const mapFactionId = id => aliasMap.get(normalizeAIId(id, '')) || normalizeAIId(id, '');
  const finalCanonicalFactions = canonicalFactions.filter(f => mapFactionId(f.id) === f.id);

  return {
    ...analysis,
    factions: finalCanonicalFactions,
    characters: (analysis.characters || []).map(ch => ({ ...ch, factionId: mapFactionId(ch.factionId) })),
    sections: (analysis.sections || []).map(section => ({
      ...section,
      beats: (section.beats || []).map(beat => ({ ...beat, focusFactionId: mapFactionId(beat.focusFactionId) })),
    })),
    raw: {
      ...(analysis.raw || {}),
      canonicalization: {
        apiEnhanced: true,
        canonicalFactionCount: finalCanonicalFactions.length,
        aliasCount: (plan.aliases || []).length,
        aliases: plan.aliases || [],
      },
    },
  };
}

async function analyzeNovelWithApi({ sections, apiKey, baseUrl, model, maxApiSections, factionLimit = 8, npcLimit = 60, beatsPerSection = 3, canonicalizeEntities = true }) {
  const batchSize = Math.max(1, maxApiSections || 1);
  const parts = [];
  for (let offset = 0; offset < sections.length; offset += batchSize) {
    const chunk = sections.slice(offset, offset + batchSize);
    console.error(`[mcp] novel API batch ${Math.floor(offset / batchSize) + 1}/${Math.ceil(sections.length / batchSize)} sections ${offset + 1}-${offset + chunk.length}`);
    try {
      const part = await analyzeNovelChunkWithApi({
        sections: chunk,
        apiKey,
        baseUrl,
        model,
        factionLimit,
        npcLimit,
        beatsPerSection,
        offset,
      });
      parts.push(part);
      console.error(`[mcp] novel API batch ok sections ${offset + 1}-${offset + chunk.length}: ${part.sections.length} sections`);
    } catch (e) {
      if (chunk.length === 1) throw e;
      console.error(`[mcp] novel API batch fallback sections ${offset + 1}-${offset + chunk.length}: ${e.message}`);
      for (let i = 0; i < chunk.length; i++) {
        console.error(`[mcp] novel API single section ${offset + i + 1}/${sections.length}`);
        const part = await analyzeNovelChunkWithApi({
          sections: [chunk[i]],
          apiKey,
          baseUrl,
          model,
          factionLimit,
          npcLimit,
          beatsPerSection,
          offset: offset + i,
        });
        parts.push(part);
        console.error(`[mcp] novel API single ok section ${offset + i + 1}: ${part.sections.length} sections`);
      }
    }
  }
  const merged = mergeAIAnalyses(parts, { factionLimit, npcLimit });
  if (!canonicalizeEntities) return merged;
  return canonicalizeAnalysisWithApi({ analysis: merged, apiKey, baseUrl, model, factionLimit });
}

// ============================================================
// 小说→剧本 段①：把 LLM 抽取结果(analysis) 规整为 NovelDigest（"概括汇总"）
//   只做"理解"层的结构化摘要——世界/势力/角色/地点/剧情节拍；
//   不产出任何游戏结构（场景图/选项/掉落/结局由后续 blueprint/build 阶段决定）。
//   这是新管线的第一段产物，落盘为 JSON 供人工审阅/编辑后进入段②。
// ============================================================
function buildDigestFromAnalysis(analysis = {}, { title, sourcePath } = {}) {
  const world = analysis.world || {};
  const factions = (analysis.factions || []).map(f => ({
    id: f.id, name: f.name,
    role: (f.tags || []).find(t => /role|阵营|faction/i.test(t)) || '',
    description: f.description || '',
  }));
  const inferRole = (c) => {
    if (c.recruitable) return 'ally';
    const tags = (c.tags || []).join(' ');
    if (/反派|antagonist|boss|敌/i.test(tags)) return 'antagonist';
    return 'npc';
  };
  const characters = (analysis.characters || []).map(c => ({
    id: c.id, name: c.name, title: c.title || '', factionId: c.factionId || '',
    role: inferRole(c), description: c.description || '',
  }));
  const locMap = new Map();
  const plotBeats = [];
  let order = 0;
  for (const sec of (analysis.sections || [])) {
    for (const loc of (sec.locations || [])) {
      if (!locMap.has(loc)) locMap.set(loc, { id: slugifyId(loc, `loc_${locMap.size}`), name: loc, description: '', significance: '' });
    }
    for (const b of (sec.beats || [])) {
      order++;
      const tags = b.tags || [];
      const type = tags.includes('ending') ? '收束' : (order <= 2 ? '铺垫' : '上升');
      plotBeats.push({
        id: `beat_${order}`, order,
        sectionTitle: sec.title || '',
        title: b.title || `节拍 ${order}`,
        summary: b.summary || sec.summary || '',
        type,
        locations: sec.locations || [],
        conflicts: sec.conflicts || [],
        focusFactionId: b.focusFactionId || '',
        // 注意：故意不保留 sceneType/eventType/choices —— 那是游戏结构，留给 blueprint/build 决定
      });
    }
  }
  return {
    schemaVersion: 1,
    title: title || world.name || '未命名',
    logline: '',           // 可由段② 补；段① 不强求
    themes: [],
    tone: world.gmStyle || '',
    world: { name: world.name || '', setting: world.background || '', gmStyle: world.gmStyle || '', factions },
    characters,
    locations: [...locMap.values()],
    plotBeats,
    sourceMaterial: { sourcePath: sourcePath || '', sections: (analysis.sections || []).length, beats: plotBeats.length },
  };
}

/** 校验 NovelDigest 结构完整性，返回错误数组（空=通过） */
function validateNovelDigest(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return ['digest 非对象'];
  if (!d.title) errs.push('缺 title');
  if (!d.world || !Array.isArray(d.world.factions)) errs.push('world.factions 非数组');
  if (!Array.isArray(d.characters) || d.characters.length < 1) errs.push('characters 至少 1 个');
  if (!Array.isArray(d.plotBeats) || d.plotBeats.length < 1) errs.push('plotBeats 至少 1 个');
  return errs;
}

// ============================================================
// 小说→剧本 段②：从 NovelDigest 设计 PresetBlueprint（规模/边界/游戏性拓展）
//   LLM 在此"设计"（决定规模、明确边界、标出需补的游戏性），不产出剧本结构本身。
//   产物落盘，需人工审阅/编辑后才进段③ 确定性生成。
// ============================================================
const BLUEPRINT_SIZE = {
  small:  { sceneCount: [15, 25],  chapterCount: [3, 5],   enemyCount: [4, 8],   endingCount: [2, 3] },
  medium: { sceneCount: [40, 60],  chapterCount: [6, 10],  enemyCount: [8, 16],  endingCount: [3, 5] },
  large:  { sceneCount: [80, 120], chapterCount: [10, 16], enemyCount: [16, 28], endingCount: [4, 6] },
};
function _clampInt(val, [lo, hi], def) {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

function buildBlueprintPrompt(digest, { sizeClass = 'medium', arc = '' } = {}) {
  const sz = BLUEPRINT_SIZE[sizeClass] || BLUEPRINT_SIZE.medium;
  return [
    {
      role: 'system',
      content: [
        '你是 TRPG 剧本设计师。基于给定的 NovelDigest（小说概括）设计一份 PresetBlueprint（剧本蓝图）。',
        '你的任务是"设计"，不是写剧本结构：① 确定规模 ② 明确边界（取小说哪一段、从哪 beat 开始、到哪 beat 结束）',
        '③ 标出"基于游戏性需要拓展"的地方——小说是线性的，游戏要交互：战斗遭遇、玩家选择分支、可探索枢纽/支线、多结局。',
        '不要输出场景图/具体选项 id/掉落表（那是后续确定性生成阶段的事）。只输出一个 JSON 对象。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: '设计 PresetBlueprint',
        sizeClass, scaleTargets: sz, arc,
        outputSchema: {
          title: 'string', logline: 'string', tone: 'string',
          scale: { sceneCount: 'number', chapterCount: 'number', enemyCount: 'number', endingCount: 'number' },
          scope: { includeBeatIds: ['beat id'], startBeatId: 'beat id', endBeatId: 'beat id', excludedBeatIds: ['beat id'], note: 'string' },
          characterMapping: [{ digestCharId: 'digest 角色 id', gameRole: 'protagonist|companion|questgiver|boss|npc', notes: 'string' }],
          chapters: [{
            id: 'ascii_id', title: 'string', fromBeatIds: ['beat id'],
            hubScene: { name: 'string', type: 'settlement|wilderness|dungeon' },
            mainEvent: { title: 'string', summary: 'string' },
            combatPlan: [{ enemyConcept: 'string', ecology: { biome: 'string', creatureType: 'string', tier: 'trivial|common|elite|boss' }, count: 'number' }],
            branchPoints: [{ prompt: 'string', options: [{ label: 'string', effectHint: 'string' }] }],
            sideContent: [{ type: 'shop|inn|sidequest|vignette', name: 'string', summary: 'string' }],
          }],
          endings: [{ id: 'ascii_id', name: 'string', condition: '触发条件描述', summary: 'string', tone: 'string' }],
          expansionNotes: ['为游戏性而新增/改动小说的说明'],
        },
        digest: {
          title: digest.title, tone: digest.tone, world: digest.world,
          characters: digest.characters, locations: digest.locations, plotBeats: digest.plotBeats,
        },
      }),
    },
  ];
}

function normalizeBlueprint(raw = {}, digest = {}, { sizeClass = 'medium' } = {}) {
  const sz = BLUEPRINT_SIZE[sizeClass] || BLUEPRINT_SIZE.medium;
  const mid = (r) => Math.round((r[0] + r[1]) / 2);
  const beats = digest.plotBeats || [];
  const scale = {
    sizeClass,
    sceneCount: _clampInt(raw.scale?.sceneCount, sz.sceneCount, mid(sz.sceneCount)),
    chapterCount: _clampInt(raw.scale?.chapterCount, sz.chapterCount, mid(sz.chapterCount)),
    enemyCount: _clampInt(raw.scale?.enemyCount, sz.enemyCount, mid(sz.enemyCount)),
    endingCount: _clampInt(raw.scale?.endingCount, sz.endingCount, mid(sz.endingCount)),
  };
  const chapters = (Array.isArray(raw.chapters) ? raw.chapters : []).map((c, i) => ({
    id: c.id || `ch${i + 1}`, title: c.title || `第${i + 1}章`,
    fromBeatIds: Array.isArray(c.fromBeatIds) ? c.fromBeatIds : [],
    hubScene: c.hubScene || null,
    mainEvent: c.mainEvent || { title: c.title || `第${i + 1}章`, summary: '' },
    combatPlan: Array.isArray(c.combatPlan) ? c.combatPlan : [],
    branchPoints: Array.isArray(c.branchPoints) ? c.branchPoints : [],
    sideContent: Array.isArray(c.sideContent) ? c.sideContent : [],
  }));
  const endings = (Array.isArray(raw.endings) ? raw.endings : []).map((e, i) => ({
    id: e.id || `ending_${i + 1}`, name: e.name || `结局${i + 1}`,
    condition: e.condition || '', summary: e.summary || '', tone: e.tone || '',
  }));
  return {
    schemaVersion: 1,
    title: raw.title || digest.title || '未命名',
    logline: raw.logline || digest.logline || '',
    tone: raw.tone || digest.tone || '',
    scale,
    scope: {
      includeBeatIds: Array.isArray(raw.scope?.includeBeatIds) ? raw.scope.includeBeatIds : beats.map(b => b.id),
      startBeatId: raw.scope?.startBeatId || beats[0]?.id || '',
      endBeatId: raw.scope?.endBeatId || beats[beats.length - 1]?.id || '',
      excludedBeatIds: Array.isArray(raw.scope?.excludedBeatIds) ? raw.scope.excludedBeatIds : [],
      note: raw.scope?.note || '',
    },
    characterMapping: Array.isArray(raw.characterMapping) ? raw.characterMapping : [],
    chapters, endings,
    expansionNotes: Array.isArray(raw.expansionNotes) ? raw.expansionNotes : [],
    sourceDigest: digest.title || '',
  };
}

/** 校验 PresetBlueprint，返回错误数组（空=通过）；传 digest 则额外校验 beat/角色引用 */
function validateBlueprint(bp, digest = null) {
  const errs = [];
  if (!bp || typeof bp !== 'object') return ['blueprint 非对象'];
  if (!bp.scale) errs.push('缺 scale');
  if (!Array.isArray(bp.chapters) || bp.chapters.length < 1) errs.push('chapters 至少 1 个');
  if (!Array.isArray(bp.endings) || bp.endings.length < 1) errs.push('endings 至少 1 个');
  if (digest) {
    const beatIds = new Set((digest.plotBeats || []).map(b => b.id));
    for (const id of (bp.scope?.includeBeatIds || [])) if (!beatIds.has(id)) errs.push(`scope 含未知 beat: ${id}`);
    for (const ch of (bp.chapters || [])) for (const id of (ch.fromBeatIds || [])) if (!beatIds.has(id)) errs.push(`章节 ${ch.id} 引用未知 beat: ${id}`);
    const charIds = new Set((digest.characters || []).map(c => c.id));
    for (const m of (bp.characterMapping || [])) if (m.digestCharId && !charIds.has(m.digestCharId)) errs.push(`characterMapping 含未知角色: ${m.digestCharId}`);
  }
  return errs;
}

// ============================================================
// 小说→剧本 段③：消费 Blueprint + Digest 确定性生成完整剧本（不接触小说原文）
//   逐章建线性场景图(主轴)+支线分叉 / 主事件(分支→选项) / 战斗(敌人+ecology掉落) / 终章多结局。
//   生成后由调用方串 presetNormalize / ensureLootItems / assignImages / validatePreset。
// ============================================================
const TIER_STATS = {
  trivial: { hp: 25,  attack: 6,  defense: 3,  difficulty: 'easy' },
  common:  { hp: 45,  attack: 10, defense: 6,  difficulty: 'normal' },
  elite:   { hp: 90,  attack: 16, defense: 10, difficulty: 'hard' },
  boss:    { hp: 160, attack: 18, defense: 14, difficulty: 'boss' },  // atk 偏保守（参考平衡过的永燃之冠）
};

async function buildPresetFromBlueprint(blueprint, digest) {
  const { resolveLootTable } = await import('../src/data/ecology.js');
  const p = createEmptyPreset();
  p.name = blueprint.title || digest.title || '未命名';
  p.lore = { worldName: digest.world?.name || '', era: '', background: digest.world?.setting || '', rules: '', gmStyle: blueprint.tone || digest.tone || '' };
  p.factions = (digest.world?.factions || []).map(f => ({ id: f.id, name: f.name, description: f.description || '', reputationVar: `rep_${f.id}`, tags: [`faction:${f.id}`] }));

  // 角色：主角 + companions（按 characterMapping）
  const roleOf = new Map((blueprint.characterMapping || []).map(m => [m.digestCharId, m.gameRole]));
  const dchars = digest.characters || [];
  const protag = dchars.find(c => roleOf.get(c.id) === 'protagonist') || dchars[0] || { name: '主角', description: '' };
  p.characters.push({
    id: 'char_player', name: protag.name || '主角', title: protag.title || '', description: protag.description || '',
    stats: { hp: 120, hpCurrent: 120, mp: 30, mpCurrent: 30, attack: 12, defense: 6, speed: 10, luck: 1 },
    abilities: [{ id: 'ability_strike', name: '强袭', type: 'active', cost: { mp: 0 }, effect: { damage: { formula: 'attack+1d8' } }, cooldown: 0 }],
    inventory: [],
  });
  for (const c of dchars) {
    if (roleOf.get(c.id) === 'companion') {
      p.characters.push({
        id: `char_${c.id}`, name: c.name, title: c.title || '', description: c.description || '',
        stats: { hp: 80, hpCurrent: 80, mp: 20, mpCurrent: 20, attack: 9, defense: 5, speed: 11, luck: 1 },
        abilities: [{ id: `ab_${c.id}_slash`, name: '斩击', type: 'active', cost: { mp: 0 }, effect: { damage: { formula: 'attack+1d6' } }, cooldown: 0 }],
        _isCompanion: true,
      });
    }
  }

  // 逐章：线性主轴 hub + 支线分叉
  const chapters = blueprint.chapters || [];
  let prevHub = null;
  chapters.forEach((ch, ci) => {
    const hubId = `scene_${ch.id}`;
    const hub = {
      id: hubId, name: ch.title || `第${ci + 1}章`, type: ch.hubScene?.type || 'settlement', icon: '🏛',
      coords: { x: ci * 3, y: 0 }, tags: ['main', ci === 0 ? 'spawn' : ''].filter(Boolean),
      description: ch.mainEvent?.summary || ch.title || '', connections: [], events: [], vignettes: [],
    };
    p.scenes.push(hub);
    if (prevHub) {
      prevHub.connections.push({ to: hubId, label: `前往 ${hub.name}` });
      hub.connections.push({ to: prevHub.id, label: `返回 ${prevHub.name}` });
    }

    // 主事件：分支点 → 选项（effect=set_variable，给 flag 后续可用）
    const mainEvId = `ev_${ch.id}_main`;
    let choices = (ch.branchPoints?.[0]?.options || []).map((o, oi) => ({
      id: `choice_${oi + 1}`, text: o.label || `选项${oi + 1}`,
      outcomes: [{ probability: 1.0, text: o.effectHint || '', effects: [{ type: 'set_variable', target: `${ch.id}_choice_${oi + 1}`, value: true }] }],
    }));
    if (choices.length === 0) choices = [{ id: 'continue', text: '继续', outcomes: [{ probability: 1.0, text: '', effects: [] }] }];
    p.events.push({
      id: mainEvId, type: 'event', name: ch.mainEvent?.title || ch.title || `第${ci + 1}章`,
      description: ch.mainEvent?.summary || '', eventType: 'story', inScene: [hubId],
      trigger: { type: 'composite', condition: { inScene: [hubId], excludeCompletedEvents: [mainEvId], probability: 1.0 } },
      priority: 100, repeatable: false, tags: ['main'], choices,
    });
    hub.events.push(mainEvId);

    // 战斗计划 → 敌人(+ecology 掉落) + 战斗事件（主事件后触发）
    (ch.combatPlan || []).forEach((cp, cpi) => {
      const tier = (cp.ecology?.tier && TIER_STATS[cp.ecology.tier]) ? cp.ecology.tier : 'common';
      const st = TIER_STATS[tier];
      const count = Math.max(1, Math.min(3, Number(cp.count) || 1));
      const ids = [];
      for (let k = 0; k < count; k++) {
        const eid = `enemy_${ch.id}_${cpi + 1}_${k + 1}`;
        const ecology = { biome: cp.ecology?.biome || 'plains', creatureType: cp.ecology?.creatureType || 'beast', tier };
        p.enemies.push({
          id: eid, name: cp.enemyConcept || '敌人', description: '',
          stats: { hp: st.hp, hpCurrent: st.hp, mp: 0, mpCurrent: 0, attack: st.attack, defense: st.defense, magicDefense: Math.round(st.defense * 0.6), speed: 8, luck: 1 },
          difficulty: st.difficulty, tags: ['enemy', tier], ecology, lootMode: 'static', lootTable: resolveLootTable({ ...ecology }) || [],
        });
        ids.push(eid);
      }
      const combatEvId = `ev_${ch.id}_combat_${cpi + 1}`;
      p.events.push({
        id: combatEvId, type: 'event', name: `遭遇：${cp.enemyConcept || '敌人'}`,
        description: `${cp.enemyConcept || '敌人'} 拦住去路。`, eventType: 'encounter', inScene: [hubId],
        trigger: { type: 'composite', condition: { inScene: [hubId], requireCompletedEvents: [mainEvId], excludeCompletedEvents: [combatEvId], probability: 1.0 } },
        priority: 90 - cpi, repeatable: false, tags: ['combat'],
        choices: [{ id: 'fight', text: '应战', outcomes: [{ probability: 1.0, text: '', effects: [{ type: 'start_combat', enemyIds: ids }] }] }],
      });
      hub.events.push(combatEvId);
    });

    // 支线内容 → 支线场景（从 hub 双向分叉）
    (ch.sideContent || []).forEach((sc, si) => {
      const sid = `scene_${ch.id}_side${si + 1}`;
      const sscene = {
        id: sid, name: sc.name || `支线${si + 1}`,
        type: (sc.type === 'inn' || sc.type === 'shop') ? 'settlement' : 'vignette', icon: '✦',
        coords: { x: ci * 3, y: si + 1 }, tags: sc.type === 'inn' ? ['safe', 'rest'] : [],
        description: sc.summary || '', connections: [{ to: hubId, label: `返回 ${hub.name}` }], events: [], vignettes: [sc.summary || ''],
      };
      hub.connections.push({ to: sid, label: `前往 ${sscene.name}` });
      p.scenes.push(sscene);
    });

    prevHub = hub;
  });

  // 终章：最后 hub 后接终章场景，单事件多选项 = 多结局（玩家可选）
  if (prevHub) {
    const finaleId = 'scene_finale';
    const finale = { id: finaleId, name: '终章', type: 'ending', icon: '🌅', coords: { x: chapters.length * 3, y: 0 }, tags: ['main', 'ending_room'], description: '一切走向终局。', connections: [], events: [], vignettes: [] };
    prevHub.connections.push({ to: finaleId, label: '走向终局' });
    p.scenes.push(finale);
    const endings = (blueprint.endings && blueprint.endings.length) ? blueprint.endings : [{ id: 'default', name: '终幕', summary: '故事落下帷幕。', tone: '' }];
    const finaleEvId = 'ev_finale';
    p.events.push({
      id: finaleEvId, type: 'event', name: '结局判定', description: '你的旅程在此抵达终点。', eventType: 'story',
      inScene: [finaleId], trigger: { type: 'composite', condition: { inScene: [finaleId], excludeCompletedEvents: [finaleEvId], probability: 1.0 } },
      priority: 100, repeatable: false, tags: ['ending', 'main'],
      choices: endings.map((e, ei) => ({
        id: e.id || `ending_${ei + 1}`, text: e.name || `结局${ei + 1}`,
        outcomes: [{ probability: 1.0, text: e.summary || '', effects: [{ type: 'set_variable', target: 'game_complete', value: true }, { type: 'set_variable', target: `ending_${e.id || ei + 1}`, value: true }] }],
      })),
    });
    finale.events.push(finaleEvId);
  }

  p.startingSceneId = p.scenes[0]?.id || null;
  return p;
}


function replaceFactionTags(tags, mapFactionId) {
  return (tags || []).map(tag => {
    const text = String(tag);
    if (text.startsWith('faction:')) return `faction:${mapFactionId(text.slice('faction:'.length))}`;
    if (text.startsWith('origin:')) return `origin:${mapFactionId(text.slice('origin:'.length))}`;
    return tag;
  });
}

function applyFactionCanonicalizationToPreset({ canonicalFactions, aliases }) {
  const canonicalIds = new Set(canonicalFactions.map(f => f.id));
  const aliasMap = new Map(canonicalFactions.map(f => [f.id, f.id]));
  for (const alias of aliases || []) {
    const from = normalizeAIId(alias.fromId, '');
    const to = normalizeAIId(alias.toId, '');
    if (from && to && canonicalIds.has(to)) aliasMap.set(from, to);
  }
  const mapFactionId = id => aliasMap.get(normalizeAIId(id, '')) || normalizeAIId(id, '');
  canonicalFactions = canonicalFactions.filter(f => mapFactionId(f.id) === f.id);
  const startSceneFor = id => {
    const mapped = mapFactionId(id);
    if (findById(preset.scenes, `scene_start_${mapped}`)) return `scene_start_${mapped}`;
    if (findById(preset.scenes, `scene_start_${id}`)) return `scene_start_${id}`;
    return preset.startingSceneId || preset.scenes[0]?.id || null;
  };

  preset.factions = canonicalFactions.map(f => ({
    id: f.id,
    name: f.name,
    description: f.description || '由 API 归一化得到的势力。',
    reputationVar: `rep_${f.id}`,
    tags: f.tags || [`faction:${f.id}`],
  }));

  if (preset.startingOptions) {
    preset.startingOptions.origins = canonicalFactions.map(f => ({
      id: f.id,
      name: f.name,
      icon: '◆',
      tags: [`origin:${f.id}`, `faction:${f.id}`],
      description: `以${f.name}成员或关联者身份开局。`,
      statBonus: {},
    }));
  }

  preset.startingSceneRules = canonicalFactions.map(f => ({ when: { tags: [`origin:${f.id}`] }, sceneId: startSceneFor(f.id) }))
    .filter(r => r.sceneId);
  const firstScene = startSceneFor(canonicalFactions[0]?.id || '');
  if (firstScene) {
    preset.startingSceneRules.push({ default: firstScene });
    preset.startingSceneId = firstScene;
  }

  for (const scene of preset.scenes) scene.tags = replaceFactionTags(scene.tags, mapFactionId);
  for (const npc of preset.npcs || []) {
    npc.tags = replaceFactionTags(npc.tags, mapFactionId);
    const m = String(npc.spawnScene || '').match(/^scene_start_(.+)$/);
    if (m) npc.spawnScene = startSceneFor(m[1]) || npc.spawnScene;
    if (Array.isArray(npc.schedule)) {
      for (const slot of npc.schedule) {
        const sm = String(slot.scene || '').match(/^scene_start_(.+)$/);
        if (sm) slot.scene = startSceneFor(sm[1]) || slot.scene;
      }
    }
  }
  for (const event of preset.events || []) {
    event.tags = replaceFactionTags(event.tags, mapFactionId);
    for (const choice of event.choices || []) {
      for (const outcome of choice.outcomes || []) {
        for (const effect of outcome.effects || []) {
          if (effect.type === 'set_variable' && String(effect.name || '').startsWith('rep_')) {
            effect.name = `rep_${mapFactionId(String(effect.name).slice(4))}`;
          }
        }
      }
    }
  }
  return { canonicalFactionCount: canonicalFactions.length, aliasCount: (aliases || []).length };
}

async function generateRouteExpansionWithApi({ apiKey, baseUrl, model, factions, routeLength, includeEndings }) {
  const content = await callOpenAICompatible({
    apiKey, baseUrl, model,
    messages: [
      {
        role: 'system',
        content: [
          '你是 TRPG 剧本扩写设计师，正在为已有超大剧本补强不同势力起点的专属可玩路线。',
          '必须只输出严格合法 JSON 对象，不要 Markdown。',
          '所有内容必须是原创改编摘要，不复述原文长段。',
          '每个势力都要有不同目标、冲突、NPC 和选择后果；避免所有起点进入同一体验。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '为每个势力生成起点专属支线包',
          outputSchema: {
            routes: [{
              factionId: 'existing faction id',
              npc: { name: 'string', title: 'string', description: 'string', personality: 'string' },
              scenes: [{
                title: 'string',
                type: 'settlement|wilderness|combat|dungeon|vignette',
                summary: 'string',
                event: {
                  title: 'string',
                  type: 'story|encounter|rescue|boss',
                  choices: [{ id: 'ascii_id', text: 'string', outcome: 'string', setVariable: 'ascii_variable' }],
                },
              }],
              ending: includeEndings ? {
                title: 'string',
                summary: '势力专属结局或尾声，不要与主结局重复',
                choices: [{ id: 'ascii_id', text: 'string', outcome: 'string', setVariable: 'ascii_variable' }],
              } : null,
            }],
          },
          constraints: {
            routeLength,
            includeEndings,
            language: 'zh-CN',
            sceneCountPerFaction: routeLength,
            choiceCountPerEvent: 2,
          },
          factions,
        }),
      },
    ],
    temperature: 0.35,
    maxTokens: 7000,
  });
  const plan = parseAIJson(content);
  if (!Array.isArray(plan.routes) || plan.routes.length === 0) throw new Error('API 扩写结果缺少 routes[]');
  return plan.routes;
}

function applyRouteExpansion({ routes, routeLength, includeEndings }) {
  const created = { scenes: [], events: [], npcs: [], endings: [] };
  const hubId = findById(preset.scenes, 'scene_crossroads') ? 'scene_crossroads' : preset.scenes[0]?.id;
  const firstArcId = preset.scenes.find(s => s.id?.startsWith('scene_arc_'))?.id || hubId;
  for (const route of routes) {
    const factionId = normalizeAIId(route.factionId, '');
    const faction = findById(preset.factions || [], factionId);
    if (!faction) continue;
    const startId = `scene_start_${factionId}`;
    const start = findById(preset.scenes, startId);
    if (!start) continue;
    const routeTag = `route:${factionId}`;

    const npcId = `npc_route_${factionId}`;
    if (route.npc && !findById(preset.npcs, npcId)) {
      preset.npcs.push({
        id: npcId, type: 'npc',
        name: route.npc.name || `${faction.name}引路人`,
        title: route.npc.title || `${faction.name}专属导师`,
        description: route.npc.description || '由 API 为势力起点路线补写的关键 NPC。',
        icon: '◇',
        personality: route.npc.personality || 'route_guide',
        recruitable: false,
        spawnScene: startId,
        initialInventory: [],
        giftPreferences: {},
        schedule: [{ day: 'any', hour: [7, 22], scene: startId }],
        stats: undefined,
        abilities: [],
        dialogueTree: { root: { speaker: 'self', text: route.npc.description || '你准备好走属于我们的路线了吗？', branches: [{ text: '说明当前局势', exit: true, affectionDelta: 1 }] } },
        tags: [`faction:${factionId}`, routeTag, 'api_route_expansion'],
      });
      created.npcs.push(npcId);
    }

    const scenePlans = (route.scenes || []).slice(0, routeLength);
    let prevId = startId;
    scenePlans.forEach((scenePlan, i) => {
      const sceneId = `scene_route_${factionId}_${String(i + 1).padStart(2, '0')}`;
      const eventId = `ev_route_${factionId}_${String(i + 1).padStart(2, '0')}`;
      if (!findById(preset.scenes, sceneId)) {
        preset.scenes.push({
          id: sceneId,
          name: truncateText(scenePlan.title || `${faction.name}支线 ${i + 1}`, 30),
          type: ['settlement', 'wilderness', 'combat', 'dungeon', 'vignette'].includes(scenePlan.type) ? scenePlan.type : 'vignette',
          icon: '◇',
          description: summarizePlayableText(scenePlan.summary, `${faction.name}的专属开局冲突正在逼近。`),
          coords: { x: -4 - i, y: (preset.factions.findIndex(f => f.id === factionId) || 0) * 2 },
          connections: [],
          events: [eventId],
          vignettes: [`${faction.name}的立场让这条路线呈现出不同的风险与收益。`],
          tags: ['route', 'branch', `faction:${factionId}`, routeTag, 'api_route_expansion'],
        });
        created.scenes.push(sceneId);
      }
      const prev = findById(preset.scenes, prevId);
      if (prev) {
        prev.connections ||= [];
        if (!prev.connections.some(c => c.to === sceneId)) prev.connections.push({ to: sceneId, label: i === 0 ? `进入${faction.name}专属路线` : '继续专属路线' });
      }
      const scene = findById(preset.scenes, sceneId);
      const nextTarget = i === scenePlans.length - 1 ? (hubId || firstArcId) : `scene_route_${factionId}_${String(i + 2).padStart(2, '0')}`;
      if (scene && nextTarget && !scene.connections.some(c => c.to === nextTarget)) {
        scene.connections.push({ to: nextTarget, label: i === scenePlans.length - 1 ? '汇入命运交汇地' : '推进专属路线' });
      }
      if (!findById(preset.events, eventId)) {
        const eventPlan = scenePlan.event || {};
        const varName = `route_${factionId}_${i + 1}_resolved`;
        const choices = (eventPlan.choices?.length ? eventPlan.choices : [
          { id: 'support', text: `支持${faction.name}方案`, outcome: `${faction.name}路线影响力上升。`, setVariable: `${varName}_support` },
          { id: 'question', text: '保留判断并寻找替代方案', outcome: '你为后续分歧保留了空间。', setVariable: `${varName}_question` },
        ]).slice(0, 3);
        preset.events.push({
          id: eventId, type: 'event',
          name: truncateText(eventPlan.title || `${faction.name}专属事件 ${i + 1}`, 40),
          description: summarizePlayableText(eventPlan.summary || eventPlan.title, `围绕${faction.name}的专属矛盾已经摆到眼前。`),
          eventType: ['story', 'encounter', 'rescue', 'boss'].includes(eventPlan.type) ? eventPlan.type : 'story',
          priority: 85,
          trigger: { type: 'composite', condition: { inScene: [sceneId], excludeCompletedEvents: [eventId], probability: 1.0 } },
          choices: choices.map((choice, idx) => ({
            id: normalizeAIId(choice.id, `choice_${idx + 1}`),
            text: choice.text || `选择 ${idx + 1}`,
            requirements: null,
            outcomes: [{ probability: 1.0, text: choice.outcome || '局势因此改变。', effects: [
              { type: 'set_variable', name: varName, value: true },
              { type: 'set_variable', name: normalizeAIId(choice.setVariable, `${varName}_choice_${idx + 1}`), value: true },
              { type: 'set_variable', name: `rep_${factionId}`, value: idx === 0 ? 3 : 1 },
              { type: 'add_memory', value: `玩家在${faction.name}专属路线中选择：${choice.text || `选择 ${idx + 1}`}。` },
            ] }],
          })),
          repeatable: false, maxOccurrences: 1,
          tags: ['route', 'branch', `faction:${factionId}`, routeTag, 'api_route_expansion'],
          aiPromptHint: scenePlan.summary || '',
        });
        created.events.push(eventId);
      }
      prevId = sceneId;
    });

    if (includeEndings && route.ending) {
      const endingId = `scene_route_${factionId}_ending`;
      const endingEventId = `ev_route_${factionId}_ending`;
      if (!findById(preset.scenes, endingId)) {
        preset.scenes.push({
          id: endingId,
          name: truncateText(route.ending.title || `${faction.name}专属尾声`, 30),
          type: 'ending',
          icon: '◇',
          description: `API势力结局：${route.ending.summary || `${faction.name}路线的专属收束。`}`,
          coords: { x: 40, y: (preset.factions.findIndex(f => f.id === factionId) || 0) * 2 },
          connections: [],
          events: [endingEventId],
          vignettes: [`${faction.name}的选择最终改变了这条历史支流。`],
          tags: ['ending', 'route_ending', `faction:${factionId}`, routeTag, 'api_route_expansion'],
        });
        created.scenes.push(endingId);
        created.endings.push(endingId);
      }
      const lateEnding = preset.scenes.filter(s => s.type === 'ending' && s.id.startsWith('scene_arc_')).at(-1);
      if (lateEnding) {
        lateEnding.connections ||= [];
        if (!lateEnding.connections.some(c => c.to === endingId)) {
          lateEnding.connections.push({ to: endingId, label: `进入${faction.name}专属尾声`, gated: { requireVariables: { [`route_${factionId}_1_resolved`]: true }, hint: `${faction.name}路线的余波正在等待回应。` } });
        }
      }
      if (!findById(preset.events, endingEventId)) {
        const choices = (route.ending.choices?.length ? route.ending.choices : [
          { id: 'accept_legacy', text: '接受这条路线的代价', outcome: `${faction.name}路线完成。`, setVariable: `ending_${factionId}_accepted` },
        ]).slice(0, 3);
        preset.events.push({
          id: endingEventId, type: 'event',
          name: truncateText(route.ending.title || `${faction.name}专属结局`, 40),
          description: route.ending.summary || `${faction.name}路线的专属收束。`,
          eventType: 'boss', priority: 95,
          trigger: { type: 'composite', condition: { inScene: [endingId], excludeCompletedEvents: [endingEventId], probability: 1.0 } },
          choices: choices.map((choice, idx) => ({
            id: normalizeAIId(choice.id, `choice_${idx + 1}`),
            text: choice.text || `结局选择 ${idx + 1}`,
            requirements: null,
            outcomes: [{ probability: 1.0, text: choice.outcome || '路线完成。', effects: [
              { type: 'set_variable', name: normalizeAIId(choice.setVariable, `ending_${factionId}_${idx + 1}`), value: true },
              { type: 'add_memory', value: `${faction.name}专属结局：${choice.text || `结局选择 ${idx + 1}`}。` },
            ] }],
          })),
          repeatable: false, maxOccurrences: 1,
          tags: ['ending', 'route_ending', `faction:${factionId}`, routeTag, 'api_route_expansion'],
          aiPromptHint: route.ending.summary || '',
        });
        created.events.push(endingEventId);
      }
    }
  }
  dirty = true;
  return created;
}

function sampleStrategicSourceSections({ sourcePath, maxSections = 8 }) {
  if (!sourcePath) return [];
  try {
    const { text } = readNovelSource(sourcePath);
    const raw = splitNovelSections(text, Math.max(20, maxSections * 4));
    const sections = filterStorySections(raw, false);
    if (sections.length === 0) return [];
    const picks = new Map();
    const add = index => {
      const safe = Math.max(0, Math.min(sections.length - 1, index));
      const section = sections[safe];
      if (section && !picks.has(safe)) picks.set(safe, section);
    };
    for (let i = 0; i < Math.min(3, sections.length); i++) add(i);
    for (let i = 1; i <= Math.max(0, maxSections - 5); i++) add(Math.floor((sections.length * i) / Math.max(1, maxSections - 4)));
    for (let i = Math.max(0, sections.length - 2); i < sections.length; i++) add(i);
    return [...picks.entries()].slice(0, maxSections).map(([index, section]) => ({
      index: index + 1,
      title: section.title,
      excerpt: section.text.slice(0, Number(process.env.STRATEGIC_API_EXCERPT_CHARS || 1800)),
    }));
  } catch {
    return [];
  }
}

function normalizeStrategicLayer(plan, selectedFactions, mode) {
  const factionIds = new Set([
    ...(preset.factions || []).map(f => f.id),
    ...selectedFactions.map(f => f.id),
  ]);
  const normalizedFactions = {};
  for (const [i, f] of selectedFactions.entries()) {
    const raw = (plan.factions || []).find(x => normalizeAIId(x.factionId || x.id || x.name, '') === f.id) || {};
    const holdings = (raw.holdings || []).slice(0, 12).map((h, j) => {
      const id = normalizeAIId(h.id || h.name, `holding_${f.id}_${j + 1}`);
      return {
        id,
        name: h.name || `${f.name}据点 ${j + 1}`,
        type: ['capital', 'city', 'town', 'village', 'fortress', 'mine', 'port', 'pasture', 'monastery', 'market'].includes(h.type) ? h.type : 'town',
        population: Math.max(0, Math.round(Number(h.population || 0))),
        resources: Array.isArray(h.resources) ? h.resources.slice(0, 8).map(String) : [],
        specialties: Array.isArray(h.specialties) ? h.specialties.slice(0, 8).map(String) : [],
        productionEfficiency: Math.max(0, Math.min(200, Math.round(Number(h.productionEfficiency ?? 100)))),
        security: Math.max(0, Math.min(100, Math.round(Number(h.security ?? 50)))),
        narrativeRole: h.narrativeRole || h.notes || '',
        confidence: ['explicit', 'inferred', 'created'].includes(h.confidence) ? h.confidence : (mode === 'novel_adaptation' ? 'inferred' : 'created'),
        evidence: h.evidence || '',
      };
    });
    const totalPopulation = Number(raw.economy?.totalPopulation)
      || holdings.reduce((sum, h) => sum + (h.population || 0), 0);
    normalizedFactions[f.id] = {
      factionId: f.id,
      name: f.name,
      strategicSummary: raw.strategicSummary || `${f.name}的战略设定由 API 生成。`,
      holdings,
      resources: (raw.resources || []).slice(0, 12).map((r, j) => ({
        id: normalizeAIId(r.id || r.name, `resource_${f.id}_${j + 1}`),
        name: r.name || `资源 ${j + 1}`,
        category: r.category || 'general',
        abundance: ['scarce', 'limited', 'stable', 'abundant', 'dominant'].includes(r.abundance) ? r.abundance : 'stable',
        strategicUse: r.strategicUse || '',
        confidence: ['explicit', 'inferred', 'created'].includes(r.confidence) ? r.confidence : (mode === 'novel_adaptation' ? 'inferred' : 'created'),
      })),
      economy: {
        totalPopulation: Math.max(0, Math.round(totalPopulation || 0)),
        laborPool: Math.max(0, Math.round(Number(raw.economy?.laborPool || Math.floor((totalPopulation || 0) * 0.42)))),
        foodBalance: raw.economy?.foodBalance || 'unknown',
        treasuryPressure: raw.economy?.treasuryPressure || 'unknown',
        mobilizationCapacity: raw.economy?.mobilizationCapacity || 'unknown',
        productionFormula: raw.economy?.productionFormula || 'effective_output = population * productionEfficiency * stability_modifier',
      },
      internalPolitics: raw.internalPolitics || '尚待通过剧情揭示的内政矛盾。',
      diplomacy: (raw.diplomacy || []).slice(0, 12).map(d => ({
        targetFactionId: normalizeAIId(d.targetFactionId || d.target || '', ''),
        stance: d.stance || 'uncertain',
        publicReason: d.publicReason || d.reason || '',
        hiddenTension: d.hiddenTension || '',
        confidence: ['explicit', 'inferred', 'created'].includes(d.confidence) ? d.confidence : (mode === 'novel_adaptation' ? 'inferred' : 'created'),
      })).filter(d => !d.targetFactionId || factionIds.has(d.targetFactionId)),
      intelligenceProfile: {
        publicKnowledge: raw.intelligenceProfile?.publicKnowledge || raw.publicKnowledge || '',
        restrictedKnowledge: raw.intelligenceProfile?.restrictedKnowledge || '',
        misinformation: raw.intelligenceProfile?.misinformation || '',
        uncertainty: raw.intelligenceProfile?.uncertainty || (mode === 'novel_adaptation' ? '小说未直接给出，需保持可校正。' : ''),
      },
      playableRoles: (raw.playableRoles || []).slice(0, 6).map((role, j) => ({
        roleId: normalizeAIId(role.roleId || role.title, `role_${j + 1}`),
        title: role.title || `${f.name}职务 ${j + 1}`,
        authorityScope: role.authorityScope || '只能通过汇报、建议和命令影响局势。',
        visibleIntel: role.visibleIntel || '只能看到与职务相关的情报。',
        commandLimits: role.commandLimits || role.forbiddenActions || '不能任意调动全势力资源，命令需经由下属执行并承担延迟与误判。',
        reportCadence: role.reportCadence || '关键事件发生时收到汇报。',
      })),
    };
  }
  return {
    version: 1,
    mode,
    apiEnhanced: true,
    generatedAt: new Date().toISOString(),
    designPrinciples: plan.designPrinciples || [
      '战略设定服务于 TRPG 叙事，不提供全知全能的策略面板。',
      '玩家通过职务、汇报、命令、谈判和现场行动影响局势。',
      mode === 'novel_adaptation' ? '小说未明示的数据必须标注 inferred，并允许后续校正。' : '原创剧本可主动补齐资源和制度设定。',
    ],
    accessRules: plan.accessRules || {
      commoner: '只能获得传闻、价格、征发和治安变化。',
      officer: '获得局部军政汇报和直属单位执行结果。',
      ruler: '获得高层汇总，但仍受官僚、距离、谍报误差和政治阻力限制。',
    },
    formulas: plan.formulas || {
      production: 'effective_output = population * productionEfficiency * stability_modifier',
      stability: 'stability_modifier = clamp(0.5, 1.2, security/100 + legitimacy/200)',
      intelligence: 'visible_intel = role_scope + faction_access - secrecy - distance',
    },
    factions: normalizedFactions,
  };
}

async function generateStrategicLayerWithApi({ apiKey, baseUrl, model, mode, sourcePath, maxSourceSections = 8, factionIds }) {
  const selectedFactions = (preset.factions || [])
    .filter(f => !factionIds?.length || factionIds.includes(f.id))
    .map(f => ({ id: f.id, name: f.name, description: f.description, tags: f.tags || [] }));
  if (selectedFactions.length === 0) throw new Error('没有可生成战略设定的 factions');
  const selectedIds = new Set(selectedFactions.map(f => f.id));
  const relatedSceneSamples = (preset.scenes || [])
    .filter(s => {
      const tags = s.tags || [];
      return tags.some(t => selectedIds.has(String(t).slice('faction:'.length)))
        || selectedFactions.some(f => s.id === `scene_start_${f.id}` || String(s.id).includes(`_${f.id}_`));
    })
    .slice(0, 24)
    .map(s => ({ id: s.id, name: s.name, type: s.type, description: truncateText(s.description || '', 180), tags: s.tags || [] }));
  const relatedNpcSamples = (preset.npcs || [])
    .filter(n => (n.tags || []).some(t => selectedIds.has(String(t).slice('faction:'.length))))
    .slice(0, 20)
    .map(n => ({ id: n.id, name: n.name, title: n.title, tags: n.tags || [] }));
  const sourceSections = mode === 'novel_adaptation'
    ? sampleStrategicSourceSections({ sourcePath: sourcePath || preset.sourceMaterial?.path, maxSections: maxSourceSections })
    : [];
  const messages = [
      {
        role: 'system',
        content: [
          '你是 TRPG 世界战略设定设计师，正在为可玩剧本补充势力治理、资源、人口、内政外交和情报可见性。',
          '必须只输出严格合法 JSON 对象，不要 Markdown。',
          '玩法仍然是 TRPG：玩家通过角色职务、现场行动、听取汇报、谈判和下达有限命令参与，不得设计成全知全能的策略游戏面板。',
          mode === 'novel_adaptation'
            ? '当前是小说改编：小说没有直接写出的城市、人口、矿产、产能等，必须根据剧情进展、地理、战争规模、角色职权合理反推，并用 confidence 标注 explicit/inferred。不要把推断伪装成原文事实。'
            : '当前是原创剧本：可以更积极、全面地创造资源、制度和外交设定，但仍要保持 TRPG 情报限制和职务边界。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '生成 TRPG 战略设定层',
          mode,
          outputSchema: {
            designPrinciples: ['string'],
            accessRules: { commoner: 'string', officer: 'string', ruler: 'string' },
            formulas: { production: 'string', stability: 'string', intelligence: 'string' },
            factions: [{
              factionId: 'existing faction id',
              strategicSummary: 'string',
              holdings: [{
                id: 'ascii_id',
                name: 'string',
                type: 'capital|city|town|village|fortress|mine|port|pasture|monastery|market',
                population: 12345,
                resources: ['iron'],
                specialties: ['horses'],
                productionEfficiency: 80,
                security: 60,
                narrativeRole: 'how this place appears in TRPG reports/events',
                confidence: 'explicit|inferred|created',
                evidence: 'brief reason or source clue',
              }],
              resources: [{ id: 'ascii_id', name: 'string', category: 'food|ore|craft|trade|military|magic|other', abundance: 'scarce|limited|stable|abundant|dominant', strategicUse: 'string', confidence: 'explicit|inferred|created' }],
              economy: { totalPopulation: 100000, laborPool: 42000, foodBalance: 'string', treasuryPressure: 'string', mobilizationCapacity: 'string', productionFormula: 'string' },
              internalPolitics: 'string',
              diplomacy: [{ targetFactionId: 'existing faction id', stance: 'ally|rival|war|vassal|trade|secret_contact|uncertain', publicReason: 'string', hiddenTension: 'string', confidence: 'explicit|inferred|created' }],
              intelligenceProfile: { publicKnowledge: 'string', restrictedKnowledge: 'string', misinformation: 'string', uncertainty: 'string' },
              playableRoles: [{ roleId: 'ascii_id', title: 'string', authorityScope: 'string', visibleIntel: 'string', commandLimits: 'string', reportCadence: 'string' }],
            }],
          },
          constraints: {
            language: 'zh-CN',
            holdingsPerFaction: 4,
            includePopulationAndEfficiency: true,
            noStrategyGameUI: true,
            roleLimitedIntel: true,
            selectedFactionIds: selectedFactions.map(f => f.id),
          },
          world: {
            name: preset.lore?.worldName || preset.name,
            background: preset.lore?.background || preset.description,
            rules: preset.lore?.rules,
          },
          existingFactions: selectedFactions,
          existingNpcs: relatedNpcSamples,
          existingSceneSamples: relatedSceneSamples,
          sourceSections,
        }),
      },
  ];
  const content = await callOpenAICompatible({
    apiKey, baseUrl, model,
    messages,
    temperature: mode === 'novel_adaptation' ? 0.25 : 0.45,
    maxTokens: 6000,
  });
  let plan;
  try {
    plan = parseAIJson(content);
  } catch (firstError) {
    const repaired = await callOpenAICompatible({
      apiKey, baseUrl, model,
      messages: [
        ...messages,
        { role: 'assistant', content: content.slice(0, 24000) },
        {
          role: 'user',
          content: [
            '上一条战略设定回复不是严格合法 JSON，解析错误如下：',
            firstError.message,
            '请只做 JSON 格式修复，保留已有 strategicLayer 信息，不新增势力。',
            '只输出一个可被 JSON.parse 解析的 JSON 对象，不要 Markdown。',
          ].join('\n'),
        },
      ],
      temperature: 0.05,
      maxTokens: 6000,
    });
    plan = parseAIJson(repaired);
  }
  return normalizeStrategicLayer(plan, selectedFactions, mode);
}

function applyStrategicLayer({ layer, createBriefingEvents = true }) {
  preset.strategicLayer = {
    ...(preset.strategicLayer || {}),
    ...layer,
    factions: {
      ...(preset.strategicLayer?.factions || {}),
      ...(layer.factions || {}),
    },
    generatedAt: layer.generatedAt || new Date().toISOString(),
  };
  layer = preset.strategicLayer;
  const created = { events: [] };
  if (!createBriefingEvents) {
    dirty = true;
    return created;
  }
  for (const factionId of Object.keys(layer.factions || {})) {
    const faction = findById(preset.factions || [], factionId);
    const start = findById(preset.scenes || [], `scene_start_${factionId}`);
    const data = layer.factions[factionId];
    if (!faction || !start || !data) continue;
    const eventId = `ev_strategy_briefing_${factionId}`;
    start.events ||= [];
    if (!start.events.includes(eventId)) start.events.push(eventId);
    const topHoldings = (data.holdings || []).slice(0, 3).map(h => `${h.name}(${h.type}, 人口${h.population || '未知'}, 产能${h.productionEfficiency})`).join('；');
    const role = data.playableRoles?.[0];
    const eventData = {
      id: eventId,
      type: 'event',
      name: `${faction.name}战略汇报`,
      description: [
        `幕僚向你递交${faction.name}的局势简报。`,
        topHoldings ? `核心据点：${topHoldings}。` : '',
        data.internalPolitics ? `内政焦点：${data.internalPolitics}` : '',
        role ? `你当前可扮演的职务边界：${role.authorityScope}；${role.commandLimits}` : '你的命令需要通过具体人物执行，无法直接操纵整个势力。',
      ].filter(Boolean).join('\n'),
      eventType: 'story',
      priority: 96,
      trigger: { type: 'composite', condition: { inScene: [start.id], excludeCompletedEvents: [eventId], probability: 1.0 } },
      choices: [
        {
          id: 'hear_domestic_report',
          text: '听取内政与资源汇报',
          requirements: null,
          outcomes: [{ probability: 1.0, text: `你掌握了${faction.name}的资源瓶颈，但这些数据仍需现场和下属反馈校正。`, effects: [
            { type: 'set_variable', name: `intel_strategy_${factionId}`, value: 'domestic' },
            { type: 'add_memory', value: `玩家听取了${faction.name}的内政与资源汇报。` },
          ] }],
        },
        {
          id: 'issue_limited_order',
          text: '向幕僚下达一项有限命令',
          requirements: null,
          outcomes: [{ probability: 1.0, text: '命令被记录并交由具体人物执行，结果会受距离、忠诚、误报和地方阻力影响。', effects: [
            { type: 'set_variable', name: `order_strategy_${factionId}`, value: true },
            { type: 'add_memory', value: `玩家向${faction.name}幕僚下达了有限战略命令。` },
          ] }],
        },
        {
          id: 'ask_diplomatic_risk',
          text: '询问外交风险与情报盲区',
          requirements: null,
          outcomes: [{ probability: 1.0, text: '你得到一份带有不确定性的外交判断，其中一部分可能是误报或刻意隐瞒。', effects: [
            { type: 'set_variable', name: `intel_strategy_${factionId}`, value: 'diplomacy' },
            { type: 'add_memory', value: `玩家追问了${faction.name}的外交风险和情报盲区。` },
          ] }],
        },
      ],
      repeatable: false,
      maxOccurrences: 1,
      tags: ['strategy', 'briefing', `faction:${factionId}`, 'api_strategic_layer'],
      aiPromptHint: '以汇报、询问、命令执行和信息误差来呈现战略设定，不要打开策略游戏式全局操作。',
    };
    const existing = findById(preset.events || [], eventId);
    if (existing) {
      Object.assign(existing, eventData);
    } else {
      preset.events.push(eventData);
      created.events.push(eventId);
    }
  }
  dirty = true;
  return created;
}

function normalizeStrategicReview(plan, currentLayer, selectedFactions) {
  const issues = (plan.issues || []).slice(0, 80).map((issue, i) => ({
    id: normalizeAIId(issue.id || `issue_${i + 1}`, `issue_${i + 1}`),
    severity: ['critical', 'warning', 'suggestion'].includes(issue.severity) ? issue.severity : 'warning',
    factionId: normalizeAIId(issue.factionId || '', ''),
    path: issue.path || '',
    problem: issue.problem || issue.summary || '',
    recommendation: issue.recommendation || issue.fix || '',
    confidence: ['high', 'medium', 'low'].includes(issue.confidence) ? issue.confidence : 'medium',
  }));
  const selectedIds = new Set(selectedFactions.map(f => f.id));
  const correctedInput = {
    designPrinciples: plan.correctedLayer?.designPrinciples || currentLayer.designPrinciples,
    accessRules: plan.correctedLayer?.accessRules || currentLayer.accessRules,
    formulas: plan.correctedLayer?.formulas || currentLayer.formulas,
    factions: (plan.correctedFactions || plan.correctedLayer?.factions || [])
      .filter(f => selectedIds.has(normalizeAIId(f.factionId || f.id || f.name, ''))),
  };
  const correctedLayer = correctedInput.factions.length
    ? normalizeStrategicLayer(correctedInput, selectedFactions, currentLayer.mode || 'novel_adaptation')
    : null;
  if (correctedLayer) {
    correctedLayer.reviewedAt = new Date().toISOString();
    correctedLayer.reviewSummary = plan.summary || '';
  }
  return {
    summary: plan.summary || '',
    issues,
    correctedLayer,
    reviewerNotes: plan.reviewerNotes || '',
  };
}

async function reviewStrategicLayerWithApi({ apiKey, baseUrl, model, sourcePath, maxSourceSections = 6, factionIds }) {
  const currentLayer = preset.strategicLayer;
  if (!currentLayer?.factions || Object.keys(currentLayer.factions).length === 0) {
    throw new Error('当前预设没有 strategicLayer，请先调用 preset_generate_strategic_layer_api');
  }
  const selectedFactions = (preset.factions || [])
    .filter(f => currentLayer.factions[f.id])
    .filter(f => !factionIds?.length || factionIds.includes(f.id))
    .map(f => ({ id: f.id, name: f.name, description: f.description, tags: f.tags || [] }));
  if (selectedFactions.length === 0) throw new Error('没有可审稿的战略势力');
  const allFactions = (preset.factions || []).map(f => ({ id: f.id, name: f.name, description: f.description, tags: f.tags || [] }));
  const selectedIds = new Set(selectedFactions.map(f => f.id));
  const layerSlice = {
    ...currentLayer,
    factions: Object.fromEntries(Object.entries(currentLayer.factions).filter(([id]) => selectedIds.has(id))),
  };
  const sourceSections = (currentLayer.mode || 'novel_adaptation') === 'novel_adaptation'
    ? sampleStrategicSourceSections({ sourcePath: sourcePath || preset.sourceMaterial?.path, maxSections: maxSourceSections })
    : [];
  const relatedSceneSamples = (preset.scenes || [])
    .filter(s => (s.tags || []).some(t => selectedIds.has(String(t).slice('faction:'.length))))
    .slice(0, 20)
    .map(s => ({ id: s.id, name: s.name, type: s.type, description: truncateText(s.description || '', 160), tags: s.tags || [] }));
  const messages = [
    {
      role: 'system',
      content: [
        '你是 TRPG 小说改编与世界设定审稿人，负责检查并校正已有 strategicLayer。',
        '必须只输出严格合法 JSON 对象，不要 Markdown。',
        '审稿重点：误造或过度确定的地名、人口/产能数量级不合理、把推断写成显式事实、外交/内政缺口、玩家职务权限过大、策略游戏化操作风险。',
        '校正原则：不确定内容降级为 inferred/created 并写明 evidence；明显误造但可作为 TRPG 补全的内容保留为 created；过于具体且无依据的数字改为保守估算；不要删除所有可玩设定。',
        '输出 correctedFactions 时必须保留同一个 factionId，并给出可直接写回的完整 faction strategic data。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: '审稿并校正 TRPG strategicLayer',
        outputSchema: {
          summary: 'string',
          issues: [{
            id: 'ascii_id',
            severity: 'critical|warning|suggestion',
            factionId: 'existing faction id',
            path: 'JSON path such as factions.brune.holdings[0].name',
            problem: 'string',
            recommendation: 'string',
            confidence: 'high|medium|low',
          }],
          correctedFactions: [{
            factionId: 'existing faction id',
            strategicSummary: 'string',
            holdings: [{
              id: 'ascii_id',
              name: 'string',
              type: 'capital|city|town|village|fortress|mine|port|pasture|monastery|market',
              population: 12345,
              resources: ['string'],
              specialties: ['string'],
              productionEfficiency: 80,
              security: 60,
              narrativeRole: 'string',
              confidence: 'explicit|inferred|created',
              evidence: 'string',
            }],
            resources: [{ id: 'ascii_id', name: 'string', category: 'food|ore|craft|trade|military|magic|other', abundance: 'scarce|limited|stable|abundant|dominant', strategicUse: 'string', confidence: 'explicit|inferred|created' }],
            economy: { totalPopulation: 100000, laborPool: 42000, foodBalance: 'string', treasuryPressure: 'string', mobilizationCapacity: 'string', productionFormula: 'string' },
            internalPolitics: 'string',
            diplomacy: [{ targetFactionId: 'existing faction id', stance: 'ally|rival|war|vassal|trade|secret_contact|uncertain', publicReason: 'string', hiddenTension: 'string', confidence: 'explicit|inferred|created' }],
            intelligenceProfile: { publicKnowledge: 'string', restrictedKnowledge: 'string', misinformation: 'string', uncertainty: 'string' },
            playableRoles: [{ roleId: 'ascii_id', title: 'string', authorityScope: 'string', visibleIntel: 'string', commandLimits: 'string', reportCadence: 'string' }],
          }],
          reviewerNotes: 'string',
        },
          constraints: {
            language: 'zh-CN',
            keepTrpgForm: true,
            noStrategyGameUI: true,
            preservePlayableHooks: true,
            selectedFactionIds: selectedFactions.map(f => f.id),
            diplomacyTargetMustUseExistingFactionId: allFactions.map(f => f.id),
          },
          world: { name: preset.lore?.worldName || preset.name, background: preset.lore?.background || preset.description },
          allFactions,
          selectedFactions,
        strategicLayer: layerSlice,
        relatedSceneSamples,
        sourceSections,
      }),
    },
  ];
  const content = await callOpenAICompatible({
    apiKey, baseUrl, model,
    messages,
    temperature: 0.2,
    maxTokens: 7000,
  });
  let plan;
  try {
    plan = parseAIJson(content);
  } catch (firstError) {
    const repaired = await callOpenAICompatible({
      apiKey, baseUrl, model,
      messages: [
        ...messages,
        { role: 'assistant', content: content.slice(0, 24000) },
        {
          role: 'user',
          content: [
            '上一条审稿回复不是严格合法 JSON，解析错误如下：',
            firstError.message,
            '请只做 JSON 格式修复，保留 issues 和 correctedFactions 的既有内容。',
            '只输出一个可被 JSON.parse 解析的 JSON 对象，不要 Markdown。',
          ].join('\n'),
        },
      ],
      temperature: 0.05,
      maxTokens: 7000,
    });
    plan = parseAIJson(repaired);
  }
  return normalizeStrategicReview(plan, currentLayer, selectedFactions);
}

function applyStrategicReview({ review, createBriefingEvents = true }) {
  if (!review.correctedLayer) return { events: [] };
  const created = applyStrategicLayer({ layer: review.correctedLayer, createBriefingEvents });
  preset.strategicLayer ||= {};
  preset.strategicLayer.lastReview = {
    apiEnhanced: true,
    summary: review.summary,
    issueCounts: {
      critical: review.issues.filter(i => i.severity === 'critical').length,
      warning: review.issues.filter(i => i.severity === 'warning').length,
      suggestion: review.issues.filter(i => i.severity === 'suggestion').length,
    },
    issues: review.issues,
    reviewerNotes: review.reviewerNotes,
    reviewedAt: new Date().toISOString(),
  };
  dirty = true;
  return created;
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

  // 反复跑直到没人能再跑。大型剧本可能有数百个 main 事件，轮数随候选量扩展。
  for (let round = 0; round < candidates.length + 10; round++) {
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
      factions: preset.factions?.length || 0,
      strategicFactions: preset.strategicLayer?.factions ? Object.keys(preset.strategicLayer.factions).length : 0,
    },
    // 各实体真实 id 列表（便于 MCP 客户端引用时用对 id，避免猜错）
    sceneIds: preset.scenes.map(s => s.id),
    eventIds: preset.events.map(e => e.id),
    characterIds: preset.characters.map(ch => ch.id),
    enemyIds: preset.enemies.map(e => e.id),
    itemIds: preset.items.map(i => i.id),
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
    // Phase 28 — 生态位（biome × creatureType × tier），驱动掉落表 + 图像匹配
    ecology: z.object({
      biome: z.string().optional(),
      creatureType: z.string().optional(),
      tier: z.enum(['trivial', 'common', 'elite', 'boss']).optional(),
    }).optional().describe('生态位：填了 biome 后可用 enemy_assign_ecology 自动烘焙掉落表 + 图像'),
    lootMode: z.enum(['static', 'dynamic']).optional().describe('dynamic=运行时按生态位实时抽掉落；static(默认)=用 lootTable'),
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
      ...(args.ecology ? { ecology: args.ecology } : {}),
      ...(args.lootMode ? { lootMode: args.lootMode } : {}),
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

// ============================================================
// Phase 28 — 生态位 → 掉落表 → 图像 显式结构化
// ============================================================

/** 从 assetLibrary 构建 itemId → asset 的查找表（懒加载缓存） */
let _assetItemIndex = null;
let _assetEnemyIndex = null;
async function loadAssetIndexes() {
  if (_assetItemIndex) return;
  const { PIXEL_ASSET_LIBRARY } = await import('../src/data/assetLibrary.js');
  _assetItemIndex = new Map((PIXEL_ASSET_LIBRARY.items || []).map(a => [a.id, a]));
  _assetEnemyIndex = (PIXEL_ASSET_LIBRARY.enemies || []);
}

/** 把 id 转人类可读名（item_loot_swamp_leech_fang → 沼泽利齿之牙? 不翻译，仅美化英文）*/
function prettifyItemName(id) {
  return id.replace(/^item_(loot_)?/, '').replaceAll('_', ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** 确保一批 loot itemId 都存在于 preset.items；缺失的从 assetLibrary 物料化 */
async function ensureLootItems(itemIds) {
  await loadAssetIndexes();
  const added = [];
  for (const itemId of itemIds) {
    if (findById(preset.items, itemId)) continue;
    const asset = _assetItemIndex.get(itemId);
    preset.items.push({
      id: itemId, type: 'item',
      name: prettifyItemName(itemId),
      description: '',
      itemType: asset?.itemType || 'material',
      equipSlot: null, statModifiers: {}, consumeEffect: null,
      buyPrice: 0, sellPrice: 0, stackable: true,
      image: asset?.src || '',
      tags: asset?.tags || [],
    });
    added.push(itemId);
  }
  return added;
}

tools.ecology_vocab = {
  title: '查看生态位词表（biome / creatureType / tier）',
  description: '列出所有可用的 biome、creatureType、tier，以及哪些 biome 有掉落池。生成敌人前先查这个以保证用词一致。',
  schema: {},
  handler: async () => {
    const { BIOMES, CREATURE_TYPES, TIERS, LOOT_POOLS } = await import('../src/data/ecology.js');
    const biomesWithLoot = Object.keys(LOOT_POOLS);
    const lines = [
      '╔══ 生态位词表 ══╗', '',
      `🌍 biome (${BIOMES.length}): ${BIOMES.join(', ')}`,
      `   └ 有掉落池的: ${biomesWithLoot.join(', ')}`,
      `🐾 creatureType (${CREATURE_TYPES.length}): ${CREATURE_TYPES.join(', ')}`,
      `📊 tier: ${TIERS.join(' < ')}（= easy/normal/hard/boss）`,
      '',
      '用法：enemy_create 时填 ecology:{biome,creatureType,tier}，再 enemy_assign_ecology 自动烘焙掉落表+配图',
    ];
    return ok(lines.join('\n'));
  },
};

tools.loot_pool_preview = {
  title: '预览某生态位的掉落表',
  description: '给定 biome/creatureType/tier，返回 resolveLootTable 的烘焙结果（itemId + dropRate），并标注哪些战利品已在 preset.items / assetLibrary 中可物料化。不修改预设。',
  schema: {
    biome: z.string(),
    creatureType: z.string().optional(),
    tier: z.enum(['trivial', 'common', 'elite', 'boss']).default('common'),
    luck: z.number().default(0),
  },
  handler: async (args) => {
    const { resolveLootTable } = await import('../src/data/ecology.js');
    await loadAssetIndexes();
    const table = resolveLootTable(args);
    if (table.length === 0) return ok(`生态位 ${args.biome}/${args.creatureType || '*'}/${args.tier} 没有可掉落项`);
    const lines = [`掉落表预览 — ${args.biome} / ${args.creatureType || '任意'} / ${args.tier}（luck=${args.luck}）`, ''];
    for (const e of table) {
      const inPreset = !!findById(preset.items, e.itemId);
      const inAsset = _assetItemIndex.has(e.itemId);
      const flag = inPreset ? '✓preset' : inAsset ? '○可物料化' : '✗缺图';
      lines.push(`  ${(e.dropRate * 100).toFixed(0).padStart(3)}%  ${e.itemId}  [${flag}]`);
    }
    return ok(lines.join('\n'));
  },
};

tools.enemy_assign_ecology = {
  title: '给敌人指定生态位 → 自动烘焙掉落表 + 配图',
  description: `把 ecology(biome/creatureType/tier) 写到敌人上，并据此：
  1. 烘焙 lootTable（mode=static，默认）或标记 lootMode=dynamic（运行时实时抽取）
  2. 把掉落表引用的战利品从 assetLibrary 物料化进 preset.items（含图）
  3. 给敌人本身配一张匹配 biome/creatureType 的图（若 assetLibrary 有）
这样大型剧本生成时，敌人的地区主题、掉落、图像三者自动一致。`,
  schema: {
    enemyId: z.string(),
    biome: z.string(),
    creatureType: z.string().optional(),
    tier: z.enum(['trivial', 'common', 'elite', 'boss']).optional().describe('省略则按敌人 difficulty 推断'),
    mode: z.enum(['static', 'dynamic']).default('static'),
    luck: z.number().default(0),
  },
  handler: async (args) => {
    const enemy = findById(preset.enemies, args.enemyId);
    if (!enemy) {
      // 错误信息列出可用 id，方便 MCP 客户端（含本地模型）自我纠正，而不是反复猜错 id
      const ids = preset.enemies.map(e => e.id);
      return err(`敌人不存在: ${args.enemyId}。当前可用敌人 id: ${ids.length ? ids.join(', ') : '（无，请先 enemy_create）'}`);
    }
    const ecoMod = await import('../src/data/ecology.js');
    const { resolveLootTable, difficultyToTier, validateEcology, ecologyTags } = ecoMod;

    const tier = args.tier || difficultyToTier(enemy.difficulty);
    const ecology = { biome: args.biome, creatureType: args.creatureType, tier };
    const v = validateEcology(ecology);
    if (!v.ok) return err(`生态位非法：${v.errors.join('；')}`);

    enemy.ecology = ecology;

    let lootMsg;
    if (args.mode === 'dynamic') {
      enemy.lootMode = 'dynamic';
      enemy.lootTable = [];   // 运行时抽，不存静态表
      lootMsg = '运行时动态抽取（lootMode=dynamic）';
    } else {
      enemy.lootMode = 'static';
      const table = resolveLootTable({ ...ecology, luck: args.luck });
      enemy.lootTable = table;
      const added = await ensureLootItems(table.map(e => e.itemId));
      lootMsg = `静态烘焙 ${table.length} 项掉落${added.length ? `（新增 ${added.length} 个物品到 preset.items）` : ''}`;
    }

    // 给敌人配图（按 ecology 标签在 assetLibrary.enemies 里找最匹配的）
    await loadAssetIndexes();
    let imgMsg = '';
    if (!enemy.image) {
      const wantTags = new Set([...ecologyTags(ecology), ...(enemy.tags || [])].map(t => String(t).toLowerCase()));
      let best = null, bestScore = 0;
      for (const a of _assetEnemyIndex) {
        const score = (a.tags || []).filter(t => wantTags.has(String(t).toLowerCase())).length
          + (a.biome === args.biome ? 2 : 0);
        if (score > bestScore) { bestScore = score; best = a; }
      }
      if (best && bestScore > 0) { enemy.image = best.src; imgMsg = `；配图 ${best.id}`; }
    }

    dirty = true;
    return ok(`已为 ${enemy.name} 设定生态位 ${args.biome}/${args.creatureType || '任意'}/${tier} → ${lootMsg}${imgMsg}`);
  },
};

tools.preset_import_json = {
  title: '导入一次性生成的剧本 JSON → 自动补全 + 物料化 + 配图',
  description: `把"一次性 AI 生成"的剧本 JSON 导入为当前预设，并跑补全流水线：
  1. 补 startingSceneId（缺则取首个场景）、自动布局缺失坐标
  2. 给消耗品补 heal、给装备补 statModifiers（按名称推断）、规范 itemType/type
  3. 给敌人据 tags 推断 ecology 并烘焙静态掉落表，把掉落物从 assetLibrary 物料化进 items
  4. 可选 assignImages：给角色/敌人/物品/场景配图
  5. 报告"需作者决策"项：设了不用的变量 / 孤儿敌人 / 缺结局
适合把本地模型生成的"骨架"一步变成"可玩"。json 与 path 二选一。`,
  schema: {
    json: z.string().optional().describe('剧本 JSON 文本（一次性生成的输出）'),
    path: z.string().optional().describe('剧本 JSON 文件路径（与 json 二选一）'),
    assignImages: z.boolean().default(true).describe('是否按 assetLibrary 自动配图'),
    addEndingScaffold: z.boolean().default(false).describe('无结局时是否自动补一个结局事件脚手架'),
    save: z.boolean().default(false).describe('是否落盘到当前预设文件'),
  },
  handler: async (args) => {
    // 1) 解析输入
    let raw;
    try {
      if (args.json) raw = JSON.parse(args.json);
      else if (args.path) raw = JSON.parse(fs.readFileSync(args.path, 'utf-8'));
      else return err('请提供 json（文本）或 path（文件路径）之一');
    } catch (e) {
      return err(`JSON 解析失败：${e.message}`);
    }

    // 2) 补全
    const { normalizePreset, formatNormalizeReport } = await import('../src/data/presetNormalize.js');
    const { preset: normalized, report, lootItemsNeeded } = normalizePreset(raw, {
      addEndingScaffold: args.addEndingScaffold,
    });

    // 3) 设为当前预设（补齐服务端要求的默认结构）
    preset = { ...createEmptyPreset(), ...normalized };

    // 4) 物料化掉落物（操作全局 preset.items）
    let materialized = [];
    if (lootItemsNeeded.length) materialized = await ensureLootItems(lootItemsNeeded);

    // 5) 配图（可选）
    let imgNote = '';
    if (args.assignImages) {
      const { assignPresetImages } = await import('../src/data/assetLibrary.js');
      preset = assignPresetImages(preset);
      imgNote = '\n✓ 已按 assetLibrary 配图（characters/enemies/items/scenes）';
    }

    dirty = true;
    if (args.save) saveToDisk();

    // 6) 报告 + 校验
    const reportText = formatNormalizeReport(report, lootItemsNeeded);
    const matNote = materialized.length ? `\n✓ 物料化 ${materialized.length} 个掉落物到 items` : '';
    const vErrs = validatePreset();
    const vNote = vErrs.length === 0 ? '\n✓ 引用完整性校验通过' : `\n⚠ 校验问题(${vErrs.length})：\n${vErrs.map(e => '  - ' + e).join('\n')}`;
    const counts = `\n规模：${preset.scenes.length} 场景 / ${preset.events.length} 事件 / ${preset.enemies.length} 敌人 / ${preset.items.length} 物品`;
    return ok(`✓ 已导入并补全：${preset.name || '(未命名)'}${counts}\n\n${reportText}${matNote}${imgNote}${vNote}${args.save ? '\n💾 已落盘' : '\n（未落盘，dirty）'}`);
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

// ---------- 小说/设定集导入：超大剧本模式 ----------

tools.novel_source_inspect = {
  title: '读取并检查一整部小说/设定集素材',
  description: '从本地 txt/md 文件读取长文本，只统计体量、章节/片段数量和正文过滤结果。不会本地猜测角色、势力或剧情，也不会把原文写入预设。',
  schema: {
    sourcePath: z.string().describe('本地小说或设定集路径，如 /Users/.../novel.txt'),
    maxSections: z.number().min(1).max(300).default(120).describe('最多切分/检查多少个章节或片段'),
    includeNonStory: z.boolean().default(false).describe('true=保留后记/插图/特典等非正文；默认过滤'),
  },
  handler: async (args) => {
    try {
      const { abs, stat, text } = readNovelSource(args.sourcePath);
      const rawSections = splitNovelSections(text, args.maxSections);
      const sections = filterStorySections(rawSections, args.includeNonStory);
      return ok(JSON.stringify({
        sourcePath: abs,
        bytes: stat.size,
        chars: text.length,
        lines: text.split('\n').length,
        sections: sections.length,
        rawSections: rawSections.length,
        excludedNonStorySections: rawSections.length - sections.length,
        firstSections: sections.slice(0, 12).map(s => ({ title: s.title, chars: s.text.length })),
        note: '这里只做读取/切章/正文过滤，不再本地猜测人物或势力。下一步用 novel_digest 概括汇总成 NovelDigest（接入 API）。',
      }, null, 2));
    } catch (e) {
      return err(e.message);
    }
  },
};

// 小说→剧本 段①：概括汇总 → NovelDigest（替代已废弃的 novel_build_mega_preset 自由发挥式 mega-emit）
tools.novel_digest = {
  title: '小说→剧本 段①：概括汇总为 NovelDigest',
  description: `读取本地长文本 → 分块 + LLM 抽取 + 合并去重 → 结构化 NovelDigest（世界/势力/角色/地点/剧情节拍）。
这是新生成管线的第一段：只做"理解"层的概括汇总，**不生成任何剧本结构**（场景图/选项/掉落/结局留给后续
blueprint(段②设计规模/边界/拓展) 与 build(段③确定性生成) 阶段）。仅用 OpenAI-compatible API 做摘要抽取。
产物落盘为 JSON，供人工审阅/编辑后进入段②。`,
  schema: {
    sourcePath: z.string(),
    title: z.string().optional().describe('作品/世界名；省略则用文件名或抽取到的世界名'),
    maxSections: z.number().min(3).max(500).optional().describe('参与摘要的章节/片段数；省略=全部正文片段'),
    inspectSections: z.number().min(3).max(800).default(500).describe('读取切分时最多检查多少片段'),
    factionLimit: z.number().min(3).max(12).default(8),
    npcLimit: z.number().min(6).max(120).default(60),
    includeNonStory: z.boolean().default(false).describe('true=保留后记/插图等非正文'),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional().describe(`默认 ${DEFAULT_OPENAI_BASE_URL}`),
    model: z.string().optional().describe(`默认 ${DEFAULT_OPENAI_MODEL}`),
    maxApiSections: z.number().min(1).max(20).default(6).describe('每批调用 API 分析多少片段；循环覆盖全部'),
    outPath: z.string().optional().describe('digest 落盘路径；省略=<source>.digest.json'),
  },
  handler: async (args) => {
    try {
      const { abs, text } = readNovelSource(args.sourcePath);
      const rawSections = splitNovelSections(text, args.inspectSections);
      const sections = filterStorySections(rawSections, args.includeNonStory);
      if (sections.length < 3) return err('素材切分后少于 3 个片段，不适合概括');
      const useSections = sections.slice(0, args.maxSections || sections.length);
      const analysis = await analyzeNovelWithApi({
        sections: useSections,
        apiKey: args.apiKey, baseUrl: args.baseUrl, model: args.model,
        maxApiSections: Math.min(args.maxApiSections || useSections.length, useSections.length),
        npcLimit: args.npcLimit, factionLimit: args.factionLimit,
        beatsPerSection: 3, canonicalizeEntities: true,
      });
      const digest = buildDigestFromAnalysis(analysis, { title: args.title, sourcePath: abs });
      const errs = validateNovelDigest(digest);
      const outPath = args.outPath || abs.replace(/\.[^.]+$/, '') + '.digest.json';
      fs.writeFileSync(outPath, JSON.stringify(digest, null, 2), 'utf-8');
      return ok(JSON.stringify({
        message: '已生成 NovelDigest（概括汇总）',
        outPath,
        counts: {
          factions: digest.world.factions.length,
          characters: digest.characters.length,
          locations: digest.locations.length,
          plotBeats: digest.plotBeats.length,
        },
        validation: errs.length ? errs : 'ok',
        next: '审阅/编辑 digest 后 → 段② blueprint_draft（设计规模/边界/拓展点）',
      }, null, 2));
    } catch (e) {
      return err(`生成 digest 失败：${e.message}`);
    }
  },
};

// 小说→剧本 段②：从 Digest 起草设计蓝图（规模/边界/游戏性拓展），产物需人工确认后才进段③
tools.blueprint_draft = {
  title: '小说→剧本 段②：从 Digest 起草剧本蓝图',
  description: `读取 NovelDigest → LLM 设计 PresetBlueprint：① 确定规模（按 sizeClass）② 明确边界（取哪段/起止 beat）
③ 标出基于游戏性的拓展点（战斗遭遇 / 选择分支 / 可探索枢纽支线 / 多结局）。
此段是"设计"不是"生成结构"。产物落盘，⚠ 请人工审阅/编辑后再进段③ preset_build_from_blueprint。仅用 OpenAI-compatible API。`,
  schema: {
    digestPath: z.string().describe('段① 产出的 NovelDigest JSON 路径'),
    sizeClass: z.enum(['small', 'medium', 'large']).default('medium').describe('目标规模：small 15-25 / medium 40-60 / large 80-120 场景'),
    arc: z.string().optional().describe('只取小说哪一段/卷（自由文本提示）'),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional().describe(`默认 ${DEFAULT_OPENAI_BASE_URL}`),
    model: z.string().optional().describe(`默认 ${DEFAULT_OPENAI_MODEL}`),
    outPath: z.string().optional().describe('蓝图落盘路径；省略=<digest>.blueprint.json'),
  },
  handler: async (args) => {
    try {
      const digest = JSON.parse(fs.readFileSync(args.digestPath, 'utf-8'));
      const dErrs = validateNovelDigest(digest);
      if (dErrs.length) return err(`digest 不合法：${dErrs.join('；')}`);
      const content = await callOpenAICompatible({
        baseUrl: args.baseUrl, apiKey: args.apiKey, model: args.model,
        messages: buildBlueprintPrompt(digest, args), temperature: 0.4, maxTokens: 6000,
      });
      let raw;
      try { raw = parseAIJson(content); } catch (e) { return err(`蓝图 JSON 解析失败：${e.message}`); }
      const bp = normalizeBlueprint(raw, digest, args);
      const errs = validateBlueprint(bp, digest);
      const outPath = args.outPath || args.digestPath.replace(/\.digest\.json$|\.json$/, '') + '.blueprint.json';
      fs.writeFileSync(outPath, JSON.stringify(bp, null, 2), 'utf-8');
      return ok(JSON.stringify({
        message: '已起草 PresetBlueprint（⚠ 请人工审阅/编辑后再进段③）',
        outPath, scale: bp.scale, chapters: bp.chapters.length, endings: bp.endings.length,
        validation: errs.length ? errs : 'ok',
        next: '审阅/编辑 blueprint 后 → 段③ preset_build_from_blueprint',
      }, null, 2));
    } catch (e) {
      return err(`起草蓝图失败：${e.message}`);
    }
  },
};

tools.blueprint_validate = {
  title: '校验 PresetBlueprint（结构/边界/引用）',
  description: '结构校验：规模存在、章节/结局非空；传 digestPath 时额外校验 scope 与章节引用的 beat、角色映射都在 digest 内。',
  schema: {
    blueprintPath: z.string(),
    digestPath: z.string().optional().describe('传则交叉校验 beat/角色引用'),
  },
  handler: async (args) => {
    try {
      const bp = JSON.parse(fs.readFileSync(args.blueprintPath, 'utf-8'));
      const digest = args.digestPath ? JSON.parse(fs.readFileSync(args.digestPath, 'utf-8')) : null;
      const errs = validateBlueprint(bp, digest);
      return ok(JSON.stringify({
        ok: errs.length === 0, errors: errs,
        scale: bp.scale, chapters: bp.chapters?.length || 0, endings: bp.endings?.length || 0,
      }, null, 2));
    } catch (e) {
      return err(`校验失败：${e.message}`);
    }
  },
};

// 小说→剧本 段③：确定性生成（消费 Blueprint+Digest，串成熟工具链；不接触小说原文、不调 LLM）
tools.preset_build_from_blueprint = {
  title: '小说→剧本 段③：从 Blueprint 确定性生成完整剧本',
  description: `读取（人工确认过的）PresetBlueprint + NovelDigest → **确定性**生成完整可玩剧本：
逐章建线性场景图(主轴)+支线分叉、主事件(分支→选项)、战斗(敌人+ecology 掉落)、终章多结局。
随后串成熟工具链：presetNormalize 补全 → 物料化掉落物 → assignImages 配图 → 引用完整性校验。
**全程不调 LLM、不读小说原文**，把"LLM 自由发挥"的风险隔离在前两段。生成结果设为当前预设，可继续用 preset_analyze / combat_simulate 体检。`,
  schema: {
    blueprintPath: z.string(),
    digestPath: z.string(),
    assignImages: z.boolean().default(true),
    save: z.boolean().default(false),
    confirm: z.boolean().default(false).describe('当前预设非空时必须 true 才覆盖'),
  },
  handler: async (args) => {
    try {
      if ((preset.scenes.length > 0 || preset.events.length > 0) && !args.confirm) {
        return err(`当前预设非空（${preset.scenes.length} 场景 / ${preset.events.length} 事件）。请传 confirm=true 才覆盖。`);
      }
      const blueprint = JSON.parse(fs.readFileSync(args.blueprintPath, 'utf-8'));
      const digest = JSON.parse(fs.readFileSync(args.digestPath, 'utf-8'));
      const bErrs = validateBlueprint(blueprint, digest);
      if (bErrs.length) return err(`blueprint 不合法：${bErrs.join('；')}`);

      // 1) 确定性生成
      preset = await buildPresetFromBlueprint(blueprint, digest);

      // 2) presetNormalize 补全（startingSceneId/坐标/物品 effect/报告悬空变量等）
      const { normalizePreset } = await import('../src/data/presetNormalize.js');
      const norm = normalizePreset(preset, {});
      preset = { ...createEmptyPreset(), ...norm.preset };

      // 3) 物料化敌人掉落物到 preset.items（含图）
      const lootIds = [...new Set(preset.enemies.flatMap(e => (e.lootTable || []).map(l => l.itemId)))];
      const materialized = lootIds.length ? await ensureLootItems(lootIds) : [];

      // 4) 配图
      let imgNote = '';
      if (args.assignImages) {
        const { assignPresetImages } = await import('../src/data/assetLibrary.js');
        preset = assignPresetImages(preset);
        imgNote = '\n✓ 已按 assetLibrary 配图';
      }

      dirty = true;
      if (args.save) saveToDisk();

      // 5) 引用完整性校验
      const vErrs = validatePreset();
      return ok(JSON.stringify({
        message: '已从 Blueprint 确定性生成剧本' + (imgNote ? '（已配图）' : ''),
        name: preset.name,
        counts: { scenes: preset.scenes.length, events: preset.events.length, enemies: preset.enemies.length, items: preset.items.length, characters: preset.characters.length },
        materializedLoot: materialized.length,
        imagesAssigned: !!imgNote,
        normalizeReport: { startingSceneId: norm.report.startingSceneId, itemsFilled: norm.report.itemsFilled.length, enemyLoot: norm.report.enemyLoot.length, variablesSetButUnused: norm.report.variablesSetButUnused },
        validation: vErrs.length ? vErrs : 'ok',
        next: '可用 preset_analyze 体检、combat_simulate 验证数值平衡' + (args.save ? '；已落盘' : '；未落盘(dirty)'),
      }, null, 2));
    } catch (e) {
      return err(`从 Blueprint 生成失败：${e.message}`);
    }
  },
};


tools.preset_canonicalize_entities_api = {
  title: '通过 API 归一化当前预设实体',
  description: '调用 OpenAI-compatible API 合并当前预设中跨批生成造成的势力 id/name 漂移，并按 API 返回的 alias 映射修正 factions、起源、NPC 阵营标签、声望变量和起点规则。',
  schema: {
    apiKey: z.string().optional().describe('可选；不传则读取 OPENAI_API_KEY 环境变量；本地 127.0.0.1/localhost 端点可留空'),
    baseUrl: z.string().optional().describe(`默认 ${DEFAULT_OPENAI_BASE_URL}`),
    model: z.string().optional().describe(`默认 ${DEFAULT_OPENAI_MODEL}`),
    factionLimit: z.number().min(3).max(12).default(8).describe('归一化后最多保留多少个可玩势力'),
    dryRun: z.boolean().default(false).describe('true=只返回 API 归一化计划，不修改当前预设'),
  },
  handler: async (args) => {
    try {
      if (!preset.factions?.length) return err('当前预设没有 factions，无法归一化');
      const analysis = {
        factions: preset.factions.map(f => ({
          id: f.id,
          name: f.name,
          description: f.description,
          tags: f.tags || [],
        })),
        characters: (preset.npcs || []).map(n => {
          const factionTag = (n.tags || []).find(t => String(t).startsWith('faction:'));
          return {
            id: n.id,
            name: n.name,
            title: n.title,
            factionId: factionTag ? String(factionTag).slice('faction:'.length) : '',
          };
        }),
        sections: [],
        raw: {},
      };
      const canonical = await canonicalizeAnalysisWithApi({
        analysis,
        apiKey: args.apiKey,
        baseUrl: args.baseUrl,
        model: args.model,
        factionLimit: args.factionLimit,
      });
      const aliases = canonical.raw?.canonicalization?.aliases || [];
      if (args.dryRun) {
        return ok(JSON.stringify({
          canonicalFactions: canonical.factions,
          aliases,
          note: 'dryRun=true，当前预设未修改。',
        }, null, 2));
      }
      const applied = applyFactionCanonicalizationToPreset({ canonicalFactions: canonical.factions, aliases });
      preset.sourceMaterial ||= {};
      preset.sourceMaterial.canonicalizedEntities = true;
      preset.sourceMaterial.canonicalization = {
        apiEnhanced: true,
        canonicalFactionCount: applied.canonicalFactionCount,
        aliasCount: applied.aliasCount,
        aliases,
        generatedAt: new Date().toISOString(),
      };
      dirty = true;
      saveToDisk();
      const refErrs = validatePreset();
      return ok(JSON.stringify({
        message: '已通过 API 归一化当前预设实体',
        filePath,
        canonicalFactionCount: applied.canonicalFactionCount,
        aliasCount: applied.aliasCount,
        validation: { valid: refErrs.length === 0, errors: refErrs },
      }, null, 2));
    } catch (e) {
      return err(e.message);
    }
  },
};

tools.preset_expand_routes_api = {
  title: '通过 API 扩写不同起点的专属路线',
  description: '调用 OpenAI-compatible API 为当前预设的每个势力起点创作专属支线场景、事件、NPC 和可选结局尾声，用于修复所有起点过早汇入同一主线的问题。',
  schema: {
    apiKey: z.string().optional().describe('可选；不传则读取 OPENAI_API_KEY 环境变量；本地 127.0.0.1/localhost 端点可留空'),
    baseUrl: z.string().optional().describe(`默认 ${DEFAULT_OPENAI_BASE_URL}`),
    model: z.string().optional().describe(`默认 ${DEFAULT_OPENAI_MODEL}`),
    factionIds: z.array(z.string()).optional().describe('只扩写这些势力；省略=当前 factions 全部扩写'),
    routeLength: z.number().min(1).max(4).default(2).describe('每个势力新增几个专属支线场景'),
    includeEndings: z.boolean().default(true).describe('是否为每个势力新增一个专属结局/尾声节点'),
    dryRun: z.boolean().default(false).describe('true=只返回 API 创作方案，不写入预设'),
  },
  handler: async (args) => {
    try {
      const selected = (preset.factions || [])
        .filter(f => !args.factionIds?.length || args.factionIds.includes(f.id))
        .map(f => ({ id: f.id, name: f.name, description: f.description, tags: f.tags || [] }));
      if (selected.length === 0) return err('没有可扩写的 factions');
      const routes = await generateRouteExpansionWithApi({
        apiKey: args.apiKey,
        baseUrl: args.baseUrl,
        model: args.model,
        factions: selected,
        routeLength: args.routeLength,
        includeEndings: args.includeEndings,
      });
      if (args.dryRun) return ok(JSON.stringify({ routes, note: 'dryRun=true，当前预设未修改。' }, null, 2));
      const created = applyRouteExpansion({ routes, routeLength: args.routeLength, includeEndings: args.includeEndings });
      preset.sourceMaterial ||= {};
      preset.sourceMaterial.routeExpansion = {
        apiEnhanced: true,
        factionCount: selected.length,
        routeLength: args.routeLength,
        includeEndings: args.includeEndings,
        created,
        generatedAt: new Date().toISOString(),
      };
      saveToDisk();
      const refErrs = validatePreset();
      return ok(JSON.stringify({
        message: '已通过 API 扩写不同起点的专属路线',
        filePath,
        createdCounts: Object.fromEntries(Object.entries(created).map(([k, v]) => [k, v.length])),
        created,
        validation: { valid: refErrs.length === 0, errors: refErrs },
      }, null, 2));
    } catch (e) {
      return err(e.message);
    }
  },
};

tools.preset_generate_strategic_layer_api = {
  title: '通过 API 生成势力战略设定层',
  description: `为当前预设补充每个势力的城市、村庄、矿产、特产、人口、生产效率、内政外交和情报可见性。

小说改编模式会要求 API 根据剧情进展反推缺失设定，并用 explicit/inferred 标注可信度；原创模式会更积极地补全世界设定。
生成结果写入 preset.strategicLayer，并可在各势力起点自动创建"战略汇报"事件，让玩家通过 TRPG 的汇报、询问、有限命令和现场行动参与，而不是像策略游戏一样直接操作全局。`,
  schema: {
    mode: z.enum(['novel_adaptation', 'original']).default('novel_adaptation').describe('novel_adaptation=基于小说剧情反推；original=原创剧本主动补齐'),
    apiKey: z.string().optional().describe('可选；不传则读取 OPENAI_API_KEY 环境变量；本地 127.0.0.1/localhost 端点可留空'),
    baseUrl: z.string().optional().describe(`默认 ${DEFAULT_OPENAI_BASE_URL}`),
    model: z.string().optional().describe(`默认 ${DEFAULT_OPENAI_MODEL}`),
    sourcePath: z.string().optional().describe('小说/设定集路径；省略时使用 preset.sourceMaterial.path'),
    maxSourceSections: z.number().min(0).max(20).default(8).describe('小说改编模式下提供给 API 的素材片段采样数；0=只用当前预设摘要'),
    factionIds: z.array(z.string()).optional().describe('只为这些势力生成；省略=全部 factions'),
    createBriefingEvents: z.boolean().default(true).describe('true=在各势力起点创建战略汇报事件'),
    dryRun: z.boolean().default(false).describe('true=只返回 API 方案，不修改当前预设'),
  },
  handler: async (args) => {
    try {
      if (!preset.factions?.length) return err('当前预设没有 factions，无法生成战略设定层');
      const layer = await generateStrategicLayerWithApi({
        apiKey: args.apiKey,
        baseUrl: args.baseUrl,
        model: args.model,
        mode: args.mode,
        sourcePath: args.sourcePath,
        maxSourceSections: args.maxSourceSections,
        factionIds: args.factionIds,
      });
      if (args.dryRun) return ok(JSON.stringify({ strategicLayer: layer, note: 'dryRun=true，当前预设未修改。' }, null, 2));
      const created = applyStrategicLayer({ layer, createBriefingEvents: args.createBriefingEvents });
      preset.sourceMaterial ||= {};
      preset.sourceMaterial.strategicLayer = {
        apiEnhanced: true,
        mode: args.mode,
        factionCount: Object.keys(layer.factions || {}).length,
        created,
        generatedAt: layer.generatedAt,
      };
      saveToDisk();
      const refErrs = validatePreset();
      return ok(JSON.stringify({
        message: '已通过 API 生成势力战略设定层',
        filePath,
        mode: args.mode,
        factionCount: Object.keys(layer.factions || {}).length,
        createdCounts: Object.fromEntries(Object.entries(created).map(([k, v]) => [k, v.length])),
        validation: { valid: refErrs.length === 0, errors: refErrs },
        note: '战略设定已作为 TRPG 汇报/命令素材接入，不提供策略游戏式全局操作。',
      }, null, 2));
    } catch (e) {
      return err(e.message);
    }
  },
};

tools.preset_review_strategic_layer_api = {
  title: '通过 API 审稿/校正势力战略设定层',
  description: `审查当前 preset.strategicLayer 是否符合小说改编逻辑和 TRPG 玩法边界：
  - 找出误造或过度确定的地名、人口、产能、资源和外交设定
  - 检查 confidence/evidence 是否诚实区分原文事实、合理推断和原创补全
  - 检查玩家职务是否越权、是否变成策略游戏式全局操作
  - 返回审稿问题列表，并可写回校正后的 strategicLayer 与战略汇报事件`,
  schema: {
    apiKey: z.string().optional().describe('可选；不传则读取 OPENAI_API_KEY 环境变量；本地 127.0.0.1/localhost 端点可留空'),
    baseUrl: z.string().optional().describe(`默认 ${DEFAULT_OPENAI_BASE_URL}`),
    model: z.string().optional().describe(`默认 ${DEFAULT_OPENAI_MODEL}`),
    sourcePath: z.string().optional().describe('小说/设定集路径；省略时使用 preset.sourceMaterial.path'),
    maxSourceSections: z.number().min(0).max(20).default(6).describe('提供给 API 审稿的素材片段采样数；0=只用当前预设和战略层'),
    factionIds: z.array(z.string()).optional().describe('只审稿这些势力；省略=当前 strategicLayer 内全部势力'),
    applyCorrections: z.boolean().default(false).describe('true=把 API 的 correctedFactions 写回 strategicLayer；false=只返回报告'),
    refreshBriefingEvents: z.boolean().default(true).describe('写回时同步刷新起点战略汇报事件'),
  },
  handler: async (args) => {
    try {
      const review = await reviewStrategicLayerWithApi({
        apiKey: args.apiKey,
        baseUrl: args.baseUrl,
        model: args.model,
        sourcePath: args.sourcePath,
        maxSourceSections: args.maxSourceSections,
        factionIds: args.factionIds,
      });
      if (!args.applyCorrections) {
        return ok(JSON.stringify({
          summary: review.summary,
          issues: review.issues,
          correctedLayer: review.correctedLayer,
          reviewerNotes: review.reviewerNotes,
          note: 'applyCorrections=false，当前预设未修改。',
        }, null, 2));
      }
      const created = applyStrategicReview({ review, createBriefingEvents: args.refreshBriefingEvents });
      preset.sourceMaterial ||= {};
      preset.sourceMaterial.strategicLayerReview = {
        apiEnhanced: true,
        summary: review.summary,
        issueCount: review.issues.length,
        created,
        reviewedAt: preset.strategicLayer?.lastReview?.reviewedAt || new Date().toISOString(),
      };
      saveToDisk();
      const refErrs = validatePreset();
      return ok(JSON.stringify({
        message: '已通过 API 审稿并校正势力战略设定层',
        filePath,
        summary: review.summary,
        issueCounts: preset.strategicLayer.lastReview.issueCounts,
        createdCounts: Object.fromEntries(Object.entries(created).map(([k, v]) => [k, v.length])),
        validation: { valid: refErrs.length === 0, errors: refErrs },
      }, null, 2));
    } catch (e) {
      return err(e.message);
    }
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
