/**
 * 编辑器共享 helpers
 */

/** 创建带标签的输入框 */
export function field(label, options = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'editor-field';

  const lab = document.createElement('label');
  lab.className = 'editor-field__label';
  lab.textContent = label;
  wrap.appendChild(lab);

  const tag = options.multiline ? 'textarea' : 'input';
  const input = document.createElement(tag);
  input.className = 'editor-field__input input';
  if (options.type) input.type = options.type;
  if (options.value !== undefined && options.value !== null) input.value = options.value;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.multiline) input.rows = options.rows || 3;
  if (options.min !== undefined) input.min = options.min;
  if (options.max !== undefined) input.max = options.max;
  if (options.step !== undefined) input.step = options.step;
  if (options.onChange) {
    input.addEventListener('change', () => options.onChange(input.value));
    input.addEventListener('input', () => options.onChange(input.value));
  }
  wrap.appendChild(input);

  if (options.hint) {
    const hint = document.createElement('div');
    hint.className = 'editor-field__hint';
    hint.textContent = options.hint;
    wrap.appendChild(hint);
  }

  return wrap;
}

/** 创建数字输入框 */
export function numberField(label, options = {}) {
  return field(label, { type: 'number', ...options });
}

/** 创建下拉选择 */
export function selectField(label, options = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'editor-field';

  const lab = document.createElement('label');
  lab.className = 'editor-field__label';
  lab.textContent = label;
  wrap.appendChild(lab);

  const select = document.createElement('select');
  select.className = 'editor-field__input input';
  for (const opt of (options.options || [])) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label || opt.value;
    if (opt.value === options.value) o.selected = true;
    select.appendChild(o);
  }
  if (options.onChange) {
    select.addEventListener('change', () => options.onChange(select.value));
  }
  wrap.appendChild(select);

  return wrap;
}

/** 创建分区容器 */
export function section(title) {
  const sec = document.createElement('div');
  sec.className = 'editor-section';
  const h = document.createElement('h3');
  h.className = 'editor-section__title';
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

/** 渲染列表+表单 二栏布局 */
export function listFormLayout(parent, opts) {
  const layout = document.createElement('div');
  layout.className = 'editor-list-form';

  // 左侧列表
  const listSide = document.createElement('div');
  listSide.className = 'editor-list-form__list';

  const listHeader = document.createElement('div');
  listHeader.className = 'editor-list-form__list-header';
  const title = document.createElement('div');
  title.className = 'editor-list-form__title';
  title.textContent = opts.title || '列表';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn--primary';
  addBtn.textContent = '+ 新建';
  addBtn.addEventListener('click', opts.onAdd);
  listHeader.appendChild(title);
  listHeader.appendChild(addBtn);
  listSide.appendChild(listHeader);

  const listEl = document.createElement('div');
  listEl.className = 'editor-list-form__items';
  for (let i = 0; i < opts.items.length; i++) {
    const item = opts.items[i];
    const row = document.createElement('div');
    row.className = `editor-list-form__item${i === opts.selectedIndex ? ' active' : ''}`;
    row.innerHTML = `<span>${opts.getLabel(item)}</span>`;
    const delBtn = document.createElement('button');
    delBtn.className = 'editor-list-form__del';
    delBtn.textContent = '×';
    delBtn.title = '删除';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`删除 "${opts.getLabel(item)}"？`)) opts.onDelete(i);
    });
    row.appendChild(delBtn);
    row.addEventListener('click', () => opts.onSelect(i));
    listEl.appendChild(row);
  }
  listSide.appendChild(listEl);

  layout.appendChild(listSide);

  // 右侧表单
  const formSide = document.createElement('div');
  formSide.className = 'editor-list-form__form';
  if (opts.selectedIndex >= 0 && opts.items[opts.selectedIndex]) {
    opts.renderForm(formSide, opts.items[opts.selectedIndex], opts.selectedIndex);
  } else {
    formSide.innerHTML = '<div class="editor-list-form__empty">← 选择左侧项目或点击新建</div>';
  }
  layout.appendChild(formSide);

  parent.appendChild(layout);
  return layout;
}

/** 生成唯一 ID */
export function uniqueId(prefix, existing = []) {
  const used = new Set(existing.map(e => e.id));
  let i = 1;
  let id;
  do {
    id = `${prefix}_${String(i).padStart(3, '0')}`;
    i++;
  } while (used.has(id));
  return id;
}
