# 开发状态与接手指南

> **目标读者**：接手本项目继续开发的 AI Agent 或新开发者
>
> 看完这份文档后你应该能：理解项目当前位置、找到关键文件、避开已知坑、跑通验证流程、清楚下一步可做什么。

---

## TL;DR — 30 秒概览

- **是什么**：浏览器端 AI GM TRPG，AI 担任游戏主持人，玩家通过卡牌/**场景节点图**/文本推进冒险
- **技术**：原生 ES Modules + Vite + Three.js (3D 骰子) + Canvas2D，无前端框架
- **AI 接口**：OpenAI 兼容 `/chat/completions` **及 `/responses`**（hy3 等），默认本地 `qwen/qwen3.6-35b-a3b @ http://127.0.0.1:1234/v1`
- **当前状态**：Phase 16-42 完成、**Jest 737 / MCP 45 全过**、场景图作为主架构、生产就绪
- **Phase 42（最新）**：战略玩法**主题抽象框架**——战术/战略/作战/叙事四层数据抽成剧本可覆盖的 `strategySchema`（`src/data/strategySchema.js`，三国为内置默认、零回归），换皮=改数据不碰引擎；附**中世纪西幻 + 现代战争**两个主题包及示范剧本（`src/data/themes/`）。另含围城平衡细调（强攻破城/围困献城/坚守退敌/突围 四路径皆可达）+ 作战自由进谏（`launch_march`/`engage`/`siege_order` 自然语言落地）
- **已验证规模**：bundled 最大 **101 节点 / 87 事件 / 22 NPC**；三国剧本 **23 场景 / 30 事件 / 10 场军团战 + 4 场个人战 + 内政外交战略层**（0 必修、全可达，军团战经真 GM 玩测、内政外交链路 headless 验证）
- **核心能力栈**：场景图 + 快速旅行 + 角色创建 4 轴 + NPC schedule/关系图 + 故事时间 + 营地交互 + worldFlags + 隐藏路径 + IndexedDB + 跨周目元进度 + AI 本地权威状态/相关性检索 + AI Hooks gate(4 tier) + AI 参与度阶梯(L0–L4) + 个人战 buff/AOE/phases/escape + **军团战争系统(单位栈战术制·四战型)** + **叙事化战争层(行军/情报/明暗/围城/救援)** + **内政外交系统(势力级国库 + 理政朝堂 + 敌国活跃 AI，与军团战深耦合)** + **战略主题抽象(可换皮 strategySchema·西幻/现代战争主题包)** + 生态位动态掉落 + Monte Carlo 模拟器(个人战/军团战/围城/战略) + 小说→预设三段确定性管线
- **MCP 服务器**：69 个工具（小说→预设三段管线，蓝图可编排 `combatPlan` 个人战 / `legionBattlePlan` 军团战 / `strategicSetup` 内政外交；`combat_simulate`/`legion_simulate`/`strategy_simulate` 平衡模拟、战略层生成/审稿、enemy_assign_ecology 等）
- **下一步候选**：军团战 + 理政朝堂浏览器 UI（LegionBattlePanel / GovernanceModal）/ 逐城经营 / 战役级连战元层 / 部署+真人玩测

---

## 1. 快速上手（5 分钟）

```bash
npm install
npm test          # 737 tests in 58 suites
npm run dev       # localhost:3000
npm run build     # 生产构建到 dist/
npm run test:mcp  # 45 MCP smoke tests

# 数值平衡审计（5 秒，无 AI 调用）
node scripts/combat-balance-check.mjs --preset presets/eternal-crown-stress-test.json --party-by-chapter

# 端到端玩测（headless；玩家=脚本/人，GM 叙述默认走本地 http://127.0.0.1:1234/v1）
# --player scripted（默认, 确定性启发式） / interactive（人/MCP 出招） / manual（固定路线）
node scripts/playtest-large-script.mjs --max-iter 200
```

启动后：**⚙ 设置** 填 API key（任意 OpenAI 兼容服务）→ 工具栏 🔄 **新游戏** → 选剧本（默认主线 / 随机森林/荒漠/废墟）→ 节点图地图开局。

### 关键命令验证

```bash
# 测试稳定性（3 连绿）
for i in 1 2 3; do npx jest --colors=false 2>&1 | grep "Tests:"; done

# 看本轮开发历史
git log --oneline

# 看某次修复涉及哪些文件
git show <commit> --stat
```

---

## 2. 项目阶段历史

按 commit 顺序：

