# 加载与质感 · 执行计划（implement.md）

> 依赖：[prd.md](./prd.md) · [design.md](./design.md)。前置：本子任务 status=`in_progress`（`task.py start`）；本计划在 review gate 通过后执行。

## 前置基线

- 确认 `git status --short` 仅余本任务新增/改动文件；起手 `npm run lint` + `npm run build` 双绿（与归档 visual-hierarchy 后基线一致：master clean，HEAD=archive 提交）。
- 改 `FilesTab.vue` / `GitTab.vue` 时**沿用子任务2 既定规范**：`.ui-panel-header/.ui-panel-title/.ui-panel-meta`、GitTab padding 三桶、Terminal 无 `dark:`（勿引入）、FilesTab 已走 `t.value.files.*`。本任务不回退这些规范。
- 同文件多编辑一律用 `multi_replace_string_in_file` **顺序**应用，**严禁对同一文件并行多个 replace_string**（FilesTab 本会话曾因此损坏模板）。

## Review Gate（执行前必须解决）

- **Gate A（design §1.2）骨架屏抽象形态**：A1 全局 `.skeleton` CSS 类（推荐）／A2 轻量组件 ／A3 两者？默认 A1。
- **Gate B（design §2.3）进场过渡范围**：B1 仅 GitTab 四模态（PRD 字面）／B2 GitTab 四模态 + ProjectFormModal + App 删除确认（默认建议）？
- **面板折叠半面板内容切替（design §2.3 可选项）**：默认先不做 key 模态切换（仅浮钮 fade 满足最低要求），待手动回归确认 resize 稳定后再决定是否加。
- 三项确认后方可 `task.py start`；若用户未明确，按默认推进并在 PR 描述标注假设。

## 执行步骤

### S1 · 过渡与骨架基础设施（CSS 增量，1 文件）
- 文件：`src/index.css`（接现有 `/* Vue transition: fade */` / `slide-up` 段附近）。
- 新增 `.skeleton` 基类（design §1.2）：`@apply animate-pulse rounded bg-surface-container-high;`
- 新增 `.scale-enter-active/.scale-leave-active`（opacity 0.18s + transform 0.18s）、`.scale-enter-from/.scale-leave-to`（opacity:0; transform: scale(.96)）（design §2.2）。
- 验证：`npm run build`（确认 `@apply` 解析、Tailwind v4 不报未知工具类）。
- 回退点：删除新增两段 CSS 即回退。

### S2 · EnvironmentTab 骨架收敛为 `.skeleton`（验证可复用性）
- 文件：`src/components/environment/EnvironmentTab.vue`。
- 将 L137/L141/L145 三条 `h-3 w-XX animate-pulse rounded bg-surface-container-high` 改写为 `.skeleton h-3 w-XX`（形态/宽度/aria-busy/showInitialSkeleton 全不变，唯一变化是共用类）。
- 验证：`npm run lint` + `npm run build`；手动进环境页骨架视觉与基线一致。
- 回退点：`git checkout -- src/components/environment/EnvironmentTab.vue`。

### S3 · FilesTab 加载态骨架（树 / 文件内容 / 子目录）
- 文件：`src/components/project/FilesTab.vue` + `src/components/project/FileTreeNode.vue`。**同文件多编辑用 multi_replace 顺序应用。**
- L649 树加载：`isLoadingTree` 时以 8 行骨架（错落缩进 `ml-3/6/9` + `.skeleton h-3 w-20/24/28`）取代纯文本 `<div>{{ t.files.loading }}</div>`；外层 `div.themed-scrollbar` 容器加 `:aria-busy="isLoadingTree"`。
- L837 文件内容加载：`isLoadingFile` 时以 ~12 行骨架代码行（`grid-cols-[3rem_1fr]` gutter `.skeleton h-2.5 w-6` + 内容 `.skeleton h-2.5 w-72/96/64`，`font-mono text-xs leading-5`）取代纯文本；骨架容器 `:aria-busy="isLoadingFile"`。
- FileTreeNode L112：`<span v-if="node.loading">...</span>` → 右对齐 `<span v-if="node.loading" class="ml-auto shrink-0 .skeleton h-2.5 w-10" />`（小骨架条）。
- 验证：`npm run lint` + `npm run build`；手动过大目录/大文件加载时见骨架而非 `Loading...`；浅深双主题观感一致。
- 回退点：两文件分别 `git checkout`。

### S4 · GitTab 加载态骨架（diff / 提交文件列表）
- 文件：`src/components/project/GitTab.vue`。**同文件多编辑用 multi_replace 顺序应用。**
- L2720 diff 加载：`isLoadingDiff` 时在 diff 滚动体内以 ~10 行骨架 diff（每行 `grid-cols-[3.25rem_minmax(0,1fr)]` gutter `.skeleton h-3 w-8` + 内容 `.skeleton h-3 w-full` 错落）取代 `<div>{{ t.git.diffLoading }}</div>`；滚动体加 `:aria-busy="isLoadingDiff"`。
- L2856 提交文件加载：`isLoadingCommitFiles` 时以 4–6 行骨架（药丸位 `.skeleton h-4 w-8` + 路径位 `.skeleton h-3 w-48/60`）取代硬编码 `<p>正在读取变更文件...</p>`；列表容器加 `aria-busy`。
- 验证：`npm run lint` + `npm run build`；手动开 diff/提交详情读取消时见骨架，无纯文本、无硬编码中文。
- 回退点：`git checkout -- src/components/project/GitTab.vue`。

