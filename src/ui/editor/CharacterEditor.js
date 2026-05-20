/**
 * 角色编辑器
 */

import { field, numberField, section, listFormLayout, uniqueId } from './_helpers.js';

let selectedIndex = 0;

export function renderCharacterEditor(container, preset, refresh) {
  preset.characters = preset.characters || [];

  listFormLayout(container, {
    title: `角色 (${preset.characters.length})`,
    items: preset.characters,
    selectedIndex,
    getLabel: (c) => `${c.name || '(未命名)'}${c.title ? ` - ${c.title}` : ''}`,
    onAdd: () => {
      const newChar = createBlankCharacter(uniqueId('char', preset.characters));
      preset.characters.push(newChar);
      selectedIndex = preset.characters.length - 1;
      refresh();
    },
    onDelete: (i) => {
      preset.characters.splice(i, 1);
      selectedIndex = Math.min(selectedIndex, preset.characters.length - 1);
      refresh();
    },
    onSelect: (i) => {
      selectedIndex = i;
      refresh();
    },
    renderForm: (parent, char) => renderForm(parent, char, refresh, preset),
  });
}

function renderForm(parent, char, refresh, preset) {
  const root = document.createElement('div');
  root.className = 'editor-form';

  // 基本信息
  const baseSec = section('基本信息');
  baseSec.appendChild(field('ID', { value: char.id, onChange: v => { char.id = v; } }));
  baseSec.appendChild(field('姓名', { value: char.name, onChange: v => char.name = v }));
  baseSec.appendChild(field('称号', { value: char.title, placeholder: '如：圣骑士、游侠', onChange: v => char.title = v }));
  baseSec.appendChild(field('描述', { value: char.description, multiline: true, rows: 2, onChange: v => char.description = v }));
  root.appendChild(baseSec);

  // 属性
  char.stats = char.stats || {};
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
      value: char.stats[key] ?? 10, min: 0, max: 999,
      onChange: v => { char.stats[key] = parseInt(v) || 0; },
    }));
  }
  statsSec.appendChild(statsGrid);
  root.appendChild(statsSec);

  // 等级
  const lvSec = section('等级与经验');
  lvSec.appendChild(numberField('等级', { value: char.level || 1, min: 1, onChange: v => char.level = parseInt(v) }));
  lvSec.appendChild(numberField('经验', { value: char.experience || 0, min: 0, onChange: v => char.experience = parseInt(v) }));
  root.appendChild(lvSec);

  // 技能
  char.abilities = char.abilities || [];
  const abilSec = section(`技能 (${char.abilities.length})`);
  for (let i = 0; i < char.abilities.length; i++) {
    const ab = char.abilities[i];
    const sub = document.createElement('div');
    sub.className = 'editor-subform';
    sub.appendChild(field('技能 ID', { value: ab.id, onChange: v => ab.id = v }));
    sub.appendChild(field('技能名', { value: ab.name, onChange: v => ab.name = v }));
    sub.appendChild(field('描述', { value: ab.description, multiline: true, rows: 1, onChange: v => ab.description = v }));
    ab.cost = ab.cost || {};
    sub.appendChild(numberField('MP 消耗', { value: ab.cost.mp || 0, min: 0, onChange: v => ab.cost.mp = parseInt(v) }));
    ab.effect = ab.effect || {};
    ab.effect.damage = ab.effect.damage || {};
    sub.appendChild(field('伤害公式', {
      value: ab.effect.damage.formula || '',
      placeholder: '如：attack * 1.5 + d6 或 magicAttack * 2',
      onChange: v => { ab.effect.damage.formula = v; },
    }));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn--danger editor-subform__del';
    delBtn.textContent = '删除技能';
    delBtn.addEventListener('click', () => {
      char.abilities.splice(i, 1);
      refresh();
    });
    sub.appendChild(delBtn);
    abilSec.appendChild(sub);
  }
  const addAbilBtn = document.createElement('button');
  addAbilBtn.className = 'btn';
  addAbilBtn.textContent = '+ 新增技能';
  addAbilBtn.addEventListener('click', () => {
    char.abilities.push({ id: uniqueId('ability', char.abilities.concat(...preset.characters.flatMap(c => c.abilities || []))), name: '新技能', description: '', type: 'active', cost: { mp: 5 }, effect: { damage: { formula: 'attack' } }, cooldown: 0 });
    refresh();
  });
  abilSec.appendChild(addAbilBtn);
  root.appendChild(abilSec);

  // 装备槽位
  char.equipment = char.equipment || { weapon: null, armor: null, accessory: null };
  const equipSec = section('装备槽位（填道具 ID）');
  for (const slot of ['weapon', 'armor', 'accessory']) {
    const labelMap = { weapon: '武器', armor: '护甲', accessory: '饰品' };
    equipSec.appendChild(field(labelMap[slot], {
      value: char.equipment[slot] || '',
      placeholder: '留空 = 未装备',
      onChange: v => char.equipment[slot] = v || null,
    }));
  }
  root.appendChild(equipSec);

  parent.appendChild(root);
}

function createBlankCharacter(id) {
  return {
    id, type: 'character', name: '新角色', title: '', description: '',
    image: '',
    stats: { hp: 100, hpCurrent: 100, mp: 50, mpCurrent: 50, attack: 12, defense: 8, magicAttack: 6, magicDefense: 6, speed: 10, luck: 5 },
    abilities: [],
    equipment: { weapon: null, armor: null, accessory: null },
    inventory: [],
    position: { x: 0, y: 0 }, level: 1, experience: 0,
    statusEffects: [], tags: [], notes: '',
  };
}
