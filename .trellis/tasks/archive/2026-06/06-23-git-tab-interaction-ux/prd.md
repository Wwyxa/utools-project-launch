# GitTab 交互体验优化

## 目标

改进 GitTab 组件的交互体验，解决用户反馈不明确、操作状态分散、查看 diff 困难等问题。

## 背景与问题

当前 GitTab 组件存在以下交互问题：

1. **Loading 状态分散**：多个 loading 状态变量（`isGitRefreshing`, `isLoadingMore`, `isLoadingDiff`, `commitMessageAiState` 等）分散，用户不清楚系统在做什么
2. **批量操作无反馈**：stage/unstage 多个文件时没有进度提示，用户不知道处理了多少
3. **AI 生成提交信息无反馈**：生成 commit message 过程中没有任何 loading 提示
4. **Diff 阅读困难**：纯文本 diff，缺少颜色区分，+/- 行难以快速识别
5. **插件窗口空间受限**：插件窗口较小，无法插入 diff 预览面板而不影响布局

## 解决方案

### 1. 全局统一 Loading 提示（优先级：高）

**实现方式**：

- 在 GitTab 顶部或合适位置增加一个**全局状态栏**
- 显示当前正在执行的操作（如"正在刷新 Git 状态..."、"正在生成提交信息..."、"正在暂存 3/10 个文件..."）
- 统一管理所有 loading 状态，包括：
  - Git 快照刷新（`isGitSnapshotRefreshing`）
  - Git 状态刷新（`isGitStatusRefreshing`）
  - 加载更多提交（`isLoadingMore`）
  - AI 生成提交信息（`commitMessageAiState === 'loading'`）
  - 批量文件操作（`activeGitAction`）
  - 单文件操作（`activeGitFileActions`）

**设计要点**：

- 状态栏固定在 GitTab 顶部，不影响现有布局
- 使用进度条或 spinner 动画
- 支持显示操作进度（如"3/10"）
- 空闲时自动隐藏或显示简要信息

### 2. 批量操作进度反馈（优先级：高）

**实现方式**：

- 批量 stage/unstage/discard 操作时，显示"正在暂存 3/10 个文件..."
- 在全局状态栏中实时更新进度计数
- 操作完成后显示结果摘要（如"已暂存 10 个文件"）

**技术实现**：

- 修改 `executeBulkGitFileAction` 函数，增加进度回调
- 逐个处理文件时更新进度状态

### 3. Diff 简单高亮（优先级：中）

**实现方式**：

- **不引入**重型语法高亮库（如 shiki、highlight.js）
- 仅对 diff 标记行进行着色：
  - `+` 开头的行：绿色背景/文字
  - `-` 开头的行：红色背景/文字
  - `@@` 开头的 hunk header：蓝色/灰色
  - `diff --git`、`+++`、`---` 等 meta 行：灰色
- 使用 CSS 类实现，轻量且性能好

**设计要点**：

- 保持现有 `diffLines` computed 的分类逻辑（`kind: 'add' | 'delete' | 'hunk' | 'meta' | 'context'`）
- 为每种 kind 定义对应的 CSS 类

### 4. 优化 Diff 弹窗体验（优先级：中）

**问题分析**：

- 插件窗口空间有限，无法插入 diff 面板而不影响布局
- 保持弹窗方式，但优化弹窗体验

**实现方式**：

- 减小弹窗尺寸（不占满整个屏幕，80% 宽度 × 70% 高度）
- 支持 ESC 键快速关闭
- 点击文件名直接打开 diff 弹窗（减少点击次数）
- 弹窗内应用 diff 简单高亮

## 实现优先级

**第一批（本次实现）**：

1. 全局统一 Loading 提示
2. 批量操作进度反馈
3. AI 生成提交信息的 loading 反馈

**第二批（后续优化）**：4. Diff 简单高亮 5. 优化 Diff 弹窗尺寸和交互

## 成功标准

- [ ] 用户能清楚知道系统当前在执行什么操作（通过全局状态栏）
- [ ] 批量操作有明确的进度反馈（显示"3/10"计数）
- [ ] AI 生成提交信息时有 loading 提示
- [ ] Diff 中的 +/- 行有颜色区分，易于阅读
- [ ] Diff 弹窗尺寸适中，支持 ESC 关闭

## 技术约束

- 使用 Vue 3 Composition API
- 保持与现有 Element Plus 组件库的一致性
- 不引入过重的依赖（bundle size 控制）
- Diff 高亮采用纯 CSS，不依赖第三方库

## 现有功能保留

- 所有现有 Git 操作功能（stage/unstage/discard/commit/checkout 等）
- AI 分析功能（工作区分析、commit 分析、commit message 生成）
- 提交历史筛选和搜索
- Git graph 可视化
- 分支切换
