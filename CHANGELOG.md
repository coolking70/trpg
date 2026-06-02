# CHANGELOG

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 约定。

## [Unreleased]

### Phase 35 — 战略交互 AI 化（自由进谏，角色本位）🗣️

确立设计原则：这是 **AI 驱动的 TRPG**，战略层是**底层数据支持**而非主玩法；玩家始终以所扮角色"下令/进谏/决策"，**不切换成战略游戏 UI**。据此把内政外交的主交互从"操作面板"改为"角色本位 + 自由进谏"。

**Added — 战略动作接入参与度阶梯**
- `AIAuthority.ACTION_AUTHORITY`：`govern` / `diplomacy` / `mobilize` 列为 **L3 编剧**档动作（高权限特性）。
- `AIGMEngine`：`ENGINE_ACTION_TYPES` + `_applyEngineActions` 新增这三类——AI 据玩家进谏调 `StrategicSystem` 落实（有界，自带成本/条件校验；宣战自动置 `worldFlags.war_with_<id>`）。
- `GameSession.applyAction('say')` **路由到 AI**（`player_action`）：玩家用自然语言以角色身份发言/进谏，AI GM 裁决并按权限落地动作 + 叙述。这是"AI 驱动"而非"切 UI"的核心。
- `_buildLocalStateDigest` + `player_action` 提示：注入玩家势力国势/外交摘要 + 可用战略动作清单，并约束"仅当玩家明确议政、权限足够时才落实，否则只叙述"。

**Changed — 极简呈现**
- `getState().strategy` 快照保持极简（资源 + 外交几项），并在 ≥L3 时给出 `hint`：提示玩家可直接进言。`situation:'governance'` 理政朝堂降级为"可选的简化决策场景"，主交互改走情境选项 + 自由进谏。

**验证**
- 单测：govern/diplomacy/mobilize 需 L3，L2 拦截/L3 放行；`_applyEngineActions` 正确落实（征兵增兵、宣战置 flag、动员扣兵）；`say` 路由 AI；高/低权限的进言提示。
- deepseek-v4-flash 真 GM：玩家进言"传令劝课农桑、扩募新军；遣使江东结好孙权"→ AI 解析为 `govern(farming)`+`govern(conscript)` 落地（粮↑兵↑），结盟因关系未达标被正确拒绝、叙述为"东吴已有联意"。

### Phase 34 — 三国战略内容（内政外交）🀄

给三国剧本接上内政外交战略层，与军团战形成「内政产兵粮 → 外交定敌友 → 军团战」闭环。

**Added**
- `scripts/generate-sanguo-preset.mjs` 加 `strategicSetup`：玩家=蜀汉，初始金/粮/兵/民心 + 城池聚合 + 对魏(war)/吴(neutral 可联)/群雄(rival) 的外交立场。
- 重建 `public/generated/sanguo-legion-preset.json`：23 场景（含「理政朝堂」hub）、0 必修、全可达；夷陵/街亭两场军团战标记 `drawFromStrategy`（兵粮取自国库）。
- `strategy_simulate` 平衡贴史实：蜀排第 3/4（⚠ 势弱待援），经济可持续、无粮荒——蜀最弱需联吴自保。

**验证**
- headless 跑通完整链路：入朝理政 → 征兵（兵 8000→11200）→ 联吴（朝贡×2 + 结盟，吴转 ally）→ 处理政务（季度推进、敌国 AI 决定魏国来犯置 `invasion_from_wei`）。
- 真 GM 玩测待补：所给 deepseek-v4-flash key 网关返回 401（invalid api key），待提供可用 key 后补叙述抽样。

### Phase 33 — 内政外交系统（战略层·势力级国库）🏛️

把原本只用于"战略汇报"的描述性 `strategicLayer` 升级为**可操作的内政外交系统**，与军团战、剧情深耦合。

**Added — 战略数据层**
- `src/data/governance.js`（纯数据+纯函数，runtime/MCP 共享）：
  - 资源 `RESOURCES`（金/粮/兵力/民心）；政令 `POLICIES`（劝农/征税/征兵/筑城/赈灾/屯田）；外交 `DIPLOMACY_ACTIONS`（结盟/宣战/求和/朝贡/联姻/离间）；立场 `STANCES` + `stanceFromRelation`。
  - 纯函数 `seasonProduction`（季度产出/消耗/民心漂移）、`applyPolicyPure`、`applyDiplomacyPure`、`decideEnemyStrategy`（敌国 AI 启发式）、`validateStrategicSetup`、`factionPower`。

**Added — 战略系统与接线**
- `src/systems/StrategicSystem.js`：从 `preset.strategicSetup`/`strategicLayer` 初始化各势力活状态；`applyPolicy`/`applyDiplomacy`/`advanceSeason`（全势力 upkeep + 敌国 AI + 事件产出）/`mobilize`/`ranking`。
- `GameSession`：`loadPreset` 初始化 → `GameState.strategicState`（+ 序列化）；`getState` 始终带 `strategy` 概要，位于 `governance` 场景时 `situation:'governance'` + 内政/外交/`advance_season` 选项；`applyAction` 加 `govern`/`diplomacy`/`advance_season`；事件效果 `set_diplomacy`/`adjust_resource`/`mobilize`；`narrate_governance`/`narrate_diplomacy` 叙述钩子。
- `GamePreset` 现保留 `factions`/`strategicLayer`/`strategicSetup`（修复此前未透传的隐患）。

**Added — 深耦合军团战**
- `start_legion_battle` 支持 `drawFromStrategy`（我方兵力/粮草从玩家国库取并扣减，战后残部归队 + 民心/资源结算）、`allyFactionId`（盟友按外交关系出援军）、`enemyFactionId`（战后调整关系）。
- 玩家宣战 / 敌国 AI 宣战或来犯 → 置 `worldFlags.war_with_<id>` / `invasion_from_<id>`，供剧本军团战触发器挂接。

**Added — 管线编排与平衡器**
- 蓝图 `strategicSetup` → `buildPresetFromBlueprint` 写入 `preset.strategicSetup` + 生成「理政朝堂」hub；`legionBattlePlan` 支持 `drawFromStrategy`/`enemyFactionId`/`allyFactionId`。
- `src/systems/strategySimulator.js` + MCP `strategy_simulate`：模拟 N 季（玩家均衡策略 + 敌国 AI），报资源/实力轨迹、对玩家宣战次数、势力排名 + 平衡标志。

**Tests** — governance 数据层 21、StrategicSystem 10、RPC 集成 + 深耦合 8、平衡模拟器 5。

### Phase 32 — 三国题材剧本（军团战示范）⚔️🀄

用 Phase 31 的军团战系统 + 小说→预设管线，手写 `NovelDigest`/`PresetBlueprint`（不调 LLM）确定性生成的三国剧本。

**Added**
- `scripts/generate-sanguo-preset.mjs` — 数据驱动手写三国 digest + blueprint（17 主将含武备、15 章节，覆盖桃园结义→街亭）。
- `public/generated/sanguo-legion-preset.json`（段③确定性构建产物）+ 同名 `.digest.json` / `.blueprint.json`。
- 规模：22 场景 / 30 事件 / 10 场军团战 + 4 场个人战，体检 **0 必修 / 全可达**。
- 战型全覆盖：野战（官渡/博望坡/定军山/夷陵/南中）、水战（赤壁）、攻城（下邳/南郡/樊城）、守城（街亭）；个人战覆盖单挑（三英战吕布/白门楼）与突围（长坂坡/麦城）。

