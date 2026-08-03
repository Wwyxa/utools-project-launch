# SourceGit 差异查看参考

## 观察结果

- `DiffView.axaml` 将路径/统计置于工具栏左侧，并在右侧提供 hunk 导航、完整文本、语法高亮、换行、单双栏和空白过滤控制。
- `TextDiffView.axaml` 的双栏使用两个独立呈现器和中间分隔线；两个窗格不换行，这使垂直同步不会因一侧折行而漂移。
- `DiffContext.cs` 将完整文本定义为 `999999999` 个上下文行，并在完整文本和空白过滤设置变化时重新读取 diff。
- `Commands/Diff.cs` 对空白过滤使用 `--ignore-space-change --ignore-blank-lines`；对成对的删除/新增行，在长度不超过 1024、片段数不超过 4 时调用 `TextInlineChange.Compare`。
- `TextInlineChange.cs` 在词块/符号级寻找差异范围；本项目将实现独立、受限的纯 TypeScript 版本，而不是复制 SourceGit 源码或引入新的运行时依赖。

## 采用与排除

采用紧凑标题工具栏、单一布局切换、独立双窗格、保守内联变更高亮、完整文本与空白过滤的行为契约。不采用 SourceGit 的 hunk 暂存/撤销、外部合并、隐藏符号、minimap、图像差异和跨重启偏好。

## 本项目弹窗复用

- `src/components/project/GitTab.vue` 已以 `Teleport`、`scale` transition、遮罩点击与 `addAppEscapeRequestListener(...)` 管理 Git remote 对话框。
- `GitDiffViewer.vue` 当前只有 `GitTab.vue` 一个消费者，因此可以通过动态 Teleport 移动其容器，在内嵌和放大模式间保持同一实例，而无需新的 Diff 状态、读取路径或组件副本。
- 大尺寸模式是插件窗口内的覆盖对话框，而非原生 uTools 新窗口；它用几乎全部现有插件视口换取比右侧分栏更大的审阅空间。
