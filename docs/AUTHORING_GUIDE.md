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
