# 执行计划：首页观感

> 任务：[06-25-dashboard-first-impression](./prd.md) · 设计：[design.md](./design.md)

> **范围调整（2026-06-25）**：步骤 3「Dashboard 概览统计带」已按用户反馈移除，不再执行。下方步骤 3 标记 `[已移除]`。实际执行步骤：1 → 2（仅空状态相关 key）→ 4 → 5 → 6。

## 前置 Review Gate

实施前需用户确认（design.md 已列）：

1. 概览带指标集：项目总数 / 运行中 / 需关注 / 最近活动（4 项）。
2. 卡片字号调整建议值（design 方案 C 表格）。
3. 空状态采用"图标 + 标题 + 副标题 + 添加主操作 + 导入次操作"结构。

确认通过后执行 `task.py start 06-25-dashboard-first-impression` 进入 in_progress。

## 执行步骤

### 步骤 1：提取时间工具（无副作用重构先行）

- 新建 `src/lib/time.ts`，导出 `formatRelativeTime` / `formatAbsoluteTime`，逻辑搬自 [ProjectCard.vue:221-282](src/components/dashboard/ProjectCard.vue#L221-L282)。
- [ProjectCard.vue](src/components/dashboard/ProjectCard.vue) 删除局部定义，改为 `import { formatRelativeTime, formatAbsoluteTime } from "../../lib/time"`。
- 不改任何调用点签名与文案。

**验证**：`npm run lint` 通过；手动确认卡片时间戳显示与之前一致。

**回滚点 R1**：此步独立，可单独 revert。

### 步骤 2：i18n 新增 key

- 在 [src/lib/i18n.ts](src/lib/i18n.ts) 的 `zh-CN.dashboard` 与 `en-US.dashboard` 两块中，按 design 表格新增 7 个 key（`overviewTotal`/`overviewRunning`/`overviewIssues`/`overviewRecent`/`emptyTitle`/`emptySubtitle`/`emptyImport`）。
- 两 locale key 必须完全对齐。

**验证**：`npm run lint` 通过（`as const` 缺 key 会报类型错误）。

### 步骤 3：Dashboard 概览统计带 `[已移除 · 按反馈回退，跳过]`

- [Dashboard.vue](src/components/dashboard/Dashboard.vue) `<script>` 新增 `ProjectStatus` 导入与 4 个 computed（total/running/issues/recentActivityAt）及 `hasProjects`。
- `<template>` 在工具栏后、`projectStorageMessage` 前插入概览带 `<section>`（design 方案 A）。
- 样式优先 Tailwind 工具类；必要时在 [index.css](src/index.css) 补 `.overview-card` 等。

**验证**：`npm run dev` 打开首页，确认指标显示；启动/停止一个脚本，"运行中"实时 ±1；项目为 0 时不显示概览带。

### 步骤 4：Dashboard 空状态重做

- 替换 [Dashboard.vue:287-298](src/components/dashboard/Dashboard.vue#L287-L298) 空状态块为 design 方案 B 结构。
- 主操作 `store.openCreateProjectForm`，次操作 `store.importProjectConfig`。
- 导入 `PackageOpen` / `Plus` / `Download` 图标。

**验证**：清空项目（或新环境）确认空状态显示图标+标题+副标题+两按钮；两按钮均可触发对应行为。

### 步骤 5：ProjectCard 层次优化

- 按 design 方案 C 表格调整 [ProjectCard.vue](src/components/dashboard/ProjectCard.vue) 字号/间距/路径权重。
- 不动网格尺寸、不动交互、不动脚本按钮测量逻辑。

**验证**：浅色/深色下卡片层次更清晰；描述/路径可读性提升；运行态/错误态色条与徽章正常。

### 步骤 6：整体验证与回归

- `npm run lint`。
- `npm run dev`，手动回归：
  - 首页：搜索、分组筛选、排序拖拽、刷新、卡片选择/编辑/删除、脚本启停。
  - 概览带指标随状态变化正确。
  - 空状态两按钮。
  - 浅色/深色切换无异常。
- 截图对比（可选）：首页总览、空状态。

## 验证命令

```bash
npm run lint          # tsc --noEmit，含 i18n key 对齐校验
npm run dev           # 手动回归
```

## Review Gate（实施中）

- 步骤 3 概览带完成后，若实际观感与预期出入大，回到 design 调整指标卡样式再继续。
- 步骤 5 卡片调整后，若拥挤感未缓解或换行异常，微调建议值。

## 完成判据

- prd 全部 Acceptance Criteria 勾选通过。
- `npm run lint` 通过。
- 手动回归无功能回归。
- 更新 spec（[.trellis/spec/frontend/index.md](.trellis/spec/frontend/index.md) 相关条目，若有）。
- 提交（commit message 遵循项目中文 conventional 风格，如 `feat(dashboard): 增加概览统计带与空状态引导`）。
