# 预设清单

本项目目前提供 4 个 bundled 完整预设；另可用 **小说 → 预设三段确定性管线**（见下文）从长篇小说生成新剧本。bundled 预设会被 Vite 打进前端包；体积较大的生成剧本通过 `public/generated-presets.json` manifest 在新游戏界面加载，避免把大 JSON 直接塞进 `presets/` bundle。

## 题材对比

| 预设 | 题材 | 场景 | 事件 | NPC | 敌人 | 结局 | 难度（终 boss） | 文件大小 |
|---|---|---|---|---|---|---|---|---|
| **永燃之冠** (`eternal-crown-stress-test.json`) | 中世纪奇幻 | 101 | 87 | 22 (4 招募) | 19 | 4 | 100% / 100% 半血（6 人队） | 217 KB |
| **最后的避难所** (`last-shelter-survival.json`) | 末日生存 | 39 | 42 | 12 (2 招募) | 10 | 3 | 90% / 0% 半血（3 人队） | 104 KB |
| **青锋录** (`qingfeng-wuxia.json`) | 武侠 | 26 | 37 | 11 (2 招募) | 9 | 3 | 100% / 86% 半血（3 人队） | 86 KB |
| **赛博朋克霓虹反叛** (`cyberpunk-neon-rebellion.json`) | 赛博朋克 | (已有，未审计) | - | - | - | - | - | 79 KB |
| **苍冰星传说：十四岁的约定**（管线产物示例） | 小说改编（《魔弹之王与冻涟的雪姬》） | 17 | 17 | 5 | 20 | 多结局 | 0 必修 / 全可达 | — |

> **关于旧的「超大型剧本」**：早期的 `novel_build_mega_preset`（读全文 + LLM 自由发挥直接吐 298 场景剧本）已废弃删除——分支与文本质量不可控。改用下文的三段确定性管线替代。

## 设计风格对比

### 永燃之冠（中世纪奇幻）
- **基调**：宏大寻冠史诗，4 axis 角色创建（race × origin × background × faith）
- **主线长度**：5 章约 22 个主线事件
- **关键机制**：4 个 boss 分别有不同的 phases；NPC 关系网 17 条
- **多周目价值**：4 个结局（光明 / 黑暗 / 中立 / 隐藏）
- **AI vs AI 验证**：13 次完整玩测，最远到达 Keep gate（48.5% 覆盖率）

### 最后的避难所（末日生存）
- **基调**：冷峻克制，废土兄弟情
- **主线长度**：4 章约 10 个主线事件
- **关键机制**：变种领主 boss 用 phases (50% 长出第二臂、25% 辐射熔融)，含 AOE 龙息和 dot 中毒
- **多周目价值**：3 个结局（救弟弟 / 终结突变 / 同归）— 解药机制让玩家做核心选择
- **特色物品**：烟雾弹（escape_combat）、辐射药、净化水

### 青锋录（武侠）
- **基调**：古典含蓄，文言夹白话
- **主线长度**：3 章约 14 个主线事件
- **关键机制**：邪教教主用 phases (66% 紫色内息 → 33% 血红入魔)，含剑气狂风 AOE + 血祭剑诀 dot
- **多周目价值**：3 个结局（青锋归位复仇 / 佛门一念放过 / 入魔同途）— 道德三选一
- **特色机制**：秘籍道具系统（《九阳真经》《太极心诀》《独孤九剑》）；门派起源决定起始场景

## 小说 → 预设 三段确定性管线（推荐的小说改编方式）

把「LLM 自由发挥」的风险**隔离在前两段**（产物可人工确认），第三段完全确定性、由成熟工具校验：

| 段 | MCP 工具 | 用 LLM？ | 产物 | 说明 |
|---|---|---|---|---|
| **① 概括汇总** | `novel_digest` | 是 | `NovelDigest` | 本地分析正文 → LLM 概括出 logline/themes/world/characters/locations/plotBeats。`plotBeats` 只记叙事节拍，**不含游戏结构** |
| **② 设计蓝图** | `blueprint_draft` + `blueprint_validate` | 是 | `PresetBlueprint` | LLM 据 digest 设计章节脊柱 + 战斗/支线/分支/结局拓展计划；按 `sizeClass`（small/medium/large）给出规模区间并 clamp。**人工可确认的中间产物** |
| **③ 确定性构建** | `preset_build_from_blueprint` | **否** | 完整预设 | 把蓝图编译成预设：章节 hub + 支线分叉、主事件（分支→choices）、战斗事件（combatPlan→ecology 敌人 + 掉落）、终章多选结局。复用 `presetNormalize`/`resolveLootTable`/`assignPresetImages`/`validatePreset` |