**验证**
- `legion_simulate` 平衡：刘备的胜仗高胜率、官渡/赤壁/南郡/定军山适中、**夷陵 42%（偏难）、街亭 16%（过难）正对应史上两场大败**。
- hy3-preview 真 GM headless 玩测通过：个人战（三英战吕布 → 吕布被击败）与军团战（官渡野战展现列阵/突击/伏兵；赤壁水战展现火攻）均由真 GM 叙述、忠于史实并基于真实战况。

**Fixed**
- `AIGMEngine._sanitizeNarrative`：修复 Responses-API + 结构化输出偶发的 `narrative":"…` JSON 片段泄漏，兜底抠出真正叙事。

### Phase 31 — 军团战争系统（单位栈战术制）⚔️

与个人战（`CombatSystem`）完全平行、零耦合的另一套战斗：适用于野战/攻城/守城/水战，具备兵力/兵种/粮草/士气，按战型有限携带器械，主将属性/阵法/战法影响阵型与作战。个人战仅保留给单挑/切磋/暗杀/逃脱。

**Added — 战争数据层**
- `src/data/warfare.js`（纯数据+纯函数，runtime/MCP 共享）：
  - 兵种表 `UNIT_TYPES`（步/骑/弓/枪/水军/器械兵）+ 克制矩阵 `COUNTER_MATRIX`（枪克骑、骑克弓…）
  - 阵型 `FORMATIONS`（方圆/鱼鳞/锋矢/鹤翼/雁行…，按主将阵法等级 `requiresTactics` 解锁）
  - 器械 `WAR_MACHINES`（投石车/攻城锤/弩车/楼船/蒙冲，按战型白名单+携带上限）
  - 战型 `BATTLE_TYPES`（分区/胜负条件/允许器械）：野战歼灭、攻城破门、守城守满回合、水战控渡口
  - 战法 `TACTICS`（突击/火攻/伏兵/鼓舞，成功率走主将智力/统率）
  - 纯函数 `resolveAttack`/`moraleShift`/`resolveMachine`/`supplyDrain`/`checkVictory`/`validateLegionBattle`

**Added — 战斗系统与接线**
- `src/systems/LegionWarfareSystem.js`：单位栈战斗状态、回合循环、指令集（move/attack/set_formation/bombard/tactic/hold/retreat）、主将影响、粮草消耗、士气崩溃溃退、各战型胜负、auto(`decideLegion`)+interactive 双模式。
- `GameSession`：事件效果 `start_legion_battle`、`legion` 动作、`getState` 的 `situation:'legion'` 快照与指令选项、`_autoResolveLegion`/`_advanceLegionToActor`/`submitLegionOrder`/`_endLegionBattle`，复用 `combatMode`。
- `GameState.activeLegionBattle` 字段 + 序列化。
- `AIGMEngine` + `AIPromptBuilder`：`narrate_legion_start` / `narrate_legion_result` 叙述钩子（开战气势 + 战果，基于真实战况）。

**Added — 管线编排与平衡器**
- 蓝图 chapter 新增 `legionBattlePlan`（与个人战 `combatPlan` 并列）；`buildPresetFromBlueprint` 编译为内联 `start_legion_battle` 事件（双方单位栈 + 主将武备从 digest 装配），并以 `validateLegionBattle` 校验编制（器械携带上限/兵种/阵型/主将引用）。角色携带 `warfare` 主将属性。
- `src/systems/legionSimulator.js` + `scripts/legion-balance-check.mjs`（CLI）+ MCP `legion_simulate`：蒙特卡洛模拟某场军团战，输出我方胜率/平均回合/双方损耗 + 平衡标志。

**Tests** — warfare 数据层 30、LegionWarfareSystem 10、RPC 集成 4、平衡模拟器 5、builder 军团战 1（MCP）、叙事清洗 4。

### Phase 30 — 小说 → 预设 三段确定性管线 📖→🎲

废弃旧的「读全文自由发挥」式超大型剧本生成（效果不可控），改为 **概括 → 设计 → 确定性构建** 三段管线：把 LLM 的「自由发挥」风险隔离在前两段（产物可人工确认），第三段完全确定性、由成熟工具校验。

**Removed**
- 删除 `buildMegaPresetFromNovel`（~256 行）及 `novel_build_mega_preset` 工具——读全文 + LLM 分批抽取直接吐超大剧本的旧路径

**Added — MCP 工具（段①②③）**
- `novel_digest`（段①·概括汇总）：本地分析正文 → LLM 概括为 `NovelDigest`（logline/themes/world/characters/locations/plotBeats）；`plotBeats` 只记叙事节拍，**不含游戏结构**（无 choices/sceneType）
- `blueprint_draft` + `blueprint_validate`（段②·设计蓝图）：LLM 据 digest 起草 `PresetBlueprint`（章节脊柱 + 战斗/支线/分支/结局拓展计划），按 `sizeClass`（small/medium/large）给出场景/章节/敌人/结局规模区间并 clamp；蓝图为**人工可确认**的中间产物
- `preset_build_from_blueprint`（段③·确定性构建）：**不调 LLM**，把蓝图编译成预设——线性章节 hub + 支线分叉、主事件（分支→choices）、战斗事件（combatPlan→ecology 敌人 + 掉落）、终章多选结局；复用 `presetNormalize` / `resolveLootTable` / `assignPresetImages` / `validatePreset`

**Added — Responses-API 适配**
- `callOpenAICompatible`（MCP）与 `AIGMEngine`（runtime）新增 `/responses` 风格支持：`apiStyle:'responses'` 或 `OPENAI_API_STYLE=responses` 或端点以 `/responses` 结尾时，自动改用 `{instructions,input}` 并解析 `output[].content[].text`；兼容 hy3-preview 等只走 Responses 接口的模型

**平衡纪律**
- 段③按 tier 限制同场敌人数（trivial/common≤3、elite≤2、boss≤1），避免蓝图写「3 个 boss 同屏」造成不可通关
- 段③过滤 combatPlan 里的占位/无战斗条目（`enemyConcept` 命中 `无战斗|纯叙事|none` 等或为空时跳过），不再生成空敌人和空战斗事件

**验证**
- 真实 5MB 小说《魔弹之王与冻涟的雪姬》跑通全管线：digest（8 势力/40 角色/18 节拍）→ blueprint（medium）→ 确定性构建 **0 必修 / 全可达 / 无不可胜 boss**
- 生成的《苍冰星传说：十四岁的约定》以 hy3-preview 作 GM 手动玩测通过：开场/恋爱分支/支线小景/真实战斗/链式 boss 战叙述均忠于原著
- 战略层工具测试改用「管线产物形态」的 faction 型 fixture（替代已删的 mega setup），MCP 套件 **44/44**

### Phase 29 — AI 参与度阶梯（L0–L4 权限模型）🎚️

把「AI GM 管多宽」做成玩家可调的滑杆：从「只渲染氛围、不动数值」到「可改写剧情/结局」，五档递进。新游戏可选，游戏中可随时拖动调整。

