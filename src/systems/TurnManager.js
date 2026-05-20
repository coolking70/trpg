/**
 * 回合管理器
 * 管理游戏的阶段流转：探索 → 事件 → 战斗 → 休息
 */

import { GameSystem } from '../core/GameEngine.js';

/** 游戏阶段枚举 */
export const PHASES = {
  EXPLORATION: 'exploration',
  EVENT: 'event',
  COMBAT: 'combat',
  REST: 'rest',
};

export class TurnManager extends GameSystem {
  constructor() {
    super('TurnManager');
    this.eventSystem = null;
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.eventSystem = gameEngine.getSystem('EventSystem');
  }

  /**
   * 开始新回合
   * @param {object} gameState
   */
  startTurn(gameState) {
    gameState.turnNumber++;
    gameState.currentPhase = PHASES.EXPLORATION;

    if (this.eventSystem) {
      this.eventSystem.publish('turn:start', {
        turnNumber: gameState.turnNumber,
        phase: gameState.currentPhase,
      });
    }
  }

  /**
   * 切换到指定阶段
   * @param {object} gameState
   * @param {string} phase
   */
  changePhase(gameState, phase) {
    const oldPhase = gameState.currentPhase;
    gameState.currentPhase = phase;

    if (this.eventSystem) {
      this.eventSystem.publish('turn:phaseChange', {
        from: oldPhase,
        to: phase,
        turnNumber: gameState.turnNumber,
      });
    }
  }

  /**
   * 结束当前回合
   * @param {object} gameState
   */
  endTurn(gameState) {
    // 处理回合结束效果（如持续伤害、buff倒计时等）
    this.processEndOfTurnEffects(gameState);

    if (this.eventSystem) {
      this.eventSystem.publish('turn:end', {
        turnNumber: gameState.turnNumber,
      });
    }
  }

  /**
   * 处理回合结束效果
   * @param {object} gameState
   */
  processEndOfTurnEffects(gameState) {
    for (const char of gameState.activeCharacters) {
      if (!char.statusEffects) continue;

      // 倒计时并移除过期效果
      char.statusEffects = char.statusEffects.filter(effect => {
        if (effect.duration !== undefined) {
          effect.duration--;
          if (effect.duration <= 0) return false;
        }

        // 处理持续效果
        if (effect.type === 'dot') {
          char.stats.hpCurrent = Math.max(0, char.stats.hpCurrent - (effect.value || 0));
        } else if (effect.type === 'hot') {
          char.stats.hpCurrent = Math.min(char.stats.hp, char.stats.hpCurrent + (effect.value || 0));
        }

        return true;
      });
    }
  }

  /**
   * 获取当前阶段
   * @param {object} gameState
   * @returns {string}
   */
  getCurrentPhase(gameState) {
    return gameState ? gameState.currentPhase : PHASES.EXPLORATION;
  }

  destroy() {
    this.eventSystem = null;
    super.destroy();
  }
}
