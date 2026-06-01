/**
 * EndgameModal — 新游戏选择界面的 AI 参与度滑条（P2.1）
 */
import { EndgameModal } from '../../src/ui/EndgameModal.js';

function mkES() {
  const published = [];
  return {
    published,
    publish: jest.fn((type, data) => published.push({ type, data })),
    subscribe: jest.fn(() => 'sub'),
    unsubscribe: jest.fn(),
  };
}
const CHOICES = [{ key: 'k1', label: '剧本一', scaleId: 'g', scaleLabel: '组', scaleIcon: '📜', sceneCount: 10, eventCount: 5, description: 'd' }];

describe('EndgameModal AI 参与度滑条（新游戏选择）', () => {
  let container, es, modal;
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    es = mkES();
    modal = new EndgameModal(container, es);
  });
  afterEach(() => { modal.destroy(); container.remove(); });

  test('选剧本界面渲染滑条，默认取持久化值（缺失→默认 2）', () => {
    modal.show({ manual: true, presetChoices: CHOICES });
    const slider = container.querySelector('#endgame-ai-authority');
    expect(slider).toBeTruthy();
    expect(slider.value).toBe('2');
    expect(container.querySelector('#endgame-ai-authority-desc').innerHTML).toContain('L2 裁决');
  });

  test('已持久化的参与度被滑条读取', () => {
    localStorage.setItem('trpg_ai_config', JSON.stringify({ aiAuthority: 4 }));
    modal.show({ manual: true, presetChoices: CHOICES });
    expect(container.querySelector('#endgame-ai-authority').value).toBe('4');
  });

  test('拖动滑条更新档位说明', () => {
    modal.show({ manual: true, presetChoices: CHOICES });
    const slider = container.querySelector('#endgame-ai-authority');
    slider.value = '0';
    slider.dispatchEvent(new Event('input'));
    expect(container.querySelector('#endgame-ai-authority-desc').innerHTML).toContain('L0 旁白');
  });

  test('点剧本卡 → 持久化所选参与度 + game:newGame 带 presetKey 与 aiAuthority', () => {
    modal.show({ manual: true, presetChoices: CHOICES });
    const slider = container.querySelector('#endgame-ai-authority');
    slider.value = '3';
    slider.dispatchEvent(new Event('input'));
    container.querySelector('.endgame-modal__lib-card').click();

    const ng = es.published.filter(p => p.type === 'game:newGame');
    expect(ng.length).toBe(1);
    expect(ng[0].data).toMatchObject({ presetKey: 'k1', aiAuthority: 3 });
    // 持久化到 config（loadPreset 会读它应用到新局）
    expect(JSON.parse(localStorage.getItem('trpg_ai_config')).aiAuthority).toBe(3);
  });
});
