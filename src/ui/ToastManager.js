/**
 * Toast 管理器
 * 订阅常见错误事件，弹出短暂提示后自动消失
 * 用于替代当前"硬塞进叙事日志"的错误提示方式
 */

import './ToastManager.css';

const TOAST_LIFETIME = 4000;

export class ToastManager {
  constructor(containerElement, eventSystem) {
    this.container = containerElement;
    this.eventSystem = eventSystem;

    this._stack = document.createElement('div');
    this._stack.className = 'toast-stack';
    this.container.appendChild(this._stack);

    this._subIds = [];
    this._bindEvents();
  }

  _bindEvents() {
    // AI 错误
    this._subscribe('ai:error', (evt) => {
      this.show({
        type: 'error',
        icon: '⚠',
        title: 'GM 失联',
        msg: evt.data?.error || '未知错误',
      });
    });

    // 存档错误（如果发布过 save:error）
    this._subscribe('save:error', (evt) => {
      this.show({
        type: 'error',
        icon: '💾',
        title: '存档失败',
        msg: evt.data?.error || '无法写入 localStorage',
      });
    });

    // 自动存档成功（轻量提示）
    this._subscribe('save:autoSaved', () => {
      this.show({
        type: 'info',
        icon: '💾',
        msg: '已自动存档',
        lifetime: 2000,
      });
    });

    // 角色升级（明显的庆祝 toast）
    this._subscribe('character:levelUp', (evt) => {
      this.show({
        type: 'success',
        icon: '🎉',
        title: `${evt.data.characterName} 升到 Lv.${evt.data.toLevel}！`,
        msg: '属性已增长，HP/MP 已全恢复',
        lifetime: 5000,
      });
    });
  }

  _subscribe(eventType, callback) {
    const id = this.eventSystem.subscribe(eventType, callback);
    this._subIds.push({ type: eventType, id });
  }

  /**
   * 弹出一个 toast
   * @param {object} opts - {type:'error'|'info'|'success', icon, title, msg, lifetime}
   */
  show({ type = 'info', icon = '💬', title = '', msg = '', lifetime = TOAST_LIFETIME }) {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
      <div class="toast__icon">${icon}</div>
      <div class="toast__body">
        ${title ? `<div class="toast__title">${title}</div>` : ''}
        ${msg ? `<div class="toast__msg">${msg}</div>` : ''}
      </div>
      <button class="toast__close" aria-label="关闭">×</button>
    `;
    toast.querySelector('.toast__close').addEventListener('click', () => this._dismiss(toast));

    this._stack.appendChild(toast);

    // 入场动画 trigger
    requestAnimationFrame(() => toast.classList.add('toast--in'));

    // 自动消失
    setTimeout(() => this._dismiss(toast), lifetime);
  }

  _dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.remove('toast--in');
    toast.classList.add('toast--out');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }

  destroy() {
    this._subIds.forEach(({ type, id }) => this.eventSystem.unsubscribe(type, id));
    this._subIds = [];
    if (this._stack && this._stack.parentNode) this._stack.parentNode.removeChild(this._stack);
    this._stack = null;
  }
}
