# 预设创作者手册

如何在浏览器中（或写 JSON）创造你自己的 TRPG 故事。

## 一份预设包含什么

```json
{
  "version": "1.0.0",
  "presetId": "unique_id",
  "name": "预设名称",
  "author": "你的名字",
  "description": "简短描述",

  "lore": { /* 世界观 - 注入 AI 永久记忆 */ },
  "rules": { /* 游戏规则 */ },
  "aiConfig": { /* AI 调用配置 */ },

  "characters": [/* 玩家可控角色 */],
  "enemies": [/* 战斗中遇到的敌人 */],
  "items": [/* 物品（武器/防具/消耗品/任务物品） */],
  "events": [/* 剧情和遭遇事件 */],
  "scenes": [/* 场景图节点（推荐 — 桌游跑团式） */],
  "startingSceneId": "scene_xxx",
  "displayMode": "scene-graph",
  "map": { /* 旧版网格地图（向后兼容，displayMode='grid' 时使用） */ }
}
```

**两种地图模型可选**（写 `scenes[]` 优先走场景图）：
- **场景图（推荐）** — 节点 + 边，每个节点是一段戏。**桌游跑团的感觉**。详见第二章末尾。
- **网格地图（向后兼容）** — 20×15 格子，触发器靠地形/POI。早期预设可继续用，但叙事密度差。

打开 **工具栏 → 📝 编辑器**，可以可视化编辑大部分内容（场景图当前需要手写 JSON）。本手册更关注**核心概念和设计原则**。

---

## 一、世界观（lore）— AI 的灵魂

```json
{
  "lore": {
    "worldName": "艾尔大陆",
    "era": "黑暗纪元第三年",
    "background": "森林被诅咒，亡灵占据...（200字内）",
    "rules": "采用 D20 骰子系统...",
    "gmStyle": "氛围浓厚、略带紧张感"
  }
}
```

**关键提示**：
- `worldName` + `era` + `background` 会自动写入 AI 长期记忆的 **World Facts**，每次调用都注入
- `gmStyle` 影响 AI 叙事调性。写"幽默轻松"和"史诗严肃"会得到完全不同的体验
- `background` 不要超过 200 字，否则 token 浪费

---

## 二、事件系统——剧情的发动机

### 2.1 触发器架构

每个事件有一个 `trigger`，决定它何时出现：

```json
{
  "id": "ch2_traveler",
  "trigger": {
    "type": "composite",
    "condition": {
      "tileTypes": ["R"],
      "pointsOfInterest": [],
      "requireVariables": { "quest_received": true },
      "requireCompletedEvents": [],
      "excludeCompletedEvents": ["ch2_traveler"],
      "partyHpBelow": null,
      "turnNumberAtLeast": null,
      "requireItems": [],
      "probability": 0.55
    }
  },
  "priority": 90
}
```

**6 个维度**（所有非空字段都要满足才触发）：

| 条件 | 含义 | 例子 |
|---|---|---|
| `tileTypes` | 玩家在哪种地块上 | `["R", "G"]` 道路或草地 |
| `pointsOfInterest` | 玩家在哪个 POI 上 | `["poi_village"]` |
| `requireVariables` | 全局变量必须等于这些值 | `{ quest_received: true }` |
| `requireCompletedEvents` | 这些事件必须已完成 | `["ch1_start"]` |
| `excludeCompletedEvents` | 这些事件必须未完成（防重复） | `["ch2_traveler"]` |
| `partyHpBelow` | 队伍平均 HP 比例低于（0-1） | `0.3` |
| `turnNumberAtLeast` | 回合数至少 | `5` |
| `requireItems` | 队伍至少持有这些物品 | `["item_amulet"]` |
| `probability` | 触发概率（0-1，默认 1.0） | `0.5` |

### 2.2 触发时机

事件不是每帧扫描，只在特定时机被检查：

| 时机 | 何时扫描 |
|---|---|
| **SCENE_ENTER** | **抵达场景节点时（场景图模式）** |
| MOVE | 玩家移动到新格子（旧 grid 模式） |
| EVENT_COMPLETE | 一个事件完成后 |
| COMBAT_END | 战斗结束后 |
| TURN_END | 每个回合结束 |
| VARIABLE_CHANGE | `set_variable` 写入变量后 |

**重要规则**：
- 含 `inScene` 的事件**仅在 SCENE_ENTER 时机评估**
- 含 `tileTypes` 或 `pointsOfInterest` 的事件**仅在 MOVE 时机评估**（仅旧 grid 模式有效）
- **战斗进行中** EVENT_COMPLETE 扫描会被跳过 — 避免"ch9 战斗未结束就把 ch10 黎明叙事写出来"

### 2.3 优先级

多个事件同时匹配时，`priority` 高的先触发：

```json
{ "id": "ch_boss", "priority": 100 }
{ "id": "random_wolf", "priority": 50 }
```

