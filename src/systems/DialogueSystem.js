/**
 * 对话系统（Phase 20B）
 *
 * 解析 NPC 的 dialogueTree，提供节点跳转 / 选项过滤 / 效果应用。
 *
 * 树结构：
 *   {
 *     root: { speaker: 'self'|'player', text, branches: [...], onEnter?: [...effects] },
 *     <nodeId>: { speaker, text, branches, onEnter? },
 *     ...
 *   }
 *
 * branches 每项：
 *   {
 *     text: '玩家选项文本',
 *     next: '下一个节点 id'（不写则结束当前对话）,
 *     requireTags / requireAnyTags / requireNoTags: ...,  // 玩家 tag 过滤
 *     requireAffection: 50,                                // 需要 affection >= N
 *     requireVariables / requireWorldFlags: ...,
 *     hidden?: boolean,                                    // hidden=true 时不满足条件直接消失
 *     affectionDelta: +5,                                  // 选后改 affection
 *     effects: [...],                                      // 选后应用任意 effect
 *     exit: true,                                          // 选后直接退出对话
 *   }
 *
 * 当前对话状态写入 gameState.activeDialogue：
 *   { npcId, currentNode }
 */

import { GameSystem } from '../core/GameEngine.js';

export class DialogueSystem extends GameSystem {
  constructor() {
    super('DialogueSystem');
  }

  /**
   * 开启与 NPC 的对话（设置 activeDialogue）
   * @returns 节点视图（含可见 branches），找不到 NPC / 树 返回 null
   */
  start(gameState, npcId) {
    const npcSystem = this.getSystem('NPCSystem');
    const npc = npcSystem?.getNPC(npcId);
    if (!npc) return null;
    if (!npc.dialogueTree || !npc.dialogueTree.root) return null;

    gameState.activeDialogue = { npcId, currentNode: 'root' };
    return this.getCurrentView(gameState);
  }

  /**
   * 取当前节点的渲染视图：
   *   {
   *     npcId, npcName,
   *     speaker: 'self'|'player', text,
   *     branches: [{ index, text, disabled, hidden, reason }, ...],
   *   }
   * 不在对话中返回 null
   */
  getCurrentView(gameState) {
    const dlg = gameState.activeDialogue;
    if (!dlg) return null;
    const npcSystem = this.getSystem('NPCSystem');
    const npc = npcSystem?.getNPC(dlg.npcId);
    if (!npc) return null;
    const tree = npc.dialogueTree;
    const node = tree?.[dlg.currentNode];
    if (!node) return null;

    const npcState = npcSystem.getNPCState(gameState, dlg.npcId) || {};
    const branches = (node.branches || []).map((b, index) => {
      const check = this._evaluateBranch(b, gameState, npcState);
      return {
        index,
        text: b.text,
        disabled: !check.ok,
        hidden: b.hidden && !check.ok,
        reason: check.reason || null,
      };
    });

    return {
      npcId: dlg.npcId,
      npcName: npc.name,
      npcIcon: npc.icon || '🧑',
      speaker: node.speaker === 'player' ? 'player' : 'self',
      text: node.text || '',
      branches,
    };
  }

  /**
   * 选择某个分支
   * @returns 'continue'|'exit'|'error'
   *   - continue: 跳到下一节点（继续 getCurrentView）
   *   - exit: 对话结束（清掉 activeDialogue）
   */
  choose(gameState, branchIndex) {
    const dlg = gameState.activeDialogue;
    if (!dlg) return 'error';
    const npcSystem = this.getSystem('NPCSystem');
    const npc = npcSystem?.getNPC(dlg.npcId);
    if (!npc) return 'error';
    const node = npc.dialogueTree?.[dlg.currentNode];
    if (!node) return 'error';
    const b = node.branches?.[branchIndex];
    if (!b) return 'error';

    // 校验
    const npcState = npcSystem.getNPCState(gameState, dlg.npcId) || {};
    const check = this._evaluateBranch(b, gameState, npcState);
    if (!check.ok) return 'error';

    // 应用 affectionDelta
    if (b.affectionDelta) {
      npcSystem.changeAffection(gameState, dlg.npcId, b.affectionDelta);
    }

    // 应用 effects（数组）— 交给 main.js 的 _applyEventEffect
    // 这里只写到一个队列，main.js 通过 dialogue:effects 事件订阅
    if (b.effects && b.effects.length > 0 && this.eventSystem) {
      this.eventSystem.publish('dialogue:effects', { effects: b.effects });
    }

    // 退出 / 跳转
    if (b.exit || !b.next) {
      this.exit(gameState);
      return 'exit';
    }
    dlg.currentNode = b.next;
    return 'continue';
  }

  /** 结束对话 */
  exit(gameState) {
    gameState.activeDialogue = null;
  }

  /** 是否在对话中 */
  isActive(gameState) {
    return !!gameState.activeDialogue;
  }

  initialize(gameEngine) {
    super.initialize(gameEngine);
    this.eventSystem = gameEngine.getSystem('EventSystem');
  }

  _evaluateBranch(branch, gameState, npcState) {
    const tags = new Set(gameState.playerTags || []);
    if (branch.requireTags) {
      for (const t of branch.requireTags) if (!tags.has(t)) {
        return { ok: false, reason: '所需身份不符' };
      }
    }
    if (branch.requireAnyTags) {
      if (!branch.requireAnyTags.some(t => tags.has(t))) return { ok: false, reason: '所需身份不符' };
    }
    if (branch.requireNoTags) {
      for (const t of branch.requireNoTags) if (tags.has(t)) {
        return { ok: false, reason: '你的某种身份让此选项不可用' };
      }
    }
    if (branch.requireAffection !== undefined) {
      if ((npcState.affection || 0) < branch.requireAffection) {
        return { ok: false, reason: '好感不够' };
      }
    }
    if (branch.requireVariables) {
      const vars = gameState.variables || {};
      for (const [k, v] of Object.entries(branch.requireVariables)) {
        if (vars[k] !== v) return { ok: false, reason: '前置条件未满足' };
      }
    }
    if (branch.requireWorldFlags) {
      const wf = gameState.worldFlags || {};
      for (const [k, v] of Object.entries(branch.requireWorldFlags)) {
        if (wf[k] !== v) return { ok: false, reason: '此刻世界尚未走到这一步' };
      }
    }
    return { ok: true };
  }
}
