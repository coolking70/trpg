/**
 * CardManager 测试：CRUD + 类型索引 + tag 查询 + preset 加载
 */

import { CardManager } from '../../src/systems/CardManager.js';

describe('CardManager', () => {
  let cm;
  beforeEach(() => { cm = new CardManager(); });

  describe('addCard', () => {
    test('添加角色卡', () => {
      const card = cm.addCard({ id: 'c1', type: 'character', name: '艾拉' });
      expect(card.id).toBe('c1');
      expect(cm.getCard('c1')).toBe(card);
    });

    test('添加敌人/事件/道具', () => {
      cm.addCard({ id: 'e1', type: 'enemy', name: '狼' });
      cm.addCard({ id: 'ev1', type: 'event', name: '陷阱', eventType: 'trap' });
      cm.addCard({ id: 'i1', type: 'item', name: '剑', itemType: 'weapon' });
      expect(cm.getCardCount()).toBe(3);
    });

    test('未知类型抛错', () => {
      expect(() => cm.addCard({ id: 'x', type: 'unknown', name: 'x' })).toThrow(/未知/);
    });

    test('重复 ID 替换旧卡', () => {
      cm.addCard({ id: 'c1', type: 'character', name: '艾拉' });
      cm.addCard({ id: 'c1', type: 'character', name: '艾拉V2' });
      expect(cm.getCard('c1').name).toBe('艾拉V2');
    });
  });

  describe('removeCard', () => {
    test('删除存在的卡', () => {
      cm.addCard({ id: 'c1', type: 'character', name: 'X' });
      expect(cm.removeCard('c1')).toBe(true);
      expect(cm.getCard('c1')).toBeUndefined();
    });

    test('删除不存在返回 false', () => {
      expect(cm.removeCard('fake')).toBe(false);
    });
  });

  describe('getCardsByType', () => {
    test('按类型过滤', () => {
      cm.addCard({ id: 'c1', type: 'character', name: 'A' });
      cm.addCard({ id: 'c2', type: 'character', name: 'B' });
      cm.addCard({ id: 'e1', type: 'enemy', name: 'X' });
      expect(cm.getCardsByType('character')).toHaveLength(2);
      expect(cm.getCardsByType('enemy')).toHaveLength(1);
      expect(cm.getCardsByType('item')).toHaveLength(0);
    });

    test('未知类型返回空', () => {
      expect(cm.getCardsByType('fake')).toEqual([]);
    });
  });

  describe('getCardsByTag', () => {
    test('按 tag 过滤', () => {
      cm.addCard({ id: 'c1', type: 'character', name: 'A', tags: ['hero', 'main'] });
      cm.addCard({ id: 'c2', type: 'character', name: 'B', tags: ['villain'] });
      cm.addCard({ id: 'c3', type: 'character', name: 'C', tags: ['hero'] });
      expect(cm.getCardsByTag('hero')).toHaveLength(2);
      expect(cm.getCardsByTag('main')).toHaveLength(1);
      expect(cm.getCardsByTag('none')).toHaveLength(0);
    });
  });

  describe('loadFromPreset', () => {
    test('清空 + 重新加载', () => {
      cm.addCard({ id: 'old', type: 'character', name: 'old' });
      cm.loadFromPreset({
        characters: [{ id: 'c1', name: '新' }],
        enemies: [{ id: 'e1', name: '敌' }],
        items: [{ id: 'i1', name: '剑', itemType: 'weapon' }],
        events: [{ id: 'ev1', name: '事', eventType: 'story' }],
      });
      expect(cm.getCard('old')).toBeUndefined();
      expect(cm.getCard('c1').name).toBe('新');
      expect(cm.getCardCount()).toBe(4);
    });
  });

  describe('getCountByType', () => {
    test('各类型计数', () => {
      cm.addCard({ id: 'c1', type: 'character', name: 'a' });
      cm.addCard({ id: 'c2', type: 'character', name: 'b' });
      cm.addCard({ id: 'e1', type: 'enemy', name: 'x' });
      const counts = cm.getCountByType();
      expect(counts.character).toBe(2);
      expect(counts.enemy).toBe(1);
      expect(counts.event).toBe(0);
      expect(counts.item).toBe(0);
    });
  });

  describe('clear', () => {
    test('清空所有卡', () => {
      cm.addCard({ id: 'c1', type: 'character', name: 'a' });
      cm.addCard({ id: 'e1', type: 'enemy', name: 'b' });
      cm.clear();
      expect(cm.getCardCount()).toBe(0);
      expect(cm.getCardsByType('character')).toHaveLength(0);
    });
  });
});
