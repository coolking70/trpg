/**
 * war.js 作战数据层单测（Phase 41 W1）
 */
import {
  XUN_PER_SEASON, MARCH_BASE_ETA, regionDistance, MARCH_POSTURES, POSTURE_KEYS,
  marchEta, postureMoraleMod, intelRange, marchDetectChance, siegeTick, siegeOutcome, validateRegions,
} from '../../src/data/war.js';
import { buildSiege, simulateSiege, runWarBalance, standardScenarios } from '../../src/systems/warSimulator.js';

const REGIONS = {
  yizhou: { name: '益州', adjacency: ['hanzhong', 'jingzhou'] },
  hanzhong: { name: '汉中', adjacency: ['yizhou', 'guanzhong'] },
  guanzhong: { name: '关中', adjacency: ['hanzhong', 'zhongyuan'] },
  zhongyuan: { name: '中原', adjacency: ['guanzhong', 'jingzhou'] },
  jingzhou: { name: '荆州', adjacency: ['yizhou', 'zhongyuan', 'jiangdong'] },
  jiangdong: { name: '江东', adjacency: ['jingzhou'] },
};

describe('地理 / 时钟', () => {
  test('regionDistance BFS 跳数', () => {
    expect(regionDistance(REGIONS, 'yizhou', 'yizhou')).toBe(0);
    expect(regionDistance(REGIONS, 'yizhou', 'hanzhong')).toBe(1);
    expect(regionDistance(REGIONS, 'yizhou', 'guanzhong')).toBe(2);
    expect(regionDistance(REGIONS, 'yizhou', 'jiangdong')).toBe(2); // yizhou→jingzhou→jiangdong
    expect(regionDistance(REGIONS, 'yizhou', 'nowhere')).toBe(Infinity);
  });
  test('季=3旬', () => { expect(XUN_PER_SEASON).toBe(3); });
});

describe('行军姿态 / ETA', () => {
  test('姿态表', () => {
    expect(POSTURE_KEYS).toEqual(['raid', 'open']);
    expect(MARCH_POSTURES.raid.allyResponse).toBe(false);
    expect(MARCH_POSTURES.open.allyResponse).toBe(true);
  });
  test('ETA：距离越远越久；adjacent 也需时间；突袭略快', () => {
    expect(marchEta(0, 'open')).toBeGreaterThanOrEqual(1);
    expect(marchEta(3, 'open')).toBeGreaterThan(marchEta(1, 'open'));
    expect(marchEta(3, 'raid')).toBeLessThanOrEqual(marchEta(3, 'open'));
  });
  test('公开讨伐攻方士气加成 > 突袭', () => {
    expect(postureMoraleMod('open')).toBeGreaterThan(postureMoraleMod('raid'));
  });
});

describe('情报', () => {
  test('intelRange 随智力统率上升；无主将=1', () => {
    expect(intelRange(null)).toBe(1);
    expect(intelRange({ warfare: { intellect: 100, command: 95 } })).toBeGreaterThan(intelRange({ warfare: { intellect: 40, command: 40 } }));
  });
  test('超出半径不可探；半径内公开易于突袭', () => {
    const gen = { warfare: { intellect: 90, command: 90 } }; // range ~3
    expect(marchDetectChance(99, gen, 'open')).toBe(0);
    const open = marchDetectChance(1, gen, 'open');
    const raid = marchDetectChance(1, gen, 'raid');
    expect(open).toBeGreaterThan(raid);
    expect(open).toBeGreaterThan(0);
  });
});

describe('围城消耗 / 结局', () => {
  const mk = (over = {}) => ({
    mode: 'assault', xun: 0, machinePower: 40,
    atk: { troops: 20000, morale: 80, supply: 200 },
    def: { troops: 8000, supply: 150, morale: 70 },
    works: { gate: 220, wall: 320 },
    ...over,
  });

  test('强攻：城防伤大、攻方重耗', () => {
    const s = mk(); const before = { gate: s.works.gate, atk: s.atk.troops };
    siegeTick(s);
    expect(s.works.gate).toBeLessThan(before.gate);
    expect(s.atk.troops).toBeLessThan(before.atk);
  });
  test('围困：城防几乎不伤、攻守皆耗粮（断粮赛跑）', () => {
    const s = mk({ mode: 'blockade' }); const gate0 = s.works.gate, food0 = s.def.supply, atkSup0 = s.atk.supply;
    siegeTick(s);
    expect(gate0 - s.works.gate).toBeLessThanOrEqual(3);     // 城防几乎不伤
    expect(food0 - s.def.supply).toBeGreaterThan(0);          // 守方缓慢断粮
    expect(atkSup0 - s.atk.supply).toBeGreaterThan(0);        // 攻方亦耗粮（比拼存粮）
  });
  test('结局：破门→breach / 守粮尽→surrender / 攻方崩→retreat / 守军尽→fallen', () => {
    expect(siegeOutcome(mk({ works: { gate: 0, wall: 100 } })).type).toBe('breach');
    expect(siegeOutcome(mk({ def: { troops: 5000, supply: 0, morale: 50 } })).type).toBe('surrender');
    expect(siegeOutcome(mk({ atk: { troops: 20000, morale: 10, supply: 50 } })).type).toBe('retreat');
    expect(siegeOutcome(mk({ def: { troops: 0, supply: 100, morale: 50 } })).type).toBe('fallen');
    expect(siegeOutcome(mk())).toBeNull(); // 相持中
  });
  test('破城需可用之兵：攻破城门但残兵不足→退兵而非破城', () => {
    // 城门已破，但攻方残兵不足守军四成 → 顿兵而退
    const spent = mk({ works: { gate: 0, wall: 100 }, atk: { troops: 2000, morale: 60, supply: 80 }, def: { troops: 8000, supply: 100, morale: 60 } });
    expect(siegeOutcome(spent).type).toBe('retreat');
  });
  test('多旬强攻最终破门', () => {
    const s = mk(); let out = null;
    for (let i = 0; i < 30 && !out; i++) { siegeTick(s); out = siegeOutcome(s); }
    expect(out).toBeTruthy();
  });
});

describe('围城平衡：四条结局路径皆可达', () => {
  test('标准场景集覆盖 breach / retreat / surrender', () => {
    const r = runWarBalance(standardScenarios());
    expect(r.byType.breach?.count).toBeGreaterThan(0);     // 强军强攻可破城
    expect(r.byType.retreat?.count).toBeGreaterThan(0);    // 弱军/乏粮/被扰可退兵
    expect(r.byType.surrender?.count).toBeGreaterThan(0);  // 围困乏粮孤城可献城
    // 不应出现卡死的 timeout
    expect(r.byType.timeout).toBeUndefined();
  });
  test('强军强攻坚城→breach；攻方粮少围困足粮坚城→retreat（坚守待退成立）', () => {
    const breach = simulateSiege(buildSiege({ posture: 'open', atkTroops: 20000, atkFood: 1200, defTroops: 8000, defFood: 600 }), { atkPolicy: () => 'assault' });
    expect(breach.type).toBe('breach');
    const hold = simulateSiege(buildSiege({ posture: 'open', atkTroops: 14000, atkFood: 500, defTroops: 7000, defFood: 1200 }), { atkPolicy: () => 'blockade' });
    expect(hold.type).toBe('retreat');
  });
});

describe('校验', () => {
  test('合法区域图通过；悬挂邻接报错', () => {
    expect(validateRegions(REGIONS)).toEqual([]);
    expect(validateRegions({ a: { adjacency: ['ghost'] } }).length).toBe(1);
  });
});
