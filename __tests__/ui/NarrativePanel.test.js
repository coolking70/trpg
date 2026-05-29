import { NarrativePanel } from '../../src/ui/NarrativePanel.js';

describe('NarrativePanel', () => {
  test('新游戏 gameId 变化时清空旧 DOM 叙事', () => {
    const container = document.createElement('div');
    const panel = new NarrativePanel(container, { publish: jest.fn() });
    panel.render();

    panel.update({
      gameId: 'game_old',
      narrativeLog: [
        { speaker: 'gm', text: '旧开场' },
        { speaker: 'player', text: '旧选择' },
      ],
    });
    expect(container.textContent).toContain('旧开场');

    panel.update({
      gameId: 'game_new',
      narrativeLog: [
        { speaker: 'gm', text: '新开场' },
      ],
    });

    expect(container.textContent).toContain('新开场');
    expect(container.textContent).not.toContain('旧开场');
    expect(container.textContent).not.toContain('旧选择');
  });
});
