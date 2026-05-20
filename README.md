# TRPG AI 跑团

> 基于 AI 的 TRPG 浏览器跑团游戏。AI 担任 Game Master，玩家通过卡牌、地图和文本交互推进冒险。

[![CI](https://github.com/USERNAME/REPONAME/actions/workflows/ci.yml/badge.svg)](https://github.com/USERNAME/REPONAME/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-115%2F115-brightgreen)](./__tests__)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

支持完整的玩法闭环：探索 → 事件触发 → 战斗 → 角色成长 → 商店 → 主线推进，并配备完整的预设创作器，任何用户都能在浏览器中打造自己的故事。

## 🚀 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FUSERNAME%2FREPONAME)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/USERNAME/REPONAME)

或者用 GitHub Pages：仓库 Settings → Pages → Source 选 **GitHub Actions**，下次 push 到 `main` 即自动部署到 `https://USERNAME.github.io/REPONAME/`。

## 特性亮点

- **AI GM 接地** — 通过结构化地图上下文 + JSON 响应格式 + Action 白名单校验，避免 AI 编造内容
- **复合触发器** — 事件可按 tile/POI/变量/前置事件/HP/回合/物品/概率等 6 维度组合触发
- **状态机驱动剧情** — `set_variable` + `trigger_event` 让创作者编排出有起承转合的多章节剧情
- **AI 长期记忆** — 分层记忆系统（World Facts + Key Events + Recent Context），长时间游玩 AI 不"失忆"
- **战斗 Option B 设计** — 常规攻击走 CombatSystem 机制，文本"创意行动"（推柱子砸怪）由 AI 评估难度返回骰子判定
- **可视化预设编辑器** — 浏览器内编辑世界/角色/敌人/物品/事件/地图，导入导出 JSON
- **多槽位存档** — 4 槽 + 自动存档 + 元数据预览（章节/HP/金币/回合）
- **零后端依赖** — 纯前端，所有数据 localStorage，AI 走 OpenAI 兼容接口

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

1. 点击工具栏 **⚙ 设置** 配置 AI API（OpenAI / DeepSeek / Ollama 等 OpenAI 兼容接口都支持）
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

__tests__/            # 112 个单元 + 集成测试
docs/                 # 创作者手册 + AI 集成手册
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
     │      ├─ MapSystem          (网格地图 + 寻路 + 迷雾)
     │      ├─ CombatSystem       (先攻 + 攻击/技能 + 掉落)
     │      ├─ TurnManager        (回合状态机)
     │      ├─ AIGMEngine         (AI 调用 + 上下文管理)
     │      ├─ EventTriggerEngine (复合条件触发)
     │      ├─ MemorySystem       (分层长期记忆)
     │      ├─ ProgressionSystem  (升级 + 装备 + 商店)
     │      └─ ImportExportSystem
     │
     ├─ MapRenderer / FloatingTextLayer  (Canvas 渲染)
     └─ GameUI ──── 7 个面板 + 5 个模态框
```

## 默认预设：暗黑森林冒险

10 章主线，演示了所有 Phase 2-4 能力：

| 章 | 触发方式 | 演示能力 |
|---|---|---|
| 1 受命出征 | 起点 POI + 优先级 100 自动开场 | POI 触发 + set_variable |
| 2 神秘旅人 | 道路 R + `requireVariables.quest_received` + 概率 0.55 | 复合条件 + 物品奖励 |
| 3 林间村落 | 村庄 POI | POI 触发 + trigger_event 链 |
| 4 老布伦杂货铺 | 村庄 POI + `requireCompletedEvents:[ch3]` | shop.inventory + 重复触发 |
| 5 暗影狼伏击 | T/G 地块随机 25% | 战斗事件 |
| 6 堕落骑士 | R/G 地块 + `knows_dark_knight=true` | Boss + 唤醒分支 |
| 7 林中治愈者 | `partyHpBelow: 0.3` | HP 阈值触发救援 |
| 8 遗迹之门 | 遗迹 POI | 物品验证 + 战斗分支 |
| 9 森林巫妖 | `requireVariables.opened_gate=true` | 自动链式 Boss |
| 10 黎明 | `requireCompletedEvents:[ch9]` | 自动结局 |

## 文档

- [📖 预设创作者手册](docs/AUTHORING_GUIDE.md) — 触发器架构、状态机设计、AI 提示词调优
- [🤖 AI 集成手册](docs/AI_INTEGRATION.md) — AI 调用流程、Action 白名单、记忆分层

## 技术栈

- 原生 ES Modules + [Vite](https://vitejs.dev/)
- [Three.js](https://threejs.org/) (3D 骰子)
- Canvas2D (地图渲染)
- OpenAI 兼容 chat/completions API
- 无 React/Vue/框架依赖

## 测试

```bash
npm test
# 115 tests across 7 suites, ~0.5s
```

- DiceSystem (14)
- AIResponseParser (17)
- EventTriggerEngine (16)
- ProgressionSystem (15)
- MemorySystem (11)
- CombatSystem (18)
- 主线 E2E 集成 (12+)

## 路线图

✅ **Phase 0-7**：核心玩法、战斗、剧情、AI 记忆、UI 打磨、预设编辑器
✅ **Phase 8**：AI 队友自主决策、动态难度、随机世界生成、LLM 战术 AI
✅ **Phase 9**：bug 扫清、动画过渡、错误样式
✅ **Phase 10**：默认预设主线化（10 章暗黑森林）
✅ **Phase 11**：生产默认值统一、AI 重试、错误兜底
✅ **真实 AI 端到端验证**（OpenAI 兼容 API，含小米 MiMo 等）

🔮 后续可能方向：
- 云存档同步（社区预设库）
- 移动端响应式适配
- 多语言（英文版预设）
- Token 成本面板（实时计数 + 预算告警）

## 玩测发现的 8 个 bug 已全部修复

通过真实 AI 端到端玩测发现并修复了 8 个 bug，其中 2 个严重级别：
- **#5 严重**：同种敌人多份时 turnOrder 卡死
- **#8 严重**：AI 并发冲突丢失叙事
- 其他：方向解析、战斗叙事、长期记忆等细节

详见 [git log](https://github.com/USERNAME/REPONAME/commits/main)。

## License

MIT
