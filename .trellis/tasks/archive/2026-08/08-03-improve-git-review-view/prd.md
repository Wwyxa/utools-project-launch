# Improve Git Review View

## Goal

使 Git 审阅 Diff 达到专业工具级的可读性：在保留语法高亮的前提下标示字符级变更，提供真正的双窗格对照，以及完整文件和空白差异过滤能力。

## Confirmed Facts

- 当前 [GitDiffViewer.vue](../../../src/components/project/GitDiffViewer.vue) 将双栏内容渲染为同一滚动容器内的四列网格，无法让左右代码各自横向滚动；它也只对整行进行语法高亮和新增/删除底色处理。
- 当前 [gitDiff.ts](../../../src/lib/gitDiff.ts) 能正确提供行号和跨 hunk 的行对齐，但尚未为匹配的删除/新增行生成字符级范围。
- 当前 [ProjectGitFileDiffOptions](../../../src/types.ts) 仅支持工作区 `scope`；[GitTab.vue](../../../src/components/project/GitTab.vue)、Store、ProjectBridge 和 [preload.js](../../../public/preload.js) 尚未传递完整文件或忽略空白的读取参数，提交 diff 也没有可选参数。
- SourceGit 的 [Diff.cs](../../../references/sourcegit/src/Commands/Diff.cs) 以 `--unified=<n>` 读取完整上下文，并在空白过滤时使用 `--ignore-space-change --ignore-blank-lines`；其 [DiffContext.cs](../../../references/sourcegit/src/ViewModels/DiffContext.cs) 以 `999999999` 作为完整文本上下文值。本地 Git 临时仓库已验证该值能显示两处变更之间的全部上下文。
- SourceGit 的 [TextInlineChange.cs](../../../references/sourcegit/src/Models/TextInlineChange.cs) 只为可靠的成对替换行生成内联范围，并对过长行和过多片段保守跳过；[TextDiffView.axaml](../../../references/sourcegit/src/Views/TextDiffView.axaml) 使用两个独立呈现器，双栏时不启用换行以维持垂直对齐。

## Requirements

- R1：审阅标题栏左侧持续显示文件路径、当前分支和范围/提交说明；右侧集中放置功能图标。
- R2：以一个图标按钮在 unified 和 side-by-side 之间切换，默认 unified；当前图标、提示和 `aria-pressed` 必须反映可切换目标和状态，不能再显示两个布局按钮。
- R3：side-by-side 使用两个独立的代码滚动窗格：各自可横向滚动，垂直滚动位置和 hunk 导航保持同步；两边用相同行高和空白占位对齐，双栏时关闭长行换行以保证该契约。
- R4：对可靠配对的删除/新增行标示字符级（或词块级）内联变更范围；语法高亮、HTML 转义和行级新增/删除底色必须继续正确显示。
- R5：增加“显示完整文件”切换：对工作区、提交和 stash 文件 diff 以完整上下文重新读取，未改变行也必须出现；此状态只保留在当前 Git Tab 生命周期内。
- R6：增加“忽略空白符变化”切换：采用 SourceGit 等价的 `--ignore-space-change --ignore-blank-lines` 语义，并对工作区、提交和 stash 文件 diff 重新读取。
- R7：普通行号在浅色和深色主题中保持清晰对比，新增和删除行号仍使用语义色。
- R8：保留加载、空/二进制 diff、文件标题、hunk 导航、统一视图换行、语法高亮、外部滚动位置和现有请求代际保护。
- R9：在审阅标题栏右侧提供“放大查看”图标按钮；点击后在覆盖大部分插件窗口的弹窗中显示同一份 Diff，再次点击、按 Escape 或点击遮罩可返回内嵌审阅视图。

## Acceptance Criteria

- [ ] AC1：标题栏左侧显示路径、分支和范围/提交说明；右侧只显示一枚布局切换按钮，以及 hunk、换行、完整文件和空白过滤控制。
- [ ] AC2：布局控制默认 unified，单次点击切换为 side-by-side，再次点击恢复 unified；图标、提示、可访问名称和 pressed 状态正确。
- [ ] AC3：双栏的旧版和新版分别在独立滚动窗格中显示；左右 `scrollLeft` 互不影响，任一侧的垂直滚动与 hunk 跳转会同步另一侧。
- [ ] AC4：替换行中的实际变更字符/词块有比整行底色更强的内联高亮，且不会破坏代码语法颜色或 HTML 转义；无法可靠配对、过长或片段过多的行安全退化为行级高亮。
- [ ] AC5：启用“完整文件”后，两处变更间的未改动内容会显示；启用“忽略空白符变化”后，仅空格数量或空白行造成的 diff 消失，同时非空白修改仍保留。
- [ ] AC6：完整文件和空白过滤在工作区、普通提交和 stash 的文件 diff 读取路径均生效；快速切换或选择其他文件不会显示陈旧响应。
- [ ] AC7：浅/深色普通行号清晰可读，新增/删除行号继续使用语义色；加载、空/二进制 diff、统一视图换行、hunk 导航和滚动同步不回归。
- [ ] AC8：选中文件时可从标题栏打开约 `96vw × 92vh` 的大尺寸 Diff 弹窗；弹窗复用同一查看器实例，不重新读取 Diff，保留当前滚动位置与工具状态，并可通过按钮、Escape 和遮罩关闭。

## Out of Scope

- 不新增 hunk 暂存、撤销、外部合并工具、隐藏符号、minimap、图像 diff 或新的 Git 写操作。
- 不将布局、完整文件或空白过滤状态写入全局 UI 偏好或跨应用重启保存。
- 不新增独立原生 uTools 窗口、浏览器弹出窗口或跨插件进程的 Diff 查看器。

## Notes

- 完整文件/空白过滤读取契约和大尺寸审阅弹窗均改变了已批准方案，因此本轮需要新的设计审批后才能恢复实现。
