/**
 * 事件编辑器
 * 包含：复合触发条件、选择 + outcomes、商店 inventory
 */

import { field, numberField, selectField, section, listFormLayout, uniqueId } from './_helpers.js';

let selectedIndex = 0;

export function renderEventEditor(container, preset, refresh) {
  preset.events = preset.events || [];

  listFormLayout(container, {
    title: `事件 (${preset.events.length})`,
    items: preset.events,
    selectedIndex,
    getLabel: (e) => `${e.name || '(未命名)'} [${e.eventType || ''}]${!e.repeatable ? ' ×1' : ''}`,
    onAdd: () => {
      const ne = createBlankEvent(uniqueId('event', preset.events));
      preset.events.push(ne);
      selectedIndex = preset.events.length - 1;
      refresh();
    },
    onDelete: (i) => {
      preset.events.splice(i, 1);
      selectedIndex = Math.min(selectedIndex, preset.events.length - 1);
      refresh();
    },
    onSelect: (i) => { selectedIndex = i; refresh(); },
    renderForm: (parent, evt) => renderEventForm(parent, evt, refresh, preset),
  });
}

function renderEventForm(parent, evt, refresh, preset) {
  const root = document.createElement('div');
  root.className = 'editor-form';

  // === 基本信息 ===
  const baseSec = section('基本信息');
  baseSec.appendChild(field('ID', { value: evt.id, onChange: v => evt.id = v }));
  baseSec.appendChild(field('名称', { value: evt.name, onChange: v => evt.name = v }));
  baseSec.appendChild(field('描述', { value: evt.description, multiline: true, rows: 3, onChange: v => evt.description = v }));
  baseSec.appendChild(selectField('类型', {
    value: evt.eventType || 'story',
    options: [
      { value: 'encounter', label: '遭遇' },
      { value: 'story', label: '剧情' },
      { value: 'trap', label: '陷阱' },
      { value: 'treasure', label: '宝藏' },
      { value: 'rest', label: '休息' },
      { value: 'shop', label: '商店' },
      { value: 'boss', label: 'Boss' },
    ],
    onChange: v => { evt.eventType = v; refresh(); },
  }));
  baseSec.appendChild(numberField('优先级', {
    value: evt.priority || 0, min: 0, max: 200,
    hint: '多个事件同时匹配时高优先级先触发',
    onChange: v => evt.priority = parseInt(v),
  }));

  const repeatableWrap = document.createElement('div');
  repeatableWrap.className = 'editor-field';
  repeatableWrap.innerHTML = `
    <label class="editor-field__label">
      <input type="checkbox" ${evt.repeatable ? 'checked' : ''} id="evt-repeatable"> 可重复触发
    </label>
  `;
  repeatableWrap.querySelector('input').addEventListener('change', (e) => {
    evt.repeatable = e.target.checked;
  });
  baseSec.appendChild(repeatableWrap);

  baseSec.appendChild(field('AI 叙事提示', {
    value: evt.aiPromptHint, placeholder: '如：氛围紧张、对话幽默',
    onChange: v => evt.aiPromptHint = v,
  }));
  root.appendChild(baseSec);

  // === 触发条件 ===
  evt.trigger = evt.trigger || { type: 'composite', condition: {} };
  const trigSec = section('触发条件');
  trigSec.appendChild(selectField('触发器类型', {
    value: evt.trigger.type,
    options: [
      { value: 'composite', label: '复合条件' },
      { value: 'explicit', label: '仅手动触发（trigger_event）' },
    ],
    onChange: v => { evt.trigger.type = v; refresh(); },
  }));

  if (evt.trigger.type === 'composite') {
    const cond = evt.trigger.condition = evt.trigger.condition || {};

    trigSec.appendChild(field('tile types（逗号分隔）', {
      value: (cond.tileTypes || []).join(','),
      placeholder: '如：R,T,G',
      onChange: v => { cond.tileTypes = v.split(',').map(s => s.trim()).filter(Boolean); },
    }));

    trigSec.appendChild(field('POI IDs（逗号分隔）', {
      value: (cond.pointsOfInterest || []).join(','),
      placeholder: '如：poi_village',
      onChange: v => { cond.pointsOfInterest = v.split(',').map(s => s.trim()).filter(Boolean); },
    }));

    trigSec.appendChild(field('requireVariables（JSON）', {
      value: cond.requireVariables ? JSON.stringify(cond.requireVariables) : '',
      placeholder: '如：{"quest_started":true}',
      onChange: v => {
        try {
          cond.requireVariables = v.trim() ? JSON.parse(v) : undefined;
        } catch (e) { /* 忽略错误 */ }
      },
    }));

    trigSec.appendChild(field('需要已完成事件（逗号分隔 ID）', {
      value: (cond.requireCompletedEvents || []).join(','),
      onChange: v => { cond.requireCompletedEvents = v.split(',').map(s => s.trim()).filter(Boolean); },
    }));

    trigSec.appendChild(field('排除已完成事件（逗号分隔 ID）', {
      value: (cond.excludeCompletedEvents || []).join(','),
      onChange: v => { cond.excludeCompletedEvents = v.split(',').map(s => s.trim()).filter(Boolean); },
    }));

    trigSec.appendChild(numberField('队伍 HP 低于（0-1）', {
      value: cond.partyHpBelow ?? '', min: 0, max: 1, step: 0.05,
      onChange: v => { cond.partyHpBelow = v === '' ? undefined : parseFloat(v); },
    }));

    trigSec.appendChild(numberField('回合数至少', {
      value: cond.turnNumberAtLeast ?? '', min: 0,
      onChange: v => { cond.turnNumberAtLeast = v === '' ? undefined : parseInt(v); },
    }));

    trigSec.appendChild(numberField('概率（0-1）', {
      value: cond.probability ?? 1.0, min: 0, max: 1, step: 0.05,
      onChange: v => { cond.probability = parseFloat(v); },
    }));
  }
  root.appendChild(trigSec);

  // === 商店配置（仅 shop 类型显示） ===
  if (evt.eventType === 'shop') {
    evt.shop = evt.shop || { inventory: [], sellMultiplier: 0.5 };
    const shopSec = section('商店配置');
    shopSec.appendChild(numberField('回购倍率（出售价 = sellPrice × 此值）', {
      value: evt.shop.sellMultiplier ?? 0.5, min: 0, max: 1, step: 0.05,
      onChange: v => evt.shop.sellMultiplier = parseFloat(v),
    }));

    const invLabel = document.createElement('div');
    invLabel.className = 'editor-field__label';
    invLabel.textContent = `商品列表 (${evt.shop.inventory.length})`;
    shopSec.appendChild(invLabel);

    for (let i = 0; i < evt.shop.inventory.length; i++) {
      const entry = evt.shop.inventory[i];
      const row = document.createElement('div');
      row.className = 'editor-subform editor-loot-row';
      row.appendChild(field('道具 ID', { value: entry.itemId, onChange: v => entry.itemId = v }));
      row.appendChild(numberField('价格', { value: entry.price || 0, min: 0, onChange: v => entry.price = parseInt(v) }));
      row.appendChild(numberField('库存', { value: entry.stock ?? 99, min: 0, onChange: v => entry.stock = parseInt(v) }));
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn--danger';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', () => { evt.shop.inventory.splice(i, 1); refresh(); });
      row.appendChild(delBtn);
      shopSec.appendChild(row);
    }
    const addBtn = document.createElement('button');
    addBtn.className = 'btn';
    addBtn.textContent = '+ 新增商品';
    addBtn.addEventListener('click', () => {
      evt.shop.inventory.push({ itemId: '', price: 10, stock: 99 });
      refresh();
    });
    shopSec.appendChild(addBtn);
    root.appendChild(shopSec);
  }

  // === 选项 + outcomes ===
  evt.choices = evt.choices || [];
  const choicesSec = section(`选项 (${evt.choices.length})`);
  for (let ci = 0; ci < evt.choices.length; ci++) {
    const choice = evt.choices[ci];
    const cBlock = document.createElement('div');
    cBlock.className = 'editor-choice';
    cBlock.appendChild(field('选项 ID', { value: choice.id, onChange: v => choice.id = v }));
    cBlock.appendChild(field('选项文本', { value: choice.text, onChange: v => choice.text = v }));

    // outcomes
    choice.outcomes = choice.outcomes || [];
    const ocLabel = document.createElement('div');
    ocLabel.className = 'editor-field__label';
    ocLabel.textContent = `Outcomes (${choice.outcomes.length})`;
    cBlock.appendChild(ocLabel);

    for (let oi = 0; oi < choice.outcomes.length; oi++) {
      const oc = choice.outcomes[oi];
      const ocBlock = document.createElement('div');
      ocBlock.className = 'editor-outcome';
      ocBlock.appendChild(numberField('概率', { value: oc.probability ?? 1.0, min: 0, max: 1, step: 0.05, onChange: v => oc.probability = parseFloat(v) }));
      ocBlock.appendChild(field('结果文本', { value: oc.text, multiline: true, rows: 2, onChange: v => oc.text = v }));

      // effects
      oc.effects = oc.effects || [];
      const efLabel = document.createElement('div');
      efLabel.className = 'editor-field__label';
      efLabel.textContent = `效果 (${oc.effects.length})`;
      ocBlock.appendChild(efLabel);

      for (let ei = 0; ei < oc.effects.length; ei++) {
        const ef = oc.effects[ei];
        const efBlock = document.createElement('div');
        efBlock.className = 'editor-effect';
        efBlock.appendChild(selectField('类型', {
          value: ef.type || 'set_variable',
          options: [
            { value: 'set_variable', label: 'set_variable 设变量' },
            { value: 'add_item', label: 'add_item 加道具' },
            { value: 'remove_item', label: 'remove_item 移除道具' },
            { value: 'heal', label: 'heal 治疗' },
            { value: 'damage', label: 'damage 伤害' },
            { value: 'start_combat', label: 'start_combat 触发战斗' },
            { value: 'trigger_event', label: 'trigger_event 触发事件' },
            { value: 'add_memory', label: 'add_memory 写入记忆' },
            { value: 'narrative', label: 'narrative 仅叙述（无效果）' },
          ],
          onChange: v => { ef.type = v; refresh(); },
        }));

        // 类型特定字段
        renderEffectFields(efBlock, ef);

        const delEf = document.createElement('button');
        delEf.className = 'btn btn--danger';
        delEf.textContent = '删除效果';
        delEf.addEventListener('click', () => { oc.effects.splice(ei, 1); refresh(); });
        efBlock.appendChild(delEf);
        ocBlock.appendChild(efBlock);
      }

      const addEf = document.createElement('button');
      addEf.className = 'btn';
      addEf.textContent = '+ 新增效果';
      addEf.addEventListener('click', () => {
        oc.effects.push({ type: 'set_variable', name: '', value: '' });
        refresh();
      });
      ocBlock.appendChild(addEf);

      const delOc = document.createElement('button');
      delOc.className = 'btn btn--danger';
      delOc.textContent = '删除此结果';
      delOc.addEventListener('click', () => { choice.outcomes.splice(oi, 1); refresh(); });
      ocBlock.appendChild(delOc);
      cBlock.appendChild(ocBlock);
    }

    const addOc = document.createElement('button');
    addOc.className = 'btn';
    addOc.textContent = '+ 新增 outcome';
    addOc.addEventListener('click', () => {
      choice.outcomes.push({ probability: 1.0, text: '', effects: [] });
      refresh();
    });
    cBlock.appendChild(addOc);

    const delChoice = document.createElement('button');
    delChoice.className = 'btn btn--danger';
    delChoice.textContent = '删除此选项';
    delChoice.addEventListener('click', () => { evt.choices.splice(ci, 1); refresh(); });
    cBlock.appendChild(delChoice);
    choicesSec.appendChild(cBlock);
  }
  const addChoice = document.createElement('button');
  addChoice.className = 'btn';
  addChoice.textContent = '+ 新增选项';
  addChoice.addEventListener('click', () => {
    evt.choices.push({ id: `choice_${evt.choices.length + 1}`, text: '新选项', outcomes: [{ probability: 1.0, text: '', effects: [] }] });
    refresh();
  });
  choicesSec.appendChild(addChoice);
  root.appendChild(choicesSec);

  parent.appendChild(root);
}