| Commit | 阶段 | 关键产出 |
|---|---|---|
| `549587c` | **Initial commit** | Phase 0-10 全部内容：核心 + 战斗 + 事件 + 成长 + 记忆 + 编辑器 + 文档 + 112 测试 |
| `2df5d0d` | **现场玩测 4 修** | Bug #1 (方向词), #3 (战斗叙事), #5 (敌人ID重复卡死), #7 (boss 记忆) |
| `1467466` | **战斗叙事 2 修** | Bug #2 (开场不脑补), #4 (队友叙事模板化) |
| `ba04c5c` | **Phase 11.A 生产默认值** | maxTokens 300→1000、retry、_localFallback 精致化、XP 曲线 ×50 |
| `bd9da2f` | **Bug #8 修复** | AI 并发冲突丢叙事（ch10 黎明结局消失）|
| `53a5662` | **Phase 12 部署** | Vercel/Netlify/Pages 配置 + CI workflow + README + LICENSE |
| `136d5a6` | **Phase 13 UX 糖** | Toast + 主线进度 + 下一定点建议 |
| `74e3ae8` | **Phase 11.B Token 面板** | usage 字段采集 + 工具栏指标 + 预算告警 |
| `6f3be13` | **Bug #9 修复** | 自动存档刷新后未恢复（多槽位与旧单槽 API 不一致） |
| `96d87cb` | **文档接手指南** | 新增 DEVELOPMENT_STATUS 并同步 AI/创作者手册 |
| `d7da488` | **Phase 14 移动端 + PWA** | 768px 抽屉布局、触控地图、manifest、viewport/meta |
| `f6e6b4d` | **小修与打包优化** | prompt 加强、Three.js 独立 chunk、CHANGELOG、coverage 脚本 |
| `979ba23` | **覆盖率提升** | 新增 core / utils / 多系统测试，覆盖率 37.74% → 62.42% |
| `b1fc703` | **诊断日志系统** | LogSystem + 工具栏导出 JSON/Markdown + 21 个测试 |
| _(unreleased)_ | **Phase 15 玩测留痕 + 解析健壮性** | 玩家叙事全程留痕 + AIResponseParser 单行损坏 JSON 宽松抽取 + 修复 6 处裸 JSON 泄露 |
| _(unreleased)_ | **Phase 16 场景图重构 🎯** | SceneSystem + SceneGraphRenderer + 默认预设重写为 12 节点图 + 剧本选择库（4 个）+ EndgameModal + 修 8 个 bug |
| _(unreleased)_ | **Phase 17 场景编辑器 + MCP 服务器 + 多结局 🤖** | `SceneEditor.js` + `mcp-server/preset-server.mjs`（34 工具 + batch_apply）+ ch10_redeemed 救赎结局 |
| _(unreleased)_ | **Phase 19 角色+NPC+故事时间** | 4 轴角色创建（race/origin/background/faith）+ NPCSystem（affection/schedule/giftPreferences/对话树）+ storyTime{day,hour} |
| _(unreleased)_ | **Phase 20-21 单人 + 隐藏路径** | 单人模式 + CampModal（对话/赠礼/索物/休息）+ 场景变体 + 隐藏连接（reveal_connection） |
| _(unreleased)_ | **Phase 22 worldFlags + NPC 关系图** | AIPromptBuilder 注入 worldFlags + npcRelations[] 一级传播 + applyNPCDeath 死亡冲击 |
| _(unreleased)_ | **Phase 23-25 存储 + 工具链** | IndexedDB + PresetStorage（大预设自动分发）+ MetaProgression（跨周目）+ ContextRetriever（AI 上下文检索）+ MCP 54 工具 |
| `bb57f9c` | **Phase 26A-D 战斗深化 + 多题材 + 玩测** | DiceSystem 容错 + AI Hooks gate(4 tier) + buff/debuff/dot/AOE/phases/escape_combat + 3 新预设（永燃之冠 101 节点/末日避难所/武侠青锋录）+ Monte Carlo 数值模拟器 + combat_simulate MCP 工具 |
| `d3a1f42` | **Phase 26E 新游戏流程 🧹** | 修 4 bug：清空存档不彻底/presets 不在选项/跳默认/误报恢复；用 import.meta.glob 自动列出 bundled 预设 |
| _(unreleased)_ | **Phase 27 超大型剧本与 API 体验** | MCP API-only 小说/设定集导入 + 本地 Qwen 验证；外部 generated manifest；新游戏按规模分组；API 连通性测试按钮；修新游戏叙事残留、身份串线、AI 空叙事无反馈；清洗超大型剧本玩家可见提示词痕迹 |
| _(unreleased)_ | **Phase 28 生态位/掉落/上下文** | `src/data/ecology.js` 生态位词表 + 掉落池；CombatSystem 动态掉落；MCP 生态工具；AIGMEngine 注入本地权威状态 + ContextRetriever 相关事件/物品/势力；SceneSystem 快速旅行 |
| _(unreleased)_ | **Phase 29 AI 参与度阶梯 🎚️** | `src/systems/AIAuthority.js` L0–L4 权限模型 + `filterActionsByAuthority`/`narrationCanMutate`/`authorityPromptSection`；L3 编剧动作 / L4 创世动作（校验+快照+`undoLastRewrite`）；`GameState.aiAuthority`；SettingsModal/EndgameModal 滑杆；WS `set_authority` 仅房主可调 |
| _(unreleased)_ | **Phase 30 小说→预设三段管线 📖→🎲** | 删 `novel_build_mega_preset`；新增 `novel_digest`（概括）→ `blueprint_draft`/`blueprint_validate`（设计，人工可确认）→ `preset_build_from_blueprint`（确定性构建，复用 normalize/ecology/validate）；`callOpenAICompatible`+`AIGMEngine` 支持 `/responses` 风格；tier 限敌人数 + 过滤占位 combatPlan |
| _(unreleased)_ | **Phase 31 军团战争系统 ⚔️** | `src/data/warfare.js`（兵种/克制/阵型/器械/战型/战法 + 纯结算）+ `LegionWarfareSystem.js`（单位栈战术制，与个人战零耦合）；GameSession 接 `start_legion_battle`/`legion` 动作/`legion` 快照；蓝图 `legionBattlePlan` → builder 内联军团战；`legionSimulator.js` + `legion_simulate` 平衡模拟；`narrate_legion_*` 叙述 + `_sanitizeNarrative` 修复 |
| _(unreleased)_ | **Phase 32 三国剧本 🀄** | 手写 digest/blueprint → `generate-sanguo-preset.mjs`；`public/generated/sanguo-legion-preset.json`（10 场军团战覆盖四战型 + 4 场个人战）；balance 贴史实（夷陵/街亭为难局）；hy3 真 GM 玩测通过 |
| _(unreleased)_ | **Phase 33 内政外交系统 🏛️** | `src/data/governance.js`（资源/政令/外交/敌国 AI + 纯函数）+ `StrategicSystem.js`（势力活状态、政令、外交、季度推进）；GameSession `situation:'governance'` + `govern`/`diplomacy`/`advance_season` + `strategy` 快照；深耦合军团战 `drawFromStrategy`/`allyFactionId`；`strategySimulator.js` + `strategy_simulate`；`GamePreset` 保留 factions/strategicLayer/strategicSetup |
| _(unreleased)_ | **Phase 34 三国战略内容 🀄** | 三国生成器加 `strategicSetup`（蜀视角内政外交）+ 理政朝堂 hub；夷陵/街亭 `drawFromStrategy`；strategy_simulate 蜀第 3/4 贴史实；内政外交链路 headless 验证 |
| _(unreleased)_ | **Phase 35 战略交互 AI 化 🗣️** | 设计原则：战略=底层数据，玩家角色本位、不切战略 UI。`govern`/`diplomacy`/`mobilize` 入 `ACTION_AUTHORITY`(L3)；`AIGMEngine._applyEngineActions` 落实；`say` 路由 `player_action`（自由进谏）；digest 注入国势/可用动作；`strategy.hint` 极简提示。deepseek-v4-flash 真 GM 验证自然语言进谏→落为内政动作 |
| _(unreleased)_ | **Phase 36 前端 🖥️** | 把军团战/内政外交接进浏览器 `main.js`（注册系统 + 事件效果 + 军团战高阶令编排 + 理政情境选项）；`LegionBattlePanel`（混合·简洁面板+高阶令）+ `RightPanel` 国势条（极简数值/外交 chips/情境选项/进谏提示）；GameUI 面板切换。Claude Preview 浏览器实测三国剧本 |