主线事件建议 priority ≥ 80，随机事件 0-50。

### 2.4 选项 + Outcomes

事件可有多个 `choices`，每个 choice 可有多个 `outcomes`（按概率选取）：

```json
{
  "choices": [
    {
      "id": "accept_help",
      "text": "接受帮助",
      "outcomes": [
        {
          "probability": 1.0,
          "text": "旅人给了你一枚护身符",
          "effects": [
            { "type": "add_item", "itemId": "item_007" },
            { "type": "set_variable", "name": "met_traveler", "value": true }
          ]
        }
      ]
    },
    {
      "id": "decline",
      "text": "谢绝",
      "outcomes": [{ "probability": 1.0, "text": "...", "effects": [] }]
    }
  ]
}
```

### 2.5 outcome.effects 类型

| 类型 | 字段 | 说明 |
|---|---|---|
| `add_item` | `itemId` | 加入第一个角色背包 |
| `remove_item` | `itemId` | 从任一角色背包移除 |
| `heal` | `target` (id/`all`), `value` | 恢复 HP |
| `damage` | `target` (id/`all`), `value` | 扣 HP |
| `start_combat` | `enemyIds[]` | 启动战斗 |
| `set_variable` | `name`, `value` | 写状态机（**最强大**） |
| `trigger_event` | `eventId` | 显式链式触发后续事件 |
| `add_memory` | `value` | 写入 AI 长期记忆 |
| `narrative` | `text` | 仅追加叙事，无机制效果 |

### 2.6 剧情设计模式

**模式 A：线性主线**

```
ch1 (POI 自动开场)
  → 选择 → set_variable: quest_started=true
ch2 (composite: requireVariables.quest_started=true)
  → 选择 → set_variable: met_npc=true + add_item: amulet
ch3 (composite: requireItems: [amulet] AND requireCompletedEvents: [ch2])
  → ...
```

**模式 B：分支命运**

```
ch_choice (单个事件)
  ├─ 选项 A → set_variable: path=light
  └─ 选项 B → set_variable: path=dark

ch_light (requireVariables.path=light)  ← 仅光明路线
ch_dark  (requireVariables.path=dark)   ← 仅黑暗路线
```

**模式 C：动态救援**

```
ch_rescue (partyHpBelow: 0.2)
  → 一次性救援事件，HP 危急时自动出现
```

**模式 D：商店重复触发**

```
ch_shop (inScene: ['scene_village'], repeatable: true)
  → 每次抵达村庄都可访问
```

### 2.7 场景图模式（推荐 — 桌游跑团式）

#### 为什么？

旧的 20×15 格子地图里 98% 是空格，玩家走 50 步才碰一次剧情，AI 不得不重复编"道路腐臭、枯树、乌鸦……"模板。**桌游跑团的 GM 不描述"你迈出第 47 步"，而是描述"你们花了大半天抵达林间村落"**。场景图把"地图"升级成"节点 + 边"，每跳一次节点 = 一段戏 = 一次有意义的 AI 叙事。

#### 数据结构

```json
{
  "displayMode": "scene-graph",
  "startingSceneId": "scene_spawn",
  "scenes": [
    {
      "id": "scene_village",
      "name": "林间村落",
      "type": "settlement",
      "icon": "🏘",
      "coords": { "x": 7, "y": 1 },
      "description": "雾气缭绕的木屋聚落，村民投来戒备的目光。",
      "connections": [
        { "to": "scene_traveler_camp", "label": "沿古道南返" },
        {
          "to": "scene_dark_corridor",
          "label": "沿主路东行，深入森林",
          "gated": {
            "requireCompletedEvents": ["ch3_village"],
            "hint": "你们应该先和村民打个招呼"
          }
        }
      ],
      "events": ["ch4_shop", "ch3_village"],
      "vignettes": [
        "你们再次踏入村落，孩童们好奇地张望。",
        "村中的炊烟比之前稀薄了几分。"
      ],
      "tags": ["safe", "main", "shop"]
    }
  ]
}
```

#### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | 唯一 ID（建议 `scene_xxx`） |
| `name` | ✓ | 节点名（玩家可见，但 locked-unvisited 时会隐为 `???`） |
| `type` | 推荐 | `spawn` / `settlement` / `wilderness` / `combat` / `dungeon` / `vignette` / `ending` 之一，影响默认图标 |
| `icon` | 推荐 | emoji，节点图标 |
| `coords` | ✓ | 节点屏幕位置（任意单位，仅作可视化用） |
| `description` | 推荐 | AI 抵达时的写作素材 |
| `connections[]` | ✓ | 出边 — 想要双向连接就在对方节点写返程；`cost` 可作为旅行耗时 |
| `events[]` | — | 抵达时按 priority 选第一个未完成的触发 |
| `vignettes[]` | — | 重访时随机选一条作为本地叙事（**不调 AI，省 token**） |
| `tags` | — | 用于 QuestTracker 等 UI 过滤 |

