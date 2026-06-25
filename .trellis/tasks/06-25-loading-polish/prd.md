# 加载与质感：骨架屏与微动效

> 父任务：[06-25-ui-polish](../06-25-ui-polish/prd.md)

## Goal

消除加载场景的"纯文本空白"廉价感，统一加载态呈现，并为模态/面板进场补齐过渡，提升整体质感。

## Requirements

### 1. 抽可复用骨架屏

- 将 [EnvironmentTab.vue](src/components/environment/EnvironmentTab.vue) 既有的骨架屏实现（`animate-pulse` 占位条 + `aria-busy`）提炼为可复用的 CSS 类或轻量组件，供其它加载场景复用。

### 2. 补加载态

- FilesTab：文件树加载、文件内容加载由纯文本 `Loading...` 升级为骨架屏（树用骨架行、文件用骨架代码块）。
- GitTab：diff 读取、提交详情文件列表读取由纯文本升级为骨架或统一加载指示（复用既有全局 loading toast 风格亦可，保持一致）。

### 3. 进场过渡

- 为 GitTab 模态框（AI 对话框 / diff / 提交详情 / 确认框）及各组件面板折叠补进场过渡，消除硬切。
- 在 [index.css](src/index.css) 新增所需命名过渡类（如 `scale` / `slide-fade`），与现有 `fade` / `slide-up` 风格统一。

### 4. 运行态脉动统一

- ScriptsTab 运行中脚本徽标补脉动效果，与 [Terminal.vue](src/components/terminal/Terminal.vue) 运行中状态点的 `animate-pulse` 风格一致，让"运行中"状态在卡片层也"活着"。

## Constraints

- 不引入新依赖。
- 性能：骨架/过渡不得引入明显卡顿；避免大面积 `TransitionGroup` 导致的重绘开销。
- 双主题成立，只用语义 token。
- 不破坏功能：文件加载、diff 读取、Git 刷新、模态交互、脚本启停。
- 复用 EnvironmentTab 既有实现，不另造骨架方案。

## Acceptance Criteria

- [ ] 文件树/文件内容加载时显示骨架屏而非纯文本 `Loading...`。
- [ ] GitTab diff/提交详情加载有统一加载指示，无纯文本空白。
- [ ] GitTab 各模态框进场有淡入/缩放过渡，无硬切。
- [ ] 面板折叠/展开有过渡。
- [ ] ScriptsTab 运行中脚本徽标有脉动，与 Terminal 状态点风格一致。
- [ ] 加载态在浅色/深色下均正常，带 `aria-busy`。
- [ ] 现有功能回归通过，无明显性能退化。
- [ ] `npm run lint` 通过。

## Out of Scope

- 视觉层次/卡片头规范/国际化/token 统一 → 子任务2。
- 首页观感 → 子任务1。
- 本任务 design.md / implement.md 在 start 前补齐（含骨架组件设计、过渡类清单、各加载点改造清单）。
