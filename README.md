# TRPG AI 跑团

> 基于 AI 的 TRPG 浏览器跑团游戏。AI 担任 Game Master，玩家通过卡牌、地图和文本交互推进冒险。

[![CI](https://github.com/USERNAME/REPONAME/actions/workflows/ci.yml/badge.svg)](https://github.com/USERNAME/REPONAME/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-421%2F421-brightgreen)](./__tests__)
[![MCP](https://img.shields.io/badge/mcp_tests-37%2F37-brightgreen)](./mcp-server)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

支持完整的玩法闭环：探索 → 事件触发 → 战斗 → 角色成长 → 商店 → 主线推进，并配备完整的预设创作器，任何用户都能在浏览器中打造自己的故事。

## 🚀 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FUSERNAME%2FREPONAME)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/USERNAME/REPONAME)

或者用 GitHub Pages：仓库 Settings → Pages → Source 选 **GitHub Actions**，下次 push 到 `main` 即自动部署到 `https://USERNAME.github.io/REPONAME/`。

## 特性亮点

- **场景图地图模型** — 节点 + 路径而非格子；每次跳节点 = 一段戏 = 一次 AI 抵达叙事，**桌游跑团的体感**
- **角色创建 4 轴** — race × origin × background × faith，玩家身份决定起始场景 + statBonus + AI 上下文
- **NPC 系统** — schedule（按 storyTime 切换场景）/ affection / giftPreferences / 关系图（一级传播 + 死亡冲击）
- **战斗深化** — buff/debuff/dot 持续状态 / AOE 多目标 / **Boss 阶段战 (phases)** / escape_combat 道具
- **AI 叙事丰度可调** — 4 档 aiTier（none/light/standard/advanced）× preset.aiHooks 三态控制（always/never/optional）
- **API 连通性测试** — 设置面板可直接发送极小 `chat/completions` 探测请求，显示成功/错误、模型、耗时和 token 用量
- **跨周目元进度** — 按 presetId 隔离存档 + 图鉴 + 解锁项；3 个题材并存互不污染
- **可视化场景编辑器** — 浏览器内编辑节点 / 出边 / 门控 / 事件挂载 / vignettes（无需写 JSON）
- **MCP 服务器** — 暴露 **60 个工具**让 Claude 等 MCP 客户端批量、精细化生成 TRPG 剧本（参见 [mcp-server/README](mcp-server/README.md)），含小说/设定集 API-only 导入、战略层生成/审稿和 `combat_simulate` Monte Carlo 数值平衡审计
- **AI GM 接地** — 通过结构化地图上下文 + JSON 响应格式 + Action 白名单校验，避免 AI 编造内容
- **复合触发器** — 事件可按 scene/tile/POI/变量/前置事件/HP/回合/物品/概率等 **7 维度**组合触发
- **状态机驱动剧情** — `set_variable` / `set_worldFlag` / `trigger_event` / `reveal_connection` / `teleport_to_scene` 让创作者编排出有起承转合的多章节剧情
- **AI 长期记忆** — 分层记忆系统（World Facts + Key Events + Recent Context），长时间游玩 AI 不"失忆"
- **IndexedDB 大预设存储** — 100+ 节点剧本 (200+ KB JSON) 自动落 IDB，跨刷新无损
- **门控与防剧透** — 锁定节点显示 🔒 ??? 而非真名，gated reason 永不暴露内部变量名 / 事件 ID
- **剧本选择库** — 新游戏对话框按短篇/中型/大型/超大型分组，支持 bundled 题材、随机主题、本地保存剧本和外部生成剧本 manifest
- **超大型剧本模式** — 已验证 298 场景 / 305 事件 / 87 NPC / 7 势力的小说改编剧本，含多势力起点、战略汇报、分支路线和 21 个结局
- **结算流程** — 主线完成自动弹结算 modal（含统计 + 再来一局 / 继续探索 / 清空存档）
- **可视化预设编辑器** — 浏览器内编辑世界/角色/敌人/物品/事件，导入导出 JSON
- **多槽位存档** — 4 槽 + 自动存档 + 元数据预览（章节/HP/金币/回合）
- **移动端 + PWA** — 768px 抽屉式布局、触控地图、manifest 支持添加到主屏幕
- **Token 成本面板** — 采集 API usage / 本地估算，工具栏实时显示并支持预算告警
- **诊断日志导出** — 一键导出 JSON / Markdown，包含状态、叙事、骰子、Token、错误日志
- **零后端依赖** — 纯前端，所有数据 localStorage / IndexedDB，AI 走 OpenAI 兼容接口

## 快速开始

```bash
# 安装依赖
npm install

# 开发服务器（端口 3000）
npm run dev

# 生产构建
npm run build

# 跑测试
npm test
```

打开 [http://localhost:3000](http://localhost:3000) 后：

1. 点击工具栏 **⚙ 设置** 配置 AI API（OpenAI / DeepSeek / Ollama 等 OpenAI 兼容接口都支持），可先点 **测试 API 连接**确认连通性
2. 默认会加载"暗黑森林冒险"主线预设
3. 玩 10 章故事 / 用 **📝 编辑器** 创建自己的预设

## 项目结构

```
src/
├─ core/              # GameEngine、EventSystem、StateManager
├─ models/            # GamePreset / GameState / MapData / 各种 Card
├─ systems/           # 游戏系统（CombatSystem、CardManager、AIGMEngine 等）
├─ rendering/         # Canvas 渲染（地图、骰子 3D、浮动文字）
├─ ui/                # 面板组件（ToolbarPanel、CombatPanel、SaveLoadModal 等）
│  └─ editor/         # 预设编辑器子模块
├─ data/              # 默认预设 + AI 提示词模板
├─ utils/             # 工具函数（idGenerator、deepClone 等）
└─ main.js            # TRPGApp 主入口

__tests__/            # 421 个单元 + 集成测试
docs/                 # 创作者手册 + AI 集成手册 + 接手指南
```

## 核心架构

```
[ TRPGApp ] —— 顶层协调器
     │
     ├─ GameEngine ──── 系统循环管理
     │      │
     │      ├─ EventSystem        (发布订阅)
     │      ├─ CardManager        (卡牌 CRUD)
     │      ├─ DiceSystem         (骰子公式 + 优势/劣势)
     │      ├─ MapSystem          (网格地图 — 向后兼容)
     │      ├─ CombatSystem       (先攻 + 攻击/技能 + 掉落)
     │      ├─ TurnManager        (回合状态机)
     │      ├─ EventTriggerEngine (7 维度复合条件触发，含 inScene)
     │      ├─ SceneSystem        (场景图节点 + 连接 + 门控 — 主路径)
     │      ├─ AIGMEngine         (AI 调用 + 上下文管理)
     │      ├─ MemorySystem       (分层长期记忆)
     │      ├─ ProgressionSystem  (升级 + 装备 + 商店)
     │      ├─ AllyAIController   (AI 队友决策)
     │      ├─ DifficultyTracker  (动态难度)
     │      ├─ ImportExportSystem
     │      └─ LogSystem          (诊断报告导出)
     │
     ├─ SceneGraphRenderer / MapRenderer / FloatingTextLayer  (Canvas 渲染)
     └─ GameUI ──── 7 个面板 + 6 个模态框（含 EndgameModal）
```

## 默认预设：暗黑森林冒险（12 节点场景图）

10 章主线 + 商店 + 救援支线，演示场景图 + 复合触发器 + 状态机的全部能力：

```
🚩冒险者公会 → 🌿林边小径 ─→ 🔥林间篝火 [ch2] → 🏘林间村落 [ch3+ch4]
                  │                                      ↓
                  ↓                                🌲森林古道
            🐺暗影丛林 [ch5]                ╱      │      ╲
                                    ⚔废弃哨所 [ch6]   ✨苔藓祭坛 [ch7]
                                          ↓                ↗
                                   🏚遗迹外围 ───→ 🚪遗迹之门 [ch8]
                                                          ↓ (opened_gate)
                                                   💀巫妖祭坛 [ch9]
                                                          ↓ (ch9 done)
                                                   🌅黎明草地 [ch10]
```

每个节点至少含：抵达描述（AI 素材）、出边（含 gated 门控）、挂载事件、重访 vignette。一局完整通关约 24 个 Pro AI 决策 / 120k tokens（headless `playtest-ai-vs-ai-scene.mjs` 验证通过 9/10 章）。

## 文档

- [📖 预设创作者手册](docs/AUTHORING_GUIDE.md) — 场景图 / 触发器架构 / 状态机设计 / AI 提示词调优
- [🤖 AI 集成手册](docs/AI_INTEGRATION.md) — AI 调用流程、Action 白名单、记忆分层
- [🛠 开发状态与接手指南](docs/DEVELOPMENT_STATUS.md) — **给接手开发者**：项目当前位置、关键文件、17 个已修复 bug、工作流约定
- [📝 CHANGELOG](CHANGELOG.md) — 版本演进 / 每个 Phase 的产出 / Bug 修复历史

## 技术栈

- 原生 ES Modules + [Vite](https://vitejs.dev/)
- [Three.js](https://threejs.org/) (3D 骰子)
- Canvas2D (场景图 + 浮动文字)
- OpenAI 兼容 chat/completions API
- 无 React/Vue/框架依赖

## 测试

```bash
npm test
# 421 tests across 25 suites

# MCP 工具端到端烟雾测试
npm run test:mcp
```

- Core: EventSystem / GameEngine / StateManager
- Systems: Dice / Combat / AIResponseParser / EventTrigger / Scene / Progression / Memory / Turn / Card / AllyAI / Difficulty / WorldGenerator / Log
- Utils + 12 节点场景图 E2E 集成

## 路线图

✅ **Phase 0-7**：核心玩法、战斗、剧情、AI 记忆、UI 打磨、预设编辑器
✅ **Phase 8**：AI 队友自主决策、动态难度、随机世界生成、LLM 战术 AI
✅ **Phase 9**：bug 扫清、动画过渡、错误样式
✅ **Phase 10**：默认预设主线化（10 章暗黑森林）
✅ **Phase 11**：生产默认值统一、AI 重试、错误兜底
✅ **Phase 12**：Vercel / Netlify / GitHub Pages 部署配置 + CI
✅ **Phase 13**：Toast、主线进度、下一步建议、Token 成本面板
✅ **Phase 14**：移动端响应式 + PWA
✅ **Phase 15**：覆盖率提升 + 诊断日志导出 + 玩家叙事全程留痕 + JSON 解析健壮性
✅ **Phase 16**：**场景图全量重构**（节点 + 边代替格子）+ 剧本选择库 + 主线结算 modal + 防剧透
✅ **真实 AI 端到端验证**（OpenAI 兼容 API，含小米 MiMo Pro vs 普通双 AI 完整通关 9/10 章）
✅ **Phase 27**：MCP API-only 小说/设定集导入、超大型剧本外部 manifest、新游戏规模分组、API 连通性测试、叙事清空/身份连续性/玩家可见提示词清洗

🔮 后续可能方向：
- 编辑器加场景图可视化拖拽（节点 + 连线）
- 对超大型剧本继续做 MCP/API 质量审稿：身份视角、分支可玩性、场景文本文学化
- 云存档同步（社区预设库）
- 多语言（英文版预设）
- 战斗视觉特效与移动端细节打磨
- README 部署链接替换为真实仓库地址

## 玩测发现的 17 个 bug 已全部修复

通过真实 AI 端到端玩测共修复 17 个 bug，其中 5 个严重级别：
- **#5 严重**：同种敌人多份时 turnOrder 卡死
- **#8 严重**：AI 并发冲突丢失叙事
- **#9 严重**：自动存档刷新后未恢复
- **#10 严重**：起始场景 inScene 事件不触发（场景图模式）
- **#11 严重**：新游戏 modal 因递归 publish 导致剧本库被覆盖
- 其他：方向解析、战斗叙事、防剧透、骰子残留、JSON 解析健壮性、item 命名错位等

详见 [CHANGELOG](CHANGELOG.md) 和 [git log](https://github.com/USERNAME/REPONAME/commits/main)。

## License

MIT
