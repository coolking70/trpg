/**
 * 骰子动画覆盖层
 * 管理3D骰子渲染器的显示和隐藏
 */

import { DiceRenderer } from '../rendering/DiceRenderer.js';

export class DiceOverlay {
  constructor(containerElement, eventSystem) {
    this.container = containerElement;
    this.eventSystem = eventSystem;
    this.diceRenderer = new DiceRenderer(containerElement);
    this.isVisible = false;
  }

  /**
   * 显示骰子动画
   * @param {object} diceResult - 骰子结果对象
   */
  async show(diceResult) {
    if (this.isVisible) return;
    this.isVisible = true;
    await this.diceRenderer.animateRoll(diceResult);
    this.isVisible = false;
  }

  /** 隐藏骰子 */
  hide() {
    this.diceRenderer.stopAnimation();
    this.container.classList.remove('active');
    this.isVisible = false;
  }

  destroy() {
    this.diceRenderer.destroy();
  }
}
