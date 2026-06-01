# TRPG 预设 MCP 服务器

让 Claude（或任何 MCP 客户端）能够**批量、精细化**地生成 / 修改 TRPG 预设。
配合编辑器使用，AI 可以一次性搭建出完整的世界、角色、敌人、事件、场景图。

## 快速开始

```bash
# 直接启动（默认在当前目录创建 preset-draft.json）
npm run mcp

# 指定输出文件路径
node mcp-server/preset-server.mjs /path/to/my-preset.json

# 跑端到端烟雾测试（42 个用例）
npm run test:mcp
```

## 接入 Claude Code

`claude_code_config.json`（macOS 默认在 `~/Library/Application Support/Claude/claude_code_config.json`）：

```json
{
  "mcpServers": {
    "trpg-preset": {
      "command": "node",
      "args": [
        "/abs/path/to/trpg/mcp-server/preset-server.mjs",
        "/abs/path/to/my-preset.json"
      ]
    }
  }
}
```

接入后 Claude 会看到 67 个工具，可以让它"写一份太空船难主题的剧本"，也可以通过**小说→预设三段管线**（概括 → 设计蓝图 → 确定性构建）把一部长篇小说改编成可玩剧本，并为敌人自动烘焙生态位掉落表。

## 暴露的工具一览

### 预设元（8）
- `preset_load` — 从磁盘加载到内存
- `preset_save` — 写回磁盘（dirty 时其他工具会自动保存）
- `preset_info` — 概览（名称 / 各项计数 / displayMode / startingSceneId）
- `preset_set_meta` — 改 name / description / lore / displayMode
- `preset_validate` — 引用完整性检查（场景连接 / 事件 inScene / 战斗 enemyIds / 物品引用 / 掉落表）
- **`preset_analyze`** — 一键全面体检（8 维度）：引用 / 坐标冲突 / 可达性 / 单向连接 / 变量对照 / 主线推进模拟 / 角色装备 / hint 安全。**生成完整剧本后必跑**
- `preset_export` — 返回完整 JSON
- `preset_reset` — 清空（需 confirm:true）

### 场景图（10）
- `scene_list` / `scene_get`
- **`scene_create`** — 创建节点；**传 `coords` 冲突时会自动挪到附近空位**（螺旋搜索）
- `scene_update` / `scene_delete`
- **`scene_add_connection`** — **默认创建双向边**（同时建返程）；`oneWay: true` 才单向；`gated.hint` 诗意提示**绝不暴露内部 ID**
- `scene_remove_connection`
- `scene_attach_event` / `scene_detach_event`
- **`scene_relayout`** — 检测并自动解决坐标冲突（可 dryRun 预演）

### 事件（5）
- `event_list` / `event_get`
- `event_create` — 一次性创建含 choices / outcomes / effects 的完整事件
- `event_update` — 局部更新触发条件、priority、tags 等
- `event_delete` — 自动清理场景对它的引用

### 角色 / 敌人 / 物品 各 4
- `*_list / *_get / *_create / *_delete`
- `character_create` 一次塞入属性 + 技能 + 初始装备
- `enemy_create` 一次塞入属性 + 技能 + 掉落表 + difficulty
- `item_create` 支持武器 / 防具 / 饰品 / 消耗品 / 任务物品

### 批量原子（1）
- `preset_batch_apply` — 一次执行多个操作。**全部成功才提交，任何一步失败自动回滚**。AI 写整套剧本的首选入口。

### 小说 / 设定集导入（9）
- `novel_source_inspect` — 读取本地 `.txt/.md` 长文本，只统计体量、章节/片段和正文过滤结果；不会本地猜测人物、势力或剧情，也不会把原文写入预设。
- **小说→预设三段管线**（替代已删的 `novel_build_mega_preset`，把 LLM 自由发挥风险隔离在前两段）：
  - `novel_digest`（段①·概括汇总）— 本地分析正文 + LLM 概括出 `NovelDigest`（logline/themes/world/characters/locations/plotBeats）。plotBeats 只记叙事节拍，**不含游戏结构**。
  - `blueprint_draft` + `blueprint_validate`（段②·设计蓝图）— LLM 据 digest 设计 `PresetBlueprint`（章节脊柱 + 战斗/支线/分支/结局拓展计划），按 `sizeClass`（small/medium/large）给出规模区间并 clamp。蓝图是**人工可确认的中间产物**。
  - `preset_build_from_blueprint`（段③·确定性构建）— **不调 LLM**，把蓝图编译成完整预设；复用 `presetNormalize`/`resolveLootTable`/`assignPresetImages`/`validatePreset`，并按 tier 限同场敌人数、过滤占位 combatPlan。