**Added — 权限核心**
- `src/systems/AIAuthority.js`：L0–L4 五档 + `ACTION_AUTHORITY` 动作授权表 + `filterActionsByAuthority`（按档位过滤 AI 返回的 actions）+ `narrationCanMutate`（≥L3 才允许 narrate_* 期间改状态）+ `authorityPromptSection`（每次调用注入对应档位的边界说明）
- 档位语义：**L0** 纯氛围描述、拒绝越权请求；**L1–L2** 渐次放开数值/判定；**L3** 编剧动作（spawn_event/scale_difficulty/招募/好感）；**L4** 创世动作（世界改写），带校验 + 快照 + 可撤销（`undoLastRewrite`）+ 审计护栏，**自动应用无需逐次确认**

**Added — 实装与 UI**
- `GameState.aiAuthority`（默认 2，clamp 0–4）+ 序列化
- `AIGMEngine`：`filterActionsByAuthority` 取代旧 `NARRATION_ONLY`；`_applyEngineActions`（L3）/ `_applyWorldsmithActions`（L4，含 `_reachableSet` 可达性保护）
- `DifficultyTracker.manualBias` + `setManualBias`：参与度档位影响难度基线
- `SettingsModal` / `EndgameModal` 权限滑杆；`main.js` `settings:authorityLive` 实时生效 + loadPreset 应用持久化档位
- 多人：`gameWsServer` / `game-ws-server.mjs` 的 `set_authority` 仅房主可调，改动广播全席位

### Phase 28 — 生态位 → 掉落表 → 图像 显式结构化 🦴

把「怪物生态位」从隐性 tag 提升为一等数据 `ecology = { biome, creatureType, tier }`，让生成大剧本时敌人的**地区主题、战利品、图像三者自动一致**。

**Added — 生态数据层**
- `src/data/ecology.js`（纯数据 + 纯函数，runtime/MCP 共用）：
  - 词表 `BIOMES` / `CREATURE_TYPES` / `TIERS` + `difficultyToTier`
  - `LOOT_POOLS` 按 biome 组织的掉落池，每候选含 `weight / kind / minTier / types` 门槛
  - `resolveLootTable({biome,creatureType,tier,luck})` → 静态烘焙 `[{itemId,dropRate}]`
  - `rollDynamicLoot(...)` → 运行时实时抽取，rng 可注入
  - `inferEcology` / `validateEcology` / `ecologyTags`（marsh→swamp、cave→tunnel 等别名归一）
- 掉落规则：kind×tier 决定基础掉率，tier 越高条目越多/掉率越高；`minTier` 让 boss-only 战利品只在精英/boss 出现；`types` 让材料只对相应生物类型掉

**Added — 运行时动态掉落**
- `CombatSystem.endCombat`：`enemy.lootMode==='dynamic'` 或（有 ecology 且无静态 lootTable）时按生态位实时抽取；否则走静态 lootTable（**向后兼容**）

**Added — MCP 工具（3）**
- `ecology_vocab` — 列出 biome/creatureType/tier 词表
- `loot_pool_preview` — 预览某生态位的掉落表（不改预设）
- `enemy_assign_ecology` — 写入 ecology → 烘焙 lootTable（或标记 dynamic）→ **把战利品从 assetLibrary 物料化进 preset.items（含图）** → 给敌人配匹配图
- `enemy_create` 新增 `ecology` / `lootMode` 字段

**Tests**
- `__tests__/data/ecology.test.js`（21）+ CombatSystem 动态掉落（+3）+ MCP 生态工具（+5）
- Jest 446 → **470** ✅ / MCP 37 → **42** ✅

### Phase 27 — MCP API-only 超大型剧本与运行体验修复 🌐（2026-05-29）

**Added**
- MCP 小说/设定集导入进入 API-only 流程：正文分析、势力抽取、路线扩写、战略层生成/审稿均通过 OpenAI-compatible API 驱动
- 新游戏剧本库按规模分组：短篇 / 中型 / 大型 / 超大型
- 外部生成剧本 manifest：`public/generated-presets.json` + `public/generated/`，避免把 1MB+ 超大 JSON 直接塞进 `presets/`
- 设置面板新增 **测试 API 连接** 按钮，显示成功/错误、模型名、耗时和 token 用量
- 超大型剧本当前规模：298 场景 / 305 事件 / 87 NPC / 7 势力 / 21 结局；7 个势力均有战略层和开局战略汇报事件

**Fixed**
- 新游戏后 narrative DOM 没清空，导致上一局对话残留
- AI 返回空 `narrative` 时 loading 消失但没有任何反馈；现在发布错误提示并写入本地兜底叙事
- 角色创建身份没有写入稳定变量/长期记忆，导致身份连续性不足
- 超大型剧本 hub 可无门槛进入其他势力起点，导致布琉努线串到墨吉涅线
- 清理超大型剧本中 ID 漂移造成的重复势力起点
- 清洗 1000+ 个玩家可见文本字段，移除 `AI/GM/API/改编节拍/提示词` 等生成提示痕迹

**Tests**
- Jest 421 / 421 ✅
- MCP 37 / 37 ✅
- `npm run build` ✅

### Phase 26E — 新游戏 / 清空存档流程 🧹（2026-05-26）

**Fixed — 4 个真 bug**
- `_handleNewGame.clearAllSlots` 删错 LS key（`trpg_game_state` 应为 `trpg_save`）；现在同时清 `trpg_save`/`trpg_game_state`/`trpg_current_preset` + IDB current 缓存
- `_buildPresetChoices` 硬编码 4 项，没读 `presets/` 目录；改用 `import.meta.glob('/presets/*.json')` 自动收集，**选项从 4 → 8**（默认 + 4 个 bundled + 3 个 random）
- "清空全部存档"按钮不带 presetKey 跳到 fallback 默认剧本；现在强制 `gameState/preset=null` 并**自动重新打开 EndgameModal** 让玩家选剧本
- 误报"已从自动存档恢复"toast（实际是旧 LS key 没清干净）随 1+3 修复一起解决

**Added**
- `toast:show` 通用事件订阅（ToastManager），任意系统可主动弹通知
- `_resolvePresetByKey` 支持 `bundled:<presetId>` / `saved:<presetId>` 两种新 key 格式

### Phase 26D — 内容扩充：多题材预设 🎭

**Added — 3 个新预设**
- 「永燃之冠」`presets/eternal-crown-stress-test.json` — 中世纪奇幻 **101 节点 / 87 事件 / 22 NPC / 4 ending**，4 个 boss 都有 phases，22 关系图
- 「最后的避难所」`presets/last-shelter-survival.json` — 末日生存 39 节点 / 12 NPC，变种领主 boss 用 2-phase 演示
- 「青锋录」`presets/qingfeng-wuxia.json` — 武侠 26 节点 / 11 NPC，邪教教主 2-phase
- 三个生成脚本：`scripts/generate-large-script.mjs` / `generate-survival-preset.mjs` / `generate-wuxia-preset.mjs`
- 跨预设元进度隔离测试（`__tests__/integration/multiRun.test.js` +1 case）
- 文档：`docs/PRESETS.md` 横向对比 / `docs/STRESS_TEST_2026-05-26.md` 13 次 AI vs AI playtest 全程

