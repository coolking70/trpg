/**
 * 主线 E2E 集成测试
 * 串起默认预设的 10 章主线，验证：
 * - 触发器条件正确门控
 * - 状态机变量正确传递
 * - 物品获取、HP 变化、长期记忆写入
 * - 战斗-叙事-奖励-自动存档链路
 */

import { createHarness } from './_harness.js';
import { DEFAULT_PRESET } from '../../src/data/defaultPreset.js';

describe('主线 E2E：暗黑森林冒险', () => {
  let h;

  beforeEach(() => {
    h = createHarness(DEFAULT_PRESET);
  });

  test('开场状态：起点 POI + 5 个 worldFacts + gold 100', () => {
    expect(h.gameState.mapState.playerPosition).toEqual({ x: 3, y: 7 });
    expect(h.gameState.gold).toBe(100);
    expect(h.gameState.aiContext.worldFacts.length).toBeGreaterThanOrEqual(4);
    expect(h.gameState.aiContext.worldFacts.some(f => f.includes('艾尔大陆'))).toBe(true);
  });

  test('章节 1 → 2：受命出征 + 神秘旅人 (含 amulet)', () => {
    // 移动到起点扫描（自动触发 ch1）
    h.moveTo(3, 7);
    expect(h.gameState.activeEvent?.id).toBe('ch1_start');

    h.resolveChoice('ch1_start', 'accept_quest');
    expect(h.gameState.variables.quest_received).toBe(true);
    expect(h.gameState.completedEventIds).toContain('ch1_start');

    // 走到道路上触发 ch2（多试几次，因为概率 0.55）
    const origRandom = Math.random;
    Math.random = () => 0.1;  // 强制低骰让概率检查通过
    h.moveTo(4, 7);
    Math.random = origRandom;

    expect(h.gameState.activeEvent?.id).toBe('ch2_traveler');

    h.resolveChoice('ch2_traveler', 'accept_help');
    expect(h.gameState.variables.met_traveler).toBe(true);
    const hasAmulet = h.gameState.activeCharacters.some(c => (c.inventory || []).includes('item_007'));
    expect(hasAmulet).toBe(true);
    expect(h.gameState.completedEventIds).toContain('ch2_traveler');
  });

  test('章节 3：进村打听 + 拒绝帮助分支', () => {
    h.resolveChoice('ch1_start', 'accept_quest');

    // 进入村庄
    h.moveTo(7, 1);
    expect(h.gameState.activeEvent?.id).toBe('ch3_village');

    h.resolveChoice('ch3_village', 'ask_dark_knight');
    expect(h.gameState.variables.knows_dark_knight).toBe(true);

    const keyEvents = h.gameState.aiContext.keyEvents.map(e => e.summary);
    expect(keyEvents.some(s => s.includes('堕落骑士'))).toBe(true);
  });

  test('章节 4：商店（ch3 完成 + 村庄 POI 重访）', () => {
    h.resolveChoice('ch1_start', 'accept_quest');
    h.moveTo(7, 1);
    h.resolveChoice('ch3_village', 'ask_dark_knight');

    // 重置 active event 模拟"离开村庄回头"（中间地块可能概率触发别的事件，跳过）
    h.gameState.activeEvent = null;

    // 重返村庄 → 应触发 ch4_shop (priority 85，应当胜出 ch6 priority 80)
    h.moveTo(7, 1);
    expect(h.gameState.activeEvent?.id).toBe('ch4_shop');
    expect(h.gameState.activeEvent.shop).toBeTruthy();
    expect(h.gameState.activeEvent.shop.inventory.length).toBeGreaterThan(0);
  });

  test('章节 5：森林暗影狼伏击 (随机概率)', () => {
    h.resolveChoice('ch1_start', 'accept_quest');

    // 强制概率命中
    const origRandom = Math.random;
    let callCount = 0;
    Math.random = () => {
      callCount++;
      return 0.05;  // 极低值确保所有概率检查都过
    };

    // 走到森林 (T 或 G 地块)，例如 (1, 0) - 看 grid 第一行 'TTTTGGGGGGGGRRGGTTTT' 是 T
    h.moveTo(1, 0);

    Math.random = origRandom;

    // 应触发战斗事件或其他随机事件
    expect(h.gameState.activeEvent?.id).toBe('ch5_wolves');
  });

  test('章节 6：堕落骑士（需知传闻 + 已完成 ch2 + 路上）', () => {
    h.resolveChoice('ch1_start', 'accept_quest');

    // 先完成 ch2 让它不再竞争（ch2 priority 90 > ch6 priority 80）
    h.gameState.completedEventIds.push('ch2_traveler');
    h.gameState.variables.met_traveler = true;

    h.moveTo(7, 1);
    h.resolveChoice('ch3_village', 'ask_dark_knight');

    // 移到道路上（强制概率命中）
    const origRandom = Math.random;
    Math.random = () => 0.05;
    h.moveTo(4, 7);
    Math.random = origRandom;

    // ch2 已被排除，仅 ch6 应触发
    expect(h.gameState.activeEvent?.id).toBe('ch6_dark_knight');
  });

  test('章节 7：HP 危急时治愈者出现', () => {
    h.resolveChoice('ch1_start', 'accept_quest');

    // 制造 30% HP
    h.setPartyHpRatio(0.2);
    h.scanTriggers('turn_end');

    expect(h.gameState.activeEvent?.id).toBe('ch7_rescue');

    h.resolveChoice('ch7_rescue', 'accept_healing');

    // 验证全队满血
    for (const c of h.gameState.activeCharacters) {
      expect(c.stats.hpCurrent).toBe(c.stats.hp);
    }

    // 重复不再触发
    h.setPartyHpRatio(0.2);
    h.scanTriggers('turn_end');
    expect(h.gameState.activeEvent).toBeNull();
  });

  test('章节 8 → 9 → 10：遗迹之门 → 巫妖 → 黎明', () => {
    h.resolveChoice('ch1_start', 'accept_quest');

    // 直接进入遗迹 POI
    h.moveTo(17, 10);
    expect(h.gameState.activeEvent?.id).toBe('ch8_dungeon_gate');

    // 强制让护身符成功（0.85 概率）
    const origRandom = Math.random;
    Math.random = () => 0.1;
    h.resolveChoice('ch8_dungeon_gate', 'use_amulet');
    Math.random = origRandom;

    expect(h.gameState.variables.opened_gate).toBe(true);
    expect(h.gameState.completedEventIds).toContain('ch8_dungeon_gate');

    // ch9 应通过 EVENT_COMPLETE 自动触发（或 VARIABLE_CHANGE）
    expect(h.gameState.activeEvent?.id).toBe('ch9_lich');

    // 解析 ch9 选择 → 触发巫妖战
    h.resolveChoice('ch9_lich', 'final_battle');

    // 战斗已经在 startCombat 中以 'victory' 自动完成
    expect(h.gameState.activeCombat).toBeNull();
    expect(h.gameState.completedEventIds).toContain('ch9_lich');

    // ch10 应通过 COMBAT_END 或 EVENT_COMPLETE 触发
    expect(h.gameState.completedEventIds).toContain('ch10_epilogue');

    // 验证记忆中有关键事件
    const memories = h.gameState.aiContext.keyEvents.map(e => e.summary);
    expect(memories.some(m => m.includes('巫妖') || m.includes('森林'))).toBe(true);
  });

  test('完整通关：金币 + 经验 + 记忆 + 存档', () => {
    // 走整条主线
    h.resolveChoice('ch1_start', 'accept_quest');

    const origRandom = Math.random;
    Math.random = () => 0.1;
    h.moveTo(4, 7);
    if (h.gameState.activeEvent?.id === 'ch2_traveler') {
      h.resolveChoice('ch2_traveler', 'accept_help');
    }

    h.moveTo(7, 1);
    if (h.gameState.activeEvent?.id === 'ch3_village') {
      h.resolveChoice('ch3_village', 'ask_dark_knight');
    }

    h.moveTo(17, 10);
    if (h.gameState.activeEvent?.id === 'ch8_dungeon_gate') {
      h.resolveChoice('ch8_dungeon_gate', 'use_amulet');
    }
    if (h.gameState.activeEvent?.id === 'ch9_lich') {
      h.resolveChoice('ch9_lich', 'final_battle');
    }
    Math.random = origRandom;

    // 验证收尾
    const completed = h.gameState.completedEventIds;
    expect(completed).toContain('ch1_start');
    expect(completed).toContain('ch9_lich');
    expect(completed).toContain('ch10_epilogue');

    // 经验已加（杀了 boss enemy_007 = 100 XP / 4 = 25 each）
    const totalExp = h.gameState.activeCharacters.reduce((sum, c) => sum + (c.experience || 0), 0);
    expect(totalExp).toBeGreaterThan(0);

    // 金币 100 起步未变（无购物）
    expect(h.gameState.gold).toBe(100);

    // 记忆中有多个章节
    expect(h.gameState.aiContext.keyEvents.length).toBeGreaterThanOrEqual(4);

    // 测试存档
    h.stateManager.setState(h.gameState);
    const saved = h.stateManager.saveToSlot('test_slot', '通关存档', JSON.stringify(h.preset));
    expect(saved).toBe(true);

    const slots = h.stateManager.listSlots();
    expect(slots.some(s => s.id === 'test_slot')).toBe(true);
    const slotMeta = slots.find(s => s.id === 'test_slot').meta;
    expect(slotMeta.chaptersCompleted).toBeGreaterThanOrEqual(4);

    // 清理
    h.stateManager.deleteSlot('test_slot');
  });

  test('AI add_memory action 集成', () => {
    h.resolveChoice('ch1_start', 'accept_quest');
    const memCountBefore = h.gameState.aiContext.keyEvents.length;

    // 模拟 AI 通过 add_memory action 写入记忆
    h.applyEffect({ type: 'add_memory', value: '集成测试标记的关键事件' });

    expect(h.gameState.aiContext.keyEvents.length).toBe(memCountBefore + 1);
    expect(h.gameState.aiContext.keyEvents[h.gameState.aiContext.keyEvents.length - 1].summary)
      .toBe('集成测试标记的关键事件');
  });

  test('道具使用集成：药水恢复 HP', () => {
    const eilaa = h.gameState.activeCharacters[0];
    eilaa.stats.hpCurrent = 30;
    eilaa.inventory = ['item_009'];

    const progression = h.engine.getSystem('ProgressionSystem');
    const result = progression.useItem(h.gameState, 'item_009', eilaa.id, eilaa.id);

    expect(result.success).toBe(true);
    expect(eilaa.stats.hpCurrent).toBe(60);  // +30
    expect(eilaa.inventory).toEqual([]);
  });

  test('装备替换集成：长弓换圣光剑', () => {
    const eilaa = h.gameState.activeCharacters[0];
    eilaa.inventory.push('item_002');  // 精灵长弓

    const atkBefore = eilaa.stats.attack;
    const progression = h.engine.getSystem('ProgressionSystem');
    progression.equipItem(h.gameState, 'item_002', eilaa.id);

    expect(eilaa.equipment.weapon).toBe('item_002');
    // 圣光之剑(+8 atk) 卸下，长弓(+6 atk) 装备 → 净 -2
    expect(eilaa.stats.attack).toBe(atkBefore - 2);
    expect(eilaa.inventory).toContain('item_001');  // 圣光之剑回背包
  });
});