#### connections.gated — 门控条件

```json
{
  "to": "scene_xxx",
  "label": "前行",
  "gated": {
    "requireVariables": { "knows_dark_knight": true },
    "requireCompletedEvents": ["ch3_village"],
    "requireItems": ["item_013"],
    "hint": "前方阴气逼人，你们还不知道那里隐藏着什么"
  }
}
```

**关键设计**：`hint` 是给玩家看的诗意提示。**绝不要把内部变量名 / 事件 ID / 物品 ID 写到玩家可见的地方**。没写 `hint` 时系统会用通用文案兜底：

| gated 类别 | 默认 fallback 文案 |
|---|---|
| 缺变量 | "你们似乎还差一些线索" |
| 缺前置事件 | "需要先完成某段前置经历" |
| 缺物品 | "需要先找到某件关键物品" |

写 `hint` 总是比依赖默认更好 — 它让锁定信息成为氛围的一部分而不是技术提示。

#### 事件挂载场景：用 inScene 触发器

把原来的 `tileTypes` / `pointsOfInterest` 改为 `inScene`：

```json
{
  "id": "ch3_village",
  "trigger": {
    "type": "composite",
    "condition": {
      "inScene": ["scene_village"],
      "excludeCompletedEvents": ["ch3_village"]
    }
  }
}
```

同一个事件可以挂在**多个**场景上（`inScene: ['scene_a', 'scene_b']`）— 任一抵达即触发。

#### 重访叙事（vignettes）

玩家重新走过已访问的节点时，系统会**随机抽取 vignette 中的一条**作为本地叙事 — 不调 AI。这让重访有质感但成本接近零。如果场景没有 vignettes，重访时只会写"前往 XXX 名字"。

#### 快速旅行

快速旅行只对**已经探索过**且与当前节点之间存在**当前可通行路径**的节点生效。系统会沿已探索路径寻路，按每段 `connection.cost` 或目标 `scene.travelHours` 推进故事时间，并在危险节点上由代码结算随机遭遇/路途损耗；GM 模型只写最终抵达或中断后的叙事。

推荐写法：

```json
{
  "id": "scene_mountain_pass",
  "name": "风雪山口",
  "type": "wilderness",
  "travelHours": 4,
  "tags": ["mountain", "dangerous", "wilderness"],
  "connections": [
    { "to": "scene_way_shrine", "label": "沿旧山路前往路神祠", "cost": 3 }
  ]
}
```

安全城镇、商店、营地建议加 `tags: ["safe"]` 或使用 `type: "settlement" / "shop"`，这样快速旅行路途结算不会在那里刷怪。

#### 设计 checklist

- [ ] 每个节点都有 description（AI 首次抵达的素材）
- [ ] 每个非终点节点都有 connections（玩家能走出去）
- [ ] 主线推进路径上的 gated 都写了 hint（诗意而不剧透）
- [ ] 重要节点至少 2 条 vignettes（避免重访只有名字）
- [ ] 主线终结点带 `tags: ['epilogue']` 或 ID 为 `ch10_epilogue` → 触发结算弹窗

#### 节点数量参考

| 复杂度 | 节点数 | 适合 |
|---|---|---|
| 短篇 | 5-7 | 单线推进 + 小决策 |
| 中篇（推荐） | 8-12 | 主线 + 1-2 条支线（治愈者 / 商店） |
| 长篇 | 15-25 | 多分支、变量门控、章节套娃 |

默认预设"暗黑森林冒险"是 **12 节点**，可作为参考实现。

---

## 三、商店事件

`eventType: "shop"` + `shop` 字段：

```json
{
  "id": "merchant",
  "eventType": "shop",
  "name": "矮人商店",
  "trigger": { "type": "composite", "condition": { "pointsOfInterest": ["poi_village"] } },
  "repeatable": true,
  "shop": {
    "inventory": [
      { "itemId": "item_009", "price": 25, "stock": 5 },
      { "itemId": "item_010", "price": 30, "stock": 3 }
    ],
    "sellMultiplier": 0.5
  }
}
```

商店事件被触发后会一直保持在右面板，玩家可买可卖直到点击"离开商店"。

---

## 四、角色与战斗

### 4.1 角色卡

```json
{
  "id": "char_001",
  "name": "艾拉",
  "title": "圣骑士",
  "stats": { "hp": 120, "hpCurrent": 120, "mp": 40, "mpCurrent": 40,
             "attack": 16, "defense": 14, "magicAttack": 8, "magicDefense": 10,
             "speed": 10, "luck": 6 },
  "abilities": [
    {
      "id": "ability_001", "name": "圣光斩",
      "cost": { "mp": 12 },
      "effect": { "damage": { "formula": "attack * 1.8" } }
    }
  ],
  "equipment": { "weapon": "item_001", "armor": null, "accessory": null },
  "inventory": ["item_009"],
  "level": 3, "experience": 120
}
```