### Phase 26C — 战斗深化 ⚔

**Added — StatusEffect 核心**
- `CombatSystem.getEffectiveStat(combatant, statName)` — buff/debuff 影响实时 stat
- `CombatSystem.applyStatusEffect(combatant, { type, stat, value, duration })` — 同 type+stat 续期不重复
- `CombatSystem._processStatusEffectsTick` — 每回合开始 tick：`dot` 扣血 / `regen` 回血 / 倒计时
- `ability.effect.applyStatus: { type, stat, value, duration }` — 技能附带状态

**Added — AOE / 多目标**
- `ability.effect.aoe: true` 或 `target: 'all_enemies'|'all_allies'|'self'|'random_enemy'`
- 单技能自动施于多目标，`result.subResults[]` 含逐个结果
- AOE 配合 `applyStatus` 给全部目标加状态

**Added — Boss 阶段战 (phases)**
- `enemy.phases = [{ id, hpThreshold, statBoosts, abilities, narrative }]`
- 跨 HP 阈值时一次性激活；高 → 低 hpThreshold 依次触发
- 已激活的 phase 不重复，新 abilities 追加到 enemy.abilities
- 演示：龙王 380HP 3-phase / 变种领主 2-phase / 邪教教主 2-phase

**Added — escape_combat 消耗品**
- 新 `consumeEffect.type: 'escape_combat'`，全队 HP 扣 `hpPenaltyPct%`（默认 10%）
- 调用 `CombatSystem.endCombat('flee')` 真正脱战
- 至少保 1 HP（不会自我团灭）

**Added — 数值平衡 Monte Carlo 模拟器**
- `scripts/combat-balance-check.mjs` — 用真实 CombatSystem + DiceSystem 跑 N=1000 模拟
- 输出每场战斗：胜率 / 平均回合数 / 剩余 HP P10/P50/P90 / 最低安全入场 HP
- 支持 `--include-companions` / `--party-by-chapter` / `--entry-hp-pct 0.5`
- **AI playtest 替代**：5 秒审计 17 战斗，比 AI vs AI 玩测快 10000 倍
- MCP 工具 `combat_simulate` 暴露给作者用

**Tests**: Jest CombatSystem +13 (status/AOE/phases) / ProgressionSystem +3 (escape_combat) / MCP +2

### Phase 26B — AI Hooks gate 🚪

**Added**
- `AIGMEngine.shouldCallAI(hookName, options)` — 按 `preset.aiHooks` × `gameState.aiTier` 决定调不调 AI
- `aiTier`: `none` / `light` / `standard`（默认）/ `advanced`
  - `none`: 全 fallback，0 token
  - `light`: 仅首访 sceneArrival / main 事件 / 首遇 NPC
  - `standard`: 大部分调（vignette 重访 30% 概率）
  - `advanced`: 全开
- preset 作者可强制 `always` / `never` 覆盖玩家设置
- SettingsModal 加"🤖 AI 叙事丰度"下拉，localStorage 持久化
- 钩到的 actionType: `narrate_scene_arrival` / `narrate_event` / `narrate_npc_dialogue` / `narrate_vignette` / `narrate_world_ripple`

**Tests**: `__tests__/systems/AIGMEngine.test.js` 新增 14 case

### Phase 26A — 大型剧本压力测试 + DiceSystem 容错 + playtest harness 🔧

**Added — DiceSystem 容错升级**
- 多项修正符: `d20+13-9` 求和 = +4（原仅支持单个 ±K）
- 容错括号 + 未知变量: `(ATK+1d20)-DEF` → 解析为 d20 + 0（变量不替换时当 0，不再抛错）
- AIResponseParser / GM AI 生成的非标准公式不再 crash 战斗

**Added — playtest harness 升级**
- `scripts/playtest-large-script.mjs` — 大型剧本专用 headless AI vs AI
- PlayerAI: HP 监控 + 自动撤退 prompt + 精确 itemId 校验 + `nextObjective` 推断
- HeadlessApp: `useItem` / `nearestSceneByTag` BFS / `travelTo` 自动寻路（多跳）
- 指数退避 retry（GM 3 次 / Player 3 次），fetch failed 不再中断
- 自动 `meetNPC` 入场景（修生产端 codex 永远统计不到野外 NPC 的 bug）
- `recruit_companion` 真正 push 到 `activeCharacters`（修 playtest 静默 bug — 招到的伙伴根本没参与战斗）

**Added — 文档**
- `docs/STRESS_TEST_2026-05-26.md` — 13 次完整 AI vs AI playtest 数据 + 5 项问题修复历程

**Tests**: DiceSystem +5 (容错回归) / Integration multiRun +5 (跨周目存档恢复 + 元进度累积)

### Phase 22 — 世界因果与 NPC 关系图 🕸（收尾）

把 Phase 19 准备好的 `worldFlags` 数据层真正接入 AI 叙事，加上 NPC 关系图让 NPC 互相影响。

**Added — 22A worldFlags AI 注入 + 反馈**
- `AIPromptBuilder.buildActionMessage` 自动在 system message 头部注入：
  - 【故事时间】第 N 天 HH:00
  - 【当前世界状态】活跃的 worldFlags（让 AI 叙事与之一致）
  - 【玩家身份】playerTags
  - 【同行伙伴】companions 列表
- `set_worldFlag` effect 状态真的变化时给玩家系统反馈（作者写 `effect.hint` 优先，否则通用 "🌍 世界状态变化: name=value"）

**Added — 22B NPC 关系图**
- `GamePreset.npcRelations[]`：`{ from, to, strength, note }`，strength 范围 -1.0 ~ 1.0
- `NPCSystem.loadFromPreset` 把关系按 from 索引存入 `relationsByFrom`
- `NPCSystem.changeAffection` 一级传播 — 改 A 的 affection，B 自动按 `strength` 同向或反向变化（_depth 控制避免环回）
- `NPCSystem.applyNPCDeath` — A 死亡时关联 NPC 按 `strength × 25` 受冲击；|strength| ≥ 0.7 还会改 mood 为 grieving / pleased
- 新 effect `kill_npc` — 触发死亡 + 关系传播 + 系统叙事反馈（"💀 X 已陨落 → Y 因此愤怒/欣慰"）

**Added — MCP 新工具（1 个）**
- `npc_relation_add` — 写入 NPC 关系（单向），引用不存在的 NPC 会报错

**Tests**
- `__tests__/systems/NPCSystem.test.js` — 6 个新用例（同向/反向传播 / 不连锁 / 死亡冲击 / mood 强情感）
- `mcp-server/preset-server.test.mjs` — 2 个新用例（写入关系 / 不存在错误兜底）
- 全套：Jest **370 / 370** ✅（+6）+ MCP **32 / 32** ✅（+2）

### Phase 25 — MCP 大型剧本生成模板 🏗

让 AI 一键塞入"标准 CRPG 框架"或"生存"或"侦探推理"骨架，省去从 0 起步的反复工具调用。配合 `preset_scale_check` 给大型剧本做规模健康度评估。

