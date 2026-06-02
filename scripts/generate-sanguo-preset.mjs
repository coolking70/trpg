// 手写三国 digest + blueprint 生成器（Phase 31 L6）
// 数据驱动：紧凑地定义人物武备与章节，展开为管线段①②产物，保证 generalRef/beat 引用一致。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- 人物（含 warfare 主将武备：统率/武力/智力/阵法等级/战法） ----------
const W = (command, might, intellect, tactics, abilities) => ({ command, might, intellect, tactics, abilities });
const chars = [
  { id: 'liubei', name: '刘备', title: '汉左将军', faction: 'shu', role: 'protagonist', desc: '仁德之主，矢志匡扶汉室。', warfare: W(80, 70, 76, 2, ['rally', 'charge']) },
  { id: 'guanyu', name: '关羽', title: '汉寿亭侯', faction: 'shu', role: 'companion', desc: '义薄云天，万人之敌。', warfare: W(90, 97, 75, 2, ['charge', 'rally']) },
  { id: 'zhangfei', name: '张飞', title: '万夫不当', faction: 'shu', role: 'companion', desc: '当阳桥头一声吼，吓退曹兵百万。', warfare: W(80, 96, 48, 1, ['charge']) },
  { id: 'zhaoyun', name: '赵云', title: '常山赵子龙', faction: 'shu', role: 'companion', desc: '一身是胆，长坂坡七进七出。', warfare: W(86, 95, 76, 2, ['charge', 'ambush']) },
  { id: 'zhugeliang', name: '诸葛亮', title: '卧龙', faction: 'shu', role: 'companion', desc: '运筹帷幄，神机妙算。', warfare: W(92, 42, 100, 3, ['fire', 'ambush', 'rally']) },
  { id: 'huangzhong', name: '黄忠', title: '老当益壮', faction: 'shu', role: 'companion', desc: '定军山斩夏侯渊。', warfare: W(82, 93, 62, 2, ['charge']) },
  { id: 'weiyan', name: '魏延', title: '镇远将军', faction: 'shu', role: 'companion', desc: '勇略兼备，性情孤高。', warfare: W(80, 88, 62, 2, ['charge', 'ambush']) },
  { id: 'masu', name: '马谡', title: '参军', faction: 'shu', role: 'npc', desc: '才器过人，言过其实。', warfare: W(64, 50, 72, 1, ['rally']) },
  { id: 'caocao', name: '曹操', title: '魏王', faction: 'wei', role: 'boss', desc: '治世之能臣，乱世之奸雄。', warfare: W(96, 72, 91, 3, ['fire', 'ambush', 'rally']) },
  { id: 'xiahoudun', name: '夏侯惇', title: '独眼将军', faction: 'wei', role: 'boss', desc: '拔矢啖睛，悍勇无双。', warfare: W(85, 90, 60, 2, ['charge']) },
  { id: 'zhangliao', name: '张辽', title: '荡寇将军', faction: 'wei', role: 'boss', desc: '威震逍遥津。', warfare: W(90, 92, 78, 2, ['charge', 'ambush']) },
  { id: 'simayi', name: '司马懿', title: '骠骑将军', faction: 'wei', role: 'boss', desc: '深谋远虑，鹰视狼顾。', warfare: W(92, 65, 98, 3, ['fire', 'ambush', 'rally']) },
  { id: 'sunquan', name: '孙权', title: '吴侯', faction: 'wu', role: 'npc', desc: '坐断东南，雄踞江东。', warfare: W(80, 68, 80, 2, ['rally']) },
  { id: 'zhouyu', name: '周瑜', title: '大都督', faction: 'wu', role: 'npc', desc: '雄姿英发，火烧赤壁。', warfare: W(94, 70, 96, 3, ['fire', 'ambush', 'rally']) },
  { id: 'luxun', name: '陆逊', title: '书生都督', faction: 'wu', role: 'boss', desc: '火烧连营七百里。', warfare: W(90, 60, 95, 3, ['fire', 'ambush', 'rally']) },
  { id: 'lvbu', name: '吕布', title: '飞将', faction: 'qun', role: 'boss', desc: '人中吕布，马中赤兔。', warfare: W(75, 100, 55, 1, ['charge']) },
  { id: 'menghuo', name: '孟获', title: '南蛮王', faction: 'qun', role: 'boss', desc: '据守南中，桀骜不驯。', warfare: W(70, 82, 46, 1, ['charge']) },
];