详细 bug 见第 5 章。

---

## 3. 架构地图

### 系统列表（GameEngine 注册顺序，priority 高→低）

```
EventSystem (100) ────── 发布订阅核心
CardManager (80) ────── 卡牌 CRUD + 按类型/标签索引
DiceSystem (70) ──────── 公式解析、优势/劣势、表达式求值
MapSystem (60) ───────── 网格地图、寻路、迷雾（向后兼容用）
CombatSystem (50) ─────── 先攻、攻击、技能、静态/动态掉落
TurnManager (40) ──────── 阶段状态机、DoT/HoT 处理
EventTriggerEngine (35) ─ 7 维度复合触发器（含 inScene）
SceneSystem (33) ──────── 场景图：节点 / 连接 / 门控 / 旅行 / 快速旅行（**主路径**）
AIGMEngine (30) ──────── AI 调用、本地状态/检索上下文管理、token 跟踪
MemorySystem (28) ────── 分层长期记忆（WorldFacts + KeyEvents）
ProgressionSystem (25) ── 升级、装备、商店
AllyAIController (22) ─── AI 队友决策（启发式 / LLM）
DifficultyTracker (21) ── 动态难度（基于战斗表现）
ImportExportSystem (20) ─ 预设/存档 JSON 导入导出
RenderEngine (10) ──────── Canvas 视口、最后渲染
LogSystem (5) ──────────── 被动收集错误/状态并导出诊断报告
```

### 文件层次

```
src/
├─ core/              GameEngine / EventSystem / StateManager
├─ models/            数据模型 (GamePreset / GameState / *Card)
├─ systems/           15 个游戏系统（含 SceneSystem）+ WorldGenerator（不是 system）
├─ rendering/         Canvas 层（SceneGraphRenderer / MapRenderer / FloatingTextLayer / DiceRenderer）
├─ ui/                30+ UI 组件（含 EndgameModal）
│  └─ editor/         7 个编辑器子模块（含 SceneEditor）
├─ data/              defaultPreset（12 节点场景图）+ promptTemplates + cardSchemas
└─ utils/             jsonValidator / tokenEstimator / deepClone / idGenerator

mcp-server/           MCP 服务器（让 Claude 等客户端批量生成剧本）
├─ preset-server.mjs   主入口（34 工具 + JSON-RPC over stdio）
├─ preset-server.test.mjs 12 烟雾测试
└─ README.md          接入 Claude Code 配置 + 工作流示例
```

### 场景图（主路径）

```
preset.scenes[] 是头等数据，preset.map 仅作向后兼容保留

每个 scene:
  { id, name, type, icon, coords: {x,y},
    description,                     // AI 抵达时的素材
    connections: [{ to, label?, cost?, gated? }],  // 出边（单向，写双向就写两条）
    events: [eventId, ...],           // 抵达时按 priority 选首个未完成的触发
    vignettes: [...],                 // 重访的本地短描述（无 AI 调用）
    tags: [...] }

连接的 gated 条件（不暴露给 UI，UI 看到的是诗意文案）:
  gated: { requireVariables?, requireCompletedEvents?, requireItems?,
           hint?: '只有听过那位骑士的故事，你们才会知道路径' }

GameState.mapState 新字段:
  currentSceneId      当前所在节点
  visitedSceneIds[]   已访问过的节点（决定重访 vignette 是否触发 + 锁定节点是否露名）

触发器多了一个维度:
  trigger.condition.inScene: ['scene_x', 'scene_y']
  仅在 SCENE_ENTER 时机评估 — 抵达对应场景才扫
```

### 渲染器分流

`main.js` 的 canvas render callback 根据 `preset.displayMode` 路由：

```js
if (preset.displayMode !== 'grid' && sceneSystem.hasScenes()) {
  sceneRenderer.render(ctx, viewport, gameState, sceneSystem);
} else if (mapRenderer.mapData) {
  mapRenderer.render(ctx, viewport, gameState);  // 旧 grid 兼容
}
```

`SceneGraphRenderer` 节点五态：
- `current` 金色发光 + 名 + 图标
- `reachable` 青色发光 + 名 + 图标
- `visited` 灰色 + 名 + 图标
- `locked` 暗灰 + **🔒** + **`???`**（仅当 unvisited 时隐名，去过的话保留）
- `unknown` 雾化 `?`

### 关键调用链

**玩家行动 → AI → 状态变化**

```
玩家点击/输入
  ↓
EventSystem.publish('player:action' or 'event:choice')
  ↓ main.js 订阅处理
TRPGApp._executeXxx
  ↓ 调用相关 System（Combat/Event...）
更新 gameState
  ↓
AIGMEngine.processGameAction(actionType, data, gameState)
  ↓
AIPromptBuilder.buildActionMessage / buildSystemPrompt
  ↓ messages 数组
_callAIOnce (with retry) → API
  ↓
AIResponseParser.parse + _validateAction（白名单拦截）
  ↓ 应用合法 actions
gameState.addNarrative + 触发后续 _scanEventTriggers
  ↓
EventSystem.publish('game:stateChanged')
  ↓
GameUI.update → 各面板刷新
```

### 数据流：长期记忆三层

```
Layer 1: WorldFacts (永久, gameState.aiContext.worldFacts)
  ↓ 来自 preset.lore + 容量超限归档
Layer 2: KeyEvents (滚动20条, gameState.aiContext.keyEvents)
  ↓ 来自 _resolveEventChoice / _finalizeCombat / AI add_memory action
Layer 3: contextWindow + summarizedHistory (AIGMEngine 内存)

每次 AI 调用：
  System 1: cached preset prompt (preset.lore + 角色)
  System 2: 【世界事实】+【已发生的关键事件】（MemorySystem.getMemoryView）
  System 3: 近期剧情摘要（summarizedHistory）
  Context: 最近 N 条 messages
  User: 当前 actionType 的 message
```