**Added — MCP 新工具（3 个）**
- `preset_apply_template` — 一键塞标准骨架，3 个模板：
  - `crpg_standard` — 4 轴角色创建（人类/精灵/矮人 × 贵族/孤儿/农夫 × 士兵/学者/盗贼 × 太阳神/月神/无信仰）+ 5 个起始场景（含路由）+ 3 个开场事件 + solo combatMode
  - `survival_solo` — 极简后启示录骨架，1 个种族 + 3 个职业 + 避难所/废墟两节点
  - `mystery_visual_novel` — 单主角侦探，事务所/案发现场两节点 + 委托信事件
- `scene_chain_create` — 一次创建 N 个场景 + 自动双向连接，每条还可标 `oneWay: true`；省去 batch_apply 的多次 add_connection
- `preset_scale_check` — 报告规模适配性：场景数 / 事件密度 / 平均连接度 / 主线占比 / NPC 数 / NPC schedule 覆盖 / 结局数 / 角色创建启用；按"短篇 / 中型 / 大型 / 超大型"分级给建议

**Tests**
- MCP **30 / 30** ✅（+4：模板应用 / 非空拒绝 / 链式创建 / 规模检查）

### Phase 24 — 元进度图鉴 📖

把 Phase 23A 准备好的 metaProgression 数据呈现为可视化 modal。

**Added**
- `src/ui/CodexModal.js` + CSS — 4 标签页（🗺 场景 / 📜 事件 / 🧑 NPC / 🌅 结局）
- 每个标签显示进度条 + 卡片网格；未发现的条目显示 `???` + 灰化（不剧透）
- 顶部显示"通关 X/Y · 累计游玩 X 小时 Y 分"
- 底部红色"🗑 清空本预设图鉴进度"按钮（带二次确认）
- 工具栏新增 📖 图鉴按钮（在 📋 导出日志之前）

**Tests**
- 已有 Jest 364 / 364 ✅（UI 没单独 unit test，靠手动验证）

### Phase 23 — 规模化基础设施（300+ 节点跑得动）📈

为支撑超大型剧本（300 节点 / 2-5MB 预设 / 多周目元进度），把"存储 / 编辑器 / 渲染 / AI 上下文"四个性能瓶颈一次性解决。

**Added — 23A IndexedDB 存储**
- `src/core/IndexedDBStore.js` — 通用 KV 封装：get/put/delete/keys/entries/clear/estimateSize；浏览器无 IDB 时静默回退
- `src/core/PresetStorage.js` — 预设专用层：大预设（>1MB）自动走 IDB，索引镜像在 localStorage 保证同步 `listSync`；提供 `saveCurrent/loadCurrent`
- `src/core/MetaProgression.js` — 跨周目元进度（**独立于单局存档**）：runCount / discoveredScenes / discoveredEvents / discoveredEndings / unlockedRaces 等；按 presetId 分键，每个剧本独立累积
- main.js `_applyPreset` 改用 `presetStorage.saveCurrent`；主线完成时 `_commitRunToMetaProgression` 自动合并发现的场景/事件/NPC/ending 到全局元进度
- `_finalizeNewGame` 记录 `_sessionStartTime` 用于元进度 totalPlayTimeSeconds 统计
- 新增 fake-indexeddb devDependency；`__tests__/setup.js` polyfill structuredClone（fake-indexeddb 依赖）
- `__tests__/core/IndexedDBStore.test.js` — 18 个用例覆盖 IDB / PresetStorage / MetaProgression

**Added — 23B 编辑器分页 + 搜索**
- `listFormLayout` 重写：
  - items > 10 → 自动加搜索框（按 label / id / tags 模糊匹配）
  - items > 50 → 自动分页（← 第 X/Y 页 →）+ 选中项所在页自动跳转
  - 头部显示 `名称 (总数)` — 一眼看到规模
- 与现有所有 editor tab（场景/事件/NPC/物品/角色/敌人）100% 向后兼容（小列表不显示这些 UI）

**Added — 23C 场景图渲染裁剪**
- `SceneGraphRenderer` 加 `_visibleSet` — 计算每个节点屏幕坐标后，标记 onScreen + margin 内的
- 节点绘制：完全屏外的跳过（current/reachable 状态例外，保留方向指示）
- 边绘制：两端都屏外的边跳过
- 300+ 节点项目预期能省 60-90% 的 canvas 绘制工作

**Added — 23D AI 上下文检索**
- `src/systems/ContextRetriever.js` — 按相关性挑相关场景/NPC 注入 AI prompt：
  - 场景评分：图距离 BFS + 共享 tag + 最近访问 + 当前场景永远 +100
  - NPC 评分：同行 +100 / 当前场景 +50 / 已识 +10 / 好感 ÷5
  - `buildContextDigest(gameState, opts)` — 生成紧凑的"当前场景 + 时间 + worldFlags + tags + 同行 + 相关场景 + 相关 NPC"段，直接塞 AIGM system prompt
- 300+ 场景项目从"全注入 description 爆 token"变成"挑 6 相关场景 + 5 相关 NPC"
- `__tests__/systems/ContextRetriever.test.js` — 9 个用例覆盖距离/tag/孤岛/同行/好感/digest

**Tests**
- Jest **364 / 364** ✅（+27：IndexedDB 18 + ContextRetriever 9）
- MCP **26 / 26** ✅（无变化，Phase 23 不增加 MCP 工具）

**Dependencies**
- 新增 `fake-indexeddb@^6.2.5`（devDependency，仅用于测试）

### Phase 21 — 网状叙事（场景变体 + 隐藏路径）🕸

让一个场景在不同的世界状态 / 时间 / 玩家身份下"长得不一样"，并支持"剧情推进后才解锁的暗道"。这是 300+ 节点剧本里"同一地点不同章节呈现"的核心机制。

**Added — 21A 场景变体**
- `Scene.variants[]` 字段 — 一个场景可以有多个变体，每个有自己的 `when` 条件 + 覆盖 `description / events / connections / vignettes`
- 条件维度：`requireVariables / requireWorldFlags / requireCompletedEvents / requireTags / requireStoryTime`
- `SceneSystem.getActiveVariant(scene, gameState)` — 按 variants 数组顺序取第一个满足的
- `SceneSystem.getActiveSceneView(scene, gameState)` — 合并 base + variant，UI 用这个视图
- main.js 抵达叙事 / 重访 vignette / 终端卡的 description 都走 variant 视图

**Added — 21B 隐藏连接**
- `connection.discovered: false` 默认；玩家发现后通过 effect `reveal_connection: { from, to }` 永久解锁
- `GameState.discoveredConnections: string[]` — 持久存储已发现路径（"from→to" 格式）
- `SceneSystem.revealConnection / _isConnectionVisible` — 渲染层和 getAdjacent 都过滤未发现的边
- 场景图渲染器 _renderEdges 也直接跳过未发现的连接
- 解锁时自动写系统叙事："🗺 你发现了一条新路径（通向 XXX）"

**Note — 21C/D 已隐式完成**
- 多入口（startingSceneRules）已在 Phase 19A 实现
- 多结局矩阵已在 Phase 16/19 通过"同场景多事件按 trigger 条件分流"实现（ch10_redeemed 是范例）

**Added — MCP 新工具（2 个）**
- `scene_variant_add` — 给场景加一个变体（含 when 条件 + 覆盖字段）
- `connection_set_hidden` — 把/取消把 connection 标为隐藏