- `preset_canonicalize_entities_api` — 对当前预设再调用一次 API，归一化跨批生成造成的势力 id/name 漂移，并修正 factions / origins / NPC tags / 声望变量 / 起点规则。
- `preset_expand_routes_api` — 对当前预设调用 API，为不同势力起点补写专属支线场景、事件、NPC 和可选结局尾声，增强多起点玩法差异。
- `preset_generate_strategic_layer_api` — 对当前预设调用 API，补充势力城市、村庄、矿产、特产、人口、生产效率、内政外交和情报可见性。小说改编模式会基于剧情反推并标注 `explicit/inferred`，原创模式会更主动补齐设定；生成内容通过 TRPG 的汇报、询问和有限命令事件呈现，不提供策略游戏式全局操作。
- `preset_review_strategic_layer_api` — 对 `preset.strategicLayer` 调用 API 审稿/校正，检查误造或过度确定的地名、人口、产能、外交和职务权限；可只返回审稿报告，也可写回校正后的战略层并刷新起点战略汇报事件。

三段管线示例（依次调用，段③不调 LLM）：

```jsonc
// 段① 概括汇总 → 产出 NovelDigest
{ "tool": "novel_digest", "sourcePath": "/Users/me/Downloads/novel.txt",
  "title": "北境群像", "baseUrl": "http://127.0.0.1:1234/v1",
  "model": "qwen/qwen3.6-35b-a3b", "outPath": "/tmp/digest.json" }

// 段② 设计蓝图 → 产出 PresetBlueprint（人工可确认后再进段③）
{ "tool": "blueprint_draft", "digestPath": "/tmp/digest.json",
  "sizeClass": "medium", "baseUrl": "http://127.0.0.1:1234/v1",
  "model": "qwen/qwen3.6-35b-a3b", "outPath": "/tmp/blueprint.json" }

// 段③ 确定性构建 → 当前预设即生成结果（可反复重建，无需重调 LLM）
{ "tool": "preset_build_from_blueprint", "blueprintPath": "/tmp/blueprint.json",
  "digestPath": "/tmp/digest.json", "assignImages": true, "confirm": true }
```

API key 不会写入预设；可通过工具参数 `apiKey` 临时传入，或设置 `OPENAI_API_KEY` 环境变量。本地 127.0.0.1/localhost 端点可留空。
段①② 的 LLM 调用支持 `/chat/completions` 与 `/responses` 两种风格（设 `apiStyle:"responses"` 或环境变量 `OPENAI_API_STYLE=responses`，或 baseUrl 以 `/responses` 结尾即自动切换；hy3 等模型用此风格）。
改进段③构建逻辑时，**先改 builder 再用既有 digest/blueprint 重新构建即可**，不必重调 LLM。

战略设定补强示例：

```json
{
  "mode": "novel_adaptation",
  "baseUrl": "http://127.0.0.1:1234/v1",
  "model": "qwen/qwen3.6-35b-a3b",
  "maxSourceSections": 8,
  "createBriefingEvents": true
}
```

战略设定审稿/校正示例：

```json
{
  "model": "qwen/qwen3.6-35b-a3b",
  "baseUrl": "http://127.0.0.1:1234/v1",
  "factionIds": ["brune"],
  "maxSourceSections": 6,
  "applyCorrections": true,
  "refreshBriefingEvents": true
}
```

`mode=novel_adaptation` 适合小说改编：API 会把未明示的人口、产能、矿产、外交等作为剧情逻辑反推，并保留可信度标记。`mode=original` 适合原创剧本：API 可以更完整地创造战略背景，但玩家仍只能按角色职务获取对应情报并通过叙事命令影响局势。

注意：超大剧本 JSON 不建议直接输出到项目的 `presets/` 目录，因为 `src/main.js` 会把 `presets/*.json` 当作 bundled preset 打进前端包。推荐输出到 `generated/`、`~/Downloads/` 或其他外部路径；若要在新游戏列表中自动显示，可把可公开访问的副本放到 `public/generated/`，并在 `public/generated-presets.json` 中登记 `{ key, path, sceneCount, eventCount, npcCount }`。

