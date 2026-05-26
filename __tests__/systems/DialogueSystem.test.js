/**
 * DialogueSystem 单元测试（Phase 20B）
 */

import { DialogueSystem } from '../../src/systems/DialogueSystem.js';
import { NPCSystem } from '../../src/systems/NPCSystem.js';
import { GameState } from '../../src/models/GameState.js';

const TEST_NPCS = [{
  id: 'npc_aria',
  name: '艾莉雅',
  icon: '🧝',
  giftPreferences: {},
  dialogueTree: {
    root: {
      speaker: 'self',
      text: '今晚的火光特别暖。',
      branches: [
        { text: '你来自哪里？', next: 'origin_story', affectionDelta: 1 },
        { text: '谈谈月神。', next: 'faith_chat', requireTags: ['faith:moon'], affectionDelta: 3 },
        { text: '你信任我吗？', next: 'trust', requireAffection: 50 },
        { text: '别废话，去睡。', affectionDelta: -2, exit: true },
      ],
    },
    origin_story: {
      speaker: 'self',
      text: '我来自远方的精灵森林。',
      branches: [
        { text: '继续讲', next: 'origin_story_2', affectionDelta: 2 },
        { text: '够了', exit: true },
      ],
    },
    origin_story_2: { speaker: 'self', text: '那是一段长长的故事...', branches: [] },
    faith_chat: { speaker: 'self', text: '月光指引我们。', branches: [] },
    trust: { speaker: 'self', text: '我把命交给你。', branches: [] },
  },
}];

function makeApp() {
  const eventSystem = {
    _subs: {},
    subscribe(t, cb) { (this._subs[t] ||= []).push(cb); },
    publish(t, data) { (this._subs[t] || []).forEach(cb => cb({ type: t, data })); },
    unsubscribe() {},
  };
  const npcSystem = new NPCSystem();
  npcSystem.loadFromPreset({ npcs: TEST_NPCS });
  const dialogueSystem = new DialogueSystem();
  // 模拟 initialize 注入
  dialogueSystem.eventSystem = eventSystem;
  dialogueSystem.getSystem = (name) => name === 'NPCSystem' ? npcSystem : null;
  const state = new GameState();
  npcSystem.initializeNPCState(state);
  return { eventSystem, npcSystem, dialogueSystem, state };
}

describe('DialogueSystem', () => {
  test('start 设置 activeDialogue + 返回 root 视图', () => {
    const { dialogueSystem, state } = makeApp();
    const view = dialogueSystem.start(state, 'npc_aria');
    expect(view).not.toBeNull();
    expect(view.npcName).toBe('艾莉雅');
    expect(view.speaker).toBe('self');
    expect(view.text).toContain('火光特别暖');
    expect(state.activeDialogue.npcId).toBe('npc_aria');
    expect(state.activeDialogue.currentNode).toBe('root');
  });

  test('start 不存在的 NPC 返回 null', () => {
    const { dialogueSystem, state } = makeApp();
    expect(dialogueSystem.start(state, 'npc_not_exist')).toBeNull();
  });

  test('branches 视图含 requireTags 不满足时 disabled=true', () => {
    const { dialogueSystem, state } = makeApp();
    state.playerTags = ['faith:sun'];   // 不是 moon
    const view = dialogueSystem.start(state, 'npc_aria');
    const moonBranch = view.branches.find(b => b.text === '谈谈月神。');
    expect(moonBranch.disabled).toBe(true);
    expect(moonBranch.reason).toContain('身份');
  });

  test('branches 视图含 requireAffection 不满足时 disabled=true', () => {
    const { dialogueSystem, state, npcSystem } = makeApp();
    // affection 0
    const view = dialogueSystem.start(state, 'npc_aria');
    const trustBranch = view.branches.find(b => b.text === '你信任我吗？');
    expect(trustBranch.disabled).toBe(true);

    // 拉高 affection
    npcSystem.changeAffection(state, 'npc_aria', 60);
    const view2 = dialogueSystem.getCurrentView(state);
    const trust2 = view2.branches.find(b => b.text === '你信任我吗？');
    expect(trust2.disabled).toBe(false);
  });

  test('choose 跳转到 next 节点 + 应用 affectionDelta', () => {
    const { dialogueSystem, state, npcSystem } = makeApp();
    dialogueSystem.start(state, 'npc_aria');
    const result = dialogueSystem.choose(state, 0);   // "你来自哪里"
    expect(result).toBe('continue');
    expect(state.activeDialogue.currentNode).toBe('origin_story');
    expect(npcSystem.getNPCState(state, 'npc_aria').affection).toBe(1);
  });

  test('choose exit=true 退出对话', () => {
    const { dialogueSystem, state, npcSystem } = makeApp();
    dialogueSystem.start(state, 'npc_aria');
    const result = dialogueSystem.choose(state, 3);   // "别废话，去睡"
    expect(result).toBe('exit');
    expect(state.activeDialogue).toBeNull();
    expect(npcSystem.getNPCState(state, 'npc_aria').affection).toBe(0);   // -2 后钳制到 0
  });

  test('choose 不可达分支返回 error', () => {
    const { dialogueSystem, state } = makeApp();
    state.playerTags = ['faith:sun'];
    dialogueSystem.start(state, 'npc_aria');
    const result = dialogueSystem.choose(state, 1);   // 月神选项不可达
    expect(result).toBe('error');
    expect(state.activeDialogue.currentNode).toBe('root');   // 没跳转
  });

  test('choose 没有 next + 没有 exit → 退出', () => {
    const { dialogueSystem, state } = makeApp();
    dialogueSystem.start(state, 'npc_aria');
    dialogueSystem.choose(state, 0);   // → origin_story
    const result = dialogueSystem.choose(state, 1);   // "够了" exit=true
    expect(result).toBe('exit');
  });

  test('exit 清理 activeDialogue', () => {
    const { dialogueSystem, state } = makeApp();
    dialogueSystem.start(state, 'npc_aria');
    dialogueSystem.exit(state);
    expect(state.activeDialogue).toBeNull();
    expect(dialogueSystem.isActive(state)).toBe(false);
  });

  test('effects 通过 dialogue:effects 事件发布', () => {
    const { dialogueSystem, state, eventSystem } = makeApp();
    // 改造 root 第一个分支带 effects
    const npc = TEST_NPCS[0];
    npc.dialogueTree.root.branches[0].effects = [{ type: 'set_variable', name: 'asked_origin', value: true }];

    let captured = null;
    eventSystem.subscribe('dialogue:effects', (evt) => { captured = evt.data; });

    dialogueSystem.start(state, 'npc_aria');
    dialogueSystem.choose(state, 0);
    expect(captured).not.toBeNull();
    expect(captured.effects[0].name).toBe('asked_origin');
  });
});
