# AI 集成手册

如何配置 AI、AI 的边界是什么、提示词如何构建、Action 校验机制。

## 一、AI 的角色

本项目的 AI 是 **GM（叙事 + 部分判定）**，**不**是游戏机制本身。设计原则：

1. **AI 讲故事，CombatSystem 算账** — 战斗伤害走机制，不由 AI 决定
2. **AI 评估难度，DiceSystem 投骰** — 创意行动的 DC 由 AI 设定，结果由骰子决定
3. **Action 白名单保护** — AI 返回的所有 actions 经 `_validateAction` 拦截，非法值被丢弃

---

## 二、API 配置

支持任何 OpenAI 兼容的 `/chat/completions` 接口：

```js
// 设置面板里填写：
{
  endpoint: 'https://api.openai.com/v1',
  apiKey: 'sk-...',
  model: 'gpt-4o-mini',  // 或 deepseek-chat / qwen2.5:7b / mimo-v2.5 等
  temperature: 0.7,
  maxTokens: 1000        // 推荐 ≥ 1000 防止 creativeOutcome JSON 被截断
}
```

> 注意：模型名通常**大小写敏感**。如果 API 报 `Not supported model`，先 GET `/v1/models` 看准确拼写（如小米 MiMo 是 `mimo-v2.5` 不是 `MiMo-V2.5`）。

### 推荐配置

| 模型 | 适合场景 | 备注 |
|---|---|---|
| `gpt-4o-mini` | 通用 | 性价比高 |
| `deepseek-chat` | 中文叙事 | 价格友好 |
| `mimo-v2.5` / `mimo-v2.5-pro` | 中文叙事 | 小米 MiMo（实测兼容） |
| `qwen2.5:7b` (Ollama) | 本地部署 | 无网络依赖 |
| `claude-haiku-4-5` (代理) | 长上下文 | 通过代理转 OpenAI 格式 |

### 连通性测试按钮

设置面板的 **测试 API 连接** 会使用当前表单值直接发送一次极小的 `/chat/completions` 请求：

- 不需要先保存配置
- 不写入游戏叙事上下文
- 不计入游戏内 token 统计账本
- 成功时显示模型名、耗时和 API 返回的 token 用量
- 失败时显示 HTTP 状态、网络错误或超时原因

这可以区分"API 配置不可用"和"游戏内某次叙事没有产生有效文本"两类问题。

### 离线兜底

未配置 API key 时自动走 `AIGMEngine._localFallback`，使用模板叙事。功能可用但叙事乏味。

---

## 三、AI 提示词架构

每次 AI 调用构造的消息列表：

```
[
  // System Message 1: 静态（preset 派生，缓存）
  { role: 'system', content: '你是TRPG游戏主持人...
                              世界:艾尔大陆...
                              队伍:艾拉/雷恩/...
                              规则:D20...
                              回复格式(JSON)...' },

  // System Message 2: 长期记忆（每次重建）
  { role: 'system', content: '【世界事实】
                              - 世界: 艾尔大陆 (黑暗纪元第三年)
                              - 背景: ...
                              【已发生的关键事件】
                              1. 接受了公会任务
                              2. 从神秘旅人处获得护身符
                              ...' },

  // System Message 3: 近期摘要（可选，contextWindow 压缩结果）
  { role: 'system', content: '近期剧情摘要: ...' },

  // Context Window: 最近 10 条 user/assistant 对话
  { role: 'user', content: '...' },
  { role: 'assistant', content: '{"narrative":"..."}' },
  ...

  // 当前用户消息
  { role: 'user', content: '[回合5 阶段:exploration 位置:(7,1)]
                            队伍: 艾拉:120/120 ...
                            当前位置: 林间村落
                            四周: 北:草地 南:草地 西:村庄 东:草地
                            玩家行动: 我观察四周
                            请用2-3句叙述...' }
]
```

---

## 四、AI 必须遵守的响应格式

```json
{
  "narrative": "叙事文本（中文2-3句）",
  "actions": [],
  "diceRequests": [],
  "stateUpdate": null,
  "creativeOutcome": null
}
```

| 字段 | 何时填 |
|---|---|
| `narrative` | 总是填，玩家看到的叙述 |
| `actions` | 仅在有实际伤害/治疗/物品/战斗变化时 |
| `diceRequests` | 仅在玩家明确尝试需要判定的行动 |
| `stateUpdate` | 阶段转换时 |
| `creativeOutcome` | 战斗中玩家文本输入的创意行动 |

---

## 五、可用 Actions（Action 白名单）

