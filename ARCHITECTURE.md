# 记忆文件架构

一个文件夹，四层职责，任何一层都可以用普通 Markdown 工具直接读写。

```
<Config.dir 或设置页选择的目录>/
├── soul.md                     # 人格与风格：注入 system prompt 靠前（≤4KB）
├── MEMORY.md                   # 索引：注入 system prompt 靠后（≤4KB，超限立即压缩）
├── topics/<slug>.md            # 所有主题文件（人物/项目/决策/偏好/教训/笔记）
│                               #   分类由 frontmatter 的 type 决定
├── inbox/
│   ├── YYYY-MM-DD.md           # 每轮对话原文（不注入、不检索、不压缩）
│   └── archive/                # 已提炼原文（30 天自动清理）
├── backups/<timestamp>/        # soul + MEMORY + topics 快照（默认保留 10 份）
└── .trash/<timestamp>/<原路径>  # 删除的主题文件（默认保留 30 天，可恢复）
```

## 各层职责

| 层 | 写入者 | 是否注入 | 是否可检索 |
|---|---|---|---|
| `soul.md` | 人（设置页） | 是，靠前，≤4KB | 是 |
| `MEMORY.md` | 提炼（索引）/ 人 | 是，靠后，≤4KB，超限截断 | 是 |
| `topics/*.md` | 提炼 / `memory` 工具 / 设置页 | 否（按需 `memory read`） | 是 |
| `inbox/**` | 每轮 capture 自动 | 否 | 否（原始原料） |
| `backups/**`、`.trash/**` | 备份 / 删除 | 否 | 否 |

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
- [王工](topics/wang.md) — 后端负责人，偏好 async 写法（更新 2026-10-27）
- 全局事实没有主题文件时直接写成一行
```

## 写入路径

1. **每轮 capture** → `inbox/YYYY-MM-DD.md`（原文，纯追加，失败会回塞缓冲）
2. **提炼**（触发：积压 ≥16KB 且 ≥1h / 会话全部关闭 / 空闲 30 分钟 / 每 12–24h / 手动）
   - 模型返回 `## INDEX` + `## FILES`
   - INDEX 按行跨次去重后追加进 `MEMORY.md`；超过 4KB 立即压缩一次
   - FILES 统一写入 `topics/`：frontmatter 合并、正文按行跨文件去重
   - 原文移到 `inbox/archive/`（同名加时间戳，绝不覆盖）
   - 超过 48KB 的 inbox 文件分段处理：本次已处理部分归档，剩余内容回写 `inbox/*-rest-*.md`
3. **`memory` 工具**：`search` / `read` / `write` / `list` / `delete`
   - `write` 只允许 `soul.md`、`MEMORY.md`、`topics/*.md`；旧路径 `people/x.md` 归一化到 `topics/x.md` 并写 type
   - `delete` 只允许 `topics/*.md`，移入回收站
4. **设置页**：soul/MEMORY 编辑器、主题增删改、自动化、备份管理、回收站、全部参数

## 模块

| 文件 | 职责 |
|---|---|
| `index.js` | 插件入口：system prompt 段、`memory` 工具、`/memory` 命令 |
| `admin.js` | 设置文件、会话 capture、Web 路由、定时器、状态汇总 |
| `jobs.js` | 提炼（inbox → MEMORY/topics）与压缩去重任务 |
| `model.js` | 模型目录、路由校验、重试/上下文/system 降级、错误翻译 |
| `storage.js` | 备份、回收站、inbox 归档、目录初始化与保留期清理 |
| `core.js` | 常量、配置归一化、frontmatter、路径白名单、文件遍历/缓存 |
| `client.js` | Web 设置页（概览/核心/主题/自动化/回收站） |

## 不变式

- 注入内容 ≤4KB + 人格 ≤4KB；索引再长也不会挤爆上下文（按 UTF-8 字节截断）
- `inbox/`、`backups/`、`.trash/` 不参与注入、检索、压缩
- 任何 Web/工具写入都经过路径白名单：只允许 `soul.md`、`MEMORY.md`、`topics/*.md`；禁止 `inbox/`、`backups/`、`.trash/`、`..`
- 主题文件只有一个目录：旧版 `people/` 等分型目录会在启动时自动迁移进 `topics/`（type 写进 frontmatter），空目录删除
- 分类按 `frontmatter.type` 过滤，不是物理目录
- 提炼失败不归档原文，下次重试；归档同名不覆盖
- 大文件提炼只归档已处理前缀对应的原文，剩余部分回写 inbox，不丢内容
- 压缩/去重前默认自动备份；删除一律进回收站；恢复绝不覆盖同名文件
- 记忆是文件，不是数据库：可以直接用编辑器改、用 git 管、用 `grep` 查
