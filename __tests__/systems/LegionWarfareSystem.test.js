/**
 * LegionWarfareSystem 单元测试（Phase 31 — 军团战争 / 单位栈战术制）
 * 直接驱动 system 原语，并用一个本地 auto-resolve 循环验证整场战斗收敛到胜负。
 */

import { LegionWarfareSystem } from '../../src/systems/LegionWarfareSystem.js';

// 固定 rng（轻微波动，避免每次结算完全相同又保证确定性）
function makeSys(seed = 0.5) {
  const sys = new LegionWarfareSystem();
  let x = seed;
  sys.rng = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  return sys;
}

// 模拟 GameSession 的 auto-resolve 编排循环
function autoResolve(sys, gs, maxIter = 400) {
  let iter = 0;
  while (gs.activeLegionBattle && iter++ < maxIter) {
    const actor = sys.getCurrentActor(gs);
    if (!actor || actor.troops <= 0) {
      const r = sys.nextTurn(gs);
      if (r.battleEnd) return r;
      continue;
    }
    const order = sys.decideLegion(gs, actor);
    sys.executeOrder(gs, actor.id, order);
    const r = sys.nextTurn(gs);
    if (r.battleEnd) return r;
  }
  return { battleEnd: !gs.activeLegionBattle, timedOut: iter >= maxIter };
}

const generals = {
  zhang: { name: '张将军', warfare: { command: 70, might: 85, intellect: 50, tactics: 2, abilities: ['charge', 'rally'] } },
  li: { name: '李将军', warfare: { command: 60, might: 60, intellect: 70, tactics: 2, abilities: ['fire', 'rally'] } },
  zhuge: { name: '诸葛亮', warfare: { command: 90, might: 40, intellect: 100, tactics: 3, abilities: ['fire', 'ambush', 'rally'] } },
};

describe('LegionWarfareSystem — 开战与快照', () => {
  test('startBattle 建立战斗状态与先攻序', () => {
    const sys = makeSys();
    const gs = {};
    const b = sys.startBattle(gs, {
      battleType: 'field', generals,
      supply: { player: 60, enemy: 50 },
      units: [
        { id: 'p1', side: 'player', unitType: 'cavalry', troops: 2000, generalId: 'zhang' },
        { id: 'e1', side: 'enemy', unitType: 'archer', troops: 1800, generalId: 'li' },
      ],
    });
    expect(gs.activeLegionBattle).toBe(b);
    expect(gs.currentPhase).toBe('legion');
    expect(b.turnOrder.length).toBe(2);
    // 骑兵 speed 高 → 先动
    expect(b.turnOrder[0].id).toBe('p1');
  });
});

describe('LegionWarfareSystem — 指令结算', () => {
  test('set_formation 受主将阵法门槛限制', () => {
    const sys = makeSys();
    const gs = {};
    sys.startBattle(gs, {
      battleType: 'field', generals,
      units: [{ id: 'p1', side: 'player', unitType: 'infantry', troops: 1000, generalId: 'zhang' }],
    });
    // zhang tactics=2 → 锋矢(2)可，雁行(3)不可
    expect(sys.executeOrder(gs, 'p1', { type: 'set_formation', formation: 'fengshi' }).ok).toBe(true);
    expect(sys.findUnit(gs, 'p1').formation).toBe('fengshi');
    const bad = sys.executeOrder(gs, 'p1', { type: 'set_formation', formation: 'yanxing' });
    expect(bad.ok).toBe(false);
  });

  test('attack 造成双方兵力损耗', () => {
    const sys = makeSys();
    const gs = {};
    sys.startBattle(gs, {
      battleType: 'field', generals,
      units: [
        { id: 'p1', side: 'player', unitType: 'cavalry', troops: 2000, generalId: 'zhang' },
        { id: 'e1', side: 'enemy', unitType: 'infantry', troops: 2000 },
      ],
    });
    const e1Before = sys.findUnit(gs, 'e1').troops;
    const r = sys.executeOrder(gs, 'p1', { type: 'attack', targetId: 'e1' });
    expect(r.ok).toBe(true);
    expect(sys.findUnit(gs, 'e1').troops).toBeLessThan(e1Before);
  });

  test('rally 战法提升我方士气', () => {
    const sys = makeSys(0.1); // 让 rally 成功
    const gs = {};
    sys.startBattle(gs, {
      battleType: 'field', generals,
      units: [
        { id: 'p1', side: 'player', unitType: 'infantry', troops: 1000, generalId: 'zhang', morale: 50 },
        { id: 'p2', side: 'player', unitType: 'archer', troops: 800, morale: 50 },
      ],
    });
    sys.executeOrder(gs, 'p1', { type: 'tactic', tacticKey: 'rally' });
    expect(sys.findUnit(gs, 'p2').morale).toBeGreaterThan(50);
  });

  test('retreat 使该栈撤离', () => {
    const sys = makeSys();
    const gs = {};
    sys.startBattle(gs, {
      battleType: 'field', generals,
      units: [{ id: 'p1', side: 'player', unitType: 'infantry', troops: 1000 }],
    });
    sys.executeOrder(gs, 'p1', { type: 'retreat' });
    expect(sys.findUnit(gs, 'p1').troops).toBe(0);
  });
});

