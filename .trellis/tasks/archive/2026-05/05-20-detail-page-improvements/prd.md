# 详情页功能改进

## Goal

改进项目详情页的文件查看/轻量编辑、Git 历史图谱和项目备忘体验，让开发者能在 uTools 插件内快速确认项目配置、查看分支历史、随手记录项目专属事项，同时保持插件轻量、响应快、不引入重量级编辑器或 Git 客户端能力。

## What I already know

- 现有详情页位于 `src/components/project/ProjectDetails.vue`，Tab 包含概览、脚本、Git、备忘。
- Git 面板位于 `src/components/project/GitTab.vue`，当前展示变更文件和提交列表，已有只读刷新能力。
- 备忘面板位于 `src/components/project/MemoTab.vue`，当前是左右分栏：Markdown textarea + 渲染预览 + Todo 列表。
- 状态管理集中在 `src/store/useStore.ts`，项目数据持久化经过 `public/preload.js` 的 `window.projectBridge`。
- uTools 文档说明 `preload.js` 可使用 Node.js 原生模块，且应保持 CommonJS、清晰可读、不打包压缩；现有项目已经通过 `preload.js` 暴露本地文件、Git、终端等能力。
- 当前依赖只有 Vue、Pinia、lucide、vue-markdown-render 等轻量包；本任务不应引入 Monaco/CodeMirror 等重量编辑器。
- 当前 Git 快照在 `public/preload.js` 中使用 `git log --all --graph --decorate=short --max-count=200`，需要降到默认 50-100 条范围。

## Assumptions

- 文件查看/编辑作为新的详情页 Tab 实现，避免把概览页变复杂。
- 文件树按需展开目录，每次只加载一层子项；不扫描 `node_modules`、`.git`、`.venv`、缓存目录等默认忽略目录。
- 文本文件编辑采用原生 `textarea` 或等价轻量实现，支持只读预览、手动保存、快捷键保存和未保存提示。
- 非文本文件不做复杂二进制解析；图片等轻量类型可以预览，其他类型显示不可预览提示。
- Git 只做状态与历史展示，不加入合并、变基、提交、推送等写操作。
- Todo 与 Markdown 备忘继续存储在项目数据结构内，不引入单独数据库模型，除非实现时发现现有模型无法满足排序/自动保存。

## Requirements

### File Viewer / Light Editor

- 在项目详情页增加文件查看与编辑入口。
- 左侧文件树与右侧预览/编辑区采用约 `2.5:7.5` 或 `3:7` 的布局比例。
- 左侧文件树宽度可拖拽微调，并设置最小宽度，避免内容重叠。
- 文件树默认只展开项目根目录第一层。
- 点击目录时按需加载该目录下一层内容，不递归预扫全项目。
- 默认隐藏大目录和缓存目录，至少包含 `node_modules`、`.git`、`.venv`，并补充常见缓存/构建目录。
- 单击文件只预览，不锁定编辑状态；双击文本文件进入编辑状态。
- 右侧默认只读，可点击按钮进入编辑模式。
- 顶部信息栏显示当前文件相对路径和保存状态；未保存要有明显标记。
- 提供保存按钮，并支持 Ctrl/Cmd + S 保存。
- 未编辑时右侧区域要有轻微只读视觉暗示。
- 文件能力通过 `preload.js` 使用 Node.js `fs/path` 暴露，前端通过 `ProjectBridge` 调用。

### Git Tree View

- Git 历史列表使用紧凑高密度排版，commit 行高控制在 24px-28px。
- 每条 commit 单行显示：图谱节点、commit 信息、标签/分支名、作者、相对时间。
- 超长 commit 信息、标签、作者需要截断，不撑开布局。
- 使用固定高对比度分支线/节点颜色，当前 HEAD 节点突出显示。
- 默认只拉取前 50-100 条 commit，避免全量历史导致插件卡顿。
- Git 面板继续保持只读，不提供复杂 Git 操作。

### Memo Improvements

- 备忘分为默认展示态和编辑态。
- 默认展示态隐藏 Markdown 工具栏和输入框，直接渲染干净排版。
- 点击右上角编辑图标或双击空白处进入编辑态。
- 退出编辑态或切换 Tab 时静默自动保存，不弹窗。
- 上层为独立 Todo List，下层为普通 Markdown 文本，两者视觉和结构上隔离。
- 展示态下 Todo checkbox 仍可交互，勾选后自动加删除线并下移。
- Todo 区提供常驻的“添加任务”输入框，不使用 prompt 弹窗。
- Markdown 编辑工具栏仅保留加粗、代码块、列表、链接等基础操作。

## Acceptance Criteria

- [ ] 用户可在详情页打开文件查看/编辑视图，浏览项目根目录第一层，默认忽略大型目录。
- [ ] 单击文件预览、双击文本文件进入编辑；未保存状态和保存按钮可见，Ctrl/Cmd + S 生效。
- [ ] 非文本文件不会误以文本方式打开；可轻量预览的类型正常预览，其他类型显示不可预览提示。
- [ ] Git 历史一屏可显示 10-15 条以上提交，行高在 24px-28px，所有字段单行截断。
- [ ] Git 读取默认限制在 50-100 条 commit。
- [ ] 备忘默认展示态无编辑工具栏；进入编辑态后可修改 Markdown，退出编辑态或切换 Tab 自动保存。
- [ ] Todo 在展示态可勾选，完成项下移并删除线显示；添加任务不再使用 prompt。
- [ ] `npm run lint` 和 `npm run build` 通过。

## Definition of Done

- Tests or manual verification cover file tree, save shortcut, Git compact layout, memo read/edit switching, Todo interaction.
- Lint/typecheck/build pass.
- uTools preload constraints保持：CommonJS、可读、不引入重型本地依赖。
- 规格文档如产生新约定则更新。

## Out of Scope

- 不实现完整 IDE 编辑器、语法高亮、搜索替换、多文件 Tab 管理、diff 编辑。
- 不实现 Git 合并、变基、提交、推送、拉取等写操作。
- 不递归全量扫描项目文件树。
- 不引入 Monaco、CodeMirror、git graph 重型可视化库。

## Technical Notes

- uTools docs: `preload.js` can call Node.js APIs and expose custom `window` properties to the frontend; it must remain readable CommonJS and not be bundled/minified.
- Relevant files: `src/components/project/ProjectDetails.vue`, `src/components/project/GitTab.vue`, `src/components/project/MemoTab.vue`, `src/store/useStore.ts`, `src/lib/projectBridge.ts`, `src/types.ts`, `public/preload.js`.
- Existing dependency policy favors light implementation with current Vue/Pinia/lucide/vue-markdown-render stack.