### S5 · i18n 孤儿 key 清理
- 文件：`src/lib/i18n.ts`（两 locale）。
- 删除 `files.loading`（zh `files` 块 + en `files` 块各 1）、`git.diffLoading`（zh `git` 块 + en `git` 块各 1）。须两 locale 同步删、保 key 对齐（`as const` 强签不查死 key）。
- 验证：`npm run lint`（少 key / 多 key 触发 tsc 类型不对齐报错，是强校验）+ `npm run build`；`grep -n "files\.loading\|git\.diffLoading" src/components src/lib` 应空。
- 回退点：`git checkout -- src/lib/i18n.ts`。

### S6 · GitTab 模态进场过渡（必做）+ 浮钮 fade
- 文件：`src/components/project/GitTab.vue`。**同文件多编辑用 multi_replace 顺序应用。**
- 四模态根外包 `<Transition name="scale">`：AI 对话框（`v-if="isAiDialogOpen"`，~L2585）、diff（`v-if="isDiffDialogOpen"`，~L2693）、提交详情（`v-if="isCommitDetailOpen && selectedCommit"`，~L2746）、确认框（`<Teleport to="body">` 内的 `v-if="confirmationDialog"`，L2967）按 design §2.3 包法。
- 浮动折叠控钮 `v-if="!collapsedGitPanel"`（~L1961）包 `<Transition name="fade">`（低风险）。
- **面板切换**半面板内容 key 切换默认暂不做（待手动回归判定 resize 稳定）。
- 验证：`npm run lint` + `npm run build`；手动开/关四模态见 scale+淡入淡出、无硬切；确认框通过 Esc/背景点击/按钮关闭仍正常。
- 回退点：`git checkout -- src/components/project/GitTab.vue`。

### S7 ·（依赖 Gate B=②）ProjectFormModal / App 删除确认进场过渡
- 文件（仅当 Gate B 选 ②）：`src/components/project/ProjectFormModal.vue`、`src/App.vue`。
- ProjectFormModal：`<Teleport to="body">` 内 `v-if="store.projectFormOpen"` 根 `<div>` 外包 `<Transition name="scale">`。
- App.vue：`<Teleport to="body">` 内 `v-if="store.pendingDeleteProject"` 根 `<div>` 外包 `<Transition name="scale">`。**不动** App.vue scoped `.fade`（Tab 切换段）。
- 验证：`npm run lint` + `npm run build`；手动新建/编辑项目表单与删除确认弹窗进场有 scale 过渡、关闭正常。
- 回退点：两文件分别 `git checkout`。
- 若 Gate B=①，跳过本步。

### S8 · ScriptsTab 运行脉动 + 浮钮 fade
- 文件：`src/components/project/ScriptsTab.vue`。
- L121–128 RUNNING 药丸前置态点：`<span v-if="script.status==='RUNNING'" class="mr-1 h-1.5 w-1.5 rounded-full bg-status-running animate-pulse shadow-[0_0_8px_rgba(46,175,125,0.9)]" />`（与 Terminal 态点同款）；其余状态药丸不变。
- 浮钮 `v-if="showScriptsCollapseControls"`（L171）包 `<Transition name="fade">`。
- 验证：`npm run lint` + `npm run build`；手动启动脚本 → 切详情脚本行 RUNNING 药丸态点呼吸（与终端态点同色同 glow）；停/错态不呼吸；折叠浮钮进场无硬切。
- 回退点：`git checkout -- src/components/project/ScriptsTab.vue`。

### S9 · 全量验收
- `npm run lint` + `npm run build` 双绿。
- `grep -rn "Loading\.\.\.\|正在读取变更文件" src/components` 应空（无可见 `Loading...` 文本、无硬编码中文加载文本）。
- `grep -rn "files\.loading\|git\.diffLoading" src/` 应空。
- `grep -rn "dark:" src/components/terminal/Terminal.vue` 仍空（确认未回退）；全仓 `grep -rn "bg-surface-container-high.*animate-pulse" src/components/environment` 应空（已收敛 `.skeleton`）。
- 手动回归矩阵：详情页 FilesTab（开大目录/大文件加载→骨架、查找/替换/保存/Ctrl+S·F·H/Esc）、GitTab（分支切换/提交/diff 读→骨架/历史筛选/提交详情文件列表读→骨架/四模态开关心 scale）、ScriptsTab（启停脚本→RUNNING 草型呼吸/折叠浮钮淡入）、ProjectFormModal（仅 B=②，新建/编辑表单 scale）、删除确认（仅 B=②，scale）、EnvironmentTab 骨架回归形态不变；**浅色/深色双主题**逐弹层逐加载点比对；en-US/zh-CN 双 locale。（不触碰首页顶部统计）
- 通过即进入 finish 阶段。

## 校验阶段（3.x）

- 3.3 spec update：向 `/memories/repo/utools-project-launch.md` 沉淀「`.skeleton` 骨架基类（animate-pulse+surface-container-high，宽高 per-spot 叠加，替代 `Loading...` 纯文本，aria-busy）」「`.scale-*` 模态进场过渡（180ms，遮罩 fade + 面板 0.96 缩放，包 v-if 根；Teleport 内 Transition 包 v-if 合法）」「ScriptsTab RUNNING 药丸态点与 Terminal/ProjectCard 同款」「加载纯文本改骨架后须删 `files.loading`/`git.diffLoading` 两 locale 孤儿 key」「同文件多编辑用 multi_replace 顺序，勿并行」。
- 3.4 commit：分逻辑提交（建议 `index.css` 基础设施 / EnvironmentTab 骨架收敛 / FilesTab+FileTreeNode 骨架 / GitTab 骨架 / GitTab 过渡 /（B=②）ProjectFormModal+App 过渡 / ScriptsTab 脉动 / i18n 清理 各一），保持可回退粒度；commit message 引父任务 `06-25-ui-polish`。
- 归档为 done，父任务进度 → 3/3；本父任务 `06-25-ui-polish` 三件套完成。