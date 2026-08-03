# Git 审阅视图设计

## 目标边界

本次在保留现有 Git 选择、提交历史和写操作边界的前提下，扩展 Diff 的读取选项和展示层。布局、完整文件和空白过滤均为 Git Tab 本地/渲染器会话状态，不进入 Pinia、`UiPreferences`、`localStorage` 或 preload 持久化。

## 组件职责

| 位置                                                                     | 职责                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                                                           | 扩展现有 `ProjectGitFileDiffOptions`，使工作区和提交 diff 共用 `fullFile`、`ignoreWhitespace` 和 scope 契约。                                                           |
| `src/components/project/GitTab.vue`                                      | 拥有已选文件、读取选项、请求代际和大尺寸 Diff 弹窗开关；将选项传给工作区/提交读取入口、在查看器切换读取选项后重载当前选择，并通过已有 Escape/仓库清理生命周期关闭弹窗。 |
| `src/components/project/GitDiffViewer.vue`                               | 渲染标题工具栏；以一个按钮切换布局；向父组件发出读取选项和放大/还原意图；分别渲染 unified 和两个同步的 side-by-side 窗格。                                              |
| `src/lib/gitDiff.ts`                                                     | 保持原始解析和行号语义；投影左右行；为可靠的替换行计算受限内联范围，并将其安全包入已有语法高亮 HTML。                                                                   |
| `src/store/useStore.ts`、`src/lib/projectBridge.ts`、`public/preload.js` | 将读取选项透传至所有 Diff 命令，并在真实 Git 进程边界标准化为受允许的命令参数。                                                                                         |
| `src/lib/gitDiff.test.ts`、`scripts/validate-git-diff.mjs`               | 覆盖内联范围/HTML 保留、窗格行对齐，以及工作区和提交的完整文件/空白过滤命令行为。                                                                                       |
| `src/index.css`                                                          | 保留可读行号，并定义显式的浅色/深色内联新增、删除高亮 token。                                                                                                           |

## 数据与布局

`GitTab` 保留一个本地 `ProjectGitFileDiffOptions` 值。查看器切换完整文件或空白过滤时只发出新的选项；父组件增加请求代际并以同一选项重新读取当前工作区或提交文件。原有代际校验继续丢弃文件、范围、提交或仓库已变化时的结果。

当用户请求放大时，`GitTab` 使用 Vue 的动态 `Teleport` 将当前的 `GitDiffViewer` 容器从右侧面板移动到 `body`，而不是额外创建第二个查看器。内嵌状态时 Teleport 禁用；放大状态时容器成为带遮罩的 `role="dialog"`，内层审阅框使用 `w-[min(96vw,96rem)]` 与 `h-[min(92vh,72rem)]`。同一组件实例因此保留当前内容、滚动位置、布局、换行及工具状态，也不会触发新的 Git 读取。点击遮罩、查看器的还原按钮、已有应用 Escape 请求或仓库上下文清理都会关闭弹窗。

`public/preload.js` 在工作区、提交和 stash 的 Diff 命令中标准化两个布尔选项。`fullFile` 追加 `--unified=999999999`；`ignoreWhitespace` 追加 `--ignore-space-change --ignore-blank-lines`，与 SourceGit 对齐。未跟踪文件已经完整生成内容，不需要额外的文件读取路径。

`parseGitDiff` 仍输出原始行。`toGitDiffSideBySideRows` 以 hunk 为边界把连续的删除/新增块填充到相同视觉索引。对于可一对一配对、长度受限且片段数量受限的替换行，新的纯函数输出旧/新内联范围；其它行只保持现有整行语义色。另一纯渲染函数只在 highlight.js 输出的文本节点中插入 `<mark>`，遇到标签时关闭再重开标记，从而不破坏 token 标签或 HTML 转义。

统一视图仍使用一个滚动容器。双栏视图改为旧版和新版两个 `overflow-auto` 窗格，二者各自持有 `scrollLeft`，事件处理器只同步 `scrollTop`。hunk 定位从旧侧作为主视口计算并同步到新版。双栏固定 `white-space: pre`，让对齐行始终拥有同样高度；统一视图继续保留长行换行。

## 视觉与可访问性

- 标题栏保持现有紧凑边框和表面色；左侧内容可截断并使用 `title` 暴露完整文本。
- 所有操作继续使用 Lucide 图标按钮，包含 `title`、`aria-label`；布局为单一 toggle，完整文件和空白过滤为 pressed toggle，放大按钮在弹窗中变为还原按钮。
- 内联 `<mark>` 使用明确的浅色/深色语义 token，叠加在现有新增/删除行底色上；普通上下文行号继续使用显式主题变量。
- hunk 计数和上下导航留在标题栏，布局、完整文件、空白过滤和换行控制在加载中禁用，避免并发请求与状态误导。

## 兼容性与风险

非文本、加载、空 diff、hunk 定位、语法高亮和外部统一滚动位置均保留。内联算法的风险是长行或不等数量变更被错误关联，因此与 SourceGit 一样按行长度、匹配数量和片段数保守退化。双栏的风险是同步滚动反馈循环或行高漂移；只同步垂直轴、在双栏禁用换行，并以相同视觉行数组驱动两侧渲染。弹窗的风险是 Teleport 生命周期或遮罩与现有 Git 对话框冲突；它复用现有 `scale` transition、Escape 分派和 z-index 模式，并在仓库状态清理时显式关闭。

回退可以独立撤回读取选项或双窗格/内联渲染；持久化数据、Git 写操作和文件选择状态均不受影响。
