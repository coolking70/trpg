# 预设清单

本项目目前提供 4 个 bundled 完整预设，另有一个通过 MCP + API 从长篇小说/设定集生成的外部超大型剧本。bundled 预设会被 Vite 打进前端包；超大型剧本通过 `public/generated-presets.json` manifest 在新游戏界面加载，避免把 1MB+ JSON 直接塞进 `presets/` bundle。

## 题材对比

| 预设 | 题材 | 场景 | 事件 | NPC | 敌人 | 结局 | 难度（终 boss） | 文件大小 |
|---|---|---|---|---|---|---|---|---|
| **永燃之冠** (`eternal-crown-stress-test.json`) | 中世纪奇幻 | 101 | 87 | 22 (4 招募) | 19 | 4 | 100% / 100% 半血（6 人队） | 217 KB |
| **最后的避难所** (`last-shelter-survival.json`) | 末日生存 | 39 | 42 | 12 (2 招募) | 10 | 3 | 90% / 0% 半血（3 人队） | 104 KB |
| **青锋录** (`qingfeng-wuxia.json`) | 武侠 | 26 | 37 | 11 (2 招募) | 9 | 3 | 100% / 86% 半血（3 人队） | 86 KB |
| **赛博朋克霓虹反叛** (`cyberpunk-neon-rebellion.json`) | 赛博朋克 | (已有，未审计) | - | - | - | - | - | 79 KB |
| **MiMo 全文 API-only 超大剧本** (`public/generated/mimo-full-api-only-preset.json`) | 小说改编 / 多势力战争 | 298 | 305 | 87 | 0 | 21 | 非战斗主导 | 约 1.4 MB |

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

### MiMo 全文 API-only 超大剧本（外部 generated）
- **基调**：长篇小说改编的多势力战争与人物群像，围绕布琉努、墨吉涅、吉斯塔特等势力展开
- **规模**：298 场景 / 305 事件 / 87 NPC / 7 势力 / 21 结局
- **生成方式**：MCP `novel_build_mega_preset` 读取全文并调用 OpenAI-compatible API 分批抽取，不再用本地启发式分析正文
- **多起点**：角色创建 origin 决定所属势力和起点；hub 中其他势力起点已加门锁，避免身份串线
- **战略层**：7 个势力均有 `strategicLayer`，包含城市/村庄/矿产/特产/人口/生产效率/内政外交和情报可见性，并通过战略汇报事件呈现
- **质量修正**：已清理玩家可见文本中的 `AI/GM/API/改编节拍/提示词` 痕迹；当前仍建议继续用 MCP/API 做剧情视角与分支可玩性审稿

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
# 生成 + 验证（推荐流程）
node scripts/generate-large-script.mjs --validate          # 永燃之冠
node scripts/generate-survival-preset.mjs --validate       # 末日避难所
node scripts/generate-wuxia-preset.mjs --validate          # 青锋录

# 单独跑战斗平衡审计
node scripts/combat-balance-check.mjs --preset presets/last-shelter-survival.json --include-companions
```

## 玩家选择起始预设

工具栏 **🔄 新游戏** 会按剧本规模分组显示：

- 短篇剧本：默认主线、霓虹叛潮、随机主题等
- 中型剧本：青锋录、最后的避难所
- 大型剧本：永燃之冠
- 超大型剧本：MiMo 全文 API-only 超大剧本

也可以通过"📥 导入"按钮选择外部 JSON，或在编辑器内继续精修。**每个预设的存档和元进度按 presetId 隔离**，互不污染。
