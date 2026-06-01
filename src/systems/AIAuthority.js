/**
 * AIAuthority — AI 参与度（主导度）权限模型
 *
 * 一根"AI 参与度"滑条 = 5 个吸附档，决定 AI 操作的 GM 对游戏进程的**控制力度**：
 *   L0 旁白   只叙述氛围，零数值变动/零决策，越界自由输入婉拒
 *   L1 主持   叙述更生动、回答世界观内提问；可建议但不落地任何机械改动
 *   L2 裁决   裁决玩家自由输入 + 有界状态改动（数值/物品/flag/掷骰）
 *   L3 编剧   动态事件/遭遇、NPC 调度、场景内开分支、调难度
 *   L4 创世   改写场景/连接、新增改写结局、覆盖预设 outcome（需校验+快照+可撤销护栏）
 *
 * 与频率轴 aiTier（多久叫一次 AI）正交：authority 决定"AI 能改什么"。
 * 纯函数模块：权限表 + 过滤器 + prompt 文本，便于单测与被三传输（harness/MCP/WS）共用。
 */

export const AI_AUTHORITY = Object.freeze({
  NARRATOR: 0,
  HOST: 1,
  ADJUDICATOR: 2,
  COAUTHOR: 3,
  WORLDSMITH: 4,
});

export const DEFAULT_AUTHORITY = AI_AUTHORITY.ADJUDICATOR; // 默认 L2

/** 各档元信息（滑条展示 + 频率默认值） */
export const AUTHORITY_LEVELS = Object.freeze([
  { level: 0, key: 'narrator',    name: '旁白', defaultTier: 'standard', blurb: '只渲染氛围，不改任何数值与剧情' },
  { level: 1, key: 'host',        name: '主持', defaultTier: 'standard', blurb: '生动主持、答世界观提问，仅建议不落地' },
  { level: 2, key: 'adjudicator', name: '裁决', defaultTier: 'standard', blurb: '裁决自由行动 + 有界数值/物品/flag 调整' },
  { level: 3, key: 'coauthor',    name: '编剧', defaultTier: 'advanced', blurb: '动态事件/遭遇、调度 NPC、调难度' },
  { level: 4, key: 'worldsmith',  name: '创世', defaultTier: 'advanced', blurb: '可改写场景与结局（带校验/快照/可撤销）' },
]);

/**
 * 动作类型 → 最低所需 authority。
 * 未列出的动作默认归 COAUTHOR(3)（保守：未知写操作不在低档放行）。
 */
export const ACTION_AUTHORITY = Object.freeze({
  // —— L2 裁决：有界状态改动（applyActions 已自带数值上限/引用校验）——
  heal: AI_AUTHORITY.ADJUDICATOR,
  damage: AI_AUTHORITY.ADJUDICATOR,
  set_variable: AI_AUTHORITY.ADJUDICATOR,
  add_item: AI_AUTHORITY.ADJUDICATOR,
  remove_item: AI_AUTHORITY.ADJUDICATOR,
  add_memory: AI_AUTHORITY.ADJUDICATOR,
  roll_dice: AI_AUTHORITY.ADJUDICATOR,
  // —— L3 编剧：生成/调度内容 ——
  start_combat: AI_AUTHORITY.COAUTHOR,
  end_combat: AI_AUTHORITY.COAUTHOR,
  trigger_event: AI_AUTHORITY.COAUTHOR,
  change_affection: AI_AUTHORITY.COAUTHOR,
  recruit_companion: AI_AUTHORITY.COAUTHOR,
  scale_difficulty: AI_AUTHORITY.COAUTHOR,
  spawn_event: AI_AUTHORITY.COAUTHOR,
  // —— L4 创世：改写世界结构/结局 ——
  rewrite_scene: AI_AUTHORITY.WORLDSMITH,
  edit_connection: AI_AUTHORITY.WORLDSMITH,
  author_ending: AI_AUTHORITY.WORLDSMITH,
  override_outcome: AI_AUTHORITY.WORLDSMITH,
  kill_npc: AI_AUTHORITY.WORLDSMITH,
});

