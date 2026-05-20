/**
 * 物品编辑器
 */

import { field, numberField, selectField, section, listFormLayout, uniqueId } from './_helpers.js';

let selectedIndex = 0;

export function renderItemEditor(container, preset, refresh) {
  preset.items = preset.items || [];

  listFormLayout(container, {
    title: `物品 (${preset.items.length})`,
    items: preset.items,
    selectedIndex,
    getLabel: (it) => `${it.name || '(未命名)'} [${it.itemType || ''}]`,
    onAdd: () => {
      const ni = createBlankItem(uniqueId('item', preset.items));
      preset.items.push(ni);
      selectedIndex = preset.items.length - 1;
      refresh();
    },
    onDelete: (i) => {
      preset.items.splice(i, 1);
      selectedIndex = Math.min(selectedIndex, preset.items.length - 1);
      refresh();
    },
    onSelect: (i) => { selectedIndex = i; refresh(); },
    renderForm: (parent, item) => renderItemForm(parent, item, refresh),
  });
}

function renderItemForm(parent, item, refresh) {
  const root = document.createElement('div');
  root.className = 'editor-form';

  const baseSec = section('基本信息');
  baseSec.appendChild(field('ID', { value: item.id, onChange: v => item.id = v }));
  baseSec.appendChild(field('名称', { value: item.name, onChange: v => item.name = v }));
  baseSec.appendChild(field('描述', { value: item.description, multiline: true, rows: 2, onChange: v => item.description = v }));
  baseSec.appendChild(selectField('类型', {
    value: item.itemType || 'consumable',
    options: [
      { value: 'weapon', label: '武器' },
      { value: 'armor', label: '护甲' },
      { value: 'accessory', label: '饰品' },
      { value: 'consumable', label: '消耗品' },
      { value: 'quest', label: '任务物品' },
      { value: 'material', label: '材料' },
    ],
    onChange: v => { item.itemType = v; refresh(); },
  }));
  root.appendChild(baseSec);

  // 装备槽位（仅装备类显示）
  if (['weapon', 'armor', 'accessory'].includes(item.itemType)) {
    const equipSec = section('装备槽位');
    equipSec.appendChild(selectField('槽位', {
      value: item.equipSlot || item.itemType,
      options: [
        { value: 'weapon', label: '武器' },
        { value: 'armor', label: '护甲' },
        { value: 'accessory', label: '饰品' },
      ],
      onChange: v => item.equipSlot = v,
    }));
    // 属性修正
    item.statModifiers = item.statModifiers || {};
    const modKeys = ['hp', 'mp', 'attack', 'defense', 'magicAttack', 'magicDefense', 'speed', 'luck'];
    const modGrid = document.createElement('div');
    modGrid.className = 'editor-stats-grid';
    for (const k of modKeys) {
      modGrid.appendChild(numberField(`${k} 修正`, {
        value: item.statModifiers[k] ?? 0,
        onChange: v => {
          const n = parseInt(v) || 0;
          if (n === 0) delete item.statModifiers[k];
          else item.statModifiers[k] = n;
        },
      }));
    }
    equipSec.appendChild(modGrid);
    root.appendChild(equipSec);
  }

  // 消耗效果（仅消耗品）
  if (item.itemType === 'consumable') {
    item.consumeEffect = item.consumeEffect || { type: 'heal', stat: 'hp', value: 30 };
    const consSec = section('消耗效果');
    consSec.appendChild(selectField('效果类型', {
      value: item.consumeEffect.type,
      options: [
        { value: 'heal', label: '恢复' },
        { value: 'buff', label: '增益' },
      ],
      onChange: v => { item.consumeEffect.type = v; refresh(); },
    }));
    consSec.appendChild(selectField('目标属性', {
      value: item.consumeEffect.stat || 'hp',
      options: [
        { value: 'hp', label: 'HP' },
        { value: 'mp', label: 'MP' },
        { value: 'attack', label: '攻击' },
        { value: 'speed', label: '速度' },
      ],
      onChange: v => item.consumeEffect.stat = v,
    }));
    consSec.appendChild(numberField('数值', { value: item.consumeEffect.value || 0, onChange: v => item.consumeEffect.value = parseInt(v) }));
    if (item.consumeEffect.type === 'buff') {
      consSec.appendChild(numberField('持续回合', { value: item.consumeEffect.duration || 3, min: 1, onChange: v => item.consumeEffect.duration = parseInt(v) }));
    }
    root.appendChild(consSec);
  }

  // 价格
  const priceSec = section('价格');
  priceSec.appendChild(numberField('购买价', { value: item.buyPrice || 0, min: 0, onChange: v => item.buyPrice = parseInt(v) }));
  priceSec.appendChild(numberField('出售价', { value: item.sellPrice || 0, min: 0, onChange: v => item.sellPrice = parseInt(v) }));
  root.appendChild(priceSec);

  parent.appendChild(root);
}

function createBlankItem(id) {
  return {
    id, type: 'item', name: '新物品', description: '', image: '',
    itemType: 'consumable',
    statModifiers: {},
    consumeEffect: { type: 'heal', stat: 'hp', value: 30 },
    equipSlot: null,
    buyPrice: 10, sellPrice: 5,
    stackable: true, maxStack: 10,
    tags: [], notes: '',
  };
}
