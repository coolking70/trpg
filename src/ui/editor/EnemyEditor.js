/**
 * 敌人编辑器
 */

import { field, numberField, selectField, section, listFormLayout, uniqueId } from './_helpers.js';

let selectedIndex = 0;

export function renderEnemyEditor(container, preset, refresh) {
  preset.enemies = preset.enemies || [];

  listFormLayout(container, {
    title: `敌人 (${preset.enemies.length})`,
    items: preset.enemies,
    selectedIndex,
    getLabel: (e) => `${e.name || '(未命名)'} [${e.difficulty || 'normal'}]`,
    onAdd: () => {
      const ne = createBlankEnemy(uniqueId('enemy', preset.enemies));
      preset.enemies.push(ne);
      selectedIndex = preset.enemies.length - 1;
      refresh();
    },
    onDelete: (i) => {
      preset.enemies.splice(i, 1);
      selectedIndex = Math.min(selectedIndex, preset.enemies.length - 1);
      refresh();
    },
    onSelect: (i) => { selectedIndex = i; refresh(); },
    renderForm: (parent, enemy) => renderEnemyForm(parent, enemy, refresh, preset),
  });
}

function renderEnemyForm(parent, enemy, refresh, preset) {
  const root = document.createElement('div');
  root.className = 'editor-form';

  const baseSec = section('基本信息');
  baseSec.appendChild(field('ID', { value: enemy.id, onChange: v => enemy.id = v }));
  baseSec.appendChild(field('名称', { value: enemy.name, onChange: v => enemy.name = v }));
  baseSec.appendChild(field('描述', { value: enemy.description, multiline: true, rows: 2, onChange: v => enemy.description = v }));
  baseSec.appendChild(selectField('难度', {
    value: enemy.difficulty || 'normal',
    options: [
      { value: 'easy', label: '简单' },
      { value: 'normal', label: '普通' },
      { value: 'hard', label: '困难' },
      { value: 'boss', label: 'Boss' },
    ],
    onChange: v => { enemy.difficulty = v; refresh(); },
  }));
  baseSec.appendChild(selectField('行为倾向', {
    value: enemy.behaviorHint || 'aggressive',
    options: [
      { value: 'aggressive', label: '激进' },
      { value: 'defensive', label: '防守' },
      { value: 'random', label: '随机' },
      { value: 'support', label: '支援' },
    ],
    onChange: v => enemy.behaviorHint = v,
  }));
  baseSec.appendChild(numberField('经验奖励', { value: enemy.experienceReward || 10, min: 0, onChange: v => enemy.experienceReward = parseInt(v) }));
  root.appendChild(baseSec);

  // 属性
  enemy.stats = enemy.stats || {};
  const statsSec = section('属性');
  const statsGrid = document.createElement('div');
  statsGrid.className = 'editor-stats-grid';
  const statFields = [
    ['hp', 'HP 上限'], ['hpCurrent', 'HP 当前'],
    ['mp', 'MP 上限'], ['mpCurrent', 'MP 当前'],
    ['attack', '物攻'], ['defense', '物防'],
    ['magicAttack', '魔攻'], ['magicDefense', '魔防'],
    ['speed', '速度'], ['luck', '幸运'],
  ];
  for (const [key, label] of statFields) {
    statsGrid.appendChild(numberField(label, {
      value: enemy.stats[key] ?? 10, min: 0,
      onChange: v => { enemy.stats[key] = parseInt(v) || 0; },
    }));
  }
  statsSec.appendChild(statsGrid);
  root.appendChild(statsSec);

  // 掉落表
  enemy.lootTable = enemy.lootTable || [];
  const lootSec = section(`掉落表 (${enemy.lootTable.length})`);
  for (let i = 0; i < enemy.lootTable.length; i++) {
    const entry = enemy.lootTable[i];
    const row = document.createElement('div');
    row.className = 'editor-subform editor-loot-row';
    row.appendChild(field('道具 ID', { value: entry.itemId, onChange: v => entry.itemId = v }));
    row.appendChild(numberField('掉落概率 (0-1)', { value: entry.dropRate ?? 0.5, min: 0, max: 1, step: 0.05, onChange: v => entry.dropRate = parseFloat(v) }));
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn--danger';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => { enemy.lootTable.splice(i, 1); refresh(); });
    row.appendChild(delBtn);
    lootSec.appendChild(row);
  }
  const addLootBtn = document.createElement('button');
  addLootBtn.className = 'btn';
  addLootBtn.textContent = '+ 新增掉落';
  addLootBtn.addEventListener('click', () => {
    enemy.lootTable.push({ itemId: '', dropRate: 0.5 });
    refresh();
  });
  lootSec.appendChild(addLootBtn);
  root.appendChild(lootSec);

  parent.appendChild(root);
}

function createBlankEnemy(id) {
  return {
    id, type: 'enemy', name: '新敌人', description: '', image: '',
    stats: { hp: 40, hpCurrent: 40, mp: 0, mpCurrent: 0, attack: 8, defense: 4, magicAttack: 0, magicDefense: 2, speed: 8, luck: 2 },
    abilities: [], lootTable: [],
    behaviorHint: 'aggressive', experienceReward: 10, difficulty: 'normal',
    position: { x: 0, y: 0 }, statusEffects: [], tags: [], notes: '',
  };
}