**Tests**
- `__tests__/systems/SceneSystem.test.js` — 7 个新用例（variant 无匹配 / worldFlag / storyTime / 优先级 + hidden 不可见 / reveal 一次性 / 持久化）
- `mcp-server/preset-server.test.mjs` — 1 个综合用例覆盖 variant + hidden 双工具
- 全套：Jest **337 / 337** ✅（+7）+ MCP **26 / 26** ✅（+1）

### Phase 20 — 单人模式 + 营地对话交互 🏕

把 Phase 19 的 NPC / 故事时间数据骨架变成可玩内容：单人主角带 AI 伙伴探索，在营地/旅馆通过对话/赠礼/索物/休息四种方式深度互动。

**Added — 20A 单人模式与伙伴战斗**
- `recruit_companion / dismiss_companion` 现在会同步更新 `activeCharacters[]` — 招募的 NPC 以 `_isCompanion: true` 标记入队
- `CombatPanel` 已有的"only `activeCharacters[0]` 是玩家主角"逻辑天然适配 solo 模式，伙伴行动走 AllyAIController
- `LeftPanel` 角色卡上 `_isCompanion=true` 的会显示 "🤝 同行（AI 控制）" 粉色徽章，CSS 加边框区分
- 伙伴 inventory/equipment 在 UI 上不再可编辑（玩家无法直接给伙伴装备）

**Added — 20B 营地 / 旅馆 modal**
- `src/systems/DialogueSystem.js` — 对话树解析器：start/getCurrentView/choose/exit；支持 requireTags/requireAffection/requireVariables/requireWorldFlags 多维度门控
- `src/ui/CampModal.js` + CSS — 4 标签页设计：💬 对话 / 🎁 赠礼 / 🙏 索物 / 😴 休息
- 抵达 `type: 'camp'` 或 `type: 'inn'` 的场景自动开 modal
- 多 NPC 时顶部有切换条；好感数值实时显示在 NPC 徽章上
- **赠礼**：列出主角 inventory → 按 NPC `giftPreferences` 给反应（love +15 / like +5 / neutral +1 / dislike -3 / hate -10）；NPC affection < 30 时玩家看不到预期反应，超过 30 才能预览
- **索物**：affection ≥ 50 解锁；每次索物 -5 affection；只能要 NPC 已有的物品
- **休息**：8 小时（自定义），全队 HP/MP 恢复，故事时间推进 + NPC 按 schedule 自动换位

**Added — 对话效果**
- `dialogue:effects` 事件：分支可挂任意 effect（set_variable / add_item / change_affection / set_worldFlag ...），main.js 统一应用
- `gameState.activeDialogue: { npcId, currentNode }` — 对话状态持久化，存档/读档可继续

**Added — MCP 新工具（3 个）**
- `dialogue_node_set` — 创建或更新对话节点（speaker / text）
- `dialogue_branch_add` — 给节点加分支（含 next/exit/affectionDelta/require*/effects 全字段支持）
- `dialogue_get` — 查看 NPC 完整 dialogueTree

**Tests**
- `__tests__/systems/DialogueSystem.test.js` — 10 个用例（start/branches 过滤/choose 跳转/exit/error 兜底/effects 发布）
- `mcp-server/preset-server.test.mjs` — 3 个新用例（对话树构建 + 节点不存在错误兜底）
- 全套：Jest **330 / 330** ✅（+10）+ MCP **25 / 25** ✅（+3）

### Phase 19 — 超大型剧本基础设施（角色 + NPC + 时间）🌟

为了支撑「300+ 节点、单人主角 + 动态伙伴、网状叙事、多周目收集」的愿景，把数据骨架和系统底座搭起来。Phase 20-25 都建立在这一层之上。

**Added — 19A 角色创建 + Tag 系统**
- `GamePreset.startingOptions: { races, origins, backgrounds, faiths }` — 4 个轴定义角色创建选项
- `GamePreset.startingSceneRules[]` — 按选定 tags 路由起始场景
- `GameState.playerTags[]` — 玩家创建时锁定的标签
- `src/ui/CharacterCreationModal.js` + CSS — 新游戏前的角色创建 UI（4 卡片网格 + 标签摘要）
- 新触发条件维度：`requireTags` / `requireAnyTags` / `requireNoTags` — 事件/场景连接可按 tag 门控
- `_handleNewGame` 检测到 `startingOptions` 时自动弹角色创建 modal
- `_applyPlayerCharacterChoices` — 应用 statBonus 到主角 + 按规则选择起始场景

**Added — 19B NPC 系统（与 enemies 解耦）**
- `GamePreset.npcs[]` — NPC 卡牌（含 personality / giftPreferences / schedule / dialogueTree）
- `GameState.npcState{}` + `companions[]` — 持久 affection / location / inventory / alive / mood
- `src/systems/NPCSystem.js` — `loadFromPreset` / `getScheduledScene` / `refreshNPCLocations` / `meetNPC` / `changeAffection` / `evaluateGiftReaction` / `recruitCompanion` / `dismissCompanion`
- 场景卡显示在场的 NPC（图标 + 名字 + 好感数值 / 同行标记）
- 新 effects: `change_affection`, `recruit_companion`, `dismiss_companion`

**Added — 19C 故事时间**
- `GameState.storyTime: { day, hour }` — 与游戏回合 turnNumber 解耦
- 场景旅行自动推进时间（`connection.cost` 小时 / `scene.travelHours` / 默认 1 小时）
- 新触发条件：`requireStoryTime: { minDay, maxDay, hourRange: [lo, hi] }`，hourRange 支持跨午夜
- NPC schedule 解析：按 (day, hour) 自动决定 NPC 当前所在场景
- 新 effect: `advance_time: { hours }`
- 工具栏状态栏显示 `🕐 D1 08:00`

**Added — Phase 22 预留 worldFlags**
- `GameState.worldFlags{}` — discrete narrative flags（与 variables 语义层级不同）
- 新触发条件：`requireWorldFlags`
- 新 effect: `set_worldFlag`

**Added — MCP 新工具（6 个 + 2 个 starting options）**
- `npc_list / npc_get / npc_create / npc_update / npc_schedule_add / npc_delete`
- `startingoption_set` — 设定 race/origin/background/faith 任一轴的全部选项
- `startingscenerule_add` — 新增起始场景路由规则

**Changed**
- `GamePreset.combatMode: 'party' | 'solo'`（默认 'party' 保留向后兼容；'solo' 模式 Phase 20A 接入）
- `GamePreset.aiHooks` — 5 个 hook 的开关（sceneArrival/eventResolve/npcDialogue/vignette/worldRipple）
- `SceneSystem._evaluateGated` 加 tag / storyTime 维度，门控失败时返回脱敏 reason
- `loadPreset(presetData, playerChoices)` — 新签名支持角色创建选择

**Tests**
- `__tests__/systems/NPCSystem.test.js` — 13 个用例（加载/调度/跨午夜/affection/赠礼反应/招募/伙伴）
- `__tests__/systems/EventTriggerEngine.test.js` — 9 个新用例（tags 3 维 / storyTime 3 维 / worldFlags / 跨午夜）
- `mcp-server/preset-server.test.mjs` — 5 个新用例（npc CRUD / startingOptions / startingSceneRules）
- 全套：Jest **320 / 320** ✅ + MCP **23 / 23** ✅