const factions = [
  { id: 'shu', name: '蜀汉' }, { id: 'wei', name: '曹魏' },
  { id: 'wu', name: '东吴' }, { id: 'qun', name: '群雄' },
];

// ---------- 章节定义（紧凑 DSL） ----------
// pcombat: 个人战(单挑/暗杀/逃脱) -> combatPlan ; legion: 军团战 -> legionBattlePlan
// U(unitType, troops, generalRef, formation?, machines?)
const U = (unitType, troops, generalRef, extra = {}) => ({ unitType, troops, generalRef, ...extra });

const chapters = [
  { id: 'taoyuan', title: '桃园结义', beat: '黄巾之乱，三人结义起兵。',
    main: { title: '桃园三结义', summary: '刘关张义结金兰，誓共匡扶汉室。' },
    branch: ['即刻招募乡勇起兵', '先观望天下大势'],
    side: [{ type: 'sidequest', name: '招募乡勇', summary: '在涿县募集义军。' }] },

  { id: 'hulao', title: '虎牢关·三英战吕布', beat: '十八路诸侯讨董，虎牢关前会吕布。',
    main: { title: '会盟讨董', summary: '诸侯结盟，进逼虎牢关。' },
    branch: ['三兄弟合力上前迎战吕布', '按兵不动以待战机'],
    pcombat: [{ enemyConcept: '吕布', difficulty: 4, count: 1 }],
    side: [{ type: 'vignette', name: '辕门射戟', summary: '吕布辕门立戟，箭定纷争。' }] },

  { id: 'xiapi', title: '下邳·白门楼', beat: '曹刘联手围吕布于下邳。',
    main: { title: '水淹下邳', summary: '决泗水灌城，困死吕布。' },
    branch: ['强攻城门速战速决', '断其粮道徐徐图之'],
    legion: [{ name: '下邳攻城', battleType: 'siege', supply: { player: 160, enemy: 90 },
      our: [U('siege', 1500, 'liubei', { machines: ['ram'] }), U('siege', 1500, 'guanyu', { machines: ['catapult'] }), U('infantry', 6000, 'zhangfei'), U('archer', 2500, 'guanyu')],
      enemy: [U('cavalry', 4800, 'lvbu'), U('infantry', 6500, 'lvbu')] }],
    pcombat: [{ enemyConcept: '白门楼·吕布殊死一搏', difficulty: 4, count: 1 }] },

  { id: 'guandu', title: '官渡之战', beat: '袁曹决战官渡，刘备暂附袁绍。',
    main: { title: '官渡对峙', summary: '两军隔河相持，粮草成胜负之机。' },
    branch: ['奇袭乌巢断曹军粮道', '正面列阵堂堂决战'],
    legion: [{ name: '官渡会战', battleType: 'field', supply: { player: 120, enemy: 80 },
      our: [U('cavalry', 5000, 'zhaoyun', { formation: 'fengshi' }), U('infantry', 8000, 'liubei', { formation: 'yulin' }), U('archer', 4000, 'liubei')],
      enemy: [U('cavalry', 4000, 'caocao'), U('infantry', 6000, 'xiahoudun'), U('archer', 3000, 'caocao')] }] },

  { id: 'sangu', title: '三顾茅庐', beat: '刘备三访隆中，得卧龙出山。',
    main: { title: '隆中对策', summary: '诸葛亮分析天下三分之势。' },
    branch: ['依隆中对先取荆益', '急于北伐中原'],
    side: [{ type: 'sidequest', name: '隆中访贤', summary: '冒雪三访草庐。' }] },

  { id: 'bowang', title: '博望坡·新野', beat: '诸葛亮初用兵，火烧博望。',
    main: { title: '初出茅庐', summary: '孔明设伏，诱敌深入。' },
    branch: ['依计火攻夏侯惇', '正兵据守新野'],
    legion: [{ name: '火烧博望坡', battleType: 'field', supply: { player: 90, enemy: 80 },
      our: [U('archer', 3000, 'zhugeliang', { formation: 'yanxing' }), U('cavalry', 2500, 'zhaoyun', { formation: 'fengshi' }), U('infantry', 4000, 'zhangfei')],
      enemy: [U('infantry', 9500, 'xiahoudun'), U('cavalry', 4500, 'xiahoudun')] }] },

  { id: 'changban', title: '长坂坡', beat: '曹军追击，赵云单骑救主。',
    main: { title: '当阳危局', summary: '百姓相随，曹军铁骑掩至。' },
    branch: ['赵云杀回乱军救阿斗', '张飞据桥断后'],
    pcombat: [{ enemyConcept: '长坂坡曹军追兵（七进七出）', difficulty: 3, count: 3 }],
    side: [{ type: 'vignette', name: '当阳桥头', summary: '张飞一吼，水为之断流。' }] },

  { id: 'chibi', title: '赤壁之战', beat: '孙刘联盟，火烧曹军水寨。',
    main: { title: '联吴抗曹', summary: '诸葛亮舌战群儒，定下火攻之策。' },
    branch: ['借东风纵火烧连环船', '稳守待曹军自溃'],
    legion: [{ name: '火烧赤壁', battleType: 'naval', supply: { player: 140, enemy: 120 },
      our: [U('navy', 6000, 'zhouyu', { machines: ['mengchong', 'mengchong', 'towerShip'] }), U('navy', 4000, 'zhugeliang', { machines: ['mengchong'] })],
      enemy: [U('navy', 9000, 'caocao', { machines: ['towerShip'] }), U('infantry', 6000, 'caocao')] }],
    side: [{ type: 'vignette', name: '草船借箭', summary: '大雾漫江，借得十万雕翎。' }] },

  { id: 'nanjun', title: '取南郡·借荆州', beat: '赤壁战后争夺荆襄。',
    main: { title: '智取南郡', summary: '诸葛亮三气周瑜，坐收荆州。' },
    branch: ['趁势夺取南郡城', '与东吴暂修盟好'],
    legion: [{ name: '南郡攻城', battleType: 'siege', supply: { player: 150, enemy: 100 },
      our: [U('siege', 1800, 'zhaoyun', { machines: ['catapult', 'ram'] }), U('infantry', 6000, 'zhangfei'), U('archer', 3000, 'guanyu')],
      enemy: [U('spearman', 5000, 'caocao'), U('archer', 3000, 'caocao')] }] },

  { id: 'hanzhong', title: '汉中之战·定军山', beat: '黄忠斩夏侯渊，刘备进位汉中王。',
    main: { title: '决战定军山', summary: '法正献计，黄忠居高临下。' },
    branch: ['黄忠抢占定军山势', '据守阳平关消耗'],
    legion: [{ name: '定军山之战', battleType: 'field', supply: { player: 130, enemy: 90 },
      our: [U('cavalry', 4000, 'huangzhong', { formation: 'fengshi' }), U('infantry', 7000, 'weiyan', { formation: 'yulin' }), U('archer', 3500, 'huangzhong')],
      enemy: [U('cavalry', 4000, 'xiahoudun'), U('infantry', 6000, 'caocao'), U('archer', 2500, 'caocao')] }] },

  { id: 'fancheng', title: '水淹七军·围樊城', beat: '关羽北伐，威震华夏。',
    main: { title: '水淹七军', summary: '关羽决堤灌军，进围樊城。' },
    branch: ['乘水势猛攻樊城', '稳扎稳打围而后取'],
    legion: [{ name: '围攻樊城', battleType: 'siege', supply: { player: 160, enemy: 70 },
      our: [U('siege', 2000, 'guanyu', { machines: ['ram', 'catapult'] }), U('infantry', 8000, 'guanyu'), U('archer', 4000, 'guanyu')],
      enemy: [U('spearman', 6500, 'zhangliao'), U('infantry', 4000, 'zhangliao'), U('archer', 4000, 'caocao')] }] },

  { id: 'maicheng', title: '败走麦城', beat: '东吴白衣渡江，关羽兵败。',
    main: { title: '麦城突围', summary: '腹背受敌，关羽率残部突围。' },
    branch: ['率亲兵死战突围', '固守待援'],
    pcombat: [{ enemyConcept: '麦城吴军伏兵', difficulty: 4, count: 2 }] },

  { id: 'yiling', title: '夷陵之战', beat: '刘备伐吴，陆逊火烧连营。',
    main: { title: '为弟复仇', summary: '刘备倾国之兵东征，连营七百里。' },
    branch: ['依山林扎连营持久', '集中兵力速取夷陵'],
    legion: [{ name: '夷陵·火烧连营', battleType: 'field', supply: { player: 110, enemy: 130 }, drawFromStrategy: true, enemyFactionId: 'wu',
      our: [U('infantry', 9000, 'liubei', { formation: 'changshe' }), U('cavalry', 3000, 'zhaoyun'), U('archer', 3000, 'liubei')],
      enemy: [U('navy', 4000, 'luxun'), U('infantry', 7000, 'luxun', { formation: 'fangyuan' }), U('archer', 3000, 'luxun')] }] },

  { id: 'nanman', title: '七擒孟获', beat: '诸葛亮南征，攻心为上。',
    main: { title: '深入不毛', summary: '诸葛亮平定南中，七擒七纵。' },
    branch: ['以攻心之策七擒七纵', '雷霆扫穴速定南中'],
    legion: [{ name: '南中之战', battleType: 'field', supply: { player: 120, enemy: 70 },
      our: [U('cavalry', 4000, 'zhaoyun', { formation: 'fengshi' }), U('infantry', 6000, 'weiyan'), U('archer', 3500, 'zhugeliang', { formation: 'yanxing' })],
      enemy: [U('infantry', 9000, 'menghuo'), U('cavalry', 4500, 'menghuo')] }] },

  { id: 'jieting', title: '街亭之战', beat: '马谡失街亭，孔明挥泪。',
    main: { title: '北伐·街亭', summary: '街亭乃汉中咽喉，魏军张郃疾进。' },
    branch: ['当道下寨据险死守', '依山屯兵居高临下'],
    legion: [{ name: '死守街亭', battleType: 'defense', supply: { player: 200, enemy: 100 }, drawFromStrategy: true, enemyFactionId: 'wei',
      our: [U('spearman', 5000, 'masu', { formation: 'fangyuan' }), U('archer', 4000, 'masu', { formation: 'yanxing' }), U('infantry', 4000, 'weiyan')],
      enemy: [U('cavalry', 5000, 'simayi'), U('infantry', 7000, 'simayi'), U('archer', 3000, 'simayi')] }],
    side: [{ type: 'vignette', name: '空城抚琴', summary: '孔明焚香操琴，退司马十五万兵。' }] },
];

