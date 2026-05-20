/**
 * 动态难度跟踪器
 *
 * 跟踪最近 N 场战斗的表现，计算挑战分数（-1 ~ +1），
 * 在每次战斗启动前给敌人施加额外修正。
 *
 * 设计原则：
 * - 不取代静态难度（easy/normal/hard），而是在其之上微调
 * - 修正幅度温和（±15% HP, ±1 ATK）避免突变
 * - 玩家通过沉浸式叙事感知（"敌人似乎更凶猛"），不直接看到数值
 */

import { GameSystem } from '../core/GameEngine.js';

const WINDOW_SIZE = 5;       // 跟踪最近多少场
const HP_RATIO_GOOD = 0.7;   // HP 保留 70%+ 视为轻松
const HP_RATIO_HARD = 0.3;   // HP 保留 30%- 视为艰难
const ROUNDS_QUICK = 3;      // 3 回合内结束 = 碾压
const ROUNDS_LONG = 8;       // 8 回合 = 持久战

export class DifficultyTracker extends GameSystem {
  constructor() {
    super('DifficultyTracker');
    /** @type {Array<{result, hpRatio, rounds}>} */
    this.history = [];
    /** @type {boolean} 当前是否启用动态难度（默认开） */
    this.enabled = true;
  }

  /**
   * 记录一场战斗的表现
   * @param {object} record - { result: 'victory'/'defeat'/'flee', hpRatio: 0-1, rounds: number }
   */
  recordCombat(record) {
    this.history.push({
      result: record.result,
      hpRatio: record.hpRatio,
      rounds: record.rounds || 1,
      ts: Date.now(),
    });
    while (this.history.length > WINDOW_SIZE) this.history.shift();
  }

  /**
   * 计算挑战分数
   * @returns {number} -1 ~ +1（负=玩家挣扎，正=玩家碾压）
   */
  computeChallengeScore() {
    if (this.history.length === 0) return 0;

    let score = 0;
    for (const r of this.history) {
      if (r.result === 'defeat') score -= 0.6;
      else if (r.result === 'flee') score -= 0.2;
      else if (r.result === 'victory') {
        if (r.hpRatio >= HP_RATIO_GOOD) score += 0.3;
        else if (r.hpRatio <= HP_RATIO_HARD) score -= 0.3;
        if (r.rounds <= ROUNDS_QUICK) score += 0.2;
        else if (r.rounds >= ROUNDS_LONG) score -= 0.2;
      }
    }

    score /= this.history.length;
    return Math.max(-1, Math.min(1, score));
  }

  /**
   * 根据挑战分数返回动态修正系数
   * @returns {{hpMul: number, atkDelta: number, narrativeHint: string|null}}
   */
  getDynamicModifier() {
    if (!this.enabled) return { hpMul: 1, atkDelta: 0, narrativeHint: null };
    const score = this.computeChallengeScore();

    // 玩家挣扎 → 削弱敌人
    if (score <= -0.3) {
      return {
        hpMul: 0.85, atkDelta: -1,
        narrativeHint: '空气中似乎有一丝倾向你们的气息——敌人显得没那么可怕了。',
      };
    }
    // 玩家碾压 → 增强敌人
    if (score >= 0.3) {
      return {
        hpMul: 1.15, atkDelta: 1,
        narrativeHint: '森林中弥漫着不安的低语，新出现的敌人显得格外凶悍。',
      };
    }
    return { hpMul: 1, atkDelta: 0, narrativeHint: null };
  }

  /** 返回当前跟踪状态（调试用） */
  getSnapshot() {
    return {
      enabled: this.enabled,
      historyCount: this.history.length,
      challengeScore: this.computeChallengeScore(),
      modifier: this.getDynamicModifier(),
    };
  }

  /** 重置历史（新游戏时调用） */
  reset() {
    this.history = [];
  }

  setEnabled(v) { this.enabled = !!v; }
}