### Phase 18 — MCP 防御性升级（剧本审计驱动）

基于审计「霓虹叛潮」MCP 生成剧本时发现的实际问题，给 MCP server 加了一批"AI 错不了"的防护栏：

**Added**
- **`preset_analyze`** — 一键全面体检（8 个维度）：引用完整性 / 坐标冲突 / 节点可达性 / 单向连接 / 变量定义引用对照 / 主线推进模拟（贪心循环）/ 角色装备完整性 / gated.hint 安全
- **`scene_relayout`** — 检测坐标冲突自动重排（保留第一个，挪后续到附近空位）
- `mcp-server/preset-server.test.mjs` 新增 5 个用例覆盖新行为（自动避让 / 双向边 / oneWay / preset_analyze / scene_relayout）

**Changed**
- **`scene_create`**：传 `coords` 时如冲突会**自动挪到空位**（螺旋搜索），并在返回消息明示"原坐标被占用"
- **`scene_add_connection`** 默认 **bidirectional**：同时创建返程边（带"原路返回 → X"label）；可显式传 `oneWay: true` 表示有意单向（剧情逼仄推进）
- tool descriptions 加了"强烈建议让工具自动选坐标 / 生成完整剧本后调用 preset_analyze"的引导
- `preset_validate` 描述明确说明它只查引用，建议用 `preset_analyze` 做全面体检

**修复的真实预设 bug（首次审计验证）**
- 「霓虹叛潮」预设的 2 处坐标冲突（scene_soul_vault / scene_rooftop）已直接修正
- 灵媒（char_003）补配了新武器 item_018 神经聚焦器

### Phase 17 — 场景编辑器 + MCP 服务器 + 多结局 + 存档元数据 🤖

**Added**
- `src/ui/editor/SceneEditor.js` + CSS — **可视化场景图编辑**：节点列表 / 出边表单（含 gated 配置）/ vignettes / 事件挂载下拉，ID 改名自动同步所有引用
- `PresetEditorModal` 新增 🗺 场景图 标签页（旧的格子地图标签改名为 ⬛ 格子地图）
- **`mcp-server/preset-server.mjs`** — MCP server，暴露 **34 个工具**让 Claude 等客户端批量、精细化生成 TRPG 剧本：
  - `preset_*`（7）：load / save / info / set_meta / validate / export / reset
  - `scene_*`（9）：CRUD + add/remove_connection + attach/detach_event
  - `event_*`（5）：CRUD（event_create 一次性吃 choices/outcomes/effects）
  - `character/enemy/item_*`（各 4）：list / get / create / delete
  - `preset_batch_apply`：**原子批量执行 + 失败自动回滚**，AI 写整套剧本的首选入口
- `mcp-server/preset-server.test.mjs` — 12 个端到端烟雾测试覆盖场景 CRUD / 连接 / 门控 / 事件挂载 / 校验断引用 / 批量回滚
- `mcp-server/README.md` — 接入 Claude Code / 工作流示例 / gated.hint 设计原则
- `npm run mcp` / `npm run test:mcp` 脚本
- **多结局支持**：默认主线新增 `ch10_redeemed`（救赎之黎明）事件 — 唤醒堕落骑士成功后走的另一种结局。两个 ch10 事件挂同一场景，按 priority + requireVariables 自动分流
- `EndgameModal` 根据 `stats.endingPath` 显示不同的结算标题（"主线完成" vs "救赎之黎明"）
- 新增集成测试 `多结局：救赎之黎明` 验证 redeemed_knight=true 路径

**Changed**
- `_afterSceneEnter` 现在**尊重事件 trigger 条件**（让同一场景多事件能按变量分流）
- `loadPreset` 初始扫描复用 `_afterSceneEnter`，统一逻辑
- **修复初始视口居中 + 自动适配 zoom**：
  - `RenderEngine` 新增 ResizeObserver 监听父容器尺寸变化 + 发布 `render:resize` 事件
  - main.js 订阅 `render:resize` 自动重新居中（解决首次 loadPreset 时 canvas 尚未拿到最终宽高的偏移问题）
  - `SceneGraphRenderer.getFitZoom(w, h)` 算出"装下所有节点"的 zoom，`_centerMapOnPlayer` 应用之 — 任何屏幕尺寸下所有 12 节点都进视野
- **存档槽位元数据**升级为场景图友好显示：
  - 显示 `📍 林间村落 (3/12)` 而非 `(7, 1)` 坐标
  - 章节 ID 自动转成中文事件名（`ch3_village` → `第三章 林间村落`）
  - 新增字段：`currentSceneId / currentSceneName / visitedSceneCount / totalSceneCount / lastChapterLabel`
- 项目根 README 新增"可视化场景编辑器" + "MCP 服务器"特性亮点

**Dependencies**
- 新增 `@modelcontextprotocol/sdk@^1.29.0`（devDependency）

### Phase 16 — 场景图（Scene Graph）全量重构 🎯

游戏的核心地图模型从"20×15 格子地图"切换到"节点 + 连接"的场景图，每次移动 = 一段戏，不再有"走 50 格才碰一个剧情"的稀释问题。

**Added**
- `src/systems/SceneSystem.js` — 场景图核心：节点 / 连接 / 门控（`gated`）/ 旅行 / vignette
- `src/rendering/SceneGraphRenderer.js` — 节点 + 边的图状渲染（current / reachable / visited / locked / unknown 五态）
- `EventTriggerEngine` 新增 `SCENE_ENTER` 触发时机 + `inScene` 复合条件
- `AIPromptBuilder` 新增 `narrate_scene_arrival` action（启程 → 抵达的一次性叙事）
- 默认预设"暗黑森林冒险"完全重写为 **12 节点场景图**（涵盖 ch1-ch10 全主线 + 商店 + 救援支线）
- `WorldGenerator.generateScenePreset(opts)` — 输出 8 节点小冒险（forest / desert / ruins 三主题）
- `EndgameModal` 接入剧本库选择器 — 主线完成 / 工具栏新游戏都能选 4 个预制剧本
- 玩测脚本 `scripts/playtest-ai-vs-ai-scene.mjs` — Pro 模型在场景图模式下完整通关 9/10 章
- 新增测试：`SceneSystem.test.js` (11 用例) + `WorldGenerator` 场景图分支 (4 用例) + `AIResponseParser` 健壮性 (3 用例)
- 主线完成 modal（`EndgameModal`）+ 工具栏常驻 🔄 新游戏按钮 + 清空全部存档
- `gated.hint` 字段：作者可写诗意提示，覆盖默认通用文案