// ---------- 展开为 digest ----------
const digest = {
  schemaVersion: 1,
  title: '三国演义·群雄逐鹿',
  logline: '汉室倾颓，群雄并起；自桃园结义至六出祁山，运筹于阵前，决胜于沙场。',
  themes: ['忠义', '权谋', '兴亡', '英雄'],
  tone: '历史·战争·群像',
  world: {
    name: '汉末三国',
    setting: '东汉末年，黄巾乱起，董卓乱政，群雄割据，终成魏蜀吴三分之势。',
    gmStyle: '半文半白的章回体史诗，重谋略与战阵，主将之勇略智计左右胜负。',
    factions,
  },
  characters: chars.map(c => ({ id: c.id, name: c.name, title: c.title, role: c.role, factionId: c.faction, description: c.desc, warfare: c.warfare })),
  locations: [
    { id: 'zhuoxian', name: '涿县' }, { id: 'hulaoguan', name: '虎牢关' }, { id: 'guandu', name: '官渡' },
    { id: 'longzhong', name: '隆中' }, { id: 'changbanpo', name: '长坂坡' }, { id: 'chibi', name: '赤壁' },
    { id: 'hanzhong', name: '汉中' }, { id: 'fancheng', name: '樊城' }, { id: 'yiling', name: '夷陵' },
    { id: 'nanzhong', name: '南中' }, { id: 'jieting', name: '街亭' },
  ],
  plotBeats: chapters.map((ch, i) => ({ id: `b_${ch.id}`, order: i + 1, sectionTitle: ch.title, title: ch.title, summary: ch.beat, type: 'battle', locations: [], conflicts: [], focusFactionId: 'shu' })),
  sourceMaterial: { note: '据《三国演义》主要回目改编（手写 digest，未读原文正文）。' },
};

