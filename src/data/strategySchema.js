/**
 * 战略主题 Schema（Phase 42 T3）—— 战争/战略层的"题材数据"抽象。
 *
 * 机制引擎（LegionWarfareSystem / StrategicSystem / war.js / governance.js 纯函数）保持通用；
 * 各题材（三国 / 中世纪西幻 / 现代战争 …）只是一份可覆盖的数据 Schema。
 *
 * 设计原则：
 *   - 默认即三国：DEFAULT_SCHEMA = 现有常量组合，无 schema 的剧本行为完全不变（零回归）。
 *   - 题材换皮：剧本在 preset.strategySchema 提供（部分）字段即可改兵种/阵型/政令/资源标签/口吻。
 *   - 字段级覆盖：resolveSchema 在顶层按字段覆盖（题材给整张表则整张替换）；
 *       resources / narration 这两类"标签型"字段做一层深合并（可只改个别项）。
 *   - 资源键固定：resources 的 KEY（gold/food/troops/order）是引擎结构槽位，题材只改 name/icon；
 *       内政/季产逻辑按 key 运作，故换皮零风险（现代战争把 gold 显示为"资金"即可）。
 */

import {
  UNIT_TYPES, COUNTER_MATRIX, FORMATIONS, WAR_MACHINES, BATTLE_TYPES, TACTICS,
} from './warfare.js';
import { POLICIES, HOLDING_TYPES, DIPLOMACY_ACTIONS } from './governance.js';
import { MARCH_POSTURES } from './war.js';

/** 三国默认资源标签（KEY 固定，name/icon 可被题材覆盖） */
export const DEFAULT_RESOURCES = {
  gold:   { name: '金',   icon: '💰' },
  food:   { name: '粮',   icon: '🌾' },
  troops: { name: '兵',   icon: '⚔' },
  order:  { name: '民心', icon: '❤' },
};

/** 题材叙事口吻（用于 AI prompt / 系统叙述措辞）—— 题材可整体或逐项覆盖 */
export const DEFAULT_NARRATION = {
  settingTone: '汉末三国，群雄逐鹿、合纵连横',
  postures: { raid: '密遣轻兵奇袭', open: '传檄旗号、公开讨伐' },
  // 围城结局措辞
  siegeVerbs: { breach: '城门告破', surrender: '粮尽献城', fallen: '城陷', retreat: '攻方退兵' },
  // 单位/势力称谓（供叙述层借用）
  terms: { general: '武将', troops: '兵马', holding: '城池', faction: '势力', march: '行军' },
  // 局部战斗（小兵实战参战）措辞：小队/援兵/敌将命名（Phase 45）
  skirmish: {
    ally: '袍泽', allyReinforce: '我军援兵', enemy: '敌兵', enemyReinforce: '敌军援兵',
    nco: '什长', commanderTitle: '骁将', commanders: ['关靖', '夏侯尚', '牛金', '王双', '张虎'],
  },
};

/**
 * 默认 Schema（= 三国 / 通用值）。各字段引用现有数据表，保持单一事实源。
 */
export const DEFAULT_SCHEMA = Object.freeze({
  resources: DEFAULT_RESOURCES,
  unitTypes: UNIT_TYPES,
  counterMatrix: COUNTER_MATRIX,
  formations: FORMATIONS,
  machines: WAR_MACHINES,
  battleTypes: BATTLE_TYPES,
  tactics: TACTICS,
  marchPostures: MARCH_POSTURES,
  holdingTypes: HOLDING_TYPES,
  policies: POLICIES,
  diplomacyActions: DIPLOMACY_ACTIONS,
  // 战略层抽象兵力下沉到军团战时的默认兵种角色（题材可改）：
  //   defender 守军主力 / attacker 攻军主力 / attackerShock 攻军突击（骑/装甲）
  defaultBattleUnits: { defender: 'spearman', defenderSupport: 'archer', attacker: 'infantry', attackerShock: 'cavalry' },
  narration: DEFAULT_NARRATION,
});

/** 顶层字段：题材给则整张替换 */
const TABLE_FIELDS = ['unitTypes', 'counterMatrix', 'formations', 'machines', 'battleTypes', 'tactics', 'marchPostures', 'holdingTypes', 'policies', 'diplomacyActions', 'defaultBattleUnits'];
/** 标签型字段：一层深合并（可只改个别项） */
const LABEL_FIELDS = ['resources', 'narration'];

/**
 * 解析剧本 Schema：以 DEFAULT_SCHEMA 为底，叠加 preset.strategySchema。
 * @param {object} preset  GamePreset 或带 strategySchema 的对象
 * @returns {object} 已解析的完整 Schema（每字段必有值）
 */
export function resolveSchema(preset) {
  const override = (preset && preset.strategySchema) || {};
  const out = {};
  for (const f of TABLE_FIELDS) {
    out[f] = override[f] != null ? override[f] : DEFAULT_SCHEMA[f];
  }
  for (const f of LABEL_FIELDS) {
    if (override[f] != null) {
      // 标签字段深合并：resources 逐 key 合并 name/icon；narration 逐子项合并
      out[f] = mergeLabels(DEFAULT_SCHEMA[f], override[f]);
    } else {
      out[f] = DEFAULT_SCHEMA[f];
    }
  }
  return out;
}

/** 一层深合并：对每个子键，子对象浅合并，标量直接覆盖 */
function mergeLabels(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    const bv = base[k], ov = over[k];
    if (bv && typeof bv === 'object' && ov && typeof ov === 'object' && !Array.isArray(ov)) {
      out[k] = { ...bv, ...ov };
    } else {
      out[k] = ov;
    }
  }
  return out;
}

/** 从 gameState 取 Schema（缺省回退 DEFAULT_SCHEMA，保证纯函数/系统任何时刻可读） */
export function schemaOf(gameState) {
  return (gameState && gameState.strategySchema) || DEFAULT_SCHEMA;
}

/**
 * 战略抽象兵力 → 军团战兵种 KEY。role: 'defender'|'attacker'|'attackerShock'。
 * 题材配置缺失或键无效时，回退到 unitTypes 的首个键，确保任意题材都能起战。
 */
export function battleUnitKey(schema, role) {
  const s = schema || DEFAULT_SCHEMA;
  const want = s.defaultBattleUnits?.[role];
  if (want && s.unitTypes?.[want]) return want;
  return Object.keys(s.unitTypes || {})[0] || 'infantry';
}
