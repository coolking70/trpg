/**
 * presetNormalize — 一次性 AI 生成剧本的「补全 / 规范化」流水线
 *
 * 背景：本地/远端模型一次性吐出的剧本通常"骨架+文笔"不错，但机械齿轮不咬合：
 *   缺 startingSceneId、物品无 effect、敌人无生态/掉落、变量设了不用、无结局…
 * 本模块把这些尽量自动补全，并把"需要作者决策"的问题（孤儿敌人 / 悬空变量）报告出来。
 *
 * 设计：纯函数（不碰 fs / 网络 / 图像物料化）。
 *   - 结构补全在这里：startingSceneId、坐标、物品 effect、敌人 ecology+掉落、报告。
 *   - 图像物料化（assetLibrary）交给上层 MCP 工具用现成助手做（需要 asset 索引）。
 *   - lootItemsNeeded 列出补出的掉落 itemId，供上层物料化进 preset.items。
 */

import { inferEcology, resolveLootTable, validateEcology, difficultyToTier } from './ecology.js';

const KNOWN_ITEM_TYPES = ['consumable', 'equipment', 'quest', 'key', 'material', 'weapon', 'armor'];

// 物品 effect 关键词模板（按名称/描述推断）
const HEAL_HP = [/药水|药剂|potion|heal|治疗|回复|绷带|bandage/i];
const HEAL_FOOD = [/面包|食物|干粮|ration|bread|肉|果|food|餐/i];
const HEAL_MP = [/法力|魔力|蓝|mana|mp|精神|ether/i];
const EQUIP_DEF = [/盾|甲|护|铠|armor|shield|robe|袍|护符|护身|pendant|amulet|ring|戒/i];
const EQUIP_ATK = [/剑|刀|斧|矛|弓|杖|刃|sword|blade|axe|spear|bow|staff|weapon|武器/i];

function matchAny(text, patterns) { return patterns.some(re => re.test(text)); }

/**
 * @param {object} presetInput - 原始预设对象
 * @param {object} [opts]
 * @param {boolean} [opts.addEndingScaffold=false] - 无结局时是否自动补一个结局事件脚手架
 * @param {number}  [opts.gridGap=120] - 自动布局坐标的格距
 * @returns {{preset: object, report: object, lootItemsNeeded: string[]}}
 */