**升级公式**：`getExperienceForNextLevel(currentLevel) = currentLevel * 50`（Phase 11.A 后从 ×100 调整为 ×50，升级节奏快 1 倍）

升级时所有属性 +1，HP/MP ×1.10，偶数级 speed/luck +1，并全恢复 HP/MP。

### 4.2 敌人

```json
{
  "id": "enemy_002",
  "name": "暗影狼",
  "difficulty": "easy",  // easy/normal/hard/boss
  "ecology": { "biome": "forest", "creatureType": "beast", "tier": "trivial" },
  "behaviorHint": "aggressive",
  "stats": { /* ... */ },
  "experienceReward": 12,
  "lootTable": [
    { "itemId": "item_008", "dropRate": 0.4 }
  ]
}
```

战斗启动时按全局难度修正：
- easy: HP×0.7, ATK-2
- hard: HP×1.3, ATK+2

#### 4.2.1 生态位与掉落

新敌人建议显式填写 `ecology`，它同时驱动战利品主题和图像匹配：

```json
{
  "id": "enemy_marsh_crocodile",
  "name": "沼泽鳄鱼",
  "difficulty": "hard",
  "ecology": {
    "biome": "swamp",
    "creatureType": "beast",
    "tier": "elite"
  },
  "lootMode": "static"
}
```

字段含义：

| 字段 | 说明 |
|---|---|
| `biome` | 地区生态，如 `swamp` / `snowfield` / `desert` / `mountain` / `tunnel` / `ruins` |
| `creatureType` | 生物类型，如 `beast` / `humanoid` / `undead` / `construct` / `elemental` / `spirit` / `ooze` |
| `tier` | 强度层级：`trivial` / `common` / `elite` / `boss`；通常由 difficulty 推断即可 |
| `lootMode` | `static` 使用烘焙好的 `lootTable`；`dynamic` 在战斗结算时实时抽取 |

推荐流程：

1. 用 MCP `ecology_vocab` 查看合法词表
2. 用 `loot_pool_preview` 预览某生态位会产出哪些战利品
3. 用 `enemy_assign_ecology` 给敌人写入生态位，让工具自动烘焙 `lootTable`、补齐 `preset.items` 并配图

如果敌人已有手写 `lootTable`，引擎默认继续使用静态表以保持向后兼容；如果只有 `ecology` 且没有 `lootTable`，战斗结算会自动走动态掉落。

### 4.3 战斗中的 AI 创意行动

战斗中玩家可输入文本（"我推倒石柱砸狼"），AI 评估返回 `creativeOutcome`：

```json
{
  "creativeOutcome": {
    "dc": 15,
    "formula": "d20",
    "onSuccess": {
      "narrative": "石柱砸中暗影狼！",
      "actions": [{ "type": "damage", "target": "enemy_002", "value": 20 }]
    },
    "onFail": {
      "narrative": "石柱倒向另一边。",
      "actions": []
    }
  }
}
```

骰子结果与 DC 比较 → 应用对应分支。**伤害值范围 0-100，超出会被 Action 白名单拒绝**。

---

## 五、地图

```json
{
  "width": 20, "height": 15, "tileSize": 64,
  "tileTypes": {
    "G": { "name": "草地", "color": "#4a8c3f", "walkable": true, "moveCost": 1 },
    "T": { "name": "树林", "color": "#2d5a1e", "walkable": true, "moveCost": 2 },
    "W": { "name": "水域", "color": "#3366cc", "walkable": false }
  },
  "grid": [
    "TTTTGGGGGG...",
    "TTTGGGGVGG..."
  ],
  "pointsOfInterest": [
    { "id": "poi_spawn", "x": 3, "y": 7, "name": "起点", "type": "spawn", "linkedEventId": null }
  ],
  "fogOfWar": true, "revealRadius": 3
}
```

- POI 的 `id` 字段用于事件触发器的 `pointsOfInterest` 字段匹配
- `linkedEventId` 让 POI 直接触发某个事件（无 composite 条件）

---

## 六、AI 提示词调优

### 6.1 通过 `aiConfig` 调温度

```json
{
  "aiConfig": {
    "temperature": 0.7,        // 0=确定性，1=最有创意
    "maxResponseTokens": 1000  // 推荐 ≥1000，防止 creativeOutcome JSON 截断
  }
}
```

主线剧情建议 0.5-0.7（保持一致性），自由探索 0.8-0.9（更生动）。

### 6.2 在 event 上设置 AI 提示

```json
{
  "id": "ch_battle",
  "aiPromptHint": "紧张氛围，敌人嘶吼，强调死亡威胁"
}
```

会作为额外 prompt 注入。

