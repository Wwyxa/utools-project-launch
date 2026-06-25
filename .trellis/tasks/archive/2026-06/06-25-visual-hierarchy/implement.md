# 视觉层次细化 · 执行计划（implement.md）

> 依赖：[prd.md](./prd.md) · [design.md](./design.md)。前置：本子任务 status=`in_progress`（`task.py start`）；本计划在 review gate 通过后执行。

## 前置基线

- 确 `git status --short` 仅余本任务新增/改动文件；`npm run lint` + `npm run build` 起手绿（与归档子任务1后基线一致）。
- 执行顺序遵循父 PRD：先一致性（token/文案/层次）→ 后续加载态属子任务3。本任务内按「隔离机械改动 → 基础设施 → 逐文件落地 → 结构性改动」推进，每步独立可 lint/可回退。

## Review Gate（执行前必须解决）

- **Gate A（design §1.3）**：MemoTab 头是否统一为 `h-9/text-xs`，还是保留其 `h-10/text-sm` 高权重？默认统一。
- **Gate B（design §3.2 vs §3.3）**：ProjectDetails 概览采用「2 主卡 + 脚本药丸段 + 删冗余」（推荐）还是「保留 4 卡做主次弱化」（最小改动）？默认推荐方案。
- 二者确认后方可 `task.py start`；若用户未明确，按默认推进并在 PR 描述标注假设。

## 执行步骤

### S1 · Terminal token 统一（隔离机械，1 文件）
- 文件：`src/components/terminal/Terminal.vue`。
- 按 design §6.2 表逐处删除 `dark:` slate/emerald/hex 覆盖（根/头/分隔/tab×2/上·下·清按钮/搜索图标/搜索框/日志体bg/日志文/时间戳/空·ready/光标/输入条容器/输入框/发送按钮）。保留所有 base 语义类。
- 不改任何 `t.terminal.*`、不改交互逻辑。
- 验证：`npm run lint`、`npm run build`；`grep -n "dark:.*slate\|dark:bg-\[#" src/components/terminal/Terminal.vue` 应空。
- 回退点：`git checkout -- src/components/terminal/Terminal.vue`。

### S2 · 卡片头工具类基础设施（CSS 增量）
- 文件：`src/index.css`（底部，接现有 `.ui-field` 等附近）。
- 新增 `.ui-panel-header` / `.ui-panel-title` / `.ui-panel-meta`（见 design §1.2），用 `@apply`。
- 验证：`npm run build`（确认 `@apply` 类合法、无 Tailwind 解析错误）。
- 回退点：删除新增三段即可。

### S3 · 卡片头落地（4 Tab）
- 文件：`ScriptsTab.vue` / `GitTab.vue` / `FilesTab.vue` / `MemoTab.vue`。
- ScriptsTab：脚本列表面板 `grid` 之上加 `.ui-panel-header`，`TerminalSquare`(或现有图标) `size-14 text-primary` + `t.projectDetails.scripts` + `.ui-panel-meta` 计数 `scripts.length`。
- GitTab：改动文件面板头、图表面板头换 `.ui-panel-header` + `.ui-panel-title`（文案用现有 `t.git.files`/`t.git.history`，缺则补 key 于两 locale `git` 块）。
- FilesTab：aside 树头、section 路径栏换 `.ui-panel-header`（路径名仍叠 `font-mono`）。
- MemoTab：两面板头按 Gate A 结论处理（默认：换 `.ui-panel-header` + `.ui-panel-title`，降为 h-9/text-xs）。
- 验证：`npm run lint` + `npm run build`；手动切换详情页各 Tab 看头高度/字号/图标对齐一致。
- 回退点：逐文件 `git checkout`。

### S4 · GitTab 圆角/padding 收敛
- 文件：`GitTab.vue`。
- 按 design §2.2：面板头走 `.ui-panel-header`（与 S3 合并或紧跟）；正文 `p-3`；toast/横幅/tooltip `px-3 py-2`；行内按钮 `px-2.5 py-1.5`；药丸 `rounded-full px-2 py-0.5 text-[10px]`；小哈希盒保留 `p-2 rounded`。
- 复核设计表逐行号（L1872/1884/2244/2399/2420-2438/2833/2871/2878/2999/3038/3074）。
- 验证：`npm run lint` + `npm run build`；手动 Git 页改动/历史/diff/commit 不破交互。
- 回退点：`git checkout -- src/components/project/GitTab.vue`。

