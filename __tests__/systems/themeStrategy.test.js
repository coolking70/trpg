/**
 * 题材战略/作战换皮 集成测试（Phase 42 T3c）
 * 验证：政令/外交/城池/行军姿态 的数值与标签随 gameState.strategySchema 变化；
 *       无 schema 时与三国默认一致（零回归）。
 */
import { applyPolicyPure, applyDiplomacyPure, holdingEffectiveDev } from '../../src/data/governance.js';
import { marchEta, postureMoraleMod } from '../../src/data/war.js';
import { StrategicSystem } from '../../src/systems/StrategicSystem.js';

describe('Phase 42 T3c — governance/war 纯函数读题材表', () => {
  test('applyPolicyPure：题材自定义 effect（新政令 KEY）生效', () => {
    const policies = { stimulus: { name: '招商引资', cost: { gold: 10 }, effect: { gold: 50, order: 5, scaled: ['gold'] } } };
    const r = applyPolicyPure({ gold: 100, agg: { population: 20000 } }, 'stimulus', policies);
    expect(r.ok).toBe(true);
    expect(r.deltas.gold).toBe(-10 + 100); // 成本 -10 + 50*scale(2.0)=100 → 90
    expect(r.deltas.order).toBe(5);        // order 不缩放
    expect(r.narrative).toContain('招商引资');
  });
  test('applyPolicyPure：沿用三国 KEY 但改名/改成本 → 走原型效果', () => {
    const policies = { farming: { name: '垦荒', cost: { gold: 5 } } };
    const r = applyPolicyPure({ gold: 100, agg: { population: 10000 } }, 'farming', policies);
    expect(r.deltas.food).toBeGreaterThan(0);   // farming 原型=增粮
    expect(r.narrative).toContain('垦荒');
  });
  test('applyDiplomacyPure：题材外交动作表标签生效', () => {
    const actions = { declare_war: { name: '宣战开战', cost: {} } };
    const r = applyDiplomacyPure({ gold: 100 }, 'declare_war', { stance: 'neutral', relation: 0 }, () => 0.5, actions);
    expect(r.ok).toBe(true);
    expect(r.setStance).toBe('war');
  });
  test('holdingEffectiveDev：题材城池类型权重生效', () => {
    const holdingTypes = { metropolis: { name: '大都会', prod: 2.0, def: 1, recruit: 1 } };
    const dev = holdingEffectiveDev({ type: 'metropolis', dev: 100 }, holdingTypes);
    expect(dev).toBe(200); // 100 * 2.0
  });
  test('marchEta/postureMoraleMod：题材姿态数值生效', () => {
    const postures = { blitz: { name: '闪击', detect: 0.2, allyResponse: false, attackerMorale: 5, defenderPrep: 0.2, etaFactor: 0.5 } };
    const eta = marchEta(2, 'blitz', postures);
    expect(eta).toBe(Math.max(1, Math.round((2 + 1) * 2 * 0.5))); // = 3
    expect(postureMoraleMod('blitz', postures)).toBe(5);
  });
});

describe('Phase 42 T3c — StrategicSystem 经 schema 落地题材内政', () => {
  function themePreset() {
    return {
      presetId: 't', name: '现代战争测试', author: 't', lore: { worldName: '2040' },
      strategySchema: {
        resources: { gold: { name: '资金' }, order: { name: '民意' } },
        policies: { mobilize_industry: { name: '工业动员', cost: { gold: 10 }, effect: { troops: 500, order: -4, scaled: ['troops'] } } },
        holdingTypes: { megacity: { name: '特大城市', prod: 1.5, def: 1.0, recruit: 1.4 } },
      },
      strategicSetup: {
        playerFactionId: 'blue',
        factions: {
          blue: { gold: 200, food: 200, troops: 2000, order: 60,
            holdings: [{ id: 'capital', name: '蓝都', type: 'megacity', population: 50000, dev: 100, security: 60 }] },
        },
      },
    };
  }
  test('题材政令增兵 + 城池类型解析', () => {
    const ss = new StrategicSystem(); ss.eventSystem = null;
    const gs = { addNarrative() {} };
    ss.initFromPreset(gs, themePreset());
    expect(gs.strategySchema.resources.gold.name).toBe('资金');
    expect(gs.strategicState.factions.blue.holdings[0].type).toBe('megacity'); // 题材城池类型被接受
    const before = ss.getFactionState(gs, 'blue').troops;
    const r = ss.applyPolicy(gs, 'blue', 'mobilize_industry');
    expect(r.ok).toBe(true);
    expect(ss.getFactionState(gs, 'blue').troops).toBeGreaterThan(before); // 工业动员增兵
  });
});