### 6.3 用 add_memory 让 AI 记住重要事件

```json
{
  "outcomes": [
    {
      "text": "...",
      "effects": [
        { "type": "add_memory", "value": "玩家救了村民并接受了任务" }
      ]
    }
  ]
}
```

写入 AI 长期记忆的 Key Events 层，未来对话 AI 会知道这件事发生过。

---

## 七、调试与测试技巧

### 7.1 浏览器 Console

```js
const app = window.__trpgApp;
app.gameState                          // 查看当前状态
app.gameState.completedEventIds        // 查看已完成事件
app.gameState.variables                // 查看变量状态
app.gameState.aiContext.keyEvents      // 查看长期记忆
app._triggerEvent('ch1_start')         // 手动触发事件
```

### 7.2 跳过预设条件测试

```js
// 强制完成事件作为测试前置
app.gameState.completedEventIds.push('ch1_start', 'ch2_traveler');
// 设置变量
app.gameState.variables.opened_gate = true;
// 移动到任意地块
app.gameState.mapState.playerPosition = { x: 17, y: 10 };
```

### 7.3 关闭随机概率

如果你的事件 probability 设了 0.4，测试时可：

```js
Math.random = () => 0.05;  // 让所有概率检查通过
```

### 7.4 校验

`GamePreset.validate()` 会检查：
- 事件 `start_combat` 引用的 `enemyIds` 是否存在
- 敌人 `lootTable` 引用的 `itemId` 是否存在
- POI 坐标与 grid 是否一致
- 生成大剧本时建议额外用 MCP `preset_analyze` 和 `enemy_assign_ecology` 检查生态位/掉落/配图一致性

---

## 八、暗黑森林案例拆解

参考 [`src/data/defaultPreset.js`](../src/data/defaultPreset.js)：

| 章节 | 设计意图 | 演示技术 |
|---|---|---|
| ch1 受命出征 | 强制开场 | POI 触发 + priority 100 + set_variable |
| ch2 神秘旅人 | 关键道具获取 | 道路概率事件 + add_item + add_memory |
| ch3 林间村落 | 信息收集 | POI + trigger_event 链式 + set_variable |
| ch4 杂货铺 | 经济循环 | shop.inventory + priority 85 优先抢过 boss |
| ch5 暗影狼 | 战斗熟悉 | tileTypes + probability + start_combat |
| ch6 堕落骑士 | 条件 boss | requireVariables 门控 + 分支选择 |
| ch7 林中治愈者 | 救援机制 | partyHpBelow 阈值 + heal: all |
| ch8 遗迹之门 | 物品意义 | POI + requirements 提示性物品验证 |
| ch9 巫妖 boss | 自动衔接 | requireVariables + VARIABLE_CHANGE 时机 |
| ch10 黎明 | 结局 | requireCompletedEvents + 无选项自动播放 |

---

## 八·五、做一个新题材的战略剧本（写一个 `strategySchema`）

> **战略系统是可选模块（Phase 47）**。它与基础架构**数据驱动解耦**：所有战略系统（势力级国库/内政外交、军团战、叙事化战争、底层视角/小兵参战）只在预设含 `strategicSetup`（或 `preset.modules.strategy`）时激活；纯个人冒险/悬疑/解谜剧本不带这些字段即可，引擎对它们零开销、零干扰（系统已注册但全程 no-op）。
>
> **MCP 自动判定**：经小说→预设管线时，`blueprint_draft` 会用 `recommendStrategyModule(digest)` 据**势力数 / 战争·王朝·权谋主题词 / 战役类节拍 / 反向的个人题材词**自动判定是否启用战略模块，写入 `blueprint.strategyModule`（可用工具参数 `strategyModule:true/false` 或手改蓝图覆盖）。`preset_build_from_blueprint` 据此**包含或跳过**战略产物（strategicSetup / 军团战 / 理政朝堂），并在 `preset.modules.strategy` 标记结果。三国/西幻/现代战争 → 启用；纯冒险/悬疑/武侠个人线 → 不启用。

战争/战略层（兵种·克制·阵型·器械·政令·外交·城池·行军姿态）是**通用机制引擎 + 题材数据**两层。要做中世纪西幻、现代战争、星际等迥异题材的"内政外交 + 军团战"剧本，**不必改任何引擎代码**——只在预设里写一份 `strategySchema` 覆盖默认（三国）数据即可。范例见 [`src/data/themes/medievalFantasy.js`](../src/data/themes/medievalFantasy.js)、[`src/data/themes/modernWar.js`](../src/data/themes/modernWar.js) 及对应 `*Preset.js`。

### 怎么挂

预设顶层加 `strategySchema` 字段（可只覆盖部分，其余继承三国默认）：