### S5 · ProjectDetails 概览重构（依赖 Gate B）
- 文件：`ProjectDetails.vue`。
- 默认（design §3.2）：删 `overviewMetrics` 4 卡 grid（及 `metricToneClass` 相关，若不再用）；新增 2 主卡行——最新 commit（短哈希 + message + `formatRelativeTime(commit.date)`，复用 `src/lib/time.ts`）与待办（`完成/总数` + `t.memo.taskList`）；保留 L363 脚本药丸段；删备忘字数卡与脚本数卡。
- 备选（§3.3，仅当用户选）：保留 4 卡但主次弱化。
- `time.ts` 以值 import 方式复用（若需 `formatRelativeTime` 仅函数，普通 import 即可，无 enum 风险）。
- 验证：`npm run lint`（删 computed 后无未用变量告警，`tsc` 通过）+ `npm run build`；手动概览 Tab 渲染正确、无溢出。
- 回退点：`git checkout -- src/components/project/ProjectDetails.vue`。

### S6 · SettingsTab 区块分层
- 文件：`SettingsTab.vue`。
- 统一 section 正文 `p-3.5`（消 `py-3`/`py-2.5` 二分）；AI section 头保留 `h3 text-sm font-semibold text-on-surface` + `text-primary` 图标，其余 section 标题降 `text-on-surface-variant` 形成两级层次；AI 就绪徽标对齐统一药丸 `rounded-full px-2 py-0.5`。
- 不改任何 store 字段/交互/事件绑定。
- 验证：`npm run lint` + `npm run build`；手动设置页各项可改可存、主题/语言/AI 配置回归。
- 回退点：`git checkout -- src/components/layout/SettingsTab.vue`。

### S7 · FilesTab 国际化
- 文件：`src/lib/i18n.ts`（两 locale `files` 块）+ `src/components/project/FilesTab.vue`。
- `i18n.ts`：zh-CN 在 `git` 块后、`memo` 块前插入 `files` 块（design §5.2 全 28 key）；en-US 对应位置同序同 key。务必两 locale 逐 key 对齐（`as const` 强类型，少 key 即 `tsc` 报错）。
- `FilesTab.vue`：导入 `useI18n` + `const t = useI18n();`；模板字面量/aria/title/占位符替换为 `t.value.files.*` 或 `t.common.*`；`matchStatusLabel` 的 "No results" → `t.value.files.noResults`；`statusMessage` 用 `t.value.files.savedAt.replace("{time}", …)`；`Preview unavailable.` → `t.value.files.previewUnavailable`。
- 验证：`npm run lint`（两 locale 对齐是强校验）+ `npm run build`；手动切 en-US/zh-CN 逐文案正确、查找/替换/保存/快捷键回归、aria 在屏幕阅读器视角合理。
- 回退点：`git checkout` 两文件。

### S8 · 全量验收
- `npm run lint` + `npm run build` 双绿。
- `grep -rn "dark:.*slate" src/components/` 应空（Terminal 之外本应无，确认未新增）。
- `grep -rn "'\(Find\|Replace\|Edit\|Done\|Saved\|Unsaved\|Read only\|Editing\|No results\|Loading\.\.\.\|No files\.\|No file selected\|Select a file to preview\.\|Preview unavailable\.\)'" src/components/project/FilesTab.vue` 应空（仅余被 `t.value.files.*` 取代的引用）。
- 手动回归矩阵：详情页 5 Tab；Git 分支切换/提交/diff/历史筛选；FilesTab 查找/替换/保存/Ctrl+S·F·H/Esc；Terminal 选 tab·过滤·发送·滚边界；Settings 各项；**浅色/深色双主题**逐屏比对 Terminal 与面板视觉一致、en-US/zh-CN 双 locale FilesTab 文案正确。
- 通过即进入 finish 阶段（spec 更新 + commit + 归档），父任务进度 → 2/3。

## 校验阶段（3.x）

- 3.3 spec update：把"卡片头工具类规范""GitTab padding 三桶""Terminal dark 覆盖删除=语义 token 双主题自洽""FilesTab i18n files 块 + savedAt {time} 组件侧插值"等沉淀至 `/memories/repo/utools-project-launch.md`。
- 3.4 commit：分逻辑提交（建议 Terminal / index.css+卡片头 / GitTab / ProjectDetails / SettingsTab / FilesTab-i18n 各一），保持可回退粒度；commit message 引父任务 `06-25-ui-polish`。
- 归档为 done。