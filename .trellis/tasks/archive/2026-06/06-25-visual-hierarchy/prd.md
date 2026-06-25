# 视觉层次细化：区块分层与强调色

> 父任务：[06-25-ui-polish](../06-25-ui-polish/prd.md)

## Goal

消除各功能页"一列一样的盒子"观感，建立跨组件统一的视觉层次规则，并修复两处高 ROI 一致性缺口（FilesTab 未国际化、Terminal 暗色硬编码）。

## Requirements

### 1. 统一卡片头规范

- 抽一套"卡片头"样式规范（header 高度、内边距、标题字号/字重、图标尺寸、右侧操作区对齐），覆盖详情页各 Tab（ScriptsTab / GitTab / FilesTab / MemoTab）当前各自为政的 header。
- ScriptsTab 列表补标题/计数头（现状无标题），与 MemoTab 的规范 header 对齐。
- 规范以 CSS 类或 Tailwind 组合固化，便于复用，避免散落硬编码。

### 2. 圆角与间距规则

- 明确圆角规则并清理混用：容器 `rounded-lg`、行内控件 `rounded`、徽标/药丸 `rounded-full`。
- 统一 GitTab 内三套并存的 padding 取值（现状 `px-3 py-2` / `px-2.5 py-2` / `px-3.5 py-3` 混用）至一致 token。

### 3. 详情页/设置页区块分层

- ProjectDetails overview：评估 4 个等大 metric 卡片（脚本数/待办数/备忘字数/最新 commit）的信息价值，精简低价值项或重排为主次结构，消除"为填满而填满"。
- SettingsTab：长列表 section 增加主次区分（如分组标题层次、关键 section 强调），避免一列同质盒子。

### 4. FilesTab 国际化（一致性修复）

- 将 [FilesTab.vue](src/components/project/FilesTab.vue) 所有英文硬编码可见文案改为 i18n：`Loading...`、`No files.`、`No file selected`、`Select a file to preview.`、`Preview unavailable.`、`Find`、`Replace`、`Edit`、`Done`、`Unsaved`、`Read only`、`Editing`、`No results`、`Saved` 等。
- 在 `i18n.ts` 的 `files` 块（若无则新增）补齐两 locale key。

### 5. Terminal 主题统一（一致性修复）

- 将 [Terminal.vue](src/components/terminal/Terminal.vue) 的 `dark:bg-[#0d1117]`、`dark:bg-[#111820]`、`dark:border-slate-700/80`、`dark:text-slate-300` 等 slate 硬编码替换为语义 token（`--color-surface-container-lowest` 等）。
- 消除全代码库唯一的"暗色特供"写法，使暗色主题与其他组件一致。

## Constraints

- 不引入新依赖。
- 不改 store/bridge 数据契约；仅 UI 层（样式类、i18n 文案、组件渲染）。
- 双主题成立，只用语义 token；本任务应**减少**而非增加 `dark:` 硬编码。
- i18n 两 locale key 对齐。
- 不破坏功能：Git 操作、文件浏览/编辑/查找替换、终端日志、设置项。

## Acceptance Criteria

- [ ] 详情页各 Tab 的卡片头呈现统一规范（高度/字号/图标一致），ScriptsTab 列表有标题。
- [ ] 圆角与 padding 在跨组件层面规则一致，无明显混用。
- [ ] ProjectDetails overview 不再是 4 个等大低价值卡片的同质排列。
- [ ] FilesTab 全程无英文硬编码可见文案（切换 en-US/zh-CN 均正确显示）。
- [ ] Terminal 暗色下无 slate 硬编码色值，与其它组件视觉一致。
- [ ] 现有功能（Git 操作、文件编辑、查找替换、终端、设置）回归通过。
- [ ] `npm run lint` 通过。

## Out of Scope

- 首页 ProjectCard 层次 → 子任务1。
- 加载态/骨架屏/进场过渡 → 子任务3。
- 本任务 design.md / implement.md 在 start 前补齐（含卡片头规范的具体取值、FilesTab 文案 key 清单、Terminal token 映射表）。
