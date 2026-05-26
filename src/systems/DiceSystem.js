/**
 * 骰子系统
 * 负责骰子公式解析、投掷逻辑和判定检查
 * 支持完整DND骰子套装 D4/D6/D8/D10/D12/D20
 */

import { GameSystem } from '../core/GameEngine.js';

export class DiceSystem extends GameSystem {
  constructor() {
    super('DiceSystem');
  }

  /**
   * 解析骰子公式
   * 支持格式：
   *   - 标准: NdM, NdM+K, NdM-K, d20, 2d6+3
   *   - 多项: d20+5-2+3（任意 ±K 链）
   *   - 容错: (attack+1d20)-defense  → 括号被剥离，未知字母标识被当作 0
   *
   * @param {string} formula - 骰子公式
   * @returns {{ count: number, sides: number, modifier: number }}
   */
  parseFormula(formula) {
    let cleaned = formula.replace(/\s/g, '').toLowerCase();
    // 1. 剥离括号（语义上多余）
    cleaned = cleaned.replace(/[()]/g, '');
    // 2. 把未知字母标识符（如 attack/def/atk/strength/magicattack）替换为 0
    //    — 因为这些应该由调用方在传入前替换为数字；落到这里说明被遗漏，宽容为 0
    //    保留 d 作为骰子分隔符（前后是数字）
    //    分两步：先把"非紧邻数字的字母序列"换成 0，再把"+0/-0"清掉
    cleaned = cleaned.replace(/(?<![0-9])[a-z][a-z_]*(?![0-9])/g, (m) => {
      // 'd' 不能被替换 — 但它后面必须紧跟数字才是骰子；裸 d 也兜底为 0
      return m === 'd' ? '0' : '0';
    });
    cleaned = cleaned.replace(/([+-])0(?=[+-]|$)/g, '');
    // 剥离前导 0+ / +0 / 0-（变量被替换为 0 后留下的痕迹）
    cleaned = cleaned.replace(/^0([+-])/, '$1');
    if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
    if (cleaned === '' || cleaned === '0') {
      // 没有骰子部分；返回纯 modifier 0
      return { count: 0, sides: 0, modifier: 0 };
    }
    // 3. 支持任意数量的 +K / -K 修正符
    const match = cleaned.match(/^(\d*)d(\d+)((?:[+-]\d+)*)$/);
    if (!match) {
      // 兜底：尝试当作纯数字 modifier
      const numOnly = cleaned.match(/^([+-]?\d+)((?:[+-]\d+)*)$/);
      if (numOnly) {
        const parts = (cleaned.match(/[+-]?\d+/g) || []).map(p => parseInt(p, 10));
        return { count: 0, sides: 0, modifier: parts.reduce((a, b) => a + b, 0) };
      }
      throw new Error(`无效的骰子公式: ${formula}`);
    }
    let modifier = 0;
    if (match[3]) {
      const parts = match[3].match(/[+-]\d+/g) || [];
      for (const p of parts) modifier += parseInt(p, 10);
    }
    return {
      count: match[1] ? parseInt(match[1]) : 1,
      sides: parseInt(match[2]),
      modifier,
    };
  }

  /**
   * 投掷骰子
   * @param {string} formula - 骰子公式，如 "2d6+3"、"d20"
   * @returns {DiceResult}
   */
  roll(formula) {
    const parsed = this.parseFormula(formula);
    const rolls = [];
    for (let i = 0; i < parsed.count; i++) {
      rolls.push(Math.floor(Math.random() * parsed.sides) + 1);
    }
    const subtotal = rolls.reduce((a, b) => a + b, 0);
    const total = subtotal + parsed.modifier;

    return {
      formula,
      sides: parsed.sides,
      count: parsed.count,
      rolls,
      modifier: parsed.modifier,
      subtotal,
      total,
      timestamp: Date.now(),
    };
  }

  /**
   * 投掷骰子并进行判定检查
   * @param {string} formula - 骰子公式
   * @param {number} targetNumber - 目标数（DC）
   * @returns {DiceResult & { target: number, success: boolean }}
   */
  rollCheck(formula, targetNumber) {
    const result = this.roll(formula);
    result.target = targetNumber;
    result.success = result.total >= targetNumber;
    return result;
  }

  /**
   * 投掷带优势/劣势的d20
   * @param {string} type - 'advantage' | 'disadvantage' | 'normal'
   * @param {number} modifier - 修正值
   * @returns {DiceResult}
   */
  rollD20(type = 'normal', modifier = 0) {
    if (type === 'advantage') {
      const r1 = this.roll('d20');
      const r2 = this.roll('d20');
      const best = r1.rolls[0] >= r2.rolls[0] ? r1 : r2;
      best.modifier = modifier;
      best.total = best.subtotal + modifier;
      best.rolls = [r1.rolls[0], r2.rolls[0]];
      best.advantageType = 'advantage';
      return best;
    } else if (type === 'disadvantage') {
      const r1 = this.roll('d20');
      const r2 = this.roll('d20');
      const worst = r1.rolls[0] <= r2.rolls[0] ? r1 : r2;
      worst.modifier = modifier;
      worst.total = worst.subtotal + modifier;
      worst.rolls = [r1.rolls[0], r2.rolls[0]];
      worst.advantageType = 'disadvantage';
      return worst;
    }

    const result = this.roll(`d20${modifier >= 0 ? '+' + modifier : modifier}`);
    result.advantageType = 'normal';
    return result;
  }

  /**
   * 快速投掷指定面数的单个骰子
   * @param {number} sides - 面数
   * @returns {number}
   */
  quickRoll(sides) {
    return Math.floor(Math.random() * sides) + 1;
  }

  /**
   * 计算公式表达式（简单的数学运算+骰子变量替换）
   * 支持: "attack * 1.5 + d6"
   * @param {string} expression - 表达式
   * @param {object} variables - 变量映射 { attack: 15, defense: 10 }
   * @returns {{ result: number, details: string }}
   */
  evaluateExpression(expression, variables = {}) {
    let details = expression;
    let expr = expression;

    // 替换变量
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\b${key}\\b`, 'g');
      expr = expr.replace(regex, value);
      details = details.replace(regex, `${key}(${value})`);
    }

    // 替换骰子表达式
    const diceRegex = /(\d*)d(\d+)/g;
    expr = expr.replace(diceRegex, (match, count, sides) => {
      const n = count ? parseInt(count) : 1;
      const s = parseInt(sides);
      const result = this.roll(`${n}d${s}`);
      details = details.replace(match, `${match}[${result.rolls.join(',')}=${result.subtotal}]`);
      return result.subtotal;
    });

    // 安全计算（使用Function替代eval，限制作用域）
    try {
      const result = new Function(`return (${expr})`)();
      return { result: Math.floor(result), details };
    } catch (e) {
      console.error('表达式计算失败:', expression, e);
      return { result: 0, details: `错误: ${expression}` };
    }
  }
}