所有 AI 返回的 action 必须通过 `AIResponseParser._validateAction` 校验。非法 action **静默丢弃**并记录日志。

| Action | 字段 | 校验规则 |
|---|---|---|
| `damage` | `target`, `value` | value ∈ [0,100], target 实体存在 |
| `heal` | `target`, `value` | 同上 |
| `add_item` | `value` (itemId) | itemId 必须在 CardManager 中存在且 type=item |
| `remove_item` | `value` (itemId) | 同上 |
| `start_combat` | `enemyIds[]` | 数组非空，每个 enemyId 存在且 type=enemy |
| `end_combat` | `value` (result) | 'victory' / 'defeat' / 'flee' |
| `trigger_event` | `value` (eventId) | eventId 存在且 type=event |
| `set_variable` | `target`, `value` | target 非空字符串，value 任意 |
| `add_memory` | `value` (summary) | 长度 ≤ 200 字 |

### 拒绝示例

AI 返回 `{ type: 'damage', value: 9999 }` → 拒绝并记录 "damage value 超出合理范围 [0,100]"

AI 返回 `{ type: 'add_item', value: 'item_fake_legendary' }` → 拒绝并记录 "item item_fake_legendary 不存在"

---

## 六、创意行动判定（战斗 Option B）

战斗中玩家输入文本 → 路由到 `combat_creative` actionType：

```js
// 玩家："我抓地上的灰烬扬向狼眼睛"
// AI 返回:
{
  "narrative": "你抓起灰烬扬向暗影狼眼睛。",
  "creativeOutcome": {
    "dc": 12,
    "formula": "d20",
    "onSuccess": {
      "narrative": "灰烬精准入眼，狼嚎叫！",
      "actions": [{ "type": "damage", "target": "enemy_002", "value": 8 }]
    },
    "onFail": {
      "narrative": "风向不对，灰烬扑空。",
      "actions": []
    }
  }
}
```

主流程：
```
玩家输入 → AI 评估 → 得到 dc + onSuccess/onFail
        ↓
DiceSystem.rollCheck('d20', 12) → 比较 total vs dc
        ↓
成功 → 应用 onSuccess.narrative + onSuccess.actions（经白名单校验）
失败 → 应用 onFail.narrative + onFail.actions
        ↓
推进回合（消耗一个行动）
```

**DC 范围 1-40**，AI 返回值超出会让整个 creativeOutcome 被丢弃（fallback 为 null）。

---

## 七、分层长期记忆

```
┌─────────────────────────────────┐
│ Layer 1: World Facts (永久)     │
│ - 预设加载时从 lore 写入        │
│ - 永远在 prompt 中              │
├─────────────────────────────────┤
│ Layer 2: Key Events (滚动 20)   │
│ - 事件完成自动写入              │
│ - boss 战胜利自动写入           │
│ - AI 通过 add_memory 主动写入   │
│ - 超过 20 条时归档最早 5 条到   │
│   World Facts                   │
├─────────────────────────────────┤
│ Layer 3: Recent Context (动态) │
│ - 最近 10 条 user/assistant     │
│ - 超出时压缩为 200 字摘要       │
└─────────────────────────────────┘
```

### 自动写入触发点

| 触发点 | 写入内容 |
|---|---|
| 事件选项完成（resolveChoice） | "第X章名称：选择 Y → 结果文本" |
| 战斗胜利（finalize） | 仅当击败 boss/hard 难度时："击败了 X、Y" |
| AI add_memory action | AI 自定文本 |

### 容量管理

```js
// 已满 20 条时再加 → 归档最早 5 条
keyEvents = [e6, e7, ..., e21]  // 16 条
worldFacts.push("早期事件: e1; e2; e3; e4; e5")
```

---

## 八、Token 成本控制

### 8.1 缓存系统提示词

```js
// AIGMEngine.setPreset 时只构建一次
this._cachedSystemPrompt = this.promptBuilder.buildSystemPrompt(preset);
```

### 8.2 上下文压缩

```js
// AIGMEngine.contextWindow 长度超过 maxContextMessages (10) 时
this._compressContext();
// 旧消息合并为 200 字以内的 summarizedHistory
```

### 8.3 地图上下文用文字而非字母网格

旧做法（浪费）：传整张 20×15 字母 grid（300 tokens）
新做法（节省）：传 "当前位置: 林间村落 / 四周: 北:草地 南:草地..."（30 tokens）

### 8.4 估算

```js
import { estimateTokens } from './utils/tokenEstimator.js';
// 中文每字 ~1 token，英文每词 ~1 token
```

