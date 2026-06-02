/**
 * LegionBattlePanel — 军团战面板（Phase 36）
 * 验证：按 activeLegionBattle 渲染双方栈 + 高阶令按钮，点按发 legion:playerAction。
 */
import { LegionBattlePanel } from '../../src/ui/LegionBattlePanel.js';

function mkES() {
  const published = [];
  return {
    published,
    publish: jest.fn((type, data) => published.push({ type, data })),
    subscribe: jest.fn(() => 'sub'),
    unsubscribe: jest.fn(),
  };
}

function battleState() {
  return {
    activeLegionBattle: {
      battleType: 'field', round: 2, objectiveName: '官渡会战',
      zones: ['前阵', '侧翼', '后阵'], supply: { player: 80, enemy: 60 }, works: null, control: null,
      units: [
        { id: 'p1', side: 'player', name: '蜀骑', unitType: 'cavalry', troops: 3000, maxTroops: 4000, morale: 70, zone: '前阵', formation: 'fengshi', machines: [] },
        { id: 'e1', side: 'enemy', name: '魏弓', unitType: 'archer', troops: 1200, maxTroops: 2000, morale: 55, zone: '前阵', formation: 'none', machines: [] },
      ],
    },
  };
}

describe('LegionBattlePanel', () => {
  let container, es, panel;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    es = mkES();
    panel = new LegionBattlePanel(container, es, null);
  });
  afterEach(() => { container.remove(); });

  test('渲染战型/回合/目标 + 双方单位栈', () => {
    panel.update(battleState());
    panel.show();
    const text = container.textContent;
    expect(text).toMatch(/野战/);
    expect(text).toMatch(/第 2 回合/);
    expect(text).toMatch(/官渡会战/);
    expect(text).toMatch(/蜀骑/);
    expect(text).toMatch(/魏弓/);
    expect(text).toMatch(/我军/);
    expect(text).toMatch(/敌军/);
  });

  test('高阶令按钮齐全，点"总攻"发 legion:playerAction', () => {
    panel.update(battleState());
    panel.show();
    const btns = [...container.querySelectorAll('button')].map(b => b.textContent);
    expect(btns.join(' ')).toMatch(/总攻/);
    expect(btns.join(' ')).toMatch(/火攻/);
    expect(btns.join(' ')).toMatch(/撤退/);
    const assault = [...container.querySelectorAll('button')].find(b => /总攻/.test(b.textContent));
    assault.click();
    const ev = es.published.find(p => p.type === 'legion:playerAction');
    expect(ev).toBeTruthy();
    expect(ev.data.posture).toBe('assault');
  });

  test('无 activeLegionBattle → 自动隐藏', () => {
    panel.update(battleState());
    panel.show();
    expect(container.querySelector('.legion-panel')).toBeTruthy();
    panel.update({ activeLegionBattle: null });
    expect(container.querySelector('.legion-panel')).toBeFalsy();
  });
});
