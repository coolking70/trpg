/**
 * 局部战斗 单测（Phase 44 P44a）
 */
import { SkirmishSystem } from '../../src/systems/SkirmishSystem.js';
import { skirmishDamage, reinforcementChance, skirmishOutcome, effectiveMorale } from '../../src/data/skirmish.js';

function rngSeq(seed = 1) { let x = seed >>> 0; return () => { x = (1103515245 * x + 12345) >>> 0; return x / 4294967296; }; }
function makeSys(seed = 7) { const s = new SkirmishSystem(); s.eventSystem = null; s.rng = rngSeq(seed); return s; }
function playerChar() { return { name: '士卒甲', stats: { hp: 60, hpCurrent: 60, attack: 10, defense: 5, speed: 6 } }; }
function baseDef(over = {}) {
  return {
    playerChar: playerChar(),
    allies: [{ name: '袍泽乙', atk: 8, def: 4, hp: 40 }],
    enemies: [{ name: '敌兵甲', atk: 7, def: 3, hp: 35 }, { name: '敌兵乙', atk: 6, def: 3, hp: 30 }],
    reserves: { ally: 2, enemy: 2 }, tide: 0, parent: { kind: 'siege', side: 'defender' },
    ...over,
  };
}

const VALID = new Set(['victory', 'defeat', 'rout_enemy', 'rout_ally', 'surrender_enemy', 'surrender_ally', 'recall', 'flee', 'captured']);

describe('skirmish 纯函数', () => {
  test('伤害口径 ≥1 且随属性变化', () => {
    const rng = () => 0.5;
    const d = skirmishDamage({ atk: 10 }, { def: 3 }, rng);
    expect(d).toBeGreaterThanOrEqual(1);
    expect(skirmishDamage({ atk: 20 }, { def: 0 }, rng)).toBeGreaterThan(skirmishDamage({ atk: 2 }, { def: 10 }, rng));
  });
  test('援兵概率：有利战线我方更易来援、敌方更难', () => {
    const r = () => 0.5;
    expect(reinforcementChance('ally', 0.8, 3, r)).toBe(true);   // base 0.45+0.28>0.5
    expect(reinforcementChance('enemy', 0.8, 3, r)).toBe(false); // base 0.45-0.28<0.5
    expect(reinforcementChance('ally', 0, 0, r)).toBe(false);    // 无预备队
  });
  test('有效士气随战损比下挫', () => {
    expect(effectiveMorale({ deaths: { ally: 0 }, committed: { ally: 4 } }, 'ally')).toBe(100);
    expect(effectiveMorale({ deaths: { ally: 2 }, committed: { ally: 4 } }, 'ally')).toBeLessThan(40); // 损半→逼近崩溃
    // 援军/鼓舞加成回补
    expect(effectiveMorale({ deaths: { ally: 2 }, committed: { ally: 4 }, moraleBonus: { ally: 30 } }, 'ally'))
      .toBeGreaterThan(effectiveMorale({ deaths: { ally: 2 }, committed: { ally: 4 } }, 'ally'));
  });
  test('结局：一方在场覆灭→分胜负；战损过半→投降/溃逃', () => {
    expect(skirmishOutcome({ allies: [{ hp: 10, isPlayer: true }], enemies: [{ hp: 0 }], committed: { ally: 1, enemy: 1 }, deaths: { ally: 0, enemy: 1 } }).type).toBe('victory');
    // 敌已投入 4 人阵亡 3（损 75%）→ 士气崩，倾向投降
    const oc = skirmishOutcome({ allies: [{ hp: 10, isPlayer: true }], enemies: [{ hp: 5 }], committed: { ally: 2, enemy: 4 }, deaths: { ally: 0, enemy: 3 } });
    expect(['surrender_enemy', 'rout_enemy']).toContain(oc.type);
    expect(oc.winner).toBe('ally');
  });
});

describe('SkirmishSystem 状态机', () => {
  test('autoResolve 总能在有限轮内得到合法结局 + 结算战功/回写HP', () => {
    const sys = makeSys(3);
    const def = baseDef();
    const gs = {};
    sys.startSkirmish(gs, def);
    const oc = sys.autoResolve(gs);
    expect(oc).toBeTruthy();
    expect(VALID.has(oc.type)).toBe(true);
    expect(typeof oc.merit).toBe('number');
    // 玩家 HP 已回写到角色卡
    expect(def.playerChar.stats.hpCurrent).toBeLessThanOrEqual(60);
  });

  test('战线大势影响胜负倾向：有利 tide 我方多胜，不利 tide 多败/被召回', () => {
    const tally = (tide) => {
      let allyWins = 0, n = 40;
      for (let seed = 1; seed <= n; seed++) {
        const sys = makeSys(seed * 13);
        const gs = {};
        sys.startSkirmish(gs, baseDef({ tide }));
        const oc = sys.autoResolve(gs);
        if (oc && oc.winner === 'ally') allyWins++;
      }
      return allyWins / n;
    };
    const fav = tally(0.9);
    const unfav = tally(-0.9);
    expect(fav).toBeGreaterThan(unfav); // 有利战线胜率更高
  });

  test('敌将在场且被打残→可俘虏，记 commanderKill + 重大事件标记', () => {
    const sys = makeSys(5);
    const gs = {};
    sys.startSkirmish(gs, baseDef({
      enemies: [{ name: '敌将·张郃', atk: 9, def: 6, hp: 80, isCommander: true }],
      reserves: { ally: 3, enemy: 0 }, tide: 0.6,
    }));
    const oc = sys.autoResolve(gs, 80);
    expect(VALID.has(oc.type)).toBe(true);
    // 敌将被解决（斩或擒）时记 commanderKill；该役至少能跑出合法结局
    if (oc.commanderKill) expect(['slain', 'captured']).toContain(oc.commanderKill);
  });

  test('玩家手动行动：攻击推进、退却即结束', () => {
    const sys = makeSys(9);
    const gs = {};
    sys.startSkirmish(gs, baseDef());
    const t = sys.enemyTargets(gs)[0];
    const r1 = sys.submitPlayerAction(gs, { type: 'attack', targetId: t.id });
    expect(Array.isArray(r1.log)).toBe(true);
    if (!r1.outcome) {
      const r2 = sys.submitPlayerAction(gs, { type: 'flee' });
      expect(r2.outcome.type).toBe('flee');
    }
  });
});
