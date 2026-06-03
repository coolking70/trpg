/**
 * 主题包：现代战争（Phase 42 T4）
 *
 * 以 strategySchema 换皮通用战略/作战/战术引擎——只改数据，不碰逻辑。
 * 结构槽位沿用：资源键 gold/food/troops/order（金→资金、粮→补给、兵→兵力、民心→民意）；
 *   政令 6 原型键；外交键；战型键 field/siege/defense/naval（攻城=攻坚、水战=海战）；
 *   行军姿态键 raid/open（突袭=闪击、公开=宣战进攻）；战法键 charge/fire/ambush/rally。
 */

export const modernWarSchema = {
  resources: {
    gold: { name: '资金', icon: '💵' },
    food: { name: '补给', icon: '📦' },
    troops: { name: '兵力', icon: '🪖' },
    order: { name: '民意', icon: '📊' },
  },
  unitTypes: {
    // 沿用 melee/def/ranged/speed/charge/water 结构：melee=近/直射火力，ranged=曲射/远程火力
    infantry:  { name: '步兵', melee: 10, def: 9,  ranged: 3, speed: 5, charge: 1.0, water: 0.5, wishFormation: 'line' },
    armor:     { name: '装甲', melee: 16, def: 12, ranged: 0, speed: 9, charge: 1.6, water: 0.2, wishFormation: 'spearhead' },
    artillery: { name: '炮兵', melee: 4,  def: 5,  ranged: 14, speed: 4, charge: 1.0, water: 0.3, wishFormation: 'dispersed' },
    aa:        { name: '防空', melee: 6,  def: 8,  ranged: 9, speed: 5, charge: 1.0, water: 0.3, wishFormation: 'dispersed' },
    airforce:  { name: '空军', melee: 13, def: 5,  ranged: 10, speed: 12, charge: 1.3, water: 0.6 },
    navy:      { name: '海军', melee: 11, def: 10, ranged: 8, speed: 7, charge: 1.0, water: 1.7 },
  },
  // 克制：装甲克步炮、步兵(反坦克)略克装甲、炮兵克步与防空、防空克空军、空军克装甲与海军、海军海战通吃
  counterMatrix: {
    armor:     { infantry: 1.4, artillery: 1.5 },
    infantry:  { armor: 1.15, aa: 1.1 },
    artillery: { infantry: 1.35, aa: 1.3, armor: 1.1 },
    aa:        { airforce: 1.8 },
    airforce:  { armor: 1.5, navy: 1.4, artillery: 1.3 },
    navy:      { infantry: 1.3, armor: 1.4, artillery: 1.2, airforce: 1.1 },
  },
  formations: {
    none:      { name: '无队形', statMods: {}, requiresTactics: 0, note: '未展开' },
    line:      { name: '战线', statMods: { def: 1.3, atk: 0.9, morale: 1.1 }, requiresTactics: 0, note: '坚守战线，正面防御' },
    column:    { name: '行军纵队', statMods: { speed: 1.3, def: 0.9 }, requiresTactics: 1, note: '快速机动转进' },
    spearhead: { name: '装甲楔', statMods: { atk: 1.35, charge: 1.3, def: 0.8 }, requiresTactics: 2, note: '装甲突击，钢铁洪流' },
    envelop:   { name: '钳形', statMods: { atk: 1.2, range: 1.2, def: 0.9 }, requiresTactics: 2, note: '两翼包抄合围' },
    dispersed: { name: '疏开', statMods: { range: 1.4, atk: 1.05, def: 0.85 }, requiresTactics: 1, note: '疏散队形，火力压制' },
  },
  machines: {
    rocketArty:  { name: '火箭炮', effect: { vs: 'unit', power: 30, area: true },  mobility: 0.6, battleTypes: ['field', 'siege', 'defense'] },
    heavyArty:   { name: '重炮',   effect: { vs: 'wall', power: 44, area: true },  mobility: 0.3, battleTypes: ['siege', 'defense'] },
    demolition:  { name: '爆破工兵', effect: { vs: 'gate', power: 55, area: false }, mobility: 0.4, battleTypes: ['siege'] },
    destroyer:   { name: '驱逐舰', effect: { vs: 'naval', power: 32, area: false }, mobility: 0.6, battleTypes: ['naval'] },
    carrier:     { name: '航母编队', effect: { vs: 'naval', power: 34, area: true }, mobility: 0.4, battleTypes: ['naval'] },
  },
  tactics: {
    charge: { name: '突击', stat: 'command',   baseChance: 0.55, note: '装甲突击，附加冲锋加成' },
    fire:   { name: '火力覆盖', stat: 'intellect', baseChance: 0.5,  note: '炮火/空袭覆盖，大范围杀伤' },
    ambush: { name: '伏击', stat: 'intellect', baseChance: 0.5,  note: '设伏待敌，奇袭一部' },
    rally:  { name: '动员', stat: 'command',   baseChance: 0.7,  note: '战场动员，鼓舞士气' },
  },
  marchPostures: {
    raid: { name: '闪击', detect: 0.25, allyResponse: false, attackerMorale: 4, defenderPrep: 0.30, etaFactor: 0.7 },
    open: { name: '宣战进攻', detect: 0.92, allyResponse: true, attackerMorale: 10, defenderPrep: 1.0, etaFactor: 1.0 },
  },
  holdingTypes: {
    capital:  { name: '首都', prod: 1.3, def: 1.2, recruit: 1.3 },
    city:     { name: '工业城', prod: 1.35, def: 0.95, recruit: 1.1 },
    fortress: { name: '要塞', prod: 0.6, def: 1.7, recruit: 0.9 },
    port:     { name: '军港', prod: 1.1, def: 1.0, recruit: 0.9 },
    granary:  { name: '补给基地', prod: 1.4, def: 0.8, recruit: 0.7 },
    pasture:  { name: '训练营', prod: 0.8, def: 0.9, recruit: 1.4 },
  },
  policies: {
    farming:   { name: '生产', cost: { gold: 10 }, note: '扩大军工生产，增补给与产能。' },
    tax:       { name: '征税', cost: {}, note: '加征战时税，充实资金，伤民意。' },
    conscript: { name: '征召', cost: { gold: 20, food: 10 }, note: '征召新兵入伍，扩充兵力。' },
    fortify:   { name: '设防', cost: { gold: 30 }, note: '构筑工事防线，提升治安防御。' },
    relief:    { name: '民生', cost: { gold: 20, food: 20 }, note: '改善民生配给，民意大涨。' },
    develop:   { name: '基建', cost: { gold: 25 }, note: '兴建工厂铁路，长效增产。' },
  },
  diplomacyActions: {
    alliance:    { name: '结盟', cost: { gold: 50 }, note: '缔结军事同盟，共同防卫（需关系≥40）。' },
    declare_war: { name: '宣战', cost: {}, note: '正式宣战，开启战端。' },
    sue_peace:   { name: '停战', cost: { gold: 60, food: 40 }, note: '签署停火协议，止戈。' },
    tribute:     { name: '援助', cost: { gold: 40 }, note: '提供经济军援，改善关系。' },
    marriage:    { name: '战略协作', cost: { gold: 40 }, note: '深化战略伙伴，稳固同盟（需关系≥30）。' },
    sow_discord: { name: '渗透', cost: { gold: 30 }, note: '情报渗透，离间敌对阵营。' },
  },
  defaultBattleUnits: { defender: 'infantry', defenderSupport: 'artillery', attacker: 'infantry', attackerShock: 'armor' },
  narration: {
    settingTone: '现代战争：列国对峙，装甲、炮兵、海空军协同，围绕工业城市与要塞攻防。',
    postures: { raid: '闪电突袭（隐蔽机动，敌雷达难察）', open: '正式宣战进攻（盟友响应，士气高涨但暴露意图）' },
    siegeVerbs: { breach: '防线被突破', surrender: '守军投降', fallen: '阵地失守', retreat: '攻势受挫撤退' },
    terms: { general: '指挥官', troops: '部队', holding: '城市', faction: '国家', march: '推进' },
    skirmish: {
      ally: '同班战友', allyReinforce: '增援的步兵班', enemy: '敌军士兵', enemyReinforce: '敌方增援',
      nco: '军士', commanderTitle: '校官',
      commanders: ['钢铁上校', '铁壁少校', '赤狼中校', '幽灵上尉', '黑隼少将'],
    },
  },
};

export default modernWarSchema;
