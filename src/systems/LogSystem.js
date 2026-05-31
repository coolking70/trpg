/**
 * 日志系统
 *
 * 收集游戏运行期间的完整记录，随时生成可导出的诊断报告。
 * 适用场景：bug 报告 / 玩法回顾 / 开发调试 / 分享给作者。
 *
 * 收集内容：
 *   1. 元数据（版本、时间戳、用户配置摘要）
 *   2. 完整 gameState 快照
 *   3. 所有叙事日志（GM/玩家/系统）
 *   4. 战斗历史日志
 *   5. 骰子历史
 *   6. AI 调用 token 统计
 *   7. 长期记忆（worldFacts + keyEvents）
 *   8. 错误/警告日志（环形缓冲 100 条）
 *   9. 当前预设元数据
 *
 * 导出格式：JSON（默认）或 Markdown（人类可读）
 */

import { GameSystem } from '../core/GameEngine.js';

const ERROR_LOG_LIMIT = 100;

export class LogSystem extends GameSystem {
  constructor() {
    super('LogSystem');
    /** @type {Array<{level, ts, message, source?}>} 环形错误日志缓冲 */
    this.errorLog = [];
    this._originalConsole = null;
    this._installed = false;
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this._installConsoleIntercept();
  }

  /**
   * 拦截 console.error / console.warn 进入环形缓冲
   * （保留原 console 调用，不干扰开发者工具显示）
   */
  _installConsoleIntercept() {
    if (this._installed) return;
    if (typeof console === 'undefined') return;

    this._originalConsole = {
      error: console.error,
      warn: console.warn,
    };

    const capture = (level) => (...args) => {
      // 调原始 console，保持开发者工具体验
      this._originalConsole[level].apply(console, args);
      // 写入环形缓冲
      this._appendError({
        level,
        ts: new Date().toISOString(),
        message: args.map(a => this._safeStringify(a)).join(' '),
      });
    };

    console.error = capture('error');
    console.warn = capture('warn');
    this._installed = true;
  }

  /** 卸载拦截器（用于测试） */
  uninstallConsoleIntercept() {
    if (!this._installed || !this._originalConsole) return;
    console.error = this._originalConsole.error;
    console.warn = this._originalConsole.warn;
    this._installed = false;
  }

