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
/**
 * 列表 + 表单 二栏布局
 * Phase 23B — 自动启用搜索框 + 分页（items.length > 30 时）
 *
 * opts:
 *   title, items, selectedIndex,
 *   getLabel(item), onSelect(i), onAdd, onDelete(i), renderForm(form, item, i),
 *   // 可选
 *   searchKeys: ['name', 'id', 'tags'],    // 默认从 getLabel 文本搜
 *   pageSize: 50,                           // 默认 50；items>30 时启用分页
 *   searchPlaceholder: '搜索...',
 */
export function listFormLayout(parent, opts) {
  const layout = document.createElement('div');
  layout.className = 'editor-list-form';

  const listSide = document.createElement('div');
  listSide.className = 'editor-list-form__list';

  // 头部
  const listHeader = document.createElement('div');
  listHeader.className = 'editor-list-form__list-header';
  const title = document.createElement('div');
  title.className = 'editor-list-form__title';
  title.textContent = `${opts.title || '列表'} (${opts.items.length})`;
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn--primary';
  addBtn.textContent = '+ 新建';
  addBtn.addEventListener('click', opts.onAdd);
  listHeader.appendChild(title);
  listHeader.appendChild(addBtn);
  listSide.appendChild(listHeader);

  // Phase 23B — 搜索框（items > 10 时启用，避免小列表多余 UI）
  const useSearch = opts.items.length > 10;
  let searchQuery = '';
  let searchInput = null;
  if (useSearch) {
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'editor-list-form__search input';
    searchInput.placeholder = opts.searchPlaceholder || `搜索 ${opts.items.length} 项...`;
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      renderItems();
    });
    listSide.appendChild(searchInput);
  }

  // 分页状态
  const PAGE_SIZE = opts.pageSize || 50;
  const usePaging = opts.items.length > PAGE_SIZE;
  let currentPage = 0;
  // 自动跳到选中项所在的页
  if (opts.selectedIndex >= 0 && usePaging) {
    currentPage = Math.floor(opts.selectedIndex / PAGE_SIZE);
  }

  // 列表容器
  const listEl = document.createElement('div');
  listEl.className = 'editor-list-form__items';
  listSide.appendChild(listEl);

  // 分页栏
  let pager = null;
  if (usePaging) {
    pager = document.createElement('div');
    pager.className = 'editor-list-form__pager';
    listSide.appendChild(pager);
  }

  function renderItems() {
    listEl.innerHTML = '';

    // 1. 过滤（按 query）
    let filtered = opts.items.map((item, originalIndex) => ({ item, originalIndex }));
    if (searchQuery) {
      filtered = filtered.filter(({ item }) => {
        const label = opts.getLabel(item).toLowerCase();
        if (label.includes(searchQuery)) return true;
        // 可选：从 item.id / item.name / item.tags 搜
        if (item.id && String(item.id).toLowerCase().includes(searchQuery)) return true;
        if (item.tags && item.tags.some(t => String(t).toLowerCase().includes(searchQuery))) return true;
        return false;
      });
    }

    // 2. 分页
    let displayed = filtered;
    if (usePaging && !searchQuery) {
      const start = currentPage * PAGE_SIZE;
      displayed = filtered.slice(start, start + PAGE_SIZE);
    }

    // 3. 空态
    if (displayed.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'editor-list-form__no-match';
      empty.textContent = searchQuery ? `无匹配："${searchQuery}"` : '（空列表）';
      listEl.appendChild(empty);
    }

    // 4. 渲染行
    for (const { item, originalIndex } of displayed) {
      const row = document.createElement('div');
      row.className = `editor-list-form__item${originalIndex === opts.selectedIndex ? ' active' : ''}`;
      row.innerHTML = `<span>${opts.getLabel(item)}</span>`;
      const delBtn = document.createElement('button');
      delBtn.className = 'editor-list-form__del';
      delBtn.textContent = '×';
      delBtn.title = '删除';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`删除 "${opts.getLabel(item)}"？`)) opts.onDelete(originalIndex);
      });
      row.appendChild(delBtn);
      row.addEventListener('click', () => opts.onSelect(originalIndex));
      listEl.appendChild(row);
    }

    // 5. 分页栏（仅在不搜索时显示）
    if (pager) {
      pager.innerHTML = '';
      if (!searchQuery && usePaging) {
        const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
        const prev = document.createElement('button');
        prev.className = 'btn btn--small';
        prev.textContent = '←';
        prev.disabled = currentPage === 0;
        prev.addEventListener('click', () => { currentPage--; renderItems(); });
        const next = document.createElement('button');
        next.className = 'btn btn--small';
        next.textContent = '→';
        next.disabled = currentPage >= totalPages - 1;
        next.addEventListener('click', () => { currentPage++; renderItems(); });
        const label = document.createElement('span');
        label.className = 'editor-list-form__pager-label';
        label.textContent = `第 ${currentPage + 1} / ${totalPages} 页（共 ${opts.items.length}）`;
        pager.appendChild(prev);
        pager.appendChild(label);
        pager.appendChild(next);
      } else if (searchQuery) {
        const label = document.createElement('span');
        label.className = 'editor-list-form__pager-label';
        label.textContent = `匹配 ${filtered.length} / ${opts.items.length}`;
        pager.appendChild(label);
      }
    }
  }

  renderItems();

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