```js
const myPreset = {
  presetId: 'my_theme', name: '…',
  strategySchema: { /* 见下 */ },
  factions: [ /* … */ ],
  strategicSetup: { playerFactionId, regions, factions: { …holdings… } },
  // 角色 / 场景（含 tags:['governance'] 的理政场景）/ startingSceneId 同普通剧本
};
```

加载时 `StrategicSystem.initFromPreset` 自动 `resolveSchema(preset)` 并挂到 `gameState.strategySchema`，全引擎（战术/战略/作战/UI/AI 叙事）随之换皮。

### Schema 字段一览

| 字段 | 作用 | 覆盖方式 |
|---|---|---|
| `resources` | 资源标签 `{name,icon}` | 深合并（**键固定** gold/food/troops/order，只改名/图标） |
| `unitTypes` | 兵种 `{name,melee,def,ranged,speed,charge,water,wishFormation?}` | 整张替换 |
| `counterMatrix` | 克制倍率 `{攻种:{守种:倍率}}` | 整张替换 |
| `formations` | 阵型 `{name,statMods,requiresTactics}` | 整张替换 |
| `machines` | 器械 `{name,effect:{vs,power,area},battleTypes,mobility}` | 整张替换 |
| `battleTypes` | 战型（**键固定** field/siege/defense/naval；可改名/分区/`gateZone`） | 整张替换（一般沿用默认） |
| `tactics` | 战法（**键固定** charge/fire/ambush/rally；可改名/数值） | 整张替换 |
| `marchPostures` | 行军姿态（**键固定** raid/open；可改名/数值） | 整张替换 |
| `holdingTypes` | 城池类型 `{name,prod,def,recruit}` | 整张替换 |
| `policies` | 政令 `{name,cost,note,effect?}` | 整张替换 |
| `diplomacyActions` | 外交 `{name,cost,note}` | 整张替换 |
| `defaultBattleUnits` | 战略抽象兵力→军团战兵种角色 `{defender,defenderSupport,attacker,attackerShock}` | 整张替换 |
| `narration` | 口吻 `{settingTone,postures,siegeVerbs,terms}` | 深合并 |

### 结构槽位 vs 自由数据（关键约定）

引擎逻辑按"原型键"运作，换皮时**键名沿用、只改展示与数值**最省事：

- **资源键** `gold/food/troops/order` 固定（季产/政令逻辑按键运作）——只改 `name/icon`。
- **政令键** `farming/tax/conscript/fortify/relief/develop` 是 6 个原型（增粮/增金/增兵/增防/增民心/增产能）。沿用键则走内置原型效果；若要**全新政令**，给该政令一个 `effect:{gold?,food?,troops?,order?,productionEfficiency?,security?,scaled?:[...]}` 字段即可自定义任意键。
- **外交键** `alliance/declare_war/sue_peace/tribute/marriage/sow_discord`、**战型键** `field/siege/defense/naval`、**姿态键** `raid/open`、**战法键** `charge/fire/ambush/rally` 同理：沿用键得到内置行为，改 `name/cost/数值` 换皮。
- **兵种/阵型/器械/城池类型**：键可任意自定义（克制矩阵、`defaultBattleUnits`、`wishFormation` 引用这些键即可）。`unitType.water>1` 视为"水栖兵种"（水战免地形罚）。

### 最小检查清单

1. `unitTypes` 至少含 `defaultBattleUnits` 引用的几个键；`counterMatrix` 用你的兵种键。
2. `defaultBattleUnits.{defender,defenderSupport,attacker,attackerShock}` 指向已定义的兵种键（缺失会回退到首个兵种，不报错但不理想）。
3. `policies`/`diplomacyActions` 若改了键，UI 快捷与 AI 进谏清单会自动跟随；若用全新政令键务必带 `effect`。
4. `strategicSetup.factions[*].holdings[*].type` 用你的 `holdingTypes` 键；`region` 用 `regions` 图中的键。
5. 跑 `npx jest`（题材 schema resolve/combat 用例可仿 `__tests__/integration/themePacks.test.js`）；可选 `simulateLegionBattle(battleDef,{strategySchema})` 跑题材平衡。

> 提示：题材**叙事口吻**主要由 `narration.settingTone` + 各表的 `name` 驱动 AI 文风；机制平衡由数值（melee/def/克制倍率/cost）驱动。两者解耦，可分别调。

### 玩家身份：执棋者 or 棋中卒（`playerRole`，Phase 43）

同一个战略世界，玩家既可执掌一方势力，也可只做底层一卒——战略层始终是"底层数据支持"，不必由玩家操控。

