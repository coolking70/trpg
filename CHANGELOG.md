# CHANGELOG

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 约定。

## [Unreleased]

### Changed
- AI outcome.text 一致性 prompt 加强（防止 AI 编造与结果矛盾的情节）
- Three.js 拆分为独立 chunk，主包从 697 KB 降到 236 KB（gzip 72 KB）
- Jest 加入 `npm run test:coverage` 覆盖率报告

### Added
- CHANGELOG.md（本文件）

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
