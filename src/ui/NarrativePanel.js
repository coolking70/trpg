/**
 * 叙事面板
 * 显示AI GM叙事日志、玩家操作记录和系统消息
 * 底部有玩家输入框
 */

export class NarrativePanel {
  constructor(containerElement, eventSystem) {
    this.container = containerElement;
    this.eventSystem = eventSystem;

    this._logArea = null;
    this._inputField = null;
    this._sendBtn = null;
    this._loadingEl = null;
    this._disabled = false;
    this._lastGameId = null;
  }

  render() {
    this.container.innerHTML = '';

    // 日志区域
    this._logArea = document.createElement('div');
    this._logArea.className = 'narrative__log';
    this.container.appendChild(this._logArea);

    // 输入区域
    const inputRow = document.createElement('div');
    inputRow.className = 'narrative__input-row';

    this._inputField = document.createElement('input');
    this._inputField.type = 'text';
    this._inputField.className = 'input narrative__input';
    this._inputField.placeholder = '输入你的行动...';
    this._inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._sendAction();
    });

    this._sendBtn = document.createElement('button');
    this._sendBtn.className = 'btn btn--primary narrative__send';
    this._sendBtn.textContent = '发送';
    this._sendBtn.addEventListener('click', () => this._sendAction());

    inputRow.appendChild(this._inputField);
    inputRow.appendChild(this._sendBtn);
    this.container.appendChild(inputRow);
  }

  update(gameState) {
    if (!gameState || !this._logArea) return;

    // 同步叙事日志
    const log = gameState.narrativeLog || [];
    const gameChanged = this._lastGameId && this._lastGameId !== gameState.gameId;
    this._lastGameId = gameState.gameId || null;

    // 仅追加新消息（排除loading指示器的DOM节点）
    let currentCount = this._logArea.children.length;
    if (this._loadingEl && this._loadingEl.parentNode === this._logArea) {
      currentCount--;
    }

    // 新游戏会创建更短的新 narrativeLog。旧实现只追加，导致上一局 DOM 残留。
    if (gameChanged || currentCount > log.length) {
      const loading = this._loadingEl;
      this._logArea.innerHTML = '';
      if (loading) this._logArea.appendChild(loading);
      currentCount = 0;
    }

    for (let i = currentCount; i < log.length; i++) {
      const msg = this._createMessageEl(log[i].speaker, log[i].text);
      // 在loading指示器之前插入新消息
      if (this._loadingEl && this._loadingEl.parentNode === this._logArea) {
        this._logArea.insertBefore(msg, this._loadingEl);
      } else {
        this._logArea.appendChild(msg);
      }
    }
    this._logArea.scrollTop = this._logArea.scrollHeight;
  }

  /**
   * 手动添加一条消息
   * @param {string} speaker - 'gm' | 'player' | 'system'
   * @param {string} text
   */
  addMessage(speaker, text) {
    this._appendMessage(speaker, text);
  }

  _createMessageEl(speaker, text) {
    const msg = document.createElement('div');
    msg.className = `narrative__message narrative__message--${speaker}`;

    // 警告/错误类系统消息加视觉强调
    const isWarning = speaker === 'system' && /⚠|失败|错误|GM\s*失联/.test(text);
    if (isWarning) msg.classList.add('narrative__message--warning');

    const label = document.createElement('span');
    label.className = 'narrative__speaker';
    const speakerLabels = { gm: 'GM', player: '你', system: '系统' };
    label.textContent = speakerLabels[speaker] || speaker;

    const content = document.createElement('span');
    content.className = 'narrative__text';
    content.textContent = text;

    msg.appendChild(label);
    msg.appendChild(content);
    return msg;
  }

  _appendMessage(speaker, text) {
    if (!this._logArea) return;
    const msg = this._createMessageEl(speaker, text);
    this._logArea.appendChild(msg);
    this._logArea.scrollTop = this._logArea.scrollHeight;
  }

  /**
   * 设置禁用状态（锁定期间禁止输入和发送）
   * @param {boolean} disabled
   */
  setDisabled(disabled) {
    this._disabled = disabled;
    if (this._inputField) {
      this._inputField.disabled = disabled;
    }
    if (this._sendBtn) {
      this._sendBtn.disabled = disabled;
    }
  }

  /** 显示GM思考中加载指示器 */
  showLoading() {
    if (!this._logArea || this._loadingEl) return;

    this._loadingEl = document.createElement('div');
    this._loadingEl.className = 'narrative__loading';
    this._loadingEl.innerHTML = '<span class="narrative__loading-dot"></span> GM正在思考...';
    this._logArea.appendChild(this._loadingEl);
    this._logArea.scrollTop = this._logArea.scrollHeight;
  }

  /** 隐藏GM思考中加载指示器 */
  hideLoading() {
    if (this._loadingEl && this._loadingEl.parentNode) {
      this._loadingEl.parentNode.removeChild(this._loadingEl);
    }
    this._loadingEl = null;
  }

  _sendAction() {
    if (!this._inputField || this._disabled) return;
    const text = this._inputField.value.trim();
    if (!text) return;

    this._inputField.value = '';
    this._appendMessage('player', text);
    this.eventSystem.publish('player:action', { text });
  }

  destroy() {
    this.container.innerHTML = '';
  }
}