- `strategicSetup.playerRole`：`ruler`（默认，玩家号令所属势力）/ `officer` / `soldier`。
- 非 `ruler` 时：玩家所属势力由其 NPC 君主**自治**（也跑敌国 AI 决策）；战争（行军/围城/城池易主）在季度推进中**全自动结算**；玩家**得不到**内政/外交/作战指挥选项，进言只是表态（AI 不落地为指挥动作）；UI 给"静观时局（一季流转）"入口让世界继续转。
- **出身决定身份**：`startingOptions.origins`（及 races/backgrounds/faiths）的某个选项可携 `strategicRole` 和可选 `strategicFaction`，玩家选了该出身即按其设定 `playerRole`/所属势力。范例见 [`src/data/themes/modernWarPreset.js`](../src/data/themes/modernWarPreset.js)（最高统帅/前线指挥官/列兵）。

- **出身定制身份/属性/开局（Phase 46，通用）**：出身选项除 `strategicRole`/`strategicFaction`，还可携：
  - `stats`：**整套基础属性覆盖**（先于 `statBonus` 叠加）——低阶出身因此有相称属性，不必继承主角的高数值卡。
  - `startSceneId`：**该出身的开局场景**——底层身份可从军营/旅途等切入，不被塞进主角的开场。
  - `charName` / `charTitle` / `charDescription`：**改写主角身份**（如把默认主角「刘备」改写为「无名小卒」）。
- **主角本位事件门控（Phase 46，通用）**：事件 `trigger.condition.requirePlayerRole`（数组白名单）。把主角剧情/主线事件限定 `requirePlayerRole:['ruler']`，则底层视角（officer/soldier）不会被自动卷入主公的剧情。无战略层时 `playerRole` 视作 `ruler`；未设此条件的事件不受影响（向后兼容）。

```js
startingOptions: { origins: [
  { id: 'king',    name: '君主', strategicRole: 'ruler',   startSceneId: 'scene_court' /* …tags/statBonus… */ },
  { id: 'soldier', name: '小兵', strategicRole: 'soldier', strategicFaction: 'wei',
    charName: '无名小卒', startSceneId: 'scene_barracks',
    stats: { hp: 46, hpCurrent: 46, attack: 8, defense: 5, speed: 6, luck: 1 } },
] }
// 主线/主角事件：限定仅君主触发
{ id: 'ev_coronation', tags: ['main'], trigger: { type: 'composite', condition: { inScene: ['scene_court'], requirePlayerRole: ['ruler'] } }, /* … */ }
```

> 底层视角下，玩家的战争体验靠 战略层幕后自转 + 「请缨参战」局部战斗 + AI GM 据军情（数字摘要已注入【身份】+ 围城/探报）即兴叙述其见闻。三国主线即用此法：小卒于「行伍军营」开局、主线事件限 ruler，体验从行伍间展开。范例见 [`scripts/patch-sanguo-origins.mjs`](../scripts/patch-sanguo-origins.mjs)。

#### 小兵实战参战：局部战斗 + 局部时间放缓（Phase 44）

底层视角玩家在其势力卷入战事（活跃围城 / 在途行军）时，`getState` 会给出 **`skirmish_join`**（"请缨参战"）。这套机制**无需剧本配置**，战略层有 `regions` 且玩家非 ruler 即自动可用：

- **局部战斗**（`SkirmishSystem`）：敌我各数人小队的回合制连续战斗（同默认战斗口径）。战损后按"战线 tide"（由参战时玩家势力与敌方的兵力对比自动估算）决定**援兵波次**；**士气按战损比**动态算，结局多样——溃逃/投降/俘虏/上级鸣金/全歼。`situation:'skirmish'`，交互模式逐回合（斩击/据守/鼓舞/退却/生擒），auto 模式一战到底。
- **局部时间放缓**：参战不推进战略季/旬——它是被放大的瞬间。宏观战争只在玩家"静观时局"时推进。
- **战功 / 晋升**：`gameState.soldierCareer{rank,rankTier,merit,kills,battles}`；累计战功按 `SOLDIER_RANKS` 晋升；升至将官（军候）→ `playerRole` 自动转 `ruler`，玩家从此进入战略参与模式。
- **重大事件**：个人英勇几乎不改全局，唯**阵斩/生擒敌方关键将领**（局部战斗中小概率出现的 `isCommander` 敌将）触发 `StrategicSystem.applyMajorEvent` —— 敌势力民心/兵力受挫，若其正围我城则可能动摇退兵。

> 剧本侧通常无需改动即获得此能力；要强化代入感，可在 `narration`/事件里呼应"行伍生涯"。后续若要把局部战斗也主题换皮（西幻/现代兵卒口吻），可在 `SkirmishSystem` 生成小队名时读 `strategySchema`（暂用通用词）。

---

## 八·六、做一个学校剧本（`schoolSetup` + `schoolSchema`，Phase 48）

学校系统是与战略系统并列的**可选模块**：剧本含 `schoolSetup` 才激活，普通剧本零负担。机制引擎通用，题材（魔法学院/武道馆/现代高中）只是 `schoolSchema` 数据——换皮 = 换 schema，不碰逻辑。

### 怎么挂