export function normalizePreset(presetInput, opts = {}) {
  const preset = JSON.parse(JSON.stringify(presetInput || {}));
  preset.scenes ||= [];
  preset.events ||= [];
  preset.enemies ||= [];
  preset.items ||= [];
  preset.characters ||= [];

  const report = {
    startingSceneId: null,
    coordsFilled: 0,
    itemsFilled: [],
    enemyEcology: [],
    enemyLoot: [],
    orphanEnemies: [],
    variablesSetButUnused: [],
    variablesReadButUnset: [],
    endings: { hasEnding: false, added: false },
    notes: [],
  };
  const lootItemsNeeded = [];

  // ---------- 1) startingSceneId ----------
  const sceneIds = new Set(preset.scenes.map(s => s.id));
  if (!preset.startingSceneId || !sceneIds.has(preset.startingSceneId)) {
    const old = preset.startingSceneId;
    preset.startingSceneId = preset.scenes[0]?.id || null;
    report.startingSceneId = { from: old || '(缺失)', to: preset.startingSceneId };
  }

  // ---------- 2) 场景坐标自动布局（缺 coords 的）----------
  const need = preset.scenes.filter(s => !s.coords || typeof s.coords.x !== 'number');
  if (need.length > 0) {
    const gap = opts.gridGap || 120;
    const cols = Math.max(1, Math.ceil(Math.sqrt(preset.scenes.length)));
    preset.scenes.forEach((s, i) => {
      if (!s.coords || typeof s.coords.x !== 'number') {
        s.coords = { x: (i % cols) * gap, y: Math.floor(i / cols) * gap };
        report.coordsFilled++;
      }
    });
  }

  // ---------- 3) 物品：itemType 规范化 + effect 模板 ----------
  for (const item of preset.items) {
    // type(语义) 与 card type 混用时拆开：card type 应为 'item'，语义放 itemType
    if (!item.itemType && KNOWN_ITEM_TYPES.includes(item.type)) {
      item.itemType = item.type;
    }
    if (item.type !== 'item') item.type = 'item';
    item.itemType ||= 'material';

    const text = `${item.name || ''} ${item.description || ''} ${item.id || ''}`;

    if (item.itemType === 'consumable' && !item.consumeEffect) {
      if (matchAny(text, HEAL_MP)) {
        item.consumeEffect = { type: 'heal', stat: 'mp', value: 20 };
      } else if (matchAny(text, HEAL_FOOD)) {
        item.consumeEffect = { type: 'heal', stat: 'hp', value: 15 };
      } else if (matchAny(text, HEAL_HP)) {
        item.consumeEffect = { type: 'heal', stat: 'hp', value: 30 };
      } else {
        item.consumeEffect = { type: 'heal', stat: 'hp', value: 20 }; // 兜底：消耗品至少能回点血
      }
      report.itemsFilled.push({ id: item.id, kind: 'consumeEffect', effect: item.consumeEffect });
    }

    if ((item.itemType === 'equipment' || item.itemType === 'weapon' || item.itemType === 'armor')
        && (!item.statModifiers || Object.keys(item.statModifiers).length === 0)) {
      if (matchAny(text, EQUIP_ATK)) {
        item.statModifiers = { atk: 3 };
        item.equipSlot ||= 'weapon';
      } else if (matchAny(text, EQUIP_DEF)) {
        item.statModifiers = { def: 3 };
        item.equipSlot ||= 'armor';
      } else {
        item.statModifiers = { def: 2 };
        item.equipSlot ||= 'accessory';
      }
      report.itemsFilled.push({ id: item.id, kind: 'statModifiers', effect: item.statModifiers });
    }
  }

  // ---------- 4) 敌人：ecology + 掉落表 ----------
  for (const enemy of preset.enemies) {
    if (!enemy.ecology || !enemy.ecology.biome) {
      const inferred = inferEcology(enemy);
      if (inferred.biome) {
        const v = validateEcology(inferred);
        if (v.ok) {
          enemy.ecology = inferred;
          report.enemyEcology.push({ id: enemy.id, ecology: inferred });
        }
      } else {
        report.notes.push(`敌人 ${enemy.id}（${enemy.name || ''}）无法从 tags 推断 biome，未补生态位/掉落（可手动 enemy_assign_ecology）`);
      }
    }
    // 有 ecology.biome 但没静态掉落 → 烘焙
    if (enemy.ecology?.biome && (!enemy.lootTable || enemy.lootTable.length === 0) && enemy.lootMode !== 'dynamic') {
      const tier = enemy.ecology.tier || difficultyToTier(enemy.difficulty);
      const table = resolveLootTable({ ...enemy.ecology, tier });
      if (table.length > 0) {
        enemy.lootTable = table;
        enemy.lootMode = 'static';
        for (const e of table) if (!preset.items.some(it => it.id === e.itemId)) lootItemsNeeded.push(e.itemId);
        report.enemyLoot.push({ id: enemy.id, count: table.length });
      }
    }
  }
  // 去重 lootItemsNeeded
  const uniqLoot = [...new Set(lootItemsNeeded)];

  // ---------- 5) 变量闭环 + 6) 孤儿敌人 ----------
  const produced = new Set();   // set_variable 写出的变量
  const consumed = new Set();   // 触发/门控条件读取的变量
  const combatEnemyIds = new Set();

  const scanEffects = (effects = []) => {
    for (const eff of effects) {
      if (eff.type === 'set_variable' && eff.name) produced.add(eff.name);
      if (eff.type === 'start_combat') (eff.enemyIds || []).forEach(id => combatEnemyIds.add(id));
    }
  };
  for (const ev of preset.events) {
    for (const ch of (ev.choices || [])) {
      for (const o of (ch.outcomes || [])) scanEffects(o.effects);
      scanEffects(ch.effects); // 兼容 choice.effects 扁平写法
    }
    // 触发条件读取的变量
    const cond = ev.trigger?.condition || {};
    for (const k of Object.keys(cond.requireVariables || {})) consumed.add(k);
  }
  // 门控连接读取的变量
  for (const s of preset.scenes) {
    for (const c of (s.connections || [])) {
      const req = c.requires || c.gated || c.condition || {};
      for (const k of Object.keys(req.requireVariables || req.variables || {})) consumed.add(k);
    }
  }

  report.variablesSetButUnused = [...produced].filter(v => !consumed.has(v) && v !== 'game_complete');
  report.variablesReadButUnset = [...consumed].filter(v => !produced.has(v));

  const enemyIds = new Set(preset.enemies.map(e => e.id));
  report.orphanEnemies = [...enemyIds].filter(id => !combatEnemyIds.has(id));

  // ---------- 7) 结局 ----------
  const hasEnding = preset.events.some(e => {
    const tags = e.tags || [];
    return tags.includes('ending') || tags.includes('epilogue');
  }) || (Array.isArray(preset.endings) && preset.endings.length > 0);
  report.endings.hasEnding = hasEnding;

  if (!hasEnding && opts.addEndingScaffold && preset.scenes.length > 0) {
    const lastScene = preset.scenes[preset.scenes.length - 1];
    preset.events.push({
      id: 'ev_ending_scaffold',
      type: 'event',
      name: '终章',
      description: '（自动补全的结局脚手架——请替换为真正的结局文本与分支）',
      eventType: 'story',
      inScene: [lastScene.id],
      trigger: { type: 'composite', condition: { inScene: [lastScene.id], probability: 1.0 } },
      priority: 50,
      repeatable: false,
      tags: ['ending', 'main'],
      choices: [{
        text: '迎接结局',
        outcomes: [{ probability: 1.0, text: '故事落下帷幕。', effects: [{ type: 'set_variable', name: 'game_complete', value: true }] }],
      }],
    });
    report.endings.added = true;
    report.endings.sceneId = lastScene.id;
  }

  return { preset, report, lootItemsNeeded: uniqLoot };
}

