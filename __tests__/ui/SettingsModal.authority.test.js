/**
 * SettingsModal — AI 参与度滑条（P2）
 * 验证：滑条按 config 渲染、拖动实时发 settings:authorityLive、读表带回 aiAuthority。
 */
import { SettingsModal } from '../../src/ui/SettingsModal.js';

function mkES() {
  const published = [];
  return {
    published,
    publish: jest.fn((type, data) => published.push({ type, data })),
    subscribe: jest.fn(() => 'sub'),
    unsubscribe: jest.fn(),
  };
}

describe('SettingsModal AI 参与度滑条', () => {
  let container, es, modal;
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    es = mkES();
    modal = new SettingsModal(container, es);
  });
  afterEach(() => { container.remove(); });

  test('按 config.aiAuthority 渲染滑条与档位说明', () => {
    modal.config.aiAuthority = 1;
    modal.show();
    const slider = container.querySelector('#setting-ai-authority');
    expect(slider).toBeTruthy();
    expect(slider.value).toBe('1');
    const label = container.querySelector('#setting-ai-authority-label');
    expect(label.innerHTML).toContain('L1 主持');
  });

  test('拖动滑条 → 实时发 settings:authorityLive + 更新档位说明', () => {
    modal.config.aiAuthority = 2;
    modal.show();
    const slider = container.querySelector('#setting-ai-authority');
    slider.value = '4';
    slider.dispatchEvent(new Event('input'));

    const live = es.published.filter(p => p.type === 'settings:authorityLive');
    expect(live.length).toBeGreaterThan(0);
    expect(live[live.length - 1].data).toEqual({ aiAuthority: 4 });
    expect(modal.config.aiAuthority).toBe(4);
    expect(container.querySelector('#setting-ai-authority-label').innerHTML).toContain('L4 创世');
  });

  test('_readFormConfig 带回 aiAuthority', () => {
    modal.config.aiAuthority = 0;
    modal.show();
    const cfg = modal._readFormConfig(container);
    expect(cfg.aiAuthority).toBe(0);
  });

  test('_authorityLabelHTML 规整越界值', () => {
    expect(modal._authorityLabelHTML(9)).toContain('L4 创世');
    expect(modal._authorityLabelHTML(-1)).toContain('L0 旁白');
  });
});