  _safeStringify(val) {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'string') return val;
    if (val instanceof Error) return val.message || String(val);
    try { return JSON.stringify(val); } catch { return String(val); }
  }

  _appendError(entry) {
    this.errorLog.push(entry);
    while (this.errorLog.length > ERROR_LOG_LIMIT) this.errorLog.shift();
  }

  /** 清空错误日志 */
  clearErrorLog() {
    this.errorLog = [];
  }

  /**
   * 生成完整诊断报告（JSON 对象）
   * @param {object} gameState - 当前游戏状态
   * @param {object} [preset] - 当前预设（可选）
   * @returns {object} 完整报告
   */
  generateReport(gameState, preset = null) {
    const aiEngine = this.gameEngine ? this.gameEngine.getSystem('AIGMEngine') : null;

    return {
      meta: {
        generatedAt: new Date().toISOString(),
        version: '1.0.0',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        viewportSize: typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : 'unknown',
      },
      preset: preset ? {
        id: preset.presetId,
        name: preset.name,
        version: preset.version,
        characterCount: (preset.characters || []).length,
        enemyCount: (preset.enemies || []).length,
        eventCount: (preset.events || []).length,
        itemCount: (preset.items || []).length,
        mapSize: preset.map ? `${preset.map.width}×${preset.map.height}` : null,
      } : null,
      gameState: gameState ? {
        turnNumber: gameState.turnNumber,
        currentPhase: gameState.currentPhase,
        gold: gameState.gold,
        playerPosition: gameState.mapState ? gameState.mapState.playerPosition : null,
        completedEventIds: gameState.completedEventIds || [],
        variables: gameState.variables || {},
        activeCharacters: (gameState.activeCharacters || []).map(c => ({
          id: c.id, name: c.name, level: c.level || 1, experience: c.experience || 0,
          isCompanion: !!c._isCompanion,
          stats: c.stats, inventory: c.inventory, equipment: c.equipment,
          statusEffects: c.statusEffects,
        })),
        activeCombat: gameState.activeCombat ? {
          round: gameState.activeCombat.round,
          currentActorIndex: gameState.activeCombat.currentActorIndex,
          enemies: gameState.activeCombat.enemies.map(e => ({
            id: e.id, name: e.name, hpCurrent: e.stats.hpCurrent, hpMax: e.stats.hp,
          })),
          turnOrder: gameState.activeCombat.turnOrder,
          logEntryCount: (gameState.activeCombat.log || []).length,
        } : null,
        activeEvent: gameState.activeEvent ? gameState.activeEvent.id : null,
      } : null,
      narrativeLog: gameState && gameState.narrativeLog ? gameState.narrativeLog : [],
      diceHistory: gameState && gameState.diceHistory ? gameState.diceHistory : [],
      aiContext: gameState && gameState.aiContext ? {
        worldFacts: gameState.aiContext.worldFacts || [],
        keyEvents: gameState.aiContext.keyEvents || [],
        recentMessages: gameState.aiContext.recentMessages || [],
      } : null,
      tokenStats: aiEngine ? aiEngine.getTokenStats() : null,
      errorLog: this.errorLog.slice(),  // 副本
    };
  }

  /**
   * 转换为 Markdown 格式（人类可读，适合 bug 报告）
   */
  generateMarkdown(gameState, preset = null) {
    const r = this.generateReport(gameState, preset);
    const lines = [];
    lines.push(`# TRPG AI 跑团 — 诊断日志`);
    lines.push(`*生成时间: ${r.meta.generatedAt}*\n`);

    // 元数据
    lines.push(`## 环境\n`);
    lines.push(`- 版本: ${r.meta.version}`);
    lines.push(`- 视口: ${r.meta.viewportSize}`);
    lines.push(`- UA: \`${r.meta.userAgent}\`\n`);

    // 预设
    if (r.preset) {
      lines.push(`## 当前预设\n`);
      lines.push(`- 名称: **${r.preset.name}** (ID: \`${r.preset.id}\`)`);
      lines.push(`- 内容: ${r.preset.characterCount} 角色 / ${r.preset.enemyCount} 敌人 / ${r.preset.eventCount} 事件 / ${r.preset.itemCount} 物品`);
      lines.push(`- 地图: ${r.preset.mapSize}\n`);
    }

    // 游戏状态
    if (r.gameState) {
      lines.push(`## 游戏状态\n`);
      lines.push(`- 回合: ${r.gameState.turnNumber} / 阶段: ${r.gameState.currentPhase} / 金币: ${r.gameState.gold}`);
      lines.push(`- 玩家位置: (${r.gameState.playerPosition?.x}, ${r.gameState.playerPosition?.y})`);
      lines.push(`- 已完成事件: ${r.gameState.completedEventIds.length} 个`);
      lines.push(`- 全局变量: \`${JSON.stringify(r.gameState.variables)}\`\n`);

      lines.push(`### 角色\n`);
      for (const c of r.gameState.activeCharacters) {
        const companionLabel = c.isCompanion ? ' (同行)' : '';
        lines.push(`- **${c.name}**${companionLabel} Lv.${c.level} XP:${c.experience} — HP ${c.stats.hpCurrent}/${c.stats.hp} MP ${c.stats.mpCurrent}/${c.stats.mp}`);
      }
      lines.push('');

      if (r.gameState.activeCombat) {
        lines.push(`### 当前战斗（第 ${r.gameState.activeCombat.round} 轮）\n`);
        for (const e of r.gameState.activeCombat.enemies) {
          lines.push(`- ${e.name} (${e.id}): HP ${e.hpCurrent}/${e.hpMax}`);
        }
        lines.push('');
      }
    }

    // 长期记忆
    if (r.aiContext) {
      lines.push(`## AI 长期记忆\n`);
      if (r.aiContext.worldFacts.length) {
        lines.push(`### World Facts (${r.aiContext.worldFacts.length})`);
        for (const f of r.aiContext.worldFacts) lines.push(`- ${f}`);
        lines.push('');
      }
      if (r.aiContext.keyEvents.length) {
        lines.push(`### Key Events (${r.aiContext.keyEvents.length})`);
        for (const e of r.aiContext.keyEvents) {
          lines.push(`- ${e.summary || e}`);
        }
        lines.push('');
      }
    }

    // Token 统计
    if (r.tokenStats) {
      lines.push(`## AI Token 用量\n`);
      lines.push(`- 总调用: ${r.tokenStats.totalCalls} 次`);
      lines.push(`- 总 tokens: ${r.tokenStats.totalTokens} (prompt: ${r.tokenStats.totalPromptTokens}, completion: ${r.tokenStats.totalCompletionTokens})`);
      lines.push(`- 平均/次: ${r.tokenStats.averagePerCall}\n`);
    }

    // 叙事日志
    if (r.narrativeLog && r.narrativeLog.length) {
      lines.push(`## 叙事日志（共 ${r.narrativeLog.length} 条）\n`);
      const labels = { gm: 'GM', player: '你', system: '系统' };
      for (const n of r.narrativeLog) {
        lines.push(`**[${labels[n.speaker] || n.speaker}]** ${n.text}`);
        lines.push('');
      }
    }

    // 骰子历史
    if (r.diceHistory && r.diceHistory.length) {
      lines.push(`## 骰子历史（共 ${r.diceHistory.length} 次）\n`);
      for (const d of r.diceHistory.slice(-20)) {  // 仅最后 20 次
        const result = d.target !== undefined
          ? `${d.total} vs DC ${d.target} → ${d.success ? '✓' : '✗'}`
          : `${d.total}`;
        lines.push(`- \`${d.formula}\` = ${result} ${d.reason ? `(${d.reason})` : ''}`);
      }
      lines.push('');
    }

    // 错误日志
    if (r.errorLog && r.errorLog.length) {
      lines.push(`## 错误日志（最近 ${r.errorLog.length} 条）\n`);
      lines.push('```');
      for (const e of r.errorLog.slice(-30)) {
        lines.push(`[${e.level.toUpperCase()}] ${e.ts}: ${e.message.substring(0, 200)}`);
      }
      lines.push('```');
    }

    return lines.join('\n');
  }

  /**
   * 触发浏览器下载诊断文件
   * @param {object} gameState
   * @param {'json'|'markdown'} format
   */
  exportToFile(gameState, format = 'json', preset = null) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;

    let content, mime, ext;
    if (format === 'markdown') {
      content = this.generateMarkdown(gameState, preset);
      mime = 'text/markdown;charset=utf-8';
      ext = 'md';
    } else {
      content = JSON.stringify(this.generateReport(gameState, preset), null, 2);
      mime = 'application/json;charset=utf-8';
      ext = 'json';
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    a.href = url;
    a.download = `trpg-log-${ts}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }

  destroy() {
    this.uninstallConsoleIntercept();
    super.destroy();
  }
}