/** 把 report 渲染成给人/MCP 客户端读的中文文本 */
export function formatNormalizeReport(report, lootItemsNeeded = []) {
  const L = [];
  L.push('╔══ 剧本补全报告 ══╗', '');
  if (report.startingSceneId) L.push(`✓ startingSceneId: ${report.startingSceneId.from} → ${report.startingSceneId.to}`);
  else L.push('· startingSceneId: 已有，未改');
  if (report.coordsFilled) L.push(`✓ 自动布局坐标: ${report.coordsFilled} 个场景`);
  if (report.itemsFilled.length) {
    L.push(`✓ 物品 effect 补全: ${report.itemsFilled.length} 件`);
    for (const it of report.itemsFilled) L.push(`    - ${it.id}: ${it.kind} = ${JSON.stringify(it.effect)}`);
  }
  if (report.enemyEcology.length) L.push(`✓ 敌人生态位推断: ${report.enemyEcology.map(e => `${e.id}→${e.ecology.biome}`).join(', ')}`);
  if (report.enemyLoot.length) L.push(`✓ 敌人掉落烘焙: ${report.enemyLoot.map(e => `${e.id}(${e.count}项)`).join(', ')}`);
  if (lootItemsNeeded.length) L.push(`  └ 需物料化的掉落物品(${lootItemsNeeded.length}): ${lootItemsNeeded.join(', ')}`);

  L.push('', '⚠ 需作者决策：');
  L.push(`  · 设了但没人读的变量(${report.variablesSetButUnused.length}): ${report.variablesSetButUnused.join(', ') || '无'}`);
  if (report.variablesReadButUnset.length) L.push(`  · 读了但没人写的变量(${report.variablesReadButUnset.length}): ${report.variablesReadButUnset.join(', ')}`);
  L.push(`  · 从未被战斗引用的孤儿敌人(${report.orphanEnemies.length}): ${report.orphanEnemies.join(', ') || '无'}`);
  L.push(`  · 结局: ${report.endings.hasEnding ? '已有' : (report.endings.added ? `无 → 已补脚手架(@${report.endings.sceneId})` : '无（建议补 endings 或给终局事件打 ending 标签）')}`);
  for (const n of report.notes) L.push(`  · ${n}`);
  return L.join('\n');
}
