# 记忆文件架构

一个文件夹，四层职责，任何一层都可以用普通 Markdown 工具直接读写。

```
<Config.dir 或设置页选择的目录>/
├── soul.md                     # 人格与风格：注入 system prompt 靠前（≤4KB）
├── MEMORY.md                   # 索引：注入 system prompt 靠后（≤4KB，超限立即压缩）
├── topics/<slug>.md            # 所有主题文件（人物/项目/决策/偏好/教训）
│                               #   分类由 frontmatter 的 type 决定
└── inbox/
    ├── YYYY-MM-DD.md           # 每轮对话原文（不注入、不检索）
    └── archive/                # 已提炼原文（30 天自动清理）
```

## 各层职责

| 层 | 写入者 | 是否注入 | 是否可检索 |
|---|---|---|---|
| `soul.md` | 人（设置页） | 是，靠前 | 是 |
| `MEMORY.md` | 提炼（索引）/ 人 | 是，靠后，≤4KB | 是 |
| `topics/*.md` | 提炼 / `memory` 工具 | 否（按需 `memory read`） | 是 |
| `inbox/**` | 每轮 capture 自动 | 否 | 否（原始原料） |

## 文件 Schema

分型文件统一带 frontmatter，正文是 `- 一行一条事实`：

```md
---
name: 王工
description: 后端负责人，偏好 async 写法
type: person
updated: 2026-10-27
---

- 负责后端上线
- 偏好 async/await，不喜欢回调
```

`MEMORY.md` 的索引行：

```md
- [王工](people/wang.md) — 后端负责人，偏好 async 写法（更新 2026-10-27）
- 全局事实没有主题文件时直接写成一行
```

## 写入路径

1. **每轮 capture** → `inbox/YYYY-MM-DD.md`（原文，纯追加）
2. **提炼**（触发：积压 ≥16KB 且 ≥1h / 会话全部关闭 / 空闲 30 分钟 / 每 12–24h / 手动）
   - 模型返回 `## INDEX` + `## FILES`
   - INDEX 追加进 `MEMORY.md`，超过 4KB 立即压缩一次
   - FILES 按分型目录写主题文件：frontmatter 合并、正文按行跨文件去重
   - 原文移到 `inbox/archive/`（同名加时间戳，绝不覆盖）
3. **`memory` 工具**：`search` / `read` / `write`；新建分型文件时自动补 frontmatter

## 不变式

- 注入内容 ≤4KB + 人格 ≤4KB；索引再长也不会挤爆上下文
- `inbox/` 不参与注入、检索、压缩
- 任何写入都经过路径白名单：只允许 `topics/*.md`、禁止 `soul.md` / `MEMORY.md` / `inbox/` / `..`
- 主题文件只有一个目录：旧版 `people/` 等分型目录会在启动时自动迁移进 `topics/`（type 写进 frontmatter），空目录删除
- 分类按钮按 frontmatter.type 过滤，不再是物理目录
- 提炼失败不归档原文，下次重试；归档同名不覆盖
- 记忆是文件，不是数据库：可以直接用编辑器改、用 git 管、用 `grep` 查
