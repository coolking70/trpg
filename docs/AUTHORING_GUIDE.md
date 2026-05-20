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
  "map": { /* 网格地图 */ }
}
```

打开 **工具栏 → 📝 编辑器**，可以可视化编辑所有内容。本手册更关注**核心概念和设计原则**。

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
| MOVE | 玩家移动到新格子 |
| EVENT_COMPLETE | 一个事件完成后 |
| COMBAT_END | 战斗结束后 |
| TURN_END | 每个回合结束 |
| VARIABLE_CHANGE | `set_variable` 写入变量后 |

**重要规则**：含 `tileTypes` 或 `pointsOfInterest` 的事件**仅在 MOVE 时机评估**。其他时机不会评估空间条件。

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
ch_shop (pointsOfInterest: ['poi_village'], repeatable: true)
  → 每次进村都可访问
```

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

**升级公式**：`getExperienceForNextLevel(currentLevel) = currentLevel * 100`

升级时所有属性 +1，HP/MP ×1.10，偶数级 speed/luck +1，并全恢复 HP/MP。

### 4.2 敌人

```json
{
  "id": "enemy_002",
  "name": "暗影狼",
  "difficulty": "easy",  // easy/normal/hard/boss
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
    "temperature": 0.7,  // 0=确定性，1=最有创意
    "maxResponseTokens": 300
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
