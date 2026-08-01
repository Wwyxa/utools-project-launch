# 优化 Git 提交图布局与引用徽标

## Goal

修复复杂分支历史中轨道缺失、错误收束和提交信息远离节点的问题，并让分支、远程和 tag 徽标采用接近 VS Code Source Control Graph 的紧凑信息层级。

## Background

- 当前 `GitTab.vue` 用全局 `activeLanes` 和整页最大 `graphColumnWidth` 绘制共享 SVG；这既可能提前释放仍应贯穿可见区的轨道，也让所有提交文本被最复杂一行的图宽统一推远。
- 用户给出的回归场景是：feature 分支领先于 main，main 新增提交并发生合并；VS Code 显示三条竖向泳道，本项目只显示两条。
- VS Code `scmHistory.ts` 为每条提交保存 `inputSwimlanes` 与 `outputSwimlanes`，逐行替换第一父、追加其他父并保留旁路轨道；每行 SVG 宽度由该行泳道数决定。
- 现有 structured `refNames` 已能区分 head/local/remote/tag，legacy `refs` 只应作为兼容回退。

## Requirements

- R1: 将图布局提取为与 Vue 无关的纯 TypeScript 模块，输入可见提交与 HEAD/ref 上下文，输出每行 input/output 泳道、节点位置、路径语义和按行图宽。
- R2: 泳道状态必须准确表达第一父直行、非第一父分叉、旁路分支持续、合并收束和根提交；不得因某条提交没有成为当前行节点就删除其贯穿轨道。
- R3: 已加载窗口之外的父提交不得生成虚假节点或跨越哨兵的路径，但可见窗口内仍成立的旁路泳道不得被提前压缩。
- R4: 每条提交文本紧跟该行实际最右侧 input/output 泳道，仅多轨行增加必要缩进；保持现有固定行高、横向滚动和展开文件造成的纵向偏移契约。
- R5: HEAD、普通节点和多父节点的视觉语义清晰，节点、路径和对应行在筛选、分页追加、文件展开/收起后持续对齐。
- R6: ref 排序优先当前 HEAD、当前 upstream/remote、其他有图形颜色的 refs，再到普通 refs；同色同图标 refs 可按 VS Code 方式紧凑分组。
- R7: 最重要的有色 ref 显示名称；其余 refs 以图标、数量或必要的代表名称压缩，并通过 title/tooltip 暴露完整名称。`remote/HEAD` 不得触发当前 HEAD 样式。
- R8: 提交行与 hover preview 共享同一结构化 ref presentation，继续使用 Lucide 图标和项目语义 token，不复制 VS Code 主题服务或组件框架。

## Acceptance Criteria

- [ ] AC1: 三轨回归 fixture 在 feature 领先、main 新增并 merge 的可见区输出三条并行泳道，并在正确行分叉、直行和收束。（R1、R2）
- [ ] AC2: 单线、普通分叉、merge、八爪 merge、根提交、分页边界和筛选窗口 fixtures 均有确定的 input/output 泳道断言。（R1-R3）
- [ ] AC3: 单轨行的提交文字明显贴近节点；多轨行只使用该行实际图宽，任何行的文字、徽标与轨道不重叠。（R4）
- [ ] AC4: 展开任意多个提交文件后，后续节点、路径、行和 SVG 高度仍使用同一纵向坐标模型。（R5）
- [ ] AC5: HEAD、本地、远程、tag 与多 ref 分组顺序可测试；`remote/HEAD`、自定义 remote、逗号 ref 名和 annotated tag 保持结构化语义。（R6-R8）
- [ ] AC6: 现有提交筛选、选择、文件展开、右键菜单、hover preview、自动分页和横向滚动无行为回归。（R4、R5、R8）
- [ ] AC7: 图布局与 ref helper 的 focused Vitest、`npm run validate:git-commits`、`npm run type-check` 和 `npm run build` 通过。（R1-R8）

## Out Of Scope

- 完整复制 VS Code 的 incoming/outgoing 虚拟节点、SCM Tree、Observable、Theme 或 Command 系统。
- 修改 Git 写操作、远程操作、AI 分析或 hover preview 的异步加载策略。
- 引入第三方 Git graph 依赖、虚拟列表或新的主题框架。
