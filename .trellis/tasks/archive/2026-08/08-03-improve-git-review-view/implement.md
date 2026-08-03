# Git 审阅视图实施计划

## 实施顺序

1. 先扩展 `ProjectGitFileDiffOptions`，再让 Store、ProjectBridge fallback 和 preload 工作区/提交/stash 命令完整转发、标准化 `fullFile` 与 `ignoreWhitespace`；为 `scripts/validate-git-diff.mjs` 增加工作区和提交的完整上下文/空白过滤断言。
2. 在 `src/lib/gitDiff.ts` 实现受限的替换行内联范围与保留 highlight.js HTML 结构的标记渲染；在 `src/lib/gitDiff.test.ts` 覆盖字符/词块范围、HTML 转义、过长/复杂行退化和 hunk 边界。
3. 调整 `GitTab.vue` 以维护读取选项、重载选中文件并继续使用请求代际保护；向查看器提供选项和变更事件。
4. 调整 `GitDiffViewer.vue`：用一个布局按钮取代两个按钮，添加完整文件/空白过滤切换，将双栏改为两个独立横向滚动、垂直同步的窗格，并让 hunk 导航使用主窗格。
5. 在 `GitTab.vue` 与 `GitDiffViewer.vue` 增加动态 Teleport 的大尺寸审阅弹窗：复用同一查看器实例，使用标题栏放大/还原按钮、遮罩点击和已有 Escape 路径关闭。
6. 在 `src/index.css` 定义显式内联新增/删除 token，复核普通行号 token；完成窄面板、深色主题、统一换行、双栏对齐和大尺寸弹窗的视觉检查。

## 验证

1. `npm run test:git-diff`
2. `npm run validate:git-diff`
3. `npm run type-check`
4. `npm run build`
5. 在真实 Git 仓库中检查：统一视图内联高亮、两侧横向独立和纵向同步、hunk 跳转、统一换行/双栏无换行、完整文件、空白过滤、工作区/提交/stash、无选择、加载、空/二进制 diff，以及浅色/深色和窄面板。
6. 在窄插件窗口中打开大尺寸审阅弹窗，确认它保留当前 scrollTop/工具状态、不重新触发 Diff 请求、按钮/Escape/遮罩均可关闭，且仓库或项目切换后不会残留遮罩。

## 风险点与回退

- Diff 读取选项必须在工作区、提交和 stash 命令中一致，且不得绕过路径验证或更改写操作。
- 内联标记绝不能直接在原始 HTML 中按字符串偏移替换；测试必须覆盖 syntax 标签和转义字符，避免破坏 `v-html`。
- 双栏滚动只同步 `scrollTop`，并在双栏强制 no-wrap；不要恢复四列单容器实现。
- 大尺寸弹窗必须动态 Teleport 同一个查看器容器，不能复制第二个 `GitDiffViewer` 或创建额外 Git 请求；在任何仓库状态清理路径关闭它。
- 若新能力回归，可先关闭对应的界面 toggle 和参数转发；不会需要迁移用户数据。
