import { CardRenderer } from '../../src/rendering/CardRenderer.js';

describe('CardRenderer 图片资源渲染', () => {
  test('角色无图片资源时不渲染空图片框', () => {
    const card = {
      id: 'c1',
      name: '艾拉',
      title: '游侠',
      description: '森林中的斥候',
      image: '',
      stats: { hp: 20, hpCurrent: 20, mp: 5, mpCurrent: 5 },
    };

    const el = CardRenderer.renderCharacterMini(card);
    expect(el.querySelector('.card__image')).toBeNull();
    expect(el.textContent).not.toContain('角色图片');
  });

  test('事件无图片资源时不渲染占位图框', () => {
    const card = {
      id: 'ev1',
      name: '旧门',
      description: '门后传来低语。',
      image: '',
      eventType: 'story',
      choices: [],
    };

    const el = CardRenderer.renderEventCard(card);
    expect(el.querySelector('.event-card__image')).toBeNull();
    expect(el.querySelector('.event-card__image-placeholder')).toBeNull();
    expect(el.textContent).not.toContain('事件图片');
  });

  test('保留未来资源字段接口，优先使用 portrait/imageUrl/thumbnail', () => {
    const character = {
      id: 'c2',
      name: '维克斯',
      portrait: '/assets/vex.png',
      image: '',
      stats: { hp: 20, hpCurrent: 12, mp: 8, mpCurrent: 3 },
    };
    const item = {
      id: 'i1',
      name: '太阳坠',
      thumbnail: '/assets/sun.png',
      image: '',
      itemType: 'quest',
      statModifiers: {},
    };

    expect(CardRenderer.renderCharacterMini(character).querySelector('img').getAttribute('src')).toBe('/assets/vex.png');
    expect(CardRenderer.renderItemMini(item).querySelector('img').getAttribute('src')).toBe('/assets/sun.png');
  });
});