生成器会尽量把给模型看的素材摘要转成玩家可见叙述，避免在 `description` 中写出 `AI改编节拍`、`GM 应围绕`、`API 抽取` 等提示词痕迹。生成后仍建议运行 `preset_analyze` / `preset_validate`，并抽样检查玩家可见文本。

### 生态位 → 掉落表 → 图像（Phase 28，3）
把「怪物生态位」变成一等数据 `ecology = { biome, creatureType, tier }`，让生成大剧本时敌人的**地区主题、战利品、图像三者自动一致**。

- `ecology_vocab` — 列出可用的 biome / creatureType / tier，以及哪些 biome 有掉落池。生成敌人前先查这个保证用词一致。
- `loot_pool_preview` — 给定 `{ biome, creatureType, tier, luck }` 预览 `resolveLootTable` 的烘焙结果（itemId + dropRate），并标注每个战利品是否已在 preset / assetLibrary。**不改预设**。
- `enemy_assign_ecology` — 给敌人写入 ecology，并据此：
  1. `mode:'static'`（默认）烘焙 `lootTable`，或 `mode:'dynamic'` 标记运行时实时抽取
  2. 把掉落表引用的战利品从 `assetLibrary` **物料化进 `preset.items`（含图）**——保证引用完整
  3. 给敌人本身配一张匹配 biome/creatureType 的图

掉落规则（`src/data/ecology.js`）：候选按 `kind`(common/rare/consumable) × `tier` 给基础掉率，`tier` 越高条目越多、掉率越高；`minTier` 门槛让 boss-only 战利品（如九头蛇鳞）只在精英/boss 出现；`types` 门槛让材料只对相应生物类型掉（史莱姆核只对 ooze）。

示例：
```json
{ "enemyId": "enemy_marsh_crocodile", "biome": "swamp", "creatureType": "beast", "mode": "static" }
```
→ 烘焙出沼泽主题掉落（利齿之牙 / 毒腺 / 沼泽草药），物料化对应物品并配鳄鱼图。

`combat_simulate` 不受掉落影响（战利品是战斗后结算），仍可正常审计战斗平衡。

## 使用模式：让 Claude 写一份完整剧本

```
用户对 Claude：
  请用 MCP 工具帮我做一份"赛博朋克下水道"主题的 TRPG 剧本，
  6 个场景、4 个事件、3 个敌人、5 个物品、4 个角色。

Claude 会按以下顺序自动调用：
  1. preset_set_meta (name + lore)
  2. preset_batch_apply ops=[
       character_create * 4,
       enemy_create * 3,
       item_create * 5,
     ]
  3. preset_batch_apply ops=[
       scene_create * 6,
       scene_add_connection * 8,
       event_create * 4,
       scene_attach_event * 4,
     ]
  4. preset_validate
  5. preset_save
```

## 与编辑器配合

MCP 写出的 JSON 文件就是标准的预设格式 — 你可以：

1. 让 MCP 在 `~/Downloads/preset.json` 写好骨架
2. 打开浏览器游戏 → 工具栏 📥 导入 → 选 `preset.json`
3. 用游戏自带的可视化编辑器精修（场景标签页能直接调整连接 / vignettes / 事件挂载）
4. 导出回 JSON

## gated.hint 设计原则（重要）

锁定的连接显示给玩家时**永远不会暴露内部 key**：

```javascript
gated: {
  requireVariables: { knows_dark_knight: true },  // 内部 key
  hint: "前方阴气逼人，你们还不知道那里隐藏着什么"  // 玩家看到的
}
```

如果不写 `hint`，系统用通用文案兜底：
- 缺变量 → "你们似乎还差一些线索"
- 缺事件 → "需要先完成某段前置经历"
- 缺物品 → "需要先找到某件关键物品"

写 hint 总比不写好 — 锁定信息成为氛围的一部分而不是技术提示。

## 测试

```bash
npm run test:mcp
```

42 个端到端用例覆盖：场景 CRUD / 连接 / 门控 / 事件挂载 / 校验断引用 / 批量回滚 / NPC / 对话树 / 模板 / 战斗模拟 / 小说导入 / OpenAI-compatible API 增强 / 生态位掉落烘焙等关键路径。