**第三段的平衡纪律**：按 tier 限制同场敌人数（trivial/common≤3、elite≤2、boss≤1）避免不可通关；过滤蓝图里的占位/无战斗 combatPlan 条目（`enemyConcept` 命中 `无战斗|纯叙事|none` 或为空时跳过）。

**Responses-API**：`novel_digest`/`blueprint_draft` 可接 hy3 等只走 `/responses` 的模型——设 `apiStyle:'responses'` 或环境变量 `OPENAI_API_STYLE=responses`，或 baseUrl 以 `/responses` 结尾即自动切换。

> 示例产物《苍冰星传说：十四岁的约定》由真实 5MB 小说《魔弹之王与冻涟的雪姬》跑通全管线生成，体检 0 必修、全节点可达、无不可胜 boss，并以 hy3-preview 作 GM 手动玩测通过。

## 跨题材机制复用验证

**所有 4 个预设共享同一套引擎**：
- ✅ Phase 19A 角色创建 4 轴（race/origin/background/faith）
- ✅ Phase 19B NPC + 关系图
- ✅ Phase 19C 故事时间
- ✅ Phase 20 单人模式 / 同伴招募
- ✅ Phase 21 场景变体 / 隐藏路径
- ✅ Phase 22 worldFlags + NPC 关系传播
- ✅ Phase 23 IndexedDB 存储 + AI 上下文检索
- ✅ Phase 24 元进度图鉴
- ✅ Phase 26B AI Hooks gate (sceneArrival/eventResolve/npcDialogue tier 控制)
- ✅ Phase 26C 战斗深化（buff/debuff/dot/AOE/phases/escape_combat）
- ✅ Phase 28 生态位 → 掉落表 → 图像（新敌人可通过 `ecology` 统一地区主题、战利品和配图；旧预设静态 lootTable 保持兼容）

**跨周目元进度按 presetId 隔离**，玩家在不同题材间切换，进度互不干扰。

## 战斗平衡审计（核心 boss 数据）

| 预设 | Final Boss | HP | 阶段数 | 满血胜率 | 半血胜率 | 安全入场 HP |
|---|---|---|---|---|---|---|
| 永燃之冠 | 龙王厄尼斯 | 380 | 3 phases | 100% (6人队) | 100% | 37% |
| 末日避难所 | 变种领主莱昂 | 320 | 2 phases | 90.1% (3人队) | 0% | 93% |
| 青锋录 | 邪教教主凌霜 | 280 | 2 phases | 100% (3人队) | 86% | 46% |

**结论**：3 个新 boss 都按设计 90-100% 满血胜率，但低 HP 入场会显著惩罚——这正是 phases 机制的设计目标。

## 如何生成

```bash
# bundled 预设：生成 + 验证（推荐流程）
node scripts/generate-large-script.mjs --validate          # 永燃之冠
node scripts/generate-survival-preset.mjs --validate       # 末日避难所
node scripts/generate-wuxia-preset.mjs --validate          # 青锋录

# 单独跑战斗平衡审计
node scripts/combat-balance-check.mjs --preset presets/last-shelter-survival.json --include-companions
```

小说改编则用三段管线的 MCP 工具（`novel_digest` → `blueprint_draft` → `preset_build_from_blueprint`），段③不调 LLM、可随时用既有 digest/blueprint 重新确定性构建。

## 玩家选择起始预设

工具栏 **🔄 新游戏** 会按剧本规模分组显示：

- 短篇剧本：默认主线、霓虹叛潮、随机主题等
- 中型剧本：青锋录、最后的避难所
- 大型剧本：永燃之冠
- 小说改编：用三段管线生成的剧本（如《苍冰星传说》），可通过"📥 导入"加载

也可以通过"📥 导入"按钮选择外部 JSON，或在编辑器内继续精修。**每个预设的存档和元进度按 presetId 隔离**，互不污染。