// ---------- 展开为 blueprint ----------
const blueprint = {
  schemaVersion: 1,
  title: digest.title,
  logline: digest.logline,
  tone: digest.tone,
  scale: { sizeClass: 'large', sceneCount: chapters.length * 2 + 1, chapterCount: chapters.length, enemyCount: 12, endingCount: 3 },
  scope: { includeBeatIds: digest.plotBeats.map(b => b.id), startBeatId: digest.plotBeats[0].id, endBeatId: digest.plotBeats.at(-1).id, excludedBeatIds: [], note: '桃园结义至街亭，覆盖野战/水战/攻城/守城与单挑/突围。' },
  characterMapping: chars.filter(c => c.role === 'protagonist' || c.role === 'companion').map(c => ({ digestCharId: c.id, gameRole: c.role, notes: '' })),
  chapters: chapters.map(ch => ({
    id: ch.id, title: ch.title, fromBeatIds: [`b_${ch.id}`],
    hubScene: { name: ch.title, type: 'wilderness' },
    mainEvent: ch.main,
    combatPlan: (ch.pcombat || []).map(pc => ({ enemyConcept: pc.enemyConcept, ecology: { biome: 'plains', creatureType: 'humanoid', tier: pc.difficulty >= 4 ? 'boss' : (pc.difficulty >= 3 ? 'elite' : 'common') }, count: pc.count || 1 })),
    legionBattlePlan: (ch.legion || []).map(lg => ({
      name: lg.name, battleType: lg.battleType, summary: ch.main.summary, supply: lg.supply,
      ...(lg.drawFromStrategy ? { drawFromStrategy: true } : {}),
      ...(lg.enemyFactionId ? { enemyFactionId: lg.enemyFactionId } : {}),
      ...(lg.allyFactionId ? { allyFactionId: lg.allyFactionId } : {}),
      ourForces: lg.our.map(u => ({ unitType: u.unitType, troops: u.troops, generalRef: u.generalRef, ...(u.formation ? { formation: u.formation } : {}), ...(u.machines ? { machines: u.machines } : {}) })),
      enemyForces: lg.enemy.map(u => ({ unitType: u.unitType, troops: u.troops, generalRef: u.generalRef, ...(u.formation ? { formation: u.formation } : {}), ...(u.machines ? { machines: u.machines } : {}) })),
    })),
    branchPoints: [{ prompt: ch.main.title, options: (ch.branch || ['继续', '观望']).map(label => ({ label, effectHint: '' })) }],
    sideContent: ch.side || [],
  })),
  endings: [
    { id: 'unify', name: '匡复汉室', condition: '历经百战，蜀汉得鼎天下', summary: '汉室三兴，海内归一。', tone: '雄浑' },
    { id: 'three', name: '三分天下', condition: '魏蜀吴鼎足而立', summary: '天下三分，各据一方，征战不息。', tone: '苍凉' },
    { id: 'fall', name: '出师未捷', condition: '壮志难酬', summary: '出师未捷身先死，长使英雄泪满襟。', tone: '悲壮' },
  ],
  expansionNotes: ['军团战覆盖野战(官渡/博望/定军山/夷陵/南中)、水战(赤壁)、攻城(下邳/南郡/樊城)、守城(街亭)。', '个人战覆盖单挑(三英战吕布/白门楼)、突围逃脱(长坂坡/麦城)。'],
  // 内政外交（Phase 33）+ 逐城经营（Phase 37）：玩家=蜀汉；魏最强、吴次之、蜀弱、群雄散。
  strategicSetup: (() => {
    const warOf = Object.fromEntries(chars.map(c => [c.id, c.warfare]));
    // H(id,name,type,人口,营建度,治安,守将id?)
    const H = (id, name, type, pop, dev, sec, gov) => ({
      id, name, type, population: pop, dev, security: sec,
      ...(gov ? { governorId: gov, governorName: chars.find(c => c.id === gov)?.name, governorWarfare: warOf[gov] } : {}),
    });
    return {
      playerFactionId: 'shu',
      factions: {
        shu: { name: '蜀汉', gold: 200, food: 400, troops: 8000, order: 62,
          diplomacy: { wei: { stance: 'war', relation: -70 }, wu: { stance: 'neutral', relation: 15 }, qun: { stance: 'rival', relation: -30 } },
          holdings: [
            H('chengdu', '成都', 'capital', 18000, 100, 60, 'zhugeliang'),
            H('hanzhong', '汉中', 'fortress', 9000, 90, 55, 'weiyan'),
            H('jiangzhou', '江州', 'port', 7000, 95, 55),
            H('jingzhou', '荆州', 'city', 6000, 95, 50, 'guanyu'),
          ] },
        wei: { name: '曹魏', gold: 500, food: 1200, troops: 40000, order: 72,
          holdings: [
            H('xuchang', '许昌', 'capital', 90000, 115, 70, 'caocao'),
            H('yecheng', '邺城', 'city', 60000, 110, 65),
            H('guandu', '官渡', 'fortress', 30000, 95, 60),
            H('hefei', '合肥', 'fortress', 20000, 90, 60, 'zhangliao'),
          ] },
        wu: { name: '东吴', gold: 300, food: 700, troops: 20000, order: 68,
          holdings: [
            H('jianye', '建业', 'capital', 50000, 108, 65, 'sunquan'),
            H('chaisang', '柴桑', 'port', 30000, 105, 60, 'zhouyu'),
            H('jiangling', '江陵', 'city', 20000, 100, 55),
          ] },
        qun: { name: '群雄', gold: 120, food: 250, troops: 9000, order: 50,
          holdings: [
            H('xiapi_city', '下邳', 'city', 18000, 90, 45, 'lvbu'),
            H('nanzhong_city', '南中', 'city', 12000, 85, 40, 'menghuo'),
          ] },
      },
    };
  })(),
};

// 段①② 产物：手写 digest + blueprint（不调 LLM）；段③ 用 MCP preset_build_from_blueprint 确定性构建。
// 输出到 public/generated/（与其它管线生成的大型剧本同处；不进 presets/ bundle，避免被打包/图片体检扫描）。
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/generated');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'sanguo-legion.digest.json'), JSON.stringify(digest, null, 2));
fs.writeFileSync(path.join(OUT, 'sanguo-legion.blueprint.json'), JSON.stringify(blueprint, null, 2));
console.log(`digest: ${digest.characters.length} 人物 / ${digest.plotBeats.length} 节拍`);
console.log(`blueprint: ${blueprint.chapters.length} 章；军团战 ${blueprint.chapters.reduce((s, c) => s + c.legionBattlePlan.length, 0)} 场，个人战 ${blueprint.chapters.reduce((s, c) => s + c.combatPlan.length, 0)} 场`);
