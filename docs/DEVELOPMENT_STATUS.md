# 开发状态与接手指南

> **目标读者**：接手本项目继续开发的 AI Agent 或新开发者
>
> 看完这份文档后你应该能：理解项目当前位置、找到关键文件、避开已知坑、跑通验证流程、清楚下一步可做什么。

---

## TL;DR — 30 秒概览

- **是什么**：浏览器端 AI GM TRPG，AI 担任游戏主持人，玩家通过卡牌/地图/文本推进冒险
- **技术**：原生 ES Modules + Vite + Three.js (3D 骰子) + Canvas2D，无前端框架
- **AI 接口**：OpenAI 兼容 `/chat/completions`，实测兼容 OpenAI / DeepSeek / Ollama / 小米 MiMo
- **当前状态**：9 个 commit、115/115 测试通过、生产就绪、完整 10 章默认主线 + 真实 AI 端到端验证
- **下一步候选**：移动端适配 / 上线部署 / 多语言 / 社区预设库

---

## 1. 快速上手（5 分钟）

```bash
npm install
npm test          # 115 tests in 7 suites, ~0.5s
npm run dev       # localhost:3000
npm run build     # 生产构建到 dist/
```

启动后：**⚙ 设置** 填 API key（任意 OpenAI 兼容服务）→ 自动加载"暗黑森林冒险"10 章主线 → 工具栏 🎲 可换随机世界。

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

详细玩测发现的 9 个 bug 见第 5 章。

---

## 3. 架构地图

### 系统列表（GameEngine 注册顺序，priority 高→低）

```
EventSystem (100) ────── 发布订阅核心
CardManager (80) ────── 卡牌 CRUD + 按类型/标签索引
DiceSystem (70) ──────── 公式解析、优势/劣势、表达式求值
MapSystem (60) ───────── 网格地图、寻路、迷雾
CombatSystem (50) ─────── 先攻、攻击、技能、掉落
TurnManager (40) ──────── 阶段状态机、DoT/HoT 处理
EventTriggerEngine (35) ─ 6 维度复合触发器
AIGMEngine (30) ──────── AI 调用、上下文管理、token 跟踪
MemorySystem (28) ────── 分层长期记忆（WorldFacts + KeyEvents）
ProgressionSystem (25) ── 升级、装备、商店
AllyAIController (22) ─── AI 队友决策（启发式 / LLM）
DifficultyTracker (21) ── 动态难度（基于战斗表现）
ImportExportSystem (20) ─ 预设/存档 JSON 导入导出
RenderEngine (10) ──────── Canvas 视口、最后渲染
```

### 文件层次

```
src/
├─ core/              GameEngine / EventSystem / StateManager
├─ models/            数据模型 (GamePreset / GameState / *Card)
├─ systems/           13 个游戏系统（见上）+ WorldGenerator（不是 system）
├─ rendering/         Canvas 层（MapRenderer / FloatingTextLayer / DiceRenderer）
├─ ui/                30+ UI 组件
│  └─ editor/         6 个编辑器子模块
├─ data/              defaultPreset（10 章主线）+ promptTemplates + cardSchemas
└─ utils/             jsonValidator / tokenEstimator / deepClone / idGenerator
```

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

---

## 5. 已修复的 9 个 bug（含防回归测试）

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

**给接手者**：跑这个项目时如果发现类似行为重新出现，**第一时间查 git blame**，可能是上面这些修复回归了。

---

## 6. 玩测验证模式

### 6.1 真实 AI 玩测

测试用了 OpenAI 兼容 API。验证模板（用过的小米 MiMo 例子）：

```js
// 1. localStorage.clear() + reload
// 2. 等 1500ms 让 app 初始化
// 3. aiEngine.setAPIConfig({ endpoint, apiKey, model: 'mimo-v2.5' })
// 4. 通过 publish/调用 _xxx 方法触发剧情
// 5. await 几秒等 AI 真实响应
// 6. 检查 narrative / activeEvent / completedEventIds / keyEvents
```

**重要**：
- 模型名大小写敏感（`mimo-v2.5` 不是 `MiMo-V2.5`）
- 真 AI 调用 1-6s，等待时间要足够
- token 监控可见，一场 10 章测试 ~30K tokens（成本 ¥0.05-0.2）

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
├─ integration/
│  ├─ _harness.js                 测试夹具（mock AI、构造 game）
│  └─ mainQuest.test.js           ch1→ch10 完整剧情链 E2E
└─ systems/
   ├─ DiceSystem.test.js          公式解析、优势/劣势
   ├─ CombatSystem.test.js        攻击、技能、nextTurn 索引 bug 回归
   ├─ AIResponseParser.test.js    JSON 解析 fallback、action 校验
   ├─ EventTriggerEngine.test.js  6 维度触发条件
   ├─ ProgressionSystem.test.js   升级公式、装备、商店
   └─ MemorySystem.test.js        WorldFacts/KeyEvents、容量归档
```

**给接手者**：新增功能要先想"怎么测"。系统级的测试比 UI 测试容易写（不需要 DOM mock）。

---

## 8. 待办与设计妥协

### 8.1 已知次要问题（未修，影响小）

| # | 描述 | 临时缓解 |
|---|---|---|
| Obs #1 | AI 偶尔生成 outcome.text 不一致的叙事（如选"使用护身符成功"AI 仍写"石像鬼苏醒"） | prompt 加强"严格按 outcomeText 写" |
| Obs #2 | 对角线方向（"向西北"）解析为方向但 MapSystem.canMoveTo 拒绝（曼哈顿距离 ≠ 1） | 用户选项不暴露对角线移动 |
| Obs #3 | Three.js 让 dist 体积大（697 KB / 188 KB gzipped）| 可改为 CDN 动态加载 |
| Obs #4 | 默认 lootTable 设计偏单调（很多 100% 掉率 item_009/008） | 创作者可自定义 |

### 8.2 候选下一步（按价值排）

| 方向 | 工作量 | 价值 |
|---|---|---|
| 移动端响应式 | 中 | 解锁手机/平板用户 |
| 推 GitHub + 上线 Pages/Vercel | 小 | 让别人能玩到 |
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

### 优先理解的 5 个文件

1. **[src/main.js](../src/main.js)** ~2000 行，TRPGApp 主类、所有事件订阅、玩家行动处理。理解了它就理解了整个流程。
2. **[src/systems/AIGMEngine.js](../src/systems/AIGMEngine.js)** AI 调用核心、token 跟踪、并发处理。
3. **[src/systems/EventTriggerEngine.js](../src/systems/EventTriggerEngine.js)** 6 维度触发器，剧情逻辑的核心。
4. **[src/data/defaultPreset.js](../src/data/defaultPreset.js)** 10 章主线参考实现，看它就懂复合触发器怎么用。
5. **[docs/AI_INTEGRATION.md](AI_INTEGRATION.md)** + **[docs/AUTHORING_GUIDE.md](AUTHORING_GUIDE.md)** 用户视角的两份手册。

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
