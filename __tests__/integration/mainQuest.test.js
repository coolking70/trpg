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
    // 起点场景已设为当前（开局），扫描触发 ch1
    h.travelTo('scene_spawn');
    expect(h.gameState.activeEvent?.id).toBe('ch1_start');

    h.resolveChoice('ch1_start', 'accept_quest');
    expect(h.gameState.variables.quest_received).toBe(true);
    expect(h.gameState.completedEventIds).toContain('ch1_start');

    // 走到旅人篝火场景（必触发，inScene 模式）
    h.travelTo('scene_forest_path');
    h.travelTo('scene_traveler_camp');
    expect(h.gameState.activeEvent?.id).toBe('ch2_traveler');

    h.resolveChoice('ch2_traveler', 'accept_help');
    expect(h.gameState.variables.met_traveler).toBe(true);
    // ch2 现在给"符文护身符"(item_013)，与 item_007 魔力水晶解耦
    const hasAmulet = h.gameState.activeCharacters.some(c => (c.inventory || []).includes('item_013'));
    expect(hasAmulet).toBe(true);
    expect(h.gameState.completedEventIds).toContain('ch2_traveler');
  });

  test('章节 3：进村打听 + 拒绝帮助分支', () => {
    h.travelTo('scene_spawn');
    h.resolveChoice('ch1_start', 'accept_quest');

    // 进入村庄场景
    h.travelTo('scene_village');
    expect(h.gameState.activeEvent?.id).toBe('ch3_village');

    h.resolveChoice('ch3_village', 'ask_dark_knight');
    expect(h.gameState.variables.knows_dark_knight).toBe(true);

    const keyEvents = h.gameState.aiContext.keyEvents.map(e => e.summary);
    expect(keyEvents.some(s => s.includes('堕落骑士'))).toBe(true);
  });

  test('章节 4：商店（ch3 完成 + 村庄场景重访）', () => {
    h.travelTo('scene_spawn');
    h.resolveChoice('ch1_start', 'accept_quest');
    h.travelTo('scene_village');
    h.resolveChoice('ch3_village', 'ask_dark_knight');

    h.gameState.activeEvent = null;

    // 重返村庄 → 应触发 ch4_shop (priority 85 > ch3 已完成)
    h.travelTo('scene_dark_corridor');  // 先离开
    h.travelTo('scene_village');         // 再回来
    expect(h.gameState.activeEvent?.id).toBe('ch4_shop');
    expect(h.gameState.activeEvent.shop).toBeTruthy();
    expect(h.gameState.activeEvent.shop.inventory.length).toBeGreaterThan(0);
  });

  test('章节 5：暗影丛林场景（必触发暗影狼伏击）', () => {
    h.travelTo('scene_spawn');
    h.resolveChoice('ch1_start', 'accept_quest');

    // 走到 scene_shadow_grove — inScene 模式下 probability=1.0 必触发
    h.travelTo('scene_forest_path');
    h.travelTo('scene_shadow_grove');
    expect(h.gameState.activeEvent?.id).toBe('ch5_wolves');
  });

  test('章节 6：堕落骑士（需知传闻 + 进入哨所场景）', () => {
    h.travelTo('scene_spawn');
    h.resolveChoice('ch1_start', 'accept_quest');
    h.travelTo('scene_village');
    h.resolveChoice('ch3_village', 'ask_dark_knight');

    // 走到废弃哨所
    h.travelTo('scene_dark_corridor');
    h.travelTo('scene_abandoned_outpost');
    expect(h.gameState.activeEvent?.id).toBe('ch6_dark_knight');
  });

  test('章节 7：HP 危急 + 治愈者祭坛场景', () => {
    h.travelTo('scene_spawn');
    h.resolveChoice('ch1_start', 'accept_quest');

    // 制造 20% HP
    h.setPartyHpRatio(0.2);
    // 移动到治愈者祭坛 — partyHpBelow 0.5 + inScene 命中
    h.travelTo('scene_forest_path');
    h.travelTo('scene_traveler_camp');
    h.travelTo('scene_village');
    h.resolveChoice('ch3_village', 'ask_dark_knight');
    h.travelTo('scene_dark_corridor');
    h.travelTo('scene_healer_shrine');

    expect(h.gameState.activeEvent?.id).toBe('ch7_rescue');

    h.resolveChoice('ch7_rescue', 'accept_healing');

    // 验证全队满血
    for (const c of h.gameState.activeCharacters) {
      expect(c.stats.hpCurrent).toBe(c.stats.hp);
    }
  });

  test('章节 8 → 9 → 10：遗迹之门 → 巫妖 → 黎明', () => {
    h.travelTo('scene_spawn');
    h.resolveChoice('ch1_start', 'accept_quest');

    // 跳到村庄拿到 knows_dark_knight 解锁主路（途径需要门控）
    h.travelTo('scene_village');
    h.resolveChoice('ch3_village', 'ask_dark_knight');

    // 直接走到遗迹之门（开发者用，跳过堕落骑士战）
    h.travelTo('scene_dark_corridor');
    h.gameState.completedEventIds.push('ch6_dark_knight');  // 模拟已通过哨所
    h.travelTo('scene_ruin_outskirts');
    h.travelTo('scene_ruin_gate');
    expect(h.gameState.activeEvent?.id).toBe('ch8_dungeon_gate');

    // 强制让护身符成功（0.85 概率）
    const origRandom = Math.random;
    Math.random = () => 0.1;
    h.resolveChoice('ch8_dungeon_gate', 'use_amulet');
    Math.random = origRandom;

    expect(h.gameState.variables.opened_gate).toBe(true);
    expect(h.gameState.completedEventIds).toContain('ch8_dungeon_gate');

    // ch9 触发：开门后需要走进祭坛场景
    h.travelTo('scene_lich_altar');
    expect(h.gameState.activeEvent?.id).toBe('ch9_lich');

    h.resolveChoice('ch9_lich', 'final_battle');
    expect(h.gameState.activeCombat).toBeNull();
    expect(h.gameState.completedEventIds).toContain('ch9_lich');

    // ch10 在 scene_dawn_meadow，走出战斗后跳过去
    h.travelTo('scene_dawn_meadow');
    // 默认路径（没救赎骑士）应触发 ch10_epilogue
    expect(h.gameState.completedEventIds).toContain('ch10_epilogue');
    expect(h.gameState.completedEventIds).not.toContain('ch10_redeemed');

    const memories = h.gameState.aiContext.keyEvents.map(e => e.summary);
    expect(memories.some(m => m.includes('巫妖') || m.includes('森林'))).toBe(true);
  });

  test('多结局：救赎之黎明（redeemed_knight=true 时触发 ch10_redeemed 而非 ch10_epilogue）', () => {
    h.travelTo('scene_spawn');
    h.resolveChoice('ch1_start', 'accept_quest');

    // 模拟玩家成功唤醒堕落骑士（set_variable 已由 ch6 redeem 成功分支完成）
    h.gameState.variables.redeemed_knight = true;
    h.gameState.completedEventIds.push('ch6_dark_knight', 'ch3_village');
    h.gameState.variables.knows_dark_knight = true;

    // 推进到遗迹之门
    h.travelTo('scene_village');
    h.travelTo('scene_dark_corridor');
    h.travelTo('scene_ruin_outskirts');
    h.travelTo('scene_ruin_gate');

    const origRandom = Math.random;
    Math.random = () => 0.1;
    h.resolveChoice('ch8_dungeon_gate', 'use_amulet');
    Math.random = origRandom;

    h.travelTo('scene_lich_altar');
    h.resolveChoice('ch9_lich', 'final_battle');

    // 进入黎明草地 — 应该触发 ch10_redeemed（priority 110 + requireVariables 命中）
    h.travelTo('scene_dawn_meadow');
    expect(h.gameState.completedEventIds).toContain('ch10_redeemed');
    expect(h.gameState.completedEventIds).not.toContain('ch10_epilogue');
  });

  test('完整通关：金币 + 经验 + 记忆 + 存档', () => {
    h.travelTo('scene_spawn');
    h.resolveChoice('ch1_start', 'accept_quest');

    h.travelTo('scene_forest_path');
    h.travelTo('scene_traveler_camp');
    if (h.gameState.activeEvent?.id === 'ch2_traveler') {
      h.resolveChoice('ch2_traveler', 'accept_help');
    }

    h.travelTo('scene_village');
    if (h.gameState.activeEvent?.id === 'ch3_village') {
      h.resolveChoice('ch3_village', 'ask_dark_knight');
    }

    h.travelTo('scene_dark_corridor');
    h.gameState.completedEventIds.push('ch6_dark_knight');  // 跳过堕落骑士战
    h.travelTo('scene_ruin_outskirts');
    h.travelTo('scene_ruin_gate');
    const origRandom = Math.random;
    Math.random = () => 0.1;
    if (h.gameState.activeEvent?.id === 'ch8_dungeon_gate') {
      h.resolveChoice('ch8_dungeon_gate', 'use_amulet');
    }
    Math.random = origRandom;
    h.travelTo('scene_lich_altar');
    if (h.gameState.activeEvent?.id === 'ch9_lich') {
      h.resolveChoice('ch9_lich', 'final_battle');
    }
    h.travelTo('scene_dawn_meadow');

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