一次普通 AI 调用：
- 系统提示词缓存：~600 tokens
- 长期记忆注入：~300 tokens
- 近期对话：~500 tokens
- 当前消息：~100 tokens
- **合计约 1500 prompt tokens + 300 completion tokens**

按 gpt-4o-mini ($0.15/1M input + $0.6/1M output) 算 → 一次 ~$0.0004，玩 1 小时 ~$0.05。

---

## 九、AI 错误处理

| 错误 | 处理 |
|---|---|
| API 超时（30s）| catch → "GM 失联: 超时" + localFallback |
| 网络错误 / 5xx / 429 | 指数退避，最多 3 次尝试；最终失败后 "GM 失联" + localFallback |
| AI 返回空 narrative | 发布 `ai:error` toast，并使用本地兜底叙事写入 narrativeLog |
| 4xx 请求错误 | 立即抛出，**不重试**（请求本身问题，重试无意义） |
| JSON 解析失败 | 三级 fallback: 直接 → markdown 提取 → brace 提取 → 整文本作为 narrative |
| AI 返回非法 action | 静默丢弃，console.warn 记录 |
| AI 编造 creativeOutcome | DC 范围校验（1-40），越界 → null |
| **并发冲突**（isProcessing=true）| **轮询等待**前请求完成（最多 30s），不丢叙事 |
| **AI 主动 narrate 失败时的兜底**| `_localFallback.narrate_combat` 区分胜利/逃脱/失败/开场，写出有质感的本地叙事 |

整体哲学：**优雅降级，永不打断玩家**。

### Token 使用监控

`AIGMEngine.tokenStats`（session 级，每次 reload 重置）：

```js
{
  totalPromptTokens, totalCompletionTokens, totalTokens, totalCalls,
  lastCall: { promptTokens, completionTokens, totalTokens, ts },
  budgetWarningTokens, // 设为 >0 时超过会发 'ai:budgetWarning' 事件
}
```

- 优先用 API 返回的 `usage` 字段（精确）
- 缺失时本地估算（`utils/tokenEstimator.js`）
- 工具栏 🪙 实时显示累计 tokens
- 设置面板有详细统计 + 重置按钮

实测：一场完整 10 章主线 ~30K tokens，按 gpt-4o-mini 约 ¥0.10。

---

## 十、与本地 fallback 的协同

未配置 API 时自动走 `_localFallback`，能让游戏正常运行：

```js
case 'narrate_event': narrative = event.description + outcomeText;
case 'narrate_combat': narrative = '战斗继续...' / 'X攻击Y造成Z伤害';
case 'player_action': narrative = '你' + actionText + '。';
```

适合：调试预设、CI 测试、离线演示。但会失去 AI 的灵气。

---

## 十一、扩展 AI 能力

如果你想加新的 Action 类型（如 `summon_npc`、`change_weather`）：

1. **AIPromptBuilder.buildSystemPrompt** 中告知 AI 该 action 存在
2. **AIResponseParser._applyAction** 加 case
3. **AIResponseParser._validateAction** 加校验规则
4. **main.js** 订阅相应事件（如 npc:summonRequest）

确保 **校验先于应用**，否则 AI 会变成不受约束的"god mode"。

---

## 十二、prompt 调优经验（来自实测）

### 12.1 强语气禁止比正向描述更有效

❌ 弱："请描述战斗场面"  
✅ 强："严禁描述任何角色的具体行动（不要写"举盾/拉弓/施法/挥剑"等动作）"

战斗开场（roundResults 为空）时，AI 倾向于脑补角色行动。明确禁止后才能让 AI 只描述气氛/环境/敌人神态。

### 12.2 "严格按 outcomeText" 约束

事件 outcome 的概率分支可能与 event.description 中的元素冲突（如 ch8 描述提"两尊石像鬼守在门两侧"，但 use_amulet 成功 outcome 应该是"石门打开"）。AI 可能把描述中的元素混入 outcome 叙事。

建议 prompt 增加："严格按结果文本叙事，不要编造与结果矛盾的情节"。

### 12.3 长 prompt 配 maxTokens ≥ 1000

`creativeOutcome` 的 JSON 结构（dc + formula + onSuccess + onFail + 两个 narrative + 两个 actions）至少要 300-500 token 才能完整。maxTokens 300 会导致 JSON 截断，触发 `_fallback(text)` 把整段 raw JSON 当 narrative 显示给玩家。

**默认值已统一为 1000**（见 Phase 11.A），文档若提到 300 是历史值。
