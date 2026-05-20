/**
 * 世界观编辑器：lore + rules + aiConfig
 */

import { field, numberField, section } from './_helpers.js';

export function renderWorldEditor(container, preset, refresh) {
  preset.lore = preset.lore || {};
  preset.rules = preset.rules || {};
  preset.aiConfig = preset.aiConfig || {};

  const root = document.createElement('div');
  root.className = 'editor-form';

  // === 预设基本信息 ===
  const baseSec = section('预设基本信息');
  baseSec.appendChild(field('预设名称', { value: preset.name, onChange: v => preset.name = v }));
  baseSec.appendChild(field('作者', { value: preset.author, onChange: v => preset.author = v }));
  baseSec.appendChild(field('描述', { value: preset.description, multiline: true, rows: 2, onChange: v => preset.description = v }));
  root.appendChild(baseSec);

  // === 世界设定 ===
  const loreSec = section('世界设定 (Lore)');
  loreSec.appendChild(field('世界名', { value: preset.lore.worldName, onChange: v => preset.lore.worldName = v }));
  loreSec.appendChild(field('时代', { value: preset.lore.era, placeholder: '如：黑暗纪元第三年', onChange: v => preset.lore.era = v }));
  loreSec.appendChild(field('背景', {
    value: preset.lore.background, multiline: true, rows: 4,
    hint: '一段长背景介绍，会注入到 AI 长期记忆',
    onChange: v => preset.lore.background = v,
  }));
  loreSec.appendChild(field('规则说明', {
    value: preset.lore.rules, multiline: true, rows: 2,
    onChange: v => preset.lore.rules = v,
  }));
  loreSec.appendChild(field('GM 叙事风格', {
    value: preset.lore.gmStyle, multiline: true, rows: 2,
    hint: '会传给 AI 控制叙事调性',
    onChange: v => preset.lore.gmStyle = v,
  }));
  root.appendChild(loreSec);

  // === 游戏规则 ===
  const rulesSec = section('游戏规则');
  rulesSec.appendChild(field('骰子类型', { value: preset.rules.diceType || 'd20', onChange: v => preset.rules.diceType = v }));
  rulesSec.appendChild(numberField('最大队伍人数', { value: preset.rules.maxPartySize || 4, min: 1, max: 6, onChange: v => preset.rules.maxPartySize = parseInt(v) }));
  rulesSec.appendChild(numberField('起始金币', { value: preset.rules.startingGold || 100, min: 0, onChange: v => preset.rules.startingGold = parseInt(v) }));
  root.appendChild(rulesSec);

  // === AI 配置 ===
  const aiSec = section('AI 配置');
  aiSec.appendChild(numberField('温度', { value: preset.aiConfig.temperature ?? 0.7, min: 0, max: 1, step: 0.1, onChange: v => preset.aiConfig.temperature = parseFloat(v) }));
  aiSec.appendChild(numberField('最大响应 token', { value: preset.aiConfig.maxResponseTokens || 300, min: 50, max: 2000, step: 50, onChange: v => preset.aiConfig.maxResponseTokens = parseInt(v) }));
  root.appendChild(aiSec);

  container.appendChild(root);
}