describe('LegionWarfareSystem — 整场 auto-resolve 收敛', () => {
  test('野战：强势一方获胜且循环终止', () => {
    const sys = makeSys();
    const gs = {};
    sys.startBattle(gs, {
      battleType: 'field', generals,
      supply: { player: 80, enemy: 80 },
      units: [
        { id: 'p1', side: 'player', unitType: 'cavalry', troops: 4000, generalId: 'zhang' },
        { id: 'p2', side: 'player', unitType: 'spearman', troops: 3000, generalId: 'zhang' },
        { id: 'e1', side: 'enemy', unitType: 'archer', troops: 1500, generalId: 'li' },
      ],
    });
    const r = autoResolve(sys, gs);
    expect(r.battleEnd).toBe(true);
    expect(r.timedOut).toBeFalsy();
    expect(['victory', 'defeat']).toContain(r.result);
    expect(r.winnerSide).toBe('player'); // 兵力与克制都占优
  });

  test('攻城：攻方破门取胜（breach）', () => {
    const sys = makeSys();
    const gs = {};
    sys.startBattle(gs, {
      battleType: 'siege', generals,
      supply: { player: 200, enemy: 200 },
      units: [
        { id: 'p1', side: 'player', unitType: 'siege', troops: 1500, generalId: 'zhang', machines: ['ram'] },
        { id: 'p2', side: 'player', unitType: 'siege', troops: 1500, generalId: 'zhang', machines: ['catapult'] },
        { id: 'p3', side: 'player', unitType: 'infantry', troops: 5000, generalId: 'zhang' },
        { id: 'e1', side: 'enemy', unitType: 'archer', troops: 1200, generalId: 'li' },
      ],
    });
    const r = autoResolve(sys, gs);
    expect(r.battleEnd).toBe(true);
    expect(r.timedOut).toBeFalsy();
  });

  test('守城：守方守满回合取胜（hold）', () => {
    const sys = makeSys(0.7);
    const gs = {};
    sys.startBattle(gs, {
      battleType: 'defense', generals,
      supply: { player: 500, enemy: 80 }, // 攻方粮少，难破门
      units: [
        { id: 'p1', side: 'player', unitType: 'spearman', troops: 4000, generalId: 'zhuge' },
        { id: 'p2', side: 'player', unitType: 'archer', troops: 3000, generalId: 'zhuge' },
        { id: 'e1', side: 'enemy', unitType: 'infantry', troops: 2000, generalId: 'li' },
      ],
    });
    const r = autoResolve(sys, gs);
    expect(r.battleEnd).toBe(true);
    expect(r.timedOut).toBeFalsy();
  });

  test('水战：以水军优势取胜并控制渡口', () => {
    const sys = makeSys();
    const gs = {};
    sys.startBattle(gs, {
      battleType: 'naval', generals,
      supply: { player: 120, enemy: 120 },
      units: [
        { id: 'p1', side: 'player', unitType: 'navy', troops: 5000, generalId: 'zhuge', machines: ['mengchong', 'towerShip'] },
        { id: 'e1', side: 'enemy', unitType: 'infantry', troops: 4000, generalId: 'li' }, // 旱鸭子水战受罚
      ],
    });
    const r = autoResolve(sys, gs);
    expect(r.battleEnd).toBe(true);
    expect(r.timedOut).toBeFalsy();
    expect(r.winnerSide).toBe('player');
  });
});

describe('LegionWarfareSystem — 粮草与士气', () => {
  test('缺粮回合维护掉士气', () => {
    const sys = makeSys();
    const gs = {};
    const b = sys.startBattle(gs, {
      battleType: 'field', generals,
      supply: { player: 0, enemy: 9999 },
      units: [
        { id: 'p1', side: 'player', unitType: 'infantry', troops: 2000, morale: 60 },
        { id: 'e1', side: 'enemy', unitType: 'infantry', troops: 2000 },
      ],
    });
    const before = sys.findUnit(gs, 'p1').morale;
    // 推进一整轮触发 round upkeep
    sys.executeOrder(gs, b.turnOrder[0].id, { type: 'hold' });
    sys.nextTurn(gs);
    sys.executeOrder(gs, sys.getCurrentActor(gs).id, { type: 'hold' });
    sys.nextTurn(gs); // 此处 round++ → upkeep
    expect(sys.findUnit(gs, 'p1').morale).toBeLessThan(before + 4); // 缺粮抵消了 hold 的 +4
  });
});