function renderEffectFields(parent, ef) {
  switch (ef.type) {
    case 'set_variable':
      parent.appendChild(field('变量名', { value: ef.name, onChange: v => ef.name = v }));
      parent.appendChild(field('值（true/false/数字/字符串）', {
        value: typeof ef.value === 'boolean' ? String(ef.value) : (ef.value ?? ''),
        onChange: v => {
          if (v === 'true') ef.value = true;
          else if (v === 'false') ef.value = false;
          else if (!isNaN(Number(v)) && v !== '') ef.value = Number(v);
          else ef.value = v;
        },
      }));
      break;
    case 'add_item':
    case 'remove_item':
      parent.appendChild(field('道具 ID', { value: ef.itemId, onChange: v => ef.itemId = v }));
      break;
    case 'heal':
    case 'damage':
      parent.appendChild(field('目标 ID（或 all）', { value: ef.target || 'all', onChange: v => ef.target = v }));
      parent.appendChild(numberField('数值', { value: ef.value || 0, min: 0, onChange: v => ef.value = parseInt(v) }));
      break;
    case 'start_combat':
      parent.appendChild(field('敌人 IDs（逗号分隔）', {
        value: (ef.enemyIds || []).join(','),
        onChange: v => { ef.enemyIds = v.split(',').map(s => s.trim()).filter(Boolean); },
      }));
      break;
    case 'trigger_event':
      parent.appendChild(field('事件 ID', { value: ef.eventId, onChange: v => ef.eventId = v }));
      break;
    case 'add_memory':
      parent.appendChild(field('记忆摘要', { value: ef.value, onChange: v => ef.value = v }));
      break;
    case 'narrative':
      parent.appendChild(field('叙述文本', { value: ef.text, multiline: true, rows: 2, onChange: v => ef.text = v }));
      break;
  }
}

function createBlankEvent(id) {
  return {
    id, type: 'event', name: '新事件', description: '', image: '', eventType: 'story',
    trigger: { type: 'composite', condition: { probability: 1.0 } },
    choices: [], repeatable: false, maxOccurrences: 1,
    aiPromptHint: '', priority: 0,
    tags: [], notes: '',
  };
}