**Changed**
- `GamePreset` 新增 `scenes[] / startingSceneId / displayMode`（'grid' | 'scene-graph' | 'hybrid'）
- `GameState.mapState` 新增 `currentSceneId / visitedSceneIds[]`
- `loadPreset` 初始扫描：场景图模式下走 SCENE_ENTER + scene.events priority 排序，解决了开局 ch1 不触发的 bug
- 工具栏移除常驻"🎲 随机世界"按钮 — 改为新游戏对话框里选剧本
- `ch10_epilogue` 时序：`_scanEventTriggers` 在战斗进行中跳过，避免提前剧透"黎明"叙事
- `AIResponseParser` Level 4 宽松抽取支持单行 JSON + fallback 防御性清洗，杜绝裸 JSON 泄露到 UI
- 锁定节点显示脱敏：locked-but-unvisited → 节点显示 🔒 + 名字隐藏为 `???`，连接 reason 不暴露任何内部变量 / 事件 ID / 物品 ID
- `DiceRenderer` 渲染重做：结果数字加大 96px 居中、骰子动画后渐隐、`_finishAnimation` 实质清场（移除 canvas / 清 WebGL framebuffer），不再残留遮挡视野
- `item_007` 命名错位修复：拆分为 `item_013` 符文护身符（ch2 旅人剧情物品）和原 item_007 魔力水晶（薇拉初始装备）
- ToolbarPanel 第一个按钮变为 🔄 新游戏

### Phase 15 — UX / 玩测 / 日志收尾

**Added**
- `LogSystem` 诊断日志：JSON / Markdown 双格式 + console 环形缓冲（100 条）
- 工具栏 📋 导出日志按钮
- `scripts/playtest-v2.mjs` 纯后端玩测脚本，支持手动驱动 + 完整记录

**Changed**
- `_resolveEventChoice` / `_handleCombatPlayerAction` 都写入玩家叙事，确保 `[你]` 留痕覆盖全流程
- AI outcome.text 一致性 prompt 加强（防止 AI 编造与结果矛盾的情节）
- Three.js 拆分为独立 chunk，主包从 697 KB 降到 236 KB（gzip 72 KB）
- Jest 加入 `npm run test:coverage` 覆盖率报告（37.74% → 64.77%）

**Added (docs)**
- CHANGELOG.md（本文件）
- `docs/DEVELOPMENT_STATUS.md` — 接手指南（给下一位 AI / 开发者）

### 已修复的关键 bug（Phase 15-16）

| # | 描述 | 严重度 |
|---|---|---|
| 10 | 起始场景的 `inScene` 事件不触发（必须离开再回来才扫到 ch1） | **严重** |
| 11 | 场景图模式下 `ui:openEndgame` 因递归 publish 导致 modal 渲染两次（剧本库被空数据覆盖） | 严重 |
| 12 | 锁定节点 reason 暴露内部变量名 / 事件 ID（如 `knows_dark_knight = true`） | 中 |
| 13 | locked-but-unvisited 节点显示真实名字，剧透下一章 | 中 |
| 14 | 骰子动画结束后 WebGL canvas 残留，遮挡视野，结果数字不直观 | 中 |
| 15 | AI 返回单行损坏 JSON（narrative 内含未转义引号）→ UI 显示生 JSON | 中 |
| 16 | `item_007` 命名错位（叙事说"护身符"，物品是"魔力水晶"） | 中 |
| 17 | `ch10_epilogue` 在 ch9 战斗未结束时就触发，导致"黎明"叙事和战斗交错 | 中 |

---

## [1.0.0] - 2026-05-21

### 项目里程碑

完整可玩的 AI TRPG 浏览器游戏，桌面 + 移动 + PWA 三端可用。

### Phase 14 — 移动端 + PWA（commit `d7da488`）
- 768px 断点抽屉式布局（左右面板滑入/滑出）
- 触控事件适配（地图拖拽 / 点击）
- 工具栏精简（小屏只显示图标）
- manifest.webmanifest 支持"添加到主屏幕"
- viewport meta + theme-color + apple-* meta

### Phase 13 — 玩家 UX 糖（commit `136d5a6`）
- ToastManager：error / success / info / 预算告警 toast
- QuestTracker：主线进度 X/Y + "💡 下一步建议" 智能提示
- 升级反馈大型 toast

### Phase 12 — 部署配置（commit `53a5662`）
- Vercel / Netlify 一键部署配置
- GitHub Actions CI（push 自动跑测试 + 构建）
- GitHub Pages 自动部署 workflow
- README 加入部署按钮 + LICENSE

### Phase 11.B — Token 成本面板（commit `74e3ae8`）
- AIGMEngine 加入 token 使用跟踪（API usage 字段优先 + 本地估算 fallback）
- 工具栏 🪙 实时显示累计 tokens
- 设置面板 Token 使用统计 section
- 预算告警阈值 + ai:budgetWarning toast

### Phase 11.A — 生产默认值统一（commit `ba04c5c`）
- maxTokens 默认 300 → 1000（5 处统一，防止 creativeOutcome JSON 截断）
- AI 调用网络错误自动重试 1 次（800ms backoff）
- 4xx 错误不重试（避免无效请求）
- _localFallback.narrate_combat 分类兜底（胜利/逃脱/失败/开场）
- XP 曲线 ×100 → ×50（升级节奏快 1 倍）

### 玩测发现的 9 个 bug 全部修复

| # | 描述 | 严重度 | 修复 commit |
|---|---|---|---|
| 1 | 方向词"前进"误判为北 | 中 | `2df5d0d` |
| 2 | 战斗开场 AI 脑补行动 | 中 | `1467466` |
| 3 | 战斗攻击无叙事行 | 中 | `2df5d0d` |
| 4 | 队友行动叙事干涩 | 低 | `1467466` |
| 5 | **同种敌人多份卡死** | **严重** | `2df5d0d` |
| 6 | maxTokens 默认 300 过小 | 中 | `ba04c5c` |
| 7 | boss 击杀没写入记忆 | 中 | `2df5d0d` |
| 8 | **AI 并发冲突丢失叙事** | **严重** | `bd9da2f` |
| 9 | **自动存档刷新后未恢复** | **严重** | `6f3be13` |

### Initial commit (`549587c`)

完整 Phase 0-10 实现：
- **Phase 0**: 止血修复（读档 bug、API 错误兜底、Action 白名单）
- **Phase 1**: 战斗系统完整闭环（核心 / 创意行动 / 反馈打磨）
- **Phase 2**: 事件触发器扩展（6 维度复合条件 + 5 触发时机）
- **Phase 3**: 角色成长闭环（升级 / 装备 / 商店）
- **Phase 4**: AI 长期记忆（分层 + 容量归档）
- **Phase 5**: 多槽位存档 + 设置
- **Phase 6**: UI 打磨（状态栏 + 快捷键 + 响应式基础）
- **Phase 7**: 预设编辑器（6 个子编辑器 + Canvas 地图绘制）
- **Phase 8**: 玩法拓展（AI 队友 / 动态难度 / 随机世界 / LLM 决策）
- **Phase 9**: bug 扫清 + 动画过渡
- **Phase 10**: 默认主线 10 章重写

### 技术栈

- **运行时**：原生 ES Modules + Vite 5
- **AI**：OpenAI 兼容 `/chat/completions`（实测 OpenAI / DeepSeek / Ollama / 小米 MiMo）
- **渲染**：Three.js (3D 骰子) + Canvas2D (地图 + 浮动文字)
- **测试**：Jest 29，115 个单元 + 集成测试，~0.5s 全跑
- **打包**：Vite，分包后主包 236 KB / gzip 72 KB

### 文档

- [README.md](README.md) — 项目介绍
- [docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md) — AI 集成手册
- [docs/AUTHORING_GUIDE.md](docs/AUTHORING_GUIDE.md) — 预设创作者手册
- [docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md) — 开发状态与接手指南