```js
{
  modules: { school: true },           // 省略也行：有 schoolSetup 即视为开启
  schoolSchema: magicAcademySchema,    // 题材数据（省略=通用学院 DEFAULT_SCHOOL_SCHEMA）
  schoolSetup: { schoolName: '云霄魔法学院', major: 'evocation' },  // 活状态种子
  scenes: [ { id: 'scene_academy', tags: ['spawn', 'school'], /* … */ } ], // 场景打 'school'/'campus' tag → 进校园即给就学动作
}
```

进入带 `school`/`campus` tag 的场景且在校（`status==='enrolled'`）时，`situation` 变为 `'school'`，浏览器 RightPanel 显示**就学条**（学籍/学分/绩点/记过 + 选课/上课/社团/考试/推进学期/招募按钮）。

### `schoolSchema` 字段一览

- `curriculum`：`mode`（`major-fixed` 选专业固定课 / `free-credits` 自选学分）、`termsPerYear`、`creditsPerYear`/`creditsToGraduate`、`yearsToGraduate`、`passGpa`（低于→留级）、`expelGpa`/`expelDemerits`（→退学）、`maxElectivesPerTerm`。
- `majors`：专业/学派/门派。`major-fixed` 下用 `requiredCourses` 或 `requiredByYear:{1:[…],2:[…]}` 逐年载入必修。
- `courses`：`{ credits, type(lecture/training/seminar/practical), attr(考试主属性), prereqs:[先修], grants:{stats,skills}, eventHook }`。修毕即把 `grants` 落到角色卡。
- `clubs`：`{ name, activity, eventHook, perk:{stats,skills} }`。
- `rules`：校规 `{ name, desc, penalty:{ demerits, severe } }`。记过累计达 `expelDemerits` 或重大违纪≥3 → 退学。
- `exams` / `competitions`：`{ name, attr 或 courses:'enrolled'|'completed', passScore, failPenalty('retain'|'expel'|null), rewardByRank:[{maxRank,reward}] }`。竞赛即跨校联赛/擂台。
- `roles`（师友角色名）、`recruitAffinity`（毕业招募关系阈值）、`narration.{settingTone,terms}`（题材口吻/术语）。

### 校园剧情：`requireSchoolState` 门控 + 事件效果

事件 `trigger.condition.requireSchoolState` 把社团/实践/校园剧情限定到在校特定情形：`true`（仅需在校）或 `{ status, minYear, maxYear, major, enrolledIn, completed, inClub, eventHook, minDemerits, minGpa }`。配合课程/社团的 `eventHook`（上课/参与时 `context.schoolHook` 注入）触发对应剧情。

事件 outcome 可用学校事件效果：`school_relationship{npcId,delta,role}`、`school_violation{ruleId}`、`school_temp_party{members}`（课程/活动/任务**临时组队**，活动后用 `school_disband_party` 撤出）、`school_exam{examId}`（被动/强制点名参加统考或联赛）。

### 招募与身份

- 毕业（或辍学/肄业）时，与师友同窗关系 ≥ `recruitAffinity` 者可经"招募"实体化入队（走 `NPCSystem.recruitCompanion`，需 NPC `recruitable:true` 且有 `stats`）。
- 出身可决定入学专业/学派/门派：`startingOptions.origins[*].schoolMajor`（覆盖 `schoolSetup.major` 默认）。

> 范例：[`src/data/themes/magicAcademy.js`](../src/data/themes/magicAcademy.js)（魔法学院）、`martialDojo.js`（武道馆/宗门）、`modernHighschool.js`（现代高中含学科竞赛/校运会/高考）+ 示范剧本 [`presets/magic-academy.json`](../presets/magic-academy.json)。MCP 三段管线会据 digest 校园主题词自动判定是否启用（`recommendSchoolModule`），也可在 `blueprint_draft` 用 `schoolModule:true/false` 覆盖。

---

## 九、常见陷阱

| 陷阱 | 修复 |
|---|---|
| 事件不触发 | 检查所有 require* 字段，用 console 看 variables/completedEventIds |
| 事件被另一个抢过 | 调整 priority，主线 > 随机 |
| 重复触发 | 加 `excludeCompletedEvents: [自身id]` 或 `repeatable: false` |
| shop 事件秒关闭 | 确认 `eventType: 'shop'` AND `shop.inventory` 都填了 |
| 状态机不工作 | 用 `set_variable` 而不是 `add_memory`（后者只给 AI 看） |
| AI 编造怪物名 | 检查校验日志，AI 已经被白名单拒绝，叙事可能有缺漏 |

---

## 十、社区贡献

预设 JSON 是纯数据，可以：
- 导出后分享给朋友
- 用 AI（ChatGPT 等）按本手册的格式生成新预设
- 修改 [`src/data/defaultPreset.js`](../src/data/defaultPreset.js) 然后 PR