/** 把任意输入规整为 0–4 的合法档位 */
export function clampAuthority(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return DEFAULT_AUTHORITY;
  return Math.max(0, Math.min(4, Math.round(n)));
}

/** 某动作类型的最低所需档位（未知动作保守归 L3） */
export function requiredAuthority(actionType) {
  return ACTION_AUTHORITY[actionType] ?? AI_AUTHORITY.COAUTHOR;
}

/**
 * 按当前档位过滤 AI 返回的动作。
 * @returns {{allowed: object[], blocked: object[]}}
 */
export function filterActionsByAuthority(actions = [], level = DEFAULT_AUTHORITY) {
  const lv = clampAuthority(level);
  const allowed = [];
  const blocked = [];
  for (const a of actions) {
    if (a && requiredAuthority(a.type) <= lv) allowed.push(a);
    else blocked.push(a);
  }
  return { allowed, blocked };
}

/** ≥L2 才允许 AI 裁决玩家自由输入并让其动作落地；否则越界自由输入应婉拒 */
export function canAdjudicateFreeInput(level) {
  return clampAuthority(level) >= AI_AUTHORITY.ADJUDICATOR;
}

/**
 * 脚本化叙述流（narrate_*）里是否允许 AI 注入会改状态的动作。
 * 仅 ≥L3（编剧）放行——否则预设/引擎已是权威，AI 在叙述里不得改状态
 * （这也保留了"祭司太阳坠被加两次"那类重复落地 bug 的修复）。
 */
export function narrationCanMutate(level) {
  return clampAuthority(level) >= AI_AUTHORITY.COAUTHOR;
}

export function authorityName(level) {
  return (AUTHORITY_LEVELS[clampAuthority(level)] || {}).name || '裁决';
}

/** 注入 system prompt 的"当前权限"说明，让 AI 自我约束 */
export function authorityPromptSection(level) {
  const lv = clampAuthority(level);
  const common = '【你的 GM 权限】严格遵守，不要提议或执行超出权限的改动。';
  switch (lv) {
    case AI_AUTHORITY.NARRATOR:
      return `${common}\n当前：L0 旁白。你只负责渲染氛围与叙述，绝不改动任何数值、物品、变量或剧情走向。` +
        '玩家若要求超出当前选项/可操作行为的事，请用叙述婉拒并引导回当前可选项，不要替他做决定。';
    case AI_AUTHORITY.HOST:
      return `${common}\n当前：L1 主持。你可生动主持、回答世界观内的提问，但只能"建议"，不可落地任何机械改动` +
        '（数值/物品/事件/剧情都由预设与引擎决定）。越权请求请婉拒并引导回选项。';
    case AI_AUTHORITY.ADJUDICATOR:
      return `${common}\n当前：L2 裁决。你可裁决玩家的自由行动，并做"有界"改动：小幅数值增减、` +
        '发放合理的小物品、设置剧情 flag、请求掷骰判定。不可凭空生成战斗/事件，不可改写场景结构或结局。';
    case AI_AUTHORITY.COAUTHOR:
      return `${common}\n当前：L3 编剧。除 L2 外，你还可动态生成支线事件/随机遭遇、调度 NPC、` +
        '在现有场景图内开新分支、调整难度。仍不可改写既有场景/连接/结局——那需要更高权限。';
    case AI_AUTHORITY.WORLDSMITH:
      return `${common}\n当前：L4 创世。你拥有完整主持权：可改写场景与连接、新增或改写结局、覆盖预设结果。` +
        '但任何结构性改写都会被系统校验（引用完整性/可达性）；请保持世界自洽，不要制造死锁或抹除玩家。';
    default:
      return common;
  }
}
