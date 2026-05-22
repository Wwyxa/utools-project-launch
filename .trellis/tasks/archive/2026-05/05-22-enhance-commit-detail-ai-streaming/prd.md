# enhance-commit-detail-ai-streaming

## Goal

增强 Git Tab 中提交详情弹窗的 AI 能力，引入流式响应展示，让提交详情信息更丰富，同时优化整体排版布局。

## What I already know

### 当前状态

- 点击 Git graph 中的 commit 会打开提交详情弹窗 (`isCommitDetailOpen`)
- 弹窗显示：hash、message、author、date、refs、"解释 diff" 按钮、"变更文件"区域
- AI 结果通过 `store.aiAnalysisResult` 一次性展示在 `<pre>` 中
- 另有独立的 "AI生成" 对话框 (`isAiDialogOpen`)，用于批量分析筛选后的提交
- AI 调用链：`store.analyzeGitWithAi()` → `bridge.analyzeWithAi()` → preload.js 的 `analyzeWithAi()`，均为一次性返回，不支持流式

### 技术背景

- 前端 Vue 3 + Pinia + TypeScript
- 后端 preload.js (Node.js/Electron)，AI 调用支持 uTools 内置 AI 和第三方 API (OpenAI / Anthropic)
- 类型定义在 `src/types.ts`，ProjectBridge 接口定义了 `analyzeWithAi` 方法
- i18n 在 `src/lib/i18n.ts`

## Decisions Made

- **触发方式**: 手动触发（B）。弹窗内保留"AI 分析"按钮，用户选择模式后点击生成。
- **布局方案**: 上下分区（B）。顶部：紧凑横向元信息条。中部：AI 分析区。底部：commit body。
- **最终布局调整**: 提交详情采用紧凑双栏。顶部为元信息条，左侧为该提交变更文件和 Markdown commit body，右侧为 AI 分析区；双栏区域铺满弹窗剩余高度。
- **弹窗 AI 模式**: 简化版（B）。只保留模式下拉（总结/分析/评估），不提供自定义提示词编辑。自定义提示词后续迁移到设置界面统一管理。
- **流式响应方式**: 回调方式（A）。`bridge.analyzeWithAiStream(payload, onChunk, onDone)` 直接逐块更新前端响应式状态。
- **uTools AI fallback**: uTools 内置 AI 不支持流式，使用一次性返回，内容一次性渲染。

## Requirements (evolving)

### 提交详情增强

- 弹窗布局改为上下分区：紧凑元信息 → AI 分析区 → body/变更区
- 顶部元信息为单行/双行紧凑横向排列（类似工具栏风格），避免留白
- 中部 AI 区域：模式选择（下拉）+ "生成"按钮 + 流式结果展示区
- 底部：commit body 原文展示
- commit body 以 Markdown 渲染，减少标题/空白占用
- 点击提交详情中的变更文件可在提交详情上层打开对应 diff 弹窗
- AI 内容以流式响应形式逐步展示（第三方 API），uTools AI 一次性渲染

### AI生成面板增强

- "AI生成" 对话框也支持流式响应
- 保持流式展示体验与提交详情一致

### 后端支持

- preload.js 新增流式 AI 调用方法 (`analyzeWithAiStream`)
- 第三方 API (OpenAI/Anthropic) 使用 SSE/stream 模式
- 回调方式传递增量内容到前端，前端调用处负责拼接流式文本
- uTools 内置 AI 不支持流式则仍用一次性返回

### Store 层

- 新增流式 AI 分析 action，支持增量回调
- 提交详情弹窗有独立的状态（不与"AI生成"对话框共享 `aiAnalysisResult`）

## Open Questions

- 无阻塞问题。当前 MVP 按已确认决策实施。
