/**
 * 主题包：中世纪西式奇幻（Phase 42 T4）
 *
 * 以 strategySchema 换皮通用战略/作战/战术引擎——只改数据，不碰逻辑。
 * 结构槽位沿用：资源键 gold/food/troops/order；政令 6 原型键；外交键；战型键 field/siege/defense/naval；
 *   行军姿态键 raid/open；战法键 charge/fire/ambush/rally（火攻→法术轰击）。
 * 仅替换名称/数值/克制/阵型/兵种，实现迥异题材观感。
 */

export const medievalFantasySchema = {
  resources: {
    gold: { name: '金币', icon: '🪙' },
    food: { name: '粮秣', icon: '🌾' },
    troops: { name: '兵员', icon: '⚔' },
    order: { name: '民心', icon: '🛡' },
  },
  unitTypes: {
    swordsman: { name: '剑士', melee: 11, def: 10, ranged: 0, speed: 5, charge: 1.0, water: 0.5, wishFormation: 'shieldwall' },
    knight:    { name: '骑士', melee: 15, def: 8,  ranged: 0, speed: 9, charge: 1.7, water: 0.2, wishFormation: 'wedge' },
    archer:    { name: '弓手', melee: 5,  def: 5,  ranged: 11, speed: 5, charge: 1.0, water: 0.5, wishFormation: 'skirmish' },
    pikeman:   { name: '长枪兵', melee: 9, def: 12, ranged: 0, speed: 4, charge: 1.0, water: 0.4, wishFormation: 'shieldwall' },
    mage:      { name: '法师', melee: 3,  def: 4,  ranged: 13, speed: 5, charge: 1.0, water: 0.5, wishFormation: 'skirmish' },
    galley:    { name: '战船', melee: 9,  def: 9,  ranged: 4,  speed: 6, charge: 1.0, water: 1.6 },
  },
  // 克制：长枪克骑、骑克弓与法师、弓克剑、剑近身克弓、法师范围克长枪密阵、战船水战通吃
  counterMatrix: {
    pikeman:   { knight: 1.7 },
    knight:    { archer: 1.5, mage: 1.4, swordsman: 1.15 },
    archer:    { swordsman: 1.3, pikeman: 1.1 },
    swordsman: { archer: 1.3 },
    mage:      { pikeman: 1.4, swordsman: 1.2 },
    galley:    { swordsman: 1.3, knight: 1.5, archer: 1.2, pikeman: 1.3, mage: 1.2 },
  },
  formations: {
    none:       { name: '无阵', statMods: {}, requiresTactics: 0, note: '未列阵' },
    shieldwall: { name: '盾墙', statMods: { def: 1.35, atk: 0.85, morale: 1.1 }, requiresTactics: 0, note: '防御阵，正面铁壁' },
    column:     { name: '纵队', statMods: { speed: 1.3, def: 0.9 }, requiresTactics: 1, note: '机动阵，利转进' },
    wedge:      { name: '楔形', statMods: { atk: 1.35, charge: 1.35, def: 0.8 }, requiresTactics: 2, note: '冲锋阵，骑兵破阵' },
    crescent:   { name: '半月', statMods: { atk: 1.15, range: 1.25, def: 0.95 }, requiresTactics: 2, note: '包抄阵，远程合围' },
    skirmish:   { name: '散兵', statMods: { range: 1.4, atk: 1.05, def: 0.85 }, requiresTactics: 1, note: '游击阵，弓弩法师齐射' },
  },
  machines: {
    trebuchet: { name: '投石机', effect: { vs: 'wall', power: 42, area: true },  mobility: 0.3, battleTypes: ['siege', 'defense'] },
    ram:       { name: '破城槌', effect: { vs: 'gate', power: 56, area: false }, mobility: 0.2, battleTypes: ['siege'] },
    ballista:  { name: '弩炮',   effect: { vs: 'unit', power: 22, area: false }, mobility: 0.5, battleTypes: ['field', 'siege', 'defense'] },
    warGalley: { name: '战桨船', effect: { vs: 'naval', power: 30, area: true }, mobility: 0.5, battleTypes: ['naval'] },
    fireship:  { name: '火船',   effect: { vs: 'naval', power: 28, area: false }, mobility: 0.9, battleTypes: ['naval'] },
  },
  tactics: {
    charge: { name: '冲锋', stat: 'command',   baseChance: 0.55, note: '骑士楔形突进，附加冲锋加成' },
    fire:   { name: '法术轰击', stat: 'intellect', baseChance: 0.45, note: '法师群法术，大范围灼烧巨创' },
    ambush: { name: '伏击', stat: 'intellect', baseChance: 0.5,  note: '林间设伏，奇袭一军' },
    rally:  { name: '鼓舞', stat: 'command',   baseChance: 0.7,  note: '统帅激励，提振士气' },
  },
  marchPostures: {
    raid: { name: '潜行奇袭', detect: 0.30, allyResponse: false, attackerMorale: 0, defenderPrep: 0.35, etaFactor: 0.85 },
    open: { name: '举旗讨伐', detect: 0.90, allyResponse: true, attackerMorale: 12, defenderPrep: 1.0, etaFactor: 1.0 },
  },
  holdingTypes: {
    capital:  { name: '王城', prod: 1.3, def: 1.25, recruit: 1.3 },
    city:     { name: '城镇', prod: 1.1, def: 1.0,  recruit: 1.1 },
    fortress: { name: '要塞', prod: 0.6, def: 1.6,  recruit: 0.9 },
    port:     { name: '港口', prod: 1.2, def: 0.9,  recruit: 0.8 },
    granary:  { name: '粮仓', prod: 1.4, def: 0.8,  recruit: 0.7 },
    pasture:  { name: '牧场', prod: 0.9, def: 0.8,  recruit: 1.2 },
  },
  policies: {
    farming:   { name: '垦荒', cost: { gold: 10 }, note: '开垦农庄、兴修水渠，增粮提产。' },
    tax:       { name: '征税', cost: {}, note: '加征赋税充实金库，然伤民心。' },
    conscript: { name: '募兵', cost: { gold: 20, food: 10 }, note: '招募义勇入伍，扩充兵员。' },
    fortify:   { name: '筑垒', cost: { gold: 30 }, note: '修筑城墙箭塔，提升治安防御。' },
    relief:    { name: '赈济', cost: { gold: 20, food: 20 }, note: '开仓赈民，民心大涨。' },
    develop:   { name: '营建', cost: { gold: 25 }, note: '兴建工坊与市集，长效增产。' },
  },
  diplomacyActions: {
    alliance:    { name: '缔结盟约', cost: { gold: 50 }, note: '歃血结盟，共御外敌（需关系≥40）。' },
    declare_war: { name: '宣战', cost: {}, note: '递下战书，刀兵相向。' },
    sue_peace:   { name: '议和', cost: { gold: 60, food: 40 }, note: '献金求和，止戈休兵。' },
    tribute:     { name: '纳贡', cost: { gold: 40 }, note: '遣使纳贡，修好邦交。' },
    marriage:    { name: '联姻', cost: { gold: 40 }, note: '王室联姻，稳固同盟（需关系≥30）。' },
    sow_discord: { name: '挑拨', cost: { gold: 30 }, note: '遣密探散布谣言，离间两方。' },
  },
  defaultBattleUnits: { defender: 'pikeman', defenderSupport: 'archer', attacker: 'swordsman', attackerShock: 'knight' },
  narration: {
    settingTone: '中世纪西式奇幻：王国林立、骑士与法师并肩，围绕城堡与王权征战。',
    postures: { raid: '潜行奇袭（轻骑潜行，敌不及备）', open: '举旗誓师讨伐（传檄召盟，士气如虹）' },
    siegeVerbs: { breach: '城门洞开', surrender: '粮尽开城', fallen: '城堡陷落', retreat: '攻方撤围' },
    terms: { general: '统帅', troops: '军队', holding: '城堡', faction: '王国', march: '进军' },
    skirmish: {
      ally: '同袍士兵', allyReinforce: '驰援的骑士小队', enemy: '敌国士卒', enemyReinforce: '敌方增援队',
      nco: '军士长', commanderTitle: '骑士统领',
      commanders: ['黑鸦骑士', '断剑团长', '铁誓骑士', '荆棘公爵', '灰鹰骑士'],
    },
  },
};

export default medievalFantasySchema;