---

## 4. 关键设计决策

### 4.1 AI 边界（最重要）

**AI 讲故事，CombatSystem 算账。** AI 不直接控制数值；它返回的 actions 必须经过 `AIResponseParser._validateAction` 校验（白名单 + 范围检查）：

- `damage` value 限 [0, 100]
- `add_item / remove_item / start_combat / trigger_event` 引用必须在 CardManager 里存在
- `add_memory` value 长度 ≤ 200

这是防止 AI"幻觉破坏存档"的核心防线。**任何新增的 AI action 类型必须先在 `_validateAction` 加规则**。

### 4.2 Option B 战斗中文本输入

玩家战斗中输入文本 → 路由到 `combat_creative` actionType → AI 评估 DC + 返回 `creativeOutcome: {dc, onSuccess, onFail}` → DiceSystem 判定 → 应用对应分支的 actions。

代码位置：[main.js#_handleCombatCreativeAction](../src/main.js)。设计初衷：让玩家的非常规创意（"抓灰烬扬狼眼睛"）有意义，但仍受游戏机制约束。

### 4.3 同种敌人 instance ID（修了的坑）

`CombatSystem.findCombatant` 用 `enemies.find(id===)`。如果两只暗影狼都是 `enemy_002`，find 总返回第一只 → 第一只死后，filter 把活的也当死的过滤掉 → **战斗卡死**。

修复（[main.js#_startCombat](../src/main.js)）：每只敌人加 `#idx` 后缀作为唯一 instance ID（原 ID 存 `_originalId`）。**任何添加新战斗启动路径的代码必须保持这个约定。**

### 4.4 自动存档与多槽位

- `_autoSave` 写入多槽位的 `auto` 槽
- `_loadInitialData` 优先读 `auto` 槽，降级到旧 `trpg_save` 单槽
- 这俩在 Bug #9 之前用的是完全不同的 localStorage 键

**未来要新增"快速恢复"或"云存档"时，必须用 `loadFromSlot('auto')` API**，不要用 `loadFromLocal('trpg_save')`。

### 4.5 prompt 中"严禁脑补"明示（Bug #2 教训）

AI 容易在 `narrate_combat` 开场（roundResults 为空）时编造"艾拉挥剑、雷恩拉弓"等不存在的行动。修复方式是在 prompt 中**明确禁止**：

> "严禁描述任何角色的具体行动（不要写"举盾/拉弓/施法/挥剑"等动作）。"

写新的 AI prompt 时要预防类似问题：**用强语气列禁止项，比正向描述更有效**。

### 4.6 AI 并发冲突（Bug #8 教训）

`AIGMEngine.processGameAction` 在 `isProcessing=true` 时**不能**返回占位结果丢弃叙事。改为轮询等待前一请求完成（最多 30s）。

涉及链式 AI 调用的场景（如战斗结束 → COMBAT_END scan → ch10 触发 → ch10 narrate）必须验证 narrative 真正写入了 narrativeLog。

### 4.7 场景图代替格子地图（Phase 16）

**桌游 GM 不描述"你迈出第 47 步"，而是描述"你们花了大半天抵达林间村落"**。原来的 20×15 = 300 格 grid 里只有 ~6 个有意义的事件触发点，剩下 98% 是空格 —— 玩家每走一格都触发一次 AI 叙事 → AI 重复编"道路腐臭、枯树、乌鸦……"模板填充。

场景图把"地图"升级成"节点 + 边"：

- 每个节点 = 一段戏 = 一次 AI 抵达叙事
- 默认主线从 300 格压成 12 节点
- 一局完整通关 GM 叙述调用从 60+ 降到 ~30 次（详见 `scripts/playtest-large-script.mjs` 真实数据）

`preset.displayMode === 'scene-graph'` 时主路径走场景图；`'grid'` 时回退旧渲染（向后兼容）。`preset.scenes[].length > 0` 时 `GamePreset` 构造函数会自动把 displayMode 设为 scene-graph。

### 4.8 防剧透 / 防泄露原则（Bug #12-13 教训）

**永远不要把内部 key（变量名 / 事件 ID / 物品 ID）泄露到玩家可见 UI**：

- 锁定的 connection.gated → reason 走通用文案（"你们似乎还差一些线索"）或作者写的 `hint`
- locked-but-unvisited 的 scene → 名字、图标都隐藏为 `🔒 ???`
- 已访问过的 scene 即使后来被门控（不太可能但理论上）也保留名字显示

写新 UI 组件涉及到 gameState 时，先问：**这个字符串如果暴露给玩家会不会剧透 / 暴露技术细节？**

### 4.9 AIResponseParser 防御性解析（Bug #15 教训）

AI 偶尔返回的 JSON 在 `narrative` 字段里夹未转义的引号（`"narrative":"... 薇拉说："...""，导致 JSON.parse 失败。三级 fallback：

1. 直接 `JSON.parse`
2. 提取 markdown code block 包裹的 JSON
3. 提取首尾 `{...}` 之间的内容
4. **宽松正则抽取 narrative 字段**（兼容单行 + 多行损坏 JSON）
5. **fallback 防御性清洗**：剥掉 `{`, `"narrative":"` 前缀，抹掉尾部 `"actions":...` 残骸

所有这些步骤的目标只有一个：**生 JSON 文本永远不应该出现在玩家叙事面板里**。

### 4.10 场景图模式下事件触发链

事件触发不再依赖玩家"踩到 tileType 触发"，而是：

1. **抵达场景**（`_travelToScene`）→ 写玩家行动 + AI 抵达叙事（首访）或 vignette（重访）
2. **扫描 scene.events 数组**（按 priority 排序，过滤已完成不可重复的）→ 触发第一个匹配的
3. **如果没有 scene.events 匹配**，回退扫 `SCENE_ENTER` 时机的全局触发器（含 `inScene` 条件）

**重要约束**：战斗中（`activeCombat` 存在）跳过 `EVENT_COMPLETE` 扫描，避免 ch10 这种"完成 ch9 触发"在 ch9 战斗还没真正结束时就把 ending 叙事写出来。等 `COMBAT_END` 时机再补扫。

### 4.11 大剧本上下文策略（Phase 28）

不要再把"更多剧本内容"塞进聊天上下文来解决超大型剧本问题。当前设计是：

- `MemorySystem` 只给有限的世界事实和关键事件
- `AIGMEngine._buildLocalStateDigest` 每次注入本地权威状态：当前场景、变量、已完成事件、队伍、战斗敌人、当前事件
- `ContextRetriever.buildContextDigest` 只检索当前相关切片：附近/当前场景、NPC、事件、物品、势力
- `contextWindow` 只保留短期衔接，压缩后确保从 user 消息开始，兼容本地模型 chat template

这意味着 GM 模型只负责"基于当前权威状态写一小段判断与描述"，不负责记住整部小说、全地图或所有势力细节。新增大剧本功能时，应优先把事实落在 `preset` / `gameState` / `MemorySystem` / `ContextRetriever` 可检索结构里。

### 4.12 快速旅行边界

快速旅行不是 AI teleport。`SceneSystem.planFastTravel` 只允许目标满足：

- 目标已经探索过
- 从当前节点沿已探索节点、当前可见连接、已满足门控能找到路径
- 路径耗时由 `connection.cost` 或目标 `scene.travelHours` 计算

`main.js._fastTravelToScene` 在移动前用代码结算耗时、路途损耗、随机遭遇；如果遭遇中断，只把队伍移动到中断节点并启动战斗。GM 模型只参与最终抵达或中断结果的叙事，不能决定是否真的抵达。

### 4.13 生态位 → 掉落表 → 图像

`src/data/ecology.js` 把敌人的生态位显式化为：

```js
ecology = { biome: 'swamp', creatureType: 'beast', tier: 'elite' }
```

使用方式：

- 生成时静态烘焙：`resolveLootTable(ecology)` 写入 `enemy.lootTable`
- 运行时动态抽取：`enemy.lootMode = 'dynamic'`，战斗结束由 `rollDynamicLoot` 实时抽
- 旧数据兼容：有 `ecology` 但没有静态 `lootTable` 时自动走动态掉落；已有 `lootTable` 默认优先使用静态表
- MCP 侧用 `enemy_assign_ecology` 写 ecology、烘焙掉落、把缺失物品从 `assetLibrary` 物料化进 `preset.items`，并给敌人配图

以后扩展新地区时，先补 `LOOT_POOLS` 和素材库，再让生成器使用同一套 `biome / creatureType / tier` 词表。

### 4.14 AI 参与度阶梯（Phase 29）

`src/systems/AIAuthority.js` 是「AI GM 能管多宽」的单一权限源，与 Action 白名单互补：

- `GameState.aiAuthority`（0–4，默认 2）是玩家可调的档位，新游戏可选、游戏中拖滑杆改、多人仅房主可调
- `filterActionsByAuthority(actions, level)` 在 `_validateAction` 之后再按档位过滤；`ACTION_AUTHORITY` 表声明每个 action 需要的最低档
- L3 编剧动作走 `AIGMEngine._applyEngineActions`，L4 创世动作走 `_applyWorldsmithActions`（校验 + 快照 + `undoLastRewrite` + `_reachableSet` 保护可达性）
- `narrationCanMutate(level)`：仅 ≥L3 允许 narrate_* 期间改状态
- `authorityPromptSection(level)` 每次调用注入档位边界说明；`DifficultyTracker.manualBias` 让档位影响难度基线

新增需要 AI 改状态的能力时，**务必在 `ACTION_AUTHORITY` 表登记最低档位**，否则会被低档位玩家的过滤闸丢弃。

### 4.15 小说 → 预设 三段确定性管线（Phase 30）

废弃旧 `novel_build_mega_preset`（读全文 LLM 自由发挥，质量不可控）。新管线把 LLM 风险隔离在前两段（产物可人工确认），第三段确定性：

1. **`novel_digest`（段①）** — 本地分析 + LLM 概括 → `NovelDigest`（只记叙事节拍，无游戏结构）
2. **`blueprint_draft` / `blueprint_validate`（段②）** — LLM 据 digest 设计 `PresetBlueprint`，按 `sizeClass` clamp 规模；人工可确认
3. **`preset_build_from_blueprint`（段③）** — **不调 LLM**，编译成预设，复用 `presetNormalize`/`resolveLootTable`/`assignPresetImages`/`validatePreset`

段③纪律：按 tier 限同场敌人数（trivial/common≤3、elite≤2、boss≤1）、过滤占位/无战斗 combatPlan（`enemyConcept` 命中 `无战斗|纯叙事|none` 或为空时跳过）。改进段③时**先改 builder 再用既有 digest/blueprint 重新确定性构建即可**，不必重调 LLM。LLM 调用支持 `/chat/completions` 与 `/responses` 两种风格（见 AI_INTEGRATION 二）。

### 4.16 军团战争系统（Phase 31）

与个人战（`CombatSystem`：HP/属性/先攻回合制）**完全平行、零耦合**的另一套战斗，单位栈战术制。路由由"事件用哪个 effect"决定，无引擎级开关：

- **数据层** `src/data/warfare.js`（纯数据+纯函数，runtime/MCP 共享，仿 ecology.js）：兵种 `UNIT_TYPES` + 克制 `COUNTER_MATRIX`、阵型 `FORMATIONS`（按主将阵法等级解锁）、器械 `WAR_MACHINES`（按战型白名单+携带上限）、战型 `BATTLE_TYPES`（野战歼灭/攻城破门/守城守满回合/水战控渡口）、战法 `TACTICS`；纯结算 `resolveAttack`/`checkVictory`/`validateLegionBattle` 等。
- **系统** `src/systems/LegionWarfareSystem.js`：平行 `CombatSystem`，提供 `startBattle`/`executeOrder`/`decideLegion`/`nextTurn`/`endBattle` 原语；指令 move/attack/set_formation/bombard/tactic/hold/retreat；主将武力加近战、统率加士气、智力加远程/战法；粮草耗尽掉士气、士气崩溃溃退。
- **接线** `GameSession`：事件效果 `start_legion_battle`（内联整场编制 + 主将武备）、`legion` 动作、`getState` 的 `situation:'legion'` 快照与指令选项；auto（`decideLegion` 启发式，给测试/模拟器）+ interactive 双模式，复用 `combatMode`。`GameState.activeLegionBattle` 序列化。
- **编排** 蓝图 chapter `legionBattlePlan`（与 `combatPlan` 个人战并列）→ `buildPresetFromBlueprint` 编译；主将 `warfare` 属性从 digest 角色装配，`validateLegionBattle` 校验编制。
- **平衡** `src/systems/legionSimulator.js`（核心）+ `scripts/legion-balance-check.mjs`（CLI）+ MCP `legion_simulate`：蒙特卡洛跑某场军团战，输出胜率/回合/损耗 + 标志。
- **叙述** `narrate_legion_start` / `narrate_legion_result` 钩子（AIGMEngine + AIPromptBuilder）；`_sanitizeNarrative` 兜底清洗 Responses-API 偶发的 JSON 片段泄漏。
- **个人战保留** 单挑/切磋/暗杀/逃脱仍走 `start_combat`（个人战）；剧本编排层决定某节点调哪套。
- **下一步** 浏览器军团战对战面板 `LegionBattlePanel`（按 `CombatPanel.js` 范式）尚未做。

### 4.17 内政外交系统（Phase 33）

把原本只用于"战略汇报"的描述性 `strategicLayer` 升级为可操作的战略层，与军团战、剧情深耦合：

- **数据层** `src/data/governance.js`（纯数据+纯函数）：资源（金/粮/兵/民心）、政令 `POLICIES`、外交 `DIPLOMACY_ACTIONS`、立场 `STANCES`；纯函数 `seasonProduction`/`applyPolicyPure`/`applyDiplomacyPure`/`decideEnemyStrategy`（敌国 AI）/`validateStrategicSetup`。
- **系统** `src/systems/StrategicSystem.js`：从 `preset.strategicSetup`（活状态种子，优先）或 `strategicLayer`（描述数据）初始化各势力活状态（金/粮/兵/民心 + holdings 聚合 + 对称外交关系）；`applyPolicy`/`applyDiplomacy`/`advanceSeason`（全势力 upkeep + 敌国 AI + 事件产出）/`mobilize`/`ranking`。状态存 `gameState.strategicState`。
- **接线** `GameSession`：`loadPreset` 调 `initFromPreset`；`getState` 始终带 `strategy` 概要，位于 `tags` 含 `governance` 的场景时 `situation:'governance'` + 内政/外交/`advance_season` 选项；`applyAction` 加 `govern`/`diplomacy`/`advance_season`；事件效果 `set_diplomacy`/`adjust_resource`/`mobilize`；`narrate_governance`/`narrate_diplomacy` 钩子。
- **深耦合军团战** `start_legion_battle` 的 `drawFromStrategy`：我方兵粮从玩家国库取并扣减，战后残部归队 + 民心/资源/关系结算；`allyFactionId` 盟友按外交出援军；玩家/敌国宣战或来犯 → 置 `worldFlags.war_with_<id>`/`invasion_from_<id>`，供剧本军团战触发器挂接。
- **管线** 蓝图 `strategicSetup` → `buildPresetFromBlueprint` 写 `preset.strategicSetup` + 生成「理政朝堂」hub；`legionBattlePlan` 支持 `drawFromStrategy`/`enemyFactionId`/`allyFactionId`。
- **平衡** `src/systems/strategySimulator.js` + MCP `strategy_simulate`：模拟 N 季报势力消长/经济可持续性。
- **重要修复** `GamePreset` 此前未保留 `factions`/`strategicLayer`/`strategicSetup`（被构造函数丢弃），现已补上。
- **角色本位交互（Phase 35）** 战略层是**底层数据支持**，不做独立战略 UI。主交互是玩家以所扮角色"自由进谏"：`applyAction('say', {text})` → `AIGMEngine.processGameAction('player_action')` → AI 在参与度阶梯允许时把主张落为 `govern`/`diplomacy`/`mobilize`（L3 档，`_applyEngineActions` 调 StrategicSystem）并叙述。`situation:'governance'` 降级为可选简化决策场景；`strategy` 快照极简 + ≥L3 给 `hint`。
- **下一步** 浏览器「理政朝堂」面板 `GovernanceModal`（极简：只显示必要数值 + 情境选项 + 进言入口）+ 逐城经营，尚未做。

---

## 5. 已修复的 17 个 bug（含防回归测试）

### Phase 0-14 修的（1-9）

| # | 描述 | 严重度 | 防回归 |
|---|---|---|---|
| 1 | 方向词"前进"误判为北 | 中 | 手动重 PreviewTest 9 个用例 |
| 2 | 战斗开场 AI 脑补行动 | 中 | prompt 强禁止短语 + 真实 API 验证 |
| 3 | 战斗攻击无叙事行 | 中 | 玩测直观可见 |
| 4 | 队友行动叙事干涩 | 低 | 模板库随机化 |
| 5 | **同种敌人多份卡死** | **严重** | `__tests__/systems/CombatSystem.test.js` 加了 1 个测试 |
| 6 | maxTokens 默认 300 过小 | 中 | 5 处统一改为 1000 |
| 7 | boss 击杀没写入记忆 | 中 | endResult.defeatedEnemies 快照 |
| 8 | **AI 并发冲突丢失叙事** | **严重** | processGameAction 轮询等待 + 玩测 ch10 黎明验证 |
| 9 | **自动存档刷新后未恢复** | **严重** | _loadInitialData 优先 loadFromSlot('auto') |

### Phase 15-16 修的（10-17）

| # | 描述 | 严重度 | 防回归 |
|---|---|---|---|
| 10 | **起始场景 inScene 事件不触发**（开场 ch1 没弹出，必须离开再回来） | **严重** | `loadPreset` 初始 setTimeout 走 scene.events priority 排序 + SCENE_ENTER 兜底 |
| 11 | 场景图模式下 `ui:openEndgame` 因递归 publish 导致 modal 渲染两次（剧本库被覆盖） | 严重 | 改 mutate evt.data，与 `ui:openEditor` 同一模式 |
| 12 | 锁定节点 reason 暴露内部变量名（如 `knows_dark_knight = true`） | 中 | `_evaluateGated` 返回脱敏 reason，`SceneSystem.test.js` 加 `not.toContain('quest_received')` 用例 |
| 13 | locked-but-unvisited 节点显示真实名字 → 剧透下一章 | 中 | SceneGraphRenderer + 终端卡：hideIdentity 时显示 `???` |
| 14 | 骰子动画结束后 WebGL canvas 残留遮挡视野 | 中 | `_finishAnimation` 实质清场：dispose + clear framebuffer + container.innerHTML = '' |
| 15 | AI 返回单行损坏 JSON → UI 显示生 JSON 文本 | 中 | `AIResponseParser._tryExtractLenient` 单行 + fallback 防御性清洗 + 3 个回归测试 |
| 16 | `item_007` 命名错位（叙事说"护身符"，物品名"魔力水晶"） | 中 | 拆 `item_013` 符文护身符 + ch2 改用新 ID + E2E 测试更新 |
| 17 | `ch10_epilogue` 在 ch9 战斗未结束时就触发，"黎明"叙事和战斗交错 | 中 | `_scanEventTriggers` 在 activeCombat 时跳过 EVENT_COMPLETE 扫描 |

**给接手者**：跑这个项目时如果发现类似行为重新出现，**第一时间查 git blame**，可能是上面这些修复回归了。

---

## 6. 玩测验证模式

### 6.1 真实 AI 玩测

测试使用 OpenAI 兼容 API。默认本地模型：`qwen/qwen3.6-35b-a3b @ http://127.0.0.1:1234/v1`。

```js
// 1. localStorage.clear() + reload
// 2. 等 1500ms 让 app 初始化
// 3. aiEngine.setAPIConfig({ endpoint, apiKey, model: 'qwen/qwen3.6-35b-a3b' })
// 4. 通过 publish/调用 _xxx 方法触发剧情
// 5. await 几秒等 AI 真实响应
// 6. 检查 narrative / activeEvent / completedEventIds / keyEvents
```

**重要**：
- 模型名大小写敏感；以接口 `/v1/models` 返回为准
- 真 AI 调用 1-6s，等待时间要足够
- token 监控可见，一场 10 章测试 ~30K tokens（成本 ¥0.05-0.2）

**2026-05-29 最新验证**：
- 默认配置已切到本地 OpenAI 兼容端点 `http://127.0.0.1:1234/v1` 和模型 `qwen/qwen3.6-35b-a3b`。
- 本地 127.0.0.1/localhost 端点允许 API key 留空；远端接口仍需要填写密钥。
- 设置面板测试按钮和 headless playtest 共用同一条 `/chat/completions` 链路。

### 6.2 Mock AI 单元测试

测试套件全部使用 mock，避免真 API 调用。例子见 `__tests__/integration/_harness.js`，patch AIGMEngine.callAI 返回固定 JSON。

### 6.3 Preview 评估模式

整个开发流程使用 Claude 的 preview_eval 工具直接在浏览器上下文执行 JS：

```js
// 启动 dev server (mcp__Claude_Preview__preview_start)
// 然后 preview_eval 注入测试代码
const app = window.__trpgApp;  // 全局调试入口
// 调用 app._xxx, 检查 app.gameState, ...
```

`window.__trpgApp` 是开发用的全局入口，**生产代码不应依赖它**。

---

## 7. 测试结构

```
__tests__/
├─ setup.js                       Jest 配置
├─ styleMock.js                   CSS import 拦截
├─ core/
│  ├─ EventSystem.test.js          发布订阅、取消订阅、错误隔离
│  ├─ GameEngine.test.js           系统注册、循环、暂停恢复
│  └─ StateManager.test.js         状态读写、快照、订阅
├─ integration/
│  ├─ _harness.js                 测试夹具（mock AI + travelTo + 战斗自动结算）
│  └─ mainQuest.test.js           ch1→ch10 完整剧情链 E2E（场景图驱动）
├─ utils/
│  └─ utils.test.js                id/deepClone/jsonValidator/tokenEstimator
└─ systems/
   ├─ DiceSystem.test.js          公式解析、优势/劣势
   ├─ CombatSystem.test.js        攻击、技能、nextTurn 索引 bug 回归
   ├─ AIResponseParser.test.js    JSON 解析 fallback（4 级）、action 校验
   ├─ EventTriggerEngine.test.js  7 维度触发条件（含 inScene）
   ├─ ProgressionSystem.test.js   升级公式、装备、商店
   ├─ MemorySystem.test.js        WorldFacts/KeyEvents、容量归档
   ├─ AllyAIController.test.js    队友启发式/LLM 决策
   ├─ CardManager.test.js         卡牌 CRUD 与索引
   ├─ DifficultyTracker.test.js   动态难度统计
   ├─ TurnManager.test.js         回合状态机
   ├─ WorldGenerator.test.js      随机 grid + scene graph 生成
   ├─ SceneSystem.test.js         场景图：加载/邻居/gated/旅行/vignette/脱敏
   └─ LogSystem.test.js           JSON/Markdown 诊断报告、console 环形缓冲
```

### 玩测脚本

```
scripts/
├─ playtest-v2.mjs               纯后端手动驱动玩测（场景前的版本）
├─ playtest-large-script.mjs     大型/超大型剧本玩测（玩家=脚本/人/MCP，GM 叙述可选接模型）
├─ mcp-llm-agent.mjs             LLM-as-MCP-client：本地模型经 MCP 工具生成剧本（创作期）
├─ combat-balance-check.mjs      战斗数值平衡 Monte Carlo 模拟（纯计算，不接 AI）
└─ generate-*.mjs                各预设生成脚本

# 运行期 MCP 对局服务（给 AI 占位玩家 / 自动化测试）：
#   mcp-server/game-session-server.mjs  — session_start / session_state / session_act
# 注：玩家不再由 LLM 扮演；仅人/MCP（interactive）或确定性脚本（scripted）。
```

**给接手者**：新增功能要先想"怎么测"。系统级的测试比 UI 测试容易写（不需要 DOM mock）。

---

## 8. 待办与设计妥协

### 8.1 已知次要问题（未修，影响小）

| # | 描述 | 临时缓解 |
|---|---|---|
| Obs #1 | AI 偶尔生成 outcome.text 不一致的叙事（如选"使用护身符成功"AI 仍写"石像鬼苏醒"） | prompt 加强"严格按 outcomeText 写" |
| Obs #2 | 对角线方向（"向西北"）解析为方向但 MapSystem.canMoveTo 拒绝（曼哈顿距离 ≠ 1） | 用户选项不暴露对角线移动 |
| Obs #3 | Three.js 独立 chunk 仍较大（约 475 KB / 119 KB gzipped）| 当前已分包；后续可考虑按需动态加载 |
| Obs #4 | 部分旧预设仍有手写静态 lootTable，未全部迁入 ecology | 新敌人优先用 `enemy_assign_ecology`；旧数据保持兼容 |

### 8.2 候选下一步（按价值排）

| 方向 | 工作量 | 价值 |
|---|---|---|
| **编辑器加场景图可视化编辑** | 中 | 当前 scenes[] 仅能写 JSON 编辑；拖拽节点 + 连线 GUI 是 Phase 16 的明显缺口 |
| 生态位覆盖率审计工具 | 小 | 检查大型剧本敌人是否都标了 ecology、lootTable 引用是否都有图 |
| 素材库继续扩展 | 中 | 更多年龄/职业/建筑状态/天气/同类型 NPC 多变体，提高自动配图辨识度 |
| 推 GitHub + 上线 Pages/Vercel | 小 | 让别人能玩到 |
| 真实 API 主线场景图回归玩测 | 小 | 浏览器端跑通 12 节点完整流程（headless 已验证） |
| WorldGenerator.generateScenePreset 扩主题 | 小 | 当前只有 forest/desert/ruins 三个；可加 sci-fi / 武侠 / 蒸汽 等 |
| 多语言（i18n） | 中 | 面向全球受众 |
| 社区预设库（URL 分享） | 中 | UGC 生态 |
| 战斗 UI 视觉打磨（伤害飞数字字体动画/技能特效） | 中 | 体验提升 |
| AI 队友 LLM 模式深度优化 | 小 | 已实现，可调 prompt |

---

## 9. 工作流约定

### 9.1 Git Commit 风格

```
feat: 新功能
fix: 修 bug（标注 Bug #N）
chore: 配置/文档/部署
refactor: 重构

详细 body（多行）：解释 why、key 变化、实测结果、测试是否通过。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

例子见 `git log --oneline` 然后 `git show <hash>`。

### 9.2 修 Bug 流程

1. **定位**：通过玩测或测试发现现象
2. **归因**：用 `grep` / `Read` 找到具体代码
3. **最小修复**：改尽量少的行
4. **回归测试**：尽可能加单元测试覆盖该场景
5. **真实 AI 验证**（如果可能）：用 preview_eval 跑一次确认
6. **commit message** 标注 Bug #N，说明根因和修复策略

### 9.3 加新系统/UI 组件

1. 先想"是否可以放进现有系统"
2. 必要时新建 `src/systems/Xxx.js` 继承 `GameSystem`
3. `main.js._registerSystems` 注册时分配 priority
4. 写测试 `__tests__/systems/Xxx.test.js`
5. UI 组件遵循"构造函数接 (container, eventSystem, ...) + render/update/destroy"约定

### 9.4 不要做的事

- **不要 `git reset --hard`** 除非用户明确同意
- **不要跳过 Action 白名单校验**（即使 AI 返回看起来合理的字段）
- **不要在 `window.__trpgApp` 上加生产逻辑**（仅 debug 用）
- **不要直接覆写 gameState 字段**，用合适的 API（addNarrative / completeEvent 等）

---

## 10. 给下一位接手者的建议

### 优先理解的 6 个文件

1. **[src/main.js](../src/main.js)** ~2200 行，TRPGApp 主类、所有事件订阅、玩家行动处理。理解了它就理解了整个流程。
2. **[src/systems/SceneSystem.js](../src/systems/SceneSystem.js)** 场景图核心：节点 / 连接 / 门控 / 旅行 / vignette / 脱敏 reason。
3. **[src/systems/AIGMEngine.js](../src/systems/AIGMEngine.js)** AI 调用核心、token 跟踪、并发处理。
4. **[src/systems/EventTriggerEngine.js](../src/systems/EventTriggerEngine.js)** 7 维度触发器（含 inScene），剧情逻辑的核心。
5. **[src/data/defaultPreset.js](../src/data/defaultPreset.js)** 12 节点主线参考实现，看它就懂场景图怎么写。
6. **[docs/AI_INTEGRATION.md](AI_INTEGRATION.md)** + **[docs/AUTHORING_GUIDE.md](AUTHORING_GUIDE.md)** 用户视角的两份手册。

### 高 ROI 行动

- **跑一次完整测试 + 用真实 API 玩一遍主线**：30 分钟内能感知 80% 项目状态
- **看 `git log` 详细 message**：能 trace 关键决策为什么这么做
- **改任何 AI prompt 前**先 grep 现有 prompt：风格保持一致更重要

### 容易踩的坑

| 坑 | 避坑 |
|---|---|
| 改 AI prompt 时忘了配套改 _localFallback | grep `'narrate_combat'` 等 actionType 看是不是要同步改 |
| 加新事件触发器维度但忘了 EventTriggerEngine 处理 | grep `requireVariables` 看现有维度怎么实现的 |
| 改 EventCard schema 字段忘了 toJSON 同步 | grep `toJSON` 看模型层约定 |
| 改 GameState 字段忘了 fromPreset / fromJSON 同步 | 同上 |
| 真实 API 测试时模型名错误大小写 | 先 GET `/v1/models` 看返回 |

---

## 11. 联系方式与 License

- License: MIT（见 [LICENSE](../LICENSE)）
- 用户的开发邮箱: aannvvc@gmail.com（已在 git config）
- 项目使用 Claude Opus 4.7 共同开发，commit message 中 `Co-Authored-By` 已标注

---

**这份文档是"项目当前快照"，会随项目继续开发而变。新增重要决策、修关键 bug 后请更新本文档。**
