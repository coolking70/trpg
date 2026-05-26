# TRPG 预设 MCP 服务器

让 Claude（或任何 MCP 客户端）能够**批量、精细化**地生成 / 修改 TRPG 预设。
配合编辑器使用，AI 可以一次性搭建出完整的世界、角色、敌人、事件、场景图。

## 快速开始

```bash
# 直接启动（默认在当前目录创建 preset-draft.json）
npm run mcp

# 指定输出文件路径
node mcp-server/preset-server.mjs /path/to/my-preset.json

# 跑端到端烟雾测试（12 个用例）
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

接入后 Claude 会看到 34 个工具，可以让它"写一份太空船难主题的剧本"，它会自己组合 `scene_create / event_create / enemy_create / preset_batch_apply` 把整套预设产出来。

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

12 个端到端用例覆盖：场景 CRUD / 连接 / 门控 / 事件挂载 / 校验断引用 / 批量回滚等关键路径。
